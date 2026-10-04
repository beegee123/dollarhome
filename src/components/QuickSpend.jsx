import { useEffect, useRef, useState } from 'react'
import { deletePairs, deleteTransaction, fetchRecent } from '../api/transactions.js'
import { formatMoney, parseAmount, shortDate, todayLocal } from '../lib/money.js'

const KIND_LABELS = { income: 'Income', spend: 'Spent', move: 'Moved', transfer: 'Transfer', opening: 'Starting balance' }

// The panel that slides up when you tap a budget item.
// Props:
//   item      — the budget item (name, balance, id)
//   currency  — 'USD' or 'CAD'
//   onSave    — async function({ amount, note, occurredOn }); throws if saving failed
//   onClose   — function, closes the panel
//   onMove    — function, switches to Move money starting from this item
//   onDeleted — function(amount), after a past spend was deleted (amount is negative)
//   cards     — credit cards in this currency, for "Paid with"
//   onPairDeleted — function, after a card spend (several rows) was deleted
export default function QuickSpend({ item, currency, onSave, onClose, onMove, onDeleted, cards = [], onPairDeleted }) {
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayLocal())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [recent, setRecent] = useState(null)
  const [cardId, setCardId] = useState('') // '' = paid from the bank account (debit/cash)
  const [recentError, setRecentError] = useState(null)
  const amountRef = useRef(null)

  // Put the cursor in the amount box right away, so you can just type.
  useEffect(() => amountRef.current?.focus(), [])

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load this item's recent activity.
  useEffect(() => {
    let ignore = false
    fetchRecent(item.id)
      .then((rows) => !ignore && setRecent(rows))
      .catch(() => !ignore && setRecent([]))
    return () => {
      ignore = true
    }
  }, [item.id])

  const amount = parseAmount(amountText)
  const after = item.balance - (amount ?? 0)

  async function handleSubmit(event) {
    event.preventDefault()
    if (amount === null) {
      setError('Enter an amount, like 48.20')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({ amount, note, occurredOn, cardId: cardId || null })
      // On success the screen closes this panel.
    } catch {
      setError('Couldn’t save. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    // Clicking the dimmed background closes; clicks inside the sheet don't reach it.
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spend-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />

        <div className="sheet-head">
          <h2 id="spend-title">{item.name}</h2>
          <span className="muted">
            <span className="money">{formatMoney(item.balance, currency)}</span> left
          </span>
        </div>

        <form className="spend-form" onSubmit={handleSubmit}>
          <label className="amount-field">
            <span>Spent</span>
            <input
              ref={amountRef}
              inputMode="decimal" // phones show the number pad with a decimal point
              autoComplete="off"
              placeholder={currency === 'CAD' ? 'C$0.00' : '$0.00'}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </label>

          <div className="spend-row">
            <label className="field">
              <span>Note (optional)</span>
              <input
                placeholder="e.g. Costco run"
                maxLength={120}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="field field--date">
              <span>Date</span>
              <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
            </label>
          </div>

          {/* Paid with: only shown when you have a card in this currency. */}
          {cards.length > 0 && (
            <fieldset className="chips">
              <legend>Paid with</legend>
              <label className={cardId === '' ? 'on' : ''}>
                <input type="radio" name="paid-with" checked={cardId === ''} onChange={() => setCardId('')} />
                Debit / cash
              </label>
              {cards.map((c) => (
                <label key={c.id} className={cardId === c.id ? 'on' : ''}>
                  <input type="radio" name="paid-with" checked={cardId === c.id} onChange={() => setCardId(c.id)} />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
          {cardId && (
            <p className="hint">
              The money moves into {cards.find((c) => c.id === cardId)?.name}’s payment envelope, ready for the bill.
            </p>
          )}

          <p className={`after-line ${after < 0 ? 'after-negative' : ''}`}>
            After this: <span className="money">{formatMoney(after, currency)}</span> left
            {after < 0 && ' — more than this item holds'}
          </p>

          {error && <p className="notice" role="alert">{error}</p>}

          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Log spend'}
            </button>
          </div>
          {onMove && (
            <button type="button" className="link-button add-link" onClick={onMove}>
              Move money from {item.name} instead →
            </button>
          )}
        </form>

        <div className="recent">
          <h3 className="section-title">Recent in {item.name}</h3>
          {recent === null && <p className="muted empty--small">Loading…</p>}
          {recent?.length === 0 && <p className="muted empty--small">Nothing yet.</p>}
          {recentError && <p className="notice">{recentError}</p>}
          {recent?.map((t) => (
            <div key={t.id} className="recent-row">
              <span>
                {shortDate(t.occurred_on)} · {t.note || KIND_LABELS[t.kind]}
              </span>
              <span className="recent-right">
                <span className={`money ${t.amount < 0 ? '' : 'money-in'}`}>
                  {t.amount > 0 ? '+' : ''}
                  {formatMoney(t.amount, currency)}
                </span>
                {/* Only plain spends can be deleted here. Income, moves and transfers
                    are part of a paycheck or a pair, so they're undone where they were made. */}
                {t.kind === 'spend' && (
                  <button
                    type="button"
                    className="link-button recent-delete"
                    aria-label={`Delete ${formatMoney(t.amount, currency)} spend`}
                    onClick={async () => {
                      if (!window.confirm(`Delete this ${formatMoney(-t.amount, currency)} spend? ${item.name} gets it back.`)) return
                      setRecentError(null)
                      try {
                        if (t.pair_id) {
                          // A card spend: remove all its rows (item, payment envelope, card).
                          await deletePairs([t.pair_id])
                          setRecent((rows) => rows.filter((r) => r.id !== t.id))
                          onPairDeleted?.()
                          onClose()
                          return
                        }
                        await deleteTransaction(t.id)
                        setRecent((rows) => rows.filter((r) => r.id !== t.id))
                        onDeleted?.(t.amount)
                      } catch {
                        setRecentError('Couldn’t delete. Check your connection and try again.')
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
