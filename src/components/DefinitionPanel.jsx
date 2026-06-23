import { parseAction } from '../lib/format'
import Highlight from './Highlight'

function StrengthTag({ strength }) {
  const cls =
    strength === 'primary'
      ? 'bg-indigo-100 text-indigo-800'
      : 'bg-amber-100 text-amber-800'
  return (
    <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${cls}`}>
      {strength === 'primary' ? 'primary' : 'secondary'}
    </span>
  )
}

export default function DefinitionPanel({ action, option, attribution, query }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-10">
        <h2 className="text-sm font-semibold text-slate-900">Definitions</h2>
        <p className="text-xs text-slate-400">Check relevance before linking</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {!action && (
          <p className="text-sm text-slate-400">
            Select a TCA action on the left to begin.
          </p>
        )}

        {action && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              TCA Action
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">
              <span className="font-mono text-slate-500 mr-1">
                {parseAction(action.action).code}
              </span>
              {parseAction(action.action).label}
            </h3>
            <p className="mt-2 max-w-[68ch] text-sm text-slate-600 whitespace-pre-line leading-relaxed">
              {action.definition || '—'}
            </p>
          </section>
        )}

        {option && (
          <section className="border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Nexus Option · {option.category}
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">
              <span className="font-mono text-slate-500 mr-1">{option.id}</span>
              <Highlight text={option.title} query={query} />
            </h3>
            <p className="mt-2 max-w-[68ch] text-sm text-slate-600 whitespace-pre-line leading-relaxed">
              {option.definition ? <Highlight text={option.definition} query={query} /> : '—'}
            </p>

            {action && (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Expert links on this pair
                </div>
                {attribution.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">No links yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {attribution.map((a) => (
                      <li key={a.expert_id} className="flex items-center gap-2 text-sm text-slate-700">
                        <StrengthTag strength={a.strength} />
                        <span>{a.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
