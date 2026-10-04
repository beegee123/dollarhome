import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import BalanceSheet from './BalanceSheet.jsx'
import { NameForm } from './SetupScreen.jsx'
import { addItem, fetchAccountItems, setBankBalance, swapOrder, updateItem, updateRow } from '../api/setup.js'
import { formatMoney, parseBalance, shortDate } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Setup → one account. Everything about it in one place:
//   top:    what the bank says, and Update balance
//   middle: its budget items — tap one to edit it
//   bottom: Account settings (rename, order, archive), folded away
export default function AccountItemsScreen() {
  const { accountId } = useParams() // the :accountId part of the address
  const navigate = useNavigate()
  const [data, setData] = useState(null) // null = loading
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null) // which item is open for editing
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    fetchAccountItems(accountId)
      .then((d) => {
        if (ignore) return
        setData(d)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [accountId, reloadCount])

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
        <p>Couldn’t load this account.</p>
        <p className="muted">{loadError}</p>
        <Link to="/setup" className="primary primary-link">
          Back to Setup
        </Link>
      </div>
    )
  }
  if (data === null) return <div className="screen center-message muted">Loading…</div>

  const { account, items, unassigned, total, siblings } = data
  const currency = account.bank.currency
  const active = items.filter((i) => !i.archived)
  const archived = items.filter((i) => i.archived)
  const totalPlan = active.reduce((sum, i) => sum + i.planned_amount, 0)
  const nextOrder = Math.max(-1, ...items.map((i) => i.sort_order)) + 1
  const off = Math.round((account.bank_balance - total) * 100) / 100
  const position = siblings.findIndex((s) => s.id === account.id)

  // Only an empty budget item can be archived.
  function archiveItem(item) {
    if (Math.round(item.balance * 100) !== 0) {
      setActionError(`${item.name} still holds ${formatMoney(item.balance, currency)}. Spend it or move it first, then archive.`)
      return
    }
    if (window.confirm(`Archive ${item.name}? It disappears from Budget. You can restore it later.`)) {
      run(() => updateItem(item.id, { archived: true })).then((ok) => ok && setEditingId(null))
    }
  }

  // Only an empty account (in DollarHome AND at the bank) can be archived.
  function archiveAccount() {
    if (Math.round(total * 100) !== 0) {
      setActionError(`${account.name} still holds ${formatMoney(total, currency)} in DollarHome. Move or spend it first.`)
      return
    }
    if (account.bank_balance !== 0) {
      setActionError('The bank still shows a balance. Update it to 0 once the account is empty, then archive.')
      return
    }
    if (window.confirm(`Archive ${account.name}? Its section disappears from Budget. You can restore it later.`)) {
      run(() => updateRow('accounts', account.id, { archived: true })).then((ok) => ok && navigate('/setup'))
    }
  }

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">
          {account.bank.name.toUpperCase()} · {currency}
        </span>
        <h1>{account.name}</h1>
      </header>

      {/* Balance: what the bank says vs what DollarHome holds. */}
      <button type="button" className="balance-card" onClick={() => setBalanceOpen(true)}>
        <span className="setup-row-main">
          <span>
            Bank says <span className="money strong">{formatMoney(account.bank_balance, currency)}</span>
          </span>
          <span className="muted setup-row-sub">
            {account.balance_checked_at ? `Checked ${shortDate(account.balance_checked_at.slice(0, 10))}` : 'Not checked yet'}
            {off === 0 ? (
              <span className="match-ok"> · matches</span>
            ) : (
              <span className="match-off"> · off by {formatMoney(Math.abs(off), currency)}</span>
            )}
            {unassigned !== 0 && ` · ${formatMoney(unassigned, currency)} unassigned`}
          </span>
        </span>
        <span className="small-button">Update</span>
      </button>

      {actionError && (
        <p className="notice" role="alert">
          {actionError}
        </p>
      )}

      <section className="bank-card">
        <div className="bank-card-head">
          <h2>Budget items</h2>
          <span className="muted setup-row-sub">
            Planned <span className="money">{formatMoney(totalPlan, currency)}</span>
          </span>
        </div>

        {active.length === 0 && <p className="muted empty--small">No budget items yet. Add your first one below.</p>}

        {active.map((item, index) =>
          editingId === item.id ? (
            <ItemForm
              key={item.id}
              currency={currency}
              initialName={item.name}
              initialPlan={item.planned_amount}
              submitLabel="Save"
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSubmit={async (name, plannedAmount) =>
                (await run(() => updateItem(item.id, { name, planned_amount: plannedAmount }))) && setEditingId(null)
              }
              // Rarely-used tools live inside the editor, not on every row.
              extra={
                <>
                  <button type="button" className="small-button" disabled={busy || index === 0} onClick={() => run(() => swapOrder('categories', item, active[index - 1]))}>
                    Move up
                  </button>
                  <button type="button" className="small-button" disabled={busy || index === active.length - 1} onClick={() => run(() => swapOrder('categories', item, active[index + 1]))}>
                    Move down
                  </button>
                  <button type="button" className="small-button small-button--danger" disabled={busy} onClick={() => archiveItem(item)}>
                    Archive
                  </button>
                </>
              }
            />
          ) : (
            <button key={item.id} type="button" className="account-link" onClick={() => setEditingId(item.id)}>
              <span className="setup-row-main">
                <span className="setup-row-name">{item.name}</span>
                <span className="muted setup-row-sub">
                  Plan <span className="money">{formatMoney(item.planned_amount, currency)}</span> · holds{' '}
                  <span className="money">{formatMoney(item.balance, currency)}</span>
                </span>
              </span>
              <span className="muted edit-word">Edit</span>
            </button>
          ),
        )}

        <AddItem
          currency={currency}
          busy={busy}
          onAdd={(name, plannedAmount) => run(() => addItem({ accountId, name, plannedAmount, sortOrder: nextOrder }))}
        />

        {archived.length > 0 && (
          <details className="archived">
            <summary>Archived items ({archived.length})</summary>
            {archived.map((item) => (
              <div key={item.id} className="setup-row setup-row--archived">
                <span>{item.name}</span>
                <button type="button" className="small-button" disabled={busy} onClick={() => run(() => updateItem(item.id, { archived: false }))}>
                  Restore
                </button>
              </div>
            ))}
          </details>
        )}
      </section>

      {/* Account settings: folded away until needed. */}
      <details className="settings">
        <summary>Account settings</summary>
        {renaming ? (
          <NameForm
            initial={account.name}
            label="Account name"
            busy={busy}
            onCancel={() => setRenaming(false)}
            onSave={async (name) => (await run(() => updateRow('accounts', account.id, { name }))) && setRenaming(false)}
          />
        ) : (
          <div className="row-actions">
            <button type="button" className="small-button" disabled={busy} onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button
              type="button"
              className="small-button"
              disabled={busy || position <= 0}
              onClick={() => run(() => swapOrder('accounts', siblings[position], siblings[position - 1]))}
            >
              Move up
            </button>
            <button
              type="button"
              className="small-button"
              disabled={busy || position < 0 || position >= siblings.length - 1}
              onClick={() => run(() => swapOrder('accounts', siblings[position], siblings[position + 1]))}
            >
              Move down
            </button>
            <button type="button" className="small-button small-button--danger" disabled={busy} onClick={archiveAccount}>
              Archive account
            </button>
          </div>
        )}
        <p className="hint">Order sets where this section appears on the {account.bank.name} tab.</p>
      </details>

      {balanceOpen && (
        <BalanceSheet
          account={{ ...account, total }}
          currency={currency}
          onClose={() => setBalanceOpen(false)}
          onSave={async (amount) => {
            await setBankBalance(account.id, amount)
            setBalanceOpen(false)
            reload()
          }}
        />
      )}
    </div>
  )
}

