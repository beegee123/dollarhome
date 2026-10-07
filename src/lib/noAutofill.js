// Tell password managers (Keeper, 1Password, LastPass, Bitwarden, Dashlane...)
// that DollarHome's forms are not logins, so they stop offering to save
// envelope names and amounts. The sign-in form is left alone on purpose,
// so you can still save your DollarHome password.
const SKIP = '.sign-in'
// Never touch anything inside a rich-text editor (Bill notes). The editor redraws any
// checkbox whose attributes change, the redrawn checkbox got marked again, and the two
// fed each other forever: the note froze as soon as a checklist appeared.
const EDITOR = '[contenteditable], .ProseMirror'

function mark(el) {
  if (el.closest(SKIP) || el.closest(EDITOR) || el.dataset.noAutofill) return
  el.dataset.noAutofill = '1'
  el.setAttribute('autocomplete', 'off')
  el.setAttribute('data-lpignore', 'true') // LastPass
  el.setAttribute('data-1p-ignore', 'true') // 1Password
  el.setAttribute('data-bwignore', 'true') // Bitwarden
  el.setAttribute('data-form-type', 'other') // Dashlane
}

function markAll(root) {
  if (root.nodeType !== 1 || root.closest(EDITOR)) return
  if (root.matches('form, input, textarea, select')) mark(root)
  root.querySelectorAll('form, input, textarea, select').forEach(mark)
}

// Mark what's on screen now, then anything React adds later.
export function stopPasswordManagerPrompts() {
  markAll(document.body)
  new MutationObserver((changes) => {
    changes.forEach((c) => c.addedNodes.forEach(markAll))
  }).observe(document.body, { childList: true, subtree: true })
}
