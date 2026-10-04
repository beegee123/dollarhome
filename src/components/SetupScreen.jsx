import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { addAccount, addBank, fetchSetup, swapOrder, updateRow } from '../api/setup.js'
import { fetchBudget } from '../api/budget.js'
import { formatMoney, parseBalance } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Setup: your banks and the accounts inside them.
// Kept short on purpose: each account is one row; tap it for everything else
// (balance, budget items, rename, order, archive) on the account's own screen.
export default function SetupScreen() {
  const [banks, setBanks] = useState(null) // null = loading
  const [totals, setTotals] = useState({}) // account id → what DollarHome holds there
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchSetup(), fetchBudget()])
      .then(([setup, budget]) => {
        if (ignore) return
        setBanks(setup)
        const t = {}
        budget.forEach((b) => b.accounts.forEach((a) => (t[a.id] = a.total)))
        setTotals(t)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [reloadCount])

  // Runs one change, shows any error, then reloads. Returns true if it worked.
  async function run(action) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      reload()
      return true
    } catch (err) {
      setActionError(friendlyError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load your setup.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={reload}>
          Try again
        </button>
      </div>
    )
  }
  if (banks === null) return <div className="screen center-message muted">Loading…</div>

  const active = banks.filter((b) => !b.archived)
  const archived = banks.filter((b) => b.archived)
  const nextOrder = (rows) => Math.max(-1, ...rows.map((r) => r.sort_order)) + 1

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/" className="back-link">
          ← Budget
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Setup</h1>
      </header>

      <Link to="/setup/income" className="setup-link">
        <span>
          <strong>Income sources</strong>
          <span className="muted"> · paychecks, payouts and their splits</span>
        </span>
        <span aria-hidden="true">›</span>
      </Link>

      <p className="muted setup-intro">Banks are the tabs on Budget; accounts are the sections. Tap an account to manage it.</p>

      {actionError && (
        <p className="notice" role="alert">
          {actionError}
        </p>
      )}

      <main className="setup-list">
        {active.map((bank, index) => (
          <BankCard
            key={bank.id}
            bank={bank}
            totals={totals}
            busy={busy}
            run={run}
            nextOrder={nextOrder}
            onUp={index > 0 ? () => run(() => swapOrder('banks', bank, active[index - 1])) : null}
            onDown={index < active.length - 1 ? () => run(() => swapOrder('banks', bank, active[index + 1])) : null}
          />
        ))}

        <AddBankForm busy={busy} onAdd={(name, currency) => run(() => addBank({ name, currency, sortOrder: nextOrder(banks) }))} />

        {archived.length > 0 && (
          <details className="archived">
            <summary>Archived banks ({archived.length})</summary>
            {archived.map((bank) => (
              <div key={bank.id} className="setup-row setup-row--archived">
                <span>
                  {bank.name} <span className="muted">· {bank.currency}</span>
                </span>
                <button type="button" className="small-button" disabled={busy} onClick={() => run(() => updateRow('banks', bank.id, { archived: false }))}>
                  Restore
                </button>
              </div>
            ))}
          </details>
        )}
      </main>
    </div>
  )
}

