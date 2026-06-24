import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import Login from './components/Login'
import NameSetup from './components/NameSetup'
import Workspace from './components/Workspace'

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
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // With a session, load (or detect missing) the expert profile.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('experts')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setProfile(data || null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  if (!isConfigured) return <ConfigNotice />
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    )
  }
  if (!session) return <Login />
  if (!profile) return <NameSetup session={session} onDone={setProfile} />
  return <Workspace me={profile} onSignOut={signOut} />
}
