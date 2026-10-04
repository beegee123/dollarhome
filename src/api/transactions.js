// Reading and writing transactions (every change to a budget item's balance).
import { supabase } from '../lib/supabase.js'

// Log money spent from one budget item. Spending is stored as a NEGATIVE amount,
// so a balance is always just "add up the transactions".
export async function logSpend({ categoryId, amount, note, occurredOn }) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      category_id: categoryId,
      amount: -Math.abs(amount),
      kind: 'spend',
      note: note?.trim() || null,
      occurred_on: occurredOn,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// The most recent transactions for one budget item, newest first.
export async function fetchRecent(categoryId, limit = 5) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, kind, note, occurred_on, created_at')
    .eq('category_id', categoryId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data.map((t) => ({ ...t, amount: Number(t.amount) }))
}

// Remove one transaction (used by Undo).
export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}