// One bank: a header with a single Edit button, then one row per account.
function BankCard({ bank, totals, busy, run, nextOrder, onUp, onDown }) {
  const [editing, setEditing] = useState(false) // Edit opens rename / order / archive
  const [renaming, setRenaming] = useState(false)
  const [blocked, setBlocked] = useState(null)
  const activeAccounts = bank.accounts.filter((a) => !a.archived)
  const archivedAccounts = bank.accounts.filter((a) => a.archived)

  // A bank can only be archived when none of its accounts hold money.
  function archiveBank() {
    const withMoney = activeAccounts.filter(
      (a) => Math.round((totals[a.id] ?? 0) * 100) !== 0 || a.bank_balance !== 0,
    )
    if (withMoney.length > 0) {
      setBlocked(
        `${bank.name} can’t be archived while ${withMoney.map((a) => a.name).join(' and ')} still ${
          withMoney.length === 1 ? 'holds' : 'hold'
        } money. Move it out first.`,
      )
      return
    }
    setBlocked(null)
    if (window.confirm(`Archive ${bank.name}? Its tab disappears from Budget. You can restore it later.`)) {
      run(() => updateRow('banks', bank.id, { archived: true }))
    }
  }

  return (
    <section className="bank-card" aria-label={bank.name}>
      <div className="bank-card-head">
        {renaming ? (
          <NameForm
            initial={bank.name}
            label="Bank name"
            busy={busy}
            onCancel={() => setRenaming(false)}
            onSave={async (name) => (await run(() => updateRow('banks', bank.id, { name }))) && setRenaming(false)}
          />
        ) : (
          <>
            <h2>
              {bank.name} <span className="currency-badge">{bank.currency}</span>
            </h2>
            <button
              type="button"
              className="link-button"
              aria-expanded={editing}
              onClick={() => {
                setEditing((e) => !e)
                setBlocked(null)
              }}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </>
        )}
      </div>

      {/* Bank tools: only while editing. */}
      {editing && !renaming && (
        <div className="row-actions edit-strip">
          <button type="button" className="small-button" disabled={busy} onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button type="button" className="small-button" disabled={busy || !onUp} onClick={onUp ?? undefined}>
            Move up
          </button>
          <button type="button" className="small-button" disabled={busy || !onDown} onClick={onDown ?? undefined}>
            Move down
          </button>
          <button type="button" className="small-button small-button--danger" disabled={busy} onClick={archiveBank}>
            Archive
          </button>
        </div>
      )}

      {blocked && (
        <p className="notice" role="alert">
          {blocked}
        </p>
      )}

      {activeAccounts.length === 0 && <p className="muted empty--small">No accounts yet.</p>}

      {/* One compact, tappable row per account. */}
      {activeAccounts.map((account) => {
        const off = Math.round((account.bank_balance - (totals[account.id] ?? 0)) * 100) / 100
        return (
          <Link key={account.id} to={`/setup/accounts/${account.id}`} className="account-link">
            <span className="setup-row-main">
              <span className="setup-row-name">{account.name}</span>
              <span className="muted setup-row-sub">
                Bank <span className="money">{formatMoney(account.bank_balance, bank.currency)}</span>
                {off === 0 ? (
                  <span className="match-ok"> · matches</span>
                ) : (
                  <span className="match-off"> · off by {formatMoney(Math.abs(off), bank.currency)}</span>
                )}
              </span>
            </span>
            <span className="chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        )
      })}

      <AddAccountForm
        bank={bank}
        busy={busy}
        onAdd={(name, startingBalance) =>
          run(() => addAccount({ bankId: bank.id, name, startingBalance, sortOrder: nextOrder(bank.accounts) }))
        }
      />

      {archivedAccounts.length > 0 && (
        <details className="archived">
          <summary>Archived accounts ({archivedAccounts.length})</summary>
          {archivedAccounts.map((account) => (
            <div key={account.id} className="setup-row setup-row--archived">
              <span>{account.name}</span>
              <button type="button" className="small-button" disabled={busy} onClick={() => run(() => updateRow('accounts', account.id, { archived: false }))}>
                Restore
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

// A one-field form for renaming. Also used on the account screen.
export function NameForm({ initial, label, busy, onSave, onCancel }) {
  const [name, setName] = useState(initial)
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onSave(name.trim())
      }}
    >
      <input aria-label={label} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="small-button" disabled={busy || !name.trim()}>
        Save
      </button>
      <button type="button" className="small-button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

function AddBankForm({ busy, onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')

  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add a bank
      </button>
    )
  }

  return (
    <form
      className="add-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (name.trim() && (await onAdd(name.trim(), currency))) {
          setName('')
          setOpen(false)
        }
      }}
    >
      <h2 className="section-title">Add a bank</h2>
      <div className="inline-form">
        <input aria-label="New bank name" placeholder="e.g. Chase" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="CAD">CAD</option>
        </select>
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          Add
        </button>
        <button type="button" className="small-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="hint">The currency can’t be changed later, so every amount at this bank stays in one currency.</p>
    </form>
  )
}

function AddAccountForm({ bank, busy, onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [balanceText, setBalanceText] = useState('')
  const [error, setError] = useState(null)

  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add account
      </button>
    )
  }

  return (
    <form
      className="add-account"
      onSubmit={async (e) => {
        e.preventDefault()
        const balance = balanceText.trim() === '' ? 0 : parseBalance(balanceText)
        if (!name.trim()) return
        if (balance === null) {
          setError('Enter today’s balance, like 1865.40 (or leave it blank for $0)')
          return
        }
        setError(null)
        if (await onAdd(name.trim(), balance)) {
          setName('')
          setBalanceText('')
          setOpen(false)
        }
      }}
    >
      <label className="field">
        <span>Account name</span>
        <input placeholder="e.g. Checking" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Today’s balance ({bank.currency})</span>
        <input inputMode="decimal" placeholder="0.00" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} />
      </label>
      <p className="hint">This goes into the account’s Unassigned, ready to give each dollar a home.</p>
      {error && <p className="notice">{error}</p>}
      <div className="inline-form">
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          Add account
        </button>
        <button type="button" className="small-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
