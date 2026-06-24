import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import tcaActions from '../data/tca_actions.json'
import nexusOptions from '../data/nexus_options.json'
import TcaList from './TcaList'
import NexusList from './NexusList'
import DefinitionPanel from './DefinitionPanel'
import GraphView from './GraphView'
import { downloadLinksCsv } from '../lib/exportLinks'
import { parseAction } from '../lib/format'

const EMPTY_AGG = { mine: null, mineComment: '', primary: 0, secondary: 0, list: [] }

export default function Workspace({ me, onSignOut }) {
  const [links, setLinks] = useState([])
  const [expertsById, setExpertsById] = useState({})
  const [selectedActionId, setSelectedActionId] = useState(null)
  const [selectedOption, setSelectedOption] = useState(null) // pinned (click)
  const [hoveredOption, setHoveredOption] = useState(null) // preview (hover)
  const [busyOptionId, setBusyOptionId] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState('linker') // linker | graph
  const [colW, setColW] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('tcaNexusColW'))
      if (s && s.tca && s.nexus) return s
    } catch {
      /* ignore */
    }
    return { tca: 320, nexus: 480 }
  })
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
  )

  // Ergonomic controls
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | mine | unlinked | agreement
  const [collapsedCats, setCollapsedCats] = useState(() => new Set())
  const [focusedOptionId, setFocusedOptionId] = useState(null)

  const fetchLinks = useCallback(async () => {
    const { data, error } = await supabase.from('links').select('*')
    if (error) setLoadError(error.message)
    else setLinks(data || [])
  }, [])

  const fetchExperts = useCallback(async () => {
    const { data, error } = await supabase.from('experts').select('id,name')
    if (!error && data) {
      const map = {}
      for (const e of data) map[e.id] = e.name
      setExpertsById(map)
    }
  }, [])

  useEffect(() => {
    fetchExperts()
    fetchLinks()
    // Refetch links AND experts on any link change, so a newly-joined expert's
    // name resolves for everyone (not just their own session).
    const refresh = () => {
      fetchExperts()
      fetchLinks()
    }
    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'links' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'experts' }, fetchExperts)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchExperts, fetchLinks])

  const selectedAction = useMemo(
    () => tcaActions.find((a) => a.id === selectedActionId) || null,
    [selectedActionId],
  )

  const myCountByAction = useMemo(() => {
    const m = {}
    for (const l of links) {
      if (l.expert_id === me.id) m[l.tca_action_id] = (m[l.tca_action_id] || 0) + 1
    }
    return m
  }, [links, me.id])

  const pairMap = useMemo(() => {
    const map = {}
    if (!selectedActionId) return map
    for (const l of links) {
      if (l.tca_action_id !== selectedActionId) continue
      const slot =
        map[l.nexus_option_id] ||
        (map[l.nexus_option_id] = { mine: null, mineComment: '', primary: 0, secondary: 0, list: [] })
      if (l.strength === 'primary') slot.primary += 1
      else slot.secondary += 1
      if (l.expert_id === me.id) {
        slot.mine = l.strength
        slot.mineComment = l.comment || ''
      }
      slot.list.push({
        expert_id: l.expert_id,
        name: expertsById[l.expert_id] || '—',
        strength: l.strength,
        comment: l.comment || '',
      })
    }
    return map
  }, [links, selectedActionId, me.id, expertsById])

  const pairAgg = useCallback((optionId) => pairMap[optionId] || EMPTY_AGG, [pairMap])

  // Search + filter -> visible options (shared by render and keyboard nav).
  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return nexusOptions.filter((o) => {
      if (q) {
        const hay = `${o.id} ${o.title} ${o.category} ${o.definition}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filter === 'all') return true
      const agg = pairMap[o.id] || EMPTY_AGG
      if (filter === 'mine') return agg.mine != null
      if (filter === 'unlinked') return agg.mine == null
      if (filter === 'agreement') return agg.primary >= 2 || agg.secondary >= 2
      return true
    })
  }, [search, filter, pairMap])

  // When an option is pinned (selected), it freezes the definition panel:
  // hover no longer changes it. With nothing pinned, hover previews.
  const displayedOption = selectedOption || hoveredOption

  const attribution = useMemo(() => {
    if (!displayedOption || !selectedActionId) return []
    const slot = pairMap[displayedOption.id]
    if (!slot) return []
    return [...slot.list].sort(
      (a, b) =>
        (a.strength === b.strength ? 0 : a.strength === 'primary' ? -1 : 1) ||
        a.name.localeCompare(b.name),
    )
  }, [pairMap, displayedOption, selectedActionId])

  const setStrength = useCallback(
    async (option, strength) => {
      if (!selectedActionId) return
      setBusyOptionId(option.id)
      const current = pairMap[option.id]?.mine
      let error
      if (current === strength) {
        ;({ error } = await supabase
          .from('links')
          .delete()
          .match({ expert_id: me.id, tca_action_id: selectedActionId, nexus_option_id: option.id }))
      } else {
        ;({ error } = await supabase.from('links').upsert(
          {
            expert_id: me.id,
            tca_action_id: selectedActionId,
            nexus_option_id: option.id,
            strength,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'expert_id,tca_action_id,nexus_option_id' },
        ))
      }
      if (error) setLoadError(error.message)
      await fetchLinks()
      setBusyOptionId(null)
    },
    [selectedActionId, pairMap, me.id, fetchLinks],
  )

  const removeLink = useCallback(
    async (option) => {
      if (!selectedActionId || !pairMap[option.id]?.mine) return
      setBusyOptionId(option.id)
      const { error } = await supabase
        .from('links')
        .delete()
        .match({ expert_id: me.id, tca_action_id: selectedActionId, nexus_option_id: option.id })
      if (error) setLoadError(error.message)
      await fetchLinks()
      setBusyOptionId(null)
    },
    [selectedActionId, pairMap, me.id, fetchLinks],
  )

  const setComment = useCallback(
    async (option, text) => {
      if (!selectedActionId) return
      setBusyOptionId(option.id)
      setLoadError('')
      try {
        const { data, error } = await supabase
          .from('links')
          .update({ comment: text, updated_at: new Date().toISOString() })
          .match({ expert_id: me.id, tca_action_id: selectedActionId, nexus_option_id: option.id })
          .select('id')
          .maybeSingle()
        if (error) throw error
        if (!data) throw new Error('This link could not be found. Please reload and try again.')
        await fetchLinks()
      } catch (error) {
        setLoadError(error.message)
        throw error
      } finally {
        setBusyOptionId(null)
      }
    },
    [selectedActionId, me.id, fetchLinks],
  )

  function toggleCategory(cat) {
    setCollapsedCats((prev) => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
  }

  const focusOption = useCallback((opt) => {
    setFocusedOptionId(opt.id)
    setHoveredOption(opt) // preview in the definition panel
    setCollapsedCats((prev) => {
      if (!prev.has(opt.category)) return prev
      const n = new Set(prev)
      n.delete(opt.category)
      return n
    })
    requestAnimationFrame(() => {
      document.querySelector(`[data-opt="${CSS.escape(opt.id)}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  // Keyboard navigation: ↑/↓ to move, P/S to link, X/Del to remove.
  const kbd = useRef({})
  kbd.current = { visibleOptions, focusedOptionId, selectedActionId, setStrength, removeLink, focusOption }
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const { visibleOptions, focusedOptionId, selectedActionId, setStrength, removeLink, focusOption } = kbd.current
      if (!visibleOptions.length) return
      const idx = visibleOptions.findIndex((o) => o.id === focusedOptionId)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusOption(visibleOptions[idx < 0 ? 0 : Math.min(idx + 1, visibleOptions.length - 1)])
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        focusOption(visibleOptions[idx < 0 ? 0 : Math.max(idx - 1, 0)])
      } else if (selectedActionId && idx >= 0) {
        const opt = visibleOptions[idx]
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault()
          setStrength(opt, 'primary')
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault()
          setStrength(opt, 'secondary')
        } else if (e.key === 'x' || e.key === 'X' || e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          removeLink(opt)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function selectAction(id) {
    setSelectedActionId(id)
    setSelectedOption(null)
    setHoveredOption(null)
    setFocusedOptionId(null)
  }

  // Resizable columns (desktop): track widths, persist, drag handles.
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const h = () => setIsDesktop(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    localStorage.setItem('tcaNexusColW', JSON.stringify(colW))
  }, [colW])

  function startResize(which, e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = colW[which]
    const onMove = (ev) => {
      const w = Math.min(760, Math.max(220, startW + (ev.clientX - startX)))
      setColW((prev) => ({ ...prev, [which]: w }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const myLinkedCount = selectedActionId ? myCountByAction[selectedActionId] || 0 : 0

  const tcaPanel = (
    <TcaList actions={tcaActions} selectedId={selectedActionId} onSelect={selectAction} myCountByAction={myCountByAction} />
  )
  const nexusPanel = (
    <NexusList
      options={visibleOptions}
      totalCount={nexusOptions.length}
      selectedActionId={selectedActionId}
      pairAgg={pairAgg}
      selectedOptionId={selectedOption?.id}
      focusedOptionId={focusedOptionId}
      onSelectOption={(o) => {
        setSelectedOption((prev) => (prev?.id === o.id ? null : o))
        setFocusedOptionId(o.id)
      }}
      onHoverOption={setHoveredOption}
      onSetStrength={setStrength}
      onSetComment={setComment}
      busyOptionId={busyOptionId}
      search={search}
      onSearch={setSearch}
      filter={filter}
      onFilter={setFilter}
      collapsedCats={collapsedCats}
      onToggleCategory={toggleCategory}
      myLinkedCount={myLinkedCount}
    />
  )
  const defPanel = (
    <DefinitionPanel action={selectedAction} option={displayedOption} attribution={attribution} query={search} />
  )
  const resizerClass = 'bg-slate-200 hover:bg-indigo-400 active:bg-indigo-500 cursor-col-resize transition-colors'

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between gap-4 px-4 py-3 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-sm font-semibold text-slate-900">TCA ↔ Nexus Linker</h1>
          <p className="text-xs text-slate-400">Link TCA actions to Nexus response options</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
          {[
            { key: 'linker', label: 'Linker' },
            { key: 'graph', label: 'Flow graph' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                'text-xs font-medium rounded-md px-3 py-1.5 transition-colors ' +
                (tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => downloadLinksCsv(links, expertsById, tcaActions, nexusOptions)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            title="Download one row per expert link as a CSV file"
          >
            Download CSV
          </button>
          <span className="text-slate-600">
            Expert: <strong className="text-slate-900">{me.name}</strong>
          </span>
          <button
            onClick={onSignOut}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Switch expert
          </button>
        </div>
      </header>

      {loadError && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-2 border-b border-red-200">{loadError}</div>
      )}

      {tab === 'linker' && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-800">Workflow:</span>{' '}
          choose an action, inspect an option definition, then record a primary or secondary link.
          {selectedAction && (
            <span className="ml-2 font-medium text-indigo-700">Currently coding: {parseAction(selectedAction.action).code}</span>
          )}
        </div>
      )}

      {tab === 'graph' ? (
        <div className="flex-1 min-h-0 bg-white">
          <GraphView links={links} expertsById={expertsById} />
        </div>
      ) : isDesktop ? (
        <div
          className="flex-1 min-h-0 grid"
          style={{ gridTemplateColumns: `${colW.tca}px 6px ${colW.nexus}px 6px minmax(0, 1fr)` }}
        >
          <div className="min-h-0 bg-white overflow-hidden">{tcaPanel}</div>
          <div onMouseDown={(e) => startResize('tca', e)} className={resizerClass} title="Drag to resize" />
          <div className="min-h-0 bg-white overflow-hidden">{nexusPanel}</div>
          <div onMouseDown={(e) => startResize('nexus', e)} className={resizerClass} title="Drag to resize" />
          <div className="min-h-0 bg-white overflow-hidden">{defPanel}</div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto grid grid-cols-1 divide-y divide-slate-200">
          <div className="h-[70vh] bg-white">{tcaPanel}</div>
          <div className="h-[70vh] bg-white">{nexusPanel}</div>
          <div className="h-[70vh] bg-white">{defPanel}</div>
        </div>
      )}
    </div>
  )
}
