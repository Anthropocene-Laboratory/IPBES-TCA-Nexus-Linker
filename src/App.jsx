import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import NameSetup from './components/NameSetup'
import Workspace from './components/Workspace'

const ID_KEY = 'tcaNexusExpertId'
const NAME_KEY = 'tcaNexusExpertName'

function ConfigNotice() {
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-sm text-slate-600">
        <h1 className="text-lg font-semibold text-slate-900">Configuration required</h1>
        <p className="mt-2">
          Create a <code className="bg-slate-100 px-1 rounded">.env</code> file from{' '}
          <code className="bg-slate-100 px-1 rounded">.env.example</code> with your
          Supabase URL and anon key, then restart <code>npm run dev</code>.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [me, setMe] = useState(null) // { id, name }
  const [loading, setLoading] = useState(true)

  // Restore identity from this browser, if any.
  useEffect(() => {
    if (!isConfigured) {
      setLoading(false)
      return
    }
    const id = localStorage.getItem(ID_KEY)
    const name = localStorage.getItem(NAME_KEY)
    if (id && name) {
      // Make sure the expert row still exists (e.g. after a DB reset).
      supabase
        .from('experts')
        .upsert({ id, name }, { onConflict: 'id' })
        .then(() => {
          setMe({ id, name })
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [])

  function onIdentified(profile) {
    setMe(profile)
  }

  function switchExpert() {
    localStorage.removeItem(ID_KEY)
    localStorage.removeItem(NAME_KEY)
    setMe(null)
  }

  if (!isConfigured) return <ConfigNotice />
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    )
  }
  if (!me) return <NameSetup onDone={onIdentified} />
  return <Workspace me={me} onSignOut={switchExpert} />
}
