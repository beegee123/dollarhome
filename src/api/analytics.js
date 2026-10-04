// Analytics reads what you've already logged — nothing new is stored.
import { supabase } from '../lib/supabase.js'

// Everything since `since` (YYYY-MM-DD), plus the names needed to label it.
// Archived banks/accounts/items are included so old history still has names.
export async function fetchAnalytics(since) {
  const [banks, accounts, categories, spends, events, sources, wishes, balances] = await Promise.all([
    supabase.from('banks').select('id, name, currency, sort_order, archived').order('sort_order').order('name'),
    supabase.from('accounts').select('id, bank_id, name'),
    supabase.from('categories').select('id, account_id, name, planned_amount, is_unassigned, archived'),
    supabase.from('transactions').select('category_id, amount, occurred_on').eq('kind', 'spend').gte('occurred_on', since),
    supabase.from('income_events').select('source_id, amount, received_on').gte('received_on', since),
    supabase.from('income_sources').select('id, name, account_id'),
    supabase.from('wishlist_items').select('name, amount, category_id').is('bought_at', null),
    supabase.from('category_balances').select('id, balance'),
  ])
  for (const r of [banks, accounts, categories, spends, events, sources, wishes, balances]) if (r.error) throw r.error

  const num = (rows, ...keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }))
  return {
    banks: banks.data,
    accounts: accounts.data,
    categories: num(categories.data, 'planned_amount'),
    spends: num(spends.data, 'amount'),
    events: num(events.data, 'amount'),
    sources: sources.data,
    wishes: num(wishes.data, 'amount'),
    balances: Object.fromEntries(balances.data.map((b) => [b.id, Number(b.balance)])),
  }
}
