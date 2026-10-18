// Your list of categories (Utilities, Food…), each budget item picks one (supabase/022_category_list.sql).
import { supabase } from '../lib/supabase.js'

export const STARTER = ['Housing', 'Utilities', 'Food', 'Transport', 'Insurance', 'Debt & cards', 'Giving', 'Rental property', 'Savings & goals', 'Personal', 'Family']

const duplicate = (error, name) =>
  error.code === '23505' ? new Error(`You already have a category called “${name.trim()}”.`) : error

// The list in order, each with how many budget items use it.
export async function fetchGroups() {
  const [groups, items] = await Promise.all([
    supabase.from('category_groups').select('id, name, sort_order').order('sort_order').order('name'),
    supabase.from('categories').select('group_id').not('group_id', 'is', null).eq('archived', false),
  ])
  if (groups.error) throw groups.error
  if (items.error) throw items.error
  const used = {}
  items.data.forEach((i) => (used[i.group_id] = (used[i.group_id] ?? 0) + 1))
  return groups.data.map((g) => ({ ...g, used: used[g.id] ?? 0 }))
}

export async function addGroup(name, sortOrder) {
  const { error } = await supabase.from('category_groups').insert({ name: name.trim(), sort_order: sortOrder })
  if (error) throw duplicate(error, name)
}

export async function renameGroup(id, name) {
  const { error } = await supabase.from('category_groups').update({ name: name.trim() }).eq('id', id)
  if (error) throw duplicate(error, name)
}

// Its budget items are left with no category ("Other").
export async function deleteGroup(id) {
  const { error } = await supabase.from('category_groups').delete().eq('id', id)
  if (error) throw error
}

// An empty list: add the starter categories (any you already have are skipped).
export async function addStarterGroups(existing = []) {
  const have = new Set(existing.map((g) => g.name.toLowerCase()))
  const rows = STARTER.filter((n) => !have.has(n.toLowerCase())).map((name, i) => ({ name, sort_order: existing.length + i + 1 }))
  if (rows.length === 0) return
  const { error } = await supabase.from('category_groups').insert(rows)
  if (error) throw error
}
