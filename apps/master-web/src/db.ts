import Dexie, { type Table } from 'dexie';
import type { Tournament } from '@tourney/engine';

export interface StoredTournament {
  id: string;
  updatedAt: string;
  data: Tournament;
}

interface MetaRow {
  key: string;
  value: string;
}

class TourneyDB extends Dexie {
  tournaments!: Table<StoredTournament, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('tournament-runner');
    this.version(1).stores({
      tournaments: 'id, updatedAt',
      meta: 'key',
    });
  }
}

export const db = new TourneyDB();

export async function persistTournament(t: Tournament): Promise<void> {
  await db.tournaments.put({ id: t.id, updatedAt: t.updatedAt, data: t });
  await db.meta.put({ key: 'activeTournamentId', value: t.id });
}

export async function loadActiveTournament(): Promise<Tournament | null> {
  const meta = await db.meta.get('activeTournamentId');
  if (meta?.value) {
    const row = await db.tournaments.get(meta.value);
    if (row) return row.data;
  }
  const latest = await db.tournaments.orderBy('updatedAt').reverse().first();
  return latest?.data ?? null;
}
