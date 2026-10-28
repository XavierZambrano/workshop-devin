import { describe, expect, it } from 'vitest';
import { addPlayer, correctResult, dropPlayer, disqualifyPlayer, recordResult, startTournament } from '../src/operations';
import { DomainError } from '../src/model/errors';
import { seedSlotOrder, nextPow2 } from '../src/formats/util';
import { matchesOf, makeTournament, names, play, playable, playerByName, startedTournament } from './helpers';

function byeCount(t: ReturnType<typeof startedTournament>) {
  return t.matches.filter((m) => m.result === 'BYE').length;
}

describe('single elimination bracket sizes', () => {
  it.each([
    [2, 2, 0],
    [4, 4, 0],
    [8, 8, 0],
    [13, 16, 3],
    [17, 32, 15],
    [32, 32, 0],
  ])('%d players -> %d-slot bracket with %d byes', (count, size, byes) => {
    const t = startedTournament('SINGLE_ELIMINATION', names(count));
    expect(nextPow2(count)).toBe(size);
    expect(byeCount(t)).toBe(byes);
    expect(t.rounds.length).toBe(Math.log2(size));
    expect(matchesOf(t, 1).length).toBe(size / 2);
  });

  it('gives byes to the top seeds', () => {
    const t = startedTournament('SINGLE_ELIMINATION', names(13));
    const byeMatches = t.matches.filter((m) => m.result === 'BYE');
    const byeSeeds = byeMatches
      .map((m) => t.players.find((p) => p.id === m.playerAId)?.seed)
      .sort((a, b) => a! - b!);
    expect(byeSeeds).toEqual([1, 2, 3]);
  });

  it('produces standard seed pairings for a full 8 bracket', () => {
    const t = startedTournament('SINGLE_ELIMINATION', names(8));
    const r1 = matchesOf(t, 1);
    const seedPairs = r1.map((m) => [
      t.players.find((p) => p.id === m.playerAId)?.seed,
      t.players.find((p) => p.id === m.playerBId)?.seed,
    ]);
    expect(seedPairs).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });
});

