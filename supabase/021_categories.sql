-- DollarHome: one category per budget item (e.g. Utilities, Food, Housing). Safe to re-run.
--
-- Picked or typed on the budget item's edit screen (Setup → the account → the item).
-- Analytics adds spending and plans up by category; items without one show as "Other".
-- A plain text column: categories exist as long as some item uses them.

alter table money.categories add column if not exists category_group text;
alter table money.categories drop constraint if exists categories_category_group_check;
alter table money.categories add constraint categories_category_group_check
  check (category_group is null or (length(trim(category_group)) between 1 and 40));

notify pgrst, 'reload schema';
