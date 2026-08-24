const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, 'publication')

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

function buildFigure({
  links,
  tcaActions,
  nexusOptions,
  minCoders = 1,
  showCounts = true,
  strengths = ['primary', 'secondary'],
}) {
  const wanted = new Set(strengths)
  const primaryOnly = !wanted.has('secondary')
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
    // The strength filter defines the universe: everything downstream — the
    // pair counts, the threshold, the footer's denominators — is computed
    // within it, never against a total the figure does not draw.
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

  // A pair carried by a single coder is a non-observation, not a weak agreement.
  // Drop those below the threshold FIRST, then derive every total from what is
  // left — node heights are the sum of the ribbons that leave them, so totals
  // accumulated over all links would no longer match the ribbons drawn.
  for (const [key, cell] of [...matrix]) {
    if (cell.count < minCoders) matrix.delete(key)
  }
  for (const [key, cell] of matrix) {
    const [actionId, optionId] = key.split('|')
    actionTotals.set(actionId, (actionTotals.get(actionId) || 0) + cell.count)
    optionTotals.set(optionId, (optionTotals.get(optionId) || 0) + cell.count)
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
  const plotHeight = 1322
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
      const text = showCounts
        ? `${parsed.code}  ${parsed.label}  (n = ${node.count})`
        : `${parsed.code}  ${parsed.label}`
      return wrapWords(text, 56, 3)
    },
    plotTop,
    plotTop + plotHeight,
    17,
    5,
  )
  const rightLabels = placeLabels(
    rightNodes,
    (node) =>
      showCounts
        ? [`${node.option.id}  ${node.option.title}  (n = ${node.count})`]
        : [`${node.option.id}  ${node.option.title}`],
    plotTop,
    plotTop + plotHeight,
    14,
    2.5,
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
  const leftSpineX = 92
  for (const span of groupSpans(leftNodes, (node) => node.si)) {
    const color = STRATEGY_COLORS[span.key]
    parts.push(`<rect x="${leftSpineX}" y="${span.top}" width="5" height="${Math.max(span.bottom - span.top, 2)}" rx="2" fill="${color}"/>`)
    const mid = (span.top + span.bottom) / 2
    parts.push(`<text transform="translate(${leftSpineX - 9},${mid}) rotate(-90)" text-anchor="middle" class="group" fill="${color}">${showCounts ? `Strategy ${span.key + 1} (n = ${span.count})` : `Strategy ${span.key + 1}`}</text>`)
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
  // colours) plus the two strengths, then the ten Nexus categories, so every
  // colour and every density on the figure is named somewhere.
  const legendTop = VIEW_H - 64
  let lx = 232
  parts.push(`<text x="${lx - 12}" y="${legendTop + 4}" text-anchor="end" class="legend" fill="#4b5563">TCA strategy</text>`)
  for (let i = 0; i < STRATEGY_COLORS.length; i += 1) {
    parts.push(`<rect x="${lx}" y="${legendTop - 8}" width="26" height="12" rx="2" fill="${STRATEGY_COLORS[i]}"/>`)
    parts.push(`<text x="${lx + 32}" y="${legendTop + 4}" class="legend">${i + 1}</text>`)
    lx += 60
  }
  if (!primaryOnly) {
    lx += 170
    parts.push(`<text x="${lx - 12}" y="${legendTop + 4}" text-anchor="end" class="legend" fill="#4b5563">Link strength</text>`)
    for (const strength of [
      { label: 'primary', opacity: PRIMARY_OPACITY },
      { label: 'secondary', opacity: SECONDARY_OPACITY },
    ]) {
      parts.push(`<rect x="${lx}" y="${legendTop - 8}" width="26" height="12" rx="2" fill="#17202a" fill-opacity="${strength.opacity}" stroke="#c8ced5" stroke-width="0.5"/>`)
      parts.push(`<text x="${lx + 32}" y="${legendTop + 4}" class="legend">${strength.label}</text>`)
      lx += 32 + Math.round(strength.label.length * 6.9) + 34
    }
    parts.push(`<text x="${lx + 4}" y="${legendTop + 4}" class="legend" fill="#4b5563">Each ribbon is split along its width between the two.</text>`)
  } else {
    parts.push(`<text x="${lx + 40}" y="${legendTop + 4}" class="legend" fill="#4b5563">Primary judgements only.</text>`)
  }

  const legendBottom = VIEW_H - 34
  let cx = 232
  parts.push(`<text x="${cx - 12}" y="${legendBottom + 4}" text-anchor="end" class="legend" fill="#4b5563">Nexus category</text>`)
  for (const span of categorySpans) {
    const color = CATEGORY_COLORS[span.key] || '#8A8F98'
    parts.push(`<rect x="${cx}" y="${legendBottom - 8}" width="26" height="12" rx="2" fill="${color}"/>`)
    parts.push(`<text x="${cx + 32}" y="${legendBottom + 4}" class="legend">${xml(span.key)}</text>`)
    cx += 32 + 8 + Math.round(String(span.key).length * 6.9) + 22
  }

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
  const caption = `${strengthLine} ${scopeLine} ${totalsLine}`
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
  const s1 = workbook.addWorksheet('S1 By TCA action')
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
  const s2 = workbook.addWorksheet('S2 By Nexus option')
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
  const s3 = workbook.addWorksheet('S3 By pair')
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

  await workbook.xlsx.writeFile(outputPath)
  return { pairs: cells.size, sheets: ['S1 By TCA action', 'S2 By Nexus option', 'S3 By pair'] }
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

  // Captions are manuscript text: they travel as text the authors can edit and
  // typeset, never as pixels burnt into the figure.
  const captionsPath = path.join(OUTPUT_DIR, 'figure-captions.md')
  const titles = {
    body: 'Main figure',
    'primary-only': 'Main figure, primary-only variant',
    supplementary: 'Supplementary figure',
  }
  fs.writeFileSync(
    captionsPath,
    [
      '# Figure captions',
      '',
      '_Generated by `scripts/export-flow-figure.cjs`; regenerate rather than edit in place._',
      '',
      ...report.flatMap((figure) => [
        `## ${titles[figure.variant] || figure.variant}`,
        '',
        `\`${path.basename(figure.png)}\` · \`${path.basename(figure.svg)}\``,
        '',
        'Linkages between the 22 transformative-change actions of the IPBES Transformative',
        'Change Assessment (chapter 5) and the 71 response options of the IPBES Nexus',
        'Assessment (chapter 5), as coded by expert authors of both assessments. Actions are',
        'grouped by their five strategies and response options by their ten categories, each',
        'shown in its own colour.',
        '',
        figure.caption,
        '',
      ]),
    ].join('\n'),
    'utf8',
  )

  const tablesPath = path.join(OUTPUT_DIR, 'tca-nexus-supplementary-tables.xlsx')
  const tables = await writeTables({ links, tcaActions, nexusOptions, outputPath: tablesPath, minCoders: 2 })

  console.log(
    JSON.stringify(
      {
        width: PNG_W,
        height: PNG_H,
        density: DENSITY,
        figures: report.map(({ caption, ...rest }) => rest),
        captions: captionsPath,
        tables: { ...tables, path: tablesPath },
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
