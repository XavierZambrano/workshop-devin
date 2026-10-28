import type { Match, Tournament } from '../../model/types';
import { DomainError, ErrorCodes } from '../../model/errors';
import { makeEvent } from '../../model/util';
import type { TournamentFormatEngine } from '../../engine';
import { computeStandings } from '../../standings';
import { pairSwiss, type PairingCandidate } from '../../pairing/swiss';
import { assignSeeds, makeMatch, makeRound } from '../util';

/**
 * Swiss.
 *
 * - Fixed number of rounds (organizer-configurable before start, recommended
 *   default ceil(log2(N)) clamped to at least 2).
 * - Round 1 pairs top half vs bottom half of the seed order.
 * - Later rounds use pairSwiss(): score-group pairing with rematch avoidance,
 *   floating, and a single bye for odd counts given to the lowest-ranked
 *   player with the fewest byes.
 * - Dropped/disqualified players are excluded from pairings; their results
 *   and standings entries remain.
 */

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function activePlayers(t: Tournament) {
  return t.players.filter((p) => p.status === 'ACTIVE');
}

function resolved(m: Match): boolean {
  return m.status === 'COMPLETE' || m.status === 'VOID';
}

function lastRound(t: Tournament) {
  return t.rounds[t.rounds.length - 1];
}

function plannedRounds(t: Tournament): number {
  // start() always writes plannedRounds; the fallback covers imported data.
  return t.settings.plannedRounds ?? swissEngine.recommendedRoundCount!(t.players.length);
}

function playedPairs(t: Tournament): Set<string> {
  const set = new Set<string>();
  for (const m of t.matches) {
    if (m.status === 'VOID' || m.result === 'BYE' || m.result === 'PENDING') continue;
    if (m.playerAId && m.playerBId) set.add(pairKey(m.playerAId, m.playerBId));
  }
  return set;
}

function createRoundFromPairs(
  t: Tournament,
  pairs: Array<[string, string]>,
  byePlayerId: string | undefined,
): { round: ReturnType<typeof makeRound>; matches: Match[] } {
  const roundNumber = t.rounds.length + 1;
  const round = makeRound(roundNumber, `Round ${roundNumber}`);
  round.status = 'ACTIVE';
  const matches: Match[] = [];
  let table = 1;

  for (const [a, b] of pairs) {
    const m = makeMatch({
      roundId: round.id,
      roundNumber,
      playerAId: a,
      playerBId: b,
      tableNumber: table++,
      status: 'ACTIVE',
    });
    round.matchIds.push(m.id);
    matches.push(m);
  }

  if (byePlayerId) {
    const bye = makeMatch({
      roundId: round.id,
      roundNumber,
      playerAId: byePlayerId,
      result: 'BYE',
      status: 'COMPLETE',
      completedAt: new Date().toISOString(),
      tableNumber: table++,
    });
    round.matchIds.push(bye.id);
    matches.push(bye);
    const name = t.players.find((p) => p.id === byePlayerId)?.displayName ?? 'Unknown';
    t.events.push(
      makeEvent('MATCH_RESULT_RECORDED', `${name} receives a bye`, {
        matchId: bye.id,
        roundId: round.id,
        playerId: byePlayerId,
      }),
    );
  }

  return { round, matches };
}

/** Spec default: 2-4 -> 2, 5-8 -> 3, 9-16 -> 4, 17-32 -> 5. */
export function recommendedSwissRounds(playerCount: number): number {
  return Math.max(2, Math.ceil(Math.log2(Math.max(playerCount, 2))));
}

export const swissEngine: TournamentFormatEngine = {
  format: 'SWISS',
  minPlayers: 2,
  maxPlayers: 32,

  recommendedRoundCount: recommendedSwissRounds,

  start(t) {
    const seededPlayers = assignSeeds(t);
    const ordered = [...seededPlayers].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

    t.settings.plannedRounds =
      t.settings.plannedRounds ?? this.recommendedRoundCount!(ordered.length);

    const pairs: Array<[string, string]> = [];
    let byePlayerId: string | undefined;
    const pool = ordered.map((p) => p.id);
    if (pool.length % 2 === 1) byePlayerId = pool.pop();
    const half = pool.length / 2;
    for (let i = 0; i < half; i++) {
      pairs.push([pool[i]!, pool[i + half]!]);
    }
    const { round, matches } = createRoundFromPairs(t, pairs, byePlayerId);
    return { players: seededPlayers, rounds: [round], matches };
  },

  canGenerateNextRound(t) {
    if (t.status !== 'ACTIVE') {
      return { ok: false, reason: 'Tournament is not active.' };
    }
    const round = lastRound(t);
    if (!round) return { ok: false, reason: 'Tournament has not started.' };
    const pending = t.matches.filter(
      (m) => m.roundId === round.id && !resolved(m),
    ).length;
    if (pending > 0) {
      return {
        ok: false,
        pendingMatches: pending,
        reason: `${pending} match${pending === 1 ? '' : 'es'} still awaiting results`,
      };
    }
    if (t.rounds.length >= plannedRounds(t)) {
      return { ok: false, reason: 'All planned rounds have been played.' };
    }
    if (activePlayers(t).length < 2) {
      return { ok: false, reason: 'Fewer than 2 active players remain.' };
    }
    return { ok: true };
  },

  nextRound(t) {
    const check = this.canGenerateNextRound(t);
    if (!check.ok) {
      throw new DomainError(ErrorCodes.ROUND_INCOMPLETE, check.reason ?? 'Cannot generate round');
    }

    const standings = computeStandings(t);
    const rankOf = new Map(standings.map((s) => [s.playerId, s.rank]));
    const byeCount = new Map(standings.map((s) => [s.playerId, s.byes]));
    const points = new Map(standings.map((s) => [s.playerId, s.matchPoints]));

    const candidates: PairingCandidate[] = activePlayers(t).map((p) => ({
      playerId: p.id,
      matchPoints: points.get(p.id) ?? 0,
      byeCount: byeCount.get(p.id) ?? 0,
      order: rankOf.get(p.id) ?? Number.MAX_SAFE_INTEGER,
    }));

    const { pairs, byePlayerId } = pairSwiss(candidates, playedPairs(t));
    return createRoundFromPairs(t, pairs, byePlayerId);
  },

  afterResultRecorded(t) {
    const round = lastRound(t);
    if (!round) return;
    const allDone = t.matches.filter((m) => m.roundId === round.id).every(resolved);
    if (allDone && t.rounds.length >= plannedRounds(t) && t.status === 'ACTIVE') {
      const standings = computeStandings(t);
      const champion = standings[0];
      t.status = 'COMPLETE';
      t.championId = champion?.playerId;
      const name = t.players.find((p) => p.id === champion?.playerId)?.displayName ?? 'Unknown';
      t.events.push(
        makeEvent('TOURNAMENT_COMPLETED', `${name} finishes first in the standings`, {
          playerId: champion?.playerId,
        }),
      );
    }
  },

  afterResultCorrected(t) {
    // If the tournament had already finished, re-evaluate the champion from
    // corrected standings.
    if (t.status === 'COMPLETE') {
      const top = computeStandings(t)[0];
      t.championId = top?.playerId;
    }
  },

  afterPlayerRemoved() {
    // Future pairings exclude non-active players automatically.
  },

  isComplete(t) {
    const round = lastRound(t);
    if (!round || t.rounds.length < plannedRounds(t)) return false;
    return t.matches.filter((m) => m.roundId === round.id).every(resolved);
  },
};
