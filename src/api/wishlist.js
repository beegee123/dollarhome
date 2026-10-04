// Wishlist: things you mean to buy, each linked to one envelope (budget item).
import { supabase } from '../lib/supabase.js'

export async function fetchWishlist() {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('id, name, amount, category_id, note, sort_order, bought_at, created_at')
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return data.map((w) => ({ ...w, amount: Number(w.amount) }))
}

export async function addWish({ name, amount, categoryId, note, sortOrder }) {
  const { error } = await supabase.from('wishlist_items').insert({
    name: name.trim(),
    amount,
    category_id: categoryId,
    note: note?.trim() || null,
    sort_order: sortOrder,
  })
  if (error) throw error
}

export async function updateWish(id, { name, amount, categoryId, note }) {
  const { error } = await supabase
    .from('wishlist_items')
    .update({ name: name.trim(), amount, category_id: categoryId, note: note?.trim() || null })
    .eq('id', id)
  if (error) throw error
}

// A wishlist item isn't money, so it can simply be deleted.
export async function deleteWish(id) {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id)
  if (error) throw error
}

// Each selected item becomes a spend from its envelope (database function, all or nothing).
export async function markBought(itemIds, boughtOn) {
  const { error } = await supabase.rpc('mark_bought', { p_item_ids: itemIds, p_bought_on: boughtOn })
  if (error) throw error
}

// Back on the wishlist; its spend is removed.
export async function unbuy(itemId) {
  const { error } = await supabase.rpc('unbuy', { p_item_id: itemId })
  if (error) throw error
}
