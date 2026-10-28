import type { Match, Tournament } from '@tourney/engine';
import { winnerOf } from '@tourney/engine';
import { isEliminated, playerOf } from '../helpers';

function BracketSlot({
  t,
  m,
  playerId,
  isA,
}: {
  t: Tournament;
  m: Match;
  playerId?: string;
  isA: boolean;
}) {
  const p = playerOf(t, playerId);
  const won = winnerOf(m) === playerId && m.result !== 'PENDING';
  const lost =
    m.status === 'COMPLETE' &&
    playerId &&
    ((m.result === 'PLAYER_A_WIN' && !isA) ||
      (m.result === 'PLAYER_B_WIN' && isA) ||
      m.result === 'DOUBLE_LOSS');
  const eliminated = playerId ? isEliminated(t, playerId) && !won : false;

  return (
    <div
      className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
        won
          ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200'
          : eliminated || lost
            ? 'border-slate-800 bg-slate-900/50 text-slate-500 line-through'
            : 'border-slate-700 bg-slate-900 text-slate-200'
      }`}
    >
      <span className="truncate">
        {p ? (
          <>
            {p.seed !== undefined && (
              <span className="mr-1.5 font-mono text-xs text-slate-500">#{p.seed}</span>
            )}
            {p.displayName}
          </>
        ) : (
          <span className="text-slate-600">TBD</span>
        )}
      </span>
      {p && p.status === 'DISQUALIFIED' && (
        <span className="ml-1 text-[10px] font-bold text-red-400">DQ</span>
      )}
      {p && p.status === 'DROPPED' && (
        <span className="ml-1 text-[10px] font-bold text-amber-400">DROP</span>
      )}
    </div>
  );
}

function BracketMatch({ t, m }: { t: Tournament; m: Match }) {
  const isBye = m.result === 'BYE';
  return (
    <div
      className={`flex w-56 flex-col gap-1 rounded-lg border p-2 ${
        m.status === 'COMPLETE' ? 'border-slate-700' : 'border-slate-600'
      } ${isBye ? 'opacity-70' : ''}`}
    >
      <BracketSlot t={t} m={m} playerId={m.playerAId} isA />
      {isBye ? (
        <div className="rounded border border-dashed border-slate-700 px-3 py-2 text-center text-xs text-slate-500">
          bye
        </div>
      ) : (
        <BracketSlot t={t} m={m} playerId={m.playerBId} isA={false} />
      )}
    </div>
  );
}

export function BracketView({ t }: { t: Tournament }) {
  if (t.format !== 'SINGLE_ELIMINATION' || t.rounds.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-400">
        The bracket is available once a single-elimination tournament has started.
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Bracket</h1>
      <div className="overflow-x-auto pb-4">
        <div className="flex min-w-max items-stretch gap-6">
          {t.rounds.map((r) => (
            <div key={r.id} className="flex flex-col">
              <div className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-slate-400">
                {r.name ?? `Round ${r.number}`}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-3">
                {r.matchIds.map((id) => {
                  const m = t.matches.find((x) => x.id === id)!;
                  return <BracketMatch key={id} t={t} m={m} />;
                })}
              </div>
            </div>
          ))}
          {t.championId && (
            <div className="flex flex-col justify-center">
              <div className="rounded-xl border border-emerald-600 bg-emerald-950/50 p-4 text-center">
                <div className="text-xs uppercase tracking-widest text-emerald-400">Champion</div>
                <div className="mt-1 text-xl font-bold text-emerald-200">
                  {playerOf(t, t.championId)?.displayName}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Struck-through names are eliminated, dropped, or disqualified. BYEs advance automatically.
      </p>
    </div>
  );
}
