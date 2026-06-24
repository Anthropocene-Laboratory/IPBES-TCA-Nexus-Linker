import ExcelJS from 'exceljs'
import { parseStrategy, parseAction } from './format'

const HEADER_FILL = 'FF0F172A' // slate-900
const ZEBRA_FILL = 'FFF1F5F9' // slate-100
const PRIMARY_COLOR = 'FF4338CA' // indigo-700
const SECONDARY_COLOR = 'FFB45309' // amber-700

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function styleHeader(ws) {
  const row = ws.getRow(1)
  row.height = 22
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

function zebraAndBorders(ws, firstDataRow) {
  for (let i = firstDataRow; i <= ws.rowCount; i++) {
    const row = ws.getRow(i)
    if ((i - firstDataRow) % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } }
      })
    }
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
      if (!cell.alignment) cell.alignment = { vertical: 'top' }
      else cell.alignment = { ...cell.alignment, vertical: 'top' }
    })
  }
}

/** Download all expert judgements as a formatted Excel workbook. */
export async function downloadLinksExcel(links, expertsById, tcaActions, nexusOptions) {
  const actionById = Object.fromEntries(tcaActions.map((a) => [a.id, a]))
  const optionById = Object.fromEntries(nexusOptions.map((o) => [o.id, o]))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'TCA ↔ Nexus Linker'
  wb.created = new Date()

  // ---- Sheet 1: Links (one row per judgement) ------------------------
  const ws = wb.addWorksheet('Links', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  ws.columns = [
    { header: 'Strategy', key: 'strategy', width: 26 },
    { header: 'Action', key: 'actionCode', width: 9 },
    { header: 'TCA action', key: 'action', width: 42 },
    { header: 'Nexus code', key: 'nexusCode', width: 11 },
    { header: 'Nexus option', key: 'option', width: 36 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Strength', key: 'strength', width: 12 },
    { header: 'Expert', key: 'expert', width: 24 },
    { header: 'Rationale', key: 'comment', width: 48 },
    { header: 'TCA definition', key: 'tcaDef', width: 70 },
    { header: 'Nexus definition', key: 'nexusDef', width: 70 },
    { header: 'Created', key: 'created', width: 18 },
    { header: 'Updated', key: 'updated', width: 18 },
  ]

  const sorted = [...links].sort((a, b) =>
    `${a.tca_action_id}|${a.nexus_option_id}|${expertsById[a.expert_id] || ''}`.localeCompare(
      `${b.tca_action_id}|${b.nexus_option_id}|${expertsById[b.expert_id] || ''}`,
    ),
  )

  for (const link of sorted) {
    const action = actionById[link.tca_action_id] || {}
    const option = optionById[link.nexus_option_id] || {}
    const ps = parseStrategy(action.strategy || '')
    const pa = parseAction(action.action || '')
    const row = ws.addRow({
      strategy: ps.num ? `${ps.num} · ${ps.label}` : action.strategy || '',
      actionCode: pa.code || link.tca_action_id,
      action: pa.label || action.action || '',
      nexusCode: link.nexus_option_id,
      option: option.title || '',
      category: option.category || '',
      strength: link.strength === 'primary' ? 'Primary' : 'Secondary',
      expert: expertsById[link.expert_id] || '—',
      comment: link.comment || '',
      tcaDef: action.definition || '',
      nexusDef: option.definition || '',
      created: fmtDate(link.created_at),
      updated: fmtDate(link.updated_at),
    })
    row.height = 30
    row.getCell('action').alignment = { wrapText: true, vertical: 'top' }
    row.getCell('option').alignment = { wrapText: true, vertical: 'top' }
    row.getCell('comment').alignment = { wrapText: true, vertical: 'top' }
    row.getCell('tcaDef').alignment = { wrapText: true, vertical: 'top' }
    row.getCell('nexusDef').alignment = { wrapText: true, vertical: 'top' }
    const sCell = row.getCell('strength')
    sCell.font = { bold: true, color: { argb: link.strength === 'primary' ? PRIMARY_COLOR : SECONDARY_COLOR } }
  }

  styleHeader(ws)
  zebraAndBorders(ws, 2)
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }

  // ---- Sheet 2: Summary by pair --------------------------------------
  const agg = {}
  for (const link of links) {
    const key = `${link.tca_action_id}|${link.nexus_option_id}`
    const slot =
      agg[key] ||
      (agg[key] = { a: link.tca_action_id, o: link.nexus_option_id, p: 0, s: 0, experts: [] })
    if (link.strength === 'primary') slot.p += 1
    else slot.s += 1
    slot.experts.push(expertsById[link.expert_id] || '—')
  }

  const ws2 = wb.addWorksheet('Summary by pair', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws2.columns = [
    { header: 'Action', key: 'actionCode', width: 9 },
    { header: 'TCA action', key: 'action', width: 42 },
    { header: 'Nexus code', key: 'nexusCode', width: 11 },
    { header: 'Nexus option', key: 'option', width: 36 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Experts', key: 'count', width: 9 },
    { header: 'Primary', key: 'primary', width: 9 },
    { header: 'Secondary', key: 'secondary', width: 11 },
    { header: 'Agreement', key: 'agreement', width: 12 },
    { header: 'Who', key: 'who', width: 50 },
  ]

  Object.values(agg)
    .sort((x, y) => y.p + y.s - (x.p + x.s) || x.a.localeCompare(y.a))
    .forEach((slot) => {
      const action = actionById[slot.a] || {}
      const option = optionById[slot.o] || {}
      const pa = parseAction(action.action || '')
      const row = ws2.addRow({
        actionCode: pa.code || slot.a,
        action: pa.label || action.action || '',
        nexusCode: slot.o,
        option: option.title || '',
        category: option.category || '',
        count: slot.p + slot.s,
        primary: slot.p,
        secondary: slot.s,
        agreement: slot.p >= 2 || slot.s >= 2 ? 'Yes' : '',
        who: slot.experts.join(', '),
      })
      row.height = 26
      row.getCell('action').alignment = { wrapText: true, vertical: 'top' }
      row.getCell('option').alignment = { wrapText: true, vertical: 'top' }
      row.getCell('who').alignment = { wrapText: true, vertical: 'top' }
      if (slot.p >= 2 || slot.s >= 2) {
        row.getCell('agreement').font = { bold: true, color: { argb: PRIMARY_COLOR } }
      }
    })

  styleHeader(ws2)
  zebraAndBorders(ws2, 2)
  ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws2.columnCount } }

  // ---- Download ------------------------------------------------------
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `tca-nexus-links-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
