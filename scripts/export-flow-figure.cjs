const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, 'publication')

// Portrait, full page. The binding constraint is arithmetic, not taste: 71
// response-option labels need at least 2.6 mm of line pitch to be read at 7 pt,
// so the right-hand column alone needs ~18.5 cm of height. Landscape cannot
// supply it at any width, which is why the figure was illegible at print size.
const VIEW_W = 1800
const VIEW_H = 2100
const PNG_W = 4500
const PNG_H = 5250
const DENSITY = 600

// Printed size the figure is designed for (PLOS full-page maximum), used to
// check every type size against a legibility floor instead of eyeballing it.
const PRINT_W_MM = 190.5
const PRINT_H_MM = 222.3
const MIN_TYPE_PT = 7
const MM_PER_PX = PRINT_H_MM / VIEW_H
const PT_PER_PX = (MM_PER_PX * 72) / 25.4

// Type scale. Every size here is checked against MIN_TYPE_PT before the figure
// is written, so a layout change can never quietly shrink a label below what a
// reader can resolve on paper.
const TYPE = {
  column: 34,
  labelLeft: 24,
  labelRight: 24,
  group: 24,
  groupRight: 24,
  legend: 24,
}

function assertLegible(sizes) {
  const failures = Object.entries(sizes)
    .map(([name, px]) => [name, px, px * PT_PER_PX])
    .filter(([, , pt]) => pt < MIN_TYPE_PT - 1e-9)
  if (failures.length) {
    const detail = failures.map(([name, px, pt]) => `${name} ${px}px = ${pt.toFixed(2)}pt`).join('; ')
    throw new Error(
      `Type below the ${MIN_TYPE_PT}pt floor at ${PRINT_W_MM}x${PRINT_H_MM} mm: ${detail}. ` +
        'Raise the size or the page, do not ship an unreadable figure.',
    )
  }
  return Object.fromEntries(Object.entries(sizes).map(([name, px]) => [name, Number((px * PT_PER_PX).toFixed(2))]))
}

function parseEnv(filePath) {
  const env = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals < 1) continue
    const key = line.slice(0, equals).trim()
    let value = line.slice(equals + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function parseAction(raw) {
  const match = /^Action\s+([\d.]+)\s*:\s*(.*)$/s.exec(raw || '')
  return match ? { code: match[1], label: match[2].trim() } : { code: '', label: raw || '' }
}

function wrapWords(text, maxChars, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)

  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s.,;:–—-]+$/u, '')}…`
  return kept
}

function placeLabels(items, makeLines, minY, maxY, lineHeight, gap) {
  const labels = items.map((item) => {
    const lines = makeLines(item)
    return {
      item,
      lines,
      target: item.y + item.h / 2,
      height: Math.max(lineHeight, lines.length * lineHeight),
    }
  })
  if (!labels.length) return labels

  labels[0].center = Math.max(labels[0].target, minY + labels[0].height / 2)
  for (let i = 1; i < labels.length; i += 1) {
    const previous = labels[i - 1]
    const current = labels[i]
    const separation = (previous.height + current.height) / 2 + gap
    current.center = Math.max(current.target, previous.center + separation)
  }

  const overflow = labels.at(-1).center + labels.at(-1).height / 2 - maxY
  if (overflow > 0) {
    labels.at(-1).center -= overflow
    for (let i = labels.length - 2; i >= 0; i -= 1) {
      const current = labels[i]
      const next = labels[i + 1]
      const separation = (current.height + next.height) / 2 + gap
      current.center = Math.min(current.center, next.center - separation)
    }
  }

  const underflow = minY - (labels[0].center - labels[0].height / 2)
  if (underflow > 0) {
    for (const label of labels) label.center += underflow
  }
  return labels
}

function nodeLayout(nodes, plotTop, plotHeight, total, gapForIndex) {
  const totalGap = nodes.slice(0, -1).reduce((sum, _node, index) => sum + gapForIndex(index), 0)
  const unit = (plotHeight - totalGap) / total
  const used = total * unit + totalGap
  let y = plotTop + (plotHeight - used) / 2
  return nodes.map((node, index) => {
    const positioned = { ...node, y, h: node.count * unit }
    y += positioned.h + (index < nodes.length - 1 ? gapForIndex(index) : 0)
    return positioned
  })
}

function loadSharp() {
  try {
    return require('sharp')
  } catch (projectError) {
    const modules = process.env.IPBES_RUNTIME_NODE_MODULES
    if (!modules) throw projectError
    return require(path.join(modules, 'sharp'))
  }
}

async function fetchLinks(env) {
  const baseUrl = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  if (!baseUrl || !anonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')

  // A wide Range header does NOT lift the project's max-rows cap: PostgREST still
  // returns at most that many rows, with a 206 and a Content-Range. Page through,
  // ordered, and verify the total so the figure can never be built from a silently
  // truncated set.
  const PAGE = 1000
  const all = []
  let expected = null
  for (let from = 0; ; from += PAGE) {
    const endpoint = new URL('/rest/v1/links', baseUrl)
    endpoint.searchParams.set('select', 'expert_id,tca_action_id,nexus_option_id,strength')
    endpoint.searchParams.set('order', 'id')
    const response = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: 'count=exact',
      },
    })
    if (!response.ok && response.status !== 206) {
      throw new Error(`Supabase returned ${response.status}: ${await response.text()}`)
    }
    const total = Number((response.headers.get('content-range') || '').split('/')[1])
    if (Number.isFinite(total)) expected = total
    const page = await response.json()
    all.push(...page)
    if (page.length < PAGE) break
  }
  if (expected != null && all.length !== expected) {
    throw new Error(`Fetched ${all.length} links but the server reports ${expected}; refusing to draw a truncated figure.`)
  }
  console.log(`Fetched ${all.length} links.`)
  return all
}

const PRIMARY_OPACITY = 0.38
const SECONDARY_OPACITY = 0.12

const STRATEGY_COLORS = ['#7E6BA8', '#4E9B6E', '#D08C3C', '#3E7CB1', '#C4577E']

// Nexus response-option categories, in the order they appear in the reference data.
const CATEGORY_COLORS = {
  'Conserve ecosystems': '#2E7D5B',
  'Restore ecosystems': '#6BAE75',
  'Manage ecosystems': '#A8C256',
  'Consume sustainably': '#D9A441',
  'Reduce pollution': '#C4703E',
  'Integrate planning and governance': '#3E7CB1',
  'Manage risk': '#7A6BA8',
  'Ensure rights and equity': '#C4577E',
  'Align financing': '#4A9BA8',
  Others: '#8A8F98',
}

// Sankey node order inside a group is a free choice: the data does not fix it.
// Left in source order, ribbons cross far more than the linkages require, and
// that gratuitous crossing is what makes the figure read as "connections go all
// over the place" when the underlying mapping is in fact strongly concentrated.
// Order each group's members by the weighted mean rank of their partners — the
// barycentre heuristic (Sugiyama, Tagawa & Toda 1981). Group blocks keep the
// slots they already occupy, so the five strategies and ten categories stay
// exactly where they are and their spines still label contiguous runs; only the
// order *within* a block changes, and no count anywhere is touched. The gain is
// bounded and modest, because the block order itself is fixed by the two
// assessments and must not be rearranged to please a layout.
function reorderWithinGroups(nodes, groupOf, scoreOf) {
  const slotsByGroup = new Map()
  nodes.forEach((node, index) => {
    const key = groupOf(node)
    if (!slotsByGroup.has(key)) slotsByGroup.set(key, [])
    slotsByGroup.get(key).push(index)
  })
  const out = [...nodes]
  for (const slots of slotsByGroup.values()) {
    const members = slots.map((index) => nodes[index])
    // Ties keep their previous relative order, so the pass is stable and the
    // alternation converges instead of oscillating between two layouts.
    const scored = members.map((node, index) => ({ node, index, score: scoreOf(node) }))
    scored.sort((a, b) => a.score - b.score || a.index - b.index)
    slots.forEach((slot, k) => {
      out[slot] = scored[k].node
    })
  }
  return out
}

function barycentreOrder(leftBase, rightBase, matrix) {
  const count = (actionId, optionId) => matrix.get(`${actionId}|${optionId}`)?.count || 0
  const leftRank = new Map(leftBase.map((node, index) => [node.id, index]))

  // Only the right column moves. The 22 actions are numbered 1.1-5.5 in the
  // published assessment and a reader looks them up by that number, so scrambling
  // them inside a strategy costs more than the few crossings it saves (measured:
  // 5.7%). The response options inside a category have no such order — B01, F01,
  // H10 is an arbitrary code sequence — so ordering them by their partners' mean
  // position is free. With the left side fixed, one pass is exact.
  const right = reorderWithinGroups(
    rightBase,
    (node) => node.category,
    (node) => {
      let weight = 0
      let sum = 0
      for (const partner of leftBase) {
        const w = count(partner.id, node.id)
        if (!w) continue
        weight += w
        sum += w * leftRank.get(partner.id)
      }
      // A node with no partners cannot have a barycentre; park it at the end of
      // its block rather than pretending its position means something.
      return weight ? sum / weight : Number.POSITIVE_INFINITY
    },
  )
  return { left: leftBase, right }
}

// Ribbon crossings, counted so the reordering can be reported as a measured
// improvement rather than asserted as one. Two ribbons cross when their
// endpoints are in opposite orders on the two sides.
function countCrossings(pairs, leftOrder, rightOrder) {
  const li = new Map(leftOrder.map((node, index) => [node.id, index]))
  const ri = new Map(rightOrder.map((node, index) => [node.id, index]))
  const edges = pairs.map(([actionId, optionId]) => [li.get(actionId), ri.get(optionId)])
  let crossings = 0
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const [a1, b1] = edges[i]
      const [a2, b2] = edges[j]
      if ((a1 - a2) * (b1 - b2) < 0) crossings += 1
    }
  }
  return crossings
}

// Short action names, verbatim from the Approach x Action figure (Figure 2), so
// the two figures name the same 22 actions identically. Verbatim includes the
// lower-case "success" in 3.4: matching Figure 2 matters more than tidying one
// capital here, and if it is fixed it must be fixed in both.
// Full published titles stay in the alluvial's source data and in sheet S1.
const SHORT_ACTION_NAMES = {
  '1.1': 'Territories of Life',
  '1.2': 'Biodiversity Rights',
  '1.3': 'Diverse Values',
  '1.4': 'Regenerative Land Use',
  '1.5': 'Integrated Planning',
  '2.1': 'Exploitation Regulation',
  '2.2': 'Transformative Technology',
  '2.3': 'Sustainability Finance',
  '2.4': 'Civil Society',
  '3.1': 'Economic Innovation',
  '3.2': 'Just Transitions',
  '3.3': 'Financial Reform',
  '3.4': 'New success Metrics',
  '4.1': 'Integrated Governance',
  '4.2': 'Inclusive Governance',
  '4.3': 'Multilateral Governance',
  '4.4': 'Adaptive Governance',
  '5.1': 'Nature Connectedness',
  '5.2': 'New Narratives',
  '5.3': 'Social Norms',
  '5.4': 'Transformative Learning',
  '5.5': 'Knowledge Co-creation',
}

// A short name is a second, hand-maintained naming of the same 22 things. That
// only stays safe if a mismatch is loud: check the two sets agree before drawing
// anything, rather than silently labelling a row with the wrong action.
function shortNameFor(tcaActions) {
  const codes = tcaActions.map((action) => parseAction(action.action).code)
  const missing = codes.filter((code) => !SHORT_ACTION_NAMES[code])
  const extra = Object.keys(SHORT_ACTION_NAMES).filter((code) => !codes.includes(code))
  const names = Object.values(SHORT_ACTION_NAMES)
  const duplicated = names.filter((name, index) => names.indexOf(name) !== index)
  if (missing.length || extra.length || duplicated.length) {
    throw new Error(
      'SHORT_ACTION_NAMES no longer matches the actions: ' +
        [
          missing.length ? `no short name for ${missing.join(', ')}` : '',
          extra.length ? `short name for unknown code ${extra.join(', ')}` : '',
          duplicated.length ? `duplicate name ${duplicated.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
    )
  }
  return (code) => SHORT_ACTION_NAMES[code]
}

