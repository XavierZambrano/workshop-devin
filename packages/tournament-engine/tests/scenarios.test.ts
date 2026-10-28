import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  canGenerateNextRound,
  correctResult,
  disqualifyPlayer,
  dropPlayer,
  generateNextRound,
  issueWarning,
} from '../src/operations';
import { computeStandings } from '../src/standings';
import { serializeTournament, deserializeTournament } from '../src/serialization';
import type { Tournament } from '../src/model/types';
import { playable, play, startedTournament, names } from './helpers';

const OUT_DIR = join(__dirname, '..', '..', '..', 'sample-data');

function save(name: string, t: Tournament) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), serializeTournament(t), 'utf8');
}

describe('spec scenario A — single elimination, 13 players', () => {
  it('runs the full organizer flow', () => {
    let t = startedTournament('SINGLE_ELIMINATION', names(13), {
      seedingMode: 'RANDOM',
      randomSeed: 7,
    });

    // 16-slot bracket, 3 byes.
    expect(t.rounds.length).toBe(4);
    expect(t.matches.filter((m) => m.roundNumber === 1).length).toBe(8);
    expect(t.matches.filter((m) => m.result === 'BYE').length).toBe(3);

    // Record results; winners advance automatically.
    for (const m of playable(t)) t = play(t, m.id);
    // Correct one incorrect result before advancing further.
    const toFix = t.matches.find(
      (m) => m.roundNumber === 1 && m.status === 'COMPLETE' && m.result === 'PLAYER_A_WIN',
    )!;
    t = correctResult(t, toFix.id, 'PLAYER_B_WIN');
    const r2 = t.matches.filter((m) => m.roundNumber === 2);
    expect(r2.some((m) => [m.playerAId, m.playerBId].includes(toFix.playerBId))).toBe(true);

    let guard = 0;
    while (t.status !== 'COMPLETE' && guard++ < 50) {
      for (const m of playable(t)) t = play(t, m.id);
    }
    expect(t.status).toBe('COMPLETE');
    expect(t.championId).toBeDefined();

    const restored = deserializeTournament(serializeTournament(t));
    expect(restored.championId).toBe(t.championId);
    save('demo-single-elimination.json', t);
  });
});

describe('spec scenario B — swiss, 15 players, 4 rounds', () => {
  it('runs the full organizer flow', () => {
    let t = startedTournament('SWISS', names(15), { plannedRounds: 4 });
    const warned = t.players[2]!.id;
    const dropped = t.players[4]!.id;
    const dqed = t.players[6]!.id;

    t = playAllCurrent(t);
    t = issueWarning(t, { playerId: warned, reason: 'Slow play' });
    t = dropPlayer(t, dropped, 'had to leave');
    t = disqualifyPlayer(t, dqed, 'deck list problem');

    const pairedIds = (x: Tournament) =>
      new Set(x.matches.filter((m) => m.roundNumber === x.rounds.length).flatMap((m) => [m.playerAId, m.playerBId].filter(Boolean)));

    for (let r = 2; r <= 4; r++) {
      expect(canGenerateNextRound(t).ok).toBe(true);
      t = generateNextRound(t);
      const paired = pairedIds(t);
      expect(paired.has(dropped)).toBe(false);
      expect(paired.has(dqed)).toBe(false);
      t = playAllCurrent(t);
    }

    expect(t.status).toBe('COMPLETE');
    const standings = computeStandings(t);
    expect(standings.length).toBe(15);
    expect(standings.every((s) => Number.isFinite(s.oppMatchWinPct))).toBe(true);
    expect(t.warnings.find((w) => w.playerId === warned)?.active).toBe(true);

    const restored = deserializeTournament(serializeTournament(t));
    expect(restored.status).toBe('COMPLETE');
    save('demo-swiss.json', t);
  });
});

function playAllCurrent(t: Tournament): Tournament {
  for (const m of playable(t)) t = play(t, m.id);
  return t;
}
