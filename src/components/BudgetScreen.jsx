import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import BudgetRow from './BudgetRow.jsx'
import BalanceSheet from './BalanceSheet.jsx'
import IncomeIn from './IncomeIn.jsx'
import AssignSheet from './AssignSheet.jsx'
import MoveSheet from './MoveSheet.jsx'
import SearchBox from './SearchBox.jsx'
import QuickSpend from './QuickSpend.jsx'
import { fetchBudget } from '../api/budget.js'
import { assignFromUnassigned, deletePairs, deleteTransaction, logSpend, moveMoney } from '../api/transactions.js'
import { setBankBalance } from '../api/setup.js'
import { applyIncome, undoIncome } from '../api/income.js'
import { supabase } from '../lib/supabase.js'
import { formatMoney, normalize, todayLocal } from '../lib/money.js'

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

  // Load everything; again whenever reloadCount changes.
  useEffect(() => {
    let ignore = false // if the screen closes before the fetch finishes, drop the result
    setLoadError(null)
    fetchBudget()
      .then((data) => {
        if (ignore) return
        setBanks(data)
        // Open the first tab, unless the open one still exists.
        setBankId((current) => (data.some((b) => b.id === current) ? current : data[0]?.id ?? null))
      })
      .catch((err) => {
        if (!ignore) setLoadError(err.message)
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
  async function saveSpend({ amount, note, occurredOn }) {
    const { item, currency } = spending
    const id = await logSpend({ categoryId: item.id, amount, note, occurredOn }) // throws on failure; QuickSpend shows it
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
      id: `${eventId}-${t.accountName}`,
      eventId,
      text: `Move ${formatMoney(t.amount, currency)} from ${source.account.bank.name} ${source.account.name} to ${source.account.bank.name} ${t.accountName}`,
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
          <Link to="/setup" className="small-button">
            Setup
          </Link>
          <button type="button" className="link-button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
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
          onSave={saveSpend}
          onClose={() => setSpending(null)}
          onMove={() => {
            setMoveFrom(spending.item.id)
            setSpending(null)
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
        />
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
function AccountSection({ bank, account, title, items, searching, onTapItem, onUpdateBalance, onAssign }) {
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
