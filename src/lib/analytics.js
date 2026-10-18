// The sums behind Analytics. Pure functions: data in, figures out (nothing is stored).
//
// Words used here:
//   envelope  — a budget item in a bank account (not Unassigned, not a card's payment envelope)
//   plan      — what an envelope aims for each month: its monthly amount, or for a dated
//               goal, what it needs per month to get there (plans as they are now)
//   funded    — money put into an envelope during the month (paycheck splits, assigns,
//               moves), up to its plan
//   spent     — spends logged in the month (card spends count when they're logged)
import { targetPace } from './money.js'

// "2026-10" for a Date, and stepping months back/forward from a "YYYY-MM" key.
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number)
  return monthKey(new Date(y, m - 1 + by, 1))
}

const round = (n) => Math.round(n * 100) / 100
const FUNDING_KINDS = new Set(['income', 'transfer', 'move'])

// Lookups built once from the raw data.
export function buildContext(data) {
  const bankCurrency = Object.fromEntries(data.banks.map((b) => [b.id, b.currency]))
  const accounts = Object.fromEntries(data.accounts.map((a) => [a.id, { ...a, currency: bankCurrency[a.bank_id] }]))
  const paymentEnvelopes = new Set(data.accounts.map((a) => a.payment_category_id).filter(Boolean))
  const groupName = Object.fromEntries((data.groups ?? []).map((g) => [g.id, g.name]))
  // Your list's order (Setup → Categories); Other goes last.
  const groupOrder = Object.fromEntries((data.groups ?? []).map((g, i) => [g.name, i]))
  const cats = {}
  data.categories.forEach((c) => {
    const a = accounts[c.account_id]
    const envelope = !c.is_unassigned && a?.kind !== 'credit' && !paymentEnvelopes.has(c.id)
    const balance = data.balances[c.id] ?? 0
    let plan = 0
    if (envelope && !c.archived) {
      plan =
        c.target_type === 'by_date'
          ? c.target_date
            ? targetPace(balance, c.planned_amount, c.target_date).perMonth
            : 0
          : c.planned_amount
    }
    cats[c.id] = {
      ...c,
      currency: a?.currency,
      accountName: a?.name,
      accountKind: a?.kind,
      envelope,
      unassignedCash: c.is_unassigned && a?.kind !== 'credit',
      group: groupName[c.group_id] ?? 'Other',
      balance,
      plan: round(plan),
    }
  })
  const sourceCurrency = Object.fromEntries(data.sources.map((s) => [s.id, accounts[s.account_id]?.currency]))
  const currencies = [...new Set(data.banks.filter((b) => !b.archived).map((b) => b.currency))]
  return { cats, sourceCurrency, currencies, groupOrder }
}

