-- DollarHome: interest on loan payments. Safe to re-run.
--
-- A debt can have an annual interest rate (e.g. 6.5 = 6.5% a year).
-- A payment can say how much of it was interest. The envelope pays the whole
-- payment; what's owed only goes down by the principal (payment − interest).

alter table money.debts
  add column if not exists annual_rate numeric(6,3);
alter table money.debts drop constraint if exists debts_annual_rate_check;
alter table money.debts add constraint debts_annual_rate_check
  check (annual_rate is null or (annual_rate >= 0 and annual_rate <= 100));

alter table money.transactions
  add column if not exists interest numeric(12,2) not null default 0;
alter table money.transactions drop constraint if exists transactions_interest_check;
alter table money.transactions add constraint transactions_interest_check check (interest >= 0);

-- pay_debt gains p_interest. The old 4-argument version is dropped first so
-- there's only one pay_debt to call.
drop function if exists money.pay_debt(uuid, numeric, date, text);

create or replace function money.pay_debt(
  p_debt_id uuid, p_amount numeric, p_paid_on date, p_note text, p_interest numeric default 0)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_debt       record;
  v_tx         uuid;
  v_interest   numeric := coalesce(p_interest, 0);
  v_principal  numeric;
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
  if v_interest < 0 or v_interest > p_amount then
    raise exception 'Interest must be between 0 and the payment.';
  end if;
  v_principal := p_amount - v_interest;

  insert into money.transactions (category_id, amount, kind, note, occurred_on, debt_id, interest)
  values (v_debt.category_id, -p_amount, 'spend',
          coalesce(nullif(trim(p_note), ''), 'Payment: ' || v_debt.name),
          coalesce(p_paid_on, current_date), v_debt.id, round(v_interest, 2))
  returning id into v_tx;

  update money.debts
     set amount_owed = greatest(0, amount_owed - v_principal),
         paid_off_at = case when amount_owed - v_principal <= 0 then now() else null end
   where id = v_debt.id;

  return v_tx;
end;
$$;

-- Undo: put back only the principal that payment took off.
create or replace function money.unpay_debt(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx record;
begin
  select id, amount, interest, debt_id into v_tx from money.transactions where id = p_transaction_id;
  if v_tx.id is null or v_tx.debt_id is null then
    raise exception 'That payment was not found.';
  end if;
  update money.debts
     set amount_owed = amount_owed + (-v_tx.amount - v_tx.interest), paid_off_at = null
   where id = v_tx.debt_id;
  delete from money.transactions where id = v_tx.id;
end;
$$;

grant execute on function money.pay_debt(uuid, numeric, date, text, numeric) to authenticated;
revoke execute on function money.pay_debt(uuid, numeric, date, text, numeric) from anon, public;

notify pgrst, 'reload schema';
