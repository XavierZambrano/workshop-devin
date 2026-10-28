import type { Match, Tournament } from '../../model/types';
import { DomainError, ErrorCodes } from '../../model/errors';
import { makeEvent } from '../../model/util';
import type { TournamentFormatEngine } from '../../engine';
import {
  assignSeeds,
  bracketRoundNames,
  makeMatch,
  makeRound,
  nextPow2,
  seedSlotOrder,
  winnerOf,
} from '../util';

/**
 * Single Elimination.
 *
 * - Bracket size is the next power of two >= player count (2..32 players).
 * - Top seeds receive byes when the bracket is not full.
 * - The full bracket (all rounds) is generated at start; feeder slots are
 *   filled as results arrive.
 * - Correcting a result retracts the wrongly-advanced player downstream;
 *   dependent completed matches are voided (audited) so the organizer can
 *   re-enter results. History is never silently rewritten.
 */

function findMatch(t: Tournament, id: string): Match {
  const m = t.matches.find((x) => x.id === id);
  if (!m) throw new DomainError(ErrorCodes.MATCH_NOT_FOUND, `Match ${id} not found`);
  return m;
}

function matchLabel(t: Tournament, m: Match): string {
  const name = (id?: string) => t.players.find((p) => p.id === id)?.displayName ?? 'TBD';
  return `${name(m.playerAId)} vs ${name(m.playerBId)}`;
}

function isResolved(m: Match): boolean {
  return m.status === 'COMPLETE' || m.status === 'VOID';
}

/**
 * After a feeder slot changes, check whether a waiting match can now be
 * resolved automatically (auto-bye / void when no players remain) or is
 * ready to play.
 */
function settleMatch(t: Tournament, m: Match): void {
  if (isResolved(m)) return;
  const feeders = t.matches.filter((x) => x.nextMatchId === m.id);
  const allFeedersResolved = feeders.every(isResolved);
  const hasA = !!m.playerAId;
  const hasB = !!m.playerBId;

  if (hasA && hasB) {
    m.status = 'ACTIVE';
    return;
  }
  if (!allFeedersResolved) {
    m.status = 'SCHEDULED';
    return;
  }
  if (hasA !== hasB) {
    // Only one player can ever reach this match: automatic bye.
    m.result = 'BYE';
    m.status = 'COMPLETE';
    m.completedAt = new Date().toISOString();
    t.events.push(
      makeEvent('MATCH_RESULT_RECORDED', `${matchLabel(t, m)} — bye advances automatically`, {
        matchId: m.id,
        roundId: m.roundId,
      }),
    );
    propagate(t, m);
  } else {
    // No player can reach this match at all.
    m.result = 'PENDING';
    m.status = 'VOID';
    m.completedAt = new Date().toISOString();
    t.events.push(
      makeEvent('MATCH_VOIDED', `${matchLabel(t, m)} — no players remain; match voided`, {
        matchId: m.id,
        roundId: m.roundId,
      }),
    );
    propagate(t, m);
  }
}

/** Push a completed match's winner into the next bracket slot. */
function propagate(t: Tournament, m: Match): void {
  const winner = winnerOf(m);
  if (!m.nextMatchId) {
    // This was the final.
    if (winner) {
      t.championId = winner;
      t.status = 'COMPLETE';
      const name = t.players.find((p) => p.id === winner)?.displayName ?? 'Unknown';
      t.events.push(
        makeEvent('TOURNAMENT_COMPLETED', `${name} wins the tournament`, {
          playerId: winner,
          matchId: m.id,
        }),
      );
    }
    return;
  }
  const next = findMatch(t, m.nextMatchId);
  if (m.nextSlot === 'A') next.playerAId = winner;
  else next.playerBId = winner;
  // A previously voided match becomes playable again once it has players.
  if (next.status === 'VOID' && (next.playerAId || next.playerBId)) {
    next.status = 'SCHEDULED';
    next.result = 'PENDING';
    delete next.completedAt;
  }
  settleMatch(t, next);
}

/**
 * Remove this match's contribution downstream. Completed downstream matches
 * are voided (with audit events) and the retraction cascades further.
 */
function retract(t: Tournament, m: Match): void {
  if (!m.nextMatchId) {
    // Retracting the final means no champion for now.
    if (t.championId) {
      t.championId = undefined;
      t.status = 'ACTIVE';
    }
    return;
  }
  const next = findMatch(t, m.nextMatchId);
  if (m.nextSlot === 'A') next.playerAId = undefined;
  else next.playerBId = undefined;

  if (next.status === 'COMPLETE' || next.result !== 'PENDING') {
    next.status = 'VOID';
    next.result = 'PENDING';
    t.events.push(
      makeEvent(
        'MATCH_VOIDED',
        `${matchLabel(t, m)} downstream match voided after result correction`,
        { matchId: next.id, roundId: next.roundId },
      ),
    );
    retract(t, next);
  } else {
    next.status = 'SCHEDULED';
    // The voided sibling may still leave next resolvable; re-settle is done
    // by the new propagate() call in afterResultCorrected.
  }
}

