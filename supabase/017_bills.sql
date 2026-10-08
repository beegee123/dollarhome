-- DollarHome: Bills, a saved list of regular bills you log in one go. Safe to re-run.
--
-- A bill = name + the budget item it comes from + its usual amount + what pays it
-- (the bank account, or a credit card) + an optional due day of the month.
-- Paying bills logs ordinary spends (or card spends), each tagged with its bill so
-- the Bills screen can show when it was last paid.

create table if not exists money.bills (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  category_id  uuid not null references money.categories (id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  card_id      uuid references money.accounts (id) on delete set null, -- null = paid from the bank account
  due_day      int check (due_day between 1 and 31),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

alter table money.bills enable row level security;
drop policy if exists "own rows" on money.bills;
create policy "own rows" on money.bills for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on money.bills to authenticated;

-- Which bill a spend paid (deleting a bill keeps its past spends, just untagged).
alter table money.transactions
  add column if not exists bill_id uuid references money.bills (id) on delete set null;
create index if not exists transactions_by_bill on money.transactions (bill_id) where bill_id is not null;

-- Pay several bills at once, all or nothing.
--   p_lines    [{"bill_id": "...", "amount": 85.00}, ...]  (amount = this time's amount)
--   p_paid_on  the date to log them on
-- Returns {"ids": [...], "pairs": [...]}: what to delete for Undo
-- (plain spends by id; card spends by pair, since each is three rows).
create or replace function money.pay_bills(p_lines jsonb, p_paid_on date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line  record;
  v_bill  record;
  v_id    uuid;
  v_pair  uuid;
  v_ids   uuid[] := '{}';
  v_pairs uuid[] := '{}';
  v_on    date := coalesce(p_paid_on, current_date);
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Pick at least one bill.';
  end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(bill_id uuid, amount numeric) loop
    select b.id, b.name, b.category_id, b.card_id, a.kind as account_kind
      into v_bill
    from money.bills b
    join money.categories c on c.id = b.category_id
    join money.accounts a on a.id = c.account_id
    where b.id = v_line.bill_id;
    if v_bill.id is null then
      raise exception 'A bill was not found. Reload and try again.';
    end if;
    if v_line.amount is null or v_line.amount <= 0 then
      raise exception 'The amount for % must be above 0.', v_bill.name;
    end if;
    if v_bill.account_kind <> 'cash' then
      raise exception '% comes from a card account. Edit the bill and pick a budget item in a bank account.', v_bill.name;
    end if;

    if v_bill.card_id is not null then
      v_pair := money.card_spend(v_bill.category_id, v_bill.card_id, v_line.amount, v_on, v_bill.name);
      update money.transactions set bill_id = v_bill.id where pair_id = v_pair;
      v_pairs := v_pairs || v_pair;
    else
      insert into money.transactions (category_id, amount, kind, note, occurred_on, bill_id)
      values (v_bill.category_id, -round(v_line.amount, 2), 'spend', v_bill.name, v_on, v_bill.id)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end if;
  end loop;

  return jsonb_build_object('ids', to_jsonb(v_ids), 'pairs', to_jsonb(v_pairs));
end;
$$;

grant execute on function money.pay_bills(jsonb, date) to authenticated;
revoke execute on function money.pay_bills(jsonb, date) from anon, public;

notify pgrst, 'reload schema';
