import type { TournamentEvent, TournamentEventType } from './types';

export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${uuid}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function makeEvent(
  type: TournamentEventType,
  description: string,
  entityIds?: TournamentEvent['entityIds'],
  metadata?: Record<string, unknown>,
): TournamentEvent {
  return { id: newId('evt'), timestamp: now(), type, description, entityIds, metadata };
}

/** Clone a tournament so operations can mutate a draft and return a new reference. */
export function cloneTournament<T>(value: T): T {
  return structuredClone(value);
}
