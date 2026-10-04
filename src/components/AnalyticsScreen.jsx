import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { fetchAnalytics } from '../api/analytics.js'
import { friendlyError } from '../lib/errors.js'
import { formatMoney, shortDate } from '../lib/money.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "2026-10" for a Date, and stepping months back/forward from a "YYYY-MM" key.
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number)
  return monthKey(new Date(y, m - 1 + by, 1))
}
const monthLabel = (key) => MONTHS_LONG[Number(key.slice(5)) - 1]
const monthShort = (key) => MONTHS[Number(key.slice(5)) - 1]

// Read-only: month picker and bank switch on top, then four cards.
export default function AnalyticsScreen() {
  const thisMonth = monthKey(new Date())
  const firstMonth = shiftMonth(thisMonth, -11) // a year of history is plenty
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [month, setMonth] = useState(thisMonth)
  const [bankId, setBankId] = useState(null)

  useEffect(() => {
    let ignore = false
    fetchAnalytics(`${firstMonth}-01`)
      .then((d) => {
        if (ignore) return
        setData(d)
        setBankId(d.banks.find((b) => !b.archived)?.id ?? null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [firstMonth])

  // Lookups: which bank each budget item / income source belongs to.
  const lookups = useMemo(() => {
    if (!data) return null
    const accountBank = Object.fromEntries(data.accounts.map((a) => [a.id, a.bank_id]))
    const accountName = Object.fromEntries(data.accounts.map((a) => [a.id, a.name]))
    const cat = Object.fromEntries(
      data.categories.map((c) => [c.id, { ...c, bankId: accountBank[c.account_id], accountName: accountName[c.account_id] }]),
    )
    const sourceBank = Object.fromEntries(data.sources.map((s) => [s.id, accountBank[s.account_id]]))
    return { cat, sourceBank }
  }, [data])

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load analytics.</p>
        <p className="muted">{loadError}</p>
      </div>
    )
  }
  if (!data) return <div className="screen center-message muted">Loading…</div>

  const bank = data.banks.find((b) => b.id === bankId)
  const currency = bank?.currency ?? 'USD'
  const money = (n) => formatMoney(Math.round(n * 100) / 100, currency)
  const inMonth = (date, key) => date.slice(0, 7) === key

  // ---- Where it went: spending per budget item this month (this bank only) ----
  const spentBy = {}
  data.spends.forEach((t) => {
    const c = lookups.cat[t.category_id]
    if (!c || c.bankId !== bankId || !inMonth(t.occurred_on, month)) return
    spentBy[c.id] = (spentBy[c.id] ?? 0) - t.amount // spends are negative
  })
  const spendRows = Object.entries(spentBy)
    .map(([id, spent]) => ({ ...lookups.cat[id], spent }))
    .filter((r) => r.spent > 0)
    .sort((a, b) => b.spent - a.spent)
  const totalSpent = spendRows.reduce((s, r) => s + r.spent, 0)
  const monthlyPlan = (r) => (!r.is_unassigned && r.target_type !== 'by_date' ? r.planned_amount : 0)
  const scaleMax = Math.max(1, ...spendRows.map((r) => Math.max(r.spent, monthlyPlan(r))))
  const overCount = spendRows.filter((r) => monthlyPlan(r) > 0 && r.spent > monthlyPlan(r)).length

  // ---- Income by source this month ----
  const incomeBy = {}
  data.events.forEach((e) => {
    if (lookups.sourceBank[e.source_id] !== bankId || !inMonth(e.received_on, month)) return
    incomeBy[e.source_id] ??= { total: 0, count: 0 }
    incomeBy[e.source_id].total += e.amount
    incomeBy[e.source_id].count += 1
  })
  const incomeRows = Object.entries(incomeBy)
    .map(([id, v]) => ({ name: data.sources.find((s) => s.id === id)?.name ?? 'Deleted source', ...v }))
    .sort((a, b) => b.total - a.total)
  const totalIncome = incomeRows.reduce((s, r) => s + r.total, 0)

  // ---- Spending, last 6 months (ending at the chosen month) ----
  const trendKeys = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5))
  const trend = trendKeys.map((key) => ({
    key,
    value: data.spends
      .filter((t) => lookups.cat[t.category_id]?.bankId === bankId && inMonth(t.occurred_on, key))
      .reduce((s, t) => s - t.amount, 0),
    partial: key === thisMonth,
    beforeStart: key < firstMonth,
  }))
  const complete = trend.filter((p) => !p.partial && p.value > 0)
  const average = complete.length ? complete.reduce((s, p) => s + p.value, 0) / complete.length : null

  // ---- Wishlist progress, per envelope at this bank ----
  const wishBy = {}
  data.wishes.forEach((w) => {
    const c = lookups.cat[w.category_id]
    if (!c || c.bankId !== bankId) return
    wishBy[c.id] ??= { name: c.name, need: 0, count: 0, have: data.balances[c.id] ?? 0 }
    wishBy[c.id].need += w.amount
    wishBy[c.id].count += 1
  })
  const wishRows = Object.values(wishBy).sort((a, b) => a.have / a.need - b.have / b.need)

  // ---- Owed: loans' payoff progress and the next tax bill, in this bank's currency ----
  const owedHere = data.debts.filter((d) => d.currency === currency)
  const loanRows = owedHere.filter((d) => d.kind === 'loan' && d.original_amount > 0)
  const nextTax = owedHere
    .filter((d) => d.kind === 'tax' && d.due_date)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
  const owedTotal = owedHere.reduce((s, d) => s + d.amount_owed, 0)

  const activeBanks = data.banks.filter((b) => !b.archived)

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/" className="back-link">
          ← Budget
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <div className="analytics-title">
          <h1>Analytics</h1>
          <div className="month-picker">
            <button type="button" className="icon-nav" aria-label="Previous month" disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </button>
            <span>
              {monthLabel(month)}
              {month.slice(0, 4) !== thisMonth.slice(0, 4) && ` ${month.slice(0, 4)}`}
            </span>
            <button type="button" className="icon-nav" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </button>
          </div>
        </div>
      </header>

      {/* One bank at a time, so USD and CAD are never added together. */}
      <div className="chips analytics-banks" role="radiogroup" aria-label="Bank">
        {activeBanks.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={b.id === bankId}
            className={`chip ${b.id === bankId ? 'on' : ''}`}
            onClick={() => setBankId(b.id)}
          >
            {b.name} · {b.currency}
          </button>
        ))}
      </div>

      {!bank ? (
        <p className="empty">Add a bank in Setup to see analytics.</p>
      ) : (
        <main className="analytics">
          {/* 1. Where it went */}
          <section className="card">
            <h2>Where it went</h2>
            <p className="card-sub">
              {totalSpent > 0
                ? `${money(totalSpent)} spent${month === thisMonth ? ' so far' : ''} · ${
                    overCount === 0 ? 'nothing over plan' : `${overCount} ${overCount === 1 ? 'item' : 'items'} over plan`
                  }`
                : `No spending logged at ${bank.name} in ${monthLabel(month)}.`}
            </p>
            {spendRows.map((r) => {
              const hasPlan = monthlyPlan(r) > 0
              const over = hasPlan && r.spent > r.planned_amount
              const label = `${r.is_unassigned ? 'Unassigned' : r.name}: ${money(r.spent)} spent${hasPlan ? ` of ${money(r.planned_amount)} plan` : ''}${
                over ? `, over by ${money(r.spent - r.planned_amount)}` : ''
              }`
              return (
                <div key={r.id} className="spend-bar" title={label}>
                  <div className="spend-bar-top">
                    <span className="spend-bar-name">
                      {r.is_unassigned ? 'Unassigned' : r.name}
                      {r.archived && <span className="muted"> (archived)</span>}
                    </span>
                    <span className="spend-bar-nums">
                      <span className="money">{money(r.spent)}</span>
                      {hasPlan && <span className="muted"> of {money(r.planned_amount)}</span>}
                      {over && <strong className="over-text"> over {money(r.spent - r.planned_amount)}</strong>}
                    </span>
                  </div>
                  <div className="spend-track" role="img" aria-label={label}>
                    <div className={`spend-fill ${over ? 'spend-fill--over' : ''}`} style={{ width: `${(r.spent / scaleMax) * 100}%` }} />
                    {hasPlan && <div className="plan-tick" style={{ left: `${(r.planned_amount / scaleMax) * 100}%` }} />}
                  </div>
                </div>
              )
            })}
            {spendRows.length > 0 && (
              <div className="legend">
                <span>
                  <span className="legend-tick" /> Plan
                </span>
                <span>
                  <span className="legend-swatch" /> Spent
                </span>
                <span>
                  <span className="legend-swatch legend-swatch--over" /> Over plan
                </span>
              </div>
            )}
          </section>

          {/* 2. Income by source */}
          <section className="card">
            <div className="card-head">
              <h2>Income by source</h2>
              {totalIncome > 0 && <span className="money strong">{money(totalIncome)}</span>}
            </div>
            {incomeRows.length === 0 && <p className="card-sub">No income added at {bank.name} in {monthLabel(month)}.</p>}
            {incomeRows.map((r) => (
              <div key={r.name} className="income-row">
                <span>{r.name}</span>
                <span>
                  <span className="muted income-count">
                    {r.count} {r.count === 1 ? 'deposit' : 'deposits'}
                  </span>{' '}
                  <span className="money">{money(r.total)}</span>
                </span>
              </div>
            ))}
          </section>

          {/* 3. Spending, last 6 months */}
          <section className="card">
            <h2>Spending, last 6 months</h2>
            <p className="card-sub">
              {average !== null ? `Average ${money(average)} a month` : 'Not enough history for an average yet'}
              {trend.some((p) => p.partial) && ` · ${monthShort(thisMonth)} still in progress`}
            </p>
            <TrendChart points={trend} money={money} />
          </section>

          {/* Owed: payoff progress (shown per currency, like everything else here) */}
          <section className="card">
            <div className="card-head">
              <h2>Owed ({currency})</h2>
              {owedTotal > 0 && <span className="money strong">{money(owedTotal)}</span>}
            </div>
            {owedHere.length === 0 && (
              <p className="card-sub">
                Nothing owed in {currency}. <Link to="/owed">Open Owed</Link>
              </p>
            )}
            {loanRows.map((d) => {
              const paid = Math.max(0, d.original_amount - d.amount_owed)
              return (
                <div key={d.name} className="spend-bar">
                  <div className="spend-bar-top">
                    <span className="spend-bar-name">{d.name}</span>
                    <span className="spend-bar-nums">
                      <span className="money">{money(paid)}</span>
                      <span className="muted"> paid of {money(d.original_amount)}</span>
                    </span>
                  </div>
                  <div className="spend-track" role="img" aria-label={`${d.name}: ${money(paid)} paid of ${money(d.original_amount)}`}>
                    <div className="spend-fill" style={{ width: `${Math.min(100, (paid / d.original_amount) * 100)}%` }} />
                  </div>
                </div>
              )
            })}
            {nextTax && (
              <p className="card-sub card-sub--flat">
                Next bill: <strong>{nextTax.name}</strong> · <span className="money">{money(nextTax.amount_owed)}</span> due{' '}
                {shortDate(nextTax.due_date)}
              </p>
            )}
          </section>

          {/* 4. Wishlist progress */}
          <section className="card">
            <h2>Wishlist progress</h2>
            {wishRows.length === 0 && (
              <p className="card-sub">
                No wishlist items use {bank.name} envelopes. <Link to="/wishlist">Open Wishlist</Link>
              </p>
            )}
            {wishRows.map((w) => {
              const pct = Math.max(0, Math.min(100, (w.have / w.need) * 100))
              const covered = w.have >= w.need
              return (
                <div key={w.name} className="spend-bar">
                  <div className="spend-bar-top">
                    <span className="spend-bar-name">
                      {w.name} <span className="muted">· {w.count} {w.count === 1 ? 'item' : 'items'}</span>
                    </span>
                    <span className="spend-bar-nums">
                      <span className="money">{money(Math.max(0, w.have))}</span>
                      <span className="muted"> of {money(w.need)}</span>
                    </span>
                  </div>
                  <div className="spend-track" role="img" aria-label={`${w.name}: ${money(w.have)} of ${money(w.need)} needed`}>
                    <div className="spend-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className={covered ? 'covered' : 'muted to-go'}>{covered ? 'Covered' : `${money(w.need - w.have)} to go`}</span>
                </div>
              )
            })}
          </section>
        </main>
      )}
    </div>
  )
}

