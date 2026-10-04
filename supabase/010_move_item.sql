-- DollarHome, step 15: move a budget item to another account. Safe to re-run.
--
-- The item keeps its whole history (income, spends, moves) and simply changes
-- account. Because its balance is the sum of that history, its money moves with
-- it: the old account's total drops by the balance and the new one's rises —
-- the same as a transfer. You then move that money in your bank app.
--
-- Rules: only to a bank account (not a card), same currency, no name clash.
-- Moving to another BANK takes it out of the old bank's paycheck splits
-- (splits must stay within one bank); their names are returned so the app can say.

create or replace function money.move_category(p_category_id uuid, p_to_account_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cat      record;
  v_from     record;
  v_to       record;
  v_balance  numeric;
  v_removed  text[] := '{}';
begin
  select id, name, account_id, is_unassigned into v_cat from money.categories where id = p_category_id;
  if v_cat.id is null then
    raise exception 'That budget item was not found.';
  end if;
  if v_cat.is_unassigned then
    raise exception 'Unassigned is built into its account and can''t be moved.';
  end if;

  select a.id, a.name, a.bank_id, a.kind, b.currency into v_from
  from money.accounts a join money.banks b on b.id = a.bank_id where a.id = v_cat.account_id;
  select a.id, a.name, a.bank_id, a.kind, b.currency into v_to
  from money.accounts a join money.banks b on b.id = a.bank_id where a.id = p_to_account_id;

  if v_to.id is null then
    raise exception 'That account was not found.';
  end if;
  if v_to.id = v_from.id then
    raise exception 'It''s already in that account.';
  end if;
  if v_to.kind <> 'cash' then
    raise exception 'Budget items live in bank accounts, not on credit cards.';
  end if;
  if v_to.currency <> v_from.currency then
    raise exception 'Budget items can only move to an account in the same currency.';
  end if;
  if exists (select 1 from money.categories where account_id = v_to.id and name = v_cat.name) then
    raise exception '% already has a budget item called %. Rename one first.', v_to.name, v_cat.name;
  end if;

  select coalesce(sum(amount), 0) into v_balance from money.transactions where category_id = v_cat.id;

  -- Another bank: leave the old bank's paycheck splits.
  if v_to.bank_id <> v_from.bank_id then
    select coalesce(array_agg(distinct s.name), '{}') into v_removed
    from money.split_lines l join money.income_sources s on s.id = l.source_id
    where l.category_id = v_cat.id;
    delete from money.split_lines where category_id = v_cat.id;
  end if;

  update money.categories
     set account_id = v_to.id,
         sort_order = coalesce((select max(sort_order) + 1 from money.categories where account_id = v_to.id), 0)
   where id = v_cat.id;

  return jsonb_build_object(
    'balance', v_balance,
    'from_account', v_from.name,
    'to_account', v_to.name,
    'removed_from_splits', to_jsonb(v_removed)
  );
end;
$$;

grant execute on function money.move_category(uuid, uuid) to authenticated;
revoke execute on function money.move_category(uuid, uuid) from anon, public;

notify pgrst, 'reload schema';