export const singleEliminationEngine: TournamentFormatEngine = {
  format: 'SINGLE_ELIMINATION',
  minPlayers: 2,
  maxPlayers: 32,

  start(t) {
    const seededPlayers = assignSeeds(t);
    const bracketSize = nextPow2(Math.max(t.players.length, 2));
    const names = bracketRoundNames(bracketSize);
    const slots = seedSlotOrder(bracketSize); // seed number per first-round slot
    const bySeed = new Map(seededPlayers.map((p) => [p.seed!, p]));

    const rounds = names.map((name, i) => makeRound(i + 1, name));
    const matches: Match[] = [];

    // Round 1 pairings.
    const firstRound = rounds[0]!;
    for (let i = 0; i < slots.length; i += 2) {
      const a = bySeed.get(slots[i]!);
      const b = bySeed.get(slots[i + 1]!);
      const match = makeMatch({
        roundId: firstRound.id,
        roundNumber: 1,
        playerAId: a?.id,
        playerBId: b?.id,
        tableNumber: i / 2 + 1,
      });
      firstRound.matchIds.push(match.id);
      matches.push(match);
    }

    // Later rounds, fully wired.
    for (let r = 1; r < rounds.length; r++) {
      const prev = matches.filter((m) => m.roundNumber === r);
      const round = rounds[r]!;
      const count = Math.max(prev.length / 2, 1);
      for (let i = 0; i < count; i++) {
        const match = makeMatch({ roundId: round.id, roundNumber: r + 1, tableNumber: i + 1 });
        round.matchIds.push(match.id);
        const f1 = prev[i * 2]!;
        const f2 = prev[i * 2 + 1]!;
        f1.nextMatchId = match.id;
        f1.nextSlot = 'A';
        f2.nextMatchId = match.id;
        f2.nextSlot = 'B';
        matches.push(match);
      }
    }

    return { players: seededPlayers, rounds, matches };
  },

  afterStart(t) {
    // Resolve byes in round 1 and propagate automatic advancement.
    const roundOne = t.rounds[0];
    if (!roundOne) return;
    for (const id of roundOne.matchIds) {
      const m = findMatch(t, id);
      if (m.status !== 'SCHEDULED') continue;
      if (m.playerAId && m.playerBId) {
        m.status = 'ACTIVE';
      } else if (m.playerAId || m.playerBId) {
        m.result = 'BYE';
        m.status = 'COMPLETE';
        m.completedAt = new Date().toISOString();
        t.events.push(
          makeEvent('MATCH_RESULT_RECORDED', `${matchLabel(t, m)} — bye`, {
            matchId: m.id,
            roundId: m.roundId,
          }),
        );
        propagate(t, m);
      }
    }
  },

  canGenerateNextRound() {
    return {
      ok: false,
      reason: 'Single elimination advances automatically when results are recorded.',
    };
  },

  afterResultRecorded(t, match) {
    propagate(t, match);
  },

  afterResultCorrected(t, match) {
    retract(t, match);
    propagate(t, match);
    // A downstream match left with exactly one resolved player may now be an
    // automatic bye (or void); settle every non-final waiting match.
    for (const m of t.matches) {
      if (m.status === 'SCHEDULED' || m.status === 'ACTIVE') settleMatch(t, m);
    }
  },

  afterPlayerRemoved(t, player) {
    // Any pending match containing this player becomes a walkover for the
    // remaining player (or a void if nobody remains).
    for (const m of t.matches) {
      if (isResolved(m)) continue;
      const inA = m.playerAId === player.id;
      const inB = m.playerBId === player.id;
      if (!inA && !inB) continue;
      const opponent = inA ? m.playerBId : m.playerAId;
      if (opponent) {
        m.result = inA ? 'PLAYER_B_WIN' : 'PLAYER_A_WIN';
        m.status = 'COMPLETE';
        m.completedAt = new Date().toISOString();
        t.events.push(
          makeEvent(
            'MATCH_RESULT_RECORDED',
            `${matchLabel(t, m)} — walkover (${player.displayName} ${
              player.status === 'DISQUALIFIED' ? 'disqualified' : 'dropped'
            })`,
            { matchId: m.id, roundId: m.roundId, playerId: player.id },
            { automatic: true },
          ),
        );
        propagate(t, m);
      } else {
        if (inA) m.playerAId = undefined;
        if (inB) m.playerBId = undefined;
        settleMatch(t, m);
      }
    }
  },

  isComplete(t) {
    const finalRound = t.rounds[t.rounds.length - 1];
    if (!finalRound) return false;
    const final = t.matches.find((m) => m.roundId === finalRound.id);
    return !!final && isResolved(final) && !!winnerOf(final);
  },
};
