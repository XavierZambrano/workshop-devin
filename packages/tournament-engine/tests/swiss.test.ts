import { describe, expect, it } from 'vitest';
import {
  canGenerateNextRound,
  correctResult,
  disqualifyPlayer,
  dropPlayer,
  generateNextRound,
  recordResult,
} from '../src/operations';
import { computeStandings } from '../src/standings';
import { DomainError } from '../src/model/errors';
import type { Match, Tournament } from '../src/model/types';
import { matchesOf, playable, playerByName, play, startedTournament, names } from './helpers';

function pairKey(m: Match): string {
  return [m.playerAId!, m.playerBId!].sort().join('|');
}

function allRealPairs(t: Tournament): Set<string> {
  return new Set(
    t.matches
      .filter((m) => m.result !== 'BYE' && m.playerAId && m.playerBId)
      .map(pairKey),
  );
}

function byesOf(t: Tournament): string[] {
  return t.matches.filter((m) => m.result === 'BYE').map((m) => m.playerAId!);
}

/** Play a full round: every playable match gets a result (A wins unless seeded otherwise). */
function playRound(t: Tournament, chooser?: (m: Match) => Parameters<typeof play>[2]): Tournament {
  for (const m of playable(t)) t = play(t, m.id, chooser?.(m) ?? 'PLAYER_A_WIN');
  return t;
}

describe('swiss setup', () => {
  it('recommends round counts per spec table', () => {
    const cases: Array<[number, number]> = [
      [2, 2], [4, 2], [5, 3], [8, 3], [9, 4], [16, 4], [17, 5], [32, 5],
    ];
    for (const [n, expected] of cases) {
      const t = startedTournament('SWISS', names(n));
      expect(t.settings.plannedRounds).toBe(expected);
    }
  });

  it('honors an organizer round-count override', () => {
    const t = startedTournament('SWISS', names(9), { plannedRounds: 6 });
    expect(t.settings.plannedRounds).toBe(6);
  });

  it('pairs round 1 as top half vs bottom half of seeds', () => {
    const t = startedTournament('SWISS', names(8));
    const r1 = matchesOf(t, 1);
    const seedPairs = r1.map((m) => [
      t.players.find((p) => p.id === m.playerAId)!.seed,
      t.players.find((p) => p.id === m.playerBId)!.seed,
    ]);
    expect(seedPairs).toEqual([[1, 5], [2, 6], [3, 7], [4, 8]]);
  });
});

