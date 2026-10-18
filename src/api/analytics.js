// Analytics reads what you've already logged — nothing new is stored.
import { supabase } from '../lib/supabase.js'

// Supabase hands back at most 1,000 rows at a time: keep asking until a page comes back short.
async function allRows(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

// Everything since `since` (YYYY-MM-DD), plus the names needed to label it.
// Archived banks/accounts/items are included so old history still has names.
export async function fetchAnalytics(since) {
  const catCols = 'id, account_id, name, planned_amount, target_type, target_date, is_unassigned, archived'
  const [banks, accounts, categories, groups, transactions, events, sources, wishes, balances, debts, interest] = await Promise.all([
    supabase.from('banks').select('id, name, currency, sort_order, archived').order('sort_order').order('name'),
    supabase.from('accounts').select('id, bank_id, name, kind, payment_category_id'),
    // With each item's category (022_category_list.sql); before that runs, without it.
    supabase
      .from('categories')
      .select(`${catCols}, group_id`)
      .then((r) => (r.error ? supabase.from('categories').select(catCols) : r)),
    supabase.from('category_groups').select('id, name, sort_order').order('sort_order').order('name'),
    allRows(() =>
      supabase
        .from('transactions')
        .select('id, category_id, amount, kind, occurred_on')
        .gte('occurred_on', since)
        .order('occurred_on')
        .order('id'),
    ),
    allRows(() => supabase.from('income_events').select('id, source_id, amount, received_on').gte('received_on', since).order('received_on').order('id')),
    supabase.from('income_sources').select('id, name, account_id'),
    supabase.from('wishlist_items').select('name, amount, category_id').is('bought_at', null),
    supabase.from('category_balances').select('id, balance'),
    supabase.from('debts').select('name, kind, currency, original_amount, amount_owed, due_date').is('paid_off_at', null),
    // Interest paid on loans, with each debt's currency.
    supabase.from('transactions').select('interest, occurred_on, debt:debts (currency)').not('debt_id', 'is', null).gt('interest', 0),
  ])
  for (const r of [banks, accounts, categories, sources, wishes, balances, debts, interest]) if (r.error) throw r.error

  const num = (rows, ...keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }))
  return {
    banks: banks.data,
    accounts: accounts.data,
    categories: num(categories.data, 'planned_amount'),
    groups: groups.error ? [] : groups.data,
    transactions: num(transactions, 'amount'),
    events: num(events, 'amount'),
    sources: sources.data,
    wishes: num(wishes.data, 'amount'),
    balances: Object.fromEntries(balances.data.map((b) => [b.id, Number(b.balance)])),
    debts: num(debts.data, 'original_amount', 'amount_owed'),
    interest: interest.data.map((t) => ({ amount: Number(t.interest), date: t.occurred_on, currency: t.debt?.currency })),
  }
}
