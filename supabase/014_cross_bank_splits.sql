-- DollarHome: income splits can reach other banks of the SAME currency. Safe to re-run.
--
-- Before: every split line had to be at the bank the money lands in.
-- Now:    any budget item in a bank account (not a card) whose bank uses the
--         same currency, e.g. a payout landing at RBC can fill a Scotia item.
-- A line outside the landing account is still recorded as income into the
-- landing Unassigned plus a transfer pair. Between banks the note says
-- "bank-to-bank" so the app can remind you to send it (takes 1-3 days).
-- USD and CAD never mix.

create or replace function money.save_income_source(
  p_id          uuid,
  p_name        text,
  p_account_id  uuid,
  p_split_type  text,
  p_lines       jsonb
)
returns uuid
language plpgsql
security invoker          -- runs as the signed-in person, so row-level security still applies
set search_path = ''
as $$
declare
  v_id     uuid;
  v_currency text;
  v_bad    int;
  v_total  numeric;
begin
  select b.currency into v_currency
  from money.accounts a join money.banks b on b.id = a.bank_id
  where a.id = p_account_id;
  if v_currency is null then
    raise exception 'That account was not found.';
  end if;

  select count(*) into v_bad
  from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric)
  left join money.categories c on c.id = l.category_id
  left join money.accounts   a on a.id = c.account_id
  left join money.banks      b on b.id = a.bank_id
  where c.id is null or b.currency <> v_currency or a.kind <> 'cash' or c.is_unassigned
     or l.value is null or l.value <= 0;
  if v_bad > 0 then
    raise exception 'Every split line must be a budget item in a bank account of the same currency, with an amount above 0.';
  end if;

  if p_split_type = 'percent' then
    select coalesce(sum(value), 0) into v_total
    from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric);
    if v_total <> 100 then
      raise exception 'Percentages must add up to 100 (they add up to %).', v_total;
    end if;
  end if;

  if p_id is null then
    insert into money.income_sources (name, account_id, split_type, sort_order)
    values (
      trim(p_name), p_account_id, p_split_type,
      coalesce((select max(sort_order) + 1 from money.income_sources), 0)
    )
    returning id into v_id;
  else
    update money.income_sources
       set name = trim(p_name), account_id = p_account_id, split_type = p_split_type
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That income source was not found.';
    end if;
  end if;

  -- Replace the split lines with the new set.
  delete from money.split_lines where source_id = v_id;
  insert into money.split_lines (source_id, category_id, value)
  select v_id, l.category_id, l.value
  from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric);

  return v_id;
end;
$$;

grant execute on function money.save_income_source(uuid, text, uuid, text, jsonb) to authenticated;
revoke execute on function money.save_income_source(uuid, text, uuid, text, jsonb) from anon, public;

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
  v_currency    text;
  v_unassigned  uuid;   -- that account's Unassigned
  v_event       uuid;
  v_bad         int;
  v_total       numeric;
  v_line        record;
  v_pair        uuid;
  v_note        text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount received must be above 0.';
  end if;

  select s.account_id, b.currency into v_landing, v_currency
  from money.income_sources s
  join money.accounts a on a.id = s.account_id
  join money.banks    b on b.id = a.bank_id
  where s.id = p_source_id;
  if v_landing is null then
    raise exception 'That income source was not found.';
  end if;

  select id into v_unassigned
  from money.categories
  where account_id = v_landing and is_unassigned;

  -- Every line: a real budget item in a same-currency bank account, amount above 0.
  select count(*) into v_bad
  from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric)
  left join money.categories c on c.id = l.category_id
  left join money.accounts   a on a.id = c.account_id
  left join money.banks      b on b.id = a.bank_id
  where c.id is null or b.currency <> v_currency or a.kind <> 'cash' or c.is_unassigned
     or l.value is null or l.value <= 0;
  if v_bad > 0 then
    raise exception 'Every split line must be a budget item in a bank account of the same currency, with an amount above 0.';
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
      v_note := case
        when (select bank_id from money.accounts where id = v_line.account_id)
           = (select bank_id from money.accounts where id = v_landing)
        then 'Paycheck split' else 'Paycheck split (bank-to-bank)' end;
      insert into money.transactions (category_id, amount, kind, occurred_on, income_event_id)
      values (v_unassigned, v_line.value, 'income', coalesce(p_received_on, current_date), v_event);
      insert into money.transactions (category_id, amount, kind, note, occurred_on, income_event_id, pair_id)
      values
        (v_unassigned,       -v_line.value, 'transfer', v_note, coalesce(p_received_on, current_date), v_event, v_pair),
        (v_line.category_id,  v_line.value, 'transfer', v_note, coalesce(p_received_on, current_date), v_event, v_pair);
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

notify pgrst, 'reload schema';
