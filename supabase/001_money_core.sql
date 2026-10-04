-- DollarHome, step 2: core tables
-- Runs in the SAME Supabase project as Pantry and Daily Docket.
-- Everything lives in its own "money" schema so it never collides with
-- the other apps' tables (Pantry already has a "categories" table).
-- Safe to re-run: every statement checks before creating.
--
-- How the money is organised:
--   banks (a tab: RBC, Truist)
--     -> accounts (a section: Checking, Savings)
--       -> categories (the budget items / envelopes: Rent, Groceries ...)
-- Balances are never typed in. A category's balance is the sum of its
-- transactions, so the numbers always add up.

create schema if not exists money;

-- Let the API roles see the schema. Tables are granted at the bottom.
grant usage on schema money to anon, authenticated, service_role;


-- ---------------------------------------------------------------
-- Banks: one per real bank. Each keeps its own currency; the app
-- never adds USD and CAD together.
-- ---------------------------------------------------------------
create table if not exists money.banks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  currency    text not null default 'USD' check (currency in ('USD', 'CAD')),
  sort_order  int  not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);


-- ---------------------------------------------------------------
-- Accounts: Checking, Savings ... inside a bank.
-- bank_balance is what YOUR BANK says, typed in when you check it.
-- The app compares it with the sum of the account's categories.
-- ---------------------------------------------------------------
create table if not exists money.accounts (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  bank_id             uuid not null references money.banks (id) on delete cascade,
  name                text not null check (char_length(trim(name)) between 1 and 40),
  bank_balance        numeric(12,2) not null default 0,
  balance_checked_at  timestamptz,
  sort_order          int  not null default 0,
  archived            boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (bank_id, name)
);


-- ---------------------------------------------------------------
-- Categories: the budget items (envelopes). Each belongs to one account.
-- planned_amount sets how full the bar looks; it never moves money.
-- Every account gets exactly one built-in "Unassigned" category
-- (is_unassigned = true), created automatically below.
-- ---------------------------------------------------------------
create table if not exists money.categories (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  account_id      uuid not null references money.accounts (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 40),
  planned_amount  numeric(12,2) not null default 0 check (planned_amount >= 0),
  is_unassigned   boolean not null default false,
  sort_order      int  not null default 0,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (account_id, name)
);

-- At most one Unassigned per account.
create unique index if not exists categories_one_unassigned
  on money.categories (account_id) where is_unassigned;

-- When an account is created, give it its Unassigned category.
create or replace function money.add_unassigned_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into money.categories (owner_id, account_id, name, is_unassigned, sort_order)
  values (new.owner_id, new.id, 'Unassigned', true, -1);
  return new;
end;
$$;

drop trigger if exists accounts_add_unassigned on money.accounts;
create trigger accounts_add_unassigned
  after insert on money.accounts
  for each row execute function money.add_unassigned_category();


-- ---------------------------------------------------------------
-- Income sources: Job A 1st, Job B, STR ...
-- account_id = the account the money lands in.
-- split_type: 'fixed' (dollar amounts) or 'percent' (shares of 100).
-- ---------------------------------------------------------------
create table if not exists money.income_sources (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  account_id  uuid not null references money.accounts (id) on delete cascade,
  split_type  text not null default 'fixed' check (split_type in ('fixed', 'percent')),
  sort_order  int  not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);


-- ---------------------------------------------------------------
-- Split lines: how one income source is divided.
-- value = dollars for a fixed split, percent for a percent split.
-- The category must be at the same bank as the source's account
-- (no cross-bank splits); the app checks this in step 6.
-- ---------------------------------------------------------------
create table if not exists money.split_lines (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  source_id    uuid not null references money.income_sources (id) on delete cascade,
  category_id  uuid not null references money.categories (id) on delete cascade,
  value        numeric(12,2) not null check (value > 0),
  unique (source_id, category_id)
);


