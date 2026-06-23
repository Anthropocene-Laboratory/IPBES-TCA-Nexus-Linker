// Wraps occurrences of `query` inside `text` with a <mark> highlight.
// Case-insensitive; safe against regex special characters in the query.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function Highlight({ text, query }) {
  const t = text || ''
  const q = (query || '').trim()
  if (!q) return t
  const parts = t.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'))
  const lower = q.toLowerCase()
  return parts.map((part, i) =>
    part.toLowerCase() === lower ? (
      <mark key={i} className="bg-yellow-200 text-inherit rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
