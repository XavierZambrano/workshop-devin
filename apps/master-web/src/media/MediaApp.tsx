import { useEffect, useState } from 'react';
import { createMediaSubscriber } from './subscriber';
import type { MediaMatchSnapshot, MediaSnapshot, MediaStandingSnapshot } from './protocol';

type Scene = 'standings' | 'round' | 'bracket';
const ROWS_PER_COLUMN = 16;
const STANDING_COLUMNS =
  '2rem minmax(0, 2fr) minmax(2.8rem, 0.9fr) repeat(3, minmax(2.5rem, 0.8fr))';

function playerName(snapshot: MediaSnapshot, id?: string): string {
  return snapshot.players.find((player) => player.id === id)?.displayName ?? 'TBD';
}

function matchResult(match: MediaMatchSnapshot, snapshot: MediaSnapshot): string {
  const playerA = playerName(snapshot, match.playerAId);
  const playerB = playerName(snapshot, match.playerBId);
  switch (match.result) {
    case 'PLAYER_A_WIN':
      return `${playerA} wins`;
    case 'PLAYER_B_WIN':
      return `${playerB} wins`;
    case 'DRAW':
      return 'Draw';
    case 'DOUBLE_LOSS':
      return 'Double loss';
    case 'BYE':
      return `${playerA} receives a bye`;
    default:
      return match.status === 'COMPLETE' ? 'Complete' : 'Awaiting result';
  }
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'DROPPED' | 'DISQUALIFIED' }) {
  if (status === 'ACTIVE') return null;
  const dropped = status === 'DROPPED';
  return (
    <span
      className={`ml-1 whitespace-nowrap rounded border px-1 py-0 text-[clamp(0.5rem,1.05vh,0.75rem)] font-bold uppercase leading-none ${
        dropped
          ? 'border-amber-700 bg-amber-950 text-amber-300'
          : 'border-red-700 bg-red-950 text-red-300'
      }`}
    >
      {dropped ? 'Dropped' : 'Disqualified'}
    </span>
  );
}

