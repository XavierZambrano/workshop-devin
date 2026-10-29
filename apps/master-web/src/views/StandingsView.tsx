import type { Tournament } from '@tourney/engine';
import { activeWarningCount, computeStandings } from '@tourney/engine';
import { useApp } from '../store';
import { pct, statusBadge } from '../helpers';

export function StandingsView({ t }: { t: Tournament }) {
  const selectPlayer = useApp((s) => s.selectPlayer);
  const standings = computeStandings(t);
  const players = new Map(t.players.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-bold">Standings</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-slate-900 text-sm uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Record</th>
              <th className="px-4 py-3">Points</th>
              <th className="px-4 py-3">Win %</th>
              <th className="px-4 py-3">Opp %</th>
              <th className="px-4 py-3">Byes</th>
              <th className="px-4 py-3">Warnings</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {standings.map((s) => {
              const p = players.get(s.playerId);
              const badge = p ? statusBadge(p) : undefined;
              return (
                <tr
                  key={s.playerId}
                  onClick={() => selectPlayer(s.playerId)}
                  className="cursor-pointer bg-slate-950 hover:bg-slate-900"
                >
                  <td className="px-4 py-3 font-mono text-lg">{s.rank}</td>
                  <td className="px-4 py-3 font-semibold">{p?.displayName ?? 'Unknown'}</td>
                  <td className="px-4 py-3 font-mono">
                    {s.wins}-{s.losses}-{s.draws}
                  </td>
                  <td className="px-4 py-3 font-mono">{s.matchPoints}</td>
                  <td className="px-4 py-3 font-mono">{pct(s.matchWinPct)}</td>
                  <td className="px-4 py-3 font-mono">{pct(s.oppMatchWinPct)}</td>
                  <td className="px-4 py-3 font-mono">{s.byes}</td>
                  <td className="px-4 py-3 font-mono">{activeWarningCount(t, s.playerId)}</td>
                  <td className="px-4 py-3">
                    {badge && (
                      <span className={`rounded border px-2 py-0.5 text-xs ${badge.className}`}>
                        {badge.label}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        {t.format === 'ROUND_ROBIN'
          ? 'Tiebreakers: points → head-to-head → Opp% → seed. Opp% stands in for game win% because the model has no game scores.'
          : 'Tiebreakers: match points → opponent match-win % → head-to-head → seed. Win% and Opp% exclude byes.'}
      </p>
    </div>
  );
}
