import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fetchBudget } from '../api/budget.js'
import { addWish, deleteWish, fetchWishlist, markBought, unbuy, updateWish } from '../api/wishlist.js'
import { formatMoney, parseAmount, shortDate, todayLocal } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Wishlist: tap items to select them; the bottom panel checks each envelope
// has enough, then Mark bought turns them into spends.
export default function WishlistScreen() {
  const [wishes, setWishes] = useState(null) // null = loading
  const [banks, setBanks] = useState(null) // budget data, for envelopes and balances
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [editingId, setEditingId] = useState(null) // an item id, 'new', or null
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchWishlist(), fetchBudget()])
      .then(([w, b]) => {
        if (ignore) return
        setWishes(w)
        setBanks(b)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [reloadCount])

  // Every envelope (budget item) by id, with its balance, account, bank and currency.
  const envelopes = useMemo(() => {
    const map = {}
    banks?.forEach((b) =>
      b.accounts.forEach((a) =>
        a.items.forEach((i) => (map[i.id] = { ...i, accountName: a.name, bankName: b.name, currency: b.currency })),
      ),
    )
    return map
  }, [banks])

  function showToast(text, undo) {
    clearTimeout(toastTimer.current)
    setToast({ text, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

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
        <p>Couldn’t load your wishlist.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={reload}>
          Try again
        </button>
      </div>
    )
  }
  if (wishes === null) return <div className="screen center-message muted">Loading…</div>

  const open = wishes.filter((w) => !w.bought_at)
  const bought = wishes.filter((w) => w.bought_at).sort((a, b) => b.bought_at.localeCompare(a.bought_at))
  const chosen = open.filter((w) => selected.has(w.id))

  // Group the selected items by envelope: what they need vs what the envelope holds.
  const groups = {}
  chosen.forEach((w) => {
    const key = w.category_id ?? 'none'
    groups[key] ??= { envelope: envelopes[w.category_id], need: 0, items: [] }
    groups[key].need += w.amount
    groups[key].items.push(w)
  })
  const groupList = Object.values(groups)
  const shortCount = groupList.filter((g) => !g.envelope || g.envelope.balance < g.need).length
  const missingEnvelope = groupList.some((g) => !g.envelope)

  // Totals per currency, never added across currencies: "$440 + C$190".
  const byCurrency = {}
  groupList.forEach((g) => {
    const c = g.envelope?.currency ?? 'USD'
    byCurrency[c] = (byCurrency[c] ?? 0) + g.need
  })
  const totalText = Object.entries(byCurrency)
    .map(([c, n]) => formatMoney(n, c))
    .join(' + ')

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function buySelected() {
    if (missingEnvelope) return setActionError('Pick an envelope for every selected item first (tap Edit).')
    if (shortCount > 0 && !window.confirm('Some envelopes don’t have enough. Mark bought anyway? They’ll go below zero.')) return
    const ids = chosen.map((w) => w.id)
    const ok = await run(() => markBought(ids, todayLocal()))
    if (ok) {
      setSelected(new Set())
      showToast(`Marked ${ids.length} bought · ${totalText}`, async () => {
        setToast(null)
        await run(() => Promise.all(ids.map((id) => unbuy(id))))
      })
    }
  }

  return (
    <div className="screen screen--wishlist">
      <header className="screen-header screen-header--sub">
        <Link to="/" className="back-link">
          ← Budget
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Wishlist</h1>
      </header>

      <p className="muted setup-intro">Tap items to see if their envelopes can cover them yet.</p>

      {actionError && <p className="notice" role="alert">{actionError}</p>}

      <main className="wish-list">
        {open.length === 0 && editingId !== 'new' && <p className="empty">Nothing on your wishlist yet.</p>}

        {open.map((w) => {
          const env = envelopes[w.category_id]
          if (editingId === w.id) {
            return (
              <WishForm
                key={w.id}
                banks={banks}
                initial={w}
                busy={busy}
                onCancel={() => setEditingId(null)}
                onSave={async (fields) => (await run(() => updateWish(w.id, fields))) && setEditingId(null)}
                onDelete={async () => {
                  if (!window.confirm(`Remove ${w.name} from your wishlist?`)) return
                  setSelected((s) => {
                    const next = new Set(s)
                    next.delete(w.id)
                    return next
                  })
                  if (await run(() => deleteWish(w.id))) setEditingId(null)
                }}
              />
            )
          }
          const on = selected.has(w.id)
          return (
            <div key={w.id} className={`wish-row ${on ? 'wish-row--on' : ''}`}>
              <button type="button" className="wish-pick" aria-pressed={on} onClick={() => toggle(w.id)}>
                <span className="wish-box" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="setup-row-main">
                  <span className="setup-row-name">{w.name}</span>
                  <span className="muted setup-row-sub">
                    {env ? `From ${env.name} · ${env.bankName} ${env.accountName}` : 'No envelope — tap Edit'}
                  </span>
                </span>
                <span className="money wish-price">{formatMoney(w.amount, env?.currency ?? 'USD')}</span>
              </button>
              <button type="button" className="link-button wish-edit" onClick={() => setEditingId(w.id)} aria-label={`Edit ${w.name}`}>
                Edit
              </button>
            </div>
          )
        })}

        {editingId === 'new' ? (
          <WishForm
            banks={banks}
            initial={null}
            busy={busy}
            onCancel={() => setEditingId(null)}
            onSave={async (fields) =>
              (await run(() =>
                addWish({ ...fields, sortOrder: Math.max(-1, ...wishes.map((w) => w.sort_order)) + 1 }),
              )) && setEditingId(null)
            }
          />
        ) : (
          <button type="button" className="link-button add-link" onClick={() => setEditingId('new')}>
            + Add to wishlist
          </button>
        )}

        {bought.length > 0 && (
          <details className="archived">
            <summary>Bought ({bought.length})</summary>
            {bought.map((w) => (
              <div key={w.id} className="setup-row setup-row--archived">
                <span>
                  {w.name} · <span className="money">{formatMoney(w.amount, envelopes[w.category_id]?.currency ?? 'USD')}</span>
                  <span className="muted"> · {shortDate(w.bought_at.slice(0, 10))}</span>
                </span>
                <button
                  type="button"
                  className="small-button"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Put ${w.name} back on the wishlist? Its spend will be removed.`) && run(() => unbuy(w.id))
                  }
                >
                  Put back
                </button>
              </div>
            ))}
          </details>
        )}
      </main>

      {/* Bottom panel: only while something is selected. */}
      {chosen.length > 0 && (
        <div className="wish-panel" role="region" aria-label="Selected items">
          <div className="wish-panel-head">
            <span>
              {chosen.length} {chosen.length === 1 ? 'item' : 'items'} selected
            </span>
            <span className="money strong">{totalText}</span>
          </div>
          {groupList.map((g) => (
            <div key={g.envelope?.id ?? 'none'} className="wish-env">
              <span>
                <strong>{g.envelope?.name ?? 'No envelope'}</strong>
                {g.envelope && <span className="muted"> · {g.envelope.bankName} {g.envelope.accountName}</span>}
              </span>
              {g.envelope ? (
                <span className="wish-env-status">
                  <span className="money">
                    {formatMoney(g.need, g.envelope.currency)} of {formatMoney(g.envelope.balance, g.envelope.currency)}
                  </span>
                  {g.envelope.balance >= g.need ? (
                    <strong className="match-ok"> Enough</strong>
                  ) : (
                    <strong className="match-off"> Short {formatMoney(g.need - g.envelope.balance, g.envelope.currency)}</strong>
                  )}
                </span>
              ) : (
                <strong className="match-off">Pick one</strong>
              )}
            </div>
          ))}
          <p className={`wish-verdict ${shortCount === 0 ? 'wish-verdict--ok' : 'wish-verdict--short'}`}>
            {shortCount === 0
              ? 'Ready — every envelope covers its items'
              : `${shortCount} ${shortCount === 1 ? 'envelope is' : 'envelopes are'} short — not yet`}
          </p>
          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button type="button" className="primary" disabled={busy} onClick={buySelected}>
              Mark bought
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="toast-undo" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Add or edit one wishlist item: name, amount, envelope, note.
function WishForm({ banks, initial, busy, onSave, onCancel, onDelete }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState(null)

  return (
    <form
      className="add-account wish-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const amount = parseAmount(amountText)
        if (!name.trim()) return
        if (!amount) return setError('Enter the price, like 120')
        if (!categoryId) return setError('Pick the envelope it will come from.')
        setError(null)
        await onSave({ name, amount, categoryId, note })
      }}
    >
      <div className="spend-row">
        <label className="field">
          <span>Item</span>
          <input placeholder="e.g. Air fryer" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--plan">
          <span>Price</span>
          <input inputMode="decimal" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Comes from (envelope)</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="field-select">
          <option value="">Choose…</option>
          {banks.map((b) =>
            b.accounts.map((a) =>
              a.items.length === 0 ? null : (
                <optgroup key={a.id} label={`${b.name} · ${a.name} (${b.currency})`}>
                  {a.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({formatMoney(i.balance, b.currency)})
                    </option>
                  ))}
                </optgroup>
              ),
            ),
          )}
        </select>
      </label>
      <label className="field">
        <span>Note (optional)</span>
        <input placeholder="e.g. wait for a sale" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="notice">{error}</p>}
      <div className="inline-form">
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          {initial ? 'Save' : 'Add'}
        </button>
        <button type="button" className="small-button" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="small-button small-button--danger" disabled={busy} onClick={onDelete}>
            Remove
          </button>
        )}
      </div>
    </form>
  )
}