describe('swiss pairing rules', () => {
  it('pairs all players for even counts without rematches', () => {
    let t = startedTournament('SWISS', names(8));
    t = playRound(t);
    t = generateNextRound(t);
    const r2 = matchesOf(t, 2);
    expect(r2.length).toBe(4);
    const seen = new Set<string>();
    for (const m of r2) {
      const key = pairKey(m);
      expect(allRealPairs(t)).toContain(key); // exists now
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // No round-2 pairing repeats a round-1 pairing.
    const r1Pairs = new Set(matchesOf(t, 1).map(pairKey));
    for (const m of r2) expect(r1Pairs.has(pairKey(m))).toBe(false);
  });

  it('assigns exactly one bye for odd counts', () => {
    let t = startedTournament('SWISS', names(15));
    t = playRound(t);
    t = generateNextRound(t);
    const r2 = matchesOf(t, 2);
    expect(r2.filter((m) => m.result === 'BYE').length).toBe(1);
    // 15 players -> 7 matches + 1 bye.
    expect(r2.length).toBe(8);
  });

  it('avoids giving a second bye to the same player when alternatives exist', () => {
    let t = startedTournament('SWISS', names(7));
    t = playRound(t);
    const firstBye = byesOf(t)[0]!;
    t = generateNextRound(t);
    t = playRound(t);
    const secondRoundBye = matchesOf(t, 2).find((m) => m.result === 'BYE')!.playerAId!;
    expect(secondRoundBye).not.toBe(firstBye);
  });

  it('pairs players within the same score group', () => {
    let t = startedTournament('SWISS', names(8));
    // Everyone on the A side wins -> 4 players at 3pts, 4 at 0.
    t = playRound(t);
    t = generateNextRound(t);
    const standings = new Map(computeStandings(t).map((s) => [s.playerId, s.matchPoints]));
    for (const m of matchesOf(t, 2)) {
      if (m.result === 'BYE') continue;
      expect(standings.get(m.playerAId!)).toBe(standings.get(m.playerBId!));
    }
  });

  it('excludes dropped and disqualified players from future pairings', () => {
    let t = startedTournament('SWISS', names(8));
    t = playRound(t);
    t = dropPlayer(t, t.players[0]!.id, 'left');
    t = disqualifyPlayer(t, t.players[1]!.id, 'rule violation');
    t = generateNextRound(t);
    const r2 = matchesOf(t, 2);
    const paired = new Set(r2.flatMap((m) => [m.playerAId, m.playerBId].filter(Boolean)));
    expect(paired.has(t.players[0]!.id)).toBe(false);
    expect(paired.has(t.players[1]!.id)).toBe(false);
    // 6 active players -> 3 matches, no bye.
    expect(r2.length).toBe(3);
  });

  it('keeps dropped/DQ players in standings and history', () => {
    let t = startedTournament('SWISS', names(8));
    t = playRound(t);
    const dropped = t.players[0]!;
    t = dropPlayer(t, dropped.id, 'left');
    const standing = computeStandings(t).find((s) => s.playerId === dropped.id);
    expect(standing).toBeDefined();
    expect(standing!.matchesPlayed).toBe(1);
    expect(t.events.some((e) => e.type === 'PLAYER_DROPPED')).toBe(true);
  });

  it('blocks next-round generation while matches are unresolved', () => {
    let t = startedTournament('SWISS', names(8));
    const some = playable(t).slice(0, 2);
    for (const m of some) t = play(t, m.id);
    const check = canGenerateNextRound(t);
    expect(check.ok).toBe(false);
    expect(check.pendingMatches).toBe(2);
    expect(() => generateNextRound(t)).toThrow(DomainError);
  });

  it('blocks generating rounds beyond the planned count', () => {
    let t = startedTournament('SWISS', names(4)); // 2 rounds planned
    t = playRound(t);
    t = generateNextRound(t);
    t = playRound(t);
    expect(t.status).toBe('COMPLETE');
    expect(() => generateNextRound(t)).toThrow(DomainError);
  });
});

describe('swiss lifecycle end-to-end (15 players, 4 rounds)', () => {
  it('runs a complete tournament with a final standings order', () => {
    let t = startedTournament('SWISS', names(15));
    expect(t.settings.plannedRounds).toBe(4);
    for (let r = 1; r <= 4; r++) {
      t = playRound(t);
      if (r < 4) {
        const check = canGenerateNextRound(t);
        expect(check.ok).toBe(true);
        t = generateNextRound(t);
      }
    }
    expect(t.status).toBe('COMPLETE');
    const standings = computeStandings(t);
    expect(standings.length).toBe(15);
    // Points are non-increasing down the table.
    for (let i = 1; i < standings.length; i++) {
      expect(standings[i]!.matchPoints).toBeLessThanOrEqual(standings[i - 1]!.matchPoints);
    }
    // Exactly one bye per round for odd count -> 4 byes total.
    expect(byesOf(t).length).toBe(4);
  });

  it('updates standings immediately and recalculates on correction', () => {
    let t = startedTournament('SWISS', names(4));
    const m = playable(t)[0]!;
    const a = m.playerAId!;
    const b = m.playerBId!;
    t = play(t, m.id, 'PLAYER_A_WIN');
    let sa = computeStandings(t).find((s) => s.playerId === a)!;
    let sb = computeStandings(t).find((s) => s.playerId === b)!;
    expect(sa.matchPoints).toBe(3);
    expect(sb.matchPoints).toBe(0);

    t = correctResult(t, m.id, 'PLAYER_B_WIN');
    sa = computeStandings(t).find((s) => s.playerId === a)!;
    sb = computeStandings(t).find((s) => s.playerId === b)!;
    expect(sa.matchPoints).toBe(0);
    expect(sb.matchPoints).toBe(3);
    expect(t.events.some((e) => e.type === 'MATCH_RESULT_CORRECTED')).toBe(true);
  });
});

describe('swiss result validation', () => {
  it('rejects entering a result on a bye or finished match', () => {
    let t = startedTournament('SWISS', names(7));
    const bye = t.matches.find((m) => m.result === 'BYE')!;
    expect(() => recordResult(t, bye.id, 'PLAYER_A_WIN')).toThrow(DomainError);
  });

  it('disqualification does not rewrite completed matches', () => {
    let t = startedTournament('SWISS', names(8));
    t = playRound(t);
    const target = playerByName(t, 'P5')!;
    const playedMatch = t.matches.find(
      (m) => (m.playerAId === target.id || m.playerBId === target.id) && m.status === 'COMPLETE',
    )!;
    const oldResult = playedMatch.result;
    t = disqualifyPlayer(t, target.id, 'marked cards');
    const after = t.matches.find((m) => m.id === playedMatch.id)!;
    expect(after.result).toBe(oldResult);
    expect(after.status).toBe('COMPLETE');
  });
});
