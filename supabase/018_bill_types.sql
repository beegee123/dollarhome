-- DollarHome: bill types (spend or card payment) and a "next due" date. Safe to re-run.
--
--   kind 'spend'        → logs a spend from a budget item (as before), maybe paid with a card
--   kind 'card_payment' → pays a credit card from its payment envelope (like Pay card)
--   next_due            → the date this bill is next due; moves forward a month when paid
--                         (due_day is kept as the day of the month it falls on)

alter table money.bills add column if not exists kind text not null default 'spend';
alter table money.bills drop constraint if exists bills_kind_check;
alter table money.bills add constraint bills_kind_check check (kind in ('spend', 'card_payment'));
alter table money.bills alter column category_id drop not null;
alter table money.bills drop constraint if exists bills_kind_target_check;
alter table money.bills add constraint bills_kind_target_check check (
  (kind = 'spend' and category_id is not null) or (kind = 'card_payment' and card_id is not null));
alter table money.bills add column if not exists next_due date;

-- The same day of the month in the month after p_from (31st → last day of a short month).
create or replace function money.month_after(p_from date, p_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_from) + interval '1 month')::date
         + (least(p_day,
                  extract(day from (date_trunc('month', p_from) + interval '2 month' - interval '1 day'))::int) - 1);
$$;

-- Bills that only had a due day get their next due date (this month, or next if it has passed).
update money.bills b
set next_due = case
  when x.this_month >= current_date then x.this_month
  else money.month_after(current_date, b.due_day)
end
from (
  select id,
         (date_trunc('month', current_date)::date
          + (least(due_day, extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day'))::int) - 1)) as this_month
  from money.bills where due_day is not null
) x
where x.id = b.id and b.next_due is null;

-- A bill was paid on p_on: move its next due date past it, a month at a time.
-- Returns the previous next_due (for Undo).
create or replace function money.advance_bill(p_bill_id uuid, p_on date)
returns date
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev date;
  v_day  int;
  v_next date;
begin
  select next_due, coalesce(due_day, extract(day from next_due)::int) into v_prev, v_day
  from money.bills where id = p_bill_id;
  if v_prev is null then
    return null;
  end if;
  v_next := money.month_after(v_prev, v_day);
  while v_next <= coalesce(p_on, current_date) loop
    v_next := money.month_after(v_next, v_day);
  end loop;
  update money.bills set next_due = v_next where id = p_bill_id;
  return v_prev;
end;
$$;

-- Pay several bills at once, all or nothing (replaces the 017 version).
-- Returns {"ids": [...], "pairs": [...], "due": [{"bill_id", "prev"}]} for Undo.
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
  v_prev  date;
  v_ids   uuid[] := '{}';
  v_pairs uuid[] := '{}';
  v_due   jsonb := '[]';
  v_on    date := coalesce(p_paid_on, current_date);
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Pick at least one bill.';
  end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(bill_id uuid, amount numeric) loop
    select b.id, b.name, b.kind, b.category_id, b.card_id, a.kind as account_kind
      into v_bill
    from money.bills b
    left join money.categories c on c.id = b.category_id
    left join money.accounts a on a.id = c.account_id
    where b.id = v_line.bill_id;
    if v_bill.id is null then
      raise exception 'A bill was not found. Reload and try again.';
    end if;
    if v_line.amount is null or v_line.amount <= 0 then
      raise exception 'The amount for % must be above 0.', v_bill.name;
    end if;

    if v_bill.kind = 'card_payment' then
      v_pair := money.pay_card(v_bill.card_id, round(v_line.amount, 2), v_on);
      update money.transactions set bill_id = v_bill.id where pair_id = v_pair;
      v_pairs := v_pairs || v_pair;
    else
      if v_bill.account_kind is distinct from 'cash' then
        raise exception '% needs a budget item in a bank account. Edit the bill and pick one.', v_bill.name;
      end if;
      if v_bill.card_id is not null then
        v_pair := money.card_spend(v_bill.category_id, v_bill.card_id, round(v_line.amount, 2), v_on, v_bill.name);
        update money.transactions set bill_id = v_bill.id where pair_id = v_pair;
        v_pairs := v_pairs || v_pair;
      else
        insert into money.transactions (category_id, amount, kind, note, occurred_on, bill_id)
        values (v_bill.category_id, -round(v_line.amount, 2), 'spend', v_bill.name, v_on, v_bill.id)
        returning id into v_id;
        v_ids := v_ids || v_id;
      end if;
    end if;

    v_prev := money.advance_bill(v_bill.id, v_on);
    if v_prev is not null then
      v_due := v_due || jsonb_build_object('bill_id', v_bill.id, 'prev', v_prev);
    end if;
  end loop;

  return jsonb_build_object('ids', to_jsonb(v_ids), 'pairs', to_jsonb(v_pairs), 'due', v_due);
end;
$$;

grant execute on function money.month_after(date, int) to authenticated;
grant execute on function money.advance_bill(uuid, date) to authenticated;
grant execute on function money.pay_bills(jsonb, date) to authenticated;
revoke execute on function money.advance_bill(uuid, date) from anon, public;
revoke execute on function money.pay_bills(jsonb, date) from anon, public;

notify pgrst, 'reload schema';
