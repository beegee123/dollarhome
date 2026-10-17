import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fetchBudget } from '../api/budget.js'
import { addBill, deleteBill, fetchBills, payBills, payCardBills, saveBillsBulk, setBillAmount, setBillDue, unpayBills, updateBill } from '../api/bills.js'
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
  const [quick, setQuick] = useState(null) // { id, amount, due } while updating a bill's amount / due date
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

  // Soonest due first; bills without a due date go last.
  const sorted = [...bills].sort(
    (a, b) =>
      (a.next_due ?? '9999').localeCompare(b.next_due ?? '9999') ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name),
  )
  const chosen = sorted.filter((b) => b.id in selected)
  const today = todayLocal()
  const thisMonth = today.slice(0, 7)

  // Where a bill's money comes from: its budget item, or for a card payment, the card's
  // payment envelope.
  const envOf = (b) =>
    b.kind === 'card_payment' ? envelopes[cards[b.card_id]?.payment_category_id] : envelopes[b.category_id]

  // The list in sections: bills paid from the bank, then one section per card with every
  // bill charged to it (and the card's own payment bill, if there is one).
  const bankBills = sorted.filter((b) => b.kind !== 'card_payment' && !b.card_id)
  const cardIds = [...new Set(sorted.filter((b) => b.card_id).map((b) => b.card_id))]
  const sections = [
    ...(bankBills.length ? [{ key: 'bank', title: 'Paid from the bank', bills: bankBills }] : []),
    ...cardIds.map((id) => {
      const own = sorted.find((b) => b.kind === 'card_payment' && b.card_id === id)
      const charged = sorted.filter((b) => b.kind === 'spend' && b.card_id === id)
      return { key: id, card: cards[id], own, charged, bills: [...(own ? [own] : []), ...charged] }
    }),
  ]

  // Ticked bills that are all charged to one card can be logged AND the card paid, in one go.
  const oneCard =
    chosen.length > 0 && chosen.every((b) => b.kind === 'spend' && b.card_id && b.card_id === chosen[0].card_id)
      ? cards[chosen[0].card_id]
      : null

  function pickCardBills(sec) {
    setSelected(Object.fromEntries(sec.charged.map((b) => [b.id, String(b.amount)])))
  }

  async function saveQuick() {
    const amount = parseAmount(quick.amount)
    if (!amount) return setActionError('Enter the amount, like 142.30')
    const bill = bills.find((x) => x.id === quick.id)
    const ok = await run(async () => {
      if (amount !== bill.amount) await setBillAmount(bill.id, amount)
      if ((quick.due || null) !== (bill.next_due || null)) await setBillDue(bill.id, quick.due)
    })
    if (ok) {
      setQuick(null)
      setSelected((s) => (bill.id in s ? { ...s, [bill.id]: String(amount) } : s))
    }
  }

  // What each chosen bill takes this time, grouped by the budget item it comes from.
  const groups = {}
  let badAmount = false
  chosen.forEach((b) => {
    const amount = parseAmount(selected[b.id])
    if (!amount) badAmount = true
    const env = envOf(b)
    const key = env?.id ?? `none-${b.id}`
    groups[key] ??= { envelope: env, need: 0 }
    groups[key].need += amount ?? 0
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

  async function paySelected(payCard = false) {
    if (badAmount) return setActionError('Every ticked bill needs an amount above 0.')
    if (chosen.some((b) => !envOf(b))) {
      return setActionError('A ticked bill’s budget item (or card) is gone or archived. Tap Edit and pick another.')
    }
    if (shortCount > 0 && !window.confirm('Some budget items don’t have enough. Log anyway? They’ll go below zero.')) return
    const lines = chosen.map((b) => ({ billId: b.id, amount: parseAmount(selected[b.id]) }))
    const count = lines.length
    const total = totalText
    let undo = null
    const card = payCard ? oneCard : null
    const ok = await run(async () => {
      undo = card ? await payCardBills(card.id, lines, paidOn) : await payBills(lines, paidOn)
    })
    if (ok) {
      setSelected({})
      showToast(card ? `Paid ${card.name}: ${count} ${count === 1 ? 'bill' : 'bills'} · ${total}` : `Logged ${count} ${count === 1 ? 'bill' : 'bills'} · ${total}`, async () => {
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

        {sections.map((sec) => (
          <section key={sec.key} className="bill-section" aria-label={sec.title ?? `On ${sec.card?.name ?? 'card'}`}>
            {sec.card !== undefined && (
              <div className="bill-section-head">
                <span>
                  <strong>On {sec.card?.name ?? 'a missing card'}</strong>
                  {sec.own?.next_due && (
                    <span className={sec.own.next_due < today ? 'match-off' : 'muted'}>
                      {' '}
                      · {sec.own.next_due < today ? 'past due' : 'due'} {shortDate(sec.own.next_due)}
                    </span>
                  )}
                </span>
                {sec.charged.length > 0 && sec.card && (
                  <button type="button" className="small-button" onClick={() => pickCardBills(sec)}>
                    Pay {sec.charged.length === 1 ? 'this bill' : `these ${sec.charged.length}`}
                  </button>
                )}
              </div>
            )}
            {sec.title && <h2 className="section-title bill-section-title">{sec.title}</h2>}
        {sec.bills.map((b) => {
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
          const env = envOf(b)
          const card = b.card_id ? cards[b.card_id] : null
          const isCardPay = b.kind === 'card_payment'
          const currency = env?.currency ?? card?.currency ?? 'USD'
          const on = b.id in selected
          const paidThisMonth = b.lastPaid?.slice(0, 7) === thisMonth
          const overdue = b.next_due && b.next_due < today
          const sub = isCardPay
            ? [card ? `Card payment · ${card.name}` : 'Card missing — tap Edit', env ? `from ${env.name}` : null]
            : [
                env ? `From ${env.name} · ${env.bankName} ${env.accountName}` : 'Budget item missing — tap Edit',
                card ? `on ${card.name}` : null,
              ]
          const subText = sub.filter(Boolean).join(' · ')
          const updating = quick?.id === b.id
          return (
            <div key={b.id} className={`wish-row bill-row ${on ? 'wish-row--on' : ''}`}>
              <button type="button" className="wish-pick" aria-pressed={on} onClick={() => toggle(b)}>
                <span className="wish-box" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="setup-row-main">
                  <span className="setup-row-name">{b.name}</span>
                  <span className="muted setup-row-sub">{subText}</span>
                  <span className="setup-row-sub">
                    {b.next_due && (
                      <span className={overdue ? 'match-off' : 'muted'}>
                        {overdue ? 'Past due ' : 'Due '}
                        {shortDate(b.next_due)}
                      </span>
                    )}
                    {b.next_due && b.lastPaid && <span className="muted"> · </span>}
                    {b.lastPaid && (
                      <span className={paidThisMonth ? 'match-ok' : 'muted'}>
                        {paidThisMonth ? 'Paid ' : 'Last paid '}
                        {shortDate(b.lastPaid)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {/* Tap the amount to update it (and the due date) when the new bill arrives. */}
              <button
                type="button"
                className="money wish-price bill-amount-button"
                aria-label={`Update ${b.name}: amount and due date`}
                onClick={() => setQuick(updating ? null : { id: b.id, amount: String(b.amount), due: b.next_due ?? '' })}
              >
                {formatMoney(b.amount, currency)}
              </button>
              <button type="button" className="link-button wish-edit" onClick={() => setEditingId(b.id)} aria-label={`Edit ${b.name}`}>
                Edit
              </button>
              {updating && (
                <div className="bill-quick">
                  <label>
                    <span>Amount</span>
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus
                      value={quick.amount}
                      onChange={(e) => setQuick((q) => ({ ...q, amount: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Next due</span>
                    <input type="date" value={quick.due} onChange={(e) => setQuick((q) => ({ ...q, due: e.target.value }))} />
                  </label>
                  <div className="inline-form">
                    <button type="button" className="small-button" disabled={busy} onClick={saveQuick}>
                      Save
                    </button>
                    <button type="button" className="small-button" onClick={() => setQuick(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
          </section>
        ))}

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
            <button type="button" className="primary" disabled={busy} onClick={() => paySelected(!!oneCard)}>
              {busy
                ? 'Logging…'
                : oneCard
                  ? `Log & pay ${oneCard.name}`
                  : `Log ${chosen.length} ${chosen.length === 1 ? 'bill' : 'bills'}`}
            </button>
          </div>
          {oneCard && (
            <>
              <p className="hint">
                Each bill comes out of its own budget item, then {oneCard.name} is paid {totalText} from its payment envelope.
              </p>
              <button type="button" className="link-button" disabled={busy} onClick={() => paySelected(false)}>
                Log only — I’ll pay {oneCard.name} later
              </button>
            </>
          )}
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
// The bill takes the item's name. Paid with and Next due show once a row has an amount.
// Card payments aren't in this grid; add those with + Add a bill.
function BillsSetup({ banks, cards, bills, busy, error, onSave, onCancel }) {
  // One bill per budget item here; extra bills on the same item are left as they are.
  const spendBills = bills.filter((b) => b.kind !== 'card_payment')
  const firstByItem = {}
  spendBills.forEach((b) => (firstByItem[b.category_id] ??= b))
  const extraCount = spendBills.length - Object.keys(firstByItem).length

  const [rows, setRows] = useState(() => {
    const init = {}
    Object.values(firstByItem).forEach((b) => {
      init[b.category_id] = { amount: String(b.amount), cardId: b.card_id ?? '', nextDue: b.next_due ?? '' }
    })
    return init
  })
  const [localError, setLocalError] = useState(null)

  const set = (itemId, field, value) =>
    setRows((r) => ({ ...r, [itemId]: { amount: '', cardId: '', nextDue: '', ...r[itemId], [field]: value } }))

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
        const fields = { categoryId: item.id, amount, cardId: row.cardId || '', nextDue: row.nextDue || null }
        if (!existing) inserts.push({ ...fields, name: item.name, sortOrder: order++ })
        else if (
          existing.amount !== amount ||
          (existing.card_id ?? '') !== fields.cardId ||
          (existing.next_due ?? null) !== fields.nextDue
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
                        <input
                          type="date"
                          className="field-select bill-setup-date"
                          aria-label={`${item.name} next due`}
                          value={row.nextDue}
                          onChange={(e) => set(item.id, 'nextDue', e.target.value)}
                        />
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
  const [kind, setKind] = useState(initial?.kind ?? 'spend')
  const [name, setName] = useState(initial?.name ?? '')
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [cardId, setCardId] = useState(initial?.card_id ?? '')
  const [nextDue, setNextDue] = useState(initial?.next_due ?? '')
  const [error, setError] = useState(null)

  // Only budget items in bank accounts (not cards), not Unassigned, not card payment envelopes.
  const paymentEnvelopes = new Set(Object.values(cards).map((c) => c.payment_category_id))
  const itemBank = banks.find((b) => b.accounts.some((a) => a.items.some((i) => i.id === categoryId)))
  const cardChoices = Object.values(cards).filter((c) => itemBank && c.currency === itemBank.currency)
  const allCards = Object.values(cards)
  const isCardPay = kind === 'card_payment'

  return (
    <form
      className="add-account wish-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const amount = parseAmount(amountText)
        if (!name.trim()) return
        if (!amount) return setError('Enter the amount, like 85')
        if (isCardPay) {
          if (!cardId || !cards[cardId]) return setError('Pick the card this pays.')
          setError(null)
          return onSave({ kind, name, amount, cardId, categoryId: null, nextDue })
        }
        if (!categoryId) return setError('Pick the budget item it comes from.')
        const card = cardId && cardChoices.some((c) => c.id === cardId) ? cardId : ''
        setError(null)
        await onSave({ kind, name, amount, categoryId, cardId: card, nextDue })
      }}
    >
      {allCards.length > 0 && (
        <fieldset className="chips">
          <legend>Type</legend>
          <label className={!isCardPay ? 'on' : ''}>
            <input type="radio" name="bill-kind" checked={!isCardPay} onChange={() => setKind('spend')} />
            Bill (a spend)
          </label>
          <label className={isCardPay ? 'on' : ''}>
            <input
              type="radio"
              name="bill-kind"
              checked={isCardPay}
              onChange={() => {
                setKind('card_payment')
                setCardId('')
              }}
            />
            Card payment
          </label>
        </fieldset>
      )}
      <div className="spend-row">
        <label className="field">
          <span>Name</span>
          <input
            placeholder={isCardPay ? 'e.g. Visa statement' : 'e.g. Bell phone'}
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field field--plan">
          <span>{isCardPay ? 'Amount' : 'Usual amount'}</span>
          <input inputMode="decimal" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
      </div>
      {isCardPay ? (
        <label className="field">
          <span>Card it pays</span>
          <select
            value={cardId}
            onChange={(e) => {
              setCardId(e.target.value)
              if (!name.trim() && cards[e.target.value]) setName(`${cards[e.target.value].name} payment`)
            }}
            className="field-select"
          >
            <option value="">Choose…</option>
            {allCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.bankName} · {c.name}
              </option>
            ))}
          </select>
          <span className="hint">This sets the card’s due date and pays its statement from the payment envelope (like Pay card). Bills charged to the card are added as normal bills with Paid with set to the card; they show under the card, ready to pay together.</span>
        </label>
      ) : (
        <>
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
        </>
      )}
      <label className="field field--date">
        <span>Next due (optional)</span>
        <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
      </label>
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
