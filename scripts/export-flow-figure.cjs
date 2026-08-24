const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, 'publication')
const SVG_PATH = path.join(OUTPUT_DIR, 'tca-nexus-flow-publication.svg')
const PNG_PATH = path.join(OUTPUT_DIR, 'tca-nexus-flow-publication.png')

const VIEW_W = 2260
const VIEW_H = 1500
const PNG_W = 9040
const PNG_H = 6000
const DENSITY = 600

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

function buildFigure({ links, tcaActions, nexusOptions }) {
  const actionById = new Map(tcaActions.map((action) => [action.id, action]))
  const optionById = new Map(nexusOptions.map((option) => [option.id, option]))
  const actionTotals = new Map()
  const optionTotals = new Map()
  const matrix = new Map()
  const unknown = []

  for (const link of links) {
    if (!actionById.has(link.tca_action_id) || !optionById.has(link.nexus_option_id)) {
      unknown.push(link)
      continue
    }
    const key = `${link.tca_action_id}|${link.nexus_option_id}`
    const cell = matrix.get(key) || { count: 0, primary: 0, secondary: 0 }
    cell.count += 1
    if (link.strength === 'primary') cell.primary += 1
    else cell.secondary += 1
    matrix.set(key, cell)
    actionTotals.set(link.tca_action_id, (actionTotals.get(link.tca_action_id) || 0) + 1)
    optionTotals.set(link.nexus_option_id, (optionTotals.get(link.nexus_option_id) || 0) + 1)
  }

  const validLinks = [...matrix.values()].reduce((sum, cell) => sum + cell.count, 0)
  if (!validLinks) throw new Error('No valid links were returned from Supabase')

  const leftBase = tcaActions
    .filter((action) => actionTotals.has(action.id))
    .map((action) => ({
      id: action.id,
      action,
      count: actionTotals.get(action.id),
      strategy: action.strategy,
      si: strategyIndex(action.strategy),
    }))
  const rightBase = nexusOptions
    .filter((option) => optionTotals.has(option.id))
    .map((option) => ({
      id: option.id,
      option,
      count: optionTotals.get(option.id),
      category: option.category,
    }))

  const plotTop = 78
  const plotHeight = 1320
  const leftX = 700
  const rightX = 1420
  const nodeWidth = 14

  // Gaps between groups are wider than gaps within them, so the five strategies
  // and ten categories read as blocks before any individual row is read.
  const leftGap = (index) => (leftBase[index].si === leftBase[index + 1]?.si ? 4 : 18)
  const rightGap = (index) => (rightBase[index].category === rightBase[index + 1]?.category ? 2 : 14)
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
      return wrapWords(`${parsed.code}  ${parsed.label}  (n = ${node.count})`, 56, 3)
    },
    plotTop,
    plotTop + plotHeight,
    17,
    5,
  )
  const rightLabels = placeLabels(
    rightNodes,
    (node) => [`${node.option.id}  ${node.option.title}  (n = ${node.count})`],
    plotTop,
    plotTop + plotHeight,
    14,
    2.5,
  )

  const expertCount = new Set(links.map((link) => link.expert_id).filter(Boolean)).size
  const primaryCount = [...matrix.values()].reduce((sum, cell) => sum + cell.primary, 0)
  const secondaryCount = [...matrix.values()].reduce((sum, cell) => sum + cell.secondary, 0)

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">`)
  parts.push(`<rect width="${VIEW_W}" height="${VIEW_H}" fill="#ffffff"/>`)
  parts.push(`<style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #17202a; }
    .column { font-size: 18px; font-weight: 600; }
    .label-left { font-size: 15px; font-weight: 400; }
    .label-right { font-size: 14px; font-weight: 400; }
    .group { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
    .group-right { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
    .footer { font-size: 13px; fill: #4b5563; }
    .legend { font-size: 13px; fill: #17202a; }
  </style>`)

  parts.push(`<text x="${leftX}" y="44" text-anchor="end" class="column">TCA actions</text>`)
  parts.push(`<text x="${rightX + nodeWidth}" y="44" text-anchor="start" class="column">Nexus response options</text>`)

  // Ribbons carry the colour of the strategy they leave, so a reader can follow
  // where a strategy's judgements land without tracing individual bands.
  for (const ribbon of [...ribbons].sort((a, b) => b.h - a.h)) {
    const xa = leftX + nodeWidth
    const xb = rightX
    const xm = (xa + xb) / 2
    const d = [
      `M${xa},${ribbon.sy}`,
      `C${xm},${ribbon.sy} ${xm},${ribbon.ty} ${xb},${ribbon.ty}`,
      `L${xb},${ribbon.ty + ribbon.h}`,
      `C${xm},${ribbon.ty + ribbon.h} ${xm},${ribbon.sy + ribbon.h} ${xa},${ribbon.sy + ribbon.h}`,
      'Z',
    ].join(' ')
    parts.push(`<path d="${d}" fill="${STRATEGY_COLORS[ribbon.si]}" fill-opacity="0.20"/>`)
  }

  for (const node of leftNodes) {
    parts.push(`<rect x="${leftX}" y="${node.y}" width="${nodeWidth}" height="${Math.max(node.h, 1.1)}" fill="${STRATEGY_COLORS[node.si]}"/>`)
  }
  for (const node of rightNodes) {
    const fill = CATEGORY_COLORS[node.category] || '#8A8F98'
    parts.push(`<rect x="${rightX}" y="${node.y}" width="${nodeWidth}" height="${Math.max(node.h, 1.1)}" fill="${fill}"/>`)
  }

  // Group spines. The strategy and category names are written out, so colour is a
  // redundant cue rather than the only channel carrying the grouping.
  const leftSpineX = 92
  for (const span of groupSpans(leftNodes, (node) => node.si)) {
    const color = STRATEGY_COLORS[span.key]
    parts.push(`<rect x="${leftSpineX}" y="${span.top}" width="5" height="${Math.max(span.bottom - span.top, 2)}" rx="2" fill="${color}"/>`)
    const mid = (span.top + span.bottom) / 2
    parts.push(`<text transform="translate(${leftSpineX - 9},${mid}) rotate(-90)" text-anchor="middle" class="group" fill="${color}">Strategy ${span.key + 1} (n = ${span.count})</text>`)
  }
  const rightSpineX = 2170
  const categorySpans = groupSpans(rightNodes, (node) => node.category)
  for (const span of categorySpans) {
    const color = CATEGORY_COLORS[span.key] || '#8A8F98'
    const height = Math.max(span.bottom - span.top, 2)
    parts.push(`<rect x="${rightSpineX}" y="${span.top}" width="5" height="${height}" rx="2" fill="${color}"/>`)
    // Names only on this side: ten groups, most of them too short to carry a
    // count as well, and a mixture of labelled and unlabelled counts reads worse
    // than none. The legend below gives every category its full name.
    const text = fitRotated(span.key, height, 12)
    if (!text) continue
    const mid = (span.top + span.bottom) / 2
    parts.push(`<text transform="translate(${rightSpineX + 20},${mid}) rotate(-90)" text-anchor="middle" class="group-right" fill="${color}">${xml(text)}</text>`)
  }

  for (const label of leftLabels) {
    const nodeCenter = label.target
    const labelStart = label.center - ((label.lines.length - 1) * 17) / 2
    if (Math.abs(label.center - nodeCenter) > 3) {
      parts.push(`<path d="M${leftX - 4},${nodeCenter} H${leftX - 18} L${leftX - 32},${label.center}" fill="none" stroke="#b7c0c9" stroke-width="1"/>`)
    }
    parts.push(`<text x="${leftX - 38}" y="${labelStart}" text-anchor="end" dominant-baseline="middle" class="label-left">`)
    label.lines.forEach((line, index) => {
      parts.push(`<tspan x="${leftX - 38}" dy="${index === 0 ? 0 : 17}">${xml(line)}</tspan>`)
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

  // Two legend rows: the five strategy colours (which are also the ribbon
  // colours) and the ten Nexus categories, so every colour on the figure is
  // named somewhere even where a spine was too short to carry its label.
  const legendTop = VIEW_H - 92
  let lx = 232
  parts.push(`<text x="${lx - 12}" y="${legendTop + 4}" text-anchor="end" class="legend" fill="#4b5563">TCA strategy</text>`)
  for (let i = 0; i < STRATEGY_COLORS.length; i += 1) {
    parts.push(`<rect x="${lx}" y="${legendTop - 8}" width="26" height="12" rx="2" fill="${STRATEGY_COLORS[i]}"/>`)
    parts.push(`<text x="${lx + 32}" y="${legendTop + 4}" class="legend">${i + 1}</text>`)
    lx += 60
  }
  parts.push(`<text x="${lx + 14}" y="${legendTop + 4}" class="legend" fill="#4b5563">Ribbons take the colour of the strategy they leave.</text>`)

  const legendBottom = VIEW_H - 62
  let cx = 232
  parts.push(`<text x="${cx - 12}" y="${legendBottom + 4}" text-anchor="end" class="legend" fill="#4b5563">Nexus category</text>`)
  for (const span of categorySpans) {
    const color = CATEGORY_COLORS[span.key] || '#8A8F98'
    parts.push(`<rect x="${cx}" y="${legendBottom - 8}" width="26" height="12" rx="2" fill="${color}"/>`)
    parts.push(`<text x="${cx + 32}" y="${legendBottom + 4}" class="legend">${xml(span.key)}</text>`)
    cx += 32 + 8 + Math.round(String(span.key).length * 6.9) + 22
  }

  parts.push(`<text x="92" y="${VIEW_H - 26}" class="footer">Ribbon width represents the number of expert-coded links. N = ${validLinks.toLocaleString('en-US')} links (${primaryCount.toLocaleString('en-US')} primary; ${secondaryCount.toLocaleString('en-US')} secondary) from ${expertCount} experts.</text>`)
  parts.push('</svg>')

  return {
    svg: parts.join('\n'),
    stats: {
      totalLinks: links.length,
      validLinks,
      expertCount,
      actionCount: leftNodes.length,
      optionCount: rightNodes.length,
      pairCount: matrix.size,
      primaryCount,
      secondaryCount,
      unknownLinks: unknown.length,
    },
  }
}

async function main() {
  const env = parseEnv(path.join(ROOT, '.env'))
  const [links, tcaActions, nexusOptions] = await Promise.all([
    fetchLinks(env),
    Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tca_actions.json'), 'utf8'))),
    Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'nexus_options.json'), 'utf8'))),
  ])
  const { svg, stats } = buildFigure({ links, tcaActions, nexusOptions })
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(SVG_PATH, svg, 'utf8')

  const sharp = loadSharp()
  await sharp(Buffer.from(svg))
    .resize(PNG_W, PNG_H, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, palette: false })
    .withMetadata({ density: DENSITY })
    .toFile(PNG_PATH)

  console.log(JSON.stringify({ ...stats, png: PNG_PATH, svg: SVG_PATH, width: PNG_W, height: PNG_H, density: DENSITY }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
