-- DollarHome: remember each income source's usual amount. Safe to re-run.
--
-- Used by the split editor to show "Left to allocate" without retyping,
-- and to pre-fill Income in for fixed paychecks. Optional (blank = not set).

alter table money.income_sources
  add column if not exists expected_amount numeric(12,2);
alter table money.income_sources drop constraint if exists income_sources_expected_amount_check;
alter table money.income_sources add constraint income_sources_expected_amount_check
  check (expected_amount is null or expected_amount > 0);

notify pgrst, 'reload schema';
