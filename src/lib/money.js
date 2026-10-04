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
