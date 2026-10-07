# DollarHome

A simple envelope budget: paychecks fill budget items, spending empties them, and every balance carries over. Organized by bank (tabs) → account (sections) → budget items, with a wishlist and an analytics screen.

## Stack

- **Front end:** React + Vite, installed on the phone's home screen as a web app
- **Back end:** Supabase (Postgres database, sign-in). Shares the Pantry and Daily Docket project; all tables live in the `money` schema.
- **Hosting:** Vercel

Same stack as the Pantry app.

## Running locally

1. Copy `.env.example` to `.env.local` and fill in the same Supabase URL and key Pantry uses.
2. `npm install`
3. `npm run dev`
4. Open the address it prints (usually http://localhost:5173).

## Database setup

Run the files in `supabase/` in the Supabase SQL Editor, in number order.

1. `001_money_core.sql` — the `money` schema: banks, accounts, categories (budget items), income sources, split lines, income events, transactions, wishlist items, the `category_balances` view and row-level security
2. `002_save_income_source.sql` — `save_income_source` function: saves an income source and its split lines in one transaction
3. `003_apply_income.sql` — `apply_income` function: applies a paycheck (income, leftover to Unassigned, transfers) in one transaction
4. `004_wishlist.sql` — `mark_bought` and `unbuy` functions: wishlist items become spends from their envelopes (and back)
5. `005_start_fresh.sql` — `start_fresh` function: deletes all of your own DollarHome data (Setup → Reset → Delete everything)
6. `006_resets.sql` — `restart_balances` (keep the setup, clear the activity) and `delete_bank` (one bank and everything under it)
7. `007_targets.sql` — budget item targets: monthly, or save up to an amount by a date
8. `008_owed.sql` — Owed: loans and tax bills (`debts`), `pay_debt` / `unpay_debt`, and Delete everything now clears them too
9. `009_credit_cards.sql` — credit cards: account kind, payment envelopes, `add_card`, `card_spend`, `pay_card`
10. `010_move_item.sql` — `move_category`: move a budget item (with its money and history) to another account
11. `011_loan_interest.sql` — loan interest: annual rate on debts, interest part of each payment
12. `012_notes.sql` — Bill notes: one running note per person (Setup → Bill notes)
13. `013_expected_amount.sql` — each income source can remember its usual amount
14. `014_cross_bank_splits.sql` — income splits can fill items at other banks of the same currency (bank-to-bank transfers)
15. `015_delete_empty.sql` — delete an account or bank that was never used (archive stays for ones with history)

After running `001`, add `money` to **Exposed schemas** in the project's Data API settings so the app can reach it.

`dev_sample_data.sql` loads the wireframe's sample data for your own account (put your email at the top). Don't run it once you've entered real data.
