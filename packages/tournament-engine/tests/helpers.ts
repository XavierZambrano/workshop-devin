import type { Match, Tournament, TournamentFormat } from '../src/model/types';
import {
  addPlayer,
  createTournament,
  startTournament,
  recordResult,
} from '../src/operations';

export function makeTournament(
  format: TournamentFormat,
  playerNames: string[],
  opts: { seedingMode?: 'RANDOM' | 'REGISTRATION_ORDER' | 'MANUAL'; plannedRounds?: number; randomSeed?: number } = {},
): Tournament {
  let t = createTournament({
    name: 'Test Event',
    format,
    seedingMode: opts.seedingMode ?? 'REGISTRATION_ORDER',
    plannedRounds: opts.plannedRounds,
    randomSeed: opts.randomSeed ?? 42,
  });
  for (const n of playerNames) t = addPlayer(t, n);
  return t;
}

export function startedTournament(
  format: TournamentFormat,
  playerNames: string[],
  opts: Parameters<typeof makeTournament>[2] = {},
): Tournament {
  return startTournament(makeTournament(format, playerNames, opts));
}

export function names(n: number, prefix = 'P'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

export function matchesOf(t: Tournament, roundNumber: number): Match[] {
  return t.matches.filter((m) => m.roundNumber === roundNumber);
}

export function playable(t: Tournament): Match[] {
  return t.matches.filter(
    (m) => (m.status === 'ACTIVE' || m.status === 'SCHEDULED') && m.playerAId && m.playerBId,
  );
}

/** Record a result choosing PLAYER_A_WIN unless told otherwise. */
export function play(
  t: Tournament,
  matchId: string,
  result: 'PLAYER_A_WIN' | 'PLAYER_B_WIN' | 'DRAW' | 'DOUBLE_LOSS' = 'PLAYER_A_WIN',
): Tournament {
  return recordResult(t, matchId, result);
}

/** Play every currently-playable match with player A winning. */
export function playAll(t: Tournament): Tournament {
  for (const m of playable(t)) t = play(t, m.id);
  return t;
}

export function playerByName(t: Tournament, name: string) {
  return t.players.find((p) => p.displayName === name);
}
