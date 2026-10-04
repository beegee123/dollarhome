import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Email + password sign-in — the same account you use for Pantry and Daily Docket.
// There is no "create account": people are added in the Supabase dashboard.
export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault() // stop the browser reloading the page on submit
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    // On success we do nothing here: App hears about the new session and switches screens.
    if (error) setError('That email and password didn’t match. Try again.')
    setBusy(false)
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Sign in</h1>
      </header>

      <form className="sign-in" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="notice">{error}</p>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
