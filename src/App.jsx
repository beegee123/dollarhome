import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { supabase, missingConfig } from './lib/supabase.js'
import SignIn from './components/SignIn.jsx'
import BudgetScreen from './components/BudgetScreen.jsx'
import SetupScreen from './components/SetupScreen.jsx'
import AccountItemsScreen from './components/AccountItemsScreen.jsx'
import IncomeSourcesScreen from './components/IncomeSourcesScreen.jsx'
import IncomeSourceForm from './components/IncomeSourceForm.jsx'

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

  // Signed in: pick the screen from the address bar.
  return (
    <Routes>
      <Route path="/" element={<BudgetScreen />} />
      <Route path="/setup" element={<SetupScreen />} />
      {/* :accountId is a placeholder — /setup/accounts/abc123 shows account abc123's budget items */}
      <Route path="/setup/accounts/:accountId" element={<AccountItemsScreen />} />
      <Route path="/setup/income" element={<IncomeSourcesScreen />} />
      {/* /setup/income/new adds one; /setup/income/<id> edits one */}
      <Route path="/setup/income/:sourceId" element={<IncomeSourceForm />} />
      {/* Any unknown address goes back to the Budget. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
