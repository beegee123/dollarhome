import { useEffect, useState } from 'react'
import { formatMoney, parseBalance, targetPace } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Assign: give Unassigned money a home. One box per budget item in the account,
// with a "Fill" shortcut that tops the item up to its plan.
// Props:
//   account   — { name, unassigned: { id, balance }, items: [...] }
//   currency
//   onSave    — async function(allocations [{ categoryId, amount }]); throws on failure
//   onClose
export default function AssignSheet({ account, currency, onSave, onClose }) {
  const available = account.unassigned?.balance ?? 0
  const [values, setValues] = useState({}) // item id → typed amount
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const allocations = account.items
    .map((i) => ({ categoryId: i.id, amount: values[i.id]?.trim() ? parseBalance(values[i.id]) : 0 }))
    .filter((a) => a.amount !== 0)
  const invalid = allocations.some((a) => a.amount === null || a.amount < 0)
  const assigned = allocations.reduce((sum, a) => sum + (a.amount > 0 ? a.amount : 0), 0)
  const left = Math.round((available - assigned) * 100) / 100

  // Fill = what the item still needs to reach its plan, limited to what's left.
  function fill(item) {
    const already = parseBalance(values[item.id] ?? '') || 0
    // Monthly item: top up to the plan. Dated goal: this month's share of what's left.
    const need =
      item.target_type === 'by_date' && item.target_date
        ? targetPace(item.balance, item.planned_amount, item.target_date).perMonth
        : Math.max(0, item.planned_amount - item.balance)
    const amount = Math.min(need, left + already)
    setValues((v) => ({ ...v, [item.id]: amount > 0 ? String(Math.round(amount * 100) / 100) : '' }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (invalid) return setError('Each amount must be a number above 0.')
    if (allocations.length === 0) return setError('Enter an amount for at least one item.')
    if (left < 0) return setError(`That’s ${formatMoney(-left, currency)} more than Unassigned holds.`)
    setBusy(true)
    setError(null)
    try {
      await onSave(allocations)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--tall" role="dialog" aria-modal="true" aria-labelledby="assign-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="assign-title">Assign · {account.name}</h2>
          <span className="muted">
            <span className="money">{formatMoney(available, currency)}</span> unassigned
          </span>
        </div>

        <form className="spend-form" onSubmit={handleSubmit}>
          <div className="split-group">
            {account.items.length === 0 && <p className="muted empty--small">This account has no budget items yet.</p>}
            {account.items.map((item) => (
              <div key={item.id} className="split-line">
                <span>
                  {item.name}
                  <span className="muted split-plan">
                    {' '}
                    {formatMoney(item.balance, currency)} of {formatMoney(item.planned_amount, currency)}
                  </span>
                </span>
                <span className="split-input">
                  {item.planned_amount > item.balance && (
                    <button type="button" className="small-button" onClick={() => fill(item)} aria-label={`Fill ${item.name} to plan`}>
                      Fill
                    </button>
                  )}
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`${item.name} amount`}
                    value={values[item.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
                  />
                </span>
              </div>
            ))}
          </div>

          <p className={`split-total ${left < 0 ? 'match-off' : ''}`}>
            {left < 0 ? `Over by ${formatMoney(-left, currency)}` : `Still unassigned: ${formatMoney(left, currency)}`}
          </p>

          {error && <p className="notice" role="alert">{error}</p>}

          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || assigned === 0}>
              {busy ? 'Saving…' : `Assign ${formatMoney(assigned, currency)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
