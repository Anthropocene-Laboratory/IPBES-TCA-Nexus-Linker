import { useState } from 'react'
import { supabase } from '../lib/supabase'

const ID_KEY = 'tcaNexusExpertId'
const NAME_KEY = 'tcaNexusExpertName'

// Lightweight identity: the expert types a display name. We mint a stable
// browser UUID and store the name so links are attributed (no login).
export default function NameSetup({ onDone }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const id = localStorage.getItem(ID_KEY) || crypto.randomUUID()
    const profile = { id, name: name.trim() }
    const { error } = await supabase
      .from('experts')
      .upsert(profile, { onConflict: 'id' })
    if (error) {
      setError(error.message)
      setSaving(false)
    } else {
      localStorage.setItem(ID_KEY, id)
      localStorage.setItem(NAME_KEY, profile.name)
      onDone(profile)
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
          Enter the name your links will be attributed to for other experts.
        </p>
        <form onSubmit={save} className="mt-3 space-y-3">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
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
