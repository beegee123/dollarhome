import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { fetchAnalytics } from '../api/analytics.js'
import { friendlyError } from '../lib/errors.js'
import { formatMoney, shortDate } from '../lib/money.js'
import { buildContext, groupTrend, monthFigures, monthKey, shiftMonth, trend } from '../lib/analytics.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (key) => MONTHS_LONG[Number(key.slice(5)) - 1]
const monthShort = (key) => MONTHS[Number(key.slice(5)) - 1]

// Read-only. Month picker and currency switch on top (USD and CAD are never added
// together), then the month at a glance, the 6-month trend, and the rest lower down.
export default function AnalyticsScreen() {
  const thisMonth = monthKey(new Date())
  const firstMonth = shiftMonth(thisMonth, -11) // pick any of the last 12 months
  const loadFrom = shiftMonth(firstMonth, -6) // …and each one's 6-month trend
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [month, setMonth] = useState(thisMonth)
  const [currency, setCurrency] = useState(null)
  const [openGroup, setOpenGroup] = useState(null)

  useEffect(() => {
    let ignore = false
    fetchAnalytics(`${loadFrom}-01`)
      .then((d) => {
        if (ignore) return
        setData(d)
        setCurrency(d.banks.find((b) => !b.archived)?.currency ?? null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [loadFrom])

  const ctx = useMemo(() => (data ? buildContext(data) : null), [data])
  const figures = useMemo(() => {
    if (!ctx || !currency) return null
    return {
      now: monthFigures(data, ctx, currency, month),
      prev: monthFigures(data, ctx, currency, shiftMonth(month, -1)),
      trend: trend(data, ctx, currency, month),
    }
  }, [data, ctx, currency, month])

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load analytics.</p>
        <p className="muted">{loadError}</p>
      </div>
    )
  }
  if (!data) return <div className="screen center-message muted">Loading…</div>

  const money = (n) => formatMoney(Math.round(n * 100) / 100, currency ?? 'USD')
  const prevName = monthShort(shiftMonth(month, -1))
  const soFar = month === thisMonth ? ' so far' : ''
  const banksHere = data.banks.filter((b) => !b.archived && b.currency === currency)
  const bankIds = new Set(banksHere.map((b) => b.id))
  const accountIds = new Set(data.accounts.filter((a) => bankIds.has(a.bank_id)).map((a) => a.id))

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

      {ctx.currencies.length > 1 && (
        <div className="chips analytics-banks" role="radiogroup" aria-label="Currency">
          {ctx.currencies.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === currency}
              className={`chip ${c === currency ? 'on' : ''}`}
              onClick={() => {
                setCurrency(c)
                setOpenGroup(null)
              }}
            >
              {c} · {data.banks.filter((b) => !b.archived && b.currency === c).map((b) => b.name).join(', ')}
            </button>
          ))}
        </div>
      )}

      {!figures ? (
        <p className="empty">Add a bank in Setup to see analytics.</p>
      ) : (
        <main className="analytics">
          <Glance f={figures.now} prev={figures.prev} prevName={prevName} soFar={soFar} money={money} />

          {/* 4. Spending by category */}
          <section className="card">
            <div className="card-head">
              <h2>Spending by category</h2>
              {figures.now.spent > 0 && <span className="money strong">{money(figures.now.spent)}</span>}
            </div>
            {figures.now.byGroup.length === 0 ? (
              <p className="card-sub">No spending or plans in {currency} for {monthLabel(month)}.</p>
            ) : (
              <p className="card-sub">Tap a category for its last 6 months. Give items a category in Setup → the account → the item.</p>
            )}
            {(() => {
              const max = Math.max(1, ...figures.now.byGroup.map((g) => Math.max(g.spent, g.plan)))
              return figures.now.byGroup.map((g) => {
                const over = g.plan > 0 && g.spent > g.plan
                const open = openGroup === g.name
                const label = `${g.name}: ${money(g.spent)} spent${g.plan > 0 ? ` of ${money(g.plan)} plan` : ''}${over ? `, over by ${money(g.spent - g.plan)}` : ''}`
                return (
                  <div key={g.name} className="group-block">
                    <button type="button" className="spend-bar group-bar" aria-expanded={open} onClick={() => setOpenGroup(open ? null : g.name)} title={label}>
                      <span className="spend-bar-top">
                        <span className="spend-bar-name">
                          {g.name} <span className="muted group-caret">{open ? '▾' : '▸'}</span>
                        </span>
                        <span className="spend-bar-nums">
                          <span className="money">{money(g.spent)}</span>
                          {g.plan > 0 && <span className="muted"> of {money(g.plan)}</span>}
                          {over && <strong className="over-text"> over {money(g.spent - g.plan)}</strong>}
                        </span>
                      </span>
                      <span className="spend-track" role="img" aria-label={label}>
                        <span className={`spend-fill ${over ? 'spend-fill--over' : ''}`} style={{ width: `${(g.spent / max) * 100}%` }} />
                        {g.plan > 0 && <span className="plan-tick" style={{ left: `${(g.plan / max) * 100}%` }} />}
                      </span>
                    </button>
                    {open && (
                      <div className="group-detail">
                        <GroupTrend points={groupTrend(data, ctx, currency, month, g.name)} money={money} name={g.name} />
                        <ul className="group-items">
                          {g.envelopes.map((r) => (
                            <li key={r.id}>
                              <span>
                                {r.name}
                                {r.archived && <span className="muted"> (archived)</span>}
                              </span>
                              <span className="money">
                                {money(r.spent)}
                                {r.plan > 0 && <span className="muted"> of {money(r.plan)}</span>}
                              </span>
                            </li>
                          ))}
                          {g.loose > 0 && (
                            <li>
                              <span className="muted">Spent from Unassigned</span>
                              <span className="money">{money(g.loose)}</span>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })
            })()}
            {figures.now.byGroup.length > 0 && (
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

          {/* 5. Envelopes over plan */}
          <section className="card">
            <div className="card-head">
              <h2>Over plan</h2>
              {figures.now.withPlan > 0 && (
                <span className="muted card-head-note">
                  {figures.now.onPlan} of {figures.now.withPlan} on or under plan
                </span>
              )}
            </div>
            {figures.now.withPlan === 0 && <p className="card-sub">No items have a monthly plan yet.</p>}
            {figures.now.withPlan > 0 && figures.now.over.length === 0 && (
              <p className="card-sub card-sub--flat match-ok">Nothing over plan{soFar}.</p>
            )}
            {figures.now.over.map((r) => (
              <div key={r.id} className="list-row">
                <span>
                  {r.name} <span className="muted">· {r.accountName}</span>
                </span>
                <span className="money">
                  <strong className="over-text">+{money(r.spent - r.plan)}</strong>
                  <span className="muted"> ({money(r.spent)} of {money(r.plan)})</span>
                </span>
              </div>
            ))}
          </section>

          {/* 6. Top 5 envelopes */}
          <section className="card">
            <h2>Top envelopes</h2>
            {figures.now.top.length === 0 && <p className="card-sub">No spending logged in {monthLabel(month)}.</p>}
            {figures.now.top.map((r, i) => {
              const max = figures.now.top[0].spent
              return (
                <div key={r.id} className="spend-bar">
                  <div className="spend-bar-top">
                    <span className="spend-bar-name">
                      <span className="muted">{i + 1}.</span> {r.name}
                    </span>
                    <span className="spend-bar-nums">
                      <span className="money">{money(r.spent)}</span>
                      {figures.now.spent > 0 && <span className="muted"> · {Math.round((r.spent / figures.now.spent) * 100)}%</span>}
                    </span>
                  </div>
                  <div className="spend-track" role="img" aria-label={`${r.name}: ${money(r.spent)}`}>
                    <div className="spend-fill" style={{ width: `${(r.spent / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </section>

          {/* Trend: income vs spent */}
          <section className="card">
            <h2>Income vs spent, last 6 months</h2>
            <IncomeSpentChart points={figures.trend} money={money} chosen={month} thisMonth={thisMonth} />
          </section>

          <IncomeBySource data={data} accountIds={accountIds} month={month} money={money} currency={currency} />
          <Owed data={data} currency={currency} month={month} money={money} />
          <Wishlist data={data} ctx={ctx} currency={currency} money={money} />
        </main>
      )}
    </div>
  )
}

// ▲ C$120 vs Sep (or ▲ 5 pts for percentages). Plain text, no colour: up isn't always good.
function Delta({ label, now, prev, prevName, money, pct }) {
  if (now === null || prev === null) return null
  const diff = Math.round((now - prev) * 100) / 100
  if (diff === 0) return <span className="delta">{label ? `${label}: s` : 'S'}ame as {prevName}</span>
  return (
    <span className="delta">
      {label && `${label} `}
      {diff > 0 ? '▲' : '▼'} {pct ? `${Math.abs(diff)} pts` : money(Math.abs(diff))} vs {prevName}
    </span>
  )
}

// 1–3: the month at a glance.
function Glance({ f, prev, prevName, soFar, money }) {
  return (
    <section className="glance" aria-label="The month at a glance">
      <div className="stat stat--wide">
        <span className="stat-label">Kept{soFar}</span>
        <span className={`stat-value money ${f.kept < 0 ? 'over-text' : ''}`}>{money(f.kept)}</span>
        <span className="stat-sub">
          Income <span className="money">{money(f.income)}</span> · Spent <span className="money">{money(f.spent)}</span>
        </span>
        <span className="stat-deltas">
          <Delta now={f.kept} prev={prev.kept} prevName={prevName} money={money} />
          <Delta label="Spent" now={f.spent} prev={prev.spent} prevName={prevName} money={money} />
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Funded</span>
        <span className="stat-value">{f.fundedPct === null ? '—' : `${f.fundedPct}%`}</span>
        <span className="stat-sub">
          {f.planned > 0 ? (
            <>
              <span className="money">{money(f.funded)}</span> of <span className="money">{money(f.planned)}</span> planned
              {f.stillNeeds > 0 && (
                <>
                  {' · '}still needs <span className="money">{money(f.stillNeeds)}</span>
                </>
              )}
            </>
          ) : (
            'No monthly plans yet'
          )}
        </span>
        <Delta now={f.fundedPct} prev={prev.fundedPct} prevName={prevName} money={money} pct />
      </div>
      <div className="stat">
        <span className="stat-label">Unspent in envelopes</span>
        <span className="stat-value money">{money(f.unspent)}</span>
        <span className="stat-sub">
          Unassigned <span className="money">{money(f.unassigned)}</span>
        </span>
        <Delta now={f.unspent} prev={prev.unspent} prevName={prevName} money={money} />
      </div>
    </section>
  )
}

const SERIES = { income: 'Income', spent: 'Spent' }

// Two bars per month, income and spent. Tap a month for its numbers.
function IncomeSpentChart({ points, money, chosen, thisMonth }) {
  const [active, setActive] = useState(null)
  const focus = points.find((p) => p.key === (active ?? chosen)) ?? points[points.length - 1]
  const W = 320
  const H = 150
  const pad = { left: 8, right: 8, top: 10, bottom: 22 }
  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.spent]))
  const slot = (W - pad.left - pad.right) / points.length
  const barW = Math.min(18, slot / 2 - 4)
  const h = (v) => (Math.max(0, v) / max) * (H - pad.top - pad.bottom)
  const base = H - pad.bottom

  return (
    <div className="trend">
      <div className="chart-readout" aria-live="polite">
        <strong>
          {monthShort(focus.key)}
          {focus.key === thisMonth ? ' so far' : ''}
        </strong>
        <span>
          <span className="key-swatch key-swatch--income" /> Income <span className="money">{money(focus.income)}</span>
        </span>
        <span>
          <span className="key-swatch key-swatch--spent" /> Spent <span className="money">{money(focus.spent)}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Income and spending for the last 6 months">
        <line x1={pad.left} x2={W - pad.right} y1={base} y2={base} className="trend-axis" />
        {points.map((p, i) => {
          const cx = pad.left + slot * i + slot / 2
          const on = p.key === focus.key
          return (
            <g key={p.key} className={on ? 'bar-group bar-group--on' : 'bar-group'}>
              {on && <rect x={cx - slot / 2 + 2} y={pad.top - 6} width={slot - 4} height={base - pad.top + 6} rx="6" className="bar-focus" />}
              {['income', 'spent'].map((k, j) => {
                const bh = h(p[k])
                const x = cx + (j === 0 ? -barW - 1 : 1)
                return bh > 0 ? (
                  <path key={k} d={roundedTop(x, base - bh, barW, bh, 4)} className={`bar bar--${k}`}>
                    <title>{`${monthShort(p.key)} · ${SERIES[k]} ${money(p[k])}`}</title>
                  </path>
                ) : null
              })}
              <text x={cx} y={H - 6} textAnchor="middle" className={`trend-month ${on ? 'trend-month--on' : ''}`}>
                {monthShort(p.key)}
              </text>
              {/* Big invisible target so a month is easy to tap */}
              <rect
                x={cx - slot / 2}
                y={0}
                width={slot}
                height={H}
                className="trend-hit"
                onMouseEnter={() => setActive(p.key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(p.key)}
              />
            </g>
          )
        })}
      </svg>
      <div className="legend">
        <span>
          <span className="key-swatch key-swatch--income" /> Income
        </span>
        <span>
          <span className="key-swatch key-swatch--spent" /> Spent
        </span>
      </div>
      <table className="visually-hidden">
        <caption>Income and spending by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Income</th>
            <th scope="col">Spent</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{monthLabel(p.key)}</th>
              <td>{money(p.income)}</td>
              <td>{money(p.spent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A bar with rounded top corners, sitting on the baseline.
function roundedTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h)
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`
}

// One category's last 6 months: spent per month, with the plan as a line across.
function GroupTrend({ points, money, name }) {
  const [active, setActive] = useState(null)
  const focus = active !== null ? points[active] : points[points.length - 1]
  const W = 300
  const H = 110
  const pad = { left: 6, right: 6, top: 8, bottom: 20 }
  const plan = points[0]?.plan ?? 0
  const max = Math.max(1, plan, ...points.map((p) => p.spent)) * 1.1
  const slot = (W - pad.left - pad.right) / points.length
  const barW = Math.min(22, slot - 12)
  const base = H - pad.bottom
  const y = (v) => base - (v / max) * (base - pad.top)

  return (
    <div className="trend trend--small">
      <p className="chart-readout chart-readout--small">
        <strong>{monthShort(focus.key)}</strong> <span className="money">{money(focus.spent)}</span>
        {plan > 0 && <span className="muted"> of {money(plan)} plan</span>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${name}: spending for the last 6 months`}>
        <line x1={pad.left} x2={W - pad.right} y1={base} y2={base} className="trend-axis" />
        {points.map((p, i) => {
          const cx = pad.left + slot * i + slot / 2
          const over = plan > 0 && p.spent > plan
          const bh = base - y(p.spent)
          return (
            <g key={p.key}>
              {bh > 0 && (
                <path d={roundedTop(cx - barW / 2, y(p.spent), barW, bh, 4)} className={`bar bar--group ${over ? 'bar--over' : ''} ${focus === p ? 'bar--focus' : ''}`}>
                  <title>{`${monthShort(p.key)}: ${money(p.spent)}`}</title>
                </path>
              )}
              <text x={cx} y={H - 5} textAnchor="middle" className="trend-month">
                {monthShort(p.key)}
              </text>
              <rect x={cx - slot / 2} y={0} width={slot} height={H} className="trend-hit" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onClick={() => setActive(i)} />
            </g>
          )
        })}
        {plan > 0 && <line x1={pad.left} x2={W - pad.right} y1={y(plan)} y2={y(plan)} className="plan-line" />}
      </svg>
      <table className="visually-hidden">
        <caption>{name} spending by month</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{monthLabel(p.key)}</th>
              <td>{money(p.spent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Lower down: income by source, owed, wishlist progress (as before, now per currency).
function IncomeBySource({ data, accountIds, month, money, currency }) {
  const sourceAccount = Object.fromEntries(data.sources.map((s) => [s.id, s.account_id]))
  const by = {}
  data.events.forEach((e) => {
    if (!accountIds.has(sourceAccount[e.source_id]) || e.received_on.slice(0, 7) !== month) return
    by[e.source_id] ??= { total: 0, count: 0 }
    by[e.source_id].total += e.amount
    by[e.source_id].count += 1
  })
  const rows = Object.entries(by)
    .map(([id, v]) => ({ name: data.sources.find((s) => s.id === id)?.name ?? 'Deleted source', ...v }))
    .sort((a, b) => b.total - a.total)
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <section className="card">
      <div className="card-head">
        <h2>Income by source</h2>
        {total > 0 && <span className="money strong">{money(total)}</span>}
      </div>
      {rows.length === 0 && (
        <p className="card-sub">
          No {currency} income added in {monthLabel(month)}.
        </p>
      )}
      {rows.map((r) => (
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
  )
}

function Owed({ data, currency, month, money }) {
  const here = data.debts.filter((d) => d.currency === currency)
  const loans = here.filter((d) => d.kind === 'loan' && d.original_amount > 0)
  const nextTax = here.filter((d) => d.kind === 'tax' && d.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
  const total = here.reduce((s, d) => s + d.amount_owed, 0)
  const year = month.slice(0, 4)
  const interestYear = data.interest.filter((t) => t.currency === currency && t.date.startsWith(year)).reduce((s, t) => s + t.amount, 0)
  return (
    <section className="card">
      <div className="card-head">
        <h2>Owed ({currency})</h2>
        {total > 0 && <span className="money strong">{money(total)}</span>}
      </div>
      {here.length === 0 && interestYear === 0 && (
        <p className="card-sub">
          Nothing owed in {currency}. <Link to="/owed">Open Owed</Link>
        </p>
      )}
      {loans.map((d) => {
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
      {interestYear > 0 && (
        <p className="card-sub card-sub--flat">
          Interest paid in {year}: <span className="money">{money(interestYear)}</span>
        </p>
      )}
      {nextTax && (
        <p className="card-sub card-sub--flat">
          Next bill: <strong>{nextTax.name}</strong> · <span className="money">{money(nextTax.amount_owed)}</span> due {shortDate(nextTax.due_date)}
        </p>
      )}
    </section>
  )
}

function Wishlist({ data, ctx, currency, money }) {
  const by = {}
  data.wishes.forEach((w) => {
    const c = ctx.cats[w.category_id]
    if (!c || c.currency !== currency) return
    by[c.id] ??= { name: c.name, need: 0, count: 0, have: data.balances[c.id] ?? 0 }
    by[c.id].need += w.amount
    by[c.id].count += 1
  })
  const rows = Object.values(by).sort((a, b) => a.have / a.need - b.have / b.need)
  return (
    <section className="card">
      <h2>Wishlist progress</h2>
      {rows.length === 0 && (
        <p className="card-sub">
          No wishlist items use {currency} envelopes. <Link to="/wishlist">Open Wishlist</Link>
        </p>
      )}
      {rows.map((w) => {
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
  )
}
