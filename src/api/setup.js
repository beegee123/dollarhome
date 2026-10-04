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
      .select('id, bank_id, name, bank_balance, balance_checked_at, sort_order, archived')
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

// One account, its bank, and its budget items with balances (archived ones too).
// Unassigned is left out: it's built in and can't be renamed or archived.
export async function fetchAccountItems(accountId) {
  const [account, items] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name, bank:banks (id, name, currency)') // "bank:banks (...)" = also fetch its bank
      .eq('id', accountId)
      .single(),
    supabase
      .from('category_balances')
      .select('id, name, planned_amount, sort_order, archived, balance')
      .eq('account_id', accountId)
      .eq('is_unassigned', false)
      .order('sort_order')
      .order('name'),
  ])
  if (account.error) throw account.error
  if (items.error) throw items.error
  return {
    account: account.data,
    items: items.data.map((i) => ({ ...i, planned_amount: Number(i.planned_amount), balance: Number(i.balance) })),
  }
}

export async function addItem({ accountId, name, plannedAmount, sortOrder }) {
  const { error } = await supabase.from('categories').insert({
    account_id: accountId,
    name: name.trim(),
    planned_amount: plannedAmount,
    sort_order: sortOrder,
  })
  if (error) throw friendly(error, `This account already has a budget item called “${name.trim()}”.`)
}

// Rename, change the plan, archive or restore one budget item.
export async function updateItem(id, changes) {
  const { error } = await supabase.from('categories').update(changes).eq('id', id)
  if (error) throw friendly(error, 'This account already has a budget item with that name.')
}