-- ---------------------------------------------------------------
-- Income events: one row per paycheck or payout received.
-- Its transactions (one per split line, plus any leftover to
-- Unassigned) point back here.
-- ---------------------------------------------------------------
create table if not exists money.income_events (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  source_id    uuid references money.income_sources (id) on delete set null,
  amount       numeric(12,2) not null check (amount > 0),
  received_on  date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------
-- Transactions: every change to a category's balance, ever.
--   income   money in from a paycheck (positive)
--   spend    money out (negative)
--   move     between two categories, same currency (a pair: - and +)
--   transfer between accounts or banks (a pair; amounts can differ,
--            e.g. -$500 at Truist and +C$688 at RBC)
--   opening  the starting balance on day one (lands in Unassigned)
-- pair_id links the two halves of a move or transfer.
-- ---------------------------------------------------------------
create table if not exists money.transactions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,
  category_id      uuid not null references money.categories (id) on delete restrict,
  amount           numeric(12,2) not null check (amount <> 0),
  kind             text not null
                   check (kind in ('income', 'spend', 'move', 'transfer', 'opening')),
  note             text,
  occurred_on      date not null default current_date,
  income_event_id  uuid references money.income_events (id) on delete cascade,
  pair_id          uuid,
  created_at       timestamptz not null default now()
);

create index if not exists transactions_by_category
  on money.transactions (category_id);
create index if not exists transactions_by_owner_date
  on money.transactions (owner_id, occurred_on);


-- ---------------------------------------------------------------
-- Wishlist: things you mean to buy, each linked to one envelope.
-- When bought, bought_at is set and transaction_id points at the spend.
-- ---------------------------------------------------------------
create table if not exists money.wishlist_items (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 80),
  amount          numeric(12,2) not null check (amount > 0),
  category_id     uuid references money.categories (id) on delete set null,
  note            text,
  sort_order      int  not null default 0,
  bought_at       timestamptz,
  transaction_id  uuid references money.transactions (id) on delete set null,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------
-- Balances: each category with its current balance (sum of its
-- transactions). security_invoker = the view obeys the same
-- row-level security as the tables, so you only see your own rows.
-- ---------------------------------------------------------------
create or replace view money.category_balances
with (security_invoker = true) as
select
  c.*,
  coalesce(sum(t.amount), 0)::numeric(12,2) as balance
from money.categories c
left join money.transactions t on t.category_id = c.id
group by c.id;


-- ---------------------------------------------------------------
-- Row-level security: everyone sees and changes ONLY their own rows.
-- One policy per table covers read, add, change and delete.
-- ---------------------------------------------------------------
alter table money.banks          enable row level security;
alter table money.accounts       enable row level security;
alter table money.categories     enable row level security;
alter table money.income_sources enable row level security;
alter table money.split_lines    enable row level security;
alter table money.income_events  enable row level security;
alter table money.transactions   enable row level security;
alter table money.wishlist_items enable row level security;

drop policy if exists "own rows" on money.banks;
drop policy if exists "own rows" on money.accounts;
drop policy if exists "own rows" on money.categories;
drop policy if exists "own rows" on money.income_sources;
drop policy if exists "own rows" on money.split_lines;
drop policy if exists "own rows" on money.income_events;
drop policy if exists "own rows" on money.transactions;
drop policy if exists "own rows" on money.wishlist_items;

create policy "own rows" on money.banks          for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.accounts       for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.categories     for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.income_sources for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.split_lines    for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.income_events  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.transactions   for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows" on money.wishlist_items for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));


-- ---------------------------------------------------------------
-- Grants: signed-in users may use the tables (RLS above still decides
-- WHICH rows). Nobody signed out can touch anything.
-- ---------------------------------------------------------------
grant select, insert, update, delete on all tables in schema money to authenticated;
grant all on all tables in schema money to service_role;

alter default privileges in schema money
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema money
  grant all on tables to service_role;
