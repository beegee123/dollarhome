// Reading and writing transactions (every change to a budget item's balance).
import { supabase } from '../lib/supabase.js'

// Log money spent from one budget item. Spending is stored as a NEGATIVE amount,
// so a balance is always just "add up the transactions".
export async function logSpend({ categoryId, amount, note, occurredOn, billId = null }) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      category_id: categoryId,
      amount: -Math.abs(amount),
      kind: 'spend',
      note: note?.trim() || null,
      occurred_on: occurredOn,
      ...(billId ? { bill_id: billId } : {}), // marks the bill Paid on the Bills screen
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
    .select('pair_id, amount, kind, occurred_on, created_at, category_id, income_event_id')
    .gt('created_at', since)
    .not('pair_id', 'is', null)
  if (error) throw error

  // Look up each budget item's account separately (an embed is ambiguous: the two tables
  // link in both directions).
  const catIds = [...new Set(data.map((t) => t.category_id))]
  const catAccount = new Map()
  const accountName = new Map()
  if (catIds.length) {
    const { data: cats, error: e2 } = await supabase.from('categories').select('id, account_id').in('id', catIds)
    if (e2) throw e2
    for (const c of cats) catAccount.set(c.id, c.account_id)
    const accIds = [...new Set(cats.map((c) => c.account_id))]
    const { data: accs, error: e3 } = await supabase
      .from('accounts')
      .select('id, name, bank:banks (name)')
      .in('id', accIds)
    if (e3) throw e3
    for (const a of accs) accountName.set(a.id, a.bank?.name ? `${a.bank.name} ${a.name}` : a.name)
  }

  const pairs = new Map()
  for (const t of data) {
    const p = pairs.get(t.pair_id) ?? { pairId: t.pair_id, eventId: t.income_event_id ?? null, net: 0, kind: t.kind, date: t.occurred_on, created: t.created_at, others: new Set(), kinds: new Set() }
    p.kinds.add(t.kind)
    const acc = catAccount.get(t.category_id)
    if (acc === accountId) {
      p.net += Number(t.amount)
    } else if (acc) {
      p.others.add(accountName.get(acc) ?? 'another account')
    }
    pairs.set(t.pair_id, p)
  }
  // A paycheck split sends one transfer per budget item, but at the bank it's one transfer
  // per account. Fold a paycheck's transfers to (or from) the same account into one row.
  const grouped = new Map()
  for (const p of pairs.values()) {
    if (!p.eventId) {
      grouped.set(p.pairId, p)
      continue
    }
    const key = `e:${p.eventId}:${[...p.others].sort().join('|')}`
    const g = grouped.get(key)
    if (g) g.net += p.net
    else grouped.set(key, { ...p, pairId: key, paycheck: true })
  }

  const list = [...grouped.values()]
    .map((p) => ({ ...p, net: Math.round(p.net * 100) / 100 }))
    .filter((p) => p.net !== 0)
    .sort((a, b) => (a.created < b.created ? 1 : -1))
    .map((p) => ({
      key: p.pairId,
      pairId: p.pairId,
      net: p.net,
      date: p.date,
      label: p.kinds.has('card_payment')
        ? 'Paid a credit card'
        : p.paycheck
          ? `Paycheck ${p.net > 0 ? 'from' : 'to'} ${[...p.others].join(', ') || 'another account'}`
          : p.others.size
          ? `${p.net > 0 ? 'From' : 'To'} ${[...p.others].join(', ')}`
          : 'Move',
    }))

  const activity = await fetchActivitySince(accountId, since)
  return { since, hadCheck: !!acct.balance_checked_at, list, activity }
}

// Spends and income logged in one account since a time (not moves: those are above).
// Each paycheck is one row (its lines added up); each spend is its own row.
async function fetchActivitySince(accountId, since) {
  const { data: cats, error: e1 } = await supabase.from('categories').select('id, name').eq('account_id', accountId)
  if (e1) throw e1
  if (!cats.length) return []
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, kind, note, occurred_on, created_at, category_id, income_event_id')
    .in('category_id', cats.map((c) => c.id))
    .in('kind', ['spend', 'income'])
    .is('pair_id', null)
    .gt('created_at', since)
  if (error) throw error

  // Paycheck names, if any income came in.
  const eventIds = [...new Set(data.filter((t) => t.income_event_id).map((t) => t.income_event_id))]
  const eventName = new Map()
  if (eventIds.length) {
    const { data: events } = await supabase
      .from('income_events')
      .select('id, note, source:income_sources (name)')
      .in('id', eventIds)
    for (const ev of events ?? []) eventName.set(ev.id, ev.source?.name || ev.note || 'Income')
  }

  const rows = new Map()
  for (const t of data) {
    const key = t.kind === 'income' && t.income_event_id ? `e:${t.income_event_id}` : `t:${t.id}`
    const row =
      rows.get(key) ??
      {
        key,
        net: 0,
        date: t.occurred_on,
        created: t.created_at,
        label:
          t.kind === 'income'
            ? `In · ${eventName.get(t.income_event_id) ?? t.note ?? 'Income'}`
            : `Spent · ${t.note || catName.get(t.category_id) || 'spend'}`,
      }
    row.net += Number(t.amount)
    rows.set(key, row)
  }
  return [...rows.values()]
    .map((r) => ({ ...r, net: Math.round(r.net * 100) / 100 }))
    .filter((r) => r.net !== 0)
    .sort((a, b) => (a.created < b.created ? 1 : -1))
}

