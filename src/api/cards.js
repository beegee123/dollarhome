// Credit cards (accounts with kind 'credit'). See supabase/009_credit_cards.sql for how
// the money moves: spending sets money aside in the card's payment envelope; paying
// the card empties it.
import { supabase } from '../lib/supabase.js'

export async function addCard({ bankId, name, owed, paysFromAccountId }) {
  const { data, error } = await supabase.rpc('add_card', {
    p_bank_id: bankId,
    p_name: name,
    p_owed: owed,
    p_pays_from: paysFromAccountId,
  })
  if (error) {
    if (error.code === '23505') throw new Error(`This bank already has an account called “${name.trim()}”.`)
    throw error
  }
  return data
}

// Spend from a budget item, paid with a card. Returns a pair id (Undo deletes the pair).
export async function cardSpend({ categoryId, cardId, amount, spentOn, note }) {
  const { data, error } = await supabase.rpc('card_spend', {
    p_category_id: categoryId,
    p_card_id: cardId,
    p_amount: amount,
    p_spent_on: spentOn,
    p_note: note ?? '',
  })
  if (error) throw error
  return data
}

// Pay the card from its payment envelope. Returns a pair id.
export async function payCard({ cardId, amount, paidOn }) {
  const { data, error } = await supabase.rpc('pay_card', { p_card_id: cardId, p_amount: amount, p_paid_on: paidOn })
  if (error) throw error
  return data
}
