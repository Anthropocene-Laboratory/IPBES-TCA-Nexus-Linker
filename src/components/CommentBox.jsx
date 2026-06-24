import { useEffect, useRef, useState } from 'react'

// Small note field for a link. Holds local text and saves on blur (only if
// changed). Remount via `key` when the underlying link identity changes.
export default function CommentBox({ initial, onSave, disabled }) {
  const [val, setVal] = useState(initial || '')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const savedTimer = useRef(null)

  useEffect(() => {
    setVal(initial || '')
  }, [initial])

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    },
    [],
  )

  async function handleBlur() {
    const next = val.trim()
    if (next === (initial || '').trim()) return
    setStatus('saving')
    setError('')
    try {
      await onSave(next)
      setStatus('saved')
      savedTimer.current = setTimeout(() => setStatus('idle'), 1800)
    } catch (err) {
      setStatus('error')
      setError(err.message || 'Unable to save the note.')
    }
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/70 p-2">
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        rows={2}
        aria-label="Rationale for this link"
        placeholder="Add a short rationale (optional)"
        className="w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
      />
      <div className="mt-1 min-h-3 text-[10px]" aria-live="polite">
        {status === 'saving' && <span className="text-slate-500">Saving…</span>}
        {status === 'saved' && <span className="text-emerald-700">Saved</span>}
        {status === 'error' && <span className="text-red-700">{error}</span>}
      </div>
    </div>
  )
}
