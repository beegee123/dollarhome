import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import BalanceSheet from './BalanceSheet.jsx'
import { NameForm } from './SetupScreen.jsx'
import { addItem, adjustToBank, deleteAccount, fetchAccountItems, fetchSetup, moveItem, setBankBalance, swapOrder, updateItem, updateRow } from '../api/setup.js'
import { formatMoney, monthYear, parseBalance, shortDate, targetPace } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Setup → one account. Everything about it in one place:
//   top:    what the bank says, and Update balance
//   middle: its budget items — tap one to edit it
//   bottom: Account settings (rename, order, archive), folded away
export default function AccountItemsScreen() {
  const { accountId } = useParams() // the :accountId part of the address
  const navigate = useNavigate()
  const [data, setData] = useState(null) // null = loading
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null) // which item is open for editing
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [notice, setNotice] = useState(null) // e.g. "Moved Groceries to Savings — move $160 in your bank app" 
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    fetchAccountItems(accountId)
      .then((d) => {
        if (ignore) return
        setData(d)
        setLoadError(null)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [accountId, reloadCount])

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
        <p>Couldn’t load this account.</p>
        <p className="muted">{loadError}</p>
        <Link to="/setup" className="primary primary-link">
          Back to Setup
        </Link>
      </div>
    )
  }
  if (data === null) return <div className="screen center-message muted">Loading…</div>

  const { account, items, unassigned, total, siblings } = data
  const currency = account.bank.currency
  const active = items.filter((i) => !i.archived)
  const archived = items.filter((i) => i.archived)
  // Planned total per month: monthly plans, plus each dated goal's share for this month.
  const totalPlan = active.reduce(
    (sum, i) =>
      sum + (i.target_type === 'by_date' && i.target_date ? targetPace(i.balance, i.planned_amount, i.target_date).perMonth : i.planned_amount),
    0,
  )
  const nextOrder = Math.max(-1, ...items.map((i) => i.sort_order)) + 1
  const isCard = account.kind === 'credit'
  const owed = -total // a card's total is minus what it owes
  const off = Math.round((account.bank_balance - (isCard ? owed : total)) * 100) / 100
  const position = siblings.findIndex((s) => s.id === account.id)

  // Only an empty budget item can be archived.
  function archiveItem(item) {
    if (Math.round(item.balance * 100) !== 0) {
      setActionError(`${item.name} still holds ${formatMoney(item.balance, currency)}. Spend it or move it first, then archive.`)
      return
    }
    if (window.confirm(`Archive ${item.name}? It disappears from Budget. You can restore it later.`)) {
      run(() => updateItem(item.id, { archived: true })).then((ok) => ok && setEditingId(null))
    }
  }

  // Only an empty account (in DollarHome AND at the bank) can be archived.
  function archiveAccount() {
    if (Math.round(total * 100) !== 0) {
      setActionError(`${account.name} still holds ${formatMoney(total, currency)} in DollarHome. Move or spend it first.`)
      return
    }
    if (account.bank_balance !== 0) {
      setActionError('The bank still shows a balance. Update it to 0 once the account is empty, then archive.')
      return
    }
    if (window.confirm(`Archive ${account.name}? Its section disappears from Budget. You can restore it later.`)) {
      run(() => updateRow('accounts', account.id, { archived: true })).then((ok) => ok && navigate('/setup'))
    }
  }

  // Delete is for an account that was never used; the database says why if it can't.
  function deleteThisAccount() {
    if (window.confirm(`Delete ${account.name} for good? This only works for an account that was never used. Otherwise archive it.`)) {
      run(() => deleteAccount(account.id)).then((ok) => ok && navigate('/setup'))
    }
  }

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">
          {account.bank.name.toUpperCase()} · {currency}
        </span>
        <h1>{account.name}</h1>
      </header>

      {/* Balance: what the bank says vs what DollarHome holds. */}
      <button type="button" className="balance-card" onClick={() => setBalanceOpen(true)}>
        <span className="setup-row-main">
          <span>
            {isCard ? 'Statement says it owes ' : 'Bank says '}
            <span className="money strong">{formatMoney(account.bank_balance, currency)}</span>
          </span>
          <span className="muted setup-row-sub">
            {account.balance_checked_at ? `Checked ${shortDate(account.balance_checked_at.slice(0, 10))}` : 'Not checked yet'}
            {off === 0 ? (
              <span className="match-ok"> · matches</span>
            ) : (
              <span className="match-off"> · off by {formatMoney(Math.abs(off), currency)}</span>
            )}
            {!isCard && unassigned !== 0 && ` · ${formatMoney(unassigned, currency)} unassigned`}
            {isCard && ` · DollarHome says ${formatMoney(owed, currency)}`}
          </span>
        </span>
        <span className="small-button">Update</span>
      </button>

      {actionError && (
        <p className="notice" role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <div className="reminder" role="status">
          <span>{notice}</span>
          <button type="button" className="small-button" onClick={() => setNotice(null)}>
            Done ✓
          </button>
        </div>
      )}

      {isCard && (
        <p className="hint card-note">
          A credit card has no budget items. Spend from your envelopes and choose this card under <strong>Paid with</strong>;
          the money is set aside in its payment envelope until you tap <strong>Pay card</strong> on Budget.
        </p>
      )}

      <section className="bank-card" hidden={isCard}>
        <div className="bank-card-head">
          <h2>Budget items</h2>
          <span className="muted setup-row-sub">
            Planned <span className="money">{formatMoney(totalPlan, currency)}</span> a month
          </span>
        </div>

        {active.length === 0 && <p className="muted empty--small">No budget items yet. Add your first one below.</p>}

        {active.map((item, index) =>
          editingId === item.id ? (
            <ItemForm
              key={item.id}
              currency={currency}
              initial={item}
              submitLabel="Save"
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSubmit={async (f) =>
                (await run(() =>
                  updateItem(item.id, {
                    name: f.name,
                    planned_amount: f.plannedAmount,
                    target_type: f.targetType,
                    target_date: f.targetType === 'by_date' ? f.targetDate : null,
                  }),
                )) && setEditingId(null)
              }
              // Rarely-used tools live inside the editor, not on every row.
              extra={
                <>
                  <button type="button" className="small-button" disabled={busy || index === 0} onClick={() => run(() => swapOrder('categories', item, active[index - 1]))}>
                    Move up
                  </button>
                  <button type="button" className="small-button" disabled={busy || index === active.length - 1} onClick={() => run(() => swapOrder('categories', item, active[index + 1]))}>
                    Move down
                  </button>
                  <button type="button" className="small-button small-button--danger" disabled={busy} onClick={() => archiveItem(item)}>
                    Archive
                  </button>
                  <MoveItem
                    item={item}
                    account={account}
                    currency={currency}
                    busy={busy}
                    onMove={async (toId) => {
                      let result = null
                      const ok = await run(async () => {
                        result = await moveItem(item.id, toId)
                      })
                      if (!ok || !result) return
                      setEditingId(null)
                      const amount = Number(result.balance)
                      const parts = [`Moved ${item.name} to ${result.to_account}.`]
                      if (amount !== 0) {
                        parts.push(
                          `It brought ${formatMoney(amount, currency)} with it — move ${formatMoney(Math.abs(amount), currency)} from ${
                            amount > 0 ? result.from_account : result.to_account
                          } to ${amount > 0 ? result.to_account : result.from_account} in your bank app, then update both balances.`,
                        )
                      }
                      if (result.removed_from_splits?.length) {
                        parts.push(`It was taken out of these paycheck splits: ${result.removed_from_splits.join(', ')}.`)
                      }
                      setNotice(parts.join(' '))
                    }}
                  />
                </>
              }
            />
          ) : (
            <button key={item.id} type="button" className="account-link" onClick={() => setEditingId(item.id)}>
              <span className="setup-row-main">
                <span className="setup-row-name">{item.name}</span>
                <span className="muted setup-row-sub">
                  {item.target_type === 'by_date' && item.target_date ? (
                    <>
                      Goal <span className="money">{formatMoney(item.planned_amount, currency)}</span> by{' '}
                      {monthYear(item.target_date)}
                    </>
                  ) : (
                    <>
                      Plan <span className="money">{formatMoney(item.planned_amount, currency)}</span> a month
                    </>
                  )}{' '}
                  · holds <span className="money">{formatMoney(item.balance, currency)}</span>
                </span>
              </span>
              <span className="muted edit-word">Edit</span>
            </button>
          ),
        )}

        <AddItem
          currency={currency}
          busy={busy}
          onAdd={(f) => run(() => addItem({ accountId, ...f, sortOrder: nextOrder }))}
        />

        {archived.length > 0 && (
          <details className="archived">
            <summary>Archived items ({archived.length})</summary>
            {archived.map((item) => (
              <div key={item.id} className="setup-row setup-row--archived">
                <span>{item.name}</span>
                <button type="button" className="small-button" disabled={busy} onClick={() => run(() => updateItem(item.id, { archived: false }))}>
                  Restore
                </button>
              </div>
            ))}
          </details>
        )}
      </section>

      {/* Account settings: folded away until needed. */}
      <details className="settings">
        <summary>Account settings</summary>
        {renaming ? (
          <NameForm
            initial={account.name}
            label="Account name"
            busy={busy}
            onCancel={() => setRenaming(false)}
            onSave={async (name) => (await run(() => updateRow('accounts', account.id, { name }))) && setRenaming(false)}
          />
        ) : (
          <div className="row-actions">
            <button type="button" className="small-button" disabled={busy} onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button
              type="button"
              className="small-button"
              disabled={busy || position <= 0}
              onClick={() => run(() => swapOrder('accounts', siblings[position], siblings[position - 1]))}
            >
              Move up
            </button>
            <button
              type="button"
              className="small-button"
              disabled={busy || position < 0 || position >= siblings.length - 1}
              onClick={() => run(() => swapOrder('accounts', siblings[position], siblings[position + 1]))}
            >
              Move down
            </button>
            <button type="button" className="small-button small-button--danger" disabled={busy} onClick={archiveAccount}>
              Archive account
            </button>
            <button type="button" className="small-button small-button--danger" disabled={busy} onClick={deleteThisAccount}>
              Delete account
            </button>
          </div>
        )}
        <p className="hint">Order sets where this section appears on the {account.bank.name} tab.</p>
      </details>

      {balanceOpen && (
        <BalanceSheet
          account={{ ...account, total, owed }}
          currency={currency}
          onClose={() => setBalanceOpen(false)}
          onSave={async (amount) => {
            await setBankBalance(account.id, amount)
            setBalanceOpen(false)
            reload()
          }}
          onAdjust={async (amount, change) => {
            await adjustToBank(account.id, amount, change)
            setBalanceOpen(false)
            reload()
          }}
        />
      )}
    </div>
  )
}

