-- DollarHome, step 14: credit cards. Safe to re-run.
--
-- A card is an account with kind = 'credit' under its bank. Its built-in
-- Unassigned works as the card's LEDGER: it holds minus what you owe
-- (owe $640 → the card account's total is −$640).
-- Each card has a PAYMENT ENVELOPE: a budget item in the bank account you pay
-- the card from ("Visa payment" in Truist Checking). Card spending moves
-- envelope money into it, so the money for the bill is set aside.
--
--   spend $50 on the card:   Groceries −50 (spend) · Visa payment +50 · card ledger −50
--   pay the card $640:       Visa payment −640 · card ledger +640
-- Each set shares one pair_id, so Undo removes all of it.

alter table money.accounts
  add column if not exists kind text not null default 'cash',
  add column if not exists payment_category_id uuid references money.categories (id) on delete set null;

alter table money.accounts drop constraint if exists accounts_kind_check;
alter table money.accounts add constraint accounts_kind_check check (kind in ('cash', 'credit'));

-- Two new transaction kinds: 'card' (a charge on the card) and 'card_payment'.
alter table money.transactions drop constraint if exists transactions_kind_check;
alter table money.transactions add constraint transactions_kind_check
  check (kind in ('income', 'spend', 'move', 'transfer', 'opening', 'card', 'card_payment'));


-- Add a card: the account, its opening amount owed, and its payment envelope.
--   p_owed           what the card owes today (from your statement or card app)
--   p_pays_from      the bank account (kind cash) the bill is paid from
create or replace function money.add_card(p_bank_id uuid, p_name text, p_owed numeric, p_pays_from uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card      uuid;
  v_ledger    uuid;
  v_payment   uuid;
  v_currency  text;
  v_from_cur  text;
  v_name      text := trim(p_name) || ' payment';
begin
  select currency into v_currency from money.banks where id = p_bank_id;
  select b.currency into v_from_cur
  from money.accounts a join money.banks b on b.id = a.bank_id
  where a.id = p_pays_from and a.kind = 'cash';
  if v_currency is null or v_from_cur is null then
    raise exception 'Choose the bank and the account the card is paid from.';
  end if;
  if v_currency <> v_from_cur then
    raise exception 'The card and the account that pays it must use the same currency.';
  end if;

  insert into money.accounts (bank_id, name, kind, bank_balance, balance_checked_at,
                              sort_order)
  values (p_bank_id, trim(p_name), 'credit', coalesce(p_owed, 0), now(),
          coalesce((select max(sort_order) + 1 from money.accounts where bank_id = p_bank_id), 0))
  returning id into v_card;

  -- The trigger made the card's Unassigned; it's the ledger.
  select id into v_ledger from money.categories where account_id = v_card and is_unassigned;
  if coalesce(p_owed, 0) <> 0 then
    insert into money.transactions (category_id, amount, kind, note)
    values (v_ledger, -p_owed, 'opening', 'Owed when added');
  end if;

  -- The payment envelope, in the paying account (name made unique if needed).
  if exists (select 1 from money.categories where account_id = p_pays_from and name = v_name) then
    v_name := left(v_name || ' (' || to_char(now(), 'Mon DD') || ')', 40);
  end if;
  insert into money.categories (account_id, name, planned_amount, sort_order)
  values (p_pays_from, left(v_name, 40), 0,
          coalesce((select max(sort_order) + 1 from money.categories where account_id = p_pays_from), 0))
  returning id into v_payment;

  update money.accounts set payment_category_id = v_payment where id = v_card;
  return v_card;
end;
$$;


-- Spend on a card: three rows, one pair_id. Returns the pair_id (for Undo).
create or replace function money.card_spend(
  p_category_id uuid, p_card_id uuid, p_amount numeric, p_spent_on date, p_note text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card     record;
  v_ledger   uuid;
  v_item_cur text;
  v_card_cur text;
  v_pair     uuid := gen_random_uuid();
  v_on       date := coalesce(p_spent_on, current_date);
  v_note     text := nullif(trim(p_note), '');
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be above 0.';
  end if;
  select a.id, a.name, a.payment_category_id, b.currency into v_card
  from money.accounts a join money.banks b on b.id = a.bank_id
  where a.id = p_card_id and a.kind = 'credit';
  if v_card.id is null then
    raise exception 'That card was not found.';
  end if;
  if v_card.payment_category_id is null then
    raise exception '% has no payment envelope. Re-add the card.', v_card.name;
  end if;
  select b.currency into v_item_cur
  from money.categories c join money.accounts a on a.id = c.account_id join money.banks b on b.id = a.bank_id
  where c.id = p_category_id;
  if v_item_cur is distinct from v_card.currency then
    raise exception 'That card uses a different currency from this budget item.';
  end if;
  select id into v_ledger from money.categories where account_id = v_card.id and is_unassigned;

  insert into money.transactions (category_id, amount, kind, note, occurred_on, pair_id) values
    (p_category_id,             -p_amount, 'spend', coalesce(v_note, 'Paid with ' || v_card.name), v_on, v_pair),
    (v_card.payment_category_id, p_amount, 'move',  'Set aside for ' || v_card.name,               v_on, v_pair),
    (v_ledger,                  -p_amount, 'card',  v_note,                                         v_on, v_pair);
  return v_pair;
end;
$$;


-- Pay the card from its payment envelope. Returns the pair_id (for Undo).
create or replace function money.pay_card(p_card_id uuid, p_amount numeric, p_paid_on date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card   record;
  v_ledger uuid;
  v_pair   uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The payment must be above 0.';
  end if;
  select id, name, payment_category_id into v_card from money.accounts where id = p_card_id and kind = 'credit';
  if v_card.id is null or v_card.payment_category_id is null then
    raise exception 'That card was not found.';
  end if;
  select id into v_ledger from money.categories where account_id = v_card.id and is_unassigned;

  insert into money.transactions (category_id, amount, kind, note, occurred_on, pair_id) values
    (v_card.payment_category_id, -p_amount, 'card_payment', 'Paid ' || v_card.name, coalesce(p_paid_on, current_date), v_pair),
    (v_ledger,                    p_amount, 'card_payment', 'Payment',               coalesce(p_paid_on, current_date), v_pair);

  return v_pair;
end;
$$;


-- Restart balances: cards restart from what they owe (as minus), bank accounts from their balance.
create or replace function money.restart_balances()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;
  update money.wishlist_items set bought_at = null, transaction_id = null where owner_id = v_me;
  delete from money.transactions  where owner_id = v_me;
  delete from money.income_events where owner_id = v_me;

  insert into money.transactions (category_id, amount, kind, note)
  select c.id,
         case when a.kind = 'credit' then -a.bank_balance else a.bank_balance end,
         'opening', 'Starting balance (restarted)'
  from money.accounts a
  join money.categories c on c.account_id = a.id and c.is_unassigned
  where a.owner_id = v_me and not a.archived and a.bank_balance <> 0;
end;
$$;

grant execute on function money.add_card(uuid, text, numeric, uuid) to authenticated;
grant execute on function money.card_spend(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function money.pay_card(uuid, numeric, date) to authenticated;
revoke execute on function money.add_card(uuid, text, numeric, uuid) from anon, public;
revoke execute on function money.card_spend(uuid, uuid, numeric, date, text) from anon, public;
revoke execute on function money.pay_card(uuid, numeric, date) from anon, public;

notify pgrst, 'reload schema';
