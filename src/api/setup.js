// Setup: banks and accounts — adding, renaming, reordering, archiving,
// and recording what your bank says an account holds.
import { supabase } from '../lib/supabase.js'

// Postgres error 23505 = "that would break a unique rule" (a duplicate name).
// Turn it into a sentence a person can act on.
function friendly(error, duplicateMessage) {
  if (error.code === '23505') return new Error(duplicateMessage)
  return error
}

// Every bank with its accounts, archived ones included (the screen shows them separately).
export async function fetchSetup() {
  const [banks, accounts] = await Promise.all([
    supabase.from('banks').select('id, name, currency, sort_order, archived').order('sort_order').order('name'),
    supabase
      .from('accounts')
      .select('id, bank_id, name, kind, bank_balance, balance_checked_at, sort_order, archived')
      .order('sort_order')
      .order('name'),
  ])
  if (banks.error) throw banks.error
  if (accounts.error) throw accounts.error

  return banks.data.map((bank) => ({
    ...bank,
    accounts: accounts.data
      .filter((a) => a.bank_id === bank.id)
      .map((a) => ({ ...a, bank_balance: Number(a.bank_balance) })),
  }))
}

export async function addBank({ name, currency, sortOrder }) {
  const { error } = await supabase.from('banks').insert({ name: name.trim(), currency, sort_order: sortOrder })
  if (error) throw friendly(error, `You already have a bank called “${name.trim()}”.`)
}

// A new account starts with today's real balance. That money goes into the
// account's Unassigned (created automatically by the database), as an
// "opening" transaction — so the account Matches its bank from day one.
export async function addAccount({ bankId, name, startingBalance, sortOrder }) {
  const { data: account, error } = await supabase
    .from('accounts')
    .insert({
      bank_id: bankId,
      name: name.trim(),
      bank_balance: startingBalance,
      balance_checked_at: new Date().toISOString(),
      sort_order: sortOrder,
    })
    .select('id')
    .single()
  if (error) throw friendly(error, `This bank already has an account called “${name.trim()}”.`)

  if (startingBalance !== 0) {
    const { data: unassigned, error: findError } = await supabase
      .from('categories')
      .select('id')
      .eq('account_id', account.id)
      .eq('is_unassigned', true)
      .single()
    if (findError) throw findError

    const { error: txError } = await supabase.from('transactions').insert({
      category_id: unassigned.id,
      amount: startingBalance,
      kind: 'opening',
      note: 'Starting balance',
    })
    if (txError) throw txError
  }
}

// Rename, archive or restore one bank or account.
//   table   — 'banks' or 'accounts'
//   changes — e.g. { name: 'Chase' } or { archived: true }
export async function updateRow(table, id, changes) {
  const { error } = await supabase.from(table).update(changes).eq('id', id)
  if (error) {
    throw friendly(error, `That name is already used${table === 'accounts' ? ' at this bank' : ''}.`)
  }
}

// Swap the order of two neighbours (the ↑ / ↓ buttons). Works for banks, accounts and categories.
export async function swapOrder(table, first, second) {
  const results = await Promise.all([
    supabase.from(table).update({ sort_order: second.sort_order }).eq('id', first.id),
    supabase.from(table).update({ sort_order: first.sort_order }).eq('id', second.id),
  ])
  const failed = results.find((r) => r.error)
  if (failed) throw failed.error
}

// Record what your bank's app says this account holds right now.
// It does NOT move money between budget items; it's what the match check compares against.
export async function setBankBalance(accountId, amount) {
  const { error } = await supabase
    .from('accounts')
    .update({ bank_balance: amount, balance_checked_at: new Date().toISOString() })
    .eq('id', accountId)
  if (error) throw error
}

// ---- Step 5b: budget items (the "categories" table) ----

