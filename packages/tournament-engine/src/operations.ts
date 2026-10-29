/**
 * Shared, format-agnostic tournament operations. Every operation is a pure
 * function: it clones the tournament, mutates the draft, appends audit
 * events, and returns the new state. The UI layer replaces its reference.
 */
import type {
  MatchResult,
  PenaltyType,
  Player,
  Tournament,
  TournamentEvent,
  TournamentFormat,
} from './model/types';
import { DEFAULT_SCORING, MAX_PLAYERS, MIN_PLAYERS, SCHEMA_VERSION } from './model/types';
import type { SeedingMode } from './model/types';
import { DomainError, ErrorCodes } from './model/errors';
import { cloneTournament, makeEvent, newId, now } from './model/util';
import { getEngine, registerEngine } from './engine';
import { mulberry32, shuffled } from './rng';
import { singleEliminationEngine } from './formats/single-elimination';
import { swissEngine } from './formats/swiss';

registerEngine(singleEliminationEngine);
registerEngine(swissEngine);

// ---------------------------------------------------------------------------
// Construction / setup
// ---------------------------------------------------------------------------

export interface CreateTournamentInput {
  name: string;
  format: TournamentFormat;
  seedingMode?: SeedingMode;
  plannedRounds?: number;
  randomSeed?: number;
}

export function createTournament(input: CreateTournamentInput): Tournament {
  const t: Tournament = {
    id: newId('t'),
    name: input.name.trim() || 'Untitled Tournament',
    format: input.format,
    status: 'DRAFT',
    players: [],
    rounds: [],
    matches: [],
    penalties: [],
    warnings: [],
    events: [],
    settings: {
      seedingMode: input.seedingMode ?? 'RANDOM',
      randomSeed: input.randomSeed ?? Math.floor(Math.random() * 2 ** 31),
      plannedRounds: input.plannedRounds,
      scoring: { ...DEFAULT_SCORING },
    },
    createdAt: now(),
    updatedAt: now(),
    schemaVersion: SCHEMA_VERSION,
  };
  t.events.push(makeEvent('TOURNAMENT_CREATED', `Tournament "${t.name}" created (${input.format})`));
  return t;
}

function draft(t: Tournament): Tournament {
  const copy = cloneTournament(t);
  copy.updatedAt = now();
  return copy;
}

function requireDraft(t: Tournament) {
  if (t.status !== 'DRAFT') {
    throw new DomainError(ErrorCodes.TOURNAMENT_NOT_DRAFT, 'Tournament has already started');
  }
}

export function updateTournamentSettings(
  t: Tournament,
  patch: Partial<{ name: string; seedingMode: SeedingMode; plannedRounds: number | undefined; randomSeed: number }>,
): Tournament {
  requireDraft(t);
  const d = draft(t);
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new DomainError(ErrorCodes.PLAYER_NAME_EMPTY, 'Name required');
    d.name = patch.name.trim();
  }
  if (patch.seedingMode !== undefined) d.settings.seedingMode = patch.seedingMode;
  if (patch.plannedRounds !== undefined) d.settings.plannedRounds = patch.plannedRounds;
  if (patch.randomSeed !== undefined) d.settings.randomSeed = patch.randomSeed;
  return d;
}

export function addPlayer(t: Tournament, displayName: string): Tournament {
  requireDraft(t);
  const name = displayName.trim();
  if (!name) throw new DomainError(ErrorCodes.PLAYER_NAME_EMPTY, 'Player name is required');
  if (t.players.length >= MAX_PLAYERS) {
    throw new DomainError(ErrorCodes.TOO_MANY_PLAYERS, `Maximum of ${MAX_PLAYERS} players`);
  }
  const d = draft(t);
  const player = { id: newId('p'), displayName: name, status: 'ACTIVE' as const, createdAt: now() };
  d.players.push(player);
  d.events.push(
    makeEvent('PLAYER_REGISTERED', `${name} registered`, { playerId: player.id }),
  );
  return d;
}

