import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { addGroup, addStarterGroups, deleteGroup, fetchGroups, renameGroup } from '../api/categories.js'
import { swapOrder } from '../api/setup.js'
import { NameForm } from './SetupScreen.jsx'
import { friendlyError } from '../lib/errors.js'

// Setup → Categories: the list budget items pick from (Utilities, Food…).
// Renaming one renames it on every item; deleting one leaves its items as "Other".
// The order here is the order on Analytics.
// Address: /setup/categories
export default function CategoriesScreen() {
  const [groups, setGroups] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((n) => n + 1)

  useEffect(() => {
    let ignore = false
    fetchGroups()
      .then((g) => !ignore && (setGroups(g), setLoadError(null)))
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [reloadCount])

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
        <p>Couldn’t load your categories.</p>
        <p className="muted">{loadError}</p>
        <Link to="/setup" className="primary primary-link">
          Back to Setup
        </Link>
      </div>
    )
  }
  if (groups === null) return <div className="screen center-message muted">Loading…</div>

  const nextOrder = Math.max(0, ...groups.map((g) => g.sort_order)) + 1

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Categories</h1>
      </header>
      <p className="muted setup-intro">
        Each budget item can have one category; Analytics adds spending and plans up by category, in this order. Pick an item’s
        category in Setup → the account → tap the item. Items without one show as Other.
      </p>

      {actionError && (
        <p className="notice" role="alert">
          {actionError}
        </p>
      )}

      <section className="bank-card">
        {groups.length === 0 && (
          <div className="empty--small">
            <p className="muted">No categories yet.</p>
            <button type="button" className="small-button" disabled={busy} onClick={() => run(() => addStarterGroups(groups))}>
              Add the starter list
            </button>
          </div>
        )}
        {groups.map((g, index) =>
          editingId === g.id ? (
            <div key={g.id} className="group-edit">
              <NameForm
                initial={g.name}
                label="Category name"
                busy={busy}
                onCancel={() => setEditingId(null)}
                onSave={async (name) => (await run(() => renameGroup(g.id, name))) && setEditingId(null)}
              />
              <div className="row-actions">
                <button type="button" className="small-button" disabled={busy || index === 0} onClick={() => run(() => swapOrder('category_groups', g, groups[index - 1]))}>
                  Move up
                </button>
                <button
                  type="button"
                  className="small-button"
                  disabled={busy || index === groups.length - 1}
                  onClick={() => run(() => swapOrder('category_groups', g, groups[index + 1]))}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="small-button small-button--danger"
                  disabled={busy}
                  onClick={async () => {
                    const msg = g.used
                      ? `Delete ${g.name}? Its ${g.used} budget ${g.used === 1 ? 'item goes' : 'items go'} back to Other.`
                      : `Delete ${g.name}?`
                    if (window.confirm(msg) && (await run(() => deleteGroup(g.id)))) setEditingId(null)
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button key={g.id} type="button" className="account-link" onClick={() => setEditingId(g.id)}>
              <span className="setup-row-main">
                <span className="setup-row-name">{g.name}</span>
                <span className="muted setup-row-sub">{g.used ? `${g.used} budget ${g.used === 1 ? 'item' : 'items'}` : 'Not used yet'}</span>
              </span>
              <span className="muted edit-word">Edit</span>
            </button>
          ),
        )}

        {adding ? (
          <NameForm
            initial=""
            label="New category"
            busy={busy}
            onCancel={() => setAdding(false)}
            onSave={async (name) => (await run(() => addGroup(name, nextOrder))) && setAdding(false)}
          />
        ) : (
          <button type="button" className="link-button add-link" onClick={() => setAdding(true)}>
            + Add a category
          </button>
        )}
      </section>
    </div>
  )
}