// One account (with its bank and its sibling accounts, for reordering) and its budget
// items with balances, archived ones too. Unassigned is returned separately: it's
// built in and can't be renamed or archived, but it counts toward the account's total.
export async function fetchAccountItems(accountId) {
  const { data: account, error } = await supabase
    .from('accounts')
    .select('id, bank_id, name, kind, payment_category_id, bank_balance, balance_checked_at, sort_order, archived, bank:banks (id, name, currency)')
    .eq('id', accountId)
    .single()
  if (error) throw error

  const [items, siblings] = await Promise.all([
    supabase
      .from('category_balances')
      .select('id, name, planned_amount, target_type, target_date, sort_order, archived, is_unassigned, balance')
      .eq('account_id', accountId)
      .order('sort_order')
      .order('name'),
    supabase
      .from('accounts')
      .select('id, sort_order')
      .eq('bank_id', account.bank_id)
      .eq('archived', false)
      .order('sort_order')
      .order('name'),
  ])
  if (items.error) throw items.error
  if (siblings.error) throw siblings.error

  const all = items.data.map((i) => ({ ...i, planned_amount: Number(i.planned_amount), balance: Number(i.balance) }))
  return {
    account: { ...account, bank_balance: Number(account.bank_balance) },
    unassigned: all.find((i) => i.is_unassigned)?.balance ?? 0,
    total: all.reduce((sum, i) => sum + i.balance, 0), // everything DollarHome holds here
    items: all.filter((i) => !i.is_unassigned),
    siblings: siblings.data,
  }
}

export async function addItem({ accountId, name, plannedAmount, targetType = 'monthly', targetDate = null, sortOrder }) {
  const { error } = await supabase.from('categories').insert({
    account_id: accountId,
    name: name.trim(),
    planned_amount: plannedAmount,
    target_type: targetType,
    target_date: targetType === 'by_date' ? targetDate : null,
    sort_order: sortOrder,
  })
  if (error) throw friendly(error, `This account already has a budget item called “${name.trim()}”.`)
}

// Rename, change the plan, archive or restore one budget item.
export async function updateItem(id, changes) {
  const { error } = await supabase.from('categories').update(changes).eq('id', id)
  if (error) throw friendly(error, 'This account already has a budget item with that name.')
}

// ---- Step 11: first launch ----

// Delete ALL of your DollarHome data (database function; your rows only).
export async function startFresh() {
  const { error } = await supabase.rpc('start_fresh')
  if (error) throw error
}

// Keep the setup, clear all activity, start each account again from its bank balance.
export async function restartBalances() {
  const { error } = await supabase.rpc('restart_balances')
  if (error) throw error
}

// Delete one bank and everything under it.
export async function deleteBank(bankId) {
  const { error } = await supabase.rpc('delete_bank', { p_bank_id: bankId })
  if (error) throw error
}

// ---- Step 15: move a budget item to another account (it brings its money and history) ----
// Returns { balance, from_account, to_account, removed_from_splits: [source names] }.
export async function moveItem(itemId, toAccountId) {
  const { data, error } = await supabase.rpc('move_category', { p_category_id: itemId, p_to_account_id: toAccountId })
  if (error) throw error
  return data
}

// Bring DollarHome into line with the bank: record the bank's number AND add the
// difference to the account's Unassigned as an adjustment.
//   change — how much to add to Unassigned (negative takes money out)
// For a credit card the Unassigned is the card's ledger (minus what it owes),
// so the screen passes the change already turned the right way round.
export async function adjustToBank(accountId, bankBalance, change) {
  const { data: unassigned, error: findError } = await supabase
    .from('categories')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_unassigned', true)
    .single()
  if (findError) throw findError

  if (Math.round(change * 100) !== 0) {
    const { error } = await supabase.from('transactions').insert({
      category_id: unassigned.id,
      amount: Math.round(change * 100) / 100,
      kind: 'opening', // an adjustment, like a starting balance: not income, not spending
      note: 'Adjusted to match bank',
    })
    if (error) throw error
  }
  await setBankBalance(accountId, bankBalance)
}
