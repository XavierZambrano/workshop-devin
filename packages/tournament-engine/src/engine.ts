import type {
  Match,
  Player,
  Round,
  Tournament,
  TournamentEvent,
  TournamentFormat,
} from './model/types';
import { DomainError, ErrorCodes } from './model/errors';

/**
 * A tournament format engine owns everything format-specific:
 * how the tournament starts, how rounds are generated, what happens when a
 * result is recorded or corrected, and when the tournament is over.
 *
 * Engines mutate a draft Tournament that the caller has already cloned;
 * they push audit events via the helpers in model/util.
 */
export interface TournamentFormatEngine {
  readonly format: TournamentFormat;
  readonly minPlayers: number;
  readonly maxPlayers: number;

  /** Recommended default round count, where the format has one (Swiss). */
  recommendedRoundCount?(playerCount: number): number;

  /**
   * Produce the initial round(s)/bracket. May also update player seeds.
   * The caller sets tournament status to ACTIVE.
   */
  start(t: Tournament): {
    players?: Player[];
    rounds: Round[];
    matches: Match[];
  };

  /** Called after the start() output has been applied to the tournament. */
  afterStart?(t: Tournament): void;

  /** Whether a new round can be generated right now. */
  canGenerateNextRound(t: Tournament): {
    ok: boolean;
    reason?: string;
    pendingMatches?: number;
  };

  /** Generate the next round. Only formats that advance round-by-round implement this. */
  nextRound?(t: Tournament): { round: Round; matches: Match[] };

  /** Called after a match result is recorded (match is already COMPLETE). */
  afterResultRecorded(t: Tournament, match: Match): void;

  /** Called after a completed match's result is corrected (match already updated). */
  afterResultCorrected?(t: Tournament, match: Match, oldResult: Match['result']): void;

  /** Called when a player drops or is disqualified mid-tournament. */
  afterPlayerRemoved(t: Tournament, player: Player): void;

  isComplete(t: Tournament): boolean;
}

const engines = new Map<TournamentFormat, TournamentFormatEngine>();

export function registerEngine(engine: TournamentFormatEngine): void {
  engines.set(engine.format, engine);
}

export function getEngine(format: TournamentFormat): TournamentFormatEngine {
  const engine = engines.get(format);
  if (!engine) {
    throw new DomainError(ErrorCodes.NOT_SUPPORTED, `No engine registered for format ${format}`);
  }
  return engine;
}
