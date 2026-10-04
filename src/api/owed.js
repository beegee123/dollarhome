// Owed: loans and tax bills, each paid from an envelope.
import { supabase } from '../lib/supabase.js'

export async function fetchDebts() {
  const { data, error } = await supabase
    .from('debts')
    .select('id, name, kind, currency, category_id, original_amount, amount_owed, due_date, paid_off_at, sort_order, created_at')
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return data.map((d) => ({ ...d, original_amount: Number(d.original_amount), amount_owed: Number(d.amount_owed) }))
}

export async function addDebt({ name, kind, currency, categoryId, originalAmount, amountOwed, dueDate, sortOrder }) {
  const { error } = await supabase.from('debts').insert({
    name: name.trim(),
    kind,
    currency,
    category_id: categoryId,
    original_amount: originalAmount,
    amount_owed: amountOwed,
    due_date: dueDate || null,
    paid_off_at: amountOwed === 0 ? new Date().toISOString() : null,
    sort_order: sortOrder,
  })
  if (error) throw error
}

// Edit details, or "Update owed" (e.g. interest was added). Reaching 0 marks it paid off.
export async function updateDebt(id, changes) {
  const patch = { ...changes }
  if ('amount_owed' in patch) patch.paid_off_at = patch.amount_owed === 0 ? new Date().toISOString() : null
  const { error } = await supabase.from('debts').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteDebt(id) {
  const { error } = await supabase.from('debts').delete().eq('id', id)
  if (error) throw error
}

// A payment: a spend from the envelope + the amount owed goes down (one transaction).
export async function payDebt({ debtId, amount, paidOn, note }) {
  const { data, error } = await supabase.rpc('pay_debt', {
    p_debt_id: debtId,
    p_amount: amount,
    p_paid_on: paidOn,
    p_note: note ?? '',
  })
  if (error) throw error
  return data // the payment's transaction id
}

export async function unpayDebt(transactionId) {
  const { error } = await supabase.rpc('unpay_debt', { p_transaction_id: transactionId })
  if (error) throw error
}
