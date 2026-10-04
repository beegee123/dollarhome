-- DollarHome, step 6: save an income source and its split lines in ONE transaction.
-- If anything is wrong, nothing is saved (no half-saved splits).
-- Safe to re-run.
--
-- p_id         null = new source; otherwise the source to update
-- p_split_type 'fixed' (dollars) or 'percent'
-- p_lines      [{"category_id": "...", "value": 600}, ...]
--
-- Rules checked here, so they hold no matter what the app sends:
--   * every line is a budget item (not Unassigned) at the SAME BANK as the
--     account the money lands in — no cross-bank splits
--   * every value is above 0
--   * percentages add up to exactly 100

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
  v_bank   uuid;
  v_bad    int;
  v_total  numeric;
begin
  select bank_id into v_bank from money.accounts where id = p_account_id;
  if v_bank is null then
    raise exception 'That account was not found.';
  end if;

  select count(*) into v_bad
  from jsonb_to_recordset(p_lines) as l(category_id uuid, value numeric)
  left join money.categories c on c.id = l.category_id
  left join money.accounts   a on a.id = c.account_id
  where c.id is null or a.bank_id <> v_bank or c.is_unassigned
     or l.value is null or l.value <= 0;
  if v_bad > 0 then
    raise exception 'Every split line must be a budget item at the same bank, with an amount above 0.';
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
