-- DollarHome, step 13a: targets for budget items. Safe to re-run.
--
-- target_type 'monthly'  — planned_amount is what you aim to have each month (as before)
-- target_type 'by_date'  — planned_amount is a goal to save up to by target_date
--                          (a vacation, an emergency fund, a tax bill)

alter table money.categories
  add column if not exists target_type text not null default 'monthly',
  add column if not exists target_date date;

alter table money.categories drop constraint if exists categories_target_check;
alter table money.categories add constraint categories_target_check check (
  (target_type = 'monthly' and target_date is null)
  or (target_type = 'by_date' and target_date is not null)
);

-- Rebuild the balances view so it includes the new columns (c.* is fixed when a view is made).
drop view if exists money.category_balances;
create view money.category_balances
with (security_invoker = true) as
select
  c.*,
  coalesce(sum(t.amount), 0)::numeric(12,2) as balance
from money.categories c
left join money.transactions t on t.category_id = c.id
group by c.id;

grant select on money.category_balances to authenticated;
grant all on money.category_balances to service_role;

notify pgrst, 'reload schema';
