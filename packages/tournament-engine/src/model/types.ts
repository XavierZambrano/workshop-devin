/**
 * Core domain model for the tournament engine.
 * This file is framework-independent: no React, no DOM requirements.
 */

export const SCHEMA_VERSION = 1;

export type TournamentFormat = 'SINGLE_ELIMINATION' | 'SWISS';

export type TournamentStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETE';

export type PlayerStatus = 'ACTIVE' | 'DROPPED' | 'DISQUALIFIED';

export type MatchResult =
  | 'PENDING'
  | 'PLAYER_A_WIN'
  | 'PLAYER_B_WIN'
  | 'DRAW'
  | 'DOUBLE_LOSS'
  | 'BYE';

export type MatchStatus = 'SCHEDULED' | 'ACTIVE' | 'COMPLETE' | 'VOID';

export type RoundStatus = 'PENDING' | 'ACTIVE' | 'COMPLETE';

export type PenaltyType =
  | 'WARNING'
  | 'MATCH_LOSS'
  | 'ROUND_LOSS'
  | 'DISQUALIFICATION'
  | 'CUSTOM';

export type SeedingMode = 'RANDOM' | 'REGISTRATION_ORDER' | 'MANUAL';

export interface Player {
  id: string;
  displayName: string;
  /** 1-based seed assigned at tournament start (or manually during setup). */
  seed?: number;
  status: PlayerStatus;
  createdAt: string;
  /** Reason recorded when the player was dropped or disqualified. */
  statusReason?: string;
  statusChangedAt?: string;
  statusRoundNumber?: number;
}

export interface Match {
  id: string;
  roundId: string;
  roundNumber: number;
  /**
   * Player slots. Either may be undefined while a single-elimination bracket
   * match is still waiting on feeder matches. A bye has playerBId undefined.
   */
  playerAId?: string;
  playerBId?: string;
  result: MatchResult;
  status: MatchStatus;
  tableNumber?: number;
  /** Single-elimination bracket wiring: where the winner advances. */
  nextMatchId?: string;
  nextSlot?: 'A' | 'B';
  createdAt: string;
  completedAt?: string;
  correctedAt?: string;
}

export interface Round {
  id: string;
  number: number;
  name?: string;
  status: RoundStatus;
  matchIds: string[];
  createdAt: string;
}

export interface WarningRecord {
  id: string;
  playerId: string;
  roundId?: string;
  matchId?: string;
  reason: string;
  notes?: string;
  createdAt: string;
  active: boolean;
}

export interface Penalty {
  id: string;
  playerId: string;
  roundId?: string;
  matchId?: string;
  type: PenaltyType;
  reason: string;
  notes?: string;
  createdAt: string;
  active: boolean;
}

export type TournamentEventType =
  | 'TOURNAMENT_CREATED'
  | 'TOURNAMENT_STARTED'
  | 'TOURNAMENT_COMPLETED'
  | 'PLAYER_REGISTERED'
  | 'PLAYER_UPDATED'
  | 'PLAYER_REMOVED'
  | 'PLAYER_DROPPED'
  | 'PLAYER_DISQUALIFIED'
  | 'ROUND_CREATED'
  | 'ROUND_COMPLETED'
  | 'MATCH_RESULT_RECORDED'
  | 'MATCH_RESULT_CORRECTED'
  | 'MATCH_VOIDED'
  | 'WARNING_ISSUED'
  | 'WARNING_REVOKED'
  | 'PENALTY_ISSUED'
  | 'PENALTY_REVOKED';

export interface TournamentEvent {
  id: string;
  timestamp: string;
  type: TournamentEventType;
  /** Human-readable audit line, e.g. "Alice defeated Bob". */
  description: string;
  entityIds?: {
    playerId?: string;
    matchId?: string;
    roundId?: string;
    penaltyId?: string;
    warningId?: string;
  };
  metadata?: Record<string, unknown>;
}

/** Centralized scoring configuration. Never hardcode 3/1/0 elsewhere. */
export interface ScoringConfig {
  win: number;
  draw: number;
  loss: number;
  /** Points awarded for a bye. Defaults to the same as a win. */
  bye: number;
}

export interface TournamentSettings {
  seedingMode: SeedingMode;
  /** Seed for the deterministic PRNG used for random seeding / pairings. */
  randomSeed: number;
  /** Planned Swiss round count (organizer-overridable before start). */
  plannedRounds?: number;
  scoring: ScoringConfig;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  players: Player[];
  rounds: Round[];
  matches: Match[];
  penalties: Penalty[];
  warnings: WarningRecord[];
  events: TournamentEvent[];
  settings: TournamentSettings;
  championId?: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export const DEFAULT_SCORING: ScoringConfig = { win: 3, draw: 1, loss: 0, bye: 3 };

export const MAX_PLAYERS = 32;
export const MIN_PLAYERS = 2;
