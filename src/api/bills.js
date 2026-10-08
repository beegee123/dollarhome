// Bills: a saved list of regular bills (supabase/017_bills.sql).
import { supabase } from '../lib/supabase.js'

// Every bill, plus the date each was last paid (from spends tagged with the bill).
export async function fetchBills() {
  const [bills, paid] = await Promise.all([
    supabase
      .from('bills')
      .select('id, name, category_id, amount, card_id, due_day, sort_order')
      .order('sort_order')
      .order('name'),
    supabase
      .from('transactions')
      .select('bill_id, occurred_on')
      .not('bill_id', 'is', null)
      .eq('kind', 'spend')
      .order('occurred_on', { ascending: false })
      .limit(2000),
  ])
  if (bills.error) throw bills.error
  if (paid.error) throw paid.error
  const lastPaid = {}
  for (const t of paid.data) lastPaid[t.bill_id] ??= t.occurred_on
  return bills.data.map((b) => ({ ...b, amount: Number(b.amount), lastPaid: lastPaid[b.id] ?? null }))
}

export async function addBill({ name, categoryId, amount, cardId, dueDay, sortOrder }) {
  const { error } = await supabase.from('bills').insert({
    name: name.trim(),
    category_id: categoryId,
    amount,
    card_id: cardId || null,
    due_day: dueDay || null,
    sort_order: sortOrder,
  })
  if (error) throw error
}

export async function updateBill(id, { name, categoryId, amount, cardId, dueDay }) {
  const { error } = await supabase
    .from('bills')
    .update({ name: name.trim(), category_id: categoryId, amount, card_id: cardId || null, due_day: dueDay || null })
    .eq('id', id)
  if (error) throw error
}

// Past spends stay; they just stop being linked to the bill.
export async function deleteBill(id) {
  const { error } = await supabase.from('bills').delete().eq('id', id)
  if (error) throw error
}

// Log the chosen bills as spends, all or nothing. lines: [{ billId, amount }]
// Returns what Undo needs: { ids, pairs }.
export async function payBills(lines, paidOn) {
  const { data, error } = await supabase.rpc('pay_bills', {
    p_lines: lines.map((l) => ({ bill_id: l.billId, amount: l.amount })),
    p_paid_on: paidOn,
  })
  if (error) throw new Error(error.message)
  return data
}

// Undo a payBills: remove the plain spends and every row of each card spend.
export async function unpayBills({ ids = [], pairs = [] }) {
  if (ids.length) {
    const { error } = await supabase.from('transactions').delete().in('id', ids)
    if (error) throw error
  }
  if (pairs.length) {
    const { error } = await supabase.from('transactions').delete().in('pair_id', pairs)
    if (error) throw error
  }
}

// Save the "Set up bills" grid in one go.
//   inserts: [{ name, categoryId, amount, cardId, dueDay, sortOrder }]
//   updates: [{ id, name, categoryId, amount, cardId, dueDay }]
//   deleteIds: bills whose amount was cleared (their past spends stay)
export async function saveBillsBulk({ inserts = [], updates = [], deleteIds = [] }) {
  if (inserts.length) {
    const { error } = await supabase.from('bills').insert(
      inserts.map((b) => ({
        name: b.name.trim(),
        category_id: b.categoryId,
        amount: b.amount,
        card_id: b.cardId || null,
        due_day: b.dueDay || null,
        sort_order: b.sortOrder,
      })),
    )
    if (error) throw error
  }
  for (const b of updates) await updateBill(b.id, b)
  if (deleteIds.length) {
    const { error } = await supabase.from('bills').delete().in('id', deleteIds)
    if (error) throw error
  }
}
