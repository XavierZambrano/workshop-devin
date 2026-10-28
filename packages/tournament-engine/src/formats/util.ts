import type { Match, Player, Round, Tournament } from '../model/types';
import { newId, now } from '../model/util';
import { mulberry32, shuffled } from '../rng';

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Standard seeded bracket slot order. Returns an array of length `size`
 * where entry i is the seed number occupying first-round slot i.
 * Consecutive pairs are first-round matches: (1,8) (4,5) (2,7) (3,6) for size 8.
 */
export function seedSlotOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) next.push(s, n - s);
    order = next;
  }
  return order;
}

/** Display names for bracket rounds, ordered first → last. */
export function bracketRoundNames(bracketSize: number): string[] {
  const names: string[] = [];
  for (let size = bracketSize; size >= 2; size /= 2) {
    if (size === 2) names.push('Final');
    else if (size === 4) names.push('Semifinals');
    else if (size === 8) names.push('Quarterfinals');
    else names.push(`Round of ${size}`);
  }
  return names;
}

export function makeRound(number: number, name?: string): Round {
  return {
    id: newId('rnd'),
    number,
    name,
    status: 'PENDING',
    matchIds: [],
    createdAt: now(),
  };
}

export function makeMatch(partial: Partial<Match> & { roundId: string; roundNumber: number }): Match {
  return {
    id: newId('m'),
    result: 'PENDING',
    status: 'SCHEDULED',
    createdAt: now(),
    ...partial,
  };
}

/**
 * Assign 1-based seeds to all players according to the tournament's seeding
 * mode. Returns the players in seed order (mutates the passed-in players).
 */
export function assignSeeds(t: Tournament): Player[] {
  const players = [...t.players];
  const mode = t.settings.seedingMode;
  let ordered: Player[];
  if (mode === 'RANDOM') {
    ordered = shuffled(players, mulberry32(t.settings.randomSeed));
  } else if (mode === 'MANUAL') {
    // Sort by provided seed; unseeded players fill remaining positions in
    // registration order.
    ordered = [...players].sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER));
  } else {
    ordered = players; // registration order
  }
  return ordered.map((p, i) => {
    p.seed = i + 1;
    return p;
  });
}

/** The player who advances/won a completed match, if any. */
export function winnerOf(m: Match): string | undefined {
  if (m.result === 'PLAYER_A_WIN' || m.result === 'BYE') return m.playerAId;
  if (m.result === 'PLAYER_B_WIN') return m.playerBId;
  return undefined;
}
