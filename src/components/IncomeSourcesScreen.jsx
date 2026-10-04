import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchMonthIncome, fetchSources, setSourceArchived } from '../api/income.js'
import { formatMoney } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Setup → Income sources: the list. Tap one to edit its split.
export default function IncomeSourcesScreen() {
  const [sources, setSources] = useState(null)
  const [month, setMonth] = useState({}) // source id → { total, count } this month
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchSources(), fetchMonthIncome()])
      .then(([s, m]) => {
        if (ignore) return
        setSources(s)
        setMonth(m)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [reloadCount])

  async function toggleArchived(source, archived) {
    setBusy(true)
    setActionError(null)
    try {
      await setSourceArchived(source.id, archived)
      setReloadCount((n) => n + 1)
    } catch (err) {
      setActionError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load income sources.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={() => setReloadCount((n) => n + 1)}>
          Try again
        </button>
      </div>
    )
  }
  if (sources === null) return <div className="screen center-message muted">Loading…</div>

  const active = sources.filter((s) => !s.archived)
  const archived = sources.filter((s) => s.archived)
  const monthName = new Date().toLocaleString('en-US', { month: 'long' })

  // This month's totals per currency (USD and CAD are never added together).
  const monthByCurrency = {}
  sources.forEach((s) => {
    const m = month[s.id]
    if (!m) return
    const c = s.account.bank.currency
    monthByCurrency[c] = (monthByCurrency[c] ?? 0) + m.total
  })
  const monthText = Object.entries(monthByCurrency)
    .map(([c, n]) => formatMoney(n, c))
    .join(' + ')

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Income sources</h1>
      </header>

      <p className="muted setup-intro">
        Each paycheck or payout has a home account and a saved split. On payday you pick the source and the split
        fills in.
      </p>

      {actionError && <p className="notice" role="alert">{actionError}</p>}

      <p className="month-income">
        Received in {monthName}: <span className="money strong">{monthText || '—'}</span>
      </p>

      <main className="bank-card">
        {active.length === 0 && <p className="muted empty--small">No income sources yet.</p>}

        {active.map((s) => {
          const currency = s.account.bank.currency
          const summary =
            s.split_type === 'fixed'
              ? `Fixed · ${formatMoney(s.lines.reduce((sum, l) => sum + l.value, 0), currency)} split`
              : `Percent · ${s.lines.length} ${s.lines.length === 1 ? 'line' : 'lines'}`
          return (
            <div key={s.id} className="setup-row">
              <div className="setup-row-main">
                <span className="setup-row-name">{s.name}</span>
                <span className="muted setup-row-sub">
                  Lands in {s.account.bank.name} · {s.account.name} · {summary}
                </span>
                <span className="setup-row-sub">
                  {month[s.id]
                    ? `${monthName}: ${formatMoney(month[s.id].total, currency)} · ${month[s.id].count} ${
                        month[s.id].count === 1 ? 'deposit' : 'deposits'
                      }`
                    : `${monthName}: nothing yet`}
                </span>
              </div>
              <div className="row-actions">
                <Link to={`/setup/income/${s.id}`} className="small-button">
                  Edit split
                </Link>
                <button type="button" className="small-button small-button--danger" disabled={busy} onClick={() => toggleArchived(s, true)}>
                  Archive
                </button>
              </div>
            </div>
          )
        })}

        <Link to="/setup/income/new" className="link-button add-link">
          + Add income source
        </Link>

        {archived.map((s) => (
          <div key={s.id} className="setup-row setup-row--archived">
            <span>
              {s.name} <span className="muted">· archived</span>
            </span>
            <button type="button" className="small-button" disabled={busy} onClick={() => toggleArchived(s, false)}>
              Restore
            </button>
          </div>
        ))}
      </main>
    </div>
  )
}
