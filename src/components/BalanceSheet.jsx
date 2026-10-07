import { useEffect, useRef, useState } from 'react'
import { formatMoney, parseBalance, shortDate } from '../lib/money.js'
import { fetchMovesSinceCheck } from '../api/transactions.js'

// "Update bank balance": type what your bank's app shows for this account.
// Props:
//   account   — { name, bank_balance, total } (total = what DollarHome holds, Unassigned included)
//   currency  — 'USD' or 'CAD'
//   onSave    — async function(amount); throws if saving failed
//   onAdjust  — async function(amount, change): save AND add `change` to Unassigned (optional)
//   onClose   — function
export default function BalanceSheet({ account, currency, onSave, onAdjust, onClose }) {
  // For a credit card the numbers are what's OWED: the statement vs what DollarHome says the card owes.
  const isCard = account.kind === 'credit'
  const held = isCard ? (account.owed ?? -account.total) : account.total
  const [text, setText] = useState(String(account.bank_balance))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const [moves, setMoves] = useState([])
  const [movesInfo, setMovesInfo] = useState({ state: 'loading' })
  const [ticked, setTicked] = useState({})
  const startBalance = useRef(Number(account.bank_balance) || 0)

  // Moves since the last update, as tick boxes (cash accounts only).
  useEffect(() => {
    if (isCard || !account.id) return
    let live = true
    fetchMovesSinceCheck(account.id)
      .then((r) => {
        if (!live) return
        setMoves(r.list)
        setMovesInfo({ state: 'ok', since: r.since, hadCheck: r.hadCheck })
      })
      .catch((e) => live && setMovesInfo({ state: 'error', message: e?.message || String(e) }))
    return () => { live = false }
  }, [account.id, isCard])

  function toggleMove(m) {
    const next = { ...ticked, [m.pairId]: !ticked[m.pairId] }
    setTicked(next)
    const sum = moves.reduce((acc, x) => acc + (next[x.pairId] ? x.net : 0), 0)
    setText(String(Math.round((startBalance.current + sum) * 100) / 100))
  }

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

  // What to add to Unassigned so DollarHome matches. For a card, owing MORE means its
  // ledger goes further below zero, so the change is the other way round.
  const change = diff === null ? 0 : isCard ? -diff : diff

  async function handleAdjust() {
    if (amount === null) {
      setError('Enter the balance, like 1865.40')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAdjust(amount, change)
    } catch {
      setError('Couldn’t save. Check your connection and try again.')
      setBusy(false)
    }
  }

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

          {!isCard && movesInfo.state === 'error' && (
            <p className="hint">Couldn’t load recent moves: {movesInfo.message}</p>
          )}
          {!isCard && movesInfo.state === 'ok' && moves.length === 0 && (
            <p className="hint">
              No moves to tick since {movesInfo.hadCheck ? 'you last updated this balance' : 'the last 14 days'} ({shortDate(movesInfo.since.slice(0, 10))}).
            </p>
          )}
          {!isCard && moves.length > 0 && (
            <fieldset className="moves-box">
              <legend className="field-label">Moved since you last updated</legend>
              <p className="hint">Tick a move to add or subtract it from your last balance.</p>
              {moves.map((m) => (
                <label key={m.pairId} className="move-row">
                  <input type="checkbox" checked={!!ticked[m.pairId]} onChange={() => toggleMove(m)} />
                  <span>{shortDate(m.date)} · {m.label}</span>
                  <span className="money">{m.net > 0 ? '+' : '−'}{formatMoney(Math.abs(m.net), currency)}</span>
                </label>
              ))}
            </fieldset>
          )}

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

          {/* When they disagree and you know DollarHome is the one that's wrong (old sample
              numbers, a restart, something never logged), adjust Unassigned to match. */}
          {onAdjust && diff !== null && diff !== 0 && (
            <div className="adjust-box">
              <p className="hint">
                Know the bank is right? Adjust {isCard ? 'what DollarHome says the card owes' : 'Unassigned'} by{' '}
                <strong>
                  {change > 0 ? '+' : '−'}
                  {formatMoney(Math.abs(change), currency)}
                </strong>{' '}
                so they match. Logging the missing spend or income instead keeps your history more accurate.
              </p>
              <button type="button" className="secondary adjust-button" disabled={busy} onClick={handleAdjust}>
                Save and adjust to match
              </button>
            </div>
          )}

          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save balance only'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
