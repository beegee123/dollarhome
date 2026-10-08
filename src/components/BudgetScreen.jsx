import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import BudgetRow from './BudgetRow.jsx'
import BalanceSheet from './BalanceSheet.jsx'
import IncomeIn from './IncomeIn.jsx'
import AssignSheet from './AssignSheet.jsx'
import MoveSheet from './MoveSheet.jsx'
import Celebration from './Celebration.jsx'
import PayCardSheet from './PayCardSheet.jsx'
import SearchBox from './SearchBox.jsx'
import QuickSpend from './QuickSpend.jsx'
import { fetchBudget } from '../api/budget.js'
import { assignFromUnassigned, deletePairs, deleteTransaction, logSpend, moveMoney } from '../api/transactions.js'
import { adjustToBank, setBankBalance } from '../api/setup.js'
import { applyIncome, undoIncome } from '../api/income.js'
import { cardSpend, payCard } from '../api/cards.js'
import { tagPairWithBill } from '../api/bills.js'
import { formatMoney, normalize, todayLocal } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// The home screen: bank tabs → account sections → budget items.
export default function BudgetScreen() {
  const [banks, setBanks] = useState(null) // null = still loading
  const [loadError, setLoadError] = useState(null)
  const [bankId, setBankId] = useState(null) // which tab is open
  const [query, setQuery] = useState('') // search text
  const [reloadCount, setReloadCount] = useState(0) // bump to load again
  const [spending, setSpending] = useState(null) // { item, currency } while Quick spend is open
  const [toast, setToast] = useState(null) // { text, undo } after a spend is logged
  const [balanceFor, setBalanceFor] = useState(null) // { account, currency } while Update balance is open
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [assignFor, setAssignFor] = useState(null) // { account, currency } while Assign is open
  const [moveFrom, setMoveFrom] = useState(undefined) // undefined = closed; null or an item id = open
  const [reminders, setReminders] = useState([]) // "Move $400 from Truist Checking to Truist Savings" 
  const toastTimer = useRef(null)
  const [payingCard, setPayingCard] = useState(null) // { card, bank, envelope } while Pay card is open
  const [celebrating, setCelebrating] = useState(null) // { goal, currency } when a goal was just reached
  const goalsFunded = useRef(null) // goal id → funded? from the previous load (null = first load)

  // Load everything; again whenever reloadCount changes.
  useEffect(() => {
    let ignore = false // if the screen closes before the fetch finishes, drop the result
    setLoadError(null)
    fetchBudget()
      .then((data) => {
        if (ignore) return
        setBanks(data)

        // Did a goal just cross the line? Compare with the previous load.
        // (The first load only remembers; it never celebrates.)
        const now = {}
        let reached = null
        data.forEach((b) =>
          b.accounts.forEach((a) =>
            a.items.forEach((i) => {
              if (i.target_type !== 'by_date' || !(i.planned_amount > 0)) return
              now[i.id] = i.balance >= i.planned_amount
              if (goalsFunded.current && goalsFunded.current[i.id] === false && now[i.id] && !reached) {
                reached = { goal: i, currency: b.currency }
              }
            }),
          ),
        )
        goalsFunded.current = now
        if (reached) setCelebrating(reached)

        // Open the first tab, unless the open one still exists.
        setBankId((current) => (data.some((b) => b.id === current) ? current : data[0]?.id ?? null))
      })
      .catch((err) => {
        if (!ignore) setLoadError(friendlyError(err))
      })
    return () => {
      ignore = true
    }
  }, [reloadCount])

  // When the app comes back to the front (e.g. after using your bank app), reload.
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState === 'visible') setReloadCount((n) => n + 1)
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [])

  // Change one item's balance on screen (and its account's total) without reloading.
  function adjustBalance(itemId, change) {
    setBanks((current) =>
      current.map((b) => ({
        ...b,
        accounts: b.accounts.map((a) => {
          if (!a.items.some((i) => i.id === itemId)) return a
          return {
            ...a,
            total: a.total + change,
            items: a.items.map((i) => (i.id === itemId ? { ...i, balance: i.balance + change } : i)),
          }
        }),
      })),
    )
  }

  function showToast(text, undo) {
    clearTimeout(toastTimer.current)
    setToast({ text, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000) // gone after 6 seconds
  }

  // Save first, THEN change the screen: a spend is money, so the bar should
  // only move once the database has it.
  async function saveSpend({ amount, note, occurredOn, cardId, billId }) {
    const { item, currency } = spending
    if (cardId) {
      // Paid with a card: the item drops, the card's payment envelope rises, the card owes more.
      const card = banks.flatMap((b) => b.accounts).find((a) => a.id === cardId)
      const pairId = await cardSpend({ categoryId: item.id, cardId, amount, spentOn: occurredOn, note })
      if (billId) await tagPairWithBill(pairId, billId).catch(() => {}) // only affects the Paid label
      setSpending(null)
      setReloadCount((n) => n + 1)
      showToast(`Logged ${formatMoney(amount, currency)} from ${item.name} on ${card?.name ?? 'card'}`, () =>
        undoPairs([pairId]),
      )
      return
    }
    const id = await logSpend({ categoryId: item.id, amount, note, occurredOn, billId }) // throws on failure; QuickSpend shows it
    adjustBalance(item.id, -amount)
    setSpending(null)
    showToast(`Logged ${formatMoney(amount, currency)} from ${item.name}`, async () => {
      setToast(null)
      try {
        await deleteTransaction(id)
        adjustBalance(item.id, amount)
      } catch {
        showToast('Couldn’t undo. Reloading…')
        setReloadCount((n) => n + 1)
      }
    })
  }

  // Apply a paycheck, then reload so every bar shows the new balances.
  async function saveIncome({ source, amount, receivedOn, note, lines, transfers }) {
    const currency = source.account.bank.currency
    const eventId = await applyIncome({ sourceId: source.id, amount, receivedOn, note, lines }) // throws on failure
    setIncomeOpen(false)
    setBankId(source.account.bank.id) // show the bank the money went to
    setReloadCount((n) => n + 1)

    const moves = transfers.map((t) => ({
      id: `${eventId}-${t.bankName}-${t.accountName}`,
      eventId,
      text: t.crossBank
        ? `Send ${formatMoney(t.amount, currency)} from ${source.account.bank.name} ${source.account.name} to ${t.bankName} ${t.accountName} (bank-to-bank, 1–3 days)`
        : `Move ${formatMoney(t.amount, currency)} from ${source.account.bank.name} ${source.account.name} to ${t.bankName} ${t.accountName}`,
    }))
    setReminders((r) => [...moves, ...r])

    showToast(`Added ${formatMoney(amount, currency)} from ${source.name}`, async () => {
      setToast(null)
      try {
        await undoIncome(eventId)
        setReminders((r) => r.filter((m) => m.eventId !== eventId))
      } catch {
        showToast('Couldn’t undo.')
      }
      setReloadCount((n) => n + 1)
    })
  }

  // Assign: spread Unassigned across items, then reload.
  async function saveAssign(allocations) {
    const { account, currency } = assignFor
    const total = allocations.reduce((sum, a) => sum + a.amount, 0)
    const pairIds = await assignFromUnassigned({
      unassignedId: account.unassigned.id,
      allocations,
      occurredOn: todayLocal(),
    })
    setAssignFor(null)
    setReloadCount((n) => n + 1)
    showToast(`Assigned ${formatMoney(total, currency)} in ${account.name}`, () => undoPairs(pairIds))
  }

  // Move or transfer between any two items, then reload.
  async function saveMove({ from, to, sent, received, kind, note, occurredOn, needsBankStep }) {
    const pairId = await moveMoney({ fromId: from.id, toId: to.id, sent, received, kind, note, occurredOn })
    setMoveFrom(undefined)
    setReloadCount((n) => n + 1)
    if (needsBankStep) {
      const arrived = received !== sent ? ` (${formatMoney(received, to.bank.currency)} arrives)` : ''
      setReminders((r) => [
        {
          id: pairId,
          eventId: pairId,
          text: `Move ${formatMoney(sent, from.bank.currency)} from ${from.bank.name} ${from.account.name} to ${to.bank.name} ${to.account.name}${arrived}`,
        },
        ...r,
      ])
    }
    showToast(`Moved ${formatMoney(sent, from.bank.currency)} from ${from.name} to ${to.name}`, () =>
      undoPairs([pairId]),
    )
  }

  async function undoPairs(pairIds) {
    setToast(null)
    try {
      await deletePairs(pairIds)
      setReminders((r) => r.filter((m) => !pairIds.includes(m.eventId)))
    } catch {
      showToast('Couldn’t undo.')
    }
    setReloadCount((n) => n + 1)
  }

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load your budget.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={() => setReloadCount((n) => n + 1)}>
          Try again
        </button>
      </div>
    )
  }

  if (banks === null) return <div className="screen center-message muted">Loading…</div>

  const search = normalize(query)
  const bank = banks.find((b) => b.id === bankId)

  // Which sections to show:
  //  - no search: every account in the open bank
  //  - searching: matching items from EVERY bank, each section titled "Bank · Account"
  const sections = search
    ? banks.flatMap((b) =>
        b.accounts
          .map((a) => ({
            bank: b,
            account: a,
            title: `${b.name} · ${a.name}`,
            items: a.items.filter((i) => normalize(i.name).includes(search)),
          }))
          .filter((s) => s.items.length > 0),
      )
    : (bank?.accounts ?? []).map((a) => ({ bank, account: a, title: a.name, items: a.items }))

  return (
    <div className="screen">
      <header className="screen-header screen-header--row">
        <div>
          <span className="eyebrow">DOLLARHOME</span>
          <h1>Budget</h1>
        </div>
        <div className="header-actions">
          <Link to="/wishlist" className="small-button">
            Wishlist
          </Link>
          <Link to="/analytics" className="small-button">
            Analytics
          </Link>
          <Link to="/setup" className="small-button">
            Setup
          </Link>
          <Link to="/guide" className="small-button help-button" aria-label="Guide">
            ?
          </Link>
        </div>
      </header>

      {banks.length === 0 ? (
        <p className="empty">
          No banks yet. <Link to="/setup">Go to Setup</Link> to add your first bank and account.
        </p>
      ) : (
        <>
          {/* Bank tabs. While searching, no tab is "open" because results come from every bank. */}
          <div className="bank-tabs" role="tablist" aria-label="Banks">
            {banks.map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={!search && b.id === bankId}
                className="bank-tab"
                onClick={() => {
                  setBankId(b.id)
                  setQuery('')
                }}
              >
                {b.name}
              </button>
            ))}
          </div>

          <SearchBox value={query} onChange={setQuery} />

          <p className="bank-line muted">
            {search
              ? 'Results across all banks'
              : `${bank.name} · ${bank.currency} · total ${formatMoney(
                  bank.accounts.reduce((sum, a) => sum + a.total, 0),
                  bank.currency,
                )}`}
          </p>

          {/* Transfers to make in your real bank after a paycheck. Tap ✓ once done. */}
          {reminders.map((m) => (
            <div key={m.id} className="reminder" role="status">
              <span>{m.text}</span>
              <button
                type="button"
                className="small-button"
                onClick={() => setReminders((r) => r.filter((x) => x.id !== m.id))}
              >
                Done ✓
              </button>
            </div>
          ))}

          <main className="account-list">
            {search && sections.length === 0 && <p className="empty">No budget items match “{query.trim()}”.</p>}
            {!search && bank && bank.accounts.length === 0 && (
              <p className="empty">
                {bank.name} has no accounts yet. <Link to="/setup">Add one in Setup</Link>.
              </p>
            )}

            {sections.map(({ bank: b, account, title, items }) => (
              <AccountSection
                key={account.id}
                bank={b}
                account={account}
                title={title}
                items={items}
                searching={!!search}
                onTapItem={(item) => setSpending({ item, currency: b.currency })}
                onUpdateBalance={() => setBalanceFor({ account, currency: b.currency })}
                onAssign={() => setAssignFor({ account, currency: b.currency })}
                envelopeOf={(id) => findItem(banks, id)}
                onPayCard={(envelope) => setPayingCard({ card: account, bank: b, envelope })}
              />
            ))}
          </main>
        </>
      )}

      {/* The payday button, always at the bottom of the screen. */}
      {banks.length > 0 && !spending && !incomeOpen && !balanceFor && !assignFor && moveFrom === undefined && (
        <div className="bottom-bar">
          <button type="button" className="secondary bottom-bar-side" onClick={() => setMoveFrom(null)}>
            Move
          </button>
          <Link to="/bills" className="secondary bottom-bar-side bottom-bar-link">
            Bills
          </Link>
          <button type="button" className="primary bottom-bar-button" onClick={() => setIncomeOpen(true)}>
            + Income in
          </button>
        </div>
      )}

      {assignFor && (
        <AssignSheet account={assignFor.account} currency={assignFor.currency} onSave={saveAssign} onClose={() => setAssignFor(null)} />
      )}

      {moveFrom !== undefined && (
        <MoveSheet banks={banks} fromId={moveFrom} onSave={saveMove} onClose={() => setMoveFrom(undefined)} />
      )}

      {incomeOpen && <IncomeIn banks={banks} onApply={saveIncome} onClose={() => setIncomeOpen(false)} />}

      {spending && (
        <QuickSpend
          item={spending.item}
          currency={spending.currency}
          cards={banks.flatMap((b) => (b.currency === spending.currency ? b.accounts.filter((a) => a.kind === 'credit') : []))}
          onPairDeleted={() => setReloadCount((n) => n + 1)}
          onSave={saveSpend}
          onClose={() => setSpending(null)}
          onMove={() => {
            setMoveFrom(spending.item.id)
            setSpending(null)
          }}
          onDeleted={(amount) => {
            // amount is negative (a spend), so subtracting it gives the money back
            adjustBalance(spending.item.id, -amount)
            setSpending((sp) => sp && { ...sp, item: { ...sp.item, balance: sp.item.balance - amount } })
          }}
        />
      )}

      {balanceFor && (
        <BalanceSheet
          account={balanceFor.account}
          currency={balanceFor.currency}
          onClose={() => setBalanceFor(null)}
          onSave={async (amount) => {
            await setBankBalance(balanceFor.account.id, amount)
            setBalanceFor(null)
            setReloadCount((n) => n + 1)
          }}
          onAdjust={async (amount, change) => {
            await adjustToBank(balanceFor.account.id, amount, change)
            setBalanceFor(null)
            setReloadCount((n) => n + 1)
          }}
        />
      )}

      {payingCard && (
        <PayCardSheet
          card={payingCard.card}
          envelope={payingCard.envelope}
          currency={payingCard.bank.currency}
          onClose={() => setPayingCard(null)}
          onSave={async ({ amount, paidOn }) => {
            const pairId = await payCard({ cardId: payingCard.card.id, amount, paidOn })
            const name = payingCard.card.name
            setPayingCard(null)
            setReloadCount((n) => n + 1)
            showToast(`Paid ${formatMoney(amount, payingCard.bank.currency)} to ${name}`, () => undoPairs([pairId]))
          }}
        />
      )}

      {celebrating && (
        <Celebration goal={celebrating.goal} currency={celebrating.currency} onClose={() => setCelebrating(null)} />
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

// One account: its title, the match check against the bank, Unassigned, then its budget items.
// Find a budget item anywhere (used to show a card's payment envelope).
function findItem(banks, id) {
  for (const b of banks) for (const a of b.accounts) for (const i of a.items) if (i.id === id) return { ...i, accountName: a.name }
  return null
}

function AccountSection({ bank, account, title, items, searching, onTapItem, onUpdateBalance, onAssign, envelopeOf, onPayCard }) {
  if (account.kind === 'credit') {
    // Cards have no budget items; they don't show in search results.
    if (searching) return null
    return <CardSection bank={bank} card={account} title={title} envelope={envelopeOf(account.payment_category_id)} onUpdateBalance={onUpdateBalance} onPay={onPayCard} />
  }
  const off = Math.round((account.bank_balance - account.total) * 100) / 100 // round away float dust
  const unassigned = account.unassigned?.balance ?? 0

  return (
    <section className="account-section" aria-label={title}>
      <h2 className="section-title section-title--split">
        <span>{title}</span>
        {/* Tapping the match check opens "Update bank balance". */}
        <button
          type="button"
          className={`match match-button ${off === 0 ? 'match-ok' : 'match-off'}`}
          onClick={onUpdateBalance}
          aria-label={`Update bank balance for ${account.name}`}
        >
          {off === 0
            ? `Matches bank ${formatMoney(account.bank_balance, bank.currency)}`
            : `Off by ${formatMoney(Math.abs(off), bank.currency)} vs bank`}
          <span className="match-edit">Update</span>
        </button>
      </h2>

      {/* Unassigned only shows when it holds money (and not in search results). */}
      {!searching && unassigned !== 0 && (
        <div className="unassigned-row">
          <span>
            <span className="muted unassigned-label">Unassigned</span>
            <span className="unassigned-amount">{formatMoney(unassigned, bank.currency)}</span>
          </span>
          {unassigned > 0 && account.items.length > 0 && (
            <button type="button" className="small-button" onClick={onAssign}>
              Assign
            </button>
          )}
        </div>
      )}

      {items.length === 0 && !searching && (
        <p className="empty empty--small">
          No budget items yet. <Link to={`/setup/accounts/${account.id}`}>Add some</Link>
        </p>
      )}

      {items.map((item) => (
        <BudgetRow key={item.id} item={item} currency={bank.currency} onTap={() => onTapItem(item)} />
      ))}
    </section>
  )
}

// A credit card on its bank's tab: what it owes, whether the payment envelope covers it, Pay card.
function CardSection({ bank, card, title, envelope, onUpdateBalance, onPay }) {
  const c = bank.currency
  const off = Math.round((card.bank_balance - card.owed) * 100) / 100 // statement vs DollarHome
  const held = envelope?.balance ?? 0
  const short = Math.round((card.owed - held) * 100) / 100

  return (
    <section className="account-section" aria-label={title}>
      <h2 className="section-title section-title--split">
        <span>
          {title} <span className="card-badge">CARD</span>
        </span>
        <button
          type="button"
          className={`match match-button ${off === 0 ? 'match-ok' : 'match-off'}`}
          onClick={onUpdateBalance}
          aria-label={`Update statement balance for ${card.name}`}
        >
          {off === 0 ? 'Matches statement' : `Off by ${formatMoney(Math.abs(off), c)} vs statement`}
          <span className="match-edit">Update</span>
        </button>
      </h2>
      <div className="card-row">
        <div className="setup-row-main">
          <span>
            Owes <span className="money strong">{formatMoney(card.owed, c)}</span>
          </span>
          <span className="muted setup-row-sub">
            {envelope ? (
              <>
                {envelope.name} ({envelope.accountName}) holds <span className="money">{formatMoney(held, c)}</span>
                {card.owed > 0 &&
                  (short <= 0 ? (
                    <strong className="match-ok"> · covered</strong>
                  ) : (
                    <strong className="over-text"> · {formatMoney(short, c)} short</strong>
                  ))}
              </>
            ) : (
              'Payment envelope missing'
            )}
          </span>
        </div>
        <button type="button" className="small-button" disabled={!envelope || card.owed <= 0} onClick={() => onPay(envelope)}>
          Pay card
        </button>
      </div>
    </section>
  )
}
