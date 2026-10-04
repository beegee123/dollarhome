import { useEffect, useMemo, useRef } from 'react'
import { formatMoney, monthsLeft } from '../lib/money.js'

const COLORS = ['#2f5d50', '#b86a00', '#e3ede9', '#d9a441', '#7fb3a3', '#f4f4f1']

// The goal-reached moment: confetti falling behind a card.
// Props:
//   goal     — { name, planned_amount, target_date }
//   currency
//   onClose
//   title    — headline (default "Goal reached!"; Owed uses "Paid off!")
//   verb     — word after the amount (default "saved")
export default function Celebration({ goal, currency, onClose, title = 'Goal reached!', verb = 'saved' }) {
  const buttonRef = useRef(null)

  // 40 pieces of confetti, each with its own spot, colour, size, delay and spin.
  // Made once (useMemo) so they don't jump around when the screen redraws.
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
        delay: Math.random() * 0.6,
        duration: 2.2 + Math.random() * 1.4,
        spin: Math.random() > 0.5 ? 1 : -1,
      })),
    [],
  )

  useEffect(() => {
    buttonRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // "3 months early": months between now and the target date, minus this month.
  const early = goal.target_date ? monthsLeft(goal.target_date) - 1 : 0

  return (
    <div className="celebrate-backdrop" onClick={onClose}>
      <div className="confetti" aria-hidden="true">
        {pieces.map((p) => (
          <span
            key={p.id}
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 0.45,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--spin': p.spin,
            }}
          />
        ))}
      </div>

      <div
        className="celebrate-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="celebrate-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* A simple star badge, drawn in code */}
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r="28" fill="#e3ede9" />
          <path d="M28 13l4.3 9.2 10 1.2-7.4 6.9 2 9.9L28 35.3l-8.9 4.9 2-9.9-7.4-6.9 10-1.2z" fill="#2f5d50" />
        </svg>
        <h2 id="celebrate-title">{title}</h2>
        <p className="celebrate-name">{goal.name}</p>
        <p className="celebrate-amount">
          <span className="money">{formatMoney(goal.planned_amount, currency)}</span> {verb}
        </p>
        {early > 0 && (
          <p className="celebrate-early">
            {early} {early === 1 ? 'month' : 'months'} early
          </p>
        )}
        <button ref={buttonRef} type="button" className="primary" onClick={onClose}>
          Nice!
        </button>
      </div>
    </div>
  )
}
