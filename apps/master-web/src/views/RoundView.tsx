import { useState } from 'react';
import type { Round, Tournament } from '@tourney/engine';
import { canGenerateNextRound, generateNextRound, pendingMatchCount } from '@tourney/engine';
import { MatchCard } from '../components/MatchCard';
import { useApp } from '../store';
import { playerName } from '../helpers';

function currentRound(t: Tournament): Round | undefined {
  // Prefer the earliest unfinished round (SE: later rounds are pre-generated).
  return t.rounds.find((r) => r.status === 'ACTIVE') ?? t.rounds[t.rounds.length - 1];
}

export function RoundView({ t }: { t: Tournament }) {
  const mutate = useApp((s) => s.mutate);
  const [confirmNext, setConfirmNext] = useState(false);
  const round = currentRound(t);
  const totalRounds =
    t.format === 'SWISS' ? (t.settings.plannedRounds ?? t.rounds.length) : t.rounds.length;
  const pending = pendingMatchCount(t);
  const check = t.status === 'ACTIVE' ? canGenerateNextRound(t) : { ok: false };

  if (!round) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-400">
        Tournament has not started yet.
      </div>
    );
  }

  const matches = round.matchIds
    .map((id) => t.matches.find((m) => m.id === id)!)
    .filter(Boolean)
    .sort((a, b) => (a.tableNumber ?? 0) - (b.tableNumber ?? 0));
  const playableMatches = matches.filter((m) => m.result !== 'BYE' && m.status !== 'VOID');
  const byeMatches = matches.filter((m) => m.result === 'BYE');
  const voidMatches = matches.filter((m) => m.status === 'VOID');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm uppercase tracking-widest text-slate-400">
            {round.name ?? `Round ${round.number}`}
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            Round {round.number} <span className="text-slate-500">of {totalRounds}</span>
          </h1>
        </div>
        <div className="text-right">
          {pending > 0 ? (
            <div className="rounded-lg border border-amber-700 bg-amber-950/60 px-4 py-2 font-semibold text-amber-300">
              {pending} match{pending === 1 ? '' : 'es'} still awaiting results
            </div>
          ) : t.status === 'COMPLETE' ? (
            <div className="rounded-lg border border-emerald-700 bg-emerald-950/60 px-4 py-2 font-semibold text-emerald-300">
              Tournament complete —{' '}
              {t.championId ? `${playerName(t, t.championId)} wins` : 'finished'}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-700 bg-emerald-950/60 px-4 py-2 font-semibold text-emerald-300">
              All results in
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {playableMatches.map((m) => (
          <MatchCard key={m.id} t={t} m={m} />
        ))}
      </div>

      {(byeMatches.length > 0 || voidMatches.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...byeMatches, ...voidMatches].map((m) => (
            <MatchCard key={m.id} t={t} m={m} />
          ))}
        </div>
      )}

      {t.format === 'SWISS' && t.status === 'ACTIVE' && (
        <div className="flex items-center justify-end gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
          {!check.ok && <span className="text-sm text-amber-300">{check.reason}</span>}
          <button
            disabled={!check.ok}
            onClick={() => setConfirmNext(true)}
            className="rounded-lg bg-sky-700 px-6 py-3 text-lg font-bold hover:bg-sky-600 disabled:opacity-40"
          >
            {round.number >= totalRounds ? 'No more rounds' : `Generate Round ${round.number + 1}`}
          </button>
        </div>
      )}

      {confirmNext && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5">
            <h2 className="mb-2 text-lg font-semibold">Generate round {round.number + 1}?</h2>
            <p className="mb-5 text-sm text-slate-300">
              Pairings are locked once generated. Make sure all results — including corrections —
              are final.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmNext(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => {
                  mutate((d) => generateNextRound(d));
                  setConfirmNext(false);
                }}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
