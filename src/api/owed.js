// Owed: loans and tax bills, each paid from an envelope.
import { supabase } from '../lib/supabase.js'

export async function fetchDebts() {
  const { data, error } = await supabase
    .from('debts')
    .select('id, name, kind, currency, category_id, original_amount, amount_owed, annual_rate, due_date, paid_off_at, sort_order, created_at')
    .order('sort_order')
    .order('created_at')
  if (error) throw error

  // Interest paid per debt: all time, and this calendar year.
  const { data: pays, error: payError } = await supabase
    .from('transactions')
    .select('debt_id, interest, occurred_on')
    .not('debt_id', 'is', null)
    .gt('interest', 0)
  if (payError) throw payError
  const year = String(new Date().getFullYear())
  const interest = {}
  pays.forEach((p) => {
    interest[p.debt_id] ??= { total: 0, thisYear: 0 }
    interest[p.debt_id].total += Number(p.interest)
    if (p.occurred_on.startsWith(year)) interest[p.debt_id].thisYear += Number(p.interest)
  })

  return data.map((d) => ({
    ...d,
    original_amount: Number(d.original_amount),
    amount_owed: Number(d.amount_owed),
    annual_rate: d.annual_rate === null ? null : Number(d.annual_rate),
    interest: interest[d.id] ?? { total: 0, thisYear: 0 },
  }))
}

export async function addDebt({ name, kind, currency, categoryId, originalAmount, amountOwed, dueDate, annualRate, sortOrder }) {
  const { error } = await supabase.from('debts').insert({
    annual_rate: annualRate ?? null,
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
// interest = the part of the payment that was interest (the rest lowers what's owed).
export async function payDebt({ debtId, amount, paidOn, note, interest = 0 }) {
  const { data, error } = await supabase.rpc('pay_debt', {
    p_debt_id: debtId,
    p_amount: amount,
    p_paid_on: paidOn,
    p_note: note ?? '',
    p_interest: interest,
  })
  if (error) throw error
  return data // the payment's transaction id
}

export async function unpayDebt(transactionId) {
  const { error } = await supabase.rpc('unpay_debt', { p_transaction_id: transactionId })
  if (error) throw error
}