function strategyIndex(strategy) {
  const match = /^Strategy\s+(\d)/.exec(String(strategy || ''))
  return match ? Number(match[1]) - 1 : 0
}

// Contiguous runs of nodes sharing a group key, with their vertical extent.
function groupSpans(nodes, keyOf) {
  const spans = []
  for (const node of nodes) {
    const key = keyOf(node)
    const last = spans.at(-1)
    if (last && last.key === key) {
      last.bottom = node.y + node.h
      last.count += node.count
    } else {
      spans.push({ key, top: node.y, bottom: node.y + node.h, count: node.count })
    }
  }
  return spans
}

// A rotated group label runs along its span, so the span height is its line
// length. Truncate to what fits; too short to be readable, drop it and let the
// legend carry the name.
function fitRotated(text, availablePx, fontSize) {
  const perChar = fontSize * 0.56
  const maxChars = Math.floor((availablePx - 8) / perChar)
  if (maxChars < 8) return ''
  const value = String(text)
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 1).replace(/[\s.,;:–—-]+$/u, '')}…`
}

// Arial advance widths average close to half the point size for mixed-case
// text; good enough to lay out a legend without measuring glyphs, and only ever
// used to decide where to wrap.
const CHAR_W = 0.5

function textWidth(text, fontSize) {
  return String(text).length * fontSize * CHAR_W
}

// The legend used to be hand-placed at fixed offsets, which only worked at one
// page width. Flow it instead: entries are packed left to right and wrapped
// when the next one would run off the page, so the same code lays out a legend
// that has ten categories or two strengths, on a page of any width.
function layoutLegend({ primaryOnly, categories, strategies, x0, x1, fontSize }) {
  const SWATCH_W = 26
  const SWATCH_GAP = 8
  const ENTRY_GAP = 22
  const rows = []
  let row = null

  const start = (heading) => {
    row = { heading, entries: [], x: x0 + textWidth(heading, fontSize) + 14 }
    rows.push(row)
  }
  const add = (entry) => {
    const width = SWATCH_W + SWATCH_GAP + textWidth(entry.label, fontSize) + ENTRY_GAP
    if (row.entries.length && row.x + width > x1) {
      // Continuation rows are indented under the first, with no repeated
      // heading: the heading names the run, it does not need saying twice.
      row = { heading: '', entries: [], x: rows.at(-1).entries.length ? x0 + 120 : x0 }
      rows.push(row)
    }
    row.entries.push({ ...entry, x: row.x })
    row.x += width
  }

  start('TCA strategy')
  for (let i = 0; i < STRATEGY_COLORS.length; i += 1) {
    add({ label: strategies[i] || String(i + 1), fill: STRATEGY_COLORS[i] })
  }
  if (!primaryOnly) {
    add({ spacer: true, label: '', fill: 'none' })
    // Drawn in a strategy hue rather than neutral grey: these are the same two
    // densities the ribbons use, and at 12% a neutral fill is invisible on white.
    add({ label: 'primary link', fill: STRATEGY_COLORS[4], opacity: PRIMARY_OPACITY, outline: true })
    add({ label: 'secondary link', fill: STRATEGY_COLORS[4], opacity: SECONDARY_OPACITY, outline: true })
  }

  if (primaryOnly) {
    // Without this the figure looks like the whole dataset. It is not, and the
    // caption is not always beside the image a reader is looking at.
    add({ spacer: true, label: '', fill: 'none' })
    add({ label: 'primary judgements only', textOnly: true })
  }

  start('Nexus category')
  for (const category of categories) {
    add({ label: category, fill: CATEGORY_COLORS[category] || '#8A8F98' })
  }
  return rows
}

function drawLegend(rows, top, fontSize) {
  const parts = []
  const lineHeight = fontSize + 6
  rows.forEach((row, index) => {
    const y = top + index * lineHeight
    if (row.heading) {
      parts.push(
        `<text x="${row.entries[0] ? row.entries[0].x - 14 : 40}" y="${y}" text-anchor="end" class="legend" fill="#4b5563">${xml(row.heading)}</text>`,
      )
    }
    for (const entry of row.entries) {
      if (entry.spacer) continue
      if (entry.textOnly) {
        parts.push(`<text x="${entry.x}" y="${y}" class="legend" fill="#4b5563">${xml(entry.label)}</text>`)
        continue
      }
      const opacity = entry.opacity == null ? 1 : entry.opacity
      const stroke = entry.outline ? ' stroke="#6b7280" stroke-width="1.2"' : ''
      parts.push(
        `<rect x="${entry.x}" y="${y - fontSize * 0.72}" width="26" height="${Math.round(fontSize * 0.62)}" rx="2" fill="${entry.fill}" fill-opacity="${opacity}"${stroke}/>`,
      )
      parts.push(`<text x="${entry.x + 34}" y="${y}" class="legend">${xml(entry.label)}</text>`)
    }
  })
  return parts
}

function ribbonPath(xa, xb, sy, ty, h) {
  const xm = (xa + xb) / 2
  return [
    `M${xa},${sy}`,
    `C${xm},${sy} ${xm},${ty} ${xb},${ty}`,
    `L${xb},${ty + h}`,
    `C${xm},${ty + h} ${xm},${sy + h} ${xa},${sy + h}`,
    'Z',
  ].join(' ')
}

// The filtering rule lives in one place because two figures and a workbook all
// depend on it agreeing with itself. A pair carried by a single coder is a
// non-observation, not a weak agreement, so it is dropped before any total is
// taken — node heights are the sum of the cells that survive, and a total
// accumulated over all links would no longer match what is drawn.
function collectPairs({ links, actionById, optionById, strengths, minCoders }) {
  const wanted = new Set(strengths)
  const matrix = new Map()
  const unknown = []

  for (const link of links) {
    if (!actionById.has(link.tca_action_id) || !optionById.has(link.nexus_option_id)) {
      unknown.push(link)
      continue
    }
    // The strength filter defines the universe: everything downstream — the pair
    // counts, the threshold, the caption's denominators — is computed within it,
    // never against a total the figure does not draw.
    if (!wanted.has(link.strength)) continue
    const key = `${link.tca_action_id}|${link.nexus_option_id}`
    const cell = matrix.get(key) || { count: 0, primary: 0, secondary: 0 }
    cell.count += 1
    if (link.strength === 'primary') cell.primary += 1
    else cell.secondary += 1
    matrix.set(key, cell)
  }

  const pairsBefore = matrix.size
  const linksBefore = [...matrix.values()].reduce((sum, cell) => sum + cell.count, 0)
  for (const [key, cell] of [...matrix]) {
    if (cell.count < minCoders) matrix.delete(key)
  }
  return { matrix, pairsBefore, linksBefore, unknown }
}

function buildFigure({
  links,
  tcaActions,
  nexusOptions,
  minCoders = 1,
  showCounts = true,
  strengths = ['primary', 'secondary'],
}) {
  const primaryOnly = !strengths.includes('secondary')
  const actionById = new Map(tcaActions.map((action) => [action.id, action]))
  const optionById = new Map(nexusOptions.map((option) => [option.id, option]))
  const actionTotals = new Map()
  const optionTotals = new Map()
  const { matrix, pairsBefore, linksBefore, unknown } = collectPairs({
    links,
    actionById,
    optionById,
    strengths,
    minCoders,
  })

  for (const [key, cell] of matrix) {
    const [actionId, optionId] = key.split('|')
    actionTotals.set(actionId, (actionTotals.get(actionId) || 0) + cell.count)
    optionTotals.set(optionId, (optionTotals.get(optionId) || 0) + cell.count)
  }

  const validLinks = [...matrix.values()].reduce((sum, cell) => sum + cell.count, 0)
  if (!validLinks) throw new Error('No valid links were returned from Supabase')

  let leftBase = tcaActions
    .filter((action) => actionTotals.has(action.id))
    .map((action) => ({
      id: action.id,
      action,
      count: actionTotals.get(action.id),
      strategy: action.strategy,
      si: strategyIndex(action.strategy),
    }))
  let rightBase = nexusOptions
    .filter((option) => optionTotals.has(option.id))
    .map((option) => ({
      id: option.id,
      option,
      count: optionTotals.get(option.id),
      category: option.category,
    }))

  // Published strategy names, in order, with the "Strategy n:" prefix dropped
  // because the swatch already carries the number.
  const strategyNames = []
  for (const action of tcaActions) {
    const index = strategyIndex(action.strategy)
    if (strategyNames[index]) continue
    const text = String(action.strategy).replace(/^Strategy\s*\d\s*:\s*/, '')
    strategyNames[index] = `${index + 1}  ${text}`
  }

  // Legend first: it decides how much height is left for the plot, so measuring
  // it beats guessing a margin and discovering the overlap in the PNG.
  const legendRows = layoutLegend({
    primaryOnly,
    strategies: strategyNames,
    categories: [...new Set(rightBase.map((node) => node.category))],
    x0: 40,
    x1: VIEW_W - 40,
    fontSize: TYPE.legend,
  })
  const legendHeight = legendRows.length * (TYPE.legend + 6) + 12

  const shortName = shortNameFor(tcaActions)

  const plotTop = 96
  const plotHeight = VIEW_H - plotTop - legendHeight - 20
  // Short labels free 170px of the left column, which goes straight to the
  // ribbon band: 498px instead of 328, so a ribbon's path is followable instead
  // of being a near-vertical hairpin.
  const leftX = 470
  const rightX = 1560
  const nodeWidth = 12

  const pairKeys = [...matrix.keys()].map((key) => key.split('|'))
  const crossingsBefore = countCrossings(pairKeys, leftBase, rightBase)
  const ordered = barycentreOrder(leftBase, rightBase, matrix)
  const crossingsAfter = countCrossings(pairKeys, ordered.left, ordered.right)
  leftBase = ordered.left
  rightBase = ordered.right

  // Gaps between groups are wider than gaps within them, so the five strategies
  // and ten categories read as blocks before any individual row is read.
  // A label needs vertical room as well as size. 7pt type is 2.47mm tall, so a
  // pitch below 2.55mm sets the lines solid with no leading at all.
  const MIN_PITCH_MM = 2.55
  const pitchMm = (plotHeight / Math.max(rightBase.length, 1)) * MM_PER_PX
  if (pitchMm < MIN_PITCH_MM) {
    throw new Error(
      `Right-hand labels would sit ${pitchMm.toFixed(2)}mm apart, below the ${MIN_PITCH_MM}mm floor. ` +
        'Shorten the legend or lengthen the page; do not ship lines that touch.',
    )
  }

  const leftGap = (index) => (leftBase[index].si === leftBase[index + 1]?.si ? 5 : 22)
  const rightGap = (index) => (rightBase[index].category === rightBase[index + 1]?.category ? 2 : 12)
  const leftNodes = nodeLayout(leftBase, plotTop, plotHeight, validLinks, leftGap)
  const rightNodes = nodeLayout(rightBase, plotTop, plotHeight, validLinks, rightGap)
  const leftById = new Map(leftNodes.map((node) => [node.id, node]))
  const rightById = new Map(rightNodes.map((node) => [node.id, node]))

  const sourceOffset = new Map(leftNodes.map((node) => [node.id, node.y]))
  const targetOffset = new Map(rightNodes.map((node) => [node.id, node.y]))
  const ribbons = []
  for (const action of tcaActions) {
    if (!leftById.has(action.id)) continue
    for (const option of nexusOptions) {
      const key = `${action.id}|${option.id}`
      const cell = matrix.get(key)
      if (!cell) continue
      const sourceNode = leftById.get(action.id)
      const h = (sourceNode.h / sourceNode.count) * cell.count
      const sy = sourceOffset.get(action.id)
      const ty = targetOffset.get(option.id)
      ribbons.push({ key, sy, ty, h, cell, si: sourceNode.si })
      sourceOffset.set(action.id, sy + h)
      targetOffset.set(option.id, ty + h)
    }
  }

  const leftLabels = placeLabels(
    leftNodes,
    (node) => {
      const parsed = parseAction(node.action.action)
      const label = shortName(parsed.code)
      const text = showCounts ? `${parsed.code}  ${label}  (n = ${node.count})` : `${parsed.code}  ${label}`
      return wrapWords(text, 31, 2)
    },
    plotTop,
    plotTop + plotHeight,
    26,
    6,
  )
  // Codes, not titles. "B03; C11" is eight characters where the title is sixty,
  // and the codes are the assessments' own identifiers, used throughout the
  // paper and expanded in full in the caption and in the supplementary table.
  const rightLabels = placeLabels(
    rightNodes,
    (node) => [showCounts ? `${node.option.id}  (n = ${node.count})` : node.option.id],
    plotTop,
    plotTop + plotHeight,
    TYPE.labelRight,
    1.6,
  )

  const retained = new Set(matrix.keys())
  const expertCount = new Set(
    links
      .filter((link) => retained.has(`${link.tca_action_id}|${link.nexus_option_id}`))
      .map((link) => link.expert_id)
      .filter(Boolean),
  ).size
  const primaryCount = [...matrix.values()].reduce((sum, cell) => sum + cell.primary, 0)
  const secondaryCount = [...matrix.values()].reduce((sum, cell) => sum + cell.secondary, 0)

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">`)
  parts.push(`<rect width="${VIEW_W}" height="${VIEW_H}" fill="#ffffff"/>`)
  const typePt = assertLegible(TYPE)
  parts.push(`<style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #17202a; }
    .column { font-size: ${TYPE.column}px; font-weight: 600; }
    .label-left { font-size: ${TYPE.labelLeft}px; font-weight: 400; }
    .label-right { font-size: ${TYPE.labelRight}px; font-weight: 400; }
    .group { font-size: ${TYPE.group}px; font-weight: 600; letter-spacing: 0.02em; }
    .group-right { font-size: ${TYPE.groupRight}px; font-weight: 600; letter-spacing: 0.02em; }
    .legend { font-size: ${TYPE.legend}px; fill: #17202a; }
  </style>`)

  parts.push(`<text x="${leftX + nodeWidth}" y="52" text-anchor="end" class="column">TCA actions</text>`)
  parts.push(`<text x="${VIEW_W - 40}" y="52" text-anchor="end" class="column">Nexus response options</text>`)

  // Ribbons carry the colour of the strategy they leave, so a reader can follow
  // where a strategy's judgements land without tracing individual bands.
  //
  // Each ribbon is split along its width into the primary and secondary
  // judgements that compose it, drawn in the same hue at two densities. The two
  // are different claims about a link, not interchangeable units, and on 44% of
  // the pairs shown here the coders divide between them — a single band would
  // add them together and say nothing about it. Total width is unchanged, so the
  // node heights still read as the number of links.
  for (const ribbon of [...ribbons].sort((a, b) => b.h - a.h)) {
    const xa = leftX + nodeWidth
    const xb = rightX
    const color = STRATEGY_COLORS[ribbon.si]
    const hPrimary = (ribbon.h * ribbon.cell.primary) / ribbon.cell.count
    const hSecondary = ribbon.h - hPrimary
    if (hPrimary > 0) {
      parts.push(
        `<path d="${ribbonPath(xa, xb, ribbon.sy, ribbon.ty, hPrimary)}" fill="${color}" fill-opacity="${PRIMARY_OPACITY}"/>`,
      )
    }
    if (hSecondary > 0) {
      parts.push(
        `<path d="${ribbonPath(xa, xb, ribbon.sy + hPrimary, ribbon.ty + hPrimary, hSecondary)}" fill="${color}" fill-opacity="${SECONDARY_OPACITY}"/>`,
      )
    }
  }

  // Node bars stay solid: they are the anchor for reading height as a count, and
  // the composition is already legible in the ribbons leaving them.
  for (const node of leftNodes) {
    parts.push(`<rect x="${leftX}" y="${node.y}" width="${nodeWidth}" height="${Math.max(node.h, 1.1)}" fill="${STRATEGY_COLORS[node.si]}"/>`)
  }
  for (const node of rightNodes) {
    const fill = CATEGORY_COLORS[node.category] || '#8A8F98'
    parts.push(`<rect x="${rightX}" y="${node.y}" width="${nodeWidth}" height="${Math.max(node.h, 1.1)}" fill="${fill}"/>`)
  }

  // Group spines. The strategy and category names are written out, so colour is a
  // redundant cue rather than the only channel carrying the grouping.
  const leftSpineX = 34
  for (const span of groupSpans(leftNodes, (node) => node.si)) {
    const color = STRATEGY_COLORS[span.key]
    parts.push(`<rect x="${leftSpineX}" y="${span.top}" width="5" height="${Math.max(span.bottom - span.top, 2)}" rx="2" fill="${color}"/>`)
    const mid = (span.top + span.bottom) / 2
    parts.push(`<text transform="translate(${leftSpineX - 8},${mid}) rotate(-90)" text-anchor="middle" class="group" fill="${color}">${showCounts ? `Strategy ${span.key + 1} (n = ${span.count})` : `Strategy ${span.key + 1}`}</text>`)
  }
  const rightSpineX = VIEW_W - 64
  const categorySpans = groupSpans(rightNodes, (node) => node.category)
  for (const span of categorySpans) {
    const color = CATEGORY_COLORS[span.key] || '#8A8F98'
    const height = Math.max(span.bottom - span.top, 2)
    parts.push(`<rect x="${rightSpineX}" y="${span.top}" width="5" height="${height}" rx="2" fill="${color}"/>`)
    // No names here: the legend below carries all ten in full, and a spine that
    // labels one category out of ten reads as an omission rather than a choice.
  }

  for (const label of leftLabels) {
    const nodeCenter = label.target
    const labelStart = label.center - ((label.lines.length - 1) * 26) / 2
    if (Math.abs(label.center - nodeCenter) > 3) {
      parts.push(`<path d="M${leftX - 4},${nodeCenter} H${leftX - 18} L${leftX - 32},${label.center}" fill="none" stroke="#b7c0c9" stroke-width="1"/>`)
    }
    parts.push(`<text x="${leftX - 38}" y="${labelStart}" text-anchor="end" dominant-baseline="middle" class="label-left">`)
    label.lines.forEach((line, index) => {
      parts.push(`<tspan x="${leftX - 38}" dy="${index === 0 ? 0 : 26}">${xml(line)}</tspan>`)
    })
    parts.push('</text>')
  }

  for (const label of rightLabels) {
    const nodeCenter = label.target
    if (Math.abs(label.center - nodeCenter) > 2) {
      parts.push(`<path d="M${rightX + nodeWidth + 4},${nodeCenter} H${rightX + nodeWidth + 15} L${rightX + nodeWidth + 28},${label.center}" fill="none" stroke="#b7c0c9" stroke-width="1"/>`)
    }
    parts.push(`<text x="${rightX + nodeWidth + 34}" y="${label.center}" dominant-baseline="middle" class="label-right">${xml(label.lines[0])}</text>`)
  }

  // Every colour and every density on the figure is named here, so colour is
  // never the only channel carrying a grouping.
  parts.push(...drawLegend(legendRows, VIEW_H - legendHeight + TYPE.legend, TYPE.legend))

  // A filtered figure that does not say so misleads by omission: state the rule,
  // what it kept, and where the complete mapping can be found. Two lines, because
  // one would run off the canvas.
  const n = (value) => value.toLocaleString('en-US')
  const splitPairs = [...matrix.values()].filter((cell) => cell.primary > 0 && cell.secondary > 0).length
  const optionCount = rightNodes.length
  const splitShare = Math.round((100 * splitPairs) / matrix.size)
  const strengthLine = primaryOnly
    ? 'Ribbon width represents the number of experts who judged the link primary. Secondary judgements are not shown here; they are in the supplementary figure and tables.'
    : 'Ribbon width represents the number of expert-coded links, split along its width by strength: primary judgements are drawn denser than secondary.'
  const universe = primaryOnly ? 'primary links' : 'links'
  const scopeLine =
    minCoders > 1
      ? `Only action\u2013response option pairs coded by at least ${minCoders} experts are shown: ${n(matrix.size)} of ${n(pairsBefore)} such pairs, carrying ${n(validLinks)} of ${n(linksBefore)} ${universe}; the complete mapping is given in the supplementary figure, and every count in the supplementary tables.`
      : `Every action\u2013response option pair coded by at least one expert is shown.`
  const totalsLine = primaryOnly
    ? `N = ${n(validLinks)} primary links from ${expertCount} experts, over ${n(matrix.size)} pairs and ${optionCount} of the 71 response options.`
    : `N = ${n(validLinks)} links (${n(primaryCount)} primary; ${n(secondaryCount)} secondary) from ${expertCount} experts, and on ${n(splitPairs)} pairs (${splitShare}%) the coders divide between the two strengths.`
  // Response options are named here rather than beside the plot: the key cannot
  // fit inside an image that already spends 1,818px on 71 label rows.
  const key = rightNodes
    .map((node) => `${node.option.id} ${node.option.title}`)
    .join('; ')
  const caption = `${strengthLine} ${scopeLine} ${totalsLine} Response options are identified by their assessment codes: ${key}.`
  parts.push('</svg>')

  return {
    svg: parts.join('\n'),
    caption,
    stats: {
      minCoders,
      totalLinks: links.length,
      pairsBeforeFilter: pairsBefore,
      linksBeforeFilter: linksBefore,
      validLinks,
      expertCount,
      actionCount: leftNodes.length,
      optionCount,
      pairCount: matrix.size,
      splitPairs,
      primaryCount,
      secondaryCount,
      unknownLinks: unknown.length,
      ribbonCrossingsBefore: crossingsBefore,
      ribbonCrossingsAfter: crossingsAfter,
      typePt,
      rightLabelPitchMm: Number(((plotHeight / Math.max(rightNodes.length, 1)) * MM_PER_PX).toFixed(2)),
      truncatedLabels:
        leftLabels.filter((label) => label.lines.at(-1).endsWith('\u2026')).length +
        rightLabels.filter((label) => label.lines.at(-1).endsWith('\u2026')).length,
    },
  }
}


