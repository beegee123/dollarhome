import { useEffect, useRef, useState } from 'react'
import { formatMoney, parseBalance } from '../lib/money.js'

// "Update bank balance": type what your bank's app shows for this account.
// Props:
//   account   — { name, bank_balance, total } (total = what DollarHome holds, Unassigned included)
//   currency  — 'USD' or 'CAD'
//   onSave    — async function(amount); throws if saving failed
//   onClose   — function
export default function BalanceSheet({ account, currency, onSave, onClose }) {
  // For a credit card the numbers are what's OWED: the statement vs what DollarHome says the card owes.
  const isCard = account.kind === 'credit'
  const held = isCard ? (account.owed ?? -account.total) : account.total
  const [text, setText] = useState(String(account.bank_balance))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select() // select the old number so typing replaces it
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const amount = parseBalance(text)
  const diff = amount === null ? null : Math.round((amount - held) * 100) / 100

  async function handleSubmit(event) {
    event.preventDefault()
    if (amount === null) {
      setError('Enter the balance, like 1865.40')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(amount)
    } catch {
      setError('Couldn’t save. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="balance-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="balance-title">{account.name}</h2>
          <span className="muted">{isCard ? 'Update statement balance' : 'Update bank balance'}</span>
        </div>

        <form className="spend-form" onSubmit={handleSubmit}>
          <label className="amount-field">
            <span>{isCard ? 'Your card app says you owe' : 'Your bank says'}</span>
            <input
              ref={inputRef}
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>

          <p className="after-line">
            {isCard ? 'DollarHome says this card owes ' : 'DollarHome holds '}
            <span className="money">{formatMoney(held, currency)}</span>
            {isCard ? '.' : ' in this account.'}
            {diff === 0 && <strong className="match-ok"> They match.</strong>}
            {diff !== null && diff !== 0 && (
              <strong className="match-off">
                {' '}
                {isCard ? 'The card app shows' : 'The bank has'} {formatMoney(Math.abs(diff), currency)} {diff > 0 ? 'more' : 'less'}.
              </strong>
            )}
          </p>
          {!isCard && diff !== null && diff < 0 && (
            <p className="hint">Less in the bank usually means a spend you haven’t logged yet.</p>
          )}
          {!isCard && diff !== null && diff > 0 && (
            <p className="hint">More in the bank usually means income you haven’t added yet.</p>
          )}
          {isCard && diff !== null && diff > 0 && (
            <p className="hint">Owing more usually means a card purchase you haven’t logged, or interest.</p>
          )}
          {isCard && diff !== null && diff < 0 && (
            <p className="hint">Owing less usually means a payment or refund you haven’t logged.</p>
          )}

          {error && <p className="notice" role="alert">{error}</p>}

          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save balance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
