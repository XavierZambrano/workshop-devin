import type { Tournament } from '@tourney/engine';
import { formatTime } from '../helpers';

const TYPE_LABEL: Record<string, string> = {
  TOURNAMENT_CREATED: 'Tournament',
  TOURNAMENT_STARTED: 'Tournament',
  TOURNAMENT_COMPLETED: 'Tournament',
  PLAYER_REGISTERED: 'Players',
  PLAYER_UPDATED: 'Players',
  PLAYER_REMOVED: 'Players',
  PLAYER_DROPPED: 'Players',
  PLAYER_DISQUALIFIED: 'Players',
  ROUND_CREATED: 'Rounds',
  ROUND_COMPLETED: 'Rounds',
  MATCH_RESULT_RECORDED: 'Matches',
  MATCH_RESULT_CORRECTED: 'Matches',
  MATCH_VOIDED: 'Matches',
  WARNING_ISSUED: 'Discipline',
  WARNING_REVOKED: 'Discipline',
  PENALTY_ISSUED: 'Discipline',
  PENALTY_REVOKED: 'Discipline',
};

export function HistoryView({ t }: { t: Tournament }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold">History</h1>
      {t.events.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-400">
          No events yet.
        </div>
      ) : (
        <ol className="space-y-1.5">
          {t.events.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2"
            >
              <span className="w-14 shrink-0 font-mono text-sm text-slate-500">
                {formatTime(e.timestamp)}
              </span>
              <span className="w-24 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {TYPE_LABEL[e.type] ?? e.type}
              </span>
              <span className="text-sm text-slate-200">{e.description}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
