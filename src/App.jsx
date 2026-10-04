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

  // Signed in. The Budget screen arrives in Step 3; for now, prove sign-in works.
  return (
    <div className="screen">
      <header className="screen-header">
        <span className="eyebrow">MONEY PANTRY</span>
        <h1>Budget</h1>
      </header>
      <p className="muted">Signed in as {session.user.email}.</p>
      <button className="secondary" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </div>
  )
}
