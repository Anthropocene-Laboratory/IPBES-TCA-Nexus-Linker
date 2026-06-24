import { groupBy } from '../lib/format'
import Highlight from './Highlight'
import CommentBox from './CommentBox'

function StrengthButton({ label, active, color, onClick, disabled }) {
  const base =
    'text-xs font-medium rounded-md px-2 py-1 border transition-[background-color,transform] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100'
  const on =
    color === 'primary'
      ? 'bg-indigo-600 border-indigo-600 text-white'
      : 'bg-amber-500 border-amber-500 text-white'
  const off = 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${active ? on : off}`}>
      {label}
    </button>
  )
}

function AgreementBadge({ primary, secondary }) {
  if (primary === 0 && secondary === 0) return null
  return (
    <div className="flex items-center gap-1">
      {primary > 0 && (
        <span
          title={`${primary} expert(s) — primary`}
          className={
            'text-[11px] rounded-full px-1.5 py-0.5 ' +
            (primary >= 2 ? 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-300 font-semibold' : 'bg-slate-100 text-slate-600')
          }
        >
          P×{primary}
        </span>
      )}
      {secondary > 0 && (
        <span
          title={`${secondary} expert(s) — secondary`}
          className={
            'text-[11px] rounded-full px-1.5 py-0.5 ' +
            (secondary >= 2 ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 font-semibold' : 'bg-slate-100 text-slate-600')
          }
        >
          S×{secondary}
        </span>
      )}
    </div>
  )
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'unlinked', label: 'Unlinked' },
  { key: 'agreement', label: 'Agreement' },
]

export default function NexusList({
  options,
  totalCount,
  selectedActionId,
  pairAgg,
  selectedOptionId,
  focusedOptionId,
  onSelectOption,
  onHoverOption,
  onSetStrength,
  onSetComment,
  busyOptionId,
  search,
  onSearch,
  filter,
  onFilter,
  collapsedCats,
  onToggleCategory,
  myLinkedCount,
}) {
  const groups = groupBy(options, (o) => o.category)
  const disabled = !selectedActionId

  return (
    <div className="flex flex-col h-full">
      {/* Fixed control header (does not scroll) */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Nexus Response Options</h2>
          <span className="text-xs text-slate-400">
            {selectedActionId ? `${myLinkedCount} linked · ` : ''}
            {options.length}/{totalCount}
          </span>
        </div>

        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search options…"
            className="w-full rounded-lg border border-slate-300 pl-3 pr-8 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {search && (
            <button
              onClick={() => onSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilter(f.key)}
              className={
                'text-xs rounded-full px-2.5 py-1 border transition-colors active:scale-[0.97] ' +
                (filter === f.key
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-slate-400">
          {disabled ? 'Select a TCA action first. ' : ''}
          Keys: ↑/↓ navigate · P primary · S secondary · X remove
        </p>
      </div>

      {/* Scroll area with sticky category headers */}
      <div className="flex-1 overflow-y-auto">
        {options.length === 0 && (
          <p className="p-4 text-sm text-slate-400">No options match.</p>
        )}
        {groups.map(({ key, list }) => {
          const collapsed = collapsedCats.has(key)
          return (
            <div key={key}>
              <button
                onClick={() => onToggleCategory(key)}
                className="w-full sticky top-0 z-10 bg-slate-50/95 backdrop-blur px-4 py-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100"
              >
                <span>{key}</span>
                <span className="text-slate-400">{collapsed ? `+${list.length}` : '−'}</span>
              </button>
              {!collapsed &&
                list.map((o) => {
                  const agg = pairAgg(o.id)
                  const selected = o.id === selectedOptionId
                  const focused = o.id === focusedOptionId
                  return (
                    <div
                      key={o.id}
                      data-opt={o.id}
                      onMouseEnter={() => onHoverOption(o)}
                      onMouseLeave={() => onHoverOption(null)}
                      className={
                        'px-4 py-2 border-l-2 ' +
                        (focused
                          ? 'border-slate-900 bg-indigo-50/60'
                          : selected
                          ? 'border-slate-400 bg-slate-50'
                          : 'border-transparent')
                      }
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => onSelectOption(o)}
                          className="flex-1 text-left"
                          title={selected ? 'Click to unpin definition' : 'Click to pin definition + attribution'}
                        >
                          <span className="text-xs font-mono text-slate-500 mr-1">
                            <Highlight text={o.id} query={search} />
                          </span>
                          <span className="text-sm text-slate-700">
                            <Highlight text={o.title} query={search} />
                          </span>
                          {selected && (
                            <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                              pinned
                            </span>
                          )}
                        </button>
                        <AgreementBadge primary={agg.primary} secondary={agg.secondary} />
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <StrengthButton
                          label="Primary"
                          color="primary"
                          active={agg.mine === 'primary'}
                          disabled={disabled || busyOptionId === o.id}
                          onClick={() => onSetStrength(o, 'primary')}
                        />
                        <StrengthButton
                          label="Secondary"
                          color="secondary"
                          active={agg.mine === 'secondary'}
                          disabled={disabled || busyOptionId === o.id}
                          onClick={() => onSetStrength(o, 'secondary')}
                        />
                        {agg.mine && <span className="text-[11px] text-slate-500">Click the active label again to remove</span>}
                      </div>
                      {agg.mine && (
                        <CommentBox
                          key={`${selectedActionId}-${o.id}`}
                          initial={agg.mineComment}
                          onSave={(t) => onSetComment(o, t)}
                          disabled={busyOptionId === o.id}
                        />
                      )}
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
