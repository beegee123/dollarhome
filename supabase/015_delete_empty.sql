-- DollarHome: delete an account or bank that was never used. Safe to re-run.
--
-- Archive stays the way to retire something that has history. Delete is only
-- for something set up and never used (a mistake, a duplicate). It refuses when
-- deleting would lose or orphan anything:
--   * any transaction in the account's budget items (history; a move or transfer
--     also has a half in another account that would be left stranded)
--   * an income source that lands in the account, or split lines that use its items
--   * a credit card whose payment envelope is here, or a debt paid from here
--   * a wishlist item linked to one of its items

create or replace function money.account_delete_blocker(p_account_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from money.accounts where id = p_account_id) then
    return 'That account was not found.';
  end if;
  if exists (
    select 1 from money.transactions t
    join money.categories c on c.id = t.category_id
    where c.account_id = p_account_id
  ) then
    return 'It has activity in it, so it can only be archived. Deleting would erase that history.';
  end if;
  if exists (select 1 from money.income_sources where account_id = p_account_id) then
    return 'An income source lands here. Delete or move that source first.';
  end if;
  if exists (
    select 1 from money.split_lines l
    join money.categories c on c.id = l.category_id
    where c.account_id = p_account_id
  ) then
    return 'An income split still uses its budget items. Take them out of the split first.';
  end if;
  if exists (
    select 1 from money.accounts a
    join money.categories c on c.id = a.payment_category_id
    where c.account_id = p_account_id
  ) then
    return 'A credit card uses one of its budget items to pay the card.';
  end if;
  if exists (
    select 1 from money.debts d
    join money.categories c on c.id = d.category_id
    where c.account_id = p_account_id
  ) then
    return 'A loan or tax bill on the Owed screen is paid from one of its budget items.';
  end if;
  if exists (
    select 1 from money.wishlist_items w
    join money.categories c on c.id = w.category_id
    where c.account_id = p_account_id
  ) then
    return 'A wishlist item is linked to one of its budget items.';
  end if;
  return null;
end;
$$;

create or replace function money.delete_account(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_blocker text;
begin
  v_blocker := money.account_delete_blocker(p_account_id);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;
  -- Its budget items (including Unassigned) go with it.
  delete from money.accounts where id = p_account_id;
end;
$$;

-- A bank can be deleted when every one of its accounts (archived ones too) can.
create or replace function money.delete_unused_bank(p_bank_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account record;
  v_blocker text;
begin
  if not exists (select 1 from money.banks where id = p_bank_id) then
    raise exception 'That bank was not found.';
  end if;
  for v_account in select id, name from money.accounts where bank_id = p_bank_id loop
    v_blocker := money.account_delete_blocker(v_account.id);
    if v_blocker is not null then
      raise exception '% can''t be deleted: %', v_account.name, v_blocker;
    end if;
  end loop;
  delete from money.banks where id = p_bank_id;
end;
$$;

grant execute on function money.account_delete_blocker(uuid) to authenticated;
grant execute on function money.delete_account(uuid) to authenticated;
grant execute on function money.delete_unused_bank(uuid) to authenticated;
revoke execute on function money.account_delete_blocker(uuid) from anon, public;
revoke execute on function money.delete_account(uuid) from anon, public;
revoke execute on function money.delete_unused_bank(uuid) from anon, public;

notify pgrst, 'reload schema';