// ---------------------------------------------------------------------------
// Panel (a): TCA actions x Nexus response-option categories.
//
// The alluvial answers "which option connects to which action". It cannot
// answer "is there a pattern", because 70 option rows and 413 ribbons exceed
// what anyone reads off a page. This does: 22 rows, 10 columns, one number per
// cell. Colour carries only intensity and every cell also prints its count, so
// the panel survives greyscale printing and colour-blind reading intact.
// ---------------------------------------------------------------------------

const MATRIX_W = 1800
const MATRIX_H = 1492
// Pixels stay square: the printed height follows the width, so growing the
// canvas to fit longer labels can never shrink the type below the floor.
const MATRIX_PRINT_H_MM = (PRINT_W_MM * MATRIX_H) / MATRIX_W
const MATRIX_PT_PER_PX = ((MATRIX_PRINT_H_MM / MATRIX_H) * 72) / 25.4

const MATRIX_TYPE = {
  rowLabel: 24,
  colLabel: 24,
  cell: 24,
  total: 24,
  key: 24,
}

// Sequential single hue: lightness falls monotonically with the count, so the
// ramp still orders correctly once the colour is thrown away by a photocopier.
function rampFill(value, max) {
  if (!value) return { fill: '#ffffff', dark: false }
  const t = Math.sqrt(value / max)
  const lightness = 97 - t * 62
  return { fill: `hsl(207, ${Math.round(18 + t * 34)}%, ${lightness.toFixed(1)}%)`, dark: lightness < 55 }
}

