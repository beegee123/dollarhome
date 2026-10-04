import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import BalanceSheet from './BalanceSheet.jsx'
import { addAccount, addBank, fetchSetup, setBankBalance, swapOrder, updateRow } from '../api/setup.js'
import { fetchBudget } from '../api/budget.js'
import { formatMoney, parseBalance, shortDate } from '../lib/money.js'

// Setup: your banks and the accounts inside them.
// (Budget items get their own setup in Step 5b.)
export default function SetupScreen() {
  const [banks, setBanks] = useState(null) // null = loading
  const [totals, setTotals] = useState({}) // account id → what DollarHome holds there
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)
  const [balanceFor, setBalanceFor] = useState(null) // { account, currency } while the balance sheet is open

  useEffect(() => {
    let ignore = false
    // fetchBudget gives each account's total (sum of its items), for the balance sheet.
    Promise.all([fetchSetup(), fetchBudget()])
      .then(([setup, budget]) => {
        if (ignore) return
        setBanks(setup)
        const t = {}
        budget.forEach((b) => b.accounts.forEach((a) => (t[a.id] = a.total)))
        setTotals(t)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(err.message))
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
      setActionError(err.message)
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

      <p className="muted setup-intro">
        Banks are the tabs on your Budget screen. Accounts are the sections inside each tab.
      </p>

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
            onUpdateBalance={(account) => setBalanceFor({ account: { ...account, total: totals[account.id] ?? 0 }, currency: bank.currency })}
          />
        ))}

        <AddBankForm busy={busy} onAdd={(name, currency) => run(() => addBank({ name, currency, sortOrder: nextOrder(banks) }))} />

        {archived.length > 0 && (
          <section className="archived">
            <h2 className="section-title">Archived banks</h2>
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
          </section>
        )}
      </main>

      {balanceFor && (
        <BalanceSheet
          account={balanceFor.account}
          currency={balanceFor.currency}
          onClose={() => setBalanceFor(null)}
          onSave={async (amount) => {
            await setBankBalance(balanceFor.account.id, amount)
            setBalanceFor(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

// One bank: its name and currency, its controls, and its accounts.
function BankCard({ bank, totals, busy, run, nextOrder, onUp, onDown, onUpdateBalance }) {
  const [renaming, setRenaming] = useState(false)
  const [blocked, setBlocked] = useState(null) // why something can't be archived yet
  const activeAccounts = bank.accounts.filter((a) => !a.archived)
  const archivedAccounts = bank.accounts.filter((a) => a.archived)

  // A bank can only be archived when none of its accounts hold money.
  function archiveBank() {
    const withMoney = activeAccounts.filter((a) => moneyIn(a, totals[a.id]))
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

  // An account can only be archived when it's empty in DollarHome AND at the bank.
  function archiveAccount(account) {
    const reason = moneyIn(account, totals[account.id])
    if (reason) {
      setBlocked(`${account.name} can’t be archived yet: ${reason}. Move or spend it first, then archive.`)
      return
    }
    setBlocked(null)
    if (window.confirm(`Archive ${account.name}? Its section disappears from Budget. You can restore it later.`)) {
      run(() => updateRow('accounts', account.id, { archived: true }))
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
            <div className="row-actions">
              <OrderButtons onUp={onUp} onDown={onDown} busy={busy} label={bank.name} />
              <button type="button" className="small-button" disabled={busy} onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                type="button"
                className="small-button small-button--danger"
                disabled={busy}
                onClick={archiveBank}
              >
                Archive
              </button>
            </div>
          </>
        )}
      </div>

      {blocked && (
        <p className="notice" role="alert">
          {blocked}
        </p>
      )}

      {activeAccounts.length === 0 && <p className="muted empty--small">No accounts yet.</p>}

      {activeAccounts.map((account, index) => (
        <AccountRow
          key={account.id}
          account={account}
          currency={bank.currency}
          total={totals[account.id] ?? 0}
          busy={busy}
          run={run}
          onUp={index > 0 ? () => run(() => swapOrder('accounts', account, activeAccounts[index - 1])) : null}
          onDown={
            index < activeAccounts.length - 1 ? () => run(() => swapOrder('accounts', account, activeAccounts[index + 1])) : null
          }
          onUpdateBalance={() => onUpdateBalance(account)}
          onArchive={() => archiveAccount(account)}
        />
      ))}

      <AddAccountForm
        bank={bank}
        busy={busy}
        onAdd={(name, startingBalance) =>
          run(() => addAccount({ bankId: bank.id, name, startingBalance, sortOrder: nextOrder(bank.accounts) }))
        }
      />

      {archivedAccounts.map((account) => (
        <div key={account.id} className="setup-row setup-row--archived">
          <span>
            {account.name} <span className="muted">· archived</span>
          </span>
          <button type="button" className="small-button" disabled={busy} onClick={() => run(() => updateRow('accounts', account.id, { archived: false }))}>
            Restore
          </button>
        </div>
      ))}
    </section>
  )
}

// One account: name, what the bank says (and when you last checked), and its controls.
function AccountRow({ account, currency, total, busy, run, onUp, onDown, onUpdateBalance, onArchive }) {
  const [renaming, setRenaming] = useState(false)
  const off = Math.round((account.bank_balance - total) * 100) / 100
  const checked = account.balance_checked_at
    ? `checked ${shortDate(account.balance_checked_at.slice(0, 10))}`
    : 'not checked yet'

  if (renaming) {
    return (
      <div className="setup-row">
        <NameForm
          initial={account.name}
          label="Account name"
          busy={busy}
          onCancel={() => setRenaming(false)}
          onSave={async (name) => (await run(() => updateRow('accounts', account.id, { name }))) && setRenaming(false)}
        />
      </div>
    )
  }

  return (
    <div className="setup-row setup-row--account">
      <div className="setup-row-main">
        <span className="setup-row-name">{account.name}</span>
        <span className="muted setup-row-sub">
          Bank says <span className="money">{formatMoney(account.bank_balance, currency)}</span> · {checked}
          {off !== 0 && <span className="match-off"> · off by {formatMoney(Math.abs(off), currency)}</span>}
        </span>
      </div>
      <div className="row-actions">
        <button type="button" className="small-button" disabled={busy} onClick={onUpdateBalance}>
          Update balance
        </button>
        <OrderButtons onUp={onUp} onDown={onDown} busy={busy} label={account.name} />
        <button type="button" className="small-button" disabled={busy} onClick={() => setRenaming(true)}>
          Rename
        </button>
        <button
          type="button"
          className="small-button small-button--danger"
          disabled={busy}
          onClick={onArchive}
        >
          Archive
        </button>
      </div>
    </div>
  )
}

// Does this account still hold money? Returns the reason as words, or null if it's empty.
// Both must be zero: what DollarHome holds (its budget items + Unassigned) and what the bank says.
function moneyIn(account, total = 0) {
  const held = Math.round(total * 100) / 100
  if (held !== 0) return 'its budget items still hold money in DollarHome'
  if (account.bank_balance !== 0) return 'the bank still shows a balance (update it to 0 once the account is empty)'
  return null
}

// ↑ / ↓ buttons. A missing handler means "already at the top/bottom".
function OrderButtons({ onUp, onDown, busy, label }) {
  return (
    <>
      <button type="button" className="small-button icon-button" aria-label={`Move ${label} up`} disabled={busy || !onUp} onClick={onUp ?? undefined}>
        ↑
      </button>
      <button type="button" className="small-button icon-button" aria-label={`Move ${label} down`} disabled={busy || !onDown} onClick={onDown ?? undefined}>
        ↓
      </button>
    </>
  )
}

// A one-field form for renaming.
function NameForm({ initial, label, busy, onSave, onCancel }) {
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
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  return (
    <form
      className="add-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (name.trim() && (await onAdd(name.trim(), currency))) setName('')
      }}
    >
      <h2 className="section-title">Add a bank</h2>
      <div className="inline-form">
        <input aria-label="New bank name" placeholder="e.g. Chase" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="CAD">CAD</option>
        </select>
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          Add
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
        + Add account to {bank.name}
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
