import type { Tournament } from './model/types';
import { SCHEMA_VERSION } from './model/types';
import { DomainError, ErrorCodes } from './model/errors';

/**
 * JSON export/import. Exports wrap the tournament in a small envelope so the
 * file is self-describing; the importer also accepts a bare tournament object.
 */

export interface TournamentExport {
  kind: 'tournament-export';
  schemaVersion: number;
  exportedAt: string;
  tournament: Tournament;
}

export function serializeTournament(t: Tournament): string {
  const envelope: TournamentExport = {
    kind: 'tournament-export',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tournament: t,
  };
  return JSON.stringify(envelope, null, 2);
}

const FORMATS = new Set(['SINGLE_ELIMINATION', 'SWISS', 'ROUND_ROBIN']);
const T_STATUSES = new Set(['DRAFT', 'ACTIVE', 'COMPLETE']);
const P_STATUSES = new Set(['ACTIVE', 'DROPPED', 'DISQUALIFIED']);
const M_RESULTS = new Set(['PENDING', 'PLAYER_A_WIN', 'PLAYER_B_WIN', 'DRAW', 'DOUBLE_LOSS', 'BYE']);
const M_STATUSES = new Set(['SCHEDULED', 'ACTIVE', 'COMPLETE', 'VOID']);
const PENALTY_TYPES = new Set(['WARNING', 'MATCH_LOSS', 'ROUND_LOSS', 'DISQUALIFICATION', 'CUSTOM']);

/** Validate a tournament object; returns a list of problems (empty = valid). */
export function validateTournamentShape(t: unknown): string[] {
  const problems: string[] = [];
  if (typeof t !== 'object' || t === null) return ['not an object'];
  const o = t as Record<string, unknown>;

  if (typeof o.id !== 'string' || !o.id) problems.push('missing id');
  if (typeof o.name !== 'string') problems.push('missing name');
  if (!FORMATS.has(o.format as string)) problems.push(`invalid format: ${String(o.format)}`);
  if (!T_STATUSES.has(o.status as string)) problems.push(`invalid status: ${String(o.status)}`);

  for (const key of ['players', 'rounds', 'matches', 'penalties', 'warnings', 'events'] as const) {
    if (!Array.isArray(o[key])) problems.push(`${key} must be an array`);
  }
  if (problems.length > 0) return problems;

  const players = o.players as Array<Record<string, unknown>>;
  const playerIds = new Set<string>();
  for (const [i, p] of players.entries()) {
    if (typeof p.id !== 'string' || !p.id) problems.push(`players[${i}] missing id`);
    else playerIds.add(p.id);
    if (typeof p.displayName !== 'string') problems.push(`players[${i}] missing displayName`);
    if (!P_STATUSES.has(p.status as string)) problems.push(`players[${i}] invalid status`);
  }

  const rounds = o.rounds as Array<Record<string, unknown>>;
  const roundIds = new Set<string>();
  for (const [i, r] of rounds.entries()) {
    if (typeof r.id !== 'string' || !r.id) problems.push(`rounds[${i}] missing id`);
    else roundIds.add(r.id);
    if (typeof r.number !== 'number') problems.push(`rounds[${i}] missing number`);
    if (!Array.isArray(r.matchIds)) problems.push(`rounds[${i}] matchIds must be an array`);
  }

  const matches = o.matches as Array<Record<string, unknown>>;
  for (const [i, m] of matches.entries()) {
    if (typeof m.id !== 'string' || !m.id) problems.push(`matches[${i}] missing id`);
    if (typeof m.roundId !== 'string' || !roundIds.has(m.roundId)) {
      problems.push(`matches[${i}] references unknown round`);
    }
    for (const slot of ['playerAId', 'playerBId'] as const) {
      const v = m[slot];
      if (v !== undefined && (typeof v !== 'string' || !playerIds.has(v))) {
        problems.push(`matches[${i}].${slot} references unknown player`);
      }
    }
    if (!M_RESULTS.has(m.result as string)) problems.push(`matches[${i}] invalid result`);
    if (!M_STATUSES.has(m.status as string)) problems.push(`matches[${i}] invalid status`);
  }

  for (const [i, w] of (o.warnings as Array<Record<string, unknown>>).entries()) {
    if (typeof w.id !== 'string' || !w.id) problems.push(`warnings[${i}] missing id`);
    if (typeof w.playerId !== 'string' || !playerIds.has(w.playerId)) {
      problems.push(`warnings[${i}] references unknown player`);
    }
    if (typeof w.reason !== 'string') problems.push(`warnings[${i}] missing reason`);
  }
  for (const [i, p] of (o.penalties as Array<Record<string, unknown>>).entries()) {
    if (typeof p.id !== 'string' || !p.id) problems.push(`penalties[${i}] missing id`);
    if (typeof p.playerId !== 'string' || !playerIds.has(p.playerId)) {
      problems.push(`penalties[${i}] references unknown player`);
    }
    if (!PENALTY_TYPES.has(p.type as string)) problems.push(`penalties[${i}] invalid type`);
  }

  if (o.championId !== undefined && !playerIds.has(o.championId as string)) {
    problems.push('championId references unknown player');
  }
  const settings = o.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== 'object') {
    problems.push('missing settings');
  } else if (typeof settings.randomSeed !== 'number' || typeof settings.scoring !== 'object') {
    problems.push('invalid settings');
  }

  return problems.slice(0, 20);
}

export function deserializeTournament(json: string): Tournament {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DomainError(ErrorCodes.IMPORT_INVALID_JSON, 'File is not valid JSON');
  }
  const obj = parsed as Record<string, unknown>;
  const candidate =
    obj.kind === 'tournament-export' && typeof obj.tournament === 'object'
      ? obj.tournament
      : parsed;
  const problems = validateTournamentShape(candidate);
  if (problems.length > 0) {
    throw new DomainError(
      ErrorCodes.IMPORT_INVALID_SHAPE,
      `Invalid tournament file: ${problems.join('; ')}`,
    );
  }
  return candidate as Tournament;
}