function buildMatrixFigure({ links, tcaActions, nexusOptions, minCoders = 2 }) {
  const actionById = new Map(tcaActions.map((action) => [action.id, action]))
  const optionById = new Map(nexusOptions.map((option) => [option.id, option]))
  const { matrix, pairsBefore, linksBefore, unknown } = collectPairs({
    links,
    actionById,
    optionById,
    strengths: ['primary', 'secondary'],
    minCoders,
  })

  const categories = []
  for (const option of nexusOptions) {
    if (!categories.includes(option.category)) categories.push(option.category)
  }

  const grid = new Map()
  const rowTotal = new Map()
  const colTotal = new Map()
  let validLinks = 0
  for (const [key, cell] of matrix) {
    const [actionId, optionId] = key.split('|')
    const category = optionById.get(optionId).category
    const gk = `${actionId}|${category}`
    grid.set(gk, (grid.get(gk) || 0) + cell.count)
    rowTotal.set(actionId, (rowTotal.get(actionId) || 0) + cell.count)
    colTotal.set(category, (colTotal.get(category) || 0) + cell.count)
    validLinks += cell.count
  }

  const rows = tcaActions.filter((action) => rowTotal.has(action.id))
  const max = Math.max(...grid.values())

  const shortName = shortNameFor(tcaActions)
  const x0 = 470
  const cellW = 108
  const gridW = cellW * categories.length
  const totalX = x0 + gridW + 22
  const y0 = 80
  // One line per row now that the names are short: nothing is truncated, and the
  // panel loses 240px of height it no longer needs.
  const cellH = 45
  const gridH = cellH * rows.length
  const totalY = y0 + gridH

  const typePt = Object.fromEntries(
    Object.entries(MATRIX_TYPE).map(([name, px]) => [name, Number((px * MATRIX_PT_PER_PX).toFixed(2))]),
  )
  const tooSmall = Object.entries(typePt).filter(([, pt]) => pt < MIN_TYPE_PT - 1e-9)
  if (tooSmall.length) {
    throw new Error(`Matrix type below the ${MIN_TYPE_PT}pt floor: ${tooSmall.map(([n, pt]) => `${n} ${pt}pt`).join('; ')}`)
  }

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${MATRIX_W}" height="${MATRIX_H}" viewBox="0 0 ${MATRIX_W} ${MATRIX_H}">`)
  parts.push(`<rect width="${MATRIX_W}" height="${MATRIX_H}" fill="#ffffff"/>`)
  parts.push(`<style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #17202a; }
    .m-row { font-size: ${MATRIX_TYPE.rowLabel}px; }
    .m-col { font-size: ${MATRIX_TYPE.colLabel}px; font-weight: 600; }
    .m-cell { font-size: ${MATRIX_TYPE.cell}px; }
    .m-total { font-size: ${MATRIX_TYPE.total}px; font-weight: 600; }
    .m-key { font-size: ${MATRIX_TYPE.key}px; fill: #4b5563; }
  </style>`)

  // No title inside the image. It would only restate the caption printed beneath
  // it, and a title baked into pixels cannot be typeset, translated or numbered
  // by the journal — the same reason the methods sentence was moved out earlier.

  // Row labels carry the strategy colour as a left rule, matching panel (b), so
  // the two panels are read as the same 22 actions in the same order.
  rows.forEach((action, index) => {
    const parsed = parseAction(action.action)
    const si = strategyIndex(action.strategy)
    const y = y0 + index * cellH
    parts.push(`<rect x="34" y="${y + 6}" width="5" height="${cellH - 12}" rx="2" fill="${STRATEGY_COLORS[si]}"/>`)
    const text = `${parsed.code}  ${shortName(parsed.code)}`
    parts.push(`<text x="${x0 - 18}" y="${y + cellH / 2 + 8}" text-anchor="end" class="m-row">${xml(text)}</text>`)
  })

  // Cells.
  rows.forEach((action, r) => {
    categories.forEach((category, c) => {
      const value = grid.get(`${action.id}|${category}`) || 0
      const { fill, dark } = rampFill(value, max)
      const x = x0 + c * cellW
      const y = y0 + r * cellH
      parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill}" stroke="#e3e7ec" stroke-width="1"/>`)
      if (value) {
        parts.push(
          `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 8}" text-anchor="middle" class="m-cell" fill="${dark ? '#ffffff' : '#17202a'}">${value}</text>`,
        )
      }
    })
    const y = y0 + r * cellH
    parts.push(`<text x="${totalX + 70}" y="${y + cellH / 2 + 8}" text-anchor="end" class="m-total">${rowTotal.get(action.id)}</text>`)
  })

  // Column totals.
  categories.forEach((category, c) => {
    const x = x0 + c * cellW
    parts.push(`<text x="${x + cellW / 2}" y="${totalY + 32}" text-anchor="middle" class="m-total">${colTotal.get(category) || 0}</text>`)
  })
  parts.push(`<text x="${x0 - 18}" y="${totalY + 32}" text-anchor="end" class="m-total">All actions</text>`)
  parts.push(`<text x="${totalX + 70}" y="${totalY + 32}" text-anchor="end" class="m-total">${validLinks}</text>`)
  parts.push(`<text x="${totalX + 70}" y="${y0 - 16}" text-anchor="end" class="m-col">All</text>`)
  parts.push(`<line x1="${x0}" y1="${totalY + 6}" x2="${x0 + gridW}" y2="${totalY + 6}" stroke="#17202a" stroke-width="1.2"/>`)

  // Category names set on the diagonal under their column, coloured to match
  // panel (b). Diagonal beats vertical on both counts a reader cares about: the
  // eye follows a 45-degree baseline without tilting the page, and a label of
  // length L costs L/sqrt(2) of height instead of the full L.
  categories.forEach((category, c) => {
    const x = x0 + c * cellW + cellW / 2
    const color = CATEGORY_COLORS[category] || '#8A8F98'
    parts.push(
      `<text transform="translate(${x + 10},${totalY + 52}) rotate(-45)" text-anchor="end" class="m-col" fill="${color}">${xml(category)}</text>`,
    )
  })

  // Ramp key: the reader needs to know the fill is only intensity, and that the
  // number in the cell is the value, not a label.
  const keyY = MATRIX_H - 34
  parts.push(`<text x="34" y="${keyY}" class="m-key">Cell value = number of expert-coded links; shading follows the same value.</text>`)
  let kx = 1230
  for (const step of [1, Math.round(max / 4), Math.round(max / 2), max]) {
    const { fill } = rampFill(step, max)
    parts.push(`<rect x="${kx}" y="${keyY - 20}" width="60" height="24" fill="${fill}" stroke="#e3e7ec"/>`)
    parts.push(`<text x="${kx + 30}" y="${keyY + 26}" text-anchor="middle" class="m-key">${step}</text>`)
    kx += 68
  }
  parts.push('</svg>')

  const n = (value) => value.toLocaleString('en-US')
  const spread = rows.map((action) => {
    const own = categories.map((category) => grid.get(`${action.id}|${category}`) || 0).filter(Boolean)
    return { id: action.id, categories: own.length, top: Math.max(...own) / rowTotal.get(action.id) }
  })
  const minTop = Math.min(...spread.map((row) => row.top))
  const maxTop = Math.max(...spread.map((row) => row.top))
  const caption =
    `Each cell gives the number of expert-coded links between a TCA action and the response options of one Nexus category; ` +
    `shading follows the same value and carries no additional information. Only action–response option pairs coded by at ` +
    `least ${minCoders} experts are counted: ${n(matrix.size)} of ${n(pairsBefore)} pairs, carrying ${n(validLinks)} of ` +
    `${n(linksBefore)} links. Actions distribute unevenly across categories rather than evenly: each draws on ` +
    `${Math.min(...spread.map((row) => row.categories))}–${Math.max(...spread.map((row) => row.categories))} of the ` +
    `${categories.length} categories, and the share carried by an action's largest category ranges from ` +
    `${Math.round(100 * minTop)}% to ${Math.round(100 * maxTop)}%. Full response-option detail is given in panel (b) and in the supplementary tables.`

  return {
    svg: parts.join('\n'),
    caption,
    grid,
    categories,
    rows: rows.map((action) => action.id),
    stats: {
      minCoders,
      validLinks,
      pairCount: matrix.size,
      pairsBeforeFilter: pairsBefore,
      linksBeforeFilter: linksBefore,
      actionCount: rows.length,
      categoryCount: categories.length,
      maxCell: max,
      unknownLinks: unknown.length,
      typePt,
    },
  }
}

