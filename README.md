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

After running `001`, add `money` to **Exposed schemas** in the project's Data API settings so the app can reach it.

`dev_sample_data.sql` loads the wireframe's sample data for your own account (put your email at the top). Don't run it once you've entered real data.
