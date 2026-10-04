import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchSources, setSourceArchived } from '../api/income.js'
import { formatMoney } from '../lib/money.js'

// Setup → Income sources: the list. Tap one to edit its split.
export default function IncomeSourcesScreen() {
  const [sources, setSources] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let ignore = false
    fetchSources()
      .then((s) => !ignore && (setSources(s), setLoadError(null)))
      .catch((err) => !ignore && setLoadError(err.message))
    return () => {
      ignore = true
    }
  }, [reloadCount])

  async function toggleArchived(source, archived) {
    setBusy(true)
    setActionError(null)
    try {
      await setSourceArchived(source.id, archived)
      setReloadCount((n) => n + 1)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="screen center-message">
        <p>Couldn’t load income sources.</p>
        <p className="muted">{loadError}</p>
        <button type="button" className="primary" onClick={() => setReloadCount((n) => n + 1)}>
          Try again
        </button>
      </div>
    )
  }
  if (sources === null) return <div className="screen center-message muted">Loading…</div>

  const active = sources.filter((s) => !s.archived)
  const archived = sources.filter((s) => s.archived)

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Income sources</h1>
      </header>

      <p className="muted setup-intro">
        Each paycheck or payout has a home account and a saved split. On payday you pick the source and the split
        fills in.
      </p>

      {actionError && <p className="notice" role="alert">{actionError}</p>}

      <main className="bank-card">
        {active.length === 0 && <p className="muted empty--small">No income sources yet.</p>}

        {active.map((s) => {
          const currency = s.account.bank.currency
          const summary =
            s.split_type === 'fixed'
              ? `Fixed · ${formatMoney(s.lines.reduce((sum, l) => sum + l.value, 0), currency)} split`
              : `Percent · ${s.lines.length} ${s.lines.length === 1 ? 'line' : 'lines'}`
          return (
            <div key={s.id} className="setup-row">
              <div className="setup-row-main">
                <span className="setup-row-name">{s.name}</span>
                <span className="muted setup-row-sub">
                  Lands in {s.account.bank.name} · {s.account.name} · {summary}
                </span>
              </div>
              <div className="row-actions">
                <Link to={`/setup/income/${s.id}`} className="small-button">
                  Edit split
                </Link>
                <button type="button" className="small-button small-button--danger" disabled={busy} onClick={() => toggleArchived(s, true)}>
                  Archive
                </button>
              </div>
            </div>
          )
        })}

        <Link to="/setup/income/new" className="link-button add-link">
          + Add income source
        </Link>

        {archived.map((s) => (
          <div key={s.id} className="setup-row setup-row--archived">
            <span>
              {s.name} <span className="muted">· archived</span>
            </span>
            <button type="button" className="small-button" disabled={busy} onClick={() => toggleArchived(s, false)}>
              Restore
            </button>
          </div>
        ))}
      </main>
    </div>
  )
}
