import { useState } from 'react'

// Lightweight shared-passphrase gate to keep casual visitors out (pilot only).
// Not a real secret — the code ships in the bundle — but enough to gate an
// unlisted URL among trusted experts.
export default function AccessGate({ expected, onUnlock }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (code.trim() === expected) {
      onUnlock(code.trim())
    } else {
      setError('Incorrect access code.')
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900">TCA ↔ Nexus Linker</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter the access code shared with the expert group.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="password"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Access code"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Enter
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    </div>
  )
}