// A single line of monthly spending. Hover or tap a point for its value.
function TrendChart({ points, money }) {
  const [active, setActive] = useState(null)
  const W = 320
  const H = 140
  const pad = { left: 12, right: 12, top: 26, bottom: 24 }
  const max = Math.max(1, ...points.map((p) => p.value)) * 1.15
  const x = (i) => pad.left + (i * (W - pad.left - pad.right)) / (points.length - 1)
  const y = (v) => H - pad.bottom - (v / max) * (H - pad.top - pad.bottom)
  const shown = points.map((p, i) => ({ ...p, i })).filter((p) => !p.beforeStart)
  const path = shown.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const last = shown[shown.length - 1]
  const focus = active !== null ? points[active] : last

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly spending for the last 6 months">
        <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} className="trend-axis" />
        <path d={path} className="trend-line" />
        {shown.map((p) => (
          <g key={p.key}>
            {/* Big invisible target so the point is easy to tap */}
            <circle
              cx={x(p.i)}
              cy={y(p.value)}
              r="16"
              className="trend-hit"
              onMouseEnter={() => setActive(p.i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(p.i)}
            >
              <title>{`${monthShort(p.key)}: ${money(p.value)}${p.partial ? ' so far' : ''}`}</title>
            </circle>
            <circle cx={x(p.i)} cy={y(p.value)} r={p.i === focus?.i || p.key === focus?.key ? 5 : 3.5} className={p.partial ? 'trend-dot trend-dot--partial' : 'trend-dot'} />
          </g>
        ))}
        {focus && !focus.beforeStart && (
          <text
            x={Math.min(Math.max(x(points.indexOf(focus)), 40), W - 40)}
            y={y(focus.value) - 10}
            textAnchor="middle"
            className="trend-value"
          >
            {money(focus.value)}
            {focus.partial ? ' so far' : ''}
          </text>
        )}
        {points.map((p, i) => (
          <text key={p.key} x={x(i)} y={H - 6} textAnchor="middle" className="trend-month">
            {monthShort(p.key)}
          </text>
        ))}
      </svg>
      {/* The same numbers as a small table, for screen readers and exact values. */}
      <table className="visually-hidden">
        <caption>Spending by month</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{monthLabel(p.key)}</th>
              <td>{money(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
