-- DollarHome: change a bank account into a credit card. Safe to re-run.
--
-- For an account that was added as a bank account by mistake. It only works while
-- the account is still "bare": no budget items of its own, no income source landing
-- in it, and nothing in its Unassigned but opening balances. Otherwise there would be
-- real history that doesn't make sense on a card.
--
--   p_owed       what the card owes today (from your card app)
--   p_pays_from  the bank account (kind cash, same currency) the bill is paid from
--
-- Result: the account becomes kind 'credit', its Unassigned ledger is set to minus
-- what you owe, its statement balance is set to p_owed, and a "<name> payment"
-- envelope is created in the paying account (same as add_card).

create or replace function money.convert_to_card(p_account_id uuid, p_owed numeric, p_pays_from uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acct      record;
  v_ledger    uuid;
  v_total     numeric;
  v_payment   uuid;
  v_from_cur  text;
  v_owed      numeric := coalesce(p_owed, 0);
  v_name      text;
begin
  select a.id, a.name, a.kind, a.bank_id, b.currency into v_acct
  from money.accounts a join money.banks b on b.id = a.bank_id
  where a.id = p_account_id;
  if v_acct.id is null then
    raise exception 'That account was not found.';
  end if;
  if v_acct.kind = 'credit' then
    raise exception '% is already a credit card.', v_acct.name;
  end if;
  if v_owed < 0 then
    raise exception 'What the card owes can''t be below 0.';
  end if;

  if exists (select 1 from money.categories where account_id = p_account_id and not is_unassigned) then
    raise exception 'This account still has budget items. Move them to another account (or archive them) first, then change it to a card.';
  end if;
  if exists (select 1 from money.income_sources where account_id = p_account_id) then
    raise exception 'An income source lands in this account. A card can''t receive paychecks, so change or delete that source first.';
  end if;

  select id into v_ledger from money.categories where account_id = p_account_id and is_unassigned;
  if exists (select 1 from money.transactions where category_id = v_ledger and kind <> 'opening') then
    raise exception 'This account has activity in it, so it can''t become a card. Archive it and add the card instead.';
  end if;

  select b.currency into v_from_cur
  from money.accounts a join money.banks b on b.id = a.bank_id
  where a.id = p_pays_from and a.kind = 'cash' and a.id <> p_account_id;
  if v_from_cur is null then
    raise exception 'Choose the bank account the card is paid from.';
  end if;
  if v_from_cur <> v_acct.currency then
    raise exception 'The card and the account that pays it must use the same currency.';
  end if;

  -- Ledger = minus what you owe, whatever opening amounts were there before.
  select coalesce(sum(amount), 0) into v_total from money.transactions where category_id = v_ledger;
  if (-v_owed - v_total) <> 0 then
    insert into money.transactions (category_id, amount, kind, note)
    values (v_ledger, -v_owed - v_total, 'opening', 'Changed to a card');
  end if;

  -- The payment envelope in the paying account (name made unique if needed).
  v_name := trim(v_acct.name) || ' payment';
  if exists (select 1 from money.categories where account_id = p_pays_from and name = v_name) then
    v_name := left(v_name || ' (' || to_char(now(), 'Mon DD') || ')', 40);
  end if;
  insert into money.categories (account_id, name, planned_amount, sort_order)
  values (p_pays_from, left(v_name, 40), 0,
          coalesce((select max(sort_order) + 1 from money.categories where account_id = p_pays_from), 0))
  returning id into v_payment;

  update money.accounts
     set kind = 'credit', payment_category_id = v_payment,
         bank_balance = v_owed, balance_checked_at = now()
   where id = p_account_id;
end;
$$;

grant execute on function money.convert_to_card(uuid, numeric, uuid) to authenticated;
revoke execute on function money.convert_to_card(uuid, numeric, uuid) from anon, public;

notify pgrst, 'reload schema';
