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

// Moves, transfers and card payments that touched one account since its balance was last
// updated. Each comes back as ONE row with the net effect on this account, so ticking it
// in the balance sheet can add or subtract exactly that amount. Moves that stay inside
// the account (net zero) are left out.
export async function fetchMovesSinceCheck(accountId) {
  const { data: acct, error: e1 } = await supabase
    .from('accounts')
    .select('balance_checked_at')
    .eq('id', accountId)
    .single()
  if (e1) throw e1
  const since = acct.balance_checked_at ?? new Date(Date.now() - 14 * 86400000).toISOString()

  const { data, error } = await supabase
    .from('transactions')
    .select('pair_id, amount, kind, occurred_on, created_at, category:categories (account_id, account:accounts (name, bank:banks (name)))')
    .gt('created_at', since)
    .not('pair_id', 'is', null)
  if (error) throw error

  const pairs = new Map()
  for (const t of data) {
    const p = pairs.get(t.pair_id) ?? { pairId: t.pair_id, net: 0, kind: t.kind, date: t.occurred_on, created: t.created_at, others: new Set(), kinds: new Set() }
    p.kinds.add(t.kind)
    if (t.category?.account_id === accountId) {
      p.net += Number(t.amount)
    } else if (t.category?.account) {
      const a = t.category.account
      p.others.add(a.bank?.name ? `${a.bank.name} ${a.name}` : a.name)
    }
    pairs.set(t.pair_id, p)
  }
  const list = [...pairs.values()]
    .map((p) => ({ ...p, net: Math.round(p.net * 100) / 100 }))
    .filter((p) => p.net !== 0)
    .sort((a, b) => (a.created < b.created ? 1 : -1))
    .map((p) => ({
      pairId: p.pairId,
      net: p.net,
      date: p.date,
      label: p.kinds.has('card_payment')
        ? 'Paid a credit card'
        : p.others.size
          ? `${p.net > 0 ? 'From' : 'To'} ${[...p.others].join(', ')}`
          : 'Move',
    }))
  return { since, hadCheck: !!acct.balance_checked_at, list }
}
