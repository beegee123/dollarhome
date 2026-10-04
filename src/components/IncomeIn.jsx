import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { fetchSources } from '../api/income.js'
import { formatMoney, parseAmount, parseBalance, todayLocal } from '../lib/money.js'

// Payday: pick the source, check the amount, adjust any line, Apply.
// Props:
//   banks    — the Budget screen's data (banks → accounts → items), to name each line
//   onApply  — async function({ source, amount, receivedOn, note, lines, transfers }); throws on failure
//   onClose  — function
export default function IncomeIn({ banks, onApply, onClose }) {
  const [sources, setSources] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [sourceId, setSourceId] = useState(null)
  const [amountText, setAmountText] = useState('')
  const [receivedOn, setReceivedOn] = useState(todayLocal())
  const [note, setNote] = useState('')
  const [edits, setEdits] = useState({}) // budget item id → amount typed over the suggestion
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false
    fetchSources()
      .then((all) => !ignore && setSources(all.filter((s) => !s.archived)))
      .catch((err) => !ignore && setLoadError(err.message))
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Look up any budget item by id: its name and which account it's in.
  const itemInfo = useMemo(() => {
    const map = {}
    banks.forEach((b) =>
      b.accounts.forEach((a) => a.items.forEach((i) => (map[i.id] = { name: i.name, accountId: a.id, accountName: a.name }))),
    )
    return map
  }, [banks])

  const source = sources?.find((s) => s.id === sourceId)
  const currency = source?.account.bank.currency ?? 'USD'
  const fixedTotal = source ? source.lines.reduce((sum, l) => sum + l.value, 0) : 0

  function pickSource(s) {
    setSourceId(s.id)
    setEdits({})
    setError(null)
    // A fixed split suggests its usual total; a percent split waits for you to type the payout.
    setAmountText(s.split_type === 'fixed' ? String(s.lines.reduce((sum, l) => sum + l.value, 0)) : '')
  }

  const amount = parseAmount(amountText)

  // The suggested amount for each line, before any edits.
  //  fixed:   the saved dollar amount
  //  percent: that share of what came in, to the cent. Rounding leftovers go to Unassigned.
  const lines = (source?.lines ?? [])
    .filter((l) => itemInfo[l.category_id]) // skip items archived since the split was saved
    .map((l) => {
      const suggested =
        source.split_type === 'fixed' ? l.value : amount ? Math.floor(amount * l.value) / 100 : 0
      const typed = edits[l.category_id]
      const value = typed === undefined ? suggested : parseBalance(typed)
      return {
        ...itemInfo[l.category_id],
        category_id: l.category_id,
        percent: source.split_type === 'percent' ? l.value : null,
        suggested,
        typed,
        value,
        transfer: itemInfo[l.category_id].accountId !== source.account.id,
      }
    })

  const invalid = lines.some((l) => l.value === null || l.value < 0)
  const splitTotal = lines.reduce((sum, l) => sum + (l.value > 0 ? l.value : 0), 0)
  const leftover = amount ? Math.round((amount - splitTotal) * 100) / 100 : 0

  // Lines with 0 are simply skipped; the money stays in Unassigned.
  const toSend = lines.filter((l) => l.value > 0).map((l) => ({ category_id: l.category_id, value: l.value }))
  const transfers = Object.values(
    lines
      .filter((l) => l.transfer && l.value > 0)
      .reduce((acc, l) => {
        acc[l.accountId] = acc[l.accountId] ?? { accountName: l.accountName, amount: 0 }
        acc[l.accountId].amount += l.value
        return acc
      }, {}),
  )

  async function handleSubmit(event) {
    event.preventDefault()
    if (!source) return
    if (!amount) return setError('Enter the amount you received, like 2400')
    if (invalid) return setError('Each line must be a number (0 skips it).')
    if (leftover < 0) return setError(`The split is ${formatMoney(-leftover, currency)} more than you received. Lower a line.`)
    setBusy(true)
    setError(null)
    try {
      await onApply({ source, amount, receivedOn, note, lines: toSend, transfers })
    } catch (err) {
      setError(err.message || 'Couldn’t save. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--tall" role="dialog" aria-modal="true" aria-labelledby="income-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="income-title">Income in</h2>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>

        {loadError && <p className="notice">{loadError}</p>}
        {sources === null && !loadError && <p className="muted">Loading…</p>}
        {sources?.length === 0 && (
          <p className="empty">
            No income sources yet. <Link to="/setup/income">Set one up</Link> first.
          </p>
        )}

        {sources?.length > 0 && (
          <form className="spend-form" onSubmit={handleSubmit}>
            <fieldset className="chips">
              <legend>Which income?</legend>
              {sources.map((s) => (
                <label key={s.id} className={s.id === sourceId ? 'on' : ''}>
                  <input type="radio" name="source" checked={s.id === sourceId} onChange={() => pickSource(s)} />
                  {s.name}
                </label>
              ))}
            </fieldset>

            {source && (
              <>
                <p className="hint">
                  Lands in {source.account.bank.name} · {source.account.name} ·{' '}
                  {source.split_type === 'fixed' ? 'fixed split' : 'percent split'}
                </p>

                <div className="spend-row">
                  <label className="amount-field amount-field--grow">
                    <span>Amount received</span>
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={currency === 'CAD' ? 'C$0.00' : '$0.00'}
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value)}
                      autoFocus={source.split_type === 'percent'}
                    />
                  </label>
                  <label className="field field--date">
                    <span>Date</span>
                    <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} required />
                  </label>
                </div>
                {source.split_type === 'fixed' && amount && amount !== fixedTotal && (
                  <p className="hint">
                    Usual split is {formatMoney(fixedTotal, currency)}. The difference goes to Unassigned unless you
                    change a line.
                  </p>
                )}

                <div className="split-group">
                  <h3 className="section-title">Split · edit any line</h3>
                  {lines.length === 0 && <p className="muted empty--small">This source has no split lines. Everything goes to Unassigned.</p>}
                  {lines.map((l) => (
                    <label key={l.category_id} className="split-line">
                      <span>
                        {l.name}
                        <span className="muted split-plan">
                          {l.percent !== null && ` ${l.percent}%`}
                          {l.transfer && ` · ${l.accountName} (transfer)`}
                        </span>
                      </span>
                      <span className="split-input">
                        <span className="muted">{currency === 'CAD' ? 'C$' : '$'}</span>
                        <input
                          inputMode="decimal"
                          aria-label={`${l.name} amount`}
                          value={l.typed ?? (l.suggested ? String(l.suggested) : '')}
                          placeholder="0"
                          onChange={(e) => setEdits((v) => ({ ...v, [l.category_id]: e.target.value }))}
                        />
                      </span>
                    </label>
                  ))}
                </div>

                <label className="field">
                  <span>Note (optional)</span>
                  <input placeholder="e.g. includes overtime" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>

                <div className="income-summary">
                  <p className={leftover < 0 ? 'match-off' : ''}>
                    {leftover < 0
                      ? `Split is ${formatMoney(-leftover, currency)} more than received`
                      : `Left over → ${source.account.name} Unassigned: ${formatMoney(leftover, currency)}`}
                  </p>
                  {transfers.map((t) => (
                    <p key={t.accountName} className="hint">
                      Transfer {formatMoney(t.amount, currency)} to {t.accountName} — you’ll move it in your bank.
                    </p>
                  ))}
                </div>

                {error && <p className="notice" role="alert">{error}</p>}

                <button type="submit" className="primary" disabled={busy || !amount}>
                  {busy ? 'Applying…' : `Apply ${amount ? formatMoney(amount, currency) : ''}`}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
