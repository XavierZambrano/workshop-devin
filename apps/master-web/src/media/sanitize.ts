import { computeStandings, type Tournament } from '@tourney/engine';
import type { MediaMatchSnapshot, MediaPlayerSnapshot, MediaSnapshot } from './protocol';

export function toMediaSnapshot(t: Tournament): MediaSnapshot {
  const currentRound =
    t.rounds.find((round) => round.status === 'ACTIVE') ?? t.rounds[t.rounds.length - 1];
  const players: MediaPlayerSnapshot[] = t.players.map((player) => {
    const snapshot: MediaPlayerSnapshot = {
      id: player.id,
      displayName: player.displayName,
      status: player.status,
    };
    if (player.seed !== undefined) snapshot.seed = player.seed;
    return snapshot;
  });
  const matches: MediaMatchSnapshot[] = t.matches.map((match) => {
    const snapshot: MediaMatchSnapshot = {
      id: match.id,
      roundNumber: match.roundNumber,
      result: match.result,
      status: match.status,
    };
    if (match.playerAId !== undefined) snapshot.playerAId = match.playerAId;
    if (match.playerBId !== undefined) snapshot.playerBId = match.playerBId;
    return snapshot;
  });
  const standings = computeStandings(t).map((standing) => ({
    rank: standing.rank,
    playerId: standing.playerId,
    points: standing.matchPoints,
    record: `${standing.wins}-${standing.losses}-${standing.draws}`,
    matchWinPct: standing.matchWinPct,
    oppMatchWinPct: standing.oppMatchWinPct,
  }));

  return {
    name: t.name,
    format: t.format,
    status: t.status,
    currentRoundNumber: currentRound?.number ?? null,
    players,
    matches,
    standings,
    championId: t.championId ?? null,
  };
}