// Every figure for one month in one currency.
export function monthFigures(data, ctx, currency, key) {
  const { cats } = ctx
  const here = (id) => cats[id]?.currency === currency
  const inMonth = (date) => date.slice(0, 7) === key
  const monthEnd = `${key}-31`

  const spentBy = {}
  const fundedIn = {}
  const after = {} // what happened after the month ended, to wind balances back
  for (const t of data.transactions) {
    if (!here(t.category_id)) continue
    if (t.occurred_on > monthEnd) {
      after[t.category_id] = (after[t.category_id] ?? 0) + t.amount
      continue
    }
    if (!inMonth(t.occurred_on)) continue
    if (t.kind === 'spend') spentBy[t.category_id] = (spentBy[t.category_id] ?? 0) - t.amount
    else if (FUNDING_KINDS.has(t.kind)) fundedIn[t.category_id] = (fundedIn[t.category_id] ?? 0) + t.amount
  }

  const income = data.events
    .filter((e) => ctx.sourceCurrency[e.source_id] === currency && inMonth(e.received_on))
    .reduce((n, e) => n + e.amount, 0)
  const spent = Object.values(spentBy).reduce((n, v) => n + v, 0)

  const envelopes = Object.values(cats).filter((c) => c.currency === currency && c.envelope)
  const live = envelopes.filter((c) => !c.archived || spentBy[c.id])

  // Funded vs planned: each envelope counts up to its plan.
  let planned = 0
  let funded = 0
  envelopes.forEach((c) => {
    if (c.plan <= 0) return
    planned += c.plan
    funded += Math.min(c.plan, Math.max(0, fundedIn[c.id] ?? 0))
  })

  // Balances at the end of the month (now, minus anything logged after it).
  const endBalance = (c) => c.balance - (after[c.id] ?? 0)
  const unspent = envelopes.reduce((n, c) => n + endBalance(c), 0)
  const unassigned = Object.values(cats)
    .filter((c) => c.currency === currency && c.unassignedCash)
    .reduce((n, c) => n + endBalance(c), 0)

  // Per envelope, and by category.
  const rows = live.map((c) => ({ id: c.id, name: c.name, accountName: c.accountName, group: c.group, archived: c.archived, plan: c.plan, spent: round(spentBy[c.id] ?? 0) }))
  // Spends straight from Unassigned have no envelope: they count under Other.
  const looseSpent = Object.entries(spentBy)
    .filter(([id]) => !cats[id]?.envelope)
    .reduce((n, [, v]) => n + v, 0)
  const groups = {}
  rows.forEach((r) => {
    const g = (groups[r.group] ??= { name: r.group, spent: 0, plan: 0, envelopes: [] })
    g.spent += r.spent
    g.plan += r.plan
    g.envelopes.push(r)
  })
  if (looseSpent > 0) {
    const g = (groups.Other ??= { name: 'Other', spent: 0, plan: 0, envelopes: [] })
    g.spent += looseSpent
    g.loose = round(looseSpent)
  }
  const byGroup = Object.values(groups)
    .map((g) => ({ ...g, spent: round(g.spent), plan: round(g.plan), envelopes: g.envelopes.sort((a, b) => b.spent - a.spent) }))
    .filter((g) => g.spent > 0 || g.plan > 0)
    .sort((a, b) => (ctx.groupOrder[a.name] ?? 999) - (ctx.groupOrder[b.name] ?? 999) || b.spent - a.spent)

  const withPlan = rows.filter((r) => r.plan > 0)
  const over = withPlan.filter((r) => r.spent > r.plan + 0.004).sort((a, b) => b.spent - b.plan - (a.spent - a.plan))
  const top = rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 5)

  return {
    key,
    income: round(income),
    spent: round(spent),
    kept: round(income - spent),
    planned: round(planned),
    funded: round(funded),
    fundedPct: planned > 0 ? Math.round((funded / planned) * 100) : null,
    stillNeeds: round(planned - funded),
    unspent: round(unspent),
    unassigned: round(unassigned),
    byGroup,
    over,
    onPlan: withPlan.length - over.length,
    withPlan: withPlan.length,
    top,
  }
}

// Income and spending for the 6 months ending at `key`.
export function trend(data, ctx, currency, key, months = 6) {
  return Array.from({ length: months }, (_, i) => {
    const k = shiftMonth(key, i - (months - 1))
    const f = monthFigures(data, ctx, currency, k)
    return { key: k, income: f.income, spent: f.spent }
  })
}

// One category's spending for the 6 months ending at `key`, with its plan (as it is now).
export function groupTrend(data, ctx, currency, key, group, months = 6) {
  const ids = new Set(Object.values(ctx.cats).filter((c) => c.currency === currency && c.envelope && c.group === group).map((c) => c.id))
  const plan = round(Object.values(ctx.cats).filter((c) => ids.has(c.id)).reduce((n, c) => n + c.plan, 0))
  return Array.from({ length: months }, (_, i) => {
    const k = shiftMonth(key, i - (months - 1))
    const spent = data.transactions
      .filter((t) => t.kind === 'spend' && t.occurred_on.slice(0, 7) === k && (ids.has(t.category_id) || (group === 'Other' && ctx.cats[t.category_id]?.currency === currency && !ctx.cats[t.category_id]?.envelope)))
      .reduce((n, t) => n - t.amount, 0)
    return { key: k, spent: round(spent), plan }
  })
}
