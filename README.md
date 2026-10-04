# Money Pantry

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
