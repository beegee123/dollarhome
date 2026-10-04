import { useEffect, useMemo, useState } from 'react'
import { formatMoney, parseAmount, todayLocal } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Move money from one budget item to another, in the SAME CURRENCY only
// (USD with USD, CAD with CAD). Once you pick one side, the other list only
// offers items in that currency.
// What kind of move it is depends on where the two items are:
//   same account     → a simple move
//   same bank        → a transfer between accounts (move it in your bank too)
//   different banks  → a bank transfer, with what was SENT and what ARRIVED (fees)
// Props:
//   banks    — Budget data (banks → accounts → items, plus each account's unassigned)
//   fromId   — the item to start from (optional)
//   onSave   — async function({ from, to, sent, received, kind, note, occurredOn, label }); throws on failure
//   onClose
export default function MoveSheet({ banks, fromId: initialFrom, onSave, onClose }) {
  // Every item, Unassigned included, with where it lives.
  const options = useMemo(() => {
    const list = []
    banks.forEach((b) =>
      b.accounts.forEach((a) => {
        if (a.kind === 'credit') return // a card's ledger isn't money you can move
        if (a.unassigned) list.push({ ...a.unassigned, name: 'Unassigned', bank: b, account: a })
        a.items.forEach((i) => list.push({ ...i, bank: b, account: a }))
      }),
    )
    return list
  }, [banks])

  const [fromId, setFromId] = useState(initialFrom ?? '')
  const [toId, setToId] = useState('')
  const [sentText, setSentText] = useState('')
  const [receivedText, setReceivedText] = useState('')
  const [note, setNote] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayLocal())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const from = options.find((o) => o.id === fromId)
  const to = options.find((o) => o.id === toId)
  const sent = parseAmount(sentText)

  let kind = null
  let label = ''
  if (from && to) {
    if (from.account.id === to.account.id) {
      kind = 'move'
      label = `Move within ${from.account.name}. Nothing changes at your bank.`
    } else if (from.bank.id === to.bank.id) {
      kind = 'transfer'
      label = `Transfer from ${from.account.name} to ${to.account.name}. Move the money in your ${from.bank.name} app too.`
    } else {
      kind = 'bank'
      label = `Bank transfer ${from.bank.name} → ${to.bank.name}. If fees were taken, enter what arrived.`
    }
  }
  const crossBank = kind === 'bank'
  // Between banks, what arrived can be less than what was sent (fees). Blank = the same.
  const received = crossBank && receivedText.trim() ? parseAmount(receivedText) : sent

  const group = (o) => `${o.bank.name} · ${o.account.name}`

  async function handleSubmit(event) {
    event.preventDefault()
    if (!from || !to) return setError('Choose where the money comes from and where it goes.')
    if (from.id === to.id) return setError('Pick two different items.')
    if (!sent) return setError('Enter the amount, like 50')
    if (from.bank.currency !== to.bank.currency) return setError('Money can only move between items in the same currency.')
    if (crossBank && !received) return setError('Enter the amount that arrived, like 495')
    setBusy(true)
    setError(null)
    try {
      await onSave({
        from,
        to,
        sent,
        received,
        kind: kind === 'move' ? 'move' : 'transfer',
        note,
        occurredOn,
        needsBankStep: kind !== 'move',
      })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  // A <select> of every item, grouped by "Bank · Account".
  //   currency — when set, only items in that currency are offered
  function ItemSelect({ value, onChange, label: selectLabel, exclude, currency }) {
    const groups = {}
    options.forEach((o) => {
      if (o.id === exclude) return
      if (currency && o.bank.currency !== currency) return
      ;(groups[group(o)] ??= []).push(o)
    })
    return (
      <label className="field">
        <span>{selectLabel}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} required>
          <option value="">Choose…</option>
          {Object.entries(groups).map(([name, opts]) => (
            <optgroup key={name} label={name}>
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({formatMoney(o.balance, o.bank.currency)})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    )
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--tall" role="dialog" aria-modal="true" aria-labelledby="move-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="move-title">Move money</h2>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="spend-form source-form" onSubmit={handleSubmit}>
          {ItemSelect({ value: fromId, onChange: setFromId, label: 'From', exclude: toId, currency: to?.bank.currency })}
          {ItemSelect({ value: toId, onChange: setToId, label: 'To', exclude: fromId, currency: from?.bank.currency })}
          {(from || to) && (
            <p className="hint">Only {(from ?? to).bank.currency} items are listed — money moves within one currency.</p>
          )}

          {label && <p className="hint">{label}</p>}

          <div className="spend-row">
            <label className="amount-field amount-field--grow">
              <span>{crossBank ? 'Sent' : 'Amount'}</span>
              <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={sentText} onChange={(e) => setSentText(e.target.value)} />
            </label>
            {crossBank && (
              <label className="amount-field amount-field--grow">
                <span>Arrived</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={sent ? String(sent) : '0.00'}
                  value={receivedText}
                  onChange={(e) => setReceivedText(e.target.value)}
                />
              </label>
            )}
          </div>

          {from && sent && sent > from.balance && (
            <p className="hint match-off">
              {from.name} only holds {formatMoney(from.balance, from.bank.currency)}; this leaves it below zero.
            </p>
          )}

          <div className="spend-row">
            <label className="field">
              <span>Note (optional)</span>
              <input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="field field--date">
              <span>Date</span>
              <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
            </label>
          </div>

          {error && <p className="notice" role="alert">{error}</p>}

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Move'}
          </button>
        </form>
      </div>
    </div>
  )
}
