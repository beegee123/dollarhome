import { useEffect, useState } from 'react'
import { formatMoney, parseAmount, todayLocal } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Pay a credit card from its payment envelope.
// Props: card { name, owed }, envelope { name, balance, accountName }, currency, onSave({ amount, paidOn }), onClose
export default function PayCardSheet({ card, envelope, currency, onSave, onClose }) {
  // Suggest paying it all, or whatever the envelope holds if that's less.
  const suggested = Math.max(0, Math.min(card.owed, envelope.balance))
  const [text, setText] = useState(suggested > 0 ? String(suggested) : '')
  const [paidOn, setPaidOn] = useState(todayLocal())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const amount = parseAmount(text)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="paycard-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="paycard-title">Pay {card.name}</h2>
          <span className="muted">
            owes <span className="money">{formatMoney(card.owed, currency)}</span>
          </span>
        </div>
        <form
          className="spend-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!amount) return setError('Enter the payment, like 640')
            if (amount > card.owed) return setError(`That’s more than the ${formatMoney(card.owed, currency)} owed.`)
            setBusy(true)
            setError(null)
            try {
              await onSave({ amount, paidOn })
            } catch (err) {
              setError(friendlyError(err))
              setBusy(false)
            }
          }}
        >
          <div className="spend-row">
            <label className="amount-field amount-field--grow">
              <span>Payment</span>
              <input inputMode="decimal" autoFocus placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <label className="field field--date">
              <span>Date</span>
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
            </label>
          </div>
          <p className="after-line">
            From {envelope.name} in {envelope.accountName} (holds {formatMoney(envelope.balance, currency)}).
            {amount ? ` The card will owe ${formatMoney(card.owed - amount, currency)}.` : ''}
          </p>
          {amount && amount > envelope.balance && (
            <p className="hint match-off">
              {envelope.name} only holds {formatMoney(envelope.balance, currency)}. The rest wasn’t budgeted — it will
              go below zero. Move money into it first if you can.
            </p>
          )}
          <p className="hint">Make the same payment in your bank app; then {envelope.accountName} still matches.</p>
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Pay card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