function AddItem({ currency, busy, onAdd }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add budget item
      </button>
    )
  }
  return (
    <ItemForm
      currency={currency}
      initialName=""
      initialPlan={null}
      submitLabel="Add item"
      busy={busy}
      onCancel={() => setOpen(false)}
      // Stays open after adding, so several items can go in one after another.
      onSubmit={(name, plannedAmount) => onAdd(name, plannedAmount)}
      clearAfterSubmit
    />
  )
}

// Name + planned amount. Used for adding and for editing.
function ItemForm({ currency, initialName, initialPlan, submitLabel, busy, onSubmit, onCancel, clearAfterSubmit, extra }) {
  const [name, setName] = useState(initialName)
  const [planText, setPlanText] = useState(initialPlan === null ? '' : String(initialPlan))
  const [error, setError] = useState(null)

  return (
    <form
      className="add-account"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const plan = planText.trim() === '' ? 0 : parseBalance(planText)
        if (plan === null || plan < 0) {
          setError('Enter the planned amount, like 600 (or leave it blank for no plan)')
          return
        }
        setError(null)
        const ok = await onSubmit(name.trim(), plan)
        if (ok && clearAfterSubmit) {
          setName('')
          setPlanText('')
        }
      }}
    >
      <div className="spend-row">
        <label className="field">
          <span>Name</span>
          <input placeholder="e.g. Groceries" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--plan">
          <span>Plan ({currency})</span>
          <input inputMode="decimal" placeholder="0" value={planText} onChange={(e) => setPlanText(e.target.value)} />
        </label>
      </div>
      {error && <p className="notice">{error}</p>}
      <div className="inline-form">
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          {submitLabel}
        </button>
        <button type="button" className="small-button" onClick={onCancel}>
          {clearAfterSubmit ? 'Done' : 'Cancel'}
        </button>
      </div>
      {extra && <div className="row-actions edit-strip">{extra}</div>}
    </form>
  )
}
