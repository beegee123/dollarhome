-- DollarHome, step 13b: Owed — loans and tax bills. Safe to re-run.
--
-- A debt says how much you owe and which envelope (budget item) pays it.
-- Paying = a spend from that envelope, tagged with the debt, and the amount
-- owed goes down — both in one transaction (pay_debt). Interest is handled by
-- simply updating the amount owed now and then.

create table if not exists money.debts (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 1 and 60),
  kind             text not null default 'loan' check (kind in ('loan', 'tax')),
  currency         text not null default 'USD' check (currency in ('USD', 'CAD')),
  category_id      uuid references money.categories (id) on delete set null,  -- pays from
  original_amount  numeric(12,2) not null check (original_amount >= 0),         -- for progress
  amount_owed      numeric(12,2) not null check (amount_owed >= 0),
  due_date         date,                                                         -- tax bills, mostly
  paid_off_at      timestamptz,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

-- Payments are ordinary spends that also point at the debt they paid.
alter table money.transactions
  add column if not exists debt_id uuid references money.debts (id) on delete set null;

alter table money.debts enable row level security;
drop policy if exists "own rows" on money.debts;
create policy "own rows" on money.debts for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on money.debts to authenticated;
grant all on money.debts to service_role;


-- Pay a debt from its envelope. Returns the payment's transaction id (for Undo).
create or replace function money.pay_debt(p_debt_id uuid, p_amount numeric, p_paid_on date, p_note text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_debt  record;
  v_tx    uuid;
begin
  select * into v_debt from money.debts where id = p_debt_id;
  if v_debt.id is null then
    raise exception 'That debt was not found.';
  end if;
  if v_debt.category_id is null then
    raise exception '% has no envelope to pay from. Edit it and pick one first.', v_debt.name;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The payment must be above 0.';
  end if;

  insert into money.transactions (category_id, amount, kind, note, occurred_on, debt_id)
  values (v_debt.category_id, -p_amount, 'spend',
          coalesce(nullif(trim(p_note), ''), 'Payment: ' || v_debt.name),
          coalesce(p_paid_on, current_date), v_debt.id)
  returning id into v_tx;

  update money.debts
     set amount_owed = greatest(0, amount_owed - p_amount),
         paid_off_at = case when amount_owed - p_amount <= 0 then now() else null end
   where id = v_debt.id;

  return v_tx;
end;
$$;

-- Undo a payment: remove the spend and add the amount back to what's owed.
create or replace function money.unpay_debt(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx record;
begin
  select id, amount, debt_id into v_tx from money.transactions where id = p_transaction_id;
  if v_tx.id is null or v_tx.debt_id is null then
    raise exception 'That payment was not found.';
  end if;
  update money.debts set amount_owed = amount_owed + (-v_tx.amount), paid_off_at = null where id = v_tx.debt_id;
  delete from money.transactions where id = v_tx.id;
end;
$$;

grant execute on function money.pay_debt(uuid, numeric, date, text) to authenticated;
grant execute on function money.unpay_debt(uuid) to authenticated;
revoke execute on function money.pay_debt(uuid, numeric, date, text) from anon, public;
revoke execute on function money.unpay_debt(uuid) from anon, public;

-- Start fresh / delete a bank must also clear debts, so extend them.
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
  delete from money.wishlist_items where owner_id = v_me;
  delete from money.transactions   where owner_id = v_me;
  delete from money.income_events  where owner_id = v_me;
  delete from money.income_sources where owner_id = v_me;
  delete from money.debts          where owner_id = v_me;
  delete from money.banks          where owner_id = v_me;
end;
$$;

notify pgrst, 'reload schema';
