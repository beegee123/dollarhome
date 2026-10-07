// Income sources (Job A 1st, STR ...) and how each one is split.
import { supabase } from '../lib/supabase.js'

// Every income source, with where it lands and its split lines.
export async function fetchSources() {
  const { data, error } = await supabase
    .from('income_sources')
    .select(
      'id, name, split_type, expected_amount, sort_order, archived, account:accounts (id, name, bank:banks (id, name, currency)), lines:split_lines (category_id, value)',
    )
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data.map((s) => ({ ...s, expected_amount: s.expected_amount === null ? null : Number(s.expected_amount), lines: s.lines.map((l) => ({ ...l, value: Number(l.value) })) }))
}

// What the income source form needs: every active bank → account → budget item
// (to choose where money lands and which items it fills), plus the source being edited.
export async function fetchSourceForm(sourceId) {
  const [banks, accounts, items, source] = await Promise.all([
    supabase.from('banks').select('id, name, currency').eq('archived', false).order('sort_order').order('name'),
    // Paychecks land in bank accounts, never on a credit card.
    supabase.from('accounts').select('id, bank_id, name').eq('archived', false).eq('kind', 'cash').order('sort_order').order('name'),
    supabase
      .from('categories')
      .select('id, account_id, name, planned_amount')
      .eq('archived', false)
      .eq('is_unassigned', false)
      .order('sort_order')
      .order('name'),
    sourceId
      ? supabase
          .from('income_sources')
          .select('id, name, account_id, split_type, expected_amount, lines:split_lines (category_id, value)')
          .eq('id', sourceId)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])
  for (const r of [banks, accounts, items, source]) if (r.error) throw r.error

  return {
    banks: banks.data.map((b) => ({
      ...b,
      accounts: accounts.data
        .filter((a) => a.bank_id === b.id)
        .map((a) => ({
          ...a,
          items: items.data
            .filter((i) => i.account_id === a.id)
            .map((i) => ({ ...i, planned_amount: Number(i.planned_amount) })),
        })),
    })),
    source: source.data && {
      ...source.data,
      lines: source.data.lines.map((l) => ({ ...l, value: Number(l.value) })),
    },
  }
}

// Save a source and its lines in one go (the save_income_source database function).
export async function saveSource({ id, name, accountId, splitType, lines, expectedAmount = null }) {
  const { data, error } = await supabase.rpc('save_income_source', {
    p_id: id ?? null,
    p_name: name,
    p_account_id: accountId,
    p_split_type: splitType,
    p_lines: lines,
  })
  if (error) {
    if (error.code === '23505') throw new Error(`You already have an income source called “${name.trim()}”.`)
    throw error
  }
  // The usual amount is a plain column, saved right after the split.
  const { error: amountError } = await supabase
    .from('income_sources')
    .update({ expected_amount: expectedAmount })
    .eq('id', data)
  if (amountError) throw amountError
  return data
}

export async function setSourceArchived(id, archived) {
  const { error } = await supabase.from('income_sources').update({ archived }).eq('id', id)
  if (error) throw error
}

// ---- Step 7: Income in ----

// Apply one paycheck: income, leftover and transfers, all saved together.
// lines = [{ category_id, value }] in money (percentages already turned into amounts).
export async function applyIncome({ sourceId, amount, receivedOn, note, lines }) {
  const { data, error } = await supabase.rpc('apply_income', {
    p_source_id: sourceId,
    p_amount: amount,
    p_received_on: receivedOn,
    p_note: note ?? '',
    p_lines: lines,
  })
  if (error) throw error
  return data // the income event's id, used by Undo
}

// Undo a paycheck: deleting its income event deletes all its transactions too.
export async function undoIncome(eventId) {
  const { error } = await supabase.from('income_events').delete().eq('id', eventId)
  if (error) throw error
}

// ---- Step 10: this month's income, per source ----
// { [sourceId]: { total, count } } for paychecks received since the 1st of this month.
export async function fetchMonthIncome() {
  const now = new Date()
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const { data, error } = await supabase.from('income_events').select('source_id, amount').gte('received_on', first)
  if (error) throw error
  const totals = {}
  data.forEach((e) => {
    const key = e.source_id ?? 'none'
    totals[key] ??= { total: 0, count: 0 }
    totals[key].total += Number(e.amount)
    totals[key].count += 1
  })
  return totals
}
