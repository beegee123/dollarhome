// One shared connection to Supabase for the whole app.
// Money Pantry uses the SAME Supabase project as Pantry and Daily Docket:
// sign-in is shared, but every Money Pantry table lives in its own "money"
// schema so it never collides with the other apps' tables.
import { createClient } from '@supabase/supabase-js'

// Vite reads these from .env.local. Only variables starting with VITE_ reach the browser.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Missing or still the placeholder from .env.example? Then App shows a message instead of crashing.
export const missingConfig =
  !url || !key || url.includes('your-project-ref') || key.startsWith('your-')

// ---- Retry for "JWT issued at future" (same fix as Pantry) ----
// Right after signing in, Supabase's database can briefly see the new token as
// "issued in the future" because its clock is a fraction of a second behind.
// It fixes itself within moments, so we wait and try again instead of showing an error.
const RETRY_DELAYS_MS = [500, 1000, 2000]

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchWithRetry(input, init) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, init)
    if (response.status !== 401 || attempt >= RETRY_DELAYS_MS.length) return response

    // Read a COPY of the body, so supabase-js can still read the original.
    const body = await response.clone().text()
    if (!/issued at future/i.test(body)) return response

    await wait(RETRY_DELAYS_MS[attempt])
  }
}

export const supabase = missingConfig
  ? null
  : createClient(url, key, {
      db: { schema: 'money' }, // every table call goes to the "money" schema
      global: { fetch: fetchWithRetry },
    })