function AddItem({ currency, busy, onAdd }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="link-button add-link" onClick={() => setOpen(true)}>
        + Add budget item
      </button>
    )
  }
  return (
    <ItemForm
      currency={currency}
      initial={null}
      submitLabel="Add item"
      busy={busy}
      onCancel={() => setOpen(false)}
      // Stays open after adding, so several items can go in one after another.
      onSubmit={(f) => onAdd(f)}
      clearAfterSubmit
    />
  )
}

// Name + target. Used for adding and for editing.
// Target: Monthly (aim to have this much each month) or Save up to an amount by a date.
function ItemForm({ currency, initial, submitLabel, busy, onSubmit, onCancel, clearAfterSubmit, extra }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [planText, setPlanText] = useState(initial ? String(initial.planned_amount) : '')
  const [targetType, setTargetType] = useState(initial?.target_type ?? 'monthly')
  const [targetDate, setTargetDate] = useState(initial?.target_date ?? '')
  const [error, setError] = useState(null)
  const isGoal = targetType === 'by_date'

  // Live preview for a goal: "$350/mo to reach it by Jun 2027".
  const plan = planText.trim() === '' ? 0 : parseBalance(planText)
  const preview =
    isGoal && targetDate && plan > 0 ? targetPace(initial?.balance ?? 0, plan, targetDate) : null

  return (
    <form
      className="add-account"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        if (plan === null || plan < 0) {
          setError(isGoal ? 'Enter the goal amount, like 3000' : 'Enter the planned amount, like 600 (or leave it blank for no plan)')
          return
        }
        if (isGoal && (!targetDate || plan === 0)) {
          setError('A goal needs an amount and a date.')
          return
        }
        setError(null)
        const ok = await onSubmit({ name: name.trim(), plannedAmount: plan, targetType, targetDate: isGoal ? targetDate : null })
        if (ok && clearAfterSubmit) {
          setName('')
          setPlanText('')
          setTargetType('monthly')
          setTargetDate('')
        }
      }}
    >
      <label className="field">
        <span>Name</span>
        <input placeholder="e.g. Groceries" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>

      <fieldset className="segmented">
        <legend>Target</legend>
        <label className={!isGoal ? 'on' : ''}>
          <input type="radio" name={`target-${initial?.id ?? 'new'}`} checked={!isGoal} onChange={() => setTargetType('monthly')} />
          Monthly
        </label>
        <label className={isGoal ? 'on' : ''}>
          <input type="radio" name={`target-${initial?.id ?? 'new'}`} checked={isGoal} onChange={() => setTargetType('by_date')} />
          Save up by a date
        </label>
      </fieldset>

      <div className="spend-row">
        <label className="field">
          <span>{isGoal ? `Goal (${currency})` : `Each month (${currency})`}</span>
          <input inputMode="decimal" placeholder="0" value={planText} onChange={(e) => setPlanText(e.target.value)} />
        </label>
        {isGoal && (
          <label className="field field--date">
            <span>By</span>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
        )}
      </div>

      <p className="hint">
        {isGoal
          ? preview
            ? preview.need === 0
              ? 'Already funded.'
              : preview.months === 0
                ? 'That date has passed.'
                : `Put about ${formatMoney(preview.perMonth, currency)} a month in to reach it by ${monthYear(targetDate)}.`
            : 'For a goal or a bill: a vacation, an emergency fund, a tax payment.'
          : 'For everyday spending: what you aim to have in it each month.'}
      </p>

      {error && <p className="notice">{error}</p>}
      <div className="inline-form">
        <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          {submitLabel}
        </button>
        <button type="button" className="small-button" onClick={onCancel}>
          {clearAfterSubmit ? 'Done' : 'Cancel'}
        </button>
      </div>
      {extra && <div className="row-actions edit-strip">{extra}</div>}
    </form>
  )
}

