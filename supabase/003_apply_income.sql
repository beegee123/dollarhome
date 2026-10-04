-- DollarHome, step 7: apply one paycheck or payout in ONE transaction.
-- Safe to re-run.
--
-- p_lines = this paycheck's split IN MONEY: [{"category_id": "...", "value": 1200}, ...]
-- (the app turns percentages into amounts first, and you can edit any line).
--
-- What gets written, all tied to one income_events row:
--   * a line in the account the money LANDS in  -> income into that budget item
--   * a line in ANOTHER account at the same bank -> income into the landing
--     account's Unassigned, then a transfer pair (- from there, + into the item)
--   * whatever the lines don't cover            -> income into the landing Unassigned
-- Undo = delete the income_events row; its transactions go with it (on delete cascade).

create or replace function money.apply_income(
  p_source_id    uuid,
  p_amount       numeric,
  p_received_on  date,
  p_note         text,
  p_lines        jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_landing     uuid;   -- account the money lands in
  v_bank        uuid;
  v_unassigned  uuid;   -- that account's Unassigned
  v_event       uuid;
  v_bad         int;
  v_total       numeric;
  v_line        record;
  v_pair        uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount received must be above 0.';
  end if;

  select s.account_id, a.bank_id into v_landing, v_bank
  from money.income_sources s
  join money.accounts a on a.id = s.account_id
  where s.id = p_source_id;
  if v_landing is null then
    raise exception 'That income source was not found.';
  end if;

  select id into v_unassigned
  from money.categories
  where account_id = v_landing and is_unassigned;

  -- Every line: a real budget item at the same bank, amount above 0.
  select count(*) into v_bad
  from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric)
  left join money.categories c on c.id = l.category_id
  left join money.accounts   a on a.id = c.account_id
  where c.id is null or a.bank_id <> v_bank or c.is_unassigned
     or l.value is null or l.value <= 0;
  if v_bad > 0 then
    raise exception 'Every split line must be a budget item at the same bank, with an amount above 0.';
  end if;

  select coalesce(sum(value), 0) into v_total
  from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric);
  if v_total > p_amount then
    raise exception 'The split adds up to % — more than the % received.', v_total, p_amount;
  end if;

  insert into money.income_events (source_id, amount, received_on, note)
  values (p_source_id, p_amount, coalesce(p_received_on, current_date), nullif(trim(p_note), ''))
  returning id into v_event;

  for v_line in
    select l.category_id, round(l.value, 2) as value, c.account_id
    from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric)
    join money.categories c on c.id = l.category_id
  loop
    if v_line.account_id = v_landing then
      insert into money.transactions (category_id, amount, kind, occurred_on, income_event_id)
      values (v_line.category_id, v_line.value, 'income', coalesce(p_received_on, current_date), v_event);
    else
      v_pair := gen_random_uuid();
      insert into money.transactions (category_id, amount, kind, occurred_on, income_event_id)
      values (v_unassigned, v_line.value, 'income', coalesce(p_received_on, current_date), v_event);
      insert into money.transactions (category_id, amount, kind, note, occurred_on, income_event_id, pair_id)
      values
        (v_unassigned,       -v_line.value, 'transfer', 'Paycheck split', coalesce(p_received_on, current_date), v_event, v_pair),
        (v_line.category_id,  v_line.value, 'transfer', 'Paycheck split', coalesce(p_received_on, current_date), v_event, v_pair);
    end if;
  end loop;

  if p_amount - v_total > 0 then
    insert into money.transactions (category_id, amount, kind, note, occurred_on, income_event_id)
    values (v_unassigned, round(p_amount - v_total, 2), 'income', 'Left over from split',
            coalesce(p_received_on, current_date), v_event);
  end if;

  return v_event;
end;
$$;

grant execute on function money.apply_income(uuid, numeric, date, text, jsonb) to authenticated;
revoke execute on function money.apply_income(uuid, numeric, date, text, jsonb) from anon, public;

-- Make the API see the new function straight away.
notify pgrst, 'reload schema';
