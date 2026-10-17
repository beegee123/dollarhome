// Bills: a saved list of regular bills (supabase/017_bills.sql, 018_bill_types.sql).
//   kind 'spend'        — a spend from a budget item (maybe paid with a card)
//   kind 'card_payment' — pays a credit card from its payment envelope
//   next_due            — when it's next due; moves forward a month each time it's paid
import { supabase } from '../lib/supabase.js'

const PAID_KINDS = ['spend', 'card_payment']
const dayOf = (iso) => (iso ? Number(iso.slice(8, 10)) : null)

// Every bill, plus the date each was last paid (from transactions tagged with the bill).
export async function fetchBills() {
  const [bills, paid] = await Promise.all([
    supabase
      .from('bills')
      .select('id, name, kind, category_id, amount, card_id, due_day, next_due, sort_order')
      .order('sort_order')
      .order('name'),
    supabase
      .from('transactions')
      .select('bill_id, occurred_on')
      .not('bill_id', 'is', null)
      .in('kind', PAID_KINDS)
      .order('occurred_on', { ascending: false })
      .limit(2000),
  ])
  if (bills.error) throw bills.error
  if (paid.error) throw paid.error
  const lastPaid = {}
  for (const t of paid.data) lastPaid[t.bill_id] ??= t.occurred_on
  return bills.data.map((b) => ({ ...b, kind: b.kind ?? 'spend', amount: Number(b.amount), lastPaid: lastPaid[b.id] ?? null }))
}

// The columns for one bill. Card payments have no budget item and always use their card.
function row({ name, kind = 'spend', categoryId, amount, cardId, nextDue }) {
  return {
    name: name.trim(),
    kind,
    category_id: kind === 'card_payment' ? null : categoryId,
    amount,
    card_id: cardId || null,
    next_due: nextDue || null,
    due_day: dayOf(nextDue),
  }
}

export async function addBill(fields) {
  const { error } = await supabase.from('bills').insert({ ...row(fields), sort_order: fields.sortOrder })
  if (error) throw error
}

export async function updateBill(id, fields) {
  const { error } = await supabase.from('bills').update(row(fields)).eq('id', id)
  if (error) throw error
}

// Quick changes from the Bills list (just the amount, or just the due date).
export async function setBillAmount(id, amount) {
  const { error } = await supabase.from('bills').update({ amount }).eq('id', id)
  if (error) throw error
}
export async function setBillDue(id, nextDue) {
  const { error } = await supabase.from('bills').update({ next_due: nextDue || null, due_day: dayOf(nextDue) }).eq('id', id)
  if (error) throw error
}

// Past payments stay; they just stop being linked to the bill.
export async function deleteBill(id) {
  const { error } = await supabase.from('bills').delete().eq('id', id)
  if (error) throw error
}

// Log the chosen bills, all or nothing. lines: [{ billId, amount }]
// Returns what Undo needs: { ids, pairs, due }.
export async function payBills(lines, paidOn) {
  const { data, error } = await supabase.rpc('pay_bills', {
    p_lines: lines.map((l) => ({ bill_id: l.billId, amount: l.amount })),
    p_paid_on: paidOn,
  })
  if (error) throw new Error(error.message)
  return data
}

// Undo a payBills: remove its transactions and put each bill's due date back.
export async function unpayBills({ ids = [], pairs = [], due = [] }) {
  if (ids.length) {
    const { error } = await supabase.from('transactions').delete().in('id', ids)
    if (error) throw error
  }
  if (pairs.length) {
    const { error } = await supabase.from('transactions').delete().in('pair_id', pairs)
    if (error) throw error
  }
  for (const d of due) await setBillDue(d.bill_id, d.prev)
}

// A bill was paid outside the Bills screen (Quick spend, Pay card): move its due date on.
// Returns the previous due date (or null).
export async function advanceBill(billId, paidOn) {
  const { data, error } = await supabase.rpc('advance_bill', { p_bill_id: billId, p_on: paidOn })
  if (error) throw error
  return data
}

// Save the "Set up bills" grid in one go (spend bills only).
//   inserts: [{ name, categoryId, amount, cardId, nextDue, sortOrder }]
//   updates: [{ id, name, categoryId, amount, cardId, nextDue }]
//   deleteIds: bills whose amount was cleared (their past spends stay)
export async function saveBillsBulk({ inserts = [], updates = [], deleteIds = [] }) {
  if (inserts.length) {
    const { error } = await supabase.from('bills').insert(inserts.map((b) => ({ ...row(b), sort_order: b.sortOrder })))
    if (error) throw error
  }
  for (const b of updates) await updateBill(b.id, b)
  if (deleteIds.length) {
    const { error } = await supabase.from('bills').delete().in('id', deleteIds)
    if (error) throw error
  }
}

// The spend bills that come from one budget item (for pre-filling Quick spend), with last paid.
export async function fetchBillsForItem(categoryId) {
  const [bills, paid] = await Promise.all([
    supabase
      .from('bills')
      .select('id, name, amount, card_id, next_due')
      .eq('category_id', categoryId)
      .eq('kind', 'spend')
      .order('sort_order')
      .order('name'),
    supabase
      .from('transactions')
      .select('bill_id, occurred_on')
      .eq('category_id', categoryId)
      .eq('kind', 'spend')
      .not('bill_id', 'is', null)
      .order('occurred_on', { ascending: false })
      .limit(200),
  ])
  if (bills.error) throw bills.error
  if (paid.error) throw paid.error
  const lastPaid = {}
  for (const t of paid.data) lastPaid[t.bill_id] ??= t.occurred_on
  return bills.data.map((b) => ({ ...b, amount: Number(b.amount), lastPaid: lastPaid[b.id] ?? null }))
}

// The card-payment bill for a card, if there is one (so Pay card can mark it paid).
export async function fetchCardBill(cardId) {
  const { data, error } = await supabase
    .from('bills')
    .select('id, name, amount, next_due')
    .eq('kind', 'card_payment')
    .eq('card_id', cardId)
    .limit(1)
  if (error) throw error
  return data[0] ?? null
}

// Tag a pair of transactions (card spend or card payment) with the bill it paid.
export async function tagPairWithBill(pairId, billId) {
  const { error } = await supabase.from('transactions').update({ bill_id: billId }).eq('pair_id', pairId)
  if (error) throw error
}

// Pay a card's bills in one go: each from its own envelope, then the card the total.
// lines: [{ billId, amount }] — all charged to cardId. Returns { ids, pairs, due } for Undo.
export async function payCardBills(cardId, lines, paidOn) {
  const { data, error } = await supabase.rpc('pay_card_bills', {
    p_card_id: cardId,
    p_lines: lines.map((l) => ({ bill_id: l.billId, amount: l.amount })),
    p_paid_on: paidOn,
  })
  if (error) throw new Error(error.message)
  return data
}