// "Move to another account": pick a bank account in the same currency.
// The item always brings its money and history along.
function MoveItem({ item, account, currency, busy, onMove }) {
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState(null)
  const [toId, setToId] = useState('')

  useEffect(() => {
    if (!open || targets) return
    fetchSetup()
      .then((banks) =>
        setTargets(
          banks
            .filter((b) => !b.archived && b.currency === currency)
            .flatMap((b) =>
              b.accounts
                .filter((a) => !a.archived && a.kind !== 'credit' && a.id !== account.id)
                .map((a) => ({ id: a.id, label: `${b.name} · ${a.name}`, otherBank: b.id !== account.bank_id })),
            ),
        ),
      )
      .catch(() => setTargets([]))
  }, [open, targets, currency, account.id, account.bank_id])

  if (!open) {
    return (
      <button type="button" className="small-button" disabled={busy} onClick={() => setOpen(true)}>
        Move to another account
      </button>
    )
  }

  const target = targets?.find((t) => t.id === toId)
  return (
    <div className="move-item">
      {targets === null && <p className="muted">Loading accounts…</p>}
      {targets?.length === 0 && <p className="muted">No other {currency} bank accounts to move it to.</p>}
      {targets?.length > 0 && (
        <>
          <select className="field-select" aria-label="Move to" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Move to…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {target && (
            <p className="hint">
              {item.name} moves with its history
              {item.balance !== 0 && ` and its ${formatMoney(item.balance, currency)}`}. Then move that money in your bank
              app.{target.otherBank && ' It will be taken out of this bank’s paycheck splits.'}
            </p>
          )}
          <div className="inline-form">
            <button type="button" className="small-button" disabled={busy || !toId} onClick={() => onMove(toId)}>
              Move it
            </button>
            <button type="button" className="small-button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
