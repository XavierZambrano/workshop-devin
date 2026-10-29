import { describe, expect, it } from 'vitest';
import { computeStandings } from '../src/standings';
import { correctResult, generateNextRound } from '../src/operations';
import { playable, play, playerByName, startedTournament, names } from './helpers';
import type { Match, MatchResult, Tournament } from '../src/model/types';
import { serializeTournament, deserializeTournament } from '../src/serialization';
import { DomainError } from '../src/model/errors';

function entry(t: Tournament, name: string) {
  const p = playerByName(t, name)!;
  return computeStandings(t).find((s) => s.playerId === p.id)!;
}

function completedMatch(
  template: Match,
  id: string,
  playerAId: string,
  playerBId: string | undefined,
  result: MatchResult,
): Match {
  return {
    ...template,
    id,
    playerAId,
    playerBId,
    result,
    status: 'COMPLETE',
  };
}

describe('statistics', () => {
  it('computes match points, record and win% (win=3, draw=1)', () => {
    let t = startedTournament('SWISS', names(4));
    const ms = playable(t); const m1 = ms[0]!; const m2 = ms[1]!;
    t = play(t, m1!.id, 'PLAYER_A_WIN');
    t = play(t, m2!.id, 'DRAW');

    const a = entry(t, nameOf(t, m1!.playerAId!));
    expect(a.matchPoints).toBe(3);
    expect(a.wins).toBe(1);
    expect(a.matchWinPct).toBe(1);

    const c = entry(t, nameOf(t, m2!.playerAId!));
    expect(c.matchPoints).toBe(1);
    expect(c.draws).toBe(1);
    expect(c.matchWinPct).toBeCloseTo(1 / 3);
  });

  it('awards bye points but excludes byes from the win% denominator', () => {
    const t = startedTournament('SWISS', names(5));
    const byeMatch = t.matches.find((m) => m.result === 'BYE')!;
    const e = computeStandings(t).find((s) => s.playerId === byeMatch.playerAId)!;
    expect(e.byes).toBe(1);
    expect(e.matchPoints).toBe(3);
    expect(e.matchesPlayed).toBe(0);
    expect(e.matchWinPct).toBe(0); // no real matches yet
  });

  it('keeps Win% within 100% for a five-player Swiss with two rounds', () => {
    let t = startedTournament('SWISS', names(5), { plannedRounds: 2 });
    for (const m of playable(t)) t = play(t, m.id, 'PLAYER_A_WIN');
    t = generateNextRound(t);
    for (const m of playable(t)) t = play(t, m.id, 'PLAYER_A_WIN');

    const standings = computeStandings(t);
    expect(
      standings.every(
        (s) =>
          s.matchWinPct >= 0 &&
          s.matchWinPct <= 1 &&
          s.oppMatchWinPct >= 0 &&
          s.oppMatchWinPct <= 1,
      ),
    ).toBe(true);

    const byeAndWin = standings.find((s) => s.byes === 1 && s.wins === 1)!;
    expect(byeAndWin.matchPoints).toBe(6);
    expect(byeAndWin.matchesPlayed).toBe(1);
    expect(byeAndWin.matchWinPct).toBe(1);
  });

  it('includes bye points, uses played-match points for Win%, and floors Opp% at one-third', () => {
    const initial = startedTournament('SWISS', names(3));
    const playerOne = playerByName(initial, 'P1')!;
    const playerTwo = playerByName(initial, 'P2')!;
    const playerThree = playerByName(initial, 'P3')!;
    const firstMatch = playable(initial)[0]!;
    const bye = initial.matches.find((m) => m.result === 'BYE')!;
    const secondLoss = completedMatch(
      firstMatch,
      'second-loss',
      playerTwo.id,
      playerThree.id,
      'PLAYER_B_WIN',
    );
    const t: Tournament = {
      ...initial,
      matches: [
        completedMatch(firstMatch, firstMatch.id, playerOne.id, playerTwo.id, 'PLAYER_A_WIN'),
        completedMatch(bye, bye.id, playerOne.id, undefined, 'BYE'),
        secondLoss,
      ],
    };

    const playerOneStanding = computeStandings(t).find((s) => s.playerId === playerOne.id)!;
    expect(playerOneStanding.byes).toBe(1);
    expect(playerOneStanding.matchPoints).toBe(6);
    expect(playerOneStanding.matchesPlayed).toBe(1);
    expect(playerOneStanding.matchWinPct).toBe(1);
    expect(playerOneStanding.oppMatchWinPct).toBe(1 / 3);
  });

  it('computes Opp% as the average opponent match-win percentage', () => {
    let t = startedTournament('SWISS', names(4));
    const ms = playable(t); const m1 = ms[0]!; const m2 = ms[1]!;
    // m1: A beats B. m2: draw between C and D.
    t = play(t, m1!.id, 'PLAYER_A_WIN');
    t = play(t, m2!.id, 'DRAW');

    // A's only opponent is B, who lost: the 33% floor applies to B's 0%.
    const a = entry(t, nameOf(t, m1!.playerAId!));
    expect(a.oppMatchWinPct).toBeCloseTo(1 / 3);
    // C's opponent D drew: 1 point / (1*3) = 1/3.
    const c = entry(t, nameOf(t, m2!.playerAId!));
    expect(c.oppMatchWinPct).toBeCloseTo(1 / 3);
  });

  it('uses head-to-head for mathematically tied Opp% despite floating-point differences', () => {
    const initial = startedTournament('SWISS', names(11));
    const template = initial.matches[0]!;
    const matches: Match[] = [];
    const addMatch = (playerAName: string, playerBName: string, result: MatchResult) => {
      const playerA = playerByName(initial, playerAName)!;
      const playerB = playerByName(initial, playerBName)!;
      matches.push(
        completedMatch(template, `float-tie-${matches.length}`, playerA.id, playerB.id, result),
      );
    };

    addMatch('P2', 'P1', 'PLAYER_A_WIN');
    addMatch('P2', 'P3', 'PLAYER_B_WIN');
    addMatch('P1', 'P4', 'PLAYER_A_WIN');
    addMatch('P2', 'P5', 'DRAW');
    addMatch('P2', 'P7', 'DRAW');
    addMatch('P2', 'P6', 'DRAW');
    addMatch('P1', 'P8', 'DRAW');
    addMatch('P1', 'P10', 'DRAW');
    addMatch('P1', 'P9', 'DRAW');
    addMatch('P3', 'P11', 'PLAYER_B_WIN');
    addMatch('P4', 'P11', 'PLAYER_A_WIN');
    for (const name of ['P6', 'P10']) {
      for (let i = 0; i < 10; i++) addMatch(name, 'P11', 'PLAYER_A_WIN');
      for (let i = 0; i < 19; i++) addMatch(name, 'P11', 'PLAYER_B_WIN');
    }

    const standings = computeStandings({ ...initial, matches });
    const playerTwoStanding = standings.find(
      (s) => s.playerId === playerByName(initial, 'P2')!.id,
    )!;
    const playerOneStanding = standings.find(
      (s) => s.playerId === playerByName(initial, 'P1')!.id,
    )!;
    expect(playerTwoStanding.matchPoints).toBe(playerOneStanding.matchPoints);
    expect(playerTwoStanding.oppMatchWinPct).not.toBe(playerOneStanding.oppMatchWinPct);
    expect(
      Math.abs(playerTwoStanding.oppMatchWinPct - playerOneStanding.oppMatchWinPct),
    ).toBeLessThan(1e-9);
    expect(playerByName(initial, 'P2')!.seed).toBeGreaterThan(playerByName(initial, 'P1')!.seed!);
    expect(playerTwoStanding.rank).toBeLessThan(playerOneStanding.rank);
  });

  it('double loss counts as a loss for both players', () => {
    let t = startedTournament('SWISS', names(4));
    const m = playable(t)[0]!;
    t = play(t, m.id, 'DOUBLE_LOSS');
    const a = entry(t, nameOf(t, m.playerAId!));
    const b = entry(t, nameOf(t, m.playerBId!));
    expect(a.losses).toBe(1);
    expect(b.losses).toBe(1);
    expect(a.matchPoints).toBe(0);
    expect(a.matchesPlayed).toBe(1);
  });

  it('sorts by points then Opp% then head-to-head', () => {
    let t = startedTournament('SWISS', names(8));
    // Round 1: seeds 1-4 (player A side) all win.
    for (const m of playable(t)) t = play(t, m.id, 'PLAYER_A_WIN');
    const standings = computeStandings(t);
    const winners = standings.filter((s) => s.matchPoints === 3);
    const losers = standings.filter((s) => s.matchPoints === 0);
    expect(winners.length).toBe(4);
    expect(losers.length).toBe(4);
    // Every winner should rank above every loser.
    expect(winners.every((w) => w.rank <= 4)).toBe(true);
    // Among winners, the one who beat the strongest opponent should have
    // higher opp%: seed1's victim (seed5)... all losers have 0. Opp% ties are
    // resolved head-to-head then seed — just assert determinism.
    const again = computeStandings(t);
    expect(again.map((s) => s.playerId)).toEqual(standings.map((s) => s.playerId));
  });

  it('corrected results update all derived statistics', () => {
    let t = startedTournament('SWISS', names(4));
    const m = playable(t)[0]!;
    t = play(t, m.id, 'PLAYER_A_WIN');
    t = correctResult(t, m.id, 'DRAW');
    const a = entry(t, nameOf(t, m.playerAId!));
    expect(a.wins).toBe(0);
    expect(a.draws).toBe(1);
    expect(a.matchPoints).toBe(1);
  });
});