describe('seedSlotOrder', () => {
  it('orders seeds correctly for 8 and 16', () => {
    expect(seedSlotOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedSlotOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
});

describe('single elimination progression', () => {
  it('advances winners and produces a champion (4 players)', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(4));
    expect(t.rounds.length).toBe(2);

    for (const m of playable(t)) t = play(t, m.id, 'PLAYER_A_WIN');
    const final = t.matches.find((m) => m.roundNumber === 2)!;
    expect(final.playerAId).toBeDefined();
    expect(final.playerBId).toBeDefined();
    expect(final.status).toBe('ACTIVE');

    t = play(t, final.id, 'PLAYER_B_WIN');
    expect(t.status).toBe('COMPLETE');
    expect(t.championId).toBe(final.playerBId);
  });

  it('auto-advances bye recipients (13 players)', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(13));
    const round2 = matchesOf(t, 2);
    // Seeds 1-3 had byes and should already occupy round-2 slots.
    const round2Players = new Set(round2.flatMap((m) => [m.playerAId, m.playerBId].filter(Boolean)));
    const byePlayers = t.matches
      .filter((m) => m.result === 'BYE')
      .map((m) => m.playerAId!);
    for (const id of byePlayers) expect(round2Players.has(id)).toBe(true);

    // Finish the whole tournament.
    let guard = 0;
    while (t.status !== 'COMPLETE' && guard++ < 50) {
      for (const m of playable(t)) t = play(t, m.id);
    }
    expect(t.status).toBe('COMPLETE');
    expect(t.championId).toBeDefined();
  });

  it('marks a full 32-player tournament through to a champion', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(32));
    let guard = 0;
    while (t.status !== 'COMPLETE' && guard++ < 100) {
      for (const m of playable(t)) t = play(t, m.id);
    }
    expect(t.status).toBe('COMPLETE');
    expect(t.matches.filter((m) => m.status === 'COMPLETE').length).toBe(31);
  });

  it('rejects results on already-complete matches', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(4));
    const m = playable(t)[0]!;
    t = play(t, m.id, 'PLAYER_A_WIN');
    expect(() => recordResult(t, m.id, 'PLAYER_B_WIN')).toThrow(DomainError);
  });

  it('correcting a result retracts the wrong winner and advances the right one', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(4));
    const ms = playable(t); const m1 = ms[0]!; const m2 = ms[1]!;
    const loser = m1.playerAId!;
    const winner = m1.playerBId!;
    t = play(t, m1.id, 'PLAYER_B_WIN');

    const final = t.matches.find((m) => m.roundNumber === 2)!;
    expect([final.playerAId, final.playerBId]).toContain(winner);

    // Correct it: A actually won.
    t = correctResult(t, m1.id, 'PLAYER_A_WIN');
    const finalAfter = t.matches.find((m) => m.id === final.id)!;
    expect([finalAfter.playerAId, finalAfter.playerBId]).toContain(loser);
    expect([finalAfter.playerAId, finalAfter.playerBId]).not.toContain(winner);
    void m2;
  });

  it('voids dependent completed matches when a result is corrected late', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(4));
    const ms = playable(t); const m1 = ms[0]!; const m2 = ms[1]!;
    const m1Loser = m1.playerBId!;
    const m1Winner = m1.playerAId!;
    t = play(t, m1.id, 'PLAYER_A_WIN');
    t = play(t, m2!.id, 'PLAYER_A_WIN');
    const final = playable(t).find((m) => m.roundNumber === 2)!;
    t = play(t, final.id, 'PLAYER_A_WIN');
    expect(t.status).toBe('COMPLETE');
    expect(t.championId).toBe(m1Winner);

    // Correct semifinal 1: player B actually won. The completed final must be
    // reopened (voided, then refilled by re-propagation), champion retracted.
    t = correctResult(t, m1.id, 'PLAYER_B_WIN');
    expect(t.championId).toBeUndefined();
    expect(t.status).toBe('ACTIVE');
    const finalAfter = t.matches.find((m) => m.id === final.id)!;
    expect([finalAfter.playerAId, finalAfter.playerBId]).toContain(m1Loser);
    expect([finalAfter.playerAId, finalAfter.playerBId]).not.toContain(m1Winner);
    expect(finalAfter.status).toBe('ACTIVE');
    expect(finalAfter.result).toBe('PENDING');
    expect(t.events.some((e) => e.type === 'MATCH_VOIDED')).toBe(true);

    // Re-entering the final produces the correct champion.
    t = play(t, finalAfter.id, 'PLAYER_B_WIN');
    expect(t.status).toBe('COMPLETE');
    expect(t.championId).toBe(finalAfter.playerBId);
  });

  it('a dropped player concedes a walkover and the opponent advances', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(4));
    const m1 = playable(t)[0]!;
    const droppee = playerByName(t, 'P1')!;
    const dropMatch = playable(t).find((m) => m.playerAId === droppee.id || m.playerBId === droppee.id)!;
    const opponent = dropMatch.playerAId === droppee.id ? dropMatch.playerBId! : dropMatch.playerAId!;

    t = dropPlayer(t, droppee.id, 'left early');
    const updated = t.matches.find((m) => m.id === dropMatch.id)!;
    expect(updated.status).toBe('COMPLETE');
    const final = t.matches.find((m) => m.roundNumber === 2)!;
    expect([final.playerAId, final.playerBId]).toContain(opponent);
    void m1;
  });

  it('a disqualified player is removed and the opponent advances', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(4));
    const dq = t.players[2]!;
    const dqMatch = playable(t).find((m) => m.playerAId === dq.id || m.playerBId === dq.id)!;
    const opponent = dqMatch.playerAId === dq.id ? dqMatch.playerBId! : dqMatch.playerAId!;

    t = disqualifyPlayer(t, dq.id, 'cheating');
    const p = t.players.find((x) => x.id === dq.id)!;
    expect(p.status).toBe('DISQUALIFIED');
    expect(p.statusReason).toBe('cheating');
    const m = t.matches.find((x) => x.id === dqMatch.id)!;
    expect(m.status).toBe('COMPLETE');
    const final = t.matches.find((x) => x.roundNumber === 2)!;
    expect([final.playerAId, final.playerBId]).toContain(opponent);
  });
});

describe('setup validation', () => {
  it('rejects start with too few players', () => {
    const t = makeTournament('SINGLE_ELIMINATION', ['Only One']);
    expect(() => startTournament(t)).toThrow(DomainError);
  });

  it('rejects more than 32 players', () => {
    const t = makeTournament('SINGLE_ELIMINATION', names(32));
    expect(() => addPlayer(t, 'P33')).toThrow(DomainError);
  });
});
