import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchSourceForm, saveSource } from '../api/income.js'
import { formatMoney, parseBalance } from '../lib/money.js'
import { friendlyError } from '../lib/errors.js'

// Add or edit one income source: its name, where it lands, and its split.
// Address: /setup/income/new  or  /setup/income/<id>
export default function IncomeSourceForm() {
  const { sourceId } = useParams()
  const isNew = sourceId === 'new'
  const navigate = useNavigate()

  const [banks, setBanks] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [splitType, setSplitType] = useState('fixed')
  const [values, setValues] = useState({}) // budget item id → what's typed in its box
  const [showOthers, setShowOthers] = useState(false) // show the bank's OTHER accounts (transfers)?
  const [example, setExample] = useState('') // percent splits: a sample payout to see dollar amounts

  useEffect(() => {
    let ignore = false
    fetchSourceForm(isNew ? null : sourceId)
      .then(({ banks, source }) => {
        if (ignore) return
        setBanks(banks)
        if (source) {
          setName(source.name)
          setAccountId(source.account_id)
          setSplitType(source.split_type)
          setValues(Object.fromEntries(source.lines.map((l) => [l.category_id, String(l.value)])))
          // If this split already sends money to another account, open that part.
          const landingItems = new Set(
            banks.flatMap((b) => b.accounts).find((a) => a.id === source.account_id)?.items.map((i) => i.id) ?? [],
          )
          setShowOthers(source.lines.some((l) => !landingItems.has(l.category_id)))
        } else {
          setAccountId(banks[0]?.accounts[0]?.id ?? '')
        }
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [sourceId, isNew])

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load this income source.</p>
        <p className="muted">{loadError}</p>
        <Link to="/setup/income" className="primary primary-link">
          Back
        </Link>
      </div>
    )
  }
  if (banks === null) return <div className="screen center-message muted">Loading…</div>

  // The bank the money lands at decides which budget items can be in the split.
  const bank = banks.find((b) => b.accounts.some((a) => a.id === accountId))
  const currency = bank?.currency ?? 'USD'
  const itemIdsAtBank = new Set(bank?.accounts.flatMap((a) => a.items.map((i) => i.id)) ?? [])

  // Turn the typed boxes into lines. Blank boxes are simply not in the split.
  const typed = Object.entries(values).filter(([id, text]) => itemIdsAtBank.has(id) && text.trim() !== '')
  const lines = typed.map(([id, text]) => ({ category_id: id, value: parseBalance(text) }))
  const invalid = lines.some((l) => l.value === null || l.value <= 0)
  const total = lines.reduce((sum, l) => sum + (l.value > 0 ? l.value : 0), 0)
  const percentOff = splitType === 'percent' && Math.round(total * 100) !== 10000

  // The landing account comes first; the bank's other accounts only matter for transfers.
  const landing = bank?.accounts.find((a) => a.id === accountId)
  const others = bank?.accounts.filter((a) => a.id !== accountId) ?? []

  // Total per account, so you know how much to move between accounts at the real bank.
  const sumFor = (a) =>
    lines.filter((l) => l.value > 0 && a.items.some((i) => i.id === l.category_id)).reduce((sum, l) => sum + l.value, 0)
  const perAccount = [landing, ...others].filter(Boolean).map((a) => ({ id: a.id, name: a.name, amount: sumFor(a) }))
  const transfers = perAccount.filter((t) => t.id !== accountId && t.amount > 0)
  const examplePayout = splitType === 'percent' ? parseBalance(example) : null
  const showAmount = (n) => (splitType === 'fixed' ? formatMoney(n, currency) : `${Math.round(n * 100) / 100}%`)
  // Percent splits also show dollars when a sample payout is typed in.
  const showWithDollars = (n) =>
    splitType === 'percent' && examplePayout > 0
      ? `${showAmount(n)} · ${formatMoney(Math.round(examplePayout * n) / 100, currency)}`
      : showAmount(n)

  function groupProps() {
    return {
      currency,
      splitType,
      values,
      sumLabel: (a) => showWithDollars(sumFor(a)),
      onChange: (itemId, text) => setValues((v) => ({ ...v, [itemId]: text })),
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!name.trim() || !accountId) return
    if (invalid) {
      setSaveError('Each amount must be a number above 0 (leave a box blank to skip that item).')
      return
    }
    if (percentOff) {
      setSaveError(`Percentages must add up to 100. They add up to ${total}.`)
      return
    }
    setBusy(true)
    setSaveError(null)
    try {
      await saveSource({ id: isNew ? null : sourceId, name, accountId, splitType, lines })
      navigate('/setup/income')
    } catch (err) {
      setSaveError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup/income" className="back-link">
          ← Income sources
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>{isNew ? 'New income source' : name || 'Income source'}</h1>
      </header>

      {banks.every((b) => b.accounts.length === 0) ? (
        <p className="empty">
          Add a bank and an account in <Link to="/setup">Setup</Link> first.
        </p>
      ) : (
        <form className="source-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Name</span>
            <input placeholder="e.g. Job A · 1st check" value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="field">
            <span>Lands in</span>
            {/* Accounts grouped by bank. */}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {banks.map((b) =>
                b.accounts.length === 0 ? null : (
                  <optgroup key={b.id} label={`${b.name} (${b.currency})`}>
                    {b.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {b.name} · {a.name}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>

          <fieldset className="segmented">
            <legend>Split by</legend>
            <label className={splitType === 'fixed' ? 'on' : ''}>
              <input type="radio" name="split" value="fixed" checked={splitType === 'fixed'} onChange={() => setSplitType('fixed')} />
              Fixed amounts
            </label>
            <label className={splitType === 'percent' ? 'on' : ''}>
              <input type="radio" name="split" value="percent" checked={splitType === 'percent'} onChange={() => setSplitType('percent')} />
              Percentages
            </label>
          </fieldset>
          <p className="hint">
            {splitType === 'fixed'
              ? 'For steady paychecks. Each item gets the same dollar amount every time; anything left over goes to Unassigned.'
              : 'For income that varies, like the STR. Each item gets a share of whatever comes in. Shares must add up to 100.'}
          </p>

          {/* The account the money lands in: its items are filled directly. */}
          {landing && <SplitGroup account={landing} title={`${landing.name} · where it lands`} {...groupProps()} />}

          {/* The bank's other accounts: filling an item there means a transfer. Hidden until asked for. */}
          {others.length > 0 &&
            (showOthers ? (
              <>
                <p className="hint">
                  Amounts below go to another {bank.name} account. The app records them as a transfer and reminds you
                  to move the money in your bank. Leave them blank for no transfer.
                </p>
                {others.map((a) => (
                  <SplitGroup key={a.id} account={a} title={`${a.name} · transfer`} {...groupProps()} />
                ))}
              </>
            ) : (
              <button type="button" className="link-button add-link" onClick={() => setShowOthers(true)}>
                + Send part to another {bank.name} account (transfer)
              </button>
            ))}

          <p className={`split-total ${percentOff ? 'match-off' : ''}`}>
            {splitType === 'fixed'
              ? `Split total: ${formatMoney(total, currency)} per paycheck`
              : `Total: ${Math.round(total * 100) / 100}%${percentOff ? ' — must be 100' : ''}`}
          </p>
          {splitType === 'percent' && (
            <label className="example-field">
              <span className="muted">See it in dollars for a payout of</span>
              <input inputMode="decimal" placeholder="e.g. 1850" value={example} onChange={(e) => setExample(e.target.value)} />
            </label>
          )}

          {perAccount.some((t) => t.amount > 0) && (
            <section className="account-totals" aria-label="Total per account">
              <h2 className="section-title">Total per account</h2>
              {perAccount
                .filter((t) => t.amount > 0 || t.id === accountId)
                .map((t) => (
                  <div key={t.id} className="row">
                    <span>
                      {t.name}
                      {t.id === accountId && <span className="muted"> · stays here</span>}
                    </span>
                    <span>{showWithDollars(t.amount)}</span>
                  </div>
                ))}
              {transfers.length > 0 && (
                <p className="hint">
                  At {bank.name}, move{' '}
                  {transfers.map((t) => `${showWithDollars(t.amount)} to ${t.name}`).join(', ')} from {landing?.name}.
                  {splitType === 'fixed' && ' Anything above the split total stays in ' + landing?.name + ' (Unassigned).'}
                </p>
              )}
            </section>
          )}

          {saveError && <p className="notice" role="alert">{saveError}</p>}

          <div className="sheet-actions">
            <Link to="/setup/income" className="secondary primary-link">
              Cancel
            </Link>
            <button type="submit" className="primary" disabled={busy || !name.trim() || !accountId}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// One account's budget items, each with a box for its amount or percent.
function SplitGroup({ account, title, currency, splitType, values, onChange, sumLabel }) {
  return (
    <section className="split-group">
      <h2 className="section-title section-title--split">
        <span>{title}</span>
        <span className="split-sum">{sumLabel(account)}</span>
      </h2>
      {account.items.length === 0 && <p className="muted empty--small">No budget items in this account.</p>}
      {account.items.map((item) => (
        <label key={item.id} className="split-line">
          <span>
            {item.name}
            <span className="muted split-plan"> plan {formatMoney(item.planned_amount, currency)}</span>
          </span>
          <span className="split-input">
            {splitType === 'fixed' && <span className="muted">{currency === 'CAD' ? 'C$' : '$'}</span>}
            <input
              inputMode="decimal"
              placeholder="—"
              aria-label={`${item.name} ${splitType === 'fixed' ? 'amount' : 'percent'}`}
              value={values[item.id] ?? ''}
              onChange={(e) => onChange(item.id, e.target.value)}
            />
            {splitType === 'percent' && <span className="muted">%</span>}
          </span>
        </label>
      ))}
    </section>
  )
}