// ---- Activity: everything logged in one month, across every account ----

// One month's transactions and paychecks, plus the names to label them (archived ones too).
// Supabase sends at most 1,000 rows at a time, so it keeps asking until a page comes back short.
export async function fetchActivity(month) {
  const first = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  const page = async (build) => {
    const out = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build().range(from, from + 999)
      if (error) throw error
      out.push(...data)
      if (data.length < 1000) return out
    }
  }
  const [banks, accounts, categories, sources, transactions, events] = await Promise.all([
    supabase.from('banks').select('id, name, currency, sort_order, archived').order('sort_order').order('name'),
    supabase.from('accounts').select('id, bank_id, name, kind'),
    supabase.from('categories').select('id, account_id, name, is_unassigned'),
    supabase.from('income_sources').select('id, name, account_id'),
    page(() =>
      supabase
        .from('transactions')
        .select('id, category_id, amount, kind, note, occurred_on, created_at, pair_id, income_event_id, debt_id')
        .gte('occurred_on', first)
        .lt('occurred_on', next)
        .order('occurred_on')
        .order('id'),
    ),
    page(() => supabase.from('income_events').select('id, source_id, amount, received_on, note, created_at').gte('received_on', first).lt('received_on', next).order('received_on').order('id')),
  ])
  for (const r of [banks, accounts, categories, sources]) if (r.error) throw r.error
  return {
    banks: banks.data,
    lookups: {
      banks: Object.fromEntries(banks.data.map((b) => [b.id, b])),
      accounts: Object.fromEntries(accounts.data.map((a) => [a.id, { name: a.name, kind: a.kind, bankId: a.bank_id }])),
      cats: Object.fromEntries(categories.data.map((c) => [c.id, { name: c.name, accountId: c.account_id, isUnassigned: c.is_unassigned }])),
      sources: Object.fromEntries(sources.data.map((s) => [s.id, { name: s.name, accountId: s.account_id }])),
    },
    transactions: transactions.map((t) => ({ ...t, amount: Number(t.amount) })),
    events: events.map((e) => ({ ...e, amount: Number(e.amount) })),
  }
}

// Delete one Activity row: a paycheck (its split goes with it), pairs, or single rows.
// Returns what Undo needs to put the exact rows back, or null when it can't be undone here.
export async function deleteActivity(del) {
  if (del.debtPayment) {
    // A loan or tax payment: unpay_debt also puts the amount back on what's owed.
    const { error } = await supabase.rpc('unpay_debt', { p_transaction_id: del.debtPayment })
    if (error) throw new Error(error.message)
    return null
  }
  if (del.eventId) {
    const [ev, tx] = await Promise.all([
      supabase.from('income_events').select('*').eq('id', del.eventId).single(),
      supabase.from('transactions').select('*').eq('income_event_id', del.eventId),
    ])
    if (ev.error) throw ev.error
    if (tx.error) throw tx.error
    const { error } = await supabase.from('income_events').delete().eq('id', del.eventId)
    if (error) throw error
    return { event: ev.data, rows: tx.data }
  }
  const query = del.pairs ? supabase.from('transactions').select('*').in('pair_id', del.pairs) : supabase.from('transactions').select('*').in('id', del.ids)
  const { data: rows, error: readError } = await query
  if (readError) throw readError
  const { error } = del.pairs
    ? await supabase.from('transactions').delete().in('pair_id', del.pairs)
    : await supabase.from('transactions').delete().in('id', del.ids)
  if (error) throw error
  return { rows }
}

// Undo a deleteActivity: the same rows, same ids, back in place.
export async function restoreActivity(saved) {
  if (saved.event) {
    const { error } = await supabase.from('income_events').insert(saved.event)
    if (error) throw error
  }
  if (saved.rows.length) {
    const { error } = await supabase.from('transactions').insert(saved.rows)
    if (error) throw error
  }
}