function StandingColumn({
  standings,
  snapshot,
  rowsPerColumn,
}: {
  standings: MediaStandingSnapshot[];
  snapshot: MediaSnapshot;
  rowsPerColumn: number;
}) {
  const playerById = new Map(snapshot.players.map((player) => [player.id, player]));
  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80">
      <div
        className="grid items-center gap-2 bg-slate-800 px-2 py-1 uppercase tracking-wide text-slate-400"
        style={{
          gridTemplateColumns: STANDING_COLUMNS,
          fontSize: 'clamp(0.55rem, 1.3vh, 0.8rem)',
          lineHeight: 1,
        }}
      >
        <span>Rank</span>
        <span>Player</span>
        <span>Record</span>
        <span>Pts</span>
        <span>Win%</span>
        <span>Opp%</span>
      </div>
      <div
        className="grid min-h-0 divide-y divide-slate-800"
        style={{ gridTemplateRows: `repeat(${rowsPerColumn}, minmax(0, 1fr))` }}
      >
        {standings.map((standing) => {
          const player = playerById.get(standing.playerId);
          return (
            <div
              key={standing.playerId}
              className="grid min-h-0 min-w-0 items-center gap-2 overflow-hidden px-2 py-0.5 font-mono"
              style={{
                gridTemplateColumns: STANDING_COLUMNS,
                fontSize: 'clamp(0.7rem, 2.1vh, 1.6rem)',
                lineHeight: 1.1,
              }}
            >
              <span className="truncate text-slate-400">{standing.rank}</span>
              <span className="min-w-0 truncate font-sans font-semibold">
                {player?.displayName ?? 'Unknown'}
                {player && <StatusBadge status={player.status} />}
              </span>
              <span className="truncate text-slate-300">{standing.record}</span>
              <span className="truncate font-bold">{standing.points}</span>
              <span className="truncate">{(standing.matchWinPct * 100).toFixed(0)}%</span>
              <span className="truncate">{(standing.oppMatchWinPct * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StandingsScene({ snapshot }: { snapshot: MediaSnapshot }) {
  const firstPage = snapshot.standings.slice(0, 16);
  const secondPage = snapshot.standings.slice(16, 32);
  const rowsPerColumn = Math.min(ROWS_PER_COLUMN, Math.max(1, snapshot.standings.length));
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-2">
      <StandingColumn
        standings={firstPage}
        snapshot={snapshot}
        rowsPerColumn={rowsPerColumn}
      />
      {secondPage.length > 0 && (
        <StandingColumn
          standings={secondPage}
          snapshot={snapshot}
          rowsPerColumn={rowsPerColumn}
        />
      )}
    </div>
  );
}

function MatchCard({
  match,
  snapshot,
  compact = false,
}: {
  match: MediaMatchSnapshot;
  snapshot: MediaSnapshot;
  compact?: boolean;
}) {
  const paddingClass = compact ? 'p-1' : 'px-3 py-2';
  return (
    <div
      className={`flex min-h-0 flex-col justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80 ${paddingClass}`}
    >
      <div
        className="flex min-w-0 items-center justify-between gap-2 font-semibold"
        style={{
          fontSize: compact
            ? 'clamp(0.65rem, 1.3vh, 1rem)'
            : 'clamp(0.75rem, 1.8vh, 1.4rem)',
          lineHeight: 1.1,
        }}
      >
        <span className="min-w-0 flex-1 truncate">{playerName(snapshot, match.playerAId)}</span>
        <span className="shrink-0 text-slate-600" style={{ fontSize: '0.7em' }}>
          vs
        </span>
        <span className="min-w-0 flex-1 truncate text-right">
          {playerName(snapshot, match.playerBId)}
        </span>
      </div>
      <div
        className={`${compact ? 'mt-0.5' : 'mt-1'} flex min-w-0 items-center justify-between gap-2 text-slate-300`}
        style={{
          fontSize: compact
            ? 'clamp(0.6rem, 1.1vh, 0.8rem)'
            : 'clamp(0.65rem, 1.3vh, 0.9rem)',
          lineHeight: 1.1,
        }}
      >
        <span className="min-w-0 flex-1 truncate">{matchResult(match, snapshot)}</span>
        <span className="shrink-0 uppercase tracking-wide text-slate-500">{match.status}</span>
      </div>
    </div>
  );
}

function RoundScene({ snapshot }: { snapshot: MediaSnapshot }) {
  const matches = snapshot.matches.filter(
    (match) => match.roundNumber === snapshot.currentRoundNumber,
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <h2 className="mb-2 shrink-0 text-xl font-bold sm:text-2xl">
        {snapshot.currentRoundNumber === null
          ? 'No current round'
          : `Round ${snapshot.currentRoundNumber}`}
      </h2>
      {matches.length === 0 ? (
        <p className="text-2xl text-slate-400">No matches to display.</p>
      ) : (
        <div
          className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden"
          style={{ gridTemplateRows: `repeat(${Math.ceil(matches.length / 2)}, minmax(0, 1fr))` }}
        >
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} snapshot={snapshot} />
          ))}
        </div>
      )}
    </section>
  );
}

function BracketScene({ snapshot }: { snapshot: MediaSnapshot }) {
  const roundNumbers = [...new Set(snapshot.matches.map((match) => match.roundNumber))].sort(
    (a, b) => a - b,
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <h2 className="mb-2 shrink-0 text-xl font-bold sm:text-2xl">Bracket</h2>
      {roundNumbers.length === 0 ? (
        <p className="text-2xl text-slate-400">No bracket matches to display.</p>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2 overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${roundNumbers.length}, minmax(0, 1fr))` }}
        >
          {roundNumbers.map((roundNumber) => {
            const matches = snapshot.matches.filter((match) => match.roundNumber === roundNumber);
            return (
              <div key={roundNumber} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                <h3
                  className="shrink-0 py-1 text-center font-semibold uppercase tracking-wide text-slate-400"
                  style={{ fontSize: 'clamp(0.6rem, 1.3vh, 0.9rem)' }}
                >
                  Round {roundNumber}
                </h3>
                <div
                  className="grid min-h-0 flex-1 gap-1 overflow-hidden"
                  style={{
                    gridTemplateRows: `repeat(${matches.length}, minmax(0, 1fr))`,
                  }}
                >
                  {matches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      snapshot={snapshot}
                      compact
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function MediaApp() {
  const [snapshot, setSnapshot] = useState<MediaSnapshot | null>(null);
  const sceneCount = snapshot?.format === 'SINGLE_ELIMINATION' ? 3 : 2;
  const scenes: Scene[] =
    snapshot?.format === 'SINGLE_ELIMINATION'
      ? ['standings', 'round', 'bracket']
      : ['standings', 'round'];
  const [sceneIndex, setSceneIndex] = useState(0);

  useEffect(() => {
    const subscriber = createMediaSubscriber(setSnapshot);
    return () => subscriber.dispose();
  }, []);

  useEffect(() => {
    setSceneIndex(0);
    const interval = window.setInterval(() => {
      setSceneIndex((index) => (index + 1) % sceneCount);
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [sceneCount]);

  if (!snapshot) {
    return (
      <main className="flex h-screen items-center justify-center overflow-hidden bg-slate-950 p-8 text-center text-slate-100">
        <p className="text-4xl font-semibold md:text-6xl">Waiting for the control panel…</p>
      </main>
    );
  }

  const scene = scenes[sceneIndex % scenes.length]!;
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2 md:px-6 md:py-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold sm:text-2xl md:text-3xl">
            {snapshot.name}
          </h1>
          <p className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-400 sm:text-xs">
            {snapshot.format.replaceAll('_', ' ')} · {snapshot.status}
          </p>
        </div>
        <div className="flex gap-1 text-[10px] uppercase tracking-wide text-slate-400 sm:gap-2 sm:text-xs">
          {scenes.map((name, index) => (
            <span
              key={name}
              className={`rounded-md px-2 py-1 ${sceneIndex % scenes.length === index ? 'bg-sky-900 text-sky-200' : 'bg-slate-800'}`}
            >
              {name}
            </span>
          ))}
        </div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col overflow-hidden px-2 py-2 sm:px-3 sm:py-3">
        {scene === 'standings' ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <h2 className="mb-2 shrink-0 text-xl font-bold sm:text-2xl">Standings</h2>
            <StandingsScene snapshot={snapshot} />
          </section>
        ) : scene === 'round' ? (
          <RoundScene snapshot={snapshot} />
        ) : (
          <BracketScene snapshot={snapshot} />
        )}
        {snapshot.championId && (
          <div className="mt-2 shrink-0 rounded-xl border border-emerald-700 bg-emerald-950/50 px-3 py-2 text-base font-bold text-emerald-200">
            Champion: {playerName(snapshot, snapshot.championId)}
          </div>
        )}
      </div>
    </main>
  );
}
