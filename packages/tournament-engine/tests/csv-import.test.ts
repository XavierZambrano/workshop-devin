import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  createTournament,
  deserializeTournament,
  DomainError,
  ErrorCodes,
  importPlayers,
  MAX_PLAYERS,
  normalizePlayerName,
  serializeTournament,
  startTournament,
} from '../src';
import { parsePlayersCsv } from '../src/import/csv';

function draft(seedingMode: 'MANUAL' | 'REGISTRATION_ORDER' = 'REGISTRATION_ORDER') {
  return createTournament({
    name: 'CSV import test',
    format: 'SWISS',
    seedingMode,
    plannedRounds: 2,
  });
}

function importError(t: ReturnType<typeof draft>, rows: Parameters<typeof importPlayers>[1]) {
  let thrown: unknown;
  try {
    importPlayers(t, rows);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  expect((thrown as DomainError).code).toBe(ErrorCodes.IMPORT_INVALID);
  return thrown as DomainError;
}

describe('parsePlayersCsv', () => {
  it('strips a BOM, parses CRLF and semicolon-separated Spanish headers with accents', () => {
    const result = parsePlayersCsv(
      '\uFEFFNombre;Semilla;Foto\r\nJosé;1;avatar-jose.jpg\r\nMüller;2;\r\n',
    );

    expect(result.separator).toBe(';');
    expect(result.hasHeader).toBe(true);
    expect(result.rows).toEqual([
      { line: 2, displayName: 'José', seed: 1, photoRef: 'avatar-jose.jpg' },
      { line: 3, displayName: 'Müller', seed: 2 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('parses comma-separated quoted names and escaped quotes', () => {
    const result = parsePlayersCsv('Name,Photo\n"Doe, ""Johnny""",avatar.png\n');

    expect(result.separator).toBe(',');
    expect(result.rows).toEqual([
      { line: 2, displayName: 'Doe, "Johnny"', photoRef: 'avatar.png' },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('parses tab-separated fields and names with quoted physical newlines', () => {
    const result = parsePlayersCsv('Jugador\tSemilla\n"José\r\nÁngeles"\t3\r\n');

    expect(result.separator).toBe('\t');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ line: 2, seed: 3 });
    expect(result.rows[0]?.displayName).toContain('José');
    expect(result.rows[0]?.displayName).toContain('Ángeles');
  });

  it('supports headerless rows, optional seeds, blank lines and CR-only endings', () => {
    const result = parsePlayersCsv('\r\nSolo;2\r\n \r\nSecond\rThird;4');

    expect(result.separator).toBe(';');
    expect(result.hasHeader).toBe(false);
    expect(result.rows).toEqual([
      { line: 2, displayName: 'Solo', seed: 2 },
      { line: 4, displayName: 'Second' },
      { line: 5, displayName: 'Third', seed: 4 },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('rejects unknown header columns without treating the header as a player', () => {
    const result = parsePlayersCsv('Nombre;Jersey Number\nJosé;9');

    expect(result.hasHeader).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { line: 1, message: "Unknown column 'Jersey Number'" },
    ]);
  });

  it('reports empty names, invalid seeds and normalized duplicate names on physical lines', () => {
    const result = parsePlayersCsv(
      'Name;Seed\r\nJosé;1\r\n ;2\r\nBad;0\r\nJOSE\u0301;4\r\n',
    );

    expect(result.rows).toEqual([{ line: 2, displayName: 'José', seed: 1 }]);
    expect(result.errors.map((error) => error.line)).toEqual([3, 4, 5]);
    expect(result.errors).toEqual([
      { line: 3, message: expect.stringContaining('name') },
      { line: 4, message: expect.stringContaining('Seed') },
      { line: 5, message: expect.stringContaining('Duplicate') },
    ]);
  });
});

describe('importPlayers', () => {
  it('validates atomically and leaves the tournament unchanged when one row is invalid', () => {
    let t = addPlayer(draft(), 'Existing');
    const before = structuredClone(t);
    const error = importError(t, [{ displayName: 'New player' }, { displayName: '  ' }]);

    expect(error.message).toMatch(/name/i);
    expect(error.message).toContain('Import row 2: Player name is required');
    expect(t).toEqual(before);
  });

  it('appends imported players and preserves optional photo references', () => {
    const t = addPlayer(draft(), 'Existing');
    const imported = importPlayers(t, [
      { displayName: 'José', photoRef: 'photo/jose.jpg' },
      { displayName: 'Müller' },
    ]);

    expect(imported.players.map((p) => p.displayName)).toEqual(['Existing', 'José', 'Müller']);
    expect(imported.players[1]?.photoRef).toBe('photo/jose.jpg');
    expect(imported.events.slice(-2).map((event) => event.description)).toEqual([
      'José registered',
      'Müller registered',
    ]);
  });

  it('rejects case-insensitive duplicates against existing and imported players', () => {
    const t = addPlayer(draft(), 'José');

    expect(importError(t, [{ displayName: 'josé' }]).message).toMatch(/duplicate/i);
    expect(normalizePlayerName(' José ')).toBe(normalizePlayerName('jose\u0301'));
    expect(importError(t, [{ displayName: ' jose\u0301 ' }]).message).toContain(
      "Import row 1: Duplicate player name 'josé'",
    );
    expect(
      importError(t, [{ displayName: 'Müller' }, { displayName: 'mÜLLER' }]).message,
    ).toMatch(/duplicate/i);
  });

  it('enforces the 32-player limit including existing registrations', () => {
    let t = draft();
    for (let i = 0; i < MAX_PLAYERS - 1; i++) t = addPlayer(t, `Player ${i + 1}`);

    expect(importPlayers(t, [{ displayName: 'Player 32' }]).players).toHaveLength(MAX_PLAYERS);
    expect(importError(t, [{ displayName: 'Player 32' }, { displayName: 'Player 33' }]).message)
      .toMatch(/32/);
  });

  it('applies seed positions only in manual seeding mode', () => {
    let manual = addPlayer(addPlayer(draft('MANUAL'), 'Existing A'), 'Existing B');
    manual = importPlayers(manual, [
      { displayName: 'Seed 3', seed: 3 },
      { displayName: 'Seed 1', seed: 1 },
    ]);
    expect(manual.players.map((p) => p.displayName)).toEqual([
      'Seed 1',
      'Existing A',
      'Seed 3',
      'Existing B',
    ]);
    expect(manual.players.map((p) => p.seed)).toEqual([1, 2, 3, 4]);

    const registrationOrder = importPlayers(draft(), [
      { displayName: 'First', seed: 2 },
      { displayName: 'Second', seed: 1 },
    ]);
    expect(registrationOrder.players.map((p) => p.displayName)).toEqual(['First', 'Second']);
    expect(registrationOrder.players.map((p) => p.seed)).toEqual([undefined, undefined]);
  });

  it('rejects imports after the tournament has left DRAFT', () => {
    const ready = addPlayer(addPlayer(draft(), 'P1'), 'P2');
    const active = startTournament(ready);
    let thrown: unknown;
    try {
      importPlayers(active, [{ displayName: 'Late player' }]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe(ErrorCodes.TOURNAMENT_NOT_DRAFT);
  });

  it('round-trips legacy tournament JSON without photoRef', () => {
    const t = addPlayer(draft(), 'Legacy player');
    const legacyExport = JSON.parse(serializeTournament(t)) as {
      tournament: { players: Array<Record<string, unknown>> };
    };
    delete legacyExport.tournament.players[0]?.photoRef;

    const restored = deserializeTournament(JSON.stringify(legacyExport));
    expect(restored.players[0]).not.toHaveProperty('photoRef');
    expect(deserializeTournament(serializeTournament(restored))).toEqual(restored);
  });
});
