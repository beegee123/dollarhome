-- DollarHome: a card's payment due date and monthly payment live on the card. Safe to re-run.
--
--   accounts.payment_due      → when the card's payment is next due (cards only)
--   accounts.payment_day      → the day of the month it falls on (kept so the 31st stays the 31st)
--   accounts.monthly_payment  → what you pay toward the balance each month on top of the
--                               bills charged to it (e.g. a payment plan); optional
--
-- The "card payment" bill type is retired: each card-payment bill's date and amount move
-- onto its card, then the bill is removed (past payments stay; they just lose the bill tag).
-- Paying the card (Pay card, or Log & pay) moves its due date on a month.

alter table money.accounts add column if not exists payment_due date;
alter table money.accounts add column if not exists payment_day int;
alter table money.accounts add column if not exists monthly_payment numeric(12, 2);
alter table money.accounts drop constraint if exists accounts_payment_day_check;
alter table money.accounts add constraint accounts_payment_day_check check (payment_day between 1 and 31);
alter table money.accounts drop constraint if exists accounts_monthly_payment_check;
alter table money.accounts add constraint accounts_monthly_payment_check check (monthly_payment >= 0);

-- 1. Card-payment bills → their card (only where the card has nothing set yet).
update money.accounts a
set payment_due     = coalesce(a.payment_due, b.next_due),
    payment_day     = coalesce(a.payment_day, b.due_day, extract(day from b.next_due)::int),
    monthly_payment = coalesce(a.monthly_payment, b.amount)
from (
  select distinct on (card_id) card_id, next_due, due_day, amount
  from money.bills
  where kind = 'card_payment' and card_id is not null
  order by card_id, next_due nulls last
) b
where a.id = b.card_id and a.kind = 'credit';

-- 2. Retire the bill type.
delete from money.bills where kind = 'card_payment';
alter table money.bills drop constraint if exists bills_kind_check;
alter table money.bills add constraint bills_kind_check check (kind = 'spend');

-- The card was paid on p_on: move its due date past it, a month at a time.
-- Returns the previous due date (for Undo), or null if the card has none.
create or replace function money.advance_card_due(p_card_id uuid, p_on date)
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
  select payment_due, coalesce(payment_day, extract(day from payment_due)::int) into v_prev, v_day
  from money.accounts where id = p_card_id and kind = 'credit';
  if v_prev is null then
    return null;
  end if;
  v_next := money.month_after(v_prev, v_day);
  while v_next <= coalesce(p_on, current_date) loop
    v_next := money.month_after(v_next, v_day);
  end loop;
  update money.accounts set payment_due = v_next where id = p_card_id;
  return v_prev;
end;
$$;

-- Pay a card's bills in one go (replaces the 019 version):
--   1. logs each chosen bill as a card spend (its envelope → the card's payment envelope)
--   2. pays the card p_pay_amount from the payment envelope (default: the bills' total;
--      the app suggests the bills plus the card's monthly payment)
--   3. moves the card's due date on
-- All or nothing. Returns {"ids", "pairs", "due": [{"bill_id"|"card_id", "prev"}]} for Undo.
drop function if exists money.pay_card_bills(uuid, jsonb, date);

create or replace function money.pay_card_bills(p_card_id uuid, p_lines jsonb, p_paid_on date, p_pay_amount numeric default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_res   jsonb;
  v_total numeric;
  v_pay   numeric;
  v_pair  uuid;
  v_prev  date;
  v_on    date := coalesce(p_paid_on, current_date);
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Pick at least one bill.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as x(bill_id uuid, amount numeric)
    left join money.bills b on b.id = x.bill_id
    where b.id is null or b.card_id is distinct from p_card_id
  ) then
    raise exception 'Only bills charged to this card can be paid together.';
  end if;

  select round(sum(amount), 2) into v_total from jsonb_to_recordset(p_lines) as x(bill_id uuid, amount numeric);
  v_pay := round(coalesce(p_pay_amount, v_total), 2);
  if v_pay <= 0 then
    raise exception 'The card payment must be above 0.';
  end if;

  -- 1. each bill: its envelope → the card's payment envelope (and its due date moves on)
  v_res := money.pay_bills(p_lines, v_on);

  -- 2. pay the card
  v_pair := money.pay_card(p_card_id, v_pay, v_on);

  -- 3. the card's due date
  v_prev := money.advance_card_due(p_card_id, v_on);
  if v_prev is not null then
    v_res := jsonb_set(v_res, '{due}', (v_res->'due') || jsonb_build_object('card_id', p_card_id, 'prev', v_prev));
  end if;

  return jsonb_set(v_res, '{pairs}', (v_res->'pairs') || to_jsonb(v_pair));
end;
$$;

grant execute on function money.advance_card_due(uuid, date) to authenticated;
grant execute on function money.pay_card_bills(uuid, jsonb, date, numeric) to authenticated;
revoke execute on function money.advance_card_due(uuid, date) from anon, public;
revoke execute on function money.pay_card_bills(uuid, jsonb, date, numeric) from anon, public;

notify pgrst, 'reload schema';
