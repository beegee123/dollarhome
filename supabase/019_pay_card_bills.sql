-- DollarHome: pay a card's bills in one go. Safe to re-run.
--
-- Bills charged to a credit card (kind 'spend' with a card) each come from their own
-- budget item. On the card's due date, one tap:
--   1. logs each chosen bill as a card spend (its envelope → the card's payment envelope)
--   2. pays the card the total from the payment envelope
--   3. marks the card's card-payment bill (if it has one) paid and moves its due date on
-- All or nothing. Returns the same Undo shape as pay_bills.

create or replace function money.pay_card_bills(p_card_id uuid, p_lines jsonb, p_paid_on date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_res   jsonb;
  v_total numeric;
  v_pair  uuid;
  v_bill  uuid;
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
    where b.id is null or b.kind <> 'spend' or b.card_id is distinct from p_card_id
  ) then
    raise exception 'Only bills charged to this card can be paid together.';
  end if;

  select round(sum(amount), 2) into v_total from jsonb_to_recordset(p_lines) as x(bill_id uuid, amount numeric);

  -- 1. each bill: its envelope → the card's payment envelope (and its due date moves on)
  v_res := money.pay_bills(p_lines, v_on);

  -- 2. pay the card that total
  v_pair := money.pay_card(p_card_id, v_total, v_on);

  -- 3. the card's own bill, if it has one
  select id into v_bill from money.bills where kind = 'card_payment' and card_id = p_card_id limit 1;
  if v_bill is not null then
    update money.transactions set bill_id = v_bill where pair_id = v_pair;
    v_prev := money.advance_bill(v_bill, v_on);
    if v_prev is not null then
      v_res := jsonb_set(v_res, '{due}', (v_res->'due') || jsonb_build_object('bill_id', v_bill, 'prev', v_prev));
    end if;
  end if;

  return jsonb_set(v_res, '{pairs}', (v_res->'pairs') || to_jsonb(v_pair));
end;
$$;

grant execute on function money.pay_card_bills(uuid, jsonb, date) to authenticated;
revoke execute on function money.pay_card_bills(uuid, jsonb, date) from anon, public;

notify pgrst, 'reload schema';