// ---------------------------------------------------------------------------
// Three smaller figures. Same page width as the panels, so the whole set shares
// one scale; height is free, and the printed height follows the width so the
// type floor holds without a separate check per figure.
// ---------------------------------------------------------------------------

const SMALL_W = 1800
const SMALL_TYPE = { axis: 24, label: 24, value: 24, title: 26 }

function smallPtPerPx(viewH) {
  return (((PRINT_W_MM * viewH) / SMALL_W / viewH) * 72) / 25.4
}

function assertSmallLegible(name) {
  // Pixels are square and the printed width is fixed, so one ratio governs every
  // small figure regardless of its height.
  const pt = smallPtPerPx(1000)
  const worst = Math.min(...Object.values(SMALL_TYPE)) * pt
  if (worst < MIN_TYPE_PT - 1e-9) {
    throw new Error(`${name}: smallest type is ${worst.toFixed(2)}pt, below the ${MIN_TYPE_PT}pt floor.`)
  }
  return Number((Math.min(...Object.values(SMALL_TYPE)) * pt).toFixed(2))
}

function smallHeader(parts, viewW, viewH) {
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${viewW}" height="${viewH}" viewBox="0 0 ${viewW} ${viewH}">`)
  parts.push(`<rect width="${viewW}" height="${viewH}" fill="#ffffff"/>`)
  parts.push(`<style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #17202a; }
    .s-axis { font-size: ${SMALL_TYPE.axis}px; fill: #4b5563; }
    .s-label { font-size: ${SMALL_TYPE.label}px; }
    .s-value { font-size: ${SMALL_TYPE.value}px; font-weight: 600; }
    .s-title { font-size: ${SMALL_TYPE.title}px; font-weight: 600; }
  </style>`)
}

// --- Figure 4: reach against breadth, for the 22 actions --------------------
//
// Reach is how many response options an action links to; breadth is how evenly
// those linkages fall across the ten categories. The text says the two orderings
// disagree. On a scatter the disagreement is the empty diagonal: nothing sits in
// the top-left-to-bottom-right band, and the outliers name themselves.

function normEntropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0)
  if (!total || counts.length <= 1) return 0
  const h = -counts.reduce((sum, c) => (c ? sum + (c / total) * Math.log(c / total) : sum), 0)
  return Math.abs(h / Math.log(counts.length))
}

// Greedy label placement. Twenty-two boxes is small enough to try each anchor in
// turn and keep the first that collides with nothing already placed; a label that
// had to leave its default position gets a leader line so it stays attributable.
function placeScatterLabels(points, boxW, boxH, bounds) {
  const placed = []
  const ANCHORS = [
    [14, 0], [-14, 0], [0, -22], [0, 22],
    [14, -20], [14, 20], [-14, -20], [-14, 20],
    [26, -40], [26, 40], [-26, -40], [-26, 40],
    [14, -58], [14, 58], [-14, -58], [-14, 58],
  ]
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

  for (const p of points) {
    const w = boxW(p)
    let best = null
    for (const [dx, dy] of ANCHORS) {
      const anchorEnd = dx < 0
      const box = {
        x: p.x + dx - (anchorEnd ? w : 0),
        y: p.y + dy - boxH / 2,
        w,
        h: boxH,
      }
      // Off the canvas is never acceptable: a clipped label is worse than a
      // crowded one, because the reader cannot tell it was there at all.
      if (box.x < bounds.x0 || box.x + w > bounds.x1 || box.y < bounds.y0 || box.y + boxH > bounds.y1) continue
      const cost = placed.reduce((sum, q) => sum + overlap(box, q), 0)
      if (best === null || cost < best.cost) best = { ...box, dx, dy, anchorEnd, point: p, cost }
      if (cost === 0) break
    }
    // Every anchor was off-canvas, which only happens for a point in a corner:
    // clamp into the frame rather than dropping the label.
    if (!best) {
      const x = Math.min(Math.max(p.x + 14, bounds.x0), bounds.x1 - w)
      const y = Math.min(Math.max(p.y - boxH / 2, bounds.y0), bounds.y1 - boxH)
      best = { x, y, w, h: boxH, dx: x - p.x, dy: y + boxH / 2 - p.y, anchorEnd: false, point: p, cost: 0 }
    }
    placed.push(best)
  }
  return placed
}

