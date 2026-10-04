-- DollarHome, step 9: buying wishlist items, in one transaction each time.
-- Safe to re-run.

-- Mark items bought: each one becomes a spend from its own envelope (budget item),
-- and the wishlist item remembers the date and which spend it became.
create or replace function money.mark_bought(p_item_ids uuid[], p_bought_on date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item   record;
  v_tx     uuid;
  v_count  int := 0;
begin
  for v_item in
    select id, name, amount, category_id
    from money.wishlist_items
    where id = any (p_item_ids) and bought_at is null
  loop
    if v_item.category_id is null then
      raise exception '% has no envelope. Edit it and pick one first.', v_item.name;
    end if;

    insert into money.transactions (category_id, amount, kind, note, occurred_on)
    values (v_item.category_id, -v_item.amount, 'spend', v_item.name, coalesce(p_bought_on, current_date))
    returning id into v_tx;

    update money.wishlist_items
       set bought_at = now(), transaction_id = v_tx
     where id = v_item.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Put a bought item back on the wishlist, removing the spend it created.
create or replace function money.unbuy(p_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx uuid;
begin
  select transaction_id into v_tx from money.wishlist_items where id = p_item_id;
  update money.wishlist_items set bought_at = null, transaction_id = null where id = p_item_id;
  if v_tx is not null then
    delete from money.transactions where id = v_tx;
  end if;
end;
$$;

grant execute on function money.mark_bought(uuid[], date) to authenticated;
grant execute on function money.unbuy(uuid) to authenticated;
revoke execute on function money.mark_bought(uuid[], date) from anon, public;
revoke execute on function money.unbuy(uuid) from anon, public;

notify pgrst, 'reload schema';
