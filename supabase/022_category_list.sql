-- DollarHome: categories become a list you keep (Setup → Categories). Safe to re-run.
--
--   category_groups        → your list: name and order (renaming one renames it everywhere)
--   categories.group_id    → each budget item's category (none = "Other" in Analytics)
--
-- Categories typed under 021 move into the list and items keep them. Anyone with no
-- list yet gets a starter list, which can be renamed, reordered or deleted.

-- First run? (The starter list is only added then, so deleted ones don't come back.)
drop table if exists pg_temp.first_run_022;
do $$
begin
  if to_regclass('money.category_groups') is null then
    create temp table first_run_022 (x int);
  end if;
end;
$$;

create table if not exists money.category_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 40),
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists category_groups_unique_name on money.category_groups (owner_id, lower(trim(name)));

alter table money.category_groups enable row level security;
drop policy if exists "own rows" on money.category_groups;
create policy "own rows" on money.category_groups for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on money.category_groups to authenticated;

-- Deleting a category leaves its items with none ("Other").
alter table money.categories
  add column if not exists group_id uuid references money.category_groups (id) on delete set null;
create index if not exists categories_by_group on money.categories (group_id) where group_id is not null;

-- 1. On the first run, a starter list for each person (names they already have are skipped).
insert into money.category_groups (owner_id, name, sort_order)
select o.owner_id, s.name, s.n
from (select distinct owner_id from money.banks) o
cross join (values
  (1, 'Housing'), (2, 'Utilities'), (3, 'Food'), (4, 'Transport'), (5, 'Insurance'),
  (6, 'Debt & cards'), (7, 'Giving'), (8, 'Rental property'), (9, 'Savings & goals'),
  (10, 'Personal'), (11, 'Family')
) as s(n, name)
where to_regclass('pg_temp.first_run_022') is not null
on conflict do nothing;

drop table if exists pg_temp.first_run_022;

-- 2. Categories typed under 021 (ones matching the starter list join it) → the list, and items point at them. Then the text column goes.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'money' and table_name = 'categories' and column_name = 'category_group') then
    insert into money.category_groups (owner_id, name, sort_order)
    select owner_id, min(trim(category_group)), 100
    from money.categories
    where category_group is not null and trim(category_group) <> ''
    group by owner_id, lower(trim(category_group))
    on conflict do nothing;

    update money.categories c
    set group_id = g.id
    from money.category_groups g
    where g.owner_id = c.owner_id
      and lower(trim(g.name)) = lower(trim(c.category_group))
      and c.group_id is null;

    alter table money.categories drop column category_group;
  end if;
end;
$$;


notify pgrst, 'reload schema';