function buildReachBreadthFigure({ links, tcaActions, nexusOptions, minCoders = 2 }) {
  const actionById = new Map(tcaActions.map((a) => [a.id, a]))
  const optionById = new Map(nexusOptions.map((o) => [o.id, o]))
  const { matrix } = collectPairs({
    links, actionById, optionById, strengths: ['primary', 'secondary'], minCoders,
  })
  const shortName = shortNameFor(tcaActions)

  const categories = []
  for (const o of nexusOptions) if (!categories.includes(o.category)) categories.push(o.category)

  const stats = new Map()
  for (const [key, cell] of matrix) {
    const [aid, oid] = key.split('|')
    const cat = optionById.get(oid).category
    const s = stats.get(aid) || { options: new Set(), byCat: new Map(), links: 0 }
    s.options.add(oid)
    s.byCat.set(cat, (s.byCat.get(cat) || 0) + cell.count)
    s.links += cell.count
    stats.set(aid, s)
  }

  const points = []
  for (const action of tcaActions) {
    const s = stats.get(action.id)
    if (!s) continue
    const parsed = parseAction(action.action)
    points.push({
      code: parsed.code,
      name: shortName(parsed.code),
      si: strategyIndex(action.strategy),
      reach: s.options.size,
      breadth: normEntropy(categories.map((c) => s.byCat.get(c) || 0)),
      links: s.links,
    })
  }

  const VIEW_H = 1360
  const x0 = 150
  const x1 = SMALL_W - 330
  const y0 = 80
  const y1 = VIEW_H - 190
  const maxReach = Math.ceil(Math.max(...points.map((p) => p.reach)) / 5) * 5
  const sx = (v) => x0 + ((x1 - x0) * v) / maxReach
  const sy = (v) => y1 - (y1 - y0) * v

  const parts = []
  smallHeader(parts, SMALL_W, VIEW_H)

  // Gridlines first so nothing sits on top of a point.
  for (let v = 0; v <= maxReach; v += 5) {
    parts.push(`<line x1="${sx(v)}" y1="${y0}" x2="${sx(v)}" y2="${y1}" stroke="#eef1f4" stroke-width="1"/>`)
    parts.push(`<text x="${sx(v)}" y="${y1 + 34}" text-anchor="middle" class="s-axis">${v}</text>`)
  }
  for (let v = 0; v <= 0.9; v += 0.2) {
    parts.push(`<line x1="${x0}" y1="${sy(v)}" x2="${x1}" y2="${sy(v)}" stroke="#eef1f4" stroke-width="1"/>`)
    parts.push(`<text x="${x0 - 14}" y="${sy(v) + 8}" text-anchor="end" class="s-axis">${v.toFixed(1)}</text>`)
  }
  parts.push(`<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="#9aa3ac" stroke-width="1.2"/>`)
  parts.push(`<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" stroke="#9aa3ac" stroke-width="1.2"/>`)
  parts.push(`<text x="${(x0 + x1) / 2}" y="${y1 + 74}" text-anchor="middle" class="s-axis">Reach: number of response options linked (of 71)</text>`)
  parts.push(`<text transform="translate(${x0 - 76},${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle" class="s-axis">Breadth: evenness across the ten categories</text>`)

  const laid = points.map((p) => ({ ...p, x: sx(p.reach), y: sy(p.breadth) }))
  const boxW = (p) => (`${p.code} ${p.name}`.length * SMALL_TYPE.label * CHAR_W) + 6
  const labels = placeScatterLabels(
    [...laid].sort((a, b) => b.links - a.links),
    boxW, SMALL_TYPE.label + 6, { x0: 8, x1: SMALL_W - 8, y0: 8, y1: y1 + 4 },
  )

  for (const l of labels) {
    const p = l.point
    if (l.dx !== 14 || l.dy !== 0) {
      const tx = l.anchorEnd ? l.x + l.w : l.x
      parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${tx}" y2="${l.y + l.h / 2}" stroke="#c8ced5" stroke-width="1"/>`)
    }
  }
  for (const p of laid) {
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="9" fill="${STRATEGY_COLORS[p.si]}" fill-opacity="0.85" stroke="#ffffff" stroke-width="1.5"/>`)
  }
  for (const l of labels) {
    parts.push(`<text x="${l.anchorEnd ? l.x + l.w : l.x}" y="${l.y + l.h / 2 + 8}" text-anchor="${l.anchorEnd ? 'end' : 'start'}" class="s-label">${xml(`${l.point.code} ${l.point.name}`)}</text>`)
  }

  let lx = 150
  const legendY = VIEW_H - 40
  parts.push(`<text x="${lx - 12}" y="${legendY}" text-anchor="end" class="s-axis">TCA strategy</text>`)
  for (let i = 0; i < STRATEGY_COLORS.length; i += 1) {
    parts.push(`<circle cx="${lx + 12}" cy="${legendY - 8}" r="9" fill="${STRATEGY_COLORS[i]}" fill-opacity="0.85"/>`)
    parts.push(`<text x="${lx + 30}" y="${legendY}" class="s-label">${i + 1}</text>`)
    lx += 66
  }

  parts.push('</svg>')

  const byReach = [...points].sort((a, b) => b.reach - a.reach)
  const byBreadth = [...points].sort((a, b) => b.breadth - a.breadth)
  const rankReach = new Map(byReach.map((p, i) => [p.code, i + 1]))
  const rankBreadth = new Map(byBreadth.map((p, i) => [p.code, i + 1]))
  const moved = points
    .map((p) => ({ code: p.code, shift: rankBreadth.get(p.code) - rankReach.get(p.code) }))
    .sort((a, b) => a.shift - b.shift)

  return {
    svg: parts.join('\n'),
    viewH: VIEW_H,
    caption:
      `Each point is one of the 22 TCA actions. Reach is the number of distinct Nexus response options it links to; ` +
      `breadth is the normalised entropy of its linkages over the ten response-option categories, where 1.0 would be a ` +
      `perfectly even spread and 0.0 everything in one category. Only pairs coded by at least two experts are counted. ` +
      `The two orderings disagree: ${byReach[0].code} ${byReach[0].name} leads on reach with ${byReach[0].reach} options, ` +
      `while ${byBreadth[0].code} ${byBreadth[0].name} is the broadest; ${moved[0].code} rises ${-moved[0].shift} places ` +
      `from reach to breadth and ${moved.at(-1).code} falls ${moved.at(-1).shift}. Colour marks the action's TCA strategy ` +
      `and carries no other information. The same comparison on the response-option side shows no such divergence and is ` +
      `given in the supplementary tables.`,
    stats: {
      actions: points.length,
      minCoders,
      reachRange: [Math.min(...points.map((p) => p.reach)), Math.max(...points.map((p) => p.reach))],
      breadthRange: [
        Number(Math.min(...points.map((p) => p.breadth)).toFixed(2)),
        Number(Math.max(...points.map((p) => p.breadth)).toFixed(2)),
      ],
      typePt: assertSmallLegible('Figure 4'),
    },
  }
}

// --- Figure S3: how many experts saw each pair ------------------------------
//
// The agreement threshold is a choice, and a figure that only states it invites
// the reviewer's question. Showing the distribution answers it: the discarded
// pairs are 43% of the pairs but 18% of the judgements.

function buildCoderCountFigure({ links, tcaActions, nexusOptions }) {
  const actionById = new Map(tcaActions.map((a) => [a.id, a]))
  const optionById = new Map(nexusOptions.map((o) => [o.id, o]))
  const { matrix } = collectPairs({
    links, actionById, optionById, strengths: ['primary', 'secondary'], minCoders: 1,
  })
  const pairsBy = new Map()
  const linksBy = new Map()
  for (const cell of matrix.values()) {
    pairsBy.set(cell.count, (pairsBy.get(cell.count) || 0) + 1)
    linksBy.set(cell.count, (linksBy.get(cell.count) || 0) + cell.count)
  }
  const ns = [...pairsBy.keys()].sort((a, b) => a - b)
  const totalPairs = [...pairsBy.values()].reduce((a, b) => a + b, 0)
  const totalLinks = [...linksBy.values()].reduce((a, b) => a + b, 0)
  // Both series share one axis, so the scale must clear the taller of them.
  const maxValue = Math.max(...pairsBy.values(), ...linksBy.values())

  const VIEW_H = 1120
  const x0 = 150
  const x1 = SMALL_W - 60
  const y0 = 130
  const y1 = VIEW_H - 210
  const slot = (x1 - x0) / ns.length
  const barW = Math.min(slot * 0.34, 86)

  const parts = []
  smallHeader(parts, SMALL_W, VIEW_H)
  const scale = (v) => y1 - ((y1 - y0) * v) / maxValue

  for (let v = 0; v <= maxValue; v += 50) {
    parts.push(`<line x1="${x0}" y1="${scale(v)}" x2="${x1}" y2="${scale(v)}" stroke="#eef1f4" stroke-width="1"/>`)
    parts.push(`<text x="${x0 - 14}" y="${scale(v) + 8}" text-anchor="end" class="s-axis">${v}</text>`)
  }
  parts.push(`<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" stroke="#9aa3ac" stroke-width="1.2"/>`)

  // The threshold is drawn, not just described.
  const cut = x0 + slot
  parts.push(`<line x1="${cut}" y1="${y0 - 56}" x2="${cut}" y2="${y1}" stroke="#C4577E" stroke-width="2" stroke-dasharray="7 5"/>`)
  parts.push(`<text x="${cut + 14}" y="${y0 - 62}" class="s-label" fill="#C4577E">agreement threshold: pairs to the right are retained</text>`)

  ns.forEach((n, i) => {
    const cx = x0 + slot * i + slot / 2
    const dim = n < 2
    for (const [k, series, colour] of [
      [0, pairsBy, '#3E7CB1'],
      [1, linksBy, '#4E9B6E'],
    ]) {
      const v = series.get(n) || 0
      const x = cx - barW - 4 + k * (barW + 8)
      parts.push(`<rect x="${x}" y="${scale(v)}" width="${barW}" height="${Math.max(y1 - scale(v), 1)}" fill="${colour}" fill-opacity="${dim ? 0.3 : 0.85}"/>`)
      parts.push(`<text x="${x + barW / 2}" y="${scale(v) - 10}" text-anchor="middle" class="s-value" fill="#4b5563">${v}</text>`)
    }
    parts.push(`<text x="${cx}" y="${y1 + 36}" text-anchor="middle" class="s-label">${n}</text>`)
  })
  parts.push(`<text x="${(x0 + x1) / 2}" y="${y1 + 78}" text-anchor="middle" class="s-axis">Number of experts who independently identified the pair</text>`)

  let lx = 150
  const legendY = VIEW_H - 40
  for (const [label, colour] of [['action–response option pairs', '#3E7CB1'], ['individual judgements', '#4E9B6E']]) {
    parts.push(`<rect x="${lx}" y="${legendY - 20}" width="30" height="18" rx="2" fill="${colour}" fill-opacity="0.85"/>`)
    parts.push(`<text x="${lx + 40}" y="${legendY - 4}" class="s-label">${xml(label)}</text>`)
    lx += 40 + label.length * SMALL_TYPE.label * CHAR_W + 60
  }
  parts.push('</svg>')

  const dropped = pairsBy.get(1) || 0
  const droppedLinks = linksBy.get(1) || 0
  return {
    svg: parts.join('\n'),
    viewH: VIEW_H,
    caption:
      `Distribution of the ${totalPairs} action–response option pairs by the number of experts who independently ` +
      `identified them, alongside the number of individual judgements each group carries. The ${dropped} pairs seen by ` +
      `one expert only are ${Math.round((100 * dropped) / totalPairs)} per cent of the pairs but ` +
      `${Math.round((100 * droppedLinks) / totalLinks)} per cent of the judgements, which is why treating them as ` +
      `non-observations removes little evidence while removing most of the unreplicated claims. Pairs to the right of ` +
      `the dashed line are those retained in the main analysis.`,
    stats: { totalPairs, totalLinks, dropped, droppedLinks, maxCoders: Math.max(...ns), typePt: assertSmallLegible('Figure S3') },
  }
}

// --- Figure S4: strength composition by Nexus category ----------------------
//
// The results claim health and risk options are linked consistently but as
// complementary contributions. That is a statement about composition, and until
// now nothing in the paper let a reader check it.

