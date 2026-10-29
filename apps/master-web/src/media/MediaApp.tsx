import { useEffect, useState } from 'react';
import { createMediaSubscriber } from './subscriber';
import type { MediaMatchSnapshot, MediaSnapshot, MediaStandingSnapshot } from './protocol';

type Scene = 'standings' | 'round' | 'bracket';

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
      className={`ml-2 rounded border px-2 py-0.5 text-xs font-bold uppercase ${
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
}: {
  standings: MediaStandingSnapshot[];
  snapshot: MediaSnapshot;
}) {
  const playerById = new Map(snapshot.players.map((player) => [player.id, player]));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80">
      <table className="w-full text-left">
        <thead className="bg-slate-800 text-sm uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-3">Rank</th>
            <th className="px-3 py-3">Player</th>
            <th className="px-3 py-3">Record</th>
            <th className="px-3 py-3">Pts</th>
            <th className="px-3 py-3">Win%</th>
            <th className="px-3 py-3">Opp%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {standings.map((standing) => {
            const player = playerById.get(standing.playerId);
            return (
              <tr key={standing.playerId} className="text-xl xl:text-2xl">
                <td className="px-3 py-3 font-mono text-slate-400">{standing.rank}</td>
                <td className="px-3 py-3 font-semibold">
                  {player?.displayName ?? 'Unknown'}
                  {player && <StatusBadge status={player.status} />}
                </td>
                <td className="px-3 py-3 font-mono text-slate-300">{standing.record}</td>
                <td className="px-3 py-3 font-mono font-bold">{standing.points}</td>
                <td className="px-3 py-3 font-mono">{(standing.matchWinPct * 100).toFixed(0)}%</td>
                <td className="px-3 py-3 font-mono">{(standing.oppMatchWinPct * 100).toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StandingsScene({ snapshot }: { snapshot: MediaSnapshot }) {
  const firstPage = snapshot.standings.slice(0, 16);
  const secondPage = snapshot.standings.slice(16, 32);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <StandingColumn standings={firstPage} snapshot={snapshot} />
      {secondPage.length > 0 && <StandingColumn standings={secondPage} snapshot={snapshot} />}
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
  const baseClass = compact ? 'p-3' : 'p-6';
  const playerClass = compact ? 'text-xl' : 'text-3xl md:text-5xl';
  return (
    <div className={`rounded-2xl border border-slate-700 bg-slate-900/80 ${baseClass}`}>
      <div className={`flex items-center justify-between gap-4 font-semibold ${playerClass}`}>
        <span className="min-w-0 flex-1 truncate">{playerName(snapshot, match.playerAId)}</span>
        <span className="text-slate-600">vs</span>
        <span className="min-w-0 flex-1 truncate text-right">
          {playerName(snapshot, match.playerBId)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-lg text-slate-300">
        <span>{matchResult(match, snapshot)}</span>
        <span className="shrink-0 text-sm uppercase tracking-wide text-slate-500">{match.status}</span>
      </div>
    </div>
  );
}

function RoundScene({ snapshot }: { snapshot: MediaSnapshot }) {
  const matches = snapshot.matches.filter(
    (match) => match.roundNumber === snapshot.currentRoundNumber,
  );
  return (
    <section>
      <h2 className="mb-6 text-3xl font-bold md:text-5xl">
        {snapshot.currentRoundNumber === null
          ? 'No current round'
          : `Round ${snapshot.currentRoundNumber}`}
      </h2>
      {matches.length === 0 ? (
        <p className="text-2xl text-slate-400">No matches to display.</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
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
    <section>
      <h2 className="mb-6 text-3xl font-bold md:text-5xl">Bracket</h2>
      {roundNumbers.length === 0 ? (
        <p className="text-2xl text-slate-400">No bracket matches to display.</p>
      ) : (
        <div className="flex gap-5 overflow-x-auto pb-4">
          {roundNumbers.map((roundNumber) => (
            <div key={roundNumber} className="w-[min(34rem,85vw)] shrink-0 space-y-4">
              <h3 className="text-center text-xl font-semibold uppercase tracking-wide text-slate-400">
                Round {roundNumber}
              </h3>
              {snapshot.matches
                .filter((match) => match.roundNumber === roundNumber)
                .map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    snapshot={snapshot}
                    compact
                  />
                ))}
            </div>
          ))}
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
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-center text-slate-100">
        <p className="text-4xl font-semibold md:text-6xl">Waiting for the control panel…</p>
      </main>
    );
  }

  const scene = scenes[sceneIndex % scenes.length]!;
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900 px-6 py-4 md:px-10">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold md:text-4xl">{snapshot.name}</h1>
          <p className="mt-1 text-sm uppercase tracking-widest text-slate-400">
            {snapshot.format.replaceAll('_', ' ')} · {snapshot.status}
          </p>
        </div>
        <div className="flex gap-2 text-sm uppercase tracking-wide text-slate-400">
          {scenes.map((name, index) => (
            <span
              key={name}
              className={`rounded-lg px-3 py-2 ${sceneIndex % scenes.length === index ? 'bg-sky-900 text-sky-200' : 'bg-slate-800'}`}
            >
              {name}
            </span>
          ))}
        </div>
      </header>
      <div className="mx-auto max-w-[1800px] p-5 md:p-10">
        {scene === 'standings' ? (
          <section>
            <h2 className="mb-6 text-3xl font-bold md:text-5xl">Standings</h2>
            <StandingsScene snapshot={snapshot} />
          </section>
        ) : scene === 'round' ? (
          <RoundScene snapshot={snapshot} />
        ) : (
          <BracketScene snapshot={snapshot} />
        )}
        {snapshot.championId && (
          <div className="mt-6 rounded-2xl border border-emerald-700 bg-emerald-950/50 p-4 text-xl font-bold text-emerald-200">
            Champion: {playerName(snapshot, snapshot.championId)}
          </div>
        )}
      </div>
    </main>
  );
}
