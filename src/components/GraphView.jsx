import { useMemo, useState } from 'react'
import tcaActions from '../data/tca_actions.json'
import nexusOptions from '../data/nexus_options.json'
import { parseAction } from '../lib/format'

const optTitle = Object.fromEntries(nexusOptions.map((o) => [o.id, o.title]))
const actionById = Object.fromEntries(tcaActions.map((a) => [a.id, a]))
const actionOrder = tcaActions.map((a) => a.id)
const optionOrder = nexusOptions.map((o) => o.id)

function shortLabel(a) {
  const p = parseAction(a.action)
  let l = p.label
  if (l.length > 30) l = l.slice(0, 29).trimEnd() + '…'
  return `${p.code} ${l}`
}

function shortOption(id) {
  const title = optTitle[id] || id
  const label = title.length > 42 ? `${title.slice(0, 41).trimEnd()}…` : title
  return `${id} ${label}`
}

// Geometry (SVG user units; scales to container via viewBox).
const VBW = 1120
const LABEL_L = 184
const LABEL_R = 330
const NODE_W = 12
const GAP = 6
const LEFT_X = LABEL_L
const RIGHT_X = VBW - LABEL_R - NODE_W

export default function GraphView({ links, expertsById = {} }) {
  const [selectedKey, setSelectedKey] = useState(null)

  const layout = useMemo(() => {
    const matrix = {} // `${actionId}|${optionId}` -> one aggregate band per pair
    const actionTotals = {}
    const optionTotals = {}
    for (const l of links) {
      if (!optTitle[l.nexus_option_id]) continue
      const key = `${l.tca_action_id}|${l.nexus_option_id}`
      const m = matrix[key] || (matrix[key] = { count: 0, p: 0, s: 0, items: [] })
      m.count += 1
      if (l.strength === 'primary') m.p += 1
      else m.s += 1
      m.items.push({ expert_id: l.expert_id, option_id: l.nexus_option_id, strength: l.strength, comment: l.comment || '' })
      actionTotals[l.tca_action_id] = (actionTotals[l.tca_action_id] || 0) + 1
      optionTotals[l.nexus_option_id] = (optionTotals[l.nexus_option_id] || 0) + 1
    }

    const leftNodes = actionOrder
      .filter((id) => actionTotals[id])
      .map((id) => ({ id, label: shortLabel(actionById[id]), count: actionTotals[id] }))
    const rightNodes = optionOrder
      .filter((id) => optionTotals[id])
      .map((id) => ({ id, label: shortOption(id), count: optionTotals[id] }))

    const sum = leftNodes.reduce((s, n) => s + n.count, 0)
    if (!sum) return { empty: true, matrix }

    const maxNodes = Math.max(leftNodes.length, rightNodes.length)
    const H = Math.max(460, maxNodes * 24)
    const leftGaps = (leftNodes.length - 1) * GAP
    const rightGaps = (rightNodes.length - 1) * GAP
    const unit = (H - Math.max(leftGaps, rightGaps)) / sum

    const leftPos = {}
    let y = (H - (sum * unit + leftGaps)) / 2
    for (const n of leftNodes) {
      leftPos[n.id] = { y, h: n.count * unit }
      y += n.count * unit + GAP
    }
    const rightPos = {}
    y = (H - (sum * unit + rightGaps)) / 2
    for (const n of rightNodes) {
      rightPos[n.id] = { y, h: n.count * unit }
      y += n.count * unit + GAP
    }

    const srcY = {}
    for (const n of leftNodes) {
      let off = leftPos[n.id].y
      for (const optionId of optionOrder) {
        const m = matrix[`${n.id}|${optionId}`]
        if (!m) continue
        srcY[`${n.id}|${optionId}`] = off
        off += m.count * unit
      }
    }
    const tgtY = {}
    for (const option of rightNodes) {
      let off = rightPos[option.id].y
      for (const a of actionOrder) {
        const m = matrix[`${a}|${option.id}`]
        if (!m) continue
        tgtY[`${a}|${option.id}`] = off
        off += m.count * unit
      }
    }

    const ribbons = Object.keys(matrix).map((key) => {
      const [a, optionId] = key.split('|')
      const m = matrix[key]
      return {
        key,
        actionId: a,
        label: actionById[a] ? shortLabel(actionById[a]) : a,
        optionId,
        optionLabel: shortOption(optionId),
        m,
        sy: srcY[key],
        ty: tgtY[key],
        h: m.count * unit,
      }
    })
    ribbons.sort((p, q) => p.h - q.h)

    return { empty: false, H, leftNodes, rightNodes, leftPos, rightPos, ribbons, matrix }
  }, [links])

  const totalLinks = links.length
  const selected = selectedKey && layout.matrix ? layout.matrix[selectedKey] : null
  const selectedMeta = selectedKey
    ? (() => {
        const [a, optionId] = selectedKey.split('|')
        return { actionLabel: actionById[a] ? shortLabel(actionById[a]) : a, optionLabel: shortOption(optionId) }
      })()
    : null

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-900">Flow graph — TCA Action → Nexus Response Option</h2>
        <p className="text-xs text-slate-400">
          Band thickness = number of expert links · click a band to see who linked it · updates live · {totalLinks} link
          {totalLinks === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 overflow-auto p-4">
          {layout.empty ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400 text-center">
              No links yet. The flow graph will build up here as experts add links.
            </div>
          ) : (
            <svg viewBox={`0 0 ${VBW} ${layout.H}`} className="w-full" style={{ minWidth: 680 }}>
              {layout.ribbons.map((r) => {
                const xa = LEFT_X + NODE_W
                const xb = RIGHT_X
                const xm = (xa + xb) / 2
                const d = `M${xa},${r.sy} C${xm},${r.sy} ${xm},${r.ty} ${xb},${r.ty} L${xb},${r.ty + r.h} C${xm},${r.ty + r.h} ${xm},${r.sy + r.h} ${xa},${r.sy + r.h} Z`
                const isSel = r.key === selectedKey
                return (
                  <path
                    key={r.key}
                    d={d}
                    onClick={() => setSelectedKey(isSel ? null : r.key)}
                    className={
                      'cursor-pointer transition-colors ' +
                      (isSel ? 'fill-indigo-500/70' : 'fill-slate-400/40 hover:fill-indigo-400/60')
                    }
                  >
                    <title>{`${r.label} → ${r.optionLabel}\n${r.m.count} link${r.m.count === 1 ? '' : 's'} (primary: ${r.m.p}, secondary: ${r.m.s})\nClick to see contributors`}</title>
                  </path>
                )
              })}

              {layout.leftNodes.map((n) => {
                const p = layout.leftPos[n.id]
                return (
                  <g key={n.id}>
                    <rect x={LEFT_X} y={p.y} width={NODE_W} height={p.h} rx={2} className="fill-slate-700" />
                    <text x={LEFT_X - 8} y={p.y + p.h / 2} dominantBaseline="middle" textAnchor="end" className="fill-slate-700 text-[11px]">
                      {n.label}
                    </text>
                  </g>
                )
              })}

              {layout.rightNodes.map((n) => {
                const p = layout.rightPos[n.id]
                return (
                  <g key={n.id}>
                    <rect x={RIGHT_X} y={p.y} width={NODE_W} height={p.h} rx={2} className="fill-slate-700" />
                    <text x={RIGHT_X + NODE_W + 8} y={p.y + p.h / 2} dominantBaseline="middle" textAnchor="start" className="fill-slate-700 text-[11px] font-medium">
                      {n.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {/* Contributor details for the selected band */}
        <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4">
          {!selected ? (
            <p className="text-sm text-slate-400">Click a band to see which experts linked this action to this response option.</p>
          ) : (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contributors</div>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">{selectedMeta.actionLabel}</h3>
              <p className="text-xs text-slate-500">→ {selectedMeta.optionLabel}</p>
              <p className="mt-1 text-xs text-slate-400">
                {selected.count} link{selected.count === 1 ? '' : 's'} · primary {selected.p} · secondary {selected.s}
              </p>
              <ul className="mt-3 space-y-2">
                {[...selected.items]
                  .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'primary' ? -1 : 1))
                  .map((it, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            'text-[11px] rounded-full px-1.5 py-0.5 ' +
                            (it.strength === 'primary' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800')
                          }
                        >
                          {it.strength}
                        </span>
                        <span>{expertsById[it.expert_id] || '—'}</span>
                      </div>
                      <div className="text-xs text-slate-400 ml-1">
                        via {it.option_id} · {optTitle[it.option_id] || ''}
                      </div>
                      {it.comment && (
                        <p className="ml-1 mt-0.5 text-xs italic text-slate-500">“{it.comment}”</p>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
