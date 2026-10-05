-- DollarHome: one running note (Bill notes on Setup). Safe to re-run.
--
-- Each person has at most one note: a single block of text they keep adding to.

create table if not exists money.notes (
  owner_id    uuid primary key default auth.uid()
              references auth.users (id) on delete cascade,
  body        text not null default '',
  updated_at  timestamptz not null default now()
);

alter table money.notes enable row level security;
drop policy if exists "own rows" on money.notes;
create policy "own rows" on money.notes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on money.notes to authenticated;

notify pgrst, 'reload schema';
