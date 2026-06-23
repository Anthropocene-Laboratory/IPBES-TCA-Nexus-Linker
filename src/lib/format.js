// Small display helpers for the TCA/Nexus labels.

// "Strategy 1: Conserving ..." -> { num: "1", label: "Conserving ..." }
export function parseStrategy(raw) {
  const m = /^Strategy\s+(\d+)\s*:\s*(.*)$/s.exec(raw || '')
  if (m) return { num: m[1], label: m[2].trim() }
  return { num: '', label: raw || '' }
}

// "Action 1.1: Recognizing ..." -> { code: "1.1", label: "Recognizing ..." }
export function parseAction(raw) {
  const m = /^Action\s+([\d.]+)\s*:\s*(.*)$/s.exec(raw || '')
  if (m) return { code: m[1], label: m[2].trim() }
  return { code: '', label: raw || '' }
}

// Stable order of strategies / categories as they first appear in the data.
export function groupBy(items, keyFn) {
  const map = new Map()
  for (const it of items) {
    const k = keyFn(it)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(it)
  }
  return Array.from(map, ([key, list]) => ({ key, list }))
}
