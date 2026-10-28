import { useState } from 'react';
import type { Match, MatchResult, Tournament } from '@tourney/engine';
import { correctResult, recordResult, winnerOf } from '@tourney/engine';
import { correctionRisk, playerOf, recordString, resultLabel, statusBadge } from '../helpers';
import { useApp } from '../store';
import { ConfirmDialog } from './Modal';

function PlayerSide({
  t,
  m,
  playerId,
  won,
}: {
  t: Tournament;
  m: Match;
  playerId?: string;
  won: boolean;
}) {
  const p = playerOf(t, playerId);
  return (
    <div
      className={`flex-1 rounded-lg border px-4 py-3 ${
        won
          ? 'border-emerald-600 bg-emerald-950/50'
          : 'border-slate-700 bg-slate-900'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xl font-semibold ${won ? 'text-emerald-300' : ''}`}>
          {p?.displayName ?? 'TBD'}
        </span>
        {p && (
          <span className="flex items-center gap-2">
            {p.seed !== undefined && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                #{p.seed}
              </span>
            )}
            {p.status !== 'ACTIVE' && (
              <span
                className={`rounded border px-1.5 py-0.5 text-xs ${statusBadge(p).className}`}
              >
                {statusBadge(p).label}
              </span>
            )}
            <span className="font-mono text-sm text-slate-400">{recordString(t, p.id)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function MatchCard({ t, m }: { t: Tournament; m: Match }) {
  const mutate = useApp((s) => s.mutate);
  const [correcting, setCorrecting] = useState(false);
  const [pendingResult, setPendingResult] = useState<MatchResult | null>(null);
  const risk = correctionRisk(t, m);

  const isBye = m.result === 'BYE';
  const playable =
    (m.status === 'ACTIVE' || m.status === 'SCHEDULED') && m.playerAId && m.playerBId;
  const correctable = m.status === 'COMPLETE' && !isBye;

  const submit = (result: MatchResult) => {
    if (correcting && risk) {
      setPendingResult(result);
      return;
    }
    apply(result);
  };

  const apply = (result: MatchResult) => {
    mutate((d) => (correcting ? correctResult(d, m.id, result) : recordResult(d, m.id, result)));
    setCorrecting(false);
    setPendingResult(null);
  };

  const aWon = winnerOf(m) === m.playerAId && m.result !== 'PENDING';
  const bWon = winnerOf(m) === m.playerBId && m.result !== 'PENDING';

  return (
    <div
      className={`rounded-xl border p-4 ${
        m.status === 'COMPLETE'
          ? 'border-slate-700 bg-slate-900/60'
          : 'border-slate-600 bg-slate-900'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-wide text-slate-400">
          {m.tableNumber !== undefined ? `Table ${m.tableNumber}` : `Match`}
        </span>
        {isBye ? (
          <span className="rounded border border-sky-700 bg-sky-950/60 px-2 py-0.5 text-xs font-semibold text-sky-300">
            BYE
          </span>
        ) : m.status === 'VOID' ? (
          <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            VOID
          </span>
        ) : m.status === 'COMPLETE' ? (
          <span className="rounded border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            {resultLabel(t, m)}
          </span>
        ) : (
          <span className="rounded border border-amber-700 bg-amber-950/60 px-2 py-0.5 text-xs font-semibold text-amber-300">
            Awaiting result
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        <PlayerSide t={t} m={m} playerId={m.playerAId} won={aWon} />
        <div className="self-center text-slate-500">vs</div>
        {m.playerBId || isBye ? (
          isBye ? (
            <div className="flex-1 rounded-lg border border-dashed border-slate-700 px-4 py-3 text-center text-slate-500">
              — bye —
            </div>
          ) : (
            <PlayerSide t={t} m={m} playerId={m.playerBId} won={bWon} />
          )
        ) : (
          <div className="flex-1 rounded-lg border border-dashed border-slate-700 px-4 py-3 text-center text-slate-500">
            Awaiting opponent
          </div>
        )}
      </div>

      {(playable || (correctable && correcting)) && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button
            onClick={() => submit('PLAYER_A_WIN')}
            className="min-h-12 rounded-lg bg-emerald-700 px-3 py-3 text-base font-semibold hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {playerOf(t, m.playerAId)?.displayName ?? 'A'} wins
          </button>
          <button
            onClick={() => submit('DRAW')}
            className="min-h-12 rounded-lg bg-slate-700 px-3 py-3 text-base font-semibold hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Draw
          </button>
          <button
            onClick={() => submit('PLAYER_B_WIN')}
            className="min-h-12 rounded-lg bg-emerald-700 px-3 py-3 text-base font-semibold hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {playerOf(t, m.playerBId)?.displayName ?? 'B'} wins
          </button>
          <button
            onClick={() => submit('DOUBLE_LOSS')}
            className="min-h-12 rounded-lg border border-red-800 bg-red-950/40 px-2 py-3 text-sm font-medium text-red-300 hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Double loss
          </button>
        </div>
      )}

      {correctable && !correcting && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {m.correctedAt ? `Corrected ${new Date(m.correctedAt).toLocaleTimeString()}` : ''}
          </span>
          <button
            onClick={() => setCorrecting(true)}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Correct result
          </button>
        </div>
      )}
      {correcting && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-amber-400">
            Select the corrected result{risk ? ' — later results may be voided' : ''}
          </span>
          <button
            onClick={() => setCorrecting(false)}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      )}

      {pendingResult && (
        <ConfirmDialog
          title="Correct result?"
          body={risk!}
          confirmLabel="Correct anyway"
          danger
          onConfirm={() => apply(pendingResult)}
          onCancel={() => setPendingResult(null)}
        />
      )}
    </div>
  );
}
