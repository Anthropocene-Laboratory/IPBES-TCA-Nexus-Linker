function escapeCsv(value) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

/** Download one row per expert judgement, including the source definitions. */
export function downloadLinksCsv(links, expertsById, tcaActions, nexusOptions) {
  const actionById = Object.fromEntries(tcaActions.map((action) => [action.id, action]))
  const optionById = Object.fromEntries(nexusOptions.map((option) => [option.id, option]))
  const columns = [
    'expert_name', 'expert_id', 'tca_action_id', 'tca_action', 'tca_definition',
    'nexus_option_id', 'nexus_option', 'nexus_category', 'nexus_definition',
    'link_strength', 'comment', 'created_at', 'updated_at',
  ]
  const rows = [...links]
    .sort((a, b) =>
      `${a.tca_action_id}|${a.nexus_option_id}|${expertsById[a.expert_id] || ''}`.localeCompare(
        `${b.tca_action_id}|${b.nexus_option_id}|${expertsById[b.expert_id] || ''}`,
      ),
    )
    .map((link) => {
      const action = actionById[link.tca_action_id] || {}
      const option = optionById[link.nexus_option_id] || {}
      return [
        expertsById[link.expert_id] || '', link.expert_id, link.tca_action_id,
        action.action, action.definition, link.nexus_option_id, option.title,
        option.category, option.definition, link.strength, link.comment,
        link.created_at, link.updated_at,
      ].map(escapeCsv).join(',')
    })

  const csv = `\uFEFF${columns.map(escapeCsv).join(',')}\n${rows.join('\n')}\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `tca-nexus-links-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
