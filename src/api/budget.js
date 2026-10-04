// Everything the Budget screen needs, loaded in one go and shaped as
//   banks → accounts → categories (budget items)
import { supabase } from '../lib/supabase.js'

export async function fetchBudget() {
  // Three queries at once. Balances come from the category_balances view,
  // which adds up each category's transactions for us.
  const [banks, accounts, categories] = await Promise.all([
    supabase
      .from('banks')
      .select('id, name, currency, sort_order')
      .eq('archived', false)
      .order('sort_order')
      .order('name'),
    supabase
      .from('accounts')
      .select('id, bank_id, name, bank_balance, sort_order')
      .eq('archived', false)
      .order('sort_order')
      .order('name'),
    supabase
      .from('category_balances')
      .select('id, account_id, name, planned_amount, target_type, target_date, is_unassigned, sort_order, balance')
      .eq('archived', false)
      .order('sort_order')
      .order('name'),
  ])

  for (const result of [banks, accounts, categories]) {
    if (result.error) throw result.error
  }

  // Put each category inside its account, and each account inside its bank.
  return banks.data.map((bank) => ({
    ...bank,
    accounts: accounts.data
      .filter((a) => a.bank_id === bank.id)
      .map((account) => {
        const cats = categories.data
          .filter((c) => c.account_id === account.id)
          .map((c) => ({ ...c, balance: Number(c.balance), planned_amount: Number(c.planned_amount) }))
        // What the app thinks is in the account = every category, Unassigned included.
        const total = cats.reduce((sum, c) => sum + c.balance, 0)
        return {
          ...account,
          bank_balance: Number(account.bank_balance),
          total,
          unassigned: cats.find((c) => c.is_unassigned) ?? null,
          items: cats.filter((c) => !c.is_unassigned),
        }
      }),
  }))
}
