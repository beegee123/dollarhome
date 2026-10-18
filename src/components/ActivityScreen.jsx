import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { deleteActivity, fetchActivity, restoreActivity } from '../api/transactions.js'
import { groupActivity } from '../lib/activity.js'
import { monthKey, shiftMonth } from '../lib/analytics.js'
import { friendlyError } from '../lib/errors.js'
import { formatMoney, normalize } from '../lib/money.js'

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TYPES = [
  { id: 'all', label: 'All' },
  { id: 'spend', label: 'Spends' },
  { id: 'income', label: 'Income' },
  { id: 'move', label: 'Moves' },
  { id: 'card', label: 'Card pay' },
]

// "Fri, Oct 17"
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${DAYS[date.getDay()]}, ${MONTHS_LONG[m - 1].slice(0, 3)} ${d}`
}

// Activity: everything logged in a month at one bank, newest first.
// Address: /activity?bank=<id> (from the bank's tab on Budget). Without a bank, bank tabs show.
export default function ActivityScreen() {
  const [params] = useSearchParams()
  const fixedBank = params.get('bank')
  const thisMonth = monthKey(new Date())
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [bankId, setBankId] = useState(null)
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const [openKey, setOpenKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    setData(null)
    fetchActivity(month)
      .then((d) => {
        if (ignore) return
        setData(d)
        setLoadError(null)
        setBankId((id) =>
          d.banks.some((b) => b.id === fixedBank) ? fixedBank : d.banks.some((b) => b.id === id && !b.archived) ? id : (d.banks.find((b) => !b.archived)?.id ?? null),
        )
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [month, reloadCount])

  const rows = useMemo(() => (data ? groupActivity(data.transactions, data.events, data.lookups) : []), [data])

  function showToast(text, undo) {
    clearTimeout(toastTimer.current)
    setToast({ text, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  async function remove(row) {
    const what = row.type === 'income' && row.del.eventId ? 'this paycheck and its split' : row.del.pairs?.length > 1 ? `these ${row.del.pairs.length} moves` : 'this entry'
    if (!window.confirm(`Delete ${what} (${formatMoney(Math.abs(row.amount), row.currency ?? 'USD')})? The budget items it touched get their money back.`)) return
    setBusy(true)
    setActionError(null)
    try {
      const saved = await deleteActivity(row.del)
      setOpenKey(null)
      reload()
      showToast(
        `Deleted ${row.title}`,
        saved
          ? async () => {
              setToast(null)
              try {
                await restoreActivity(saved)
                reload()
              } catch (err) {
                setActionError(friendlyError(err))
              }
            }
          : null,
      )
    } catch (err) {
      setActionError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const banks = data?.banks.filter((b) => !b.archived) ?? []
  const bank = banks.find((b) => b.id === bankId)
  const currency = bank?.currency ?? 'USD'
  const q = normalize(search.trim())
  const shown = rows.filter(
    (r) => (!bankId || r.bankIds.includes(bankId)) && (type === 'all' || r.type === type) && (!q || normalize(r.search).includes(q)),
  )
  // Totals for what's showing, in this bank's currency (cross-currency moves aren't added).
  const sameCurrency = shown.filter((r) => r.currency === currency)
  const spent = sameCurrency.filter((r) => r.type === 'spend').reduce((n, r) => n - r.amount, 0)
  const income = sameCurrency.filter((r) => r.type === 'income').reduce((n, r) => n + r.amount, 0)
  const days = []
  shown.forEach((r) => {
    const last = days[days.length - 1]
    if (last?.date === r.date) last.rows.push(r)
    else days.push({ date: r.date, rows: [r] })
  })

  return (
    <div className="screen screen--wishlist">
      <header className="screen-header screen-header--sub">
        <Link to="/" className="back-link">
          ← Budget
        </Link>
        <span className="eyebrow">{fixedBank && bank ? `${bank.name.toUpperCase()} · ${bank.currency}` : 'DOLLARHOME'}</span>
        <div className="analytics-title">
          <h1>Activity</h1>
          <div className="month-picker">
            <button type="button" className="icon-nav" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </button>
            <span>
              {MONTHS_LONG[Number(month.slice(5)) - 1]}
              {month.slice(0, 4) !== thisMonth.slice(0, 4) && ` ${month.slice(0, 4)}`}
            </span>
            <button type="button" className="icon-nav" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </button>
          </div>
        </div>
      </header>

      {!fixedBank && banks.length > 1 && (
        <div className="bank-tabs" role="tablist" aria-label="Banks">
          {banks.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={b.id === bankId} className="bank-tab" onClick={() => setBankId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      <div className="activity-filters">
        <div className="chips activity-types" role="radiogroup" aria-label="Show">
          {TYPES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={type === t.id} className={`chip ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <input className="activity-search" type="search" placeholder="Search notes and items" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      </div>

      {loadError && (
        <p className="notice" role="alert">
          Couldn’t load activity. {loadError}{' '}
          <button type="button" className="link-button" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {actionError && (
        <p className="notice" role="alert">
          {actionError}
        </p>
      )}

      {!data && !loadError ? (
        <p className="muted center-message">Loading…</p>
      ) : (
        data && (
          <>
            <p className="activity-totals">
              {(type === 'all' || type === 'spend') && (
                <span>
                  Spends <span className="money">{formatMoney(spent, currency)}</span>
                </span>
              )}
              {(type === 'all' || type === 'income') && (
                <span>
                  Income <span className="money">{formatMoney(income, currency)}</span>
                </span>
              )}
              <span className="muted">
                {shown.length} {shown.length === 1 ? 'entry' : 'entries'}
              </span>
            </p>

            {shown.length === 0 && <p className="empty">Nothing {q ? 'matches' : 'logged'}{bank ? ` at ${bank.name}` : ''} in {MONTHS_LONG[Number(month.slice(5)) - 1]}.</p>}

            <main className="activity-list">
              {days.map((d) => (
                <section key={d.date} aria-label={dayLabel(d.date)}>
                  <h2 className="section-title">{dayLabel(d.date)}</h2>
                  {d.rows.map((r) => {
                    const open = openKey === r.key
                    const c = r.currency ?? currency
                    return (
                      <div key={r.key} className={`activity-row ${open ? 'activity-row--open' : ''}`}>
                        <button type="button" className="activity-main" aria-expanded={open} onClick={() => setOpenKey(open ? null : r.key)}>
                          <span className={`activity-kind activity-kind--${r.type}`} aria-hidden="true">
                            {r.type === 'income' ? '+' : r.type === 'move' ? '⇄' : r.type === 'card' ? '▭' : r.type === 'spend' ? '−' : '•'}
                          </span>
                          <span className="setup-row-main">
                            <span className="setup-row-name">{r.title}</span>
                            <span className="muted setup-row-sub">{[r.detail, r.accountName].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className={`money activity-amount ${r.type === 'income' ? 'activity-amount--in' : ''}`}>
                            {r.type === 'income' ? '+' : r.type === 'spend' ? '−' : ''}
                            {formatMoney(Math.abs(r.amount), c)}
                          </span>
                        </button>
                        {open && (
                          <div className="activity-detail">
                            {r.received != null && (
                              <p className="hint">
                                Received {formatMoney(r.received, r.receivedCurrency ?? c)} at the other end.
                              </p>
                            )}
                            {r.lines?.length > 0 && (
                              <ul className="group-items">
                                {r.lines.map((l, i) => (
                                  <li key={i}>
                                    <span>
                                      {l.name}
                                      {l.bankName && bank && l.bankName !== bank.name && <span className="muted"> · {l.bankName}</span>}
                                    </span>
                                    <span className="money">{formatMoney(l.amount, c)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="inline-form">
                              <button type="button" className="small-button small-button--danger" disabled={busy} onClick={() => remove(r)}>
                                Delete
                              </button>
                              {r.debt && <span className="hint">A loan or tax payment: deleting puts it back on what’s owed (no Undo).</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </section>
              ))}
            </main>
          </>
        )
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
