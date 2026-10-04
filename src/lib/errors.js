// Turn an error into a sentence a person can act on.
// Our own messages (and the database's rule messages, like "Percentages must
// add up to 100") are already readable, so they pass straight through.
export function friendlyError(err) {
  const message = err?.message || String(err || '')

  // The browser couldn't reach Supabase at all.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Can’t reach the server. Check your internet connection and try again.'
  }
  // Signed out somewhere else, or the sign-in expired.
  if (/jwt expired|invalid jwt|not authenticated/i.test(message) || err?.status === 401) {
    return 'Your sign-in has expired. Sign out and sign in again.'
  }
  // Row-level security said no.
  if (/row-level security|permission denied/i.test(message)) {
    return 'That isn’t allowed for your account.'
  }
  // A database function is missing (an SQL file in supabase/ hasn't been run yet).
  if (/could not find the function/i.test(message)) {
    return 'The database is missing an update. Run the newest file in the supabase folder, then try again.'
  }
  return message || 'Something went wrong. Try again.'
}
