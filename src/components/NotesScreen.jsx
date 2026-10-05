import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fetchNote, saveNote } from '../api/notes.js'
import { friendlyError } from '../lib/errors.js'

// Bill notes: one long note that saves itself as you type.
// Address: /setup/notes
export default function NotesScreen() {
  const [body, setBody] = useState(null) // null = loading
  const [status, setStatus] = useState('') // '', 'Saving…', 'Saved', or an error
  const [loadError, setLoadError] = useState(null)
  const saved = useRef('') // the text the database has
  const timer = useRef(null)

  useEffect(() => {
    let ignore = false
    fetchNote()
      .then((note) => {
        if (ignore) return
        saved.current = note.body
        setBody(note.body)
        if (note.updated_at) setStatus(`Saved ${when(note.updated_at)}`)
      })
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [])

  async function save(text) {
    clearTimeout(timer.current)
    if (text === saved.current) return
    setStatus('Saving…')
    try {
      const at = await saveNote(text)
      saved.current = text
      setStatus(`Saved ${when(at)}`)
    } catch (err) {
      setStatus(`Not saved: ${friendlyError(err)}`)
    }
  }

  // Save a second after typing stops, and when leaving the box or the screen.
  function handleChange(text) {
    setBody(text)
    setStatus('Not saved yet')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(text), 1000)
  }
  const latest = useRef(body)
  latest.current = body
  useEffect(() => () => latest.current !== null && save(latest.current), []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen">
      <header className="screen-header screen-header--sub">
        <Link to="/setup" className="back-link">
          ← Setup
        </Link>
        <span className="eyebrow">DOLLARHOME</span>
        <h1>Bill notes</h1>
      </header>

      {loadError ? (
        <p className="notice" role="alert">Couldn’t load your notes. {loadError}</p>
      ) : body === null ? (
        <p className="muted center-message">Loading…</p>
      ) : (
        <>
          <textarea
            className="notes-box"
            aria-label="Bill notes"
            placeholder={'Anything to remember about your bills.\n\ne.g. Water bill comes every 3 months, around the 15th.'}
            value={body}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => save(body)}
          />
          <p className={`muted notes-status ${status.startsWith('Not saved:') ? 'match-off' : ''}`} aria-live="polite">
            {status}
          </p>
        </>
      )}
    </div>
  )
}

function when(iso) {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}
