import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase.js'
import { addAccount, addBank, deleteBank, fetchSetup, restartBalances, startFresh, swapOrder, updateRow } from '../api/setup.js'
import { fetchBudget } from '../api/budget.js'
import { addCard } from '../api/cards.js'
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
      <Link to="/owed" className="setup-link">
        <span>
          <strong>Owed</strong>
          <span className="muted"> · loans and tax bills</span>
        </span>
        <span aria-hidden="true">›</span>
      </Link>
      <Link to="/setup/notes" className="setup-link">
        <span>
          <strong>Bill notes</strong>
          <span className="muted"> · one running note to jot things down</span>
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
            allBanks={active}
            totals={totals}
            busy={busy}
            run={run}
            nextOrder={nextOrder}
            onUp={index > 0 ? () => run(() => swapOrder('banks', bank, active[index - 1])) : null}
            onDown={index < active.length - 1 ? () => run(() => swapOrder('banks', bank, active[index + 1])) : null}
          />
        ))}

        <AddBankForm busy={busy} onAdd={(name, currency) => run(() => addBank({ name, currency, sortOrder: nextOrder(banks) }))} />

        <ResetSection banks={banks} busy={busy} run={run} />

        <button type="button" className="secondary sign-out" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>

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
function BankCard({ bank, allBanks, totals, busy, run, nextOrder, onUp, onDown }) {
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
        const isCard = account.kind === 'credit'
        // A card's DollarHome total is minus what it owes, so compare the statement with −total.
        const held = isCard ? -(totals[account.id] ?? 0) : (totals[account.id] ?? 0)
        const off = Math.round((account.bank_balance - held) * 100) / 100
        return (
          <Link key={account.id} to={`/setup/accounts/${account.id}`} className="account-link">
            <span className="setup-row-main">
              <span className="setup-row-name">
                {account.name}
                {isCard && <span className="card-badge">CARD</span>}
              </span>
              <span className="muted setup-row-sub">
                {isCard ? 'Owes ' : 'Bank '}
                <span className="money">{formatMoney(account.bank_balance, bank.currency)}</span>
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
        allBanks={allBanks}
        busy={busy}
        onAdd={(name, startingBalance) =>
          run(() => addAccount({ bankId: bank.id, name, startingBalance, sortOrder: nextOrder(bank.accounts) }))
        }
        onAddCard={(name, owed, paysFromAccountId) => run(() => addCard({ bankId: bank.id, name, owed, paysFromAccountId }))}
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

function AddAccountForm({ bank, allBanks, busy, onAdd, onAddCard }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('cash') // 'cash' = bank account, 'credit' = credit card
  const [name, setName] = useState('')
  const [balanceText, setBalanceText] = useState('')
  const [paysFrom, setPaysFrom] = useState('')
  const [error, setError] = useState(null)
  const isCard = kind === 'credit'

  // A card is paid from a bank account in the same currency (any bank).
  const payers = allBanks
    .filter((b) => b.currency === bank.currency)
    .flatMap((b) => b.accounts.filter((a) => !a.archived && a.kind !== 'credit').map((a) => ({ ...a, bankName: b.name })))

  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add account or card
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
        if (balance === null || (isCard && balance < 0)) {
          setError(isCard ? 'Enter what the card owes today, like 640 (or leave it blank for $0)' : 'Enter today’s balance, like 1865.40 (or leave it blank for $0)')
          return
        }
        if (isCard && !paysFrom) {
          setError('Choose the bank account you pay this card from.')
          return
        }
        setError(null)
        const ok = isCard ? await onAddCard(name.trim(), balance, paysFrom) : await onAdd(name.trim(), balance)
        if (ok) {
          setName('')
          setBalanceText('')
          setPaysFrom('')
          setOpen(false)
        }
      }}
    >
      <fieldset className="segmented">
        <legend>Type</legend>
        <label className={!isCard ? 'on' : ''}>
          <input type="radio" name={`acct-kind-${bank.id}`} checked={!isCard} onChange={() => setKind('cash')} />
          Bank account
        </label>
        <label className={isCard ? 'on' : ''}>
          <input type="radio" name={`acct-kind-${bank.id}`} checked={isCard} onChange={() => setKind('credit')} />
          Credit card
        </label>
      </fieldset>
      <label className="field">
        <span>{isCard ? 'Card name' : 'Account name'}</span>
        <input placeholder={isCard ? 'e.g. Visa' : 'e.g. Checking'} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{isCard ? `Owed today (${bank.currency})` : `Today’s balance (${bank.currency})`}</span>
        <input inputMode="decimal" placeholder="0.00" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} />
      </label>
      {isCard && (
        <label className="field">
          <span>Paid from</span>
          <select className="field-select" value={paysFrom} onChange={(e) => setPaysFrom(e.target.value)}>
            <option value="">Choose a {bank.currency} account…</option>
            {payers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} · {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">
        {isCard
          ? 'DollarHome adds a “' + (name.trim() || 'Card') + ' payment” envelope to that account. Spending on the card sets money aside there for the bill.'
          : 'This goes into the account’s Unassigned, ready to give each dollar a home.'}
      </p>
      {error && <p className="notice">{error}</p>}
      <div className="inline-form">
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          {isCard ? 'Add card' : 'Add account'}
        </button>
        <button type="button" className="small-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Reset: three levels, from gentlest to strongest. Each one asks you to type a word,
// because none of them can be undone.
function ResetSection({ banks, busy, run }) {
  const [bankId, setBankId] = useState('')
  return (
    <details className="settings danger-zone">
      <summary>Reset</summary>

      <ResetOption
        title="Restart balances, keep my setup"
        word="RESTART"
        busy={busy}
        onConfirm={() => run(() => restartBalances())}
        button="Restart balances"
      >
        Clears every spend, paycheck, move and transfer. Keeps your banks, accounts, budget items, plans, income
        sources, splits and wishlist. Each account starts again from its bank balance on file, in Unassigned, ready
        to assign. Update bank balances first if they’re out of date.
      </ResetOption>

      <ResetOption
        title="Delete one bank"
        word="DELETE"
        busy={busy}
        disabled={!bankId}
        onConfirm={async () => (await run(() => deleteBank(bankId))) && setBankId('')}
        button="Delete this bank"
        extra={
          <select aria-label="Bank to delete" className="field-select" value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">Choose a bank…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.currency}){b.archived ? ' · archived' : ''}
              </option>
            ))}
          </select>
        }
      >
        Removes the bank with its accounts, budget items and their history, and any income sources that land there.
        Other banks are not affected. To just hide a bank, use Archive instead.
      </ResetOption>

      <ResetOption
        title="Delete everything"
        word="DELETE"
        busy={busy}
        onConfirm={() => run(() => startFresh())}
        button="Delete everything"
      >
        Deletes all your DollarHome banks, accounts, budget items, income sources, transactions and wishlist. Pantry
        and Daily Docket are not touched.
      </ResetOption>
    </details>
  )
}

function ResetOption({ title, word, busy, disabled, onConfirm, button, extra, children }) {
  const [typed, setTyped] = useState('')
  return (
    <div className="reset-option">
      <h3>{title}</h3>
      <p className="hint">{children} This can’t be undone.</p>
      {extra}
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (typed !== word || disabled) return
          await onConfirm()
          setTyped('')
        }}
      >
        <input aria-label={`Type ${word} to confirm`} placeholder={`Type ${word}`} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" className="small-button small-button--danger" disabled={busy || disabled || typed !== word}>
          {button}
        </button>
      </form>
    </div>
  )
}
