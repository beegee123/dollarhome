import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchSetupCounts } from '../api/setup.js'

const HIDE_KEY = 'dollarhome-checklist-hidden'

// Reading/writing the "hide" choice can fail (private browsing), so never let it crash.
function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === 'yes'
  } catch {
    return false
  }
}
function writeHidden() {
  try {
    localStorage.setItem(HIDE_KEY, 'yes')
  } catch {
    /* fine: it just shows again next time */
  }
}

// Day-one setup checklist on the Budget screen. Each step ticks itself off
// from your real data, and the card disappears once the required steps are done.
// Props:
//   banks    — Budget data (banks → accounts → items)
//   onAssign — function(account, bank): opens Assign for an account with unassigned money
export default function SetupChecklist({ banks, onAssign }) {
  const [counts, setCounts] = useState(null)
  const [hidden, setHidden] = useState(readHidden)

  useEffect(() => {
    let ignore = false
    fetchSetupCounts()
      .then((c) => !ignore && setCounts(c))
      .catch(() => !ignore && setCounts({ sources: 0, wishes: 0 }))
    return () => {
      ignore = true
    }
  }, [banks]) // re-check whenever the budget reloads

  if (hidden || counts === null) return null

  const accounts = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bank: b })))
  const itemCount = accounts.reduce((n, a) => n + a.items.length, 0)
  const waiting = accounts.find((a) => (a.unassigned?.balance ?? 0) > 0 && a.items.length > 0)
  const firstAccount = accounts[0]

  const steps = [
    { done: banks.length > 0, text: 'Add your banks', to: '/setup' },
    { done: accounts.length > 0, text: 'Add accounts with today’s balance', to: '/setup' },
    {
      done: itemCount > 0,
      text: 'Add budget items (Rent, Groceries…) with a plan',
      to: firstAccount ? `/setup/accounts/${firstAccount.id}` : '/setup',
    },
    {
      done: itemCount > 0 && !waiting,
      text: 'Assign your starting money from Unassigned',
      action: waiting ? () => onAssign(waiting, waiting.bank) : null,
    },
    { done: counts.sources > 0, text: 'Set up income sources and their splits', to: '/setup/income' },
    { done: counts.wishes > 0, text: 'Add wishlist items (optional)', to: '/wishlist', optional: true },
  ]
  const required = steps.filter((s) => !s.optional)
  const doneCount = required.filter((s) => s.done).length
  if (doneCount === required.length) return null // all set: the card goes away

  return (
    <section className="checklist" aria-label="Setup checklist">
      <div className="checklist-head">
        <h2>Get set up</h2>
        <span className="muted">
          {doneCount} of {required.length} done
        </span>
      </div>
      <p className="hint">Tip: start with one bank and one account, use it for a week, then add the rest.</p>
      <ol>
        {steps.map((s) => (
          <li key={s.text} className={s.done ? 'checklist-done' : ''}>
            <span className="checklist-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span className="visually-hidden">{s.done ? 'Done: ' : 'To do: '}</span>
            {!s.done && s.to ? (
              <Link to={s.to}>{s.text}</Link>
            ) : !s.done && s.action ? (
              <button type="button" className="link-button checklist-action" onClick={s.action}>
                {s.text}
              </button>
            ) : (
              <span>{s.text}</span>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          writeHidden()
          setHidden(true)
        }}
      >
        Hide checklist
      </button>
    </section>
  )
}
