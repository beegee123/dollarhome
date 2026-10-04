-- DollarHome, step 11: "Start fresh" — delete ALL of the signed-in person's
-- DollarHome data (sample data included), so real data can go in clean.
-- Only touches your own rows: it runs as you, and row-level security applies.
-- Pantry and Daily Docket are not affected (different schemas).
-- Safe to re-run.

create or replace function money.start_fresh()
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
  -- Order matters: transactions must go before the budget items they point at.
  delete from money.wishlist_items where owner_id = v_me;
  delete from money.transactions   where owner_id = v_me;
  delete from money.income_events  where owner_id = v_me;
  delete from money.income_sources where owner_id = v_me;  -- split lines go with them
  delete from money.banks          where owner_id = v_me;  -- accounts and budget items go with them
end;
$$;

grant execute on function money.start_fresh() to authenticated;
revoke execute on function money.start_fresh() from anon, public;

notify pgrst, 'reload schema';
