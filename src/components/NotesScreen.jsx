import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { fetchNote, saveNote } from '../api/notes.js'
import { friendlyError } from '../lib/errors.js'

// Bill notes: one long note with simple formatting (bold, italic, strikethrough,
// bullets, numbering, checklists) that saves itself as you type.
// Stored as HTML in money.notes.body. A note typed before formatting existed is
// plain text; it's turned into paragraphs the first time it opens.
// Address: /setup/notes
export default function NotesScreen() {
  const [loaded, setLoaded] = useState(null) // null = loading; otherwise the note's HTML
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let ignore = false
    fetchNote()
      .then((note) => !ignore && setLoaded({ html: toHtml(note.body), updatedAt: note.updated_at }))
      .catch((err) => !ignore && setLoadError(friendlyError(err)))
    return () => {
      ignore = true
    }
  }, [])

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
      ) : loaded === null ? (
        <p className="muted center-message">Loading…</p>
      ) : (
        <NoteEditor initialHtml={loaded.html} updatedAt={loaded.updatedAt} />
      )}
    </div>
  )
}

// Created once, outside the component. Building these again on every render makes the editor
// rebuild itself each time the "Saved" line changes, which froze the note after using Bold.
const EXTENSIONS = [
  // Keep it to what a bill note needs.
  StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, link: false, underline: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
]
const EDITOR_PROPS = {
  attributes: { class: 'notes-editor', 'aria-label': 'Bill notes', role: 'textbox', 'aria-multiline': 'true' },
}

function NoteEditor({ initialHtml, updatedAt }) {
  const [status, setStatus] = useState(updatedAt ? `Saved ${when(updatedAt)}` : '')
  const saved = useRef(initialHtml) // what the database has
  const timer = useRef(null)

  const save = useCallback(async (ed) => {
    clearTimeout(timer.current)
    const html = ed.isEmpty ? '' : ed.getHTML()
    if (html === saved.current) return
    setStatus('Saving…')
    try {
      const at = await saveNote(html)
      saved.current = html
      setStatus(`Saved ${when(at)}`)
    } catch (err) {
      setStatus(`Not saved: ${friendlyError(err)}`)
    }
  }, [])

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initialHtml,
    editorProps: EDITOR_PROPS,
    shouldRerenderOnTransaction: false, // the toolbar listens for itself (Toolbar below)
    onUpdate: ({ editor }) => {
      setStatus('Not saved yet')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => save(editor), 1000)
    },
    onBlur: ({ editor }) => save(editor),
  })

  // Save anything still waiting when leaving the screen.
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) save(editor)
    }
  }, [editor, save])

  if (!editor) return <p className="muted center-message">Loading…</p>

  return (
    <>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <p className={`muted notes-status ${status.startsWith('Not saved:') ? 'match-off' : ''}`} aria-live="polite">
        {status}
      </p>
    </>
  )
}

function Toolbar({ editor }) {
  // Re-reads which buttons are "on" whenever the cursor or text changes.
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
    }),
  })
  const buttons = [
    { label: 'B', title: 'Bold', cls: 'tb-bold', active: 'bold', run: () => editor.chain().focus().toggleBold().run() },
    { label: 'I', title: 'Italic', cls: 'tb-italic', active: 'italic', run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'S', title: 'Strikethrough', cls: 'tb-strike', active: 'strike', run: () => editor.chain().focus().toggleStrike().run() },
    { label: '•', title: 'Bullet list', active: 'bulletList', run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Numbered list', active: 'orderedList', run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '☐', title: 'Checklist', active: 'taskList', run: () => editor.chain().focus().toggleTaskList().run() },
  ]
  return (
    <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
      {buttons.map((b) => (
        <button
          key={b.title}
          type="button"
          className={`tb-button ${b.cls ?? ''} ${on?.[b.active] ? 'on' : ''}`}
          title={b.title}
          aria-label={b.title}
          aria-pressed={!!on?.[b.active]}
          // Keep the cursor in the note when tapping a button.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.run}
        >
          {b.label}
        </button>
      ))}
    </div>
  )
}

// A note saved before formatting existed is plain text: make each line a paragraph.
function toHtml(body) {
  const text = body ?? ''
  if (text.trim() === '' || text.trimStart().startsWith('<')) return text
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split('\n')
    .map((line) => `<p>${escape(line)}</p>`)
    .join('')
}

function when(iso) {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}
