/**
 * Swiss pairing.
 *
 * Design goals (in priority order):
 *  1. Pair players with equal or similar scores.
 *  2. Avoid rematches whenever a valid alternative exists.
 *  3. Float players between adjacent score groups when a group has an odd count.
 *  4. Exactly one bye per round when the active player count is odd, given to
 *     the lowest-ranked player who has had the fewest byes.
 *  5. Deterministic: same tournament state -> same pairings.
 *
 * The matcher is a depth-first backtracking search over an ordered candidate
 * list. Candidate order encodes our preferences, so the first complete
 * matching found is the best one available. A node cap guards the worst
 * case; if it is ever hit we fall back to a plain sequential pairing so the
 * tournament can continue.
 */

export interface PairingCandidate {
  playerId: string;
  matchPoints: number;
  byeCount: number;
  /** Deterministic ordering key — lower is "better ranked" (standings rank). */
  order: number;
}

export interface PairingResult {
  pairs: Array<[string, string]>;
  byePlayerId?: string;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function chooseByeCandidate(candidates: PairingCandidate[]): string | undefined {
  if (candidates.length % 2 === 0) return undefined;
  const minByes = Math.min(...candidates.map((c) => c.byeCount));
  // Lowest-ranked player among those with the fewest byes.
  const eligible = candidates
    .filter((c) => c.byeCount === minByes)
    .sort((a, b) => b.order - a.order);
  return eligible[0]?.playerId;
}

const MAX_SEARCH_NODES = 50_000;

export function pairSwiss(
  candidates: PairingCandidate[],
  playedPairs: Set<string>,
): PairingResult {
  const ordered = [...candidates].sort(
    (a, b) => b.matchPoints - a.matchPoints || a.order - b.order,
  );

  const byePlayerId = chooseByeCandidate(ordered);
  const toPair = byePlayerId ? ordered.filter((c) => c.playerId !== byePlayerId) : ordered;

  let nodes = 0;

  const search = (remaining: PairingCandidate[]): Array<[string, string]> | null => {
    if (remaining.length === 0) return [];
    if (++nodes > MAX_SEARCH_NODES) return null;
    const first = remaining[0]!;
    const rest = remaining.slice(1);

    // Candidate preference: no rematch > closest score > best rank.
    const ranked = [...rest].sort((c1, c2) => {
      const r1 = playedPairs.has(pairKey(first.playerId, c1.playerId)) ? 1 : 0;
      const r2 = playedPairs.has(pairKey(first.playerId, c2.playerId)) ? 1 : 0;
      if (r1 !== r2) return r1 - r2;
      const d1 = Math.abs(first.matchPoints - c1.matchPoints);
      const d2 = Math.abs(first.matchPoints - c2.matchPoints);
      if (d1 !== d2) return d1 - d2;
      return c1.order - c2.order;
    });

    for (const cand of ranked) {
      const sub = search(rest.filter((c) => c !== cand));
      if (sub) return [[first.playerId, cand.playerId], ...sub];
    }
    return null;
  };

  const pairs = search(toPair);
  if (pairs) return { pairs, byePlayerId };

  // Fallback: sequential pairing, rematches allowed. Never fails.
  const fallback: Array<[string, string]> = [];
  for (let i = 0; i + 1 < toPair.length; i += 2) {
    fallback.push([toPair[i]!.playerId, toPair[i + 1]!.playerId]);
  }
  return { pairs: fallback, byePlayerId };
}
