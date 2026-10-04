import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { addItem, fetchAccountItems, swapOrder, updateItem } from '../api/setup.js'
import { formatMoney, parseBalance } from '../lib/money.js'

// Setup → one account → its budget items: add, rename, change the plan, reorder, archive.
export default function AccountItemsScreen() {
  const { accountId } = useParams() // the :accountId part of the address
  const [data, setData] = useState(null) // { account, items }; null = loading
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null) // which item's edit form is open
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
      .catch((err) => !ignore && setLoadError(err.message))
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
      setActionError(err.message)
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

  const { account, items } = data
  const currency = account.bank.currency
  const active = items.filter((i) => !i.archived)
  const archived = items.filter((i) => i.archived)
  const totalPlan = active.reduce((sum, i) => sum + i.planned_amount, 0)
  const nextOrder = Math.max(-1, ...items.map((i) => i.sort_order)) + 1

  // Same rule as accounts: only an empty budget item can be archived.
  function archive(item) {
    if (Math.round(item.balance * 100) !== 0) {
      setActionError(
        `${item.name} still holds ${formatMoney(item.balance, currency)}. Spend it or move it to another item first, then archive.`,
      )
      return
    }
    if (window.confirm(`Archive ${item.name}? It disappears from Budget. You can restore it later.`)) {
      run(() => updateItem(item.id, { archived: true }))
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

      <p className="muted setup-intro">
        Budget items are the envelopes in this account. The plan is what you aim to keep in each one — it sets how
        full the bar looks, but never moves money. Planned total:{' '}
        <span className="money">{formatMoney(totalPlan, currency)}</span>.
      </p>

      {actionError && (
        <p className="notice" role="alert">
          {actionError}
        </p>
      )}

      <main className="bank-card">
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
            />
          ) : (
            <div key={item.id} className="setup-row">
              <div className="setup-row-main">
                <span className="setup-row-name">{item.name}</span>
                <span className="muted setup-row-sub">
                  Plan <span className="money">{formatMoney(item.planned_amount, currency)}</span> · holds{' '}
                  <span className="money">{formatMoney(item.balance, currency)}</span>
                </span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="small-button icon-button"
                  aria-label={`Move ${item.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => run(() => swapOrder('categories', item, active[index - 1]))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="small-button icon-button"
                  aria-label={`Move ${item.name} down`}
                  disabled={busy || index === active.length - 1}
                  onClick={() => run(() => swapOrder('categories', item, active[index + 1]))}
                >
                  ↓
                </button>
                <button type="button" className="small-button" disabled={busy} onClick={() => setEditingId(item.id)}>
                  Edit
                </button>
                <button type="button" className="small-button small-button--danger" disabled={busy} onClick={() => archive(item)}>
                  Archive
                </button>
              </div>
            </div>
          ),
        )}

        <AddItem
          currency={currency}
          busy={busy}
          onAdd={(name, plannedAmount) => run(() => addItem({ accountId, name, plannedAmount, sortOrder: nextOrder }))}
        />

        {archived.map((item) => (
          <div key={item.id} className="setup-row setup-row--archived">
            <span>
              {item.name} <span className="muted">· archived</span>
            </span>
            <button type="button" className="small-button" disabled={busy} onClick={() => run(() => updateItem(item.id, { archived: false }))}>
              Restore
            </button>
          </div>
        ))}
      </main>
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
function ItemForm({ currency, initialName, initialPlan, submitLabel, busy, onSubmit, onCancel, clearAfterSubmit }) {
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
    </form>
  )
}