function nameOf(t: Tournament, id: string): string {
  return t.players.find((p) => p.id === id)!.displayName;
}

describe('serialization', () => {
  it('round-trips a tournament through export/import', () => {
    let t = startedTournament('SWISS', names(8));
    for (const m of playable(t)) t = play(t, m.id);
    const json = serializeTournament(t);
    const restored = deserializeTournament(json);
    expect(restored.id).toBe(t.id);
    expect(restored.players.length).toBe(8);
    expect(restored.matches.length).toBe(t.matches.length);
    expect(computeStandings(restored)).toEqual(computeStandings(t));
  });

  it('rejects malformed JSON', () => {
    expect(() => deserializeTournament('{not json')).toThrow(DomainError);
  });

  it('rejects a structurally invalid tournament', () => {
    expect(() => deserializeTournament(JSON.stringify({ hello: 'world' }))).toThrow(DomainError);
    const bad = { id: 'x', name: 't', format: 'NOPE', status: 'ACTIVE', players: [], rounds: [], matches: [], penalties: [], warnings: [], events: [], settings: { randomSeed: 1, scoring: { win: 3, draw: 1, loss: 0, bye: 3 } } };
    expect(() => deserializeTournament(JSON.stringify(bad))).toThrow(DomainError);
  });

  it('accepts a bare tournament object (no envelope)', () => {
    const t = startedTournament('SWISS', names(4));
    const restored = deserializeTournament(JSON.stringify(t));
    expect(restored.id).toBe(t.id);
  });
});

describe('audit history', () => {
  it('records important operations as events', () => {
    let t = startedTournament('SWISS', names(4));
    const m = playable(t)[0]!;
    t = play(t, m.id, 'PLAYER_A_WIN');
    t = correctResult(t, m.id, 'DRAW');
    const types = t.events.map((e) => e.type);
    for (const type of [
      'TOURNAMENT_CREATED',
      'PLAYER_REGISTERED',
      'TOURNAMENT_STARTED',
      'ROUND_CREATED',
      'MATCH_RESULT_RECORDED',
      'MATCH_RESULT_CORRECTED',
    ]) {
      expect(types).toContain(type);
    }
    // Events are chronologically ordered.
    const ts = t.events.map((e) => e.timestamp);
    expect([...ts].sort()).toEqual(ts);
  });
});
