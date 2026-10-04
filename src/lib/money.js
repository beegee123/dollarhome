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

// How full a budget item is, and the label beside its name.
//   pct   — 0 to 100, how much of the bar to fill
//   tone  — 'ok' (green), 'low' (amber) or 'empty' (red)
//   label — "On track", "Low", "Empty", "Funded", "+$400", "Overspent"
export function itemStatus(balance, plan, currency) {
  const b = Number(balance) || 0
  const p = Number(plan) || 0

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