export function normalizePlayerName(displayName: string): string {
  return displayName.trim().normalize('NFC').toLowerCase();
}

export function importPlayers(
  t: Tournament,
  rows: Array<{ displayName: string; seed?: number; photoRef?: string }>,
): Tournament {
  requireDraft(t);
  const problems: string[] = [];
  if (t.players.length + rows.length > MAX_PLAYERS) {
    problems.push(`Maximum of ${MAX_PLAYERS} players, including existing registrations`);
  }

  const seenNames = new Set(
    t.players.map((player) => normalizePlayerName(player.displayName)),
  );
  const normalizedRows = rows.map((row, index) => {
    const displayName =
      typeof row.displayName === 'string' ? row.displayName.trim().normalize('NFC') : '';
    const nameKey = normalizePlayerName(displayName);
    if (!displayName) {
      problems.push(`Import row ${index + 1}: Player name is required`);
    } else if (seenNames.has(nameKey)) {
      problems.push(`Import row ${index + 1}: Duplicate player name '${displayName}'`);
    } else {
      seenNames.add(nameKey);
    }
    if (row.seed !== undefined && (!Number.isInteger(row.seed) || row.seed <= 0)) {
      problems.push(`Import row ${index + 1}: Seed must be a positive integer`);
    }
    return { ...row, displayName };
  });

  if (problems.length > 0) {
    throw new DomainError(ErrorCodes.IMPORT_INVALID, `Player import failed:\n${problems.join('\n')}`);
  }

  let result = t;
  for (const row of normalizedRows) {
    result = addPlayer(result, row.displayName);
    const player = result.players[result.players.length - 1]!;
    if (row.photoRef !== undefined) player.photoRef = row.photoRef;
    if (result.settings.seedingMode === 'MANUAL' && row.seed !== undefined) {
      player.seed = row.seed;
    }
  }

  if (
    result.settings.seedingMode === 'MANUAL' &&
    normalizedRows.some((row) => row.seed !== undefined)
  ) {
    const positions = new Array<Player | undefined>(result.players.length);
    const seeded = result.players
      .map((player, index) => ({ player, index }))
      .filter((item) => item.player.seed !== undefined)
      .sort((a, b) => a.player.seed! - b.player.seed! || a.index - b.index);

    for (const { player } of seeded) {
      let position = Math.max(0, Math.min(player.seed! - 1, positions.length - 1));
      while (position < positions.length && positions[position]) position++;
      if (position >= positions.length) {
        position = 0;
        while (position < positions.length && positions[position]) position++;
      }
      if (position < positions.length) positions[position] = player;
    }

    const unseeded = result.players.filter((player) => player.seed === undefined);
    let nextUnseeded = 0;
    const ordered = Array.from(
      { length: positions.length },
      (_, index) => positions[index] ?? unseeded[nextUnseeded++]!,
    );
    result = reorderPlayers(result, ordered.map((player) => player.id));
  }

  return result;
}

export function updatePlayer(
  t: Tournament,
  playerId: string,
  patch: { displayName?: string; seed?: number },
): Tournament {
  const d = draft(t);
  const p = d.players.find((x) => x.id === playerId);
  if (!p) throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player not found');
  if (patch.displayName !== undefined) {
    const name = patch.displayName.trim();
    if (!name) throw new DomainError(ErrorCodes.PLAYER_NAME_EMPTY, 'Player name is required');
    p.displayName = name;
  }
  if (patch.seed !== undefined) {
    if (patch.seed !== undefined && d.players.some((x) => x.id !== playerId && x.seed === patch.seed)) {
      throw new DomainError(ErrorCodes.DUPLICATE_SEED, `Seed ${patch.seed} is already assigned`);
    }
    p.seed = patch.seed;
  }
  d.events.push(
    makeEvent('PLAYER_UPDATED', `${p.displayName} updated`, { playerId: p.id }),
  );
  return d;
}

