import { formatMoney, itemStatus } from '../lib/money.js'

// One budget item: name + status label, "balance / plan", and the bar.
// It's a button: tapping it opens Quick spend.
export default function BudgetRow({ item, currency, onTap }) {
  const status = itemStatus(item.balance, item.planned_amount, currency)

  return (
    <button type="button" className="budget-row" onClick={onTap}>
      <span className="budget-row-top">
        <span className="budget-row-name">
          {item.name}
          {status.label && <span className={`tag tag-${status.tone}`}>{status.label}</span>}
        </span>
        <span className="budget-row-amounts">
          {formatMoney(item.balance, currency)}
          <span className="muted"> / {formatMoney(item.planned_amount, currency)}</span>
        </span>
      </span>
      {/* The bar: an empty track with a coloured fill as wide as the percentage. */}
      <span className="bar" aria-hidden="true">
        <span className={`bar-fill bar-${status.tone}`} style={{ width: `${status.pct}%` }} />
      </span>
    </button>
  )
}
