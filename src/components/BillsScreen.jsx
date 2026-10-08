import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fetchBudget } from '../api/budget.js'
import { addBill, deleteBill, fetchBills, payBills, saveBillsBulk, unpayBills, updateBill } from '../api/bills.js'
import { formatMoney, parseAmount, shortDate, todayLocal } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Bills: your regular bills, saved once. Tick one or several, check the amounts,
// and Log them in one go. Each becomes an ordinary spend (or card spend).
// Address: /bills
export default function BillsScreen() {
  const [bills, setBills] = useState(null) // null = loading
  const [banks, setBanks] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [selected, setSelected] = useState({}) // bill id → amount text for this time
  const [paidOn, setPaidOn] = useState(todayLocal())
  const [editingId, setEditingId] = useState(null) // a bill id, 'new', or null
  const [setupOpen, setSetupOpen] = useState(false) // the all-budget-items grid
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchBills(), fetchBudget()])
      .then(([bl, b]) => {
        if (ignore) return
        setBills(bl)
        setBanks(b)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [reloadCount])

  // Budget items by id (with account, bank, currency), and cards by id.
  const { envelopes, cards } = useMemo(() => {
    const env = {}
    const cardMap = {}
    banks?.forEach((b) =>
      b.accounts.forEach((a) => {
        if (a.kind === 'credit') cardMap[a.id] = { ...a, currency: b.currency, bankName: b.name }
        a.items.forEach(
          (i) => (env[i.id] = { ...i, accountName: a.name, accountKind: a.kind, bankName: b.name, currency: b.currency }),
        )
      }),
    )
    return { envelopes: env, cards: cardMap }
  }, [banks])

  function showToast(text, undo) {
    clearTimeout(toastTimer.current)
    setToast({ text, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  async function run(action) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      reload()
      return true
    } catch (err) {
      setActionError(friendlyError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load your bills.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={reload}>
          Try again
        </button>
      </div>
    )
  }
  if (bills === null) return <div className="screen center-message muted">Loading…</div>

  // Soonest due day first; bills without a day go last.
  const sorted = [...bills].sort(
    (a, b) => (a.due_day ?? 99) - (b.due_day ?? 99) || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  )
  const chosen = sorted.filter((b) => b.id in selected)
  const thisMonth = todayLocal().slice(0, 7)

  // What each chosen bill takes this time, grouped by the budget item it comes from.
  const groups = {}
  let badAmount = false
  chosen.forEach((b) => {
    const amount = parseAmount(selected[b.id])
    if (!amount) badAmount = true
    groups[b.category_id] ??= { envelope: envelopes[b.category_id], need: 0 }
    groups[b.category_id].need += amount ?? 0
  })
  const groupList = Object.values(groups)
  const shortCount = groupList.filter((g) => !g.envelope || g.envelope.balance < g.need).length
  const byCurrency = {}
  groupList.forEach((g) => {
    const c = g.envelope?.currency ?? 'USD'
    byCurrency[c] = (byCurrency[c] ?? 0) + g.need
  })
  const totalText = Object.entries(byCurrency)
    .map(([c, n]) => formatMoney(n, c))
    .join(' + ')

  function toggle(bill) {
    setSelected((s) => {
      const next = { ...s }
      if (bill.id in next) delete next[bill.id]
      else next[bill.id] = String(bill.amount)
      return next
    })
  }

  async function paySelected() {
    if (badAmount) return setActionError('Every ticked bill needs an amount above 0.')
    if (chosen.some((b) => !envelopes[b.category_id])) {
      return setActionError('A ticked bill’s budget item is gone or archived. Tap Edit and pick another.')
    }
    if (shortCount > 0 && !window.confirm('Some budget items don’t have enough. Log anyway? They’ll go below zero.')) return
    const lines = chosen.map((b) => ({ billId: b.id, amount: parseAmount(selected[b.id]) }))
    const count = lines.length
    const total = totalText
    let undo = null
    const ok = await run(async () => {
      undo = await payBills(lines, paidOn)
    })
    if (ok) {
      setSelected({})
      showToast(`Logged ${count} ${count === 1 ? 'bill' : 'bills'} · ${total}`, async () => {
        setToast(null)
        await run(() => unpayBills(undo))
      })
    }
  }

  if (setupOpen) {
    return (
      <BillsSetup
        banks={banks}
        cards={cards}
        bills={bills}
        busy={busy}
        error={actionError}
        onCancel={() => {
          setActionError(null)
          setSetupOpen(false)
        }}
        onSave={async (changes) => {
          if (await run(() => saveBillsBulk(changes))) {
            setSelected({})
            setSetupOpen(false)
          }
        }}
      />
    )
  }

  return (
    <div className="screen screen--wishlist">
      <header className="screen-header screen-header--sub">
        <Link to="/" className="back-link">
          ← Budget
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Bills</h1>
      </header>

      <p className="muted setup-intro">Tick the bills that went out, check the amounts, then Log. One or several at a time.</p>
      <button type="button" className="small-button bills-setup-button" onClick={() => setSetupOpen(true)}>
        Set up bills (all budget items)
      </button>

      {actionError && <p className="notice" role="alert">{actionError}</p>}

      <main className="wish-list">
        {sorted.length === 0 && editingId !== 'new' && (
          <p className="empty">
            No bills yet. Tap <strong>Set up bills</strong> to type amounts next to your budget items, or add one at a time below.
          </p>
        )}

        {sorted.map((b) => {
          if (editingId === b.id) {
            return (
              <BillForm
                key={b.id}
                banks={banks}
                cards={cards}
                initial={b}
                busy={busy}
                onCancel={() => setEditingId(null)}
                onSave={async (fields) => (await run(() => updateBill(b.id, fields))) && setEditingId(null)}
                onDelete={async () => {
                  if (!window.confirm(`Delete the bill ${b.name}? Past spends stay in your history.`)) return
                  setSelected((s) => {
                    const next = { ...s }
                    delete next[b.id]
                    return next
                  })
                  if (await run(() => deleteBill(b.id))) setEditingId(null)
                }}
              />
            )
          }
          const env = envelopes[b.category_id]
          const card = b.card_id ? cards[b.card_id] : null
          const currency = env?.currency ?? 'USD'
          const on = b.id in selected
          const paidThisMonth = b.lastPaid?.slice(0, 7) === thisMonth
          const sub = [
            env ? `From ${env.name} · ${env.bankName} ${env.accountName}` : 'Budget item missing — tap Edit',
            card ? `on ${card.name}` : null,
            b.due_day ? `due ${ordinal(b.due_day)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <div key={b.id} className={`wish-row bill-row ${on ? 'wish-row--on' : ''}`}>
              <button type="button" className="wish-pick" aria-pressed={on} onClick={() => toggle(b)}>
                <span className="wish-box" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="setup-row-main">
                  <span className="setup-row-name">{b.name}</span>
                  <span className="muted setup-row-sub">{sub}</span>
                  {b.lastPaid && (
                    <span className={`setup-row-sub ${paidThisMonth ? 'match-ok' : 'muted'}`}>
                      {paidThisMonth ? `Paid ${shortDate(b.lastPaid)}` : `Last paid ${shortDate(b.lastPaid)}`}
                    </span>
                  )}
                </span>
                <span className="money wish-price">{formatMoney(b.amount, currency)}</span>
              </button>
              <button type="button" className="link-button wish-edit" onClick={() => setEditingId(b.id)} aria-label={`Edit ${b.name}`}>
                Edit
              </button>
              {on && (
                <label className="bill-amount">
                  <span>This time</span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={selected[b.id]}
                    onChange={(e) => setSelected((s) => ({ ...s, [b.id]: e.target.value }))}
                  />
                </label>
              )}
            </div>
          )
        })}

        {editingId === 'new' ? (
          <BillForm
            banks={banks}
            cards={cards}
            initial={null}
            busy={busy}
            onCancel={() => setEditingId(null)}
            onSave={async (fields) =>
              (await run(() => addBill({ ...fields, sortOrder: Math.max(-1, ...bills.map((x) => x.sort_order)) + 1 }))) &&
              setEditingId(null)
            }
          />
        ) : (
          <button type="button" className="link-button add-link" onClick={() => setEditingId('new')}>
            + Add a bill
          </button>
        )}
      </main>

      {chosen.length > 0 && (
        <div className="wish-panel" role="region" aria-label="Bills to log">
          <div className="wish-panel-head">
            <span>
              {chosen.length} {chosen.length === 1 ? 'bill' : 'bills'} ticked
            </span>
            <span className="money strong">{totalText}</span>
          </div>
          {groupList.map((g, n) => (
            <div key={g.envelope?.id ?? `none-${n}`} className="wish-env">
              <span>
                <strong>{g.envelope?.name ?? 'Missing budget item'}</strong>
                {g.envelope && <span className="muted"> · {g.envelope.bankName} {g.envelope.accountName}</span>}
              </span>
              {g.envelope && (
                <span className="wish-env-status">
                  <span className="money">
                    {formatMoney(g.need, g.envelope.currency)} of {formatMoney(g.envelope.balance, g.envelope.currency)}
                  </span>
                  {g.envelope.balance >= g.need ? (
                    <strong className="match-ok"> Enough</strong>
                  ) : (
                    <strong className="match-off"> Short {formatMoney(g.need - g.envelope.balance, g.envelope.currency)}</strong>
                  )}
                </span>
              )}
            </div>
          ))}
          <label className="field field--date bill-date">
            <span>Paid on</span>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
          </label>
          <div className="sheet-actions">
            <button type="button" className="secondary" onClick={() => setSelected({})}>
              Clear
            </button>
            <button type="button" className="primary" disabled={busy} onClick={paySelected}>
              {busy ? 'Logging…' : `Log ${chosen.length} ${chosen.length === 1 ? 'bill' : 'bills'}`}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="toast-undo" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Set up bills: every budget item (bank accounts only), grouped like the income split
// editor. Type an amount next to each item that's a bill; clear it to remove the bill.
// The bill takes the item's name. Paid with and Due day show once a row has an amount.
function BillsSetup({ banks, cards, bills, busy, error, onSave, onCancel }) {
  // One bill per budget item here; extra bills on the same item are left as they are.
  const firstByItem = {}
  bills.forEach((b) => (firstByItem[b.category_id] ??= b))
  const extraCount = bills.length - Object.keys(firstByItem).length

  const [rows, setRows] = useState(() => {
    const init = {}
    Object.values(firstByItem).forEach((b) => {
      init[b.category_id] = { amount: String(b.amount), cardId: b.card_id ?? '', dueDay: b.due_day ? String(b.due_day) : '' }
    })
    return init
  })
  const [localError, setLocalError] = useState(null)

  const set = (itemId, field, value) =>
    setRows((r) => ({ ...r, [itemId]: { amount: '', cardId: '', dueDay: '', ...r[itemId], [field]: value } }))

  // Card payment envelopes are paid with Pay card, so they're not bills.
  const paymentEnvelopes = new Set(Object.values(cards).map((c) => c.payment_category_id))
  const groups = banks.flatMap((b) =>
    b.accounts
      .filter((a) => a.kind !== 'credit')
      .map((a) => ({ bank: b, account: { ...a, items: a.items.filter((i) => !paymentEnvelopes.has(i.id)) } })),
  )
  // Bank tabs, like Budget: one bank's accounts at a time. Amounts typed on other tabs are kept.
  const tabBanks = banks.filter((b) => groups.some((g) => g.bank.id === b.id))
  const [bankId, setBankId] = useState(tabBanks[0]?.id ?? null)
  const shown = groups.filter((g) => g.bank.id === bankId)

  const sumFor = (account) =>
    account.items.reduce((sum, i) => sum + (parseAmount(rows[i.id]?.amount ?? '') ?? 0), 0)
  const totals = {}
  groups.forEach(({ bank, account }) => (totals[bank.currency] = (totals[bank.currency] ?? 0) + sumFor(account)))
  const totalText = Object.entries(totals)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => formatMoney(n, c))
    .join(' + ')

  function save() {
    const inserts = []
    const updates = []
    const deleteIds = []
    let bad = null
    let order = Math.max(-1, ...bills.map((b) => b.sort_order)) + 1
    groups.forEach(({ account }) =>
      account.items.forEach((item) => {
        const row = rows[item.id]
        const text = row?.amount?.trim() ?? ''
        const existing = firstByItem[item.id]
        if (text === '') {
          if (existing) deleteIds.push(existing.id)
          return
        }
        const amount = parseAmount(text)
        if (!amount) {
          bad ??= item.name
          return
        }
        const fields = { categoryId: item.id, amount, cardId: row.cardId || '', dueDay: row.dueDay ? Number(row.dueDay) : null }
        if (!existing) inserts.push({ ...fields, name: item.name, sortOrder: order++ })
        else if (
          existing.amount !== amount ||
          (existing.card_id ?? '') !== fields.cardId ||
          (existing.due_day ?? null) !== fields.dueDay
        )
          updates.push({ ...fields, id: existing.id, name: existing.name })
      }),
    )
    if (bad) return setLocalError(`Check the amount for ${bad}.`)
    setLocalError(null)
    onSave({ inserts, updates, deleteIds })
  }

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <button type="button" className="back-link link-button" onClick={onCancel}>
          ← Bills
        </button>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Set up bills</h1>
      </header>
      <p className="muted setup-intro">
        Type the usual amount next to each budget item that’s a bill. Leave the rest blank. Clearing an amount removes that bill.
      </p>
      {extraCount > 0 && (
        <p className="hint">
          {extraCount} more {extraCount === 1 ? 'bill shares' : 'bills share'} a budget item with another bill; edit {extraCount === 1 ? 'it' : 'them'} on the Bills screen.
        </p>
      )}

      {tabBanks.length > 1 && (
        <div className="bank-tabs" role="tablist" aria-label="Banks">
          {tabBanks.map((b) => {
            const sum = groups.filter((g) => g.bank.id === b.id).reduce((n, g) => n + sumFor(g.account), 0)
            return (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={b.id === bankId}
                className="bank-tab"
                onClick={() => setBankId(b.id)}
              >
                {b.name}
                {sum > 0 && <span className="bank-tab-sum"> · {formatMoney(sum, b.currency)}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="split-groups">
        {shown.map(({ bank, account }) => {
          const cardChoices = Object.values(cards).filter((c) => c.currency === bank.currency)
          const sum = sumFor(account)
          return (
            <section key={account.id} className="split-group">
              <h2 className="section-title section-title--split">
                <span>
                  {bank.name} · {account.name}
                </span>
                <span className="split-sum">{sum > 0 ? formatMoney(sum, bank.currency) : ''}</span>
              </h2>
              {account.items.length === 0 && <p className="muted empty--small">No budget items in this account.</p>}
              {account.items.map((item) => {
                const row = rows[item.id]
                const has = (row?.amount ?? '').trim() !== ''
                return (
                  <div key={item.id} className="bill-setup-item">
                    <label className="split-line">
                      <span>{item.name}</span>
                      <span className="split-input">
                        <span className="muted">{bank.currency === 'CAD' ? 'C$' : '$'}</span>
                        <input
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`${item.name} bill amount`}
                          value={row?.amount ?? ''}
                          onChange={(e) => set(item.id, 'amount', e.target.value)}
                        />
                      </span>
                    </label>
                    {has && (
                      <div className="bill-setup-extra">
                        {cardChoices.length > 0 && (
                          <select
                            className="field-select"
                            aria-label={`${item.name} paid with`}
                            value={row.cardId}
                            onChange={(e) => set(item.id, 'cardId', e.target.value)}
                          >
                            <option value="">Debit</option>
                            {cardChoices.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <select
                          className="field-select"
                          aria-label={`${item.name} due day`}
                          value={row.dueDay}
                          onChange={(e) => set(item.id, 'dueDay', e.target.value)}
                        >
                          <option value="">No due day</option>
                          {Array.from({ length: 31 }, (_, n) => n + 1).map((d) => (
                            <option key={d} value={d}>
                              Due {ordinal(d)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>

      {(localError || error) && <p className="notice" role="alert">{localError || error}</p>}
      <p className="split-total bills-total">Bills total: {totalText || '—'}</p>
      <div className="sheet-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save bills'}
        </button>
      </div>
    </div>
  )
}

// Add or edit one bill: name, amount, budget item, paid with, due day.
function BillForm({ banks, cards, initial, busy, onSave, onCancel, onDelete }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [cardId, setCardId] = useState(initial?.card_id ?? '')
  const [dueDay, setDueDay] = useState(initial?.due_day ? String(initial.due_day) : '')
  const [error, setError] = useState(null)

  // Only budget items in bank accounts (not cards), not Unassigned, not card payment envelopes.
  const paymentEnvelopes = new Set(Object.values(cards).map((c) => c.payment_category_id))
  const itemBank = banks.find((b) => b.accounts.some((a) => a.items.some((i) => i.id === categoryId)))
  const cardChoices = Object.values(cards).filter((c) => itemBank && c.currency === itemBank.currency)

  return (
    <form
      className="add-account wish-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const amount = parseAmount(amountText)
        if (!name.trim()) return
        if (!amount) return setError('Enter the usual amount, like 85')
        if (!categoryId) return setError('Pick the budget item it comes from.')
        const card = cardId && cardChoices.some((c) => c.id === cardId) ? cardId : ''
        setError(null)
        await onSave({ name, amount, categoryId, cardId: card, dueDay: dueDay ? Number(dueDay) : null })
      }}
    >
      <div className="spend-row">
        <label className="field">
          <span>Bill</span>
          <input placeholder="e.g. Bell phone" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--plan">
          <span>Usual amount</span>
          <input inputMode="decimal" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Comes from (budget item)</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="field-select">
          <option value="">Choose…</option>
          {banks.map((b) =>
            b.accounts
              .filter((a) => a.kind !== 'credit')
              .map((a) => {
                const items = a.items.filter((i) => !i.is_unassigned && !paymentEnvelopes.has(i.id))
                return items.length === 0 ? null : (
                  <optgroup key={a.id} label={`${b.name} · ${a.name} (${b.currency})`}>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </optgroup>
                )
              }),
          )}
        </select>
      </label>
      <div className="spend-row">
        <label className="field">
          <span>Paid with</span>
          <select value={cardId} onChange={(e) => setCardId(e.target.value)} className="field-select">
            <option value="">Bank account (debit)</option>
            {cardChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (card)
              </option>
            ))}
          </select>
        </label>
        <label className="field field--plan">
          <span>Due day</span>
          <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="field-select">
            <option value="">None</option>
            {Array.from({ length: 31 }, (_, n) => n + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="notice">{error}</p>}
      <div className="inline-form">
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          {initial ? 'Save' : 'Add'}
        </button>
        <button type="button" className="small-button" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="small-button small-button--danger" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

// 1 → 1st, 2 → 2nd, 11 → 11th, 22 → 22nd
function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${s}`
}
