import { parseStrategy, parseAction, groupBy } from '../lib/format'

export default function TcaList({ actions, selectedId, onSelect, myCountByAction }) {
  const groups = groupBy(actions, (a) => a.strategy)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-10">
        <h2 className="text-sm font-semibold text-slate-900">TCA Actions</h2>
        <p className="text-xs text-slate-400">{actions.length} actions · 5 strategies</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.map(({ key, list }) => {
          const s = parseStrategy(key)
          return (
            <div key={key}>
              <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Strategy {s.num} · {s.label}
              </div>
              {list.map((a) => {
                const p = parseAction(a.action)
                const active = a.id === selectedId
                const mine = myCountByAction[a.id] || 0
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a.id)}
                    className={
                      'w-full text-left px-4 py-2 flex gap-2 items-start border-l-2 ' +
                      (active
                        ? 'border-slate-900 bg-slate-100'
                        : 'border-transparent hover:bg-slate-50')
                    }
                  >
                    <span className="mt-0.5 shrink-0 text-xs font-mono text-slate-500">
                      {p.code}
                    </span>
                    <span className="text-sm text-slate-700 leading-snug">{p.label}</span>
                    {mine > 0 && (
                      <span className="ml-auto shrink-0 text-[10px] rounded-full bg-slate-900 text-white px-1.5 py-0.5">
                        {mine}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