function buildStrengthByCategoryFigure({ links, tcaActions, nexusOptions, minCoders = 2 }) {
  const actionById = new Map(tcaActions.map((a) => [a.id, a]))
  const optionById = new Map(nexusOptions.map((o) => [o.id, o]))
  const { matrix } = collectPairs({
    links, actionById, optionById, strengths: ['primary', 'secondary'], minCoders,
  })
  const agg = new Map()
  for (const [key, cell] of matrix) {
    const cat = optionById.get(key.split('|')[1]).category
    const a = agg.get(cat) || { primary: 0, secondary: 0, pairs: 0, split: 0 }
    a.primary += cell.primary
    a.secondary += cell.secondary
    a.pairs += 1
    if (cell.primary > 0 && cell.secondary > 0) a.split += 1
    agg.set(cat, a)
  }
  const rows = [...agg].sort((a, b) => b[1].primary + b[1].secondary - (a[1].primary + a[1].secondary))
  const maxTotal = Math.max(...rows.map(([, a]) => a.primary + a.secondary))

  const VIEW_H = 880
  const x0 = 560
  const x1 = SMALL_W - 260
  const y0 = 110
  const rowH = 70
  const barH = 40

  const parts = []
  smallHeader(parts, SMALL_W, VIEW_H)
  const w = (v) => ((x1 - x0) * v) / maxTotal

  parts.push(`<text x="${x0}" y="${y0 - 34}" class="s-axis">links, by strength</text>`)
  parts.push(`<text x="${x1 + 130}" y="${y0 - 34}" text-anchor="end" class="s-axis">% primary</text>`)

  rows.forEach(([cat, a], i) => {
    const y = y0 + i * rowH
    const total = a.primary + a.secondary
    const colour = CATEGORY_COLORS[cat] || '#8A8F98'
    parts.push(`<text x="${x0 - 20}" y="${y + barH / 2 + 8}" text-anchor="end" class="s-label" fill="${colour}">${xml(cat)}</text>`)
    parts.push(`<rect x="${x0}" y="${y}" width="${Math.max(w(a.primary), 1)}" height="${barH}" fill="${colour}" fill-opacity="${PRIMARY_OPACITY + 0.35}"/>`)
    parts.push(`<rect x="${x0 + w(a.primary)}" y="${y}" width="${Math.max(w(a.secondary), 1)}" height="${barH}" fill="${colour}" fill-opacity="${SECONDARY_OPACITY}" stroke="#d5dade" stroke-width="0.8"/>`)
    parts.push(`<text x="${x0 + w(total) + 14}" y="${y + barH / 2 + 8}" class="s-value" fill="#4b5563">${total}</text>`)
    parts.push(`<text x="${x1 + 130}" y="${y + barH / 2 + 8}" text-anchor="end" class="s-value">${Math.round((100 * a.primary) / total)}%</text>`)
  })

  const legendY = VIEW_H - 44
  let lx = 560
  for (const [label, opacity] of [['primary', PRIMARY_OPACITY + 0.35], ['secondary', SECONDARY_OPACITY]]) {
    parts.push(`<rect x="${lx}" y="${legendY - 20}" width="30" height="18" rx="2" fill="#17202a" fill-opacity="${opacity}" stroke="#6b7280" stroke-width="1"/>`)
    parts.push(`<text x="${lx + 40}" y="${legendY - 4}" class="s-label">${label}</text>`)
    lx += 40 + label.length * SMALL_TYPE.label * CHAR_W + 60
  }
  parts.push('</svg>')

  const best = rows[0]
  const highest = [...rows].sort((a, b) => b[1].primary / (b[1].primary + b[1].secondary) - a[1].primary / (a[1].primary + a[1].secondary))
  const pct = ([, a]) => Math.round((100 * a.primary) / (a.primary + a.secondary))
  return {
    svg: parts.join('\n'),
    viewH: VIEW_H,
    caption:
      `Composition of the linkages reaching each Nexus response-option category, split into the judgements that recorded ` +
      `them as primary and as secondary. Only pairs coded by at least two experts are included. Categories differ ` +
      `markedly in how they are used: ${highest[0][0].toLowerCase()} options are judged primary ${pct(highest[0])} per cent ` +
      `of the time, ${highest.at(-1)[0].toLowerCase()} options only ${pct(highest.at(-1))} per cent. A category with a low ` +
      `primary share is not weakly linked — ${best[0].toLowerCase()} carries the most linkages of all — but is ` +
      `consistently seen as a complementary rather than a principal means of delivering an action.`,
    stats: {
      categories: rows.length,
      primaryShareRange: [pct(highest.at(-1)), pct(highest[0])],
      typePt: assertSmallLegible('Figure S4'),
    },
  }
}

// ---------------------------------------------------------------------------
// Supplementary tables. Every number removed from the figures lives here, so
// the counts are moved rather than lost: per action, per response option, and
// per action-option pair, with a column saying which figure shows each pair.
// ---------------------------------------------------------------------------

const HEADER_FILL = 'FFEFF2F5'

function styleSheet(sheet) {
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  header.alignment = { vertical: 'middle', wrapText: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  }
}

