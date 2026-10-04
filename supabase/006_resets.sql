-- DollarHome: partial resets (Setup → Reset). Your own rows only (runs as you).
-- Safe to re-run.

-- 1) Restart balances, keep the setup.
--    Clears every spend, paycheck, move and transfer. Keeps banks, accounts,
--    budget items, plans, income sources, splits and wishlist items (bought
--    ones go back on the list). Each account then starts again from the bank
--    balance on file, as an "opening" amount in its Unassigned.
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
  select c.id, a.bank_balance, 'opening', 'Starting balance (restarted)'
  from money.accounts a
  join money.categories c on c.account_id = a.id and c.is_unassigned
  where a.owner_id = v_me and not a.archived and a.bank_balance <> 0;
end;
$$;

-- 2) Delete one bank and everything under it.
--    Its accounts, budget items and their history, and any income sources
--    that land there (with their splits and paychecks). Wishlist items that
--    used one of its envelopes stay, with no envelope.
create or replace function money.delete_bank(p_bank_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from money.banks where id = p_bank_id) then
    raise exception 'That bank was not found.';
  end if;

  -- History first: transactions point at budget items and block deleting them.
  delete from money.transactions
  where category_id in (
    select c.id from money.categories c
    join money.accounts a on a.id = c.account_id
    where a.bank_id = p_bank_id
  );

  delete from money.income_events
  where source_id in (
    select s.id from money.income_sources s
    join money.accounts a on a.id = s.account_id
    where a.bank_id = p_bank_id
  );

  -- Accounts, budget items, income sources and split lines go with the bank.
  delete from money.banks where id = p_bank_id;
end;
$$;

grant execute on function money.restart_balances() to authenticated;
grant execute on function money.delete_bank(uuid) to authenticated;
revoke execute on function money.restart_balances() from anon, public;
revoke execute on function money.delete_bank(uuid) from anon, public;

notify pgrst, 'reload schema';
