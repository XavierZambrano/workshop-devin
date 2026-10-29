import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  canGenerateNextRound,
  computeStandings,
  createTournament,
  deserializeTournament,
  dropPlayer,
  recordResult,
  serializeTournament,
  startTournament,
  type Match,
  type Tournament,
} from '../src';

function startRoundRobin(playerNames: string[]): Tournament {
  let t = createTournament({
    name: 'Round Robin test',
    format: 'ROUND_ROBIN',
    seedingMode: 'REGISTRATION_ORDER',
  });
  for (const displayName of playerNames) {
    t = addPlayer(t, displayName);
  }
  return startTournament(t);
}

function playerId(t: Tournament, name: string): string {
  return t.players.find((player) => player.displayName === name)!.id;
}

function pairKey(match: Match): string {
  return [match.playerAId!, match.playerBId!].sort().join('|');
}

function pairs(t: Tournament): Set<string> {
  return new Set(t.matches.map(pairKey));
}

function findMatch(t: Tournament, nameA: string, nameB: string): Match {
  const ids = new Set([playerId(t, nameA), playerId(t, nameB)]);
  return t.matches.find((match) => ids.has(match.playerAId!) && ids.has(match.playerBId!))!;
}

function recordBetween(
  t: Tournament,
  nameA: string,
  nameB: string,
  result: 'A_WIN' | 'B_WIN' | 'DRAW',
): Tournament {
  const match = findMatch(t, nameA, nameB);
  if (result === 'DRAW') return recordResult(t, match.id, 'DRAW');
  const winnerId = playerId(t, result === 'A_WIN' ? nameA : nameB);
  return recordResult(
    t,
    match.id,
    match.playerAId === winnerId ? 'PLAYER_A_WIN' : 'PLAYER_B_WIN',
  );
}

