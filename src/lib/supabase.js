import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

// When not configured we still export a client-shaped placeholder so imports
// don't crash; the UI shows a configuration message instead.
export const supabase = isConfigured
  ? createClient(url, anonKey)
  : null
