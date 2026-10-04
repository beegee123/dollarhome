import { formatMoney, itemStatus } from '../lib/money.js'

// One budget item: name + status label, "balance / plan", and the bar.
// Read-only for now; Step 4 makes it tappable to log a spend.
export default function BudgetRow({ item, currency }) {
  const status = itemStatus(item.balance, item.planned_amount, currency)

  return (
    <div className="budget-row">
      <div className="budget-row-top">
        <span className="budget-row-name">
          {item.name}
          {status.label && <span className={`tag tag-${status.tone}`}>{status.label}</span>}
        </span>
        <span className="budget-row-amounts">
          {formatMoney(item.balance, currency)}
          <span className="muted"> / {formatMoney(item.planned_amount, currency)}</span>
        </span>
      </div>
      {/* The bar: an empty track with a coloured fill as wide as the percentage. */}
      <div className="bar" aria-hidden="true">
        <div className={`bar-fill bar-${status.tone}`} style={{ width: `${status.pct}%` }} />
      </div>
    </div>
  )
}
