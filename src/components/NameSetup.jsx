import { useState } from 'react'
import { supabase } from '../lib/supabase'

const ID_KEY = 'tcaNexusExpertId'
const NAME_KEY = 'tcaNexusExpertName'
const EMAIL_KEY = 'tcaNexusExpertEmail'

// Lightweight identity (no login). The EMAIL is the identity key: the same
// email always maps to one expert, so different name spellings don't create
// duplicates. The DB generates the id; we upsert on email.
export default function NameSetup({ onDone }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const normEmail = email.trim().toLowerCase()
    const { data, error } = await supabase
      .from('experts')
      .upsert({ name: name.trim(), email: normEmail }, { onConflict: 'email' })
      .select()
      .single()
    if (error) {
      setError(error.message)
      setSaving(false)
    } else {
      localStorage.setItem(ID_KEY, data.id)
      localStorage.setItem(NAME_KEY, data.name)
      localStorage.setItem(EMAIL_KEY, normEmail)
      onDone(data)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900">TCA ↔ Nexus Linker</h1>
        <p className="mt-2 text-sm text-slate-500">
          Expert tool: link TCA actions to Nexus response options.
        </p>
        <p className="mt-4 text-sm text-slate-600">
          Enter your name and email. Your name attributes your links to other experts;
          your email lets us contact you if needed.
        </p>
        <form onSubmit={save} className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institution.org"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Start'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    </div>
  )
}
