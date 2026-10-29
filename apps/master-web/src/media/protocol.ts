import type {
  MatchResult,
  MatchStatus,
  PlayerStatus,
  TournamentFormat,
  TournamentStatus,
} from '@tourney/engine';

export const CHANNEL_NAME = 'tourney-media';

export interface MediaPlayerSnapshot {
  id: string;
  displayName: string;
  seed?: number;
  status: PlayerStatus;
}

export interface MediaMatchSnapshot {
  id: string;
  roundNumber: number;
  playerAId?: string;
  playerBId?: string;
  result: MatchResult;
  status: MatchStatus;
}

export interface MediaStandingSnapshot {
  rank: number;
  playerId: string;
  points: number;
  record: string;
  matchWinPct: number;
  oppMatchWinPct: number;
}

export interface MediaSnapshot {
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  currentRoundNumber: number | null;
  players: MediaPlayerSnapshot[];
  matches: MediaMatchSnapshot[];
  standings: MediaStandingSnapshot[];
  championId: string | null;
}

export interface HelloMessage {
  type: 'hello';
}

export interface SnapshotMessage {
  type: 'snapshot';
  sessionId: string;
  seq: number;
  snapshot: MediaSnapshot;
}

export type MediaMessage = HelloMessage | SnapshotMessage;

export interface MediaChannelLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

export type MediaChannelFactory = (name: string) => MediaChannelLike;
