// Bill notes: one running note per person.
import { supabase } from '../lib/supabase.js'

export async function fetchNote() {
  const { data, error } = await supabase.from('notes').select('body, updated_at').maybeSingle()
  if (error) throw error
  return data ?? { body: '', updated_at: null }
}

// Creates the note the first time, then keeps replacing its text.
export async function saveNote(body) {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('notes')
    .upsert({ owner_id: auth.user.id, body, updated_at: new Date().toISOString() })
    .select('updated_at')
    .single()
  if (error) throw error
  return data.updated_at
}
