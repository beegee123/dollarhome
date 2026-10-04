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
    .select('id, amount, kind, note, occurred_on, created_at, pair_id')
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

// ---- Step 8: moving money ----

// A new random id for a pair. crypto.randomUUID only works on https or localhost,
// so on a phone testing over your Wi-Fi (http://192.168…) we build one by hand.
function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// Every move is a PAIR of transactions sharing one pair_id: minus from one
// budget item, plus to another. Both rows go in ONE insert, so they're saved
// together or not at all.
//   kind 'move'     — between items in the same account (nothing changes at the bank)
//   kind 'transfer' — between accounts; you also move the money in your bank.
//                     Between banks, sent and received can differ (USD → CAD, fees).
export async function moveMoney({ fromId, toId, sent, received, kind, note, occurredOn }) {
  const pairId = newId()
  const shared = { kind, note: note?.trim() || null, occurred_on: occurredOn, pair_id: pairId }
  const { error } = await supabase.from('transactions').insert([
    { ...shared, category_id: fromId, amount: -Math.abs(sent) },
    { ...shared, category_id: toId, amount: Math.abs(received ?? sent) },
  ])
  if (error) throw error
  return pairId
}

// Assign: spread one account's Unassigned across its budget items.
// allocations = [{ categoryId, amount }] — one 'move' pair each, all in one insert.
export async function assignFromUnassigned({ unassignedId, allocations, occurredOn }) {
  const rows = []
  const pairIds = []
  for (const a of allocations) {
    const pairId = newId()
    pairIds.push(pairId)
    const shared = { kind: 'move', note: 'Assigned', occurred_on: occurredOn, pair_id: pairId }
    rows.push({ ...shared, category_id: unassignedId, amount: -a.amount })
    rows.push({ ...shared, category_id: a.categoryId, amount: a.amount })
  }
  const { error } = await supabase.from('transactions').insert(rows)
  if (error) throw error
  return pairIds
}

// Undo a move, transfer or assign: delete every transaction in those pairs.
export async function deletePairs(pairIds) {
  const { error } = await supabase.from('transactions').delete().in('pair_id', pairIds)
  if (error) throw error
}
