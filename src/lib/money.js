// Small helpers for showing money. Kept in one place so every screen formats the same way.

// "$1,865", "$48.20", "C$2,075", "−$40". Cents only show when there are some.
export function formatMoney(amount, currency = 'USD') {
  const value = Number(amount) || 0
  const symbol = currency === 'CAD' ? 'C$' : '$'
  const hasCents = Math.round(Math.abs(value) * 100) % 100 !== 0
  const digits = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
  return `${value < 0 ? '−' : ''}${symbol}${digits}`
}

// Months left to save toward a dated target, counting this month.
// Due Oct 31 when it's Oct 4 → 1. Due Jun 30 next year → 9. Already past → 0.
export function monthsLeft(targetDate) {
  const now = new Date()
  const [y, m, d] = targetDate.split('-').map(Number)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (new Date(y, m - 1, d) < today) return 0
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + 1
}

// For a "save up by a date" target: how much is still needed, and per month.
export function targetPace(balance, target, targetDate) {
  const need = Math.max(0, (Number(target) || 0) - (Number(balance) || 0))
  const months = monthsLeft(targetDate)
  return { need, months, perMonth: months > 0 ? Math.ceil((need / months) * 100) / 100 : need }
}

// "Jun 2027" from "2027-06-30"
export function monthYear(isoDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m] = isoDate.split('-').map(Number)
  return `${months[m - 1]} ${y}`
}

// How full a budget item is, and the label beside its name.
//   pct   — 0 to 100, how much of the bar to fill
//   tone  — 'ok' (green), 'low' (amber) or 'empty' (red)
//   label — "On track", "Low", "Empty", "Funded", "+$400", "Overspent",
//           or for a dated target: "$350/mo to Jun 2027", "Due soon", "Past due"
//   target — optional { type: 'monthly' | 'by_date', date: 'YYYY-MM-DD' }
export function itemStatus(balance, plan, currency, target) {
  const b = Number(balance) || 0
  const p = Number(plan) || 0

  if (target?.type === 'by_date' && target.date) {
    if (b < 0) return { pct: 0, tone: 'empty', label: 'Overspent' }
    const pct = p > 0 ? Math.min(100, Math.round((b / p) * 100)) : 100
    if (b >= p) return { pct: 100, tone: 'ok', label: b > p ? `+${formatMoney(b - p, currency)}` : 'Funded' }
    const { perMonth, months } = targetPace(b, p, target.date)
    if (months === 0) return { pct, tone: 'empty', label: 'Past due' }
    if (months === 1) return { pct, tone: 'low', label: `Due soon · ${formatMoney(perMonth, currency)} to go` }
    return { pct, tone: 'ok', label: `${formatMoney(perMonth, currency)}/mo to ${monthYear(target.date)}` }
  }

  if (b < 0) return { pct: 0, tone: 'empty', label: 'Overspent' }
  if (p === 0) return { pct: b > 0 ? 100 : 0, tone: 'ok', label: b > 0 ? '' : 'No plan' }
  if (b === 0) return { pct: 0, tone: 'empty', label: 'Empty' }

  const ratio = b / p
  const pct = Math.min(100, Math.round(ratio * 100))
  if (ratio < 0.3) return { pct, tone: 'low', label: 'Low' }
  if (ratio > 1) return { pct, tone: 'ok', label: `+${formatMoney(b - p, currency)}` }
  if (ratio === 1) return { pct, tone: 'ok', label: 'Funded' }
  return { pct, tone: 'ok', label: 'On track' }
}

// Lower-case and strip accents, so "creme" finds "Crème" (same as Pantry's search).
export const normalize = (text) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Turn what someone typed into a number: "48.2", "$48.20", "1,200" all work.
// Returns null if it isn't a positive amount with at most 2 decimal places.
export function parseAmount(text) {
  const cleaned = String(text).replace(/[$,\s]/g, '').replace(/^C\$/i, '')
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const value = Number(cleaned)
  return value > 0 ? value : null
}

// Today's date as YYYY-MM-DD in YOUR time zone (toISOString would use UTC
// and could give tomorrow's date late in the evening).
export function todayLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "Oct 2" from "2026-10-02" (read straight from the text, so no time-zone surprises).
export function shortDate(isoDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [, m, d] = isoDate.split('-').map(Number)
  return `${months[m - 1]} ${d}`
}

// Like parseAmount, but zero and negatives are allowed (a bank balance can be $0,
// or below zero on an overdrawn account). Returns null if it isn't a number.
export function parseBalance(text) {
  const cleaned = String(text).replace(/[$,\s]/g, '').replace(/^C\$/i, '').replace('−', '-')
  if (!/^-?\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') return null
  return Number(cleaned)
}
