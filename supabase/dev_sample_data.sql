-- DollarHome: sample data for YOUR account, matching the wireframe.
-- For trying the app while we build. Don't run it once you've entered real data.
--
-- 1. Put your sign-in email on the line marked  <-- YOUR EMAIL
-- 2. Run it in the Supabase SQL Editor.
-- Running it again first deletes your existing DollarHome data (banks
-- cascade to everything under them), so it always starts clean.

do $$
declare
  v_email   text := 'you@example.com';  -- <-- YOUR EMAIL
  v_owner   uuid;
  v_truist  uuid; v_rbc uuid;
  v_chk     uuid; v_sav uuid; v_rbc_chq uuid; v_rbc_sav uuid;
begin
  select id into v_owner from auth.users where email = v_email;
  if v_owner is null then
    raise exception 'No user with email %. Check the email at the top.', v_email;
  end if;

  -- Start clean
  delete from money.wishlist_items where owner_id = v_owner;
  delete from money.transactions   where owner_id = v_owner;
  delete from money.income_events  where owner_id = v_owner;
  delete from money.banks          where owner_id = v_owner;

  -- Banks
  insert into money.banks (owner_id, name, currency, sort_order)
    values (v_owner, 'Truist', 'USD', 0) returning id into v_truist;
  insert into money.banks (owner_id, name, currency, sort_order)
    values (v_owner, 'RBC', 'CAD', 1) returning id into v_rbc;

  -- Accounts (each automatically gets an Unassigned category)
  insert into money.accounts (owner_id, bank_id, name, bank_balance, sort_order)
    values (v_owner, v_truist, 'Checking', 1865, 0) returning id into v_chk;
  insert into money.accounts (owner_id, bank_id, name, bank_balance, sort_order)
    values (v_owner, v_truist, 'Savings', 1570, 1) returning id into v_sav;
  insert into money.accounts (owner_id, bank_id, name, bank_balance, sort_order)
    values (v_owner, v_rbc, 'Chequing · STR', 2075, 0) returning id into v_rbc_chq;
  insert into money.accounts (owner_id, bank_id, name, bank_balance, sort_order)
    values (v_owner, v_rbc, 'Savings', 600, 1) returning id into v_rbc_sav;

  -- Budget items: (account, name, plan, current balance, order)
  insert into money.categories (owner_id, account_id, name, planned_amount, sort_order)
  select v_owner, a, n, p, o from (values
    (v_chk, 'Rent', 1200, 0), (v_chk, 'Groceries', 600, 1), (v_chk, 'Gas', 200, 2),
    (v_chk, 'Utilities', 250, 3), (v_chk, 'Giving', 150, 4), (v_chk, 'Fun', 100, 5),
    (v_sav, 'Emergency fund', 500, 0), (v_sav, 'Travel', 300, 1), (v_sav, 'Wants', 200, 2),
    (v_rbc_chq, 'STR taxes', 740, 0), (v_rbc_chq, 'Cleaning & supplies', 555, 1),
    (v_rbc_chq, 'Repairs', 370, 2),
    (v_rbc_sav, 'Property tax', 800, 0)
  ) as x(a, n, p, o);

  -- Balances, as one opening transaction per item (Utilities stays at 0).
  insert into money.transactions (owner_id, category_id, amount, kind, note)
  select v_owner, c.id, x.amt, 'opening', 'Sample starting balance'
  from (values
    (v_chk, 'Unassigned', 180), (v_chk, 'Rent', 1200), (v_chk, 'Groceries', 160),
    (v_chk, 'Gas', 140), (v_chk, 'Giving', 150), (v_chk, 'Fun', 35),
    (v_sav, 'Emergency fund', 900), (v_sav, 'Travel', 250), (v_sav, 'Wants', 420),
    (v_rbc_chq, 'STR taxes', 1110), (v_rbc_chq, 'Cleaning & supplies', 555),
    (v_rbc_chq, 'Repairs', 370),
    (v_rbc_sav, 'Property tax', 600)
  ) as x(acct, cname, amt)
  join money.categories c on c.account_id = x.acct and c.name = x.cname;

  raise notice 'Sample data loaded for %', v_email;
end;
$$;