export function removePlayer(t: Tournament, playerId: string): Tournament {
  requireDraft(t);
  const d = draft(t);
  const idx = d.players.findIndex((x) => x.id === playerId);
  if (idx < 0) throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player not found');
  const [p] = d.players.splice(idx, 1);
  d.events.push(
    makeEvent('PLAYER_REMOVED', `${p!.displayName} removed from registration`, {
      playerId: p!.id,
    }),
  );
  return d;
}

/** Re-shuffle seeds (draft only). Applies immediately for MANUAL/RANDOM views. */
export function randomizeSeeds(t: Tournament): Tournament {
  requireDraft(t);
  const d = draft(t);
  d.settings.randomSeed = Math.floor(Math.random() * 2 ** 31);
  const ordered = shuffled([...d.players], mulberry32(d.settings.randomSeed));
  const seedOf = new Map(ordered.map((p, i) => [p.id, i + 1]));
  for (const p of d.players) p.seed = seedOf.get(p.id);
  return d;
}

/** Reorder players (used for manual seeding UI and registration order). */
export function reorderPlayers(t: Tournament, orderedIds: string[]): Tournament {
  requireDraft(t);
  const d = draft(t);
  const byId = new Map(d.players.map((p) => [p.id, p]));
  if (orderedIds.length !== d.players.length || orderedIds.some((id) => !byId.has(id))) {
    throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player order must contain every player');
  }
  d.players = orderedIds.map((id) => byId.get(id)!);
  d.players.forEach((p, i) => {
    p.seed = i + 1;
  });
  return d;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startTournament(t: Tournament): Tournament {
  requireDraft(t);
  const engine = getEngineOrThrow(t.format);
  if (t.players.length < engine.minPlayers) {
    throw new DomainError(
      ErrorCodes.NOT_ENOUGH_PLAYERS,
      `Need at least ${engine.minPlayers} players to start`,
    );
  }
  if (t.players.length > engine.maxPlayers) {
    throw new DomainError(
      ErrorCodes.TOO_MANY_PLAYERS,
      `Format supports at most ${engine.maxPlayers} players`,
    );
  }
  if (t.format === 'SWISS') {
    const planned = t.settings.plannedRounds ?? engine.recommendedRoundCount!(t.players.length);
    if (planned < 1) {
      throw new DomainError(ErrorCodes.INVALID_RESULT, 'Swiss needs at least 1 planned round');
    }
  }

  const d = draft(t);
  const out = engine.start(d);
  if (out.players) d.players = out.players;
  d.rounds = out.rounds;
  d.matches = out.matches;
  d.status = 'ACTIVE';
  d.events.push(
    makeEvent(
      'TOURNAMENT_STARTED',
      `Tournament started with ${d.players.length} players`,
      undefined,
      { format: t.format },
    ),
  );
  for (const r of out.rounds) {
    const count = out.matches.filter((m) => m.roundId === r.id).length;
    d.events.push(
      makeEvent('ROUND_CREATED', `${r.name ?? `Round ${r.number}`} generated (${count} matches)`, {
        roundId: r.id,
      }),
    );
  }
  engine.afterStart?.(d);
  refreshRoundStatuses(d);
  return d;
}

function getEngineOrThrow(format: TournamentFormat) {
  return getEngine(format);
}

function refreshRoundStatuses(t: Tournament) {
  for (const r of t.rounds) {
    const ms = t.matches.filter((m) => m.roundId === r.id);
    if (ms.length === 0 || ms.every((m) => m.status === 'SCHEDULED')) {
      r.status = r.status === 'COMPLETE' ? 'COMPLETE' : 'PENDING';
    } else if (ms.every((m) => m.status === 'COMPLETE' || m.status === 'VOID')) {
      r.status = 'COMPLETE';
    } else {
      r.status = 'ACTIVE';
    }
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const ENTERABLE_RESULTS: MatchResult[] = ['PLAYER_A_WIN', 'PLAYER_B_WIN', 'DRAW', 'DOUBLE_LOSS'];

function playerName(t: Tournament, id?: string): string {
  if (!id) return 'TBD';
  return t.players.find((p) => p.id === id)?.displayName ?? 'Unknown';
}

function resultDescription(t: Tournament, m: { playerAId?: string; playerBId?: string }, result: MatchResult): string {
  const a = playerName(t, m.playerAId);
  const b = playerName(t, m.playerBId);
  switch (result) {
    case 'PLAYER_A_WIN':
      return `${a} defeated ${b}`;
    case 'PLAYER_B_WIN':
      return `${b} defeated ${a}`;
    case 'DRAW':
      return `${a} and ${b} drew`;
    case 'DOUBLE_LOSS':
      return `${a} and ${b} — double loss`;
    case 'BYE':
      return `${a} received a bye`;
    default:
      return `${a} vs ${b}`;
  }
}

function requireActive(t: Tournament) {
  if (t.status !== 'ACTIVE') {
    throw new DomainError(ErrorCodes.TOURNAMENT_NOT_ACTIVE, 'Tournament is not active');
  }
}

export function recordResult(t: Tournament, matchId: string, result: MatchResult): Tournament {
  requireActive(t);
  if (!ENTERABLE_RESULTS.includes(result)) {
    throw new DomainError(ErrorCodes.INVALID_RESULT, `Result ${result} cannot be entered manually`);
  }
  const d = draft(t);
  const m = d.matches.find((x) => x.id === matchId);
  if (!m) throw new DomainError(ErrorCodes.MATCH_NOT_FOUND, 'Match not found');
  if (m.status !== 'SCHEDULED' && m.status !== 'ACTIVE') {
    throw new DomainError(ErrorCodes.MATCH_NOT_PLAYABLE, 'Match already has a result — use Correct instead');
  }
  if (!m.playerAId || !m.playerBId) {
    throw new DomainError(ErrorCodes.MATCH_NOT_PLAYABLE, 'Match is waiting on players');
  }

  m.result = result;
  m.status = 'COMPLETE';
  m.completedAt = now();
  d.events.push(
    makeEvent('MATCH_RESULT_RECORDED', resultDescription(d, m, result), {
      matchId: m.id,
      roundId: m.roundId,
    }),
  );

  const engine = getEngineOrThrow(d.format);
  engine.afterResultRecorded(d, m);
  refreshRoundStatuses(d);
  emitRoundCompletions(d, t);
  return d;
}

export function correctResult(t: Tournament, matchId: string, result: MatchResult): Tournament {
  // Corrections are also allowed on completed tournaments: the engines
  // un-complete/re-evaluate as needed.
  if (t.status === 'DRAFT') {
    throw new DomainError(ErrorCodes.TOURNAMENT_NOT_ACTIVE, 'Tournament has not started');
  }
  if (!ENTERABLE_RESULTS.includes(result)) {
    throw new DomainError(ErrorCodes.INVALID_RESULT, `Result ${result} cannot be entered manually`);
  }
  const d = draft(t);
  const m = d.matches.find((x) => x.id === matchId);
  if (!m) throw new DomainError(ErrorCodes.MATCH_NOT_FOUND, 'Match not found');
  if (m.status !== 'COMPLETE') {
    throw new DomainError(ErrorCodes.MATCH_NOT_COMPLETE, 'Only completed matches can be corrected');
  }
  if (m.result === 'BYE' || m.result === 'PENDING') {
    throw new DomainError(ErrorCodes.MATCH_NOT_CORRECTABLE, 'This match cannot be corrected');
  }
  if (m.result === result) {
    throw new DomainError(ErrorCodes.INVALID_RESULT, 'Result is unchanged');
  }

  const old = m.result;
  const before = resultDescription(d, m, old);
  m.result = result;
  m.correctedAt = now();
  const after = resultDescription(d, m, result);
  d.events.push(
    makeEvent('MATCH_RESULT_CORRECTED', `${before} — corrected to: ${after}`, {
      matchId: m.id,
      roundId: m.roundId,
    }),
  );

  const engine = getEngineOrThrow(d.format);
  engine.afterResultCorrected?.(d, m, old);
  refreshRoundStatuses(d);
  return d;
}

/** Matches in the latest round that still need results. */
export function pendingMatchCount(t: Tournament): number {
  const round = t.rounds[t.rounds.length - 1];
  if (!round) return 0;
  return t.matches.filter(
    (m) => m.roundId === round.id && m.status !== 'COMPLETE' && m.status !== 'VOID',
  ).length;
}

export function canGenerateNextRound(t: Tournament): {
  ok: boolean;
  reason?: string;
  pendingMatches?: number;
} {
  return getEngineOrThrow(t.format).canGenerateNextRound(t);
}

export function generateNextRound(t: Tournament): Tournament {
  requireActive(t);
  const d = draft(t);
  const engine = getEngineOrThrow(d.format);
  if (!engine.nextRound) {
    throw new DomainError(
      ErrorCodes.NOT_SUPPORTED,
      'This format advances automatically — no manual round generation',
    );
  }
  const check = engine.canGenerateNextRound(d);
  if (!check.ok) {
    throw new DomainError(ErrorCodes.ROUND_INCOMPLETE, check.reason ?? 'Cannot generate next round');
  }
  const { round, matches } = engine.nextRound(d);
  d.rounds.push(round);
  d.matches.push(...matches);
  const bye = matches.find((m) => m.result === 'BYE');
  d.events.push(
    makeEvent(
      'ROUND_CREATED',
      `${round.name ?? `Round ${round.number}`} generated (${matches.length} matches${
        bye ? `, bye: ${playerName(d, bye.playerAId)}` : ''
      })`,
      { roundId: round.id },
    ),
  );
  refreshRoundStatuses(d);
  return d;
}

function emitRoundCompletions(d: Tournament, before: Tournament) {
  for (const r of d.rounds) {
    const prev = before.rounds.find((x) => x.id === r.id);
    if (r.status === 'COMPLETE' && prev?.status !== 'COMPLETE') {
      d.events.push(
        makeEvent('ROUND_COMPLETED', `${r.name ?? `Round ${r.number}`} completed`, {
          roundId: r.id,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Discipline: drops, disqualification, warnings, penalties
// ---------------------------------------------------------------------------

function currentRoundNumber(t: Tournament): number | undefined {
  return t.rounds[t.rounds.length - 1]?.number;
}

export function dropPlayer(t: Tournament, playerId: string, reason?: string): Tournament {
  const d = draft(t);
  const p = d.players.find((x) => x.id === playerId);
  if (!p) throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player not found');
  if (p.status !== 'ACTIVE') {
    throw new DomainError(ErrorCodes.PLAYER_NOT_ACTIVE, `${p.displayName} is not active`);
  }
  p.status = 'DROPPED';
  p.statusReason = reason;
  p.statusChangedAt = now();
  p.statusRoundNumber = currentRoundNumber(d);
  d.events.push(
    makeEvent('PLAYER_DROPPED', `${p.displayName} dropped${reason ? ` (${reason})` : ''}`, {
      playerId: p.id,
    }),
  );
  if (d.status === 'ACTIVE') getEngineOrThrow(d.format).afterPlayerRemoved(d, p);
  refreshRoundStatuses(d);
  return d;
}

export function disqualifyPlayer(
  t: Tournament,
  playerId: string,
  reason: string,
  notes?: string,
): Tournament {
  const d = draft(t);
  const p = d.players.find((x) => x.id === playerId);
  if (!p) throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player not found');
  if (p.status !== 'ACTIVE') {
    throw new DomainError(ErrorCodes.PLAYER_NOT_ACTIVE, `${p.displayName} is not active`);
  }
  if (!reason.trim()) {
    throw new DomainError(ErrorCodes.INVALID_RESULT, 'Disqualification requires a reason');
  }
  p.status = 'DISQUALIFIED';
  p.statusReason = reason;
  p.statusChangedAt = now();
  p.statusRoundNumber = currentRoundNumber(d);
  d.events.push(
    makeEvent(
      'PLAYER_DISQUALIFIED',
      `${p.displayName} disqualified — ${reason}${notes ? ` (${notes})` : ''}`,
      { playerId: p.id },
      { reason, notes },
    ),
  );
  if (d.status === 'ACTIVE') getEngineOrThrow(d.format).afterPlayerRemoved(d, p);
  refreshRoundStatuses(d);
  return d;
}

export function issueWarning(
  t: Tournament,
  input: { playerId: string; reason: string; notes?: string; roundId?: string; matchId?: string },
): Tournament {
  const d = draft(t);
  const p = d.players.find((x) => x.id === input.playerId);
  if (!p) throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player not found');
  if (!input.reason.trim()) {
    throw new DomainError(ErrorCodes.INVALID_RESULT, 'Warning reason is required');
  }
  const w = {
    id: newId('warn'),
    playerId: p.id,
    roundId: input.roundId ?? d.rounds[d.rounds.length - 1]?.id,
    matchId: input.matchId,
    reason: input.reason.trim(),
    notes: input.notes,
    createdAt: now(),
    active: true,
  };
  d.warnings.push(w);
  d.events.push(
    makeEvent('WARNING_ISSUED', `${p.displayName} received warning: ${w.reason}`, {
      playerId: p.id,
      warningId: w.id,
      matchId: w.matchId,
      roundId: w.roundId,
    }),
  );
  return d;
}

export function revokeWarning(t: Tournament, warningId: string): Tournament {
  const d = draft(t);
  const w = d.warnings.find((x) => x.id === warningId);
  if (!w) throw new DomainError(ErrorCodes.ENTITY_NOT_FOUND, 'Warning not found');
  w.active = false;
  const name = playerName(d, w.playerId);
  d.events.push(
    makeEvent('WARNING_REVOKED', `Warning revoked for ${name}: ${w.reason}`, {
      playerId: w.playerId,
      warningId: w.id,
    }),
  );
  return d;
}

export function issuePenalty(
  t: Tournament,
  input: {
    playerId: string;
    type: PenaltyType;
    reason: string;
    notes?: string;
    roundId?: string;
    matchId?: string;
  },
): Tournament {
  const d = draft(t);
  const p = d.players.find((x) => x.id === input.playerId);
  if (!p) throw new DomainError(ErrorCodes.PLAYER_NOT_FOUND, 'Player not found');
  if (!input.reason.trim()) {
    throw new DomainError(ErrorCodes.INVALID_RESULT, 'Penalty reason is required');
  }
  const pen = {
    id: newId('pen'),
    playerId: p.id,
    roundId: input.roundId ?? d.rounds[d.rounds.length - 1]?.id,
    matchId: input.matchId,
    type: input.type,
    reason: input.reason.trim(),
    notes: input.notes,
    createdAt: now(),
    active: true,
  };
  d.penalties.push(pen);
  d.events.push(
    makeEvent('PENALTY_ISSUED', `${p.displayName} penalty (${pen.type}): ${pen.reason}`, {
      playerId: p.id,
      penaltyId: pen.id,
      matchId: pen.matchId,
      roundId: pen.roundId,
    }),
  );
  return d;
}

export function revokePenalty(t: Tournament, penaltyId: string): Tournament {
  const d = draft(t);
  const pen = d.penalties.find((x) => x.id === penaltyId);
  if (!pen) throw new DomainError(ErrorCodes.ENTITY_NOT_FOUND, 'Penalty not found');
  pen.active = false;
  const name = playerName(d, pen.playerId);
  d.events.push(
    makeEvent('PENALTY_REVOKED', `Penalty revoked for ${name} (${pen.type}): ${pen.reason}`, {
      playerId: pen.playerId,
      penaltyId: pen.id,
    }),
  );
  return d;
}
