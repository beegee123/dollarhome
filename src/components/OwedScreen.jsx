import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import Celebration from './Celebration.jsx'
import { fetchBudget } from '../api/budget.js'
import { addDebt, deleteDebt, fetchDebts, payDebt, unpayDebt, updateDebt } from '../api/owed.js'
import { friendlyError } from '../lib/errors.js'
import { formatMoney, monthYear, parseAmount, parseBalance, shortDate, todayLocal } from '../lib/money.js'

// Owed: loans and tax bills. Each is paid from an envelope; paying lowers what's owed.
export default function OwedScreen() {
  const [debts, setDebts] = useState(null)
  const [banks, setBanks] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null) // a debt id, 'new', or null
  const [paying, setPaying] = useState(null) // the debt being paid
  const [updating, setUpdating] = useState(null) // the debt whose amount owed is being updated
  const [celebrating, setCelebrating] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchDebts(), fetchBudget()])
      .then(([d, b]) => {
        if (ignore) return
        setDebts(d)
        setBanks(b)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [reloadCount])

  // Every envelope by id, with its bank's currency and balance.
  const envelopes = useMemo(() => {
    const map = {}
    banks?.forEach((b) =>
      b.accounts.forEach((a) =>
        a.items.forEach((i) => (map[i.id] = { ...i, accountName: a.name, bankName: b.name, currency: b.currency })),
      ),
    )
    return map
  }, [banks])

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

  function showToast(text, undo) {
    clearTimeout(toastTimer.current)
    setToast({ text, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load what you owe.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={reload}>
          Try again
        </button>
      </div>
    )
  }
  if (debts === null) return <div className="screen center-message muted">Loading…</div>

  const open = debts.filter((d) => !d.paid_off_at)
  const paidOff = debts.filter((d) => d.paid_off_at)
  const loans = open.filter((d) => d.kind === 'loan')
  const taxes = open.filter((d) => d.kind === 'tax').sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

  // Totals owed, per currency.
  const totals = {}
  open.forEach((d) => (totals[d.currency] = (totals[d.currency] ?? 0) + d.amount_owed))
  const totalText = Object.entries(totals)
    .map(([c, n]) => formatMoney(n, c))
    .join(' + ')

  async function savePayment(debt, { amount, paidOn, note }) {
    const txId = await payDebt({ debtId: debt.id, amount, paidOn, note })
    setPaying(null)
    reload()
    if (amount >= debt.amount_owed) {
      setCelebrating(debt)
    } else {
      showToast(`Paid ${formatMoney(amount, debt.currency)} toward ${debt.name}`, async () => {
        setToast(null)
        await run(() => unpayDebt(txId))
      })
    }
  }

  const card = (d) => (
    <DebtCard
      key={d.id}
      debt={d}
      envelope={envelopes[d.category_id]}
      busy={busy}
      onPay={() => setPaying(d)}
      onUpdate={() => setUpdating(d)}
      onEdit={() => setEditingId(d.id)}
    />
  )

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Owed</h1>
      </header>

      <p className="month-income">
        Total owed: <span className="money strong">{totalText || formatMoney(0)}</span>
      </p>
      <p className="muted setup-intro">
        Loans and tax bills. Each one is paid from an envelope, so the money for it is set aside in your budget.
      </p>

      {actionError && <p className="notice" role="alert">{actionError}</p>}

      <main className="analytics">
        {editingId && editingId !== 'new' ? (
          <DebtForm
            banks={banks}
            initial={debts.find((d) => d.id === editingId)}
            busy={busy}
            onCancel={() => setEditingId(null)}
            onSave={async (f) =>
              (await run(() =>
                updateDebt(editingId, {
                  name: f.name.trim(),
                  kind: f.kind,
                  currency: f.currency,
                  category_id: f.categoryId,
                  original_amount: f.originalAmount,
                  due_date: f.dueDate || null,
                }),
              )) && setEditingId(null)
            }
            onDelete={async () => {
              if (!window.confirm('Delete this from Owed? Past payments stay as spends in your budget.')) return
              if (await run(() => deleteDebt(editingId))) setEditingId(null)
            }}
          />
        ) : null}

        <section className="card">
          <h2>Loans</h2>
          {loans.length === 0 && <p className="card-sub">No loans. Nice.</p>}
          {loans.map(card)}
        </section>

        <section className="card">
          <h2>Taxes & bills</h2>
          {taxes.length === 0 && <p className="card-sub">Nothing due.</p>}
          {taxes.map(card)}
        </section>

        {editingId === 'new' ? (
          <DebtForm
            banks={banks}
            initial={null}
            busy={busy}
            onCancel={() => setEditingId(null)}
            onSave={async (f) =>
              (await run(() =>
                addDebt({ ...f, sortOrder: Math.max(-1, ...debts.map((d) => d.sort_order)) + 1 }),
              )) && setEditingId(null)
            }
          />
        ) : (
          <button type="button" className="link-button add-link" onClick={() => setEditingId('new')}>
            + Add a loan or tax bill
          </button>
        )}

        {paidOff.length > 0 && (
          <details className="archived">
            <summary>Paid off ({paidOff.length})</summary>
            {paidOff.map((d) => (
              <div key={d.id} className="setup-row setup-row--archived">
                <span>
                  {d.name} · <span className="money">{formatMoney(d.original_amount, d.currency)}</span>
                  <span className="muted"> · {shortDate(d.paid_off_at.slice(0, 10))}</span>
                </span>
                <button type="button" className="small-button" onClick={() => setEditingId(d.id)}>
                  Edit
                </button>
              </div>
            ))}
          </details>
        )}
      </main>

      {paying && (
        <PaySheet
          debt={paying}
          envelope={envelopes[paying.category_id]}
          onClose={() => setPaying(null)}
          onSave={(fields) => savePayment(paying, fields)}
        />
      )}

      {updating && (
        <UpdateOwedSheet
          debt={updating}
          onClose={() => setUpdating(null)}
          onSave={async (amount) => {
            await updateDebt(updating.id, { amount_owed: amount })
            setUpdating(null)
            reload()
          }}
        />
      )}

      {celebrating && (
        <Celebration
          goal={{ name: celebrating.name, planned_amount: celebrating.original_amount, target_date: null }}
          currency={celebrating.currency}
          title="Paid off!"
          verb="paid off"
          onClose={() => setCelebrating(null)}
        />
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

// One loan or tax bill.
function DebtCard({ debt, envelope, busy, onPay, onUpdate, onEdit }) {
  const c = debt.currency
  const paid = Math.max(0, debt.original_amount - debt.amount_owed)
  const pct = debt.original_amount > 0 ? Math.min(100, (paid / debt.original_amount) * 100) : 0

  // Due date wording for tax bills: "Due Jan 31 · in 4 months", "Due in 12 days", "Overdue".
  let due = null
  if (debt.due_date) {
    const [y, m, d] = debt.due_date.split('-').map(Number)
    const days = Math.round((new Date(y, m - 1, d) - new Date(new Date().toDateString())) / 86400000)
    const when = days < 0 ? 'Overdue' : days === 0 ? 'Due today' : days <= 45 ? `Due in ${days} ${days === 1 ? 'day' : 'days'}` : `Due ${monthYear(debt.due_date)}`
    due = { text: `${shortDate(debt.due_date)} · ${when}`, tone: days < 0 ? 'match-off' : days <= 30 ? 'over-text' : 'muted' }
  }
  const ready = envelope && envelope.balance >= debt.amount_owed

  return (
    <div className="debt">
      <div className="spend-bar-top">
        <button type="button" className="link-button debt-name" onClick={onEdit}>
          {debt.name}
        </button>
        <span className="spend-bar-nums">
          <span className="money strong">{formatMoney(debt.amount_owed, c)}</span>
          <span className="muted"> owed</span>
        </span>
      </div>

      {debt.kind === 'loan' && debt.original_amount > 0 && (
        <>
          <div className="spend-track" role="img" aria-label={`${formatMoney(paid, c)} paid of ${formatMoney(debt.original_amount, c)}`}>
            <div className="spend-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="muted debt-sub">
            {formatMoney(paid, c)} paid of {formatMoney(debt.original_amount, c)}
          </span>
        </>
      )}

      {due && <span className={`debt-sub ${due.tone}`}>{due.text}</span>}

      <span className="muted debt-sub">
        {envelope ? (
          <>
            Pays from {envelope.name} · holds <span className="money">{formatMoney(envelope.balance, c)}</span>
            {debt.kind === 'tax' && (ready ? <strong className="match-ok"> · ready</strong> : <strong className="over-text"> · {formatMoney(debt.amount_owed - Math.max(0, envelope.balance), c)} short</strong>)}
          </>
        ) : (
          'No envelope — tap the name to pick one'
        )}
      </span>

      <div className="row-actions">
        <button type="button" className="small-button" disabled={busy || !envelope} onClick={onPay}>
          Pay
        </button>
        <button type="button" className="small-button" disabled={busy} onClick={onUpdate}>
          Update owed
        </button>
      </div>
    </div>
  )
}

// Add or edit: name, loan or tax, the envelope it's paid from, amounts, due date.
function DebtForm({ banks, initial, busy, onSave, onCancel, onDelete }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState(initial?.kind ?? 'loan')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [owedText, setOwedText] = useState(initial ? String(initial.amount_owed) : '')
  const [originalText, setOriginalText] = useState(initial ? String(initial.original_amount) : '')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [error, setError] = useState(null)

  // The envelope decides the currency.
  const bankOf = {}
  banks.forEach((b) => b.accounts.forEach((a) => a.items.forEach((i) => (bankOf[i.id] = b))))
  const currency = bankOf[categoryId]?.currency ?? initial?.currency ?? 'USD'

  return (
    <form
      className="add-account wish-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const owed = initial ? initial.amount_owed : parseBalance(owedText)
        const original = originalText.trim() === '' ? owed : parseBalance(originalText)
        if (!name.trim()) return
        if (owed === null || owed < 0) return setError('Enter how much is owed now, like 8400')
        if (original === null || original < 0) return setError('Enter the starting amount, or leave it blank')
        if (!categoryId) return setError('Pick the envelope it’s paid from.')
        setError(null)
        await onSave({ name, kind, currency, categoryId, amountOwed: owed, originalAmount: Math.max(original, owed), dueDate })
      }}
    >
      <h2 className="section-title">{initial ? 'Edit' : 'Add to Owed'}</h2>
      <fieldset className="segmented">
        <legend>Type</legend>
        <label className={kind === 'loan' ? 'on' : ''}>
          <input type="radio" name="debt-kind" checked={kind === 'loan'} onChange={() => setKind('loan')} />
          Loan
        </label>
        <label className={kind === 'tax' ? 'on' : ''}>
          <input type="radio" name="debt-kind" checked={kind === 'tax'} onChange={() => setKind('tax')} />
          Tax or bill
        </label>
      </fieldset>
      <label className="field">
        <span>Name</span>
        <input
          placeholder={kind === 'loan' ? 'e.g. Car loan' : 'e.g. STR taxes Q4'}
          value={name}
          maxLength={60}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Paid from (envelope)</span>
        <select className="field-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Choose…</option>
          {banks.map((b) =>
            b.accounts.map((a) =>
              a.items.length === 0 ? null : (
                <optgroup key={a.id} label={`${b.name} · ${a.name} (${b.currency})`}>
                  {a.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
              ),
            ),
          )}
        </select>
      </label>
      <div className="spend-row">
        {!initial && (
          <label className="field">
            <span>Owed now ({currency})</span>
            <input inputMode="decimal" placeholder="0" value={owedText} onChange={(e) => setOwedText(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>{kind === 'loan' ? `Started at (${currency})` : `Full amount (${currency})`}</span>
          <input inputMode="decimal" placeholder="same as owed" value={originalText} onChange={(e) => setOriginalText(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Due date {kind === 'loan' ? '(optional)' : ''}</span>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>
      <p className="hint">
        {kind === 'loan'
          ? '“Started at” is the original loan amount, for the progress bar. Leave it blank to start from today.'
          : 'Tip: give the envelope a “Save up by a date” target with this amount and date, so it fills in time.'}
        {initial && ' To change what’s owed now, use Update owed.'}
      </p>
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
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

// Pay: a spend from the envelope that also lowers what's owed.
function PaySheet({ debt, envelope, onSave, onClose }) {
  const c = debt.currency
  // Suggest the full amount for a tax bill; leave it blank for a loan (payments vary).
  const [text, setText] = useState(debt.kind === 'tax' ? String(debt.amount_owed) : '')
  const [paidOn, setPaidOn] = useState(todayLocal())
  const [note, setNote] = useState('')
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
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="pay-title">Pay {debt.name}</h2>
          <span className="muted">
            <span className="money">{formatMoney(debt.amount_owed, c)}</span> owed
          </span>
        </div>
        <form
          className="spend-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!amount) return setError('Enter the payment, like 450')
            if (amount > debt.amount_owed) return setError(`That’s more than the ${formatMoney(debt.amount_owed, c)} owed.`)
            setBusy(true)
            setError(null)
            try {
              await onSave({ amount, paidOn, note })
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
            From {envelope.name} (holds {formatMoney(envelope.balance, c)}).
            {amount ? ` Then ${formatMoney(debt.amount_owed - amount, c)} left to owe.` : ''}
          </p>
          {amount && amount > envelope.balance && (
            <p className="hint match-off">{envelope.name} only holds {formatMoney(envelope.balance, c)}; it will go below zero.</p>
          )}
          <label className="field">
            <span>Note (optional)</span>
            <input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Pay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Update owed: type what the lender or tax office says now (after interest, a new bill, etc.).
function UpdateOwedSheet({ debt, onSave, onClose }) {
  const [text, setText] = useState(String(debt.amount_owed))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const amount = parseBalance(text)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="owed-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="owed-title">{debt.name}</h2>
          <span className="muted">Update owed</span>
        </div>
        <form
          className="spend-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (amount === null || amount < 0) return setError('Enter the amount owed now, like 8350.12')
            setBusy(true)
            try {
              await onSave(amount)
            } catch (err) {
              setError(friendlyError(err))
              setBusy(false)
            }
          }}
        >
          <label className="amount-field">
            <span>Owed now ({debt.currency})</span>
            <input inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="hint">
            Use this when interest is added or a new statement arrives. It doesn’t move any money — payments do that.
          </p>
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