async function writeTables({ links, tcaActions, nexusOptions, outputPath, minCoders }) {
  const ExcelJS = require('exceljs')
  const actionById = new Map(tcaActions.map((action) => [action.id, action]))
  const optionById = new Map(nexusOptions.map((option) => [option.id, option]))

  const cells = new Map()
  for (const link of links) {
    if (!actionById.has(link.tca_action_id) || !optionById.has(link.nexus_option_id)) continue
    const key = `${link.tca_action_id}|${link.nexus_option_id}`
    const cell = cells.get(key) || { primary: 0, secondary: 0 }
    if (link.strength === 'primary') cell.primary += 1
    else cell.secondary += 1
    cells.set(key, cell)
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'TCA-Nexus Linker'
  workbook.created = new Date()

  // --- S1: per TCA action --------------------------------------------------
  const s1 = workbook.addWorksheet('Table A By TCA action')
  s1.columns = [
    { header: 'Action ID', key: 'id', width: 12 },
    { header: 'Strategy', key: 'strategy', width: 52 },
    { header: 'Action', key: 'action', width: 64 },
    { header: 'Links', key: 'total', width: 8 },
    { header: 'Primary', key: 'primary', width: 9 },
    { header: 'Secondary', key: 'secondary', width: 11 },
    { header: 'Response options linked', key: 'options', width: 12 },
    { header: `Options with ${minCoders}+ coders`, key: 'agreed', width: 13 },
  ]
  for (const action of tcaActions) {
    const own = [...cells].filter(([key]) => key.startsWith(`${action.id}|`))
    if (!own.length) continue
    s1.addRow({
      id: action.id,
      strategy: action.strategy,
      action: action.action,
      total: own.reduce((sum, [, c]) => sum + c.primary + c.secondary, 0),
      primary: own.reduce((sum, [, c]) => sum + c.primary, 0),
      secondary: own.reduce((sum, [, c]) => sum + c.secondary, 0),
      options: own.length,
      agreed: own.filter(([, c]) => c.primary + c.secondary >= minCoders).length,
    })
  }
  styleSheet(s1)

  // --- S2: per Nexus response option --------------------------------------
  const s2 = workbook.addWorksheet('Table B By Nexus option')
  s2.columns = [
    { header: 'Option ID', key: 'id', width: 11 },
    { header: 'Category', key: 'category', width: 30 },
    { header: 'Response option', key: 'title', width: 58 },
    { header: 'Links', key: 'total', width: 8 },
    { header: 'Primary', key: 'primary', width: 9 },
    { header: 'Secondary', key: 'secondary', width: 11 },
    { header: 'TCA actions linked', key: 'actions', width: 12 },
    { header: `Actions with ${minCoders}+ coders`, key: 'agreed', width: 13 },
  ]
  for (const option of nexusOptions) {
    const own = [...cells].filter(([key]) => key.endsWith(`|${option.id}`))
    if (!own.length) continue
    s2.addRow({
      id: option.id,
      category: option.category,
      title: option.title,
      total: own.reduce((sum, [, c]) => sum + c.primary + c.secondary, 0),
      primary: own.reduce((sum, [, c]) => sum + c.primary, 0),
      secondary: own.reduce((sum, [, c]) => sum + c.secondary, 0),
      actions: own.length,
      agreed: own.filter(([, c]) => c.primary + c.secondary >= minCoders).length,
    })
  }
  styleSheet(s2)

  // --- S3: every pair, and which figure shows it ---------------------------
  const s3 = workbook.addWorksheet('Table C By pair')
  s3.columns = [
    { header: 'Action ID', key: 'aid', width: 12 },
    { header: 'Action', key: 'action', width: 58 },
    { header: 'Option ID', key: 'oid', width: 11 },
    { header: 'Response option', key: 'option', width: 52 },
    { header: 'Nexus category', key: 'category', width: 30 },
    { header: 'Coders', key: 'total', width: 8 },
    { header: 'Primary', key: 'primary', width: 9 },
    { header: 'Secondary', key: 'secondary', width: 11 },
    { header: 'Coders divide on strength', key: 'split', width: 13 },
    { header: 'In main figure', key: 'inBody', width: 12 },
    { header: 'In primary-only figure', key: 'inPrimary', width: 13 },
  ]
  const sorted = [...cells].sort((a, b) => {
    const total = b[1].primary + b[1].secondary - (a[1].primary + a[1].secondary)
    return total || a[0].localeCompare(b[0])
  })
  for (const [key, cell] of sorted) {
    const [actionId, optionId] = key.split('|')
    const action = actionById.get(actionId)
    const option = optionById.get(optionId)
    const total = cell.primary + cell.secondary
    s3.addRow({
      aid: actionId,
      action: action.action,
      oid: optionId,
      option: option.title,
      category: option.category,
      total,
      primary: cell.primary,
      secondary: cell.secondary,
      split: cell.primary > 0 && cell.secondary > 0 ? 'yes' : 'no',
      inBody: total >= minCoders ? 'yes' : 'no',
      inPrimary: cell.primary >= minCoders ? 'yes' : 'no',
    })
  }
  styleSheet(s3)

  // --- S4: the matrix panel in clear ---------------------------------------
  const s4 = workbook.addWorksheet('Table D Action x category')
  const categories = []
  for (const option of nexusOptions) {
    if (!categories.includes(option.category)) categories.push(option.category)
  }
  s4.columns = [
    { header: 'Action ID', key: 'aid', width: 12 },
    { header: 'Action', key: 'action', width: 64 },
    ...categories.map((category) => ({ header: category, key: category, width: 14 })),
    { header: 'All categories', key: 'all', width: 14 },
  ]
  for (const action of tcaActions) {
    const own = [...cells].filter(([key, cell]) => key.startsWith(`${action.id}|`) && cell.primary + cell.secondary >= minCoders)
    if (!own.length) continue
    const row = { aid: action.id, action: action.action, all: 0 }
    for (const category of categories) row[category] = 0
    for (const [key, cell] of own) {
      const category = optionById.get(key.split('|')[1]).category
      const value = cell.primary + cell.secondary
      row[category] += value
      row.all += value
    }
    s4.addRow(row)
  }
  styleSheet(s4)

  await workbook.xlsx.writeFile(outputPath)
  return {
    pairs: cells.size,
    sheets: ['Table A By TCA action', 'Table B By Nexus option', 'Table C By pair', 'Table D Action x category'],
  }
}

async function main() {
  const env = parseEnv(path.join(ROOT, '.env'))
  const [links, tcaActions, nexusOptions] = await Promise.all([
    fetchLinks(env),
    Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tca_actions.json'), 'utf8'))),
    Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'nexus_options.json'), 'utf8'))),
  ])
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const sharp = loadSharp()

  // Two figures from one download: the body figure keeps only pairs at least two
  // experts coded (the same agreement criterion the application applies), the
  // supplementary figure keeps everything.
  const variants = [
    { name: 'body', base: 'tca-nexus-flow-publication', minCoders: 2, showCounts: false },
    {
      name: 'primary-only',
      base: 'tca-nexus-flow-primary-only',
      minCoders: 2,
      showCounts: false,
      strengths: ['primary'],
    },
    { name: 'supplementary', base: 'tca-nexus-flow-supplementary', minCoders: 1, showCounts: true },
  ]

  const report = []
  for (const variant of variants) {
    const { svg, caption, stats } = buildFigure({
      links,
      tcaActions,
      nexusOptions,
      minCoders: variant.minCoders,
      showCounts: variant.showCounts,
      strengths: variant.strengths,
    })
    const svgPath = path.join(OUTPUT_DIR, `${variant.base}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${variant.base}.png`)
    fs.writeFileSync(svgPath, svg, 'utf8')
    await sharp(Buffer.from(svg))
      .resize(PNG_W, PNG_H, { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9, palette: false })
      .withMetadata({ density: DENSITY })
      .toFile(pngPath)
    report.push({ variant: variant.name, ...stats, caption, svg: svgPath, png: pngPath })
  }

  // Panel (a). Rendered from the same collectPairs rule as the alluvial, so the
  // two panels cannot drift apart; the assertion below is what proves it.
  const panelA = buildMatrixFigure({ links, tcaActions, nexusOptions, minCoders: 2 })
  const bodyStats = report.find((figure) => figure.variant === 'body')
  if (panelA.stats.validLinks !== bodyStats.validLinks || panelA.stats.pairCount !== bodyStats.pairCount) {
    throw new Error(
      `Panel (a) and panel (b) disagree: ${panelA.stats.validLinks}/${panelA.stats.pairCount} vs ` +
        `${bodyStats.validLinks}/${bodyStats.pairCount} links/pairs. One of them is wrong; neither ships.`,
    )
  }
  // The three smaller figures. Each is rendered at the same printed width as the
  // panels, so a reader moving between them is not silently changing scale.
  const smalls = [
    { name: 'reach-breadth', base: 'tca-nexus-reach-breadth', build: buildReachBreadthFigure },
    { name: 'coder-counts', base: 'tca-nexus-coder-counts', build: buildCoderCountFigure },
    { name: 'strength-by-category', base: 'tca-nexus-strength-by-category', build: buildStrengthByCategoryFigure },
  ]
  const smallReport = []
  for (const small of smalls) {
    const built = small.build({ links, tcaActions, nexusOptions })
    const svgPath = path.join(OUTPUT_DIR, `${small.base}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${small.base}.png`)
    fs.writeFileSync(svgPath, built.svg, 'utf8')
    await sharp(Buffer.from(built.svg))
      .resize(4500, Math.round((4500 * built.viewH) / SMALL_W), { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9, palette: false })
      .withMetadata({ density: DENSITY })
      .toFile(pngPath)
    smallReport.push({ variant: small.name, ...built.stats, caption: built.caption, svg: svgPath, png: pngPath })
  }

  const matrixSvgPath = path.join(OUTPUT_DIR, 'tca-nexus-action-category-matrix.svg')
  const matrixPngPath = path.join(OUTPUT_DIR, 'tca-nexus-action-category-matrix.png')
  fs.writeFileSync(matrixSvgPath, panelA.svg, 'utf8')
  await sharp(Buffer.from(panelA.svg))
    .resize(4500, Math.round((4500 * MATRIX_H) / MATRIX_W), { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, palette: false })
    .withMetadata({ density: DENSITY })
    .toFile(matrixPngPath)

  // Captions are manuscript text: they travel as text the authors can edit and
  // typeset, never as pixels burnt into the figure.
  const captionsPath = path.join(OUTPUT_DIR, 'figure-captions.md')
  const shared = [
    'Linkages between the 22 transformative-change actions of the IPBES Transformative',
    'Change Assessment (chapter 5) and the 71 response options of the IPBES Nexus',
    'Assessment (chapter 5), as coded by expert authors of both assessments.',
  ]
  const byVariant = Object.fromEntries(report.map((figure) => [figure.variant, figure]))
  const bySmall = Object.fromEntries(smallReport.map((figure) => [figure.variant, figure]))

  // Numbering is the manuscript's, not the script's: body figures 3a, 3b and 4,
  // then supplementary figures S1-S4. Keeping it here means the captions file and
  // the manuscript cannot drift apart over what S3 refers to.
  const entries = [
    { number: 'Figure 3a', title: 'Actions by response-option category',
      figure: { png: matrixPngPath, svg: matrixSvgPath, caption: panelA.caption }, shared: true },
    { number: 'Figure 3b', title: 'Actions by individual response option',
      figure: byVariant.body, shared: true },
    { number: 'Figure 4', title: 'Reach against breadth, for the 22 actions',
      figure: bySmall['reach-breadth'], shared: false },
    { number: 'S1 Fig', title: 'Complete mapping of TCA actions to Nexus response options, without the agreement threshold',
      figure: byVariant.supplementary, shared: true, file: 'S1_fig.png' },
    { number: 'S2 Fig', title: 'Primary judgements only',
      figure: byVariant['primary-only'], shared: true, file: 'S2_fig.png' },
    { number: 'S3 Fig', title: 'Distribution of action\u2013response option pairs by the number of experts who identified them',
      figure: bySmall['coder-counts'], shared: false, file: 'S3_fig.png' },
    { number: 'S4 Fig', title: 'Strength composition of the linkages reaching each Nexus response-option category',
      figure: bySmall['strength-by-category'], shared: false, file: 'S4_fig.png' },
  ]

  fs.writeFileSync(
    captionsPath,
    [
      '# Figure captions',
      '',
      '_Generated by `scripts/export-flow-figure.cjs`; regenerate rather than edit in place._',
      '',
      ...entries.flatMap((entry) => [
        `## ${entry.number}. ${entry.title}`,
        '',
        entry.file
          ? `Upload as \`${entry.file}\` \u00b7 source \`${path.basename(entry.figure.png)}\`, \`${path.basename(entry.figure.svg)}\``
          : `\`${path.basename(entry.figure.png)}\` \u00b7 \`${path.basename(entry.figure.svg)}\``,
        '',
        ...(entry.shared ? [...shared, ''] : []),
        entry.figure.caption,
        '',
      ]),
      '## Printing',
      '',
      `Figures 3b, S1 Fig and S2 Fig are drawn for ${PRINT_W_MM} \u00d7 ${PRINT_H_MM} mm (full page, portrait);`,
      `Figure 3a for ${PRINT_W_MM} \u00d7 ${MATRIX_PRINT_H_MM.toFixed(1)} mm; Figure 4, S3 Fig and S4 Fig for`,
      `${PRINT_W_MM} mm wide at their own aspect. No text in any of them falls below ${MIN_TYPE_PT} pt at`,
      'those sizes; reproducing them smaller will break that.',
      '',
      '## S1 Table. Expert-coded linkages between TCA actions and Nexus response options',
      '',
      'Upload as `S1_table.xlsx` \u00b7 source `tca-nexus-supplementary-tables.xlsx`',
      '',
      'One workbook of four sheets. Table A gives one row per TCA action; Table B one row per',
      'Nexus response option; Table C one row per action\u2013response option pair, with the number',
      'of coders, the primary/secondary split, whether the coders divided on strength, and which',
      'figure shows the pair; Table D gives the action \u00d7 category matrix of Figure 3a in full.',
      'Every count removed from the figures is here, so the counts are moved rather than lost.',
      '',
    ].join('\n'),
    'utf8',
  )

  const tablesPath = path.join(OUTPUT_DIR, 'tca-nexus-supplementary-tables.xlsx')
  const tables = await writeTables({ links, tcaActions, nexusOptions, outputPath: tablesPath, minCoders: 2 })

  // PLOS matches the uploaded file name to the caption, so ship copies under the
  // names it expects while keeping the descriptive ones we work with.
  const submissionDir = path.join(OUTPUT_DIR, 'submission')
  fs.mkdirSync(submissionDir, { recursive: true })
  const submission = [
    [byVariant.supplementary.png, 'S1_fig.png'],
    [byVariant['primary-only'].png, 'S2_fig.png'],
    [bySmall['coder-counts'].png, 'S3_fig.png'],
    [bySmall['strength-by-category'].png, 'S4_fig.png'],
    [tablesPath, 'S1_table.xlsx'],
  ]
  for (const [from, name] of submission) {
    fs.copyFileSync(from, path.join(submissionDir, name))
  }

  console.log(
    JSON.stringify(
      {
        width: PNG_W,
        height: PNG_H,
        density: DENSITY,
        figures: [
          { variant: 'matrix', ...panelA.stats, svg: matrixSvgPath, png: matrixPngPath },
          ...report.map(({ caption, ...rest }) => rest),
          ...smallReport.map(({ caption, ...rest }) => rest),
        ],
        captions: captionsPath,
        tables: { ...tables, path: tablesPath },
        submission: { dir: submissionDir, files: submission.map(([, name]) => name) },
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
