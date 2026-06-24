import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Passwordless sign-in via a 6-digit code (OTP). We deliberately avoid the
// clickable magic link because email click-tracking wrappers get blocked by
// ad blockers; typing a code sidesteps that entirely.
export default function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('email') // email | code
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendCode(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setStep('code')
  }

  async function verifyCode(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) setError(error.message)
    // On success, onAuthStateChange (in App) takes over.
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900">TCA ↔ Nexus Linker</h1>
        <p className="mt-2 text-sm text-slate-500">
          Expert tool: link TCA actions to Nexus response options.
        </p>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Email address
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
              disabled={busy}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-slate-400">
              Passwordless sign-in: we email you a 6-digit code. This is also the email
              we'll use to contact you.
            </p>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="mt-6 space-y-3">
            <p className="text-sm text-slate-600">
              Enter the code sent to <strong>{email}</strong>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="Code"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.3em] font-mono focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
            <button
              type="submit"
              disabled={busy || code.length < 6}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError('')
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              ← Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