describe('round robin schedule', () => {
  it('schedules every pair once across three rounds for four players', () => {
    const t = startRoundRobin(['P1', 'P2', 'P3', 'P4']);

    expect(t.rounds).toHaveLength(3);
    expect(t.rounds.map((round) => round.matchIds.length)).toEqual([2, 2, 2]);
    expect(t.matches).toHaveLength(6);
    expect(pairs(t).size).toBe(6);
    expect(t.rounds[0]?.status).toBe('ACTIVE');
    expect(t.rounds.slice(1).every((round) => round.status === 'PENDING')).toBe(true);
  });

  it('gives every player exactly one rest across five odd-count rounds', () => {
    const t = startRoundRobin(['P1', 'P2', 'P3', 'P4', 'P5']);
    const rests = new Map<string, number>();

    expect(t.rounds).toHaveLength(5);
    for (const round of t.rounds) {
      const roundMatches = t.matches.filter((match) => match.roundId === round.id);
      expect(roundMatches).toHaveLength(2);
      expect(roundMatches.every((match) => match.playerAId && match.playerBId)).toBe(true);
      const inMatches = new Set(roundMatches.flatMap((match) => [match.playerAId!, match.playerBId!]));
      const resting = t.players.filter((player) => !inMatches.has(player.id));
      expect(resting).toHaveLength(1);
      rests.set(resting[0]!.id, (rests.get(resting[0]!.id) ?? 0) + 1);
    }
    expect(pairs(t).size).toBe(10);
    expect([...rests.values()]).toEqual([1, 1, 1, 1, 1]);
  });

  it('schedules one round for two players', () => {
    const t = startRoundRobin(['P1', 'P2']);

    expect(t.rounds).toHaveLength(1);
    expect(t.matches).toHaveLength(1);
    expect(pairs(t).size).toBe(1);
  });

  it('schedules all 21 pairs and one rest per player for seven players', () => {
    const t = startRoundRobin(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    const rests = new Map<string, number>();

    expect(t.rounds).toHaveLength(7);
    expect(t.matches).toHaveLength(21);
    expect(pairs(t).size).toBe(21);
    for (const round of t.rounds) {
      const inMatches = new Set(
        t.matches
          .filter((match) => match.roundId === round.id)
          .flatMap((match) => [match.playerAId!, match.playerBId!]),
      );
      const resting = t.players.filter((player) => !inMatches.has(player.id));
      expect(resting).toHaveLength(1);
      rests.set(resting[0]!.id, (rests.get(resting[0]!.id) ?? 0) + 1);
    }
    expect([...rests.values()]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('round robin results and standings', () => {
  it('allows draws and completes with the rank-one player as champion', () => {
    let t = startRoundRobin(['P1', 'P2', 'P3', 'P4']);
    const roundOne = t.rounds[0]!;
    const roundOneMatches = t.matches.filter((match) => match.roundId === roundOne.id);
    const first = roundOneMatches[0]!;

    t = recordResult(t, first.id, 'DRAW');
    expect(t.rounds[0]?.status).toBe('ACTIVE');
    for (const match of t.matches) {
      if (match.status !== 'COMPLETE') t = recordResult(t, match.id, 'PLAYER_A_WIN');
    }

    expect(t.status).toBe('COMPLETE');
    expect(t.rounds.every((round) => round.status === 'COMPLETE')).toBe(true);
    expect(t.championId).toBe(computeStandings(t)[0]?.playerId);
  });

  it('promotes the next round while allowing scheduled matches to be played early', () => {
    let t = startRoundRobin(['P1', 'P2', 'P3', 'P4']);
    const lastRoundMatch = t.matches.find((match) => match.roundNumber === 3)!;

    t = recordResult(t, lastRoundMatch.id, 'PLAYER_A_WIN');
    expect(t.rounds[0]?.status).toBe('ACTIVE');
    expect(t.rounds[2]?.status).toBe('ACTIVE');
    for (const match of t.matches.filter((match) => match.roundNumber === 1)) {
      if (match.status !== 'COMPLETE') t = recordResult(t, match.id, 'PLAYER_A_WIN');
    }
    expect(t.rounds[0]?.status).toBe('COMPLETE');
    expect(t.rounds[1]?.status).toBe('ACTIVE');
  });

  it('forfeits every pending match of a dropped player and keeps completed matches and standings', () => {
    let t = startRoundRobin(['P1', 'P2', 'P3', 'P4']);
    const droppedId = playerId(t, 'P1');
    const played = t.matches.find((match) => match.playerAId === droppedId || match.playerBId === droppedId)!;
    const playedResult = played.playerAId === droppedId ? 'PLAYER_A_WIN' : 'PLAYER_B_WIN';
    t = recordResult(t, played.id, playedResult);
    const completedBeforeDrop = t.matches.find((match) => match.id === played.id)!;

    t = dropPlayer(t, droppedId, 'left');
    const targetMatches = t.matches.filter(
      (match) => match.playerAId === droppedId || match.playerBId === droppedId,
    );

    expect(t.players.find((player) => player.id === droppedId)?.status).toBe('DROPPED');
    expect(computeStandings(t).some((standing) => standing.playerId === droppedId)).toBe(true);
    expect(t.matches.find((match) => match.id === played.id)?.result).toBe(completedBeforeDrop.result);
    for (const match of targetMatches.filter((item) => item.id !== played.id)) {
      expect(match.status).toBe('COMPLETE');
      expect(match.result).toBe(match.playerAId === droppedId ? 'PLAYER_B_WIN' : 'PLAYER_A_WIN');
    }
    expect(
      t.events.filter(
        (event) => event.type === 'MATCH_RESULT_RECORDED' && event.metadata?.automatic === true,
      ),
    ).toHaveLength(targetMatches.length - 1);
  });

  it('records the active round when a player drops', () => {
    const firstRound = startRoundRobin(['P1', 'P2', 'P3', 'P4', 'P5']);
    const firstDropId = playerId(firstRound, 'P1');
    const droppedInFirstRound = dropPlayer(firstRound, firstDropId, 'left');

    expect(
      droppedInFirstRound.players.find((player) => player.id === firstDropId)?.statusRoundNumber,
    ).toBe(1);

    let afterRoundOne = startRoundRobin(['P1', 'P2', 'P3', 'P4', 'P5']);
    for (const match of afterRoundOne.matches.filter((item) => item.roundNumber === 1)) {
      afterRoundOne = recordResult(afterRoundOne, match.id, 'PLAYER_A_WIN');
    }
    const secondDropId = playerId(afterRoundOne, 'P1');
    const droppedInSecondRound = dropPlayer(afterRoundOne, secondDropId, 'left');

    expect(afterRoundOne.rounds.find((round) => round.status === 'ACTIVE')?.number).toBe(2);
    expect(
      droppedInSecondRound.players.find((player) => player.id === secondDropId)?.statusRoundNumber,
    ).toBe(2);
  });

  it('uses head-to-head mini-table points to resolve a three-way points tie', () => {
    let t = startRoundRobin(['A', 'C', 'B', 'D', 'E']);
    for (const [a, b, result] of [
      ['A', 'B', 'A_WIN'],
      ['A', 'C', 'B_WIN'],
      ['B', 'C', 'DRAW'],
      ['A', 'D', 'A_WIN'],
      ['A', 'E', 'DRAW'],
      ['B', 'D', 'A_WIN'],
      ['B', 'E', 'A_WIN'],
      ['C', 'D', 'A_WIN'],
      ['C', 'E', 'B_WIN'],
      ['D', 'E', 'DRAW'],
    ] as const) {
      t = recordBetween(t, a, b, result);
    }

    const standings = new Map(computeStandings(t).map((standing) => [standing.playerId, standing]));
    const a = standings.get(playerId(t, 'A'))!;
    const b = standings.get(playerId(t, 'B'))!;
    const c = standings.get(playerId(t, 'C'))!;

    expect([a.matchPoints, b.matchPoints, c.matchPoints]).toEqual([7, 7, 7]);
    expect(c.rank).toBeLessThan(a.rank);
    expect(a.rank).toBeLessThan(b.rank);
  });

  it('uses head-to-head to place a lower-seeded player first in a two-way points tie', () => {
    let t = startRoundRobin(['B', 'A', 'C', 'D']);
    for (const [a, b, result] of [
      ['A', 'B', 'A_WIN'],
      ['A', 'C', 'A_WIN'],
      ['A', 'D', 'B_WIN'],
      ['B', 'C', 'A_WIN'],
      ['B', 'D', 'A_WIN'],
      ['C', 'D', 'DRAW'],
    ] as const) {
      t = recordBetween(t, a, b, result);
    }

    const standings = computeStandings(t);
    const a = standings.find((standing) => standing.playerId === playerId(t, 'A'))!;
    const b = standings.find((standing) => standing.playerId === playerId(t, 'B'))!;

    expect(a.matchPoints).toBe(6);
    expect(b.matchPoints).toBe(6);
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
  });

  it('round-trips the new format through serialization', () => {
    const t = startRoundRobin(['P1', 'P2', 'P3', 'P4']);

    expect(deserializeTournament(serializeTournament(t))).toEqual(t);
  });

  it('does not allow manual next-round generation', () => {
    const t = startRoundRobin(['P1', 'P2', 'P3', 'P4']);

    expect(canGenerateNextRound(t)).toEqual({
      ok: false,
      reason: 'Round Robin schedule is generated at start',
    });
  });
});
