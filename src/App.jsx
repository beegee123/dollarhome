import { useEffect, useState } from 'react'
import { supabase, missingConfig } from './lib/supabase.js'
import SignIn from './components/SignIn.jsx'

// App decides WHICH screen to show: setup problem, loading, sign-in, or the app itself.
export default function App() {
  // undefined = still checking, null = signed out, object = signed in
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (missingConfig) return

    // 1. Is someone already signed in on this device?
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // 2. Keep listening: sign in, sign out and token refresh all land here.
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    // Cleanup: stop listening when App goes away.
    return () => data.subscription.unsubscribe()
  }, [])

  if (missingConfig) {
    return (
      <div className="screen center-message">
        <p>The app isn’t connected to Supabase yet.</p>
        <p className="muted">
          Copy .env.example to .env.local, paste in the same two values Pantry uses,
          then restart <code>npm run dev</code>.
        </p>
      </div>
    )
  }

  if (session === undefined) return <div className="screen center-message muted">Loading…</div>
  if (session === null) return <SignIn />

  // Signed in. The Budget screen arrives in Step 3; for now, prove the database works.
  return (
    <div className="screen">
      <header className="screen-header">
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Budget</h1>
      </header>
      <p className="muted">Signed in as {session.user.email}.</p>
      <DatabaseCheck />
      <button className="secondary" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </div>
  )
}

// Step 2 check: count what's in the "money" schema. Removed when the real Budget screen arrives.
function DatabaseCheck() {
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      // count: 'exact' = "also tell me how many rows there are"; limit(1) keeps the download tiny.
      const tables = ['banks', 'accounts', 'categories', 'transactions']
      try {
        const results = await Promise.all(
          tables.map((t) => supabase.from(t).select('id', { count: 'exact' }).limit(1)),
        )
        const failed = results.find((r) => r.error)
        if (failed) {
          const e = failed.error
          // Some errors arrive without a message, so fall back to the code and HTTP status.
          setError(e.message || `${e.code || 'error'} (HTTP ${failed.status})`)
          return
        }
        setCounts(Object.fromEntries(tables.map((t, i) => [t, results[i].count])))
      } catch (err) {
        setError(err.message || String(err)) // e.g. no internet connection
      }
    }
    load()
  }, [])

  if (error) return <p className="notice">Database problem: {error}</p>
  if (!counts) return <p className="muted">Checking the database…</p>
  return (
    <p>
      Database connected: {counts.banks} banks, {counts.accounts} accounts,{' '}
      {counts.categories} budget items, {counts.transactions} transactions.
    </p>
  )
}
