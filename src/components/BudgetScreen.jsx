import { useEffect, useState } from 'react'
import BudgetRow from './BudgetRow.jsx'
import SearchBox from './SearchBox.jsx'
import { fetchBudget } from '../api/budget.js'
import { supabase } from '../lib/supabase.js'
import { formatMoney, normalize } from '../lib/money.js'

// The home screen: bank tabs → account sections → budget items.
export default function BudgetScreen() {
  const [banks, setBanks] = useState(null) // null = still loading
  const [loadError, setLoadError] = useState(null)
  const [bankId, setBankId] = useState(null) // which tab is open
  const [query, setQuery] = useState('') // search text
  const [reloadCount, setReloadCount] = useState(0) // bump to load again

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
        <button type="button" className="link-button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      {banks.length === 0 ? (
        <p className="empty">
          No banks yet. Setting up banks and accounts comes in Step 5 — for now, load the sample data
          (<code>supabase/dev_sample_data.sql</code>).
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

          <main className="account-list">
            {search && sections.length === 0 && <p className="empty">No budget items match “{query.trim()}”.</p>}

            {sections.map(({ bank: b, account, title, items }) => (
              <AccountSection key={account.id} bank={b} account={account} title={title} items={items} searching={!!search} />
            ))}
          </main>
        </>
      )}
    </div>
  )
}

// One account: its title, the match check against the bank, Unassigned, then its budget items.
function AccountSection({ bank, account, title, items, searching }) {
  const off = Math.round((account.bank_balance - account.total) * 100) / 100 // round away float dust
  const unassigned = account.unassigned?.balance ?? 0

  return (
    <section className="account-section" aria-label={title}>
      <h2 className="section-title section-title--split">
        <span>{title}</span>
        {off === 0 ? (
          <span className="match match-ok">Matches bank {formatMoney(account.bank_balance, bank.currency)}</span>
        ) : (
          <span className="match match-off">Off by {formatMoney(Math.abs(off), bank.currency)} vs bank</span>
        )}
      </h2>

      {/* Unassigned only shows when it holds money (and not in search results). */}
      {!searching && unassigned !== 0 && (
        <div className="unassigned-row">
          <span>
            <span className="muted unassigned-label">Unassigned</span>
            <span className="unassigned-amount">{formatMoney(unassigned, bank.currency)}</span>
          </span>
        </div>
      )}

      {items.length === 0 && !searching && <p className="empty empty--small">No budget items in this account yet.</p>}

      {items.map((item) => (
        <BudgetRow key={item.id} item={item} currency={bank.currency} />
      ))}
    </section>
  )
}
