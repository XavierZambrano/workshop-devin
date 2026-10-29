import { create } from 'zustand';
import type { Tournament } from '@tourney/engine';
import {
  createTournament,
  deserializeTournament,
  serializeTournament,
  updateTournamentSettings,
  DomainError,
  type CreateTournamentInput,
} from '@tourney/engine';
import {
  db,
  deleteTournament as deleteStoredTournament,
  listTournaments,
  loadActiveTournament,
  persistTournament,
  setActiveTournamentId,
} from './db';

export type View = 'tournament' | 'round' | 'standings' | 'bracket' | 'players' | 'history';

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

interface AppState {
  hydrated: boolean;
  tournament: Tournament | null;
  view: View;
  selectedPlayerId: string | null;
  notice: Notice | null;

  init(): Promise<void>;
  setView(view: View): void;
  selectPlayer(id: string | null): void;
  dismissNotice(): void;
  /** Run an engine operation, swap in the result, persist it. */
  mutate(op: (t: Tournament) => Tournament): void;
  createNew(input: CreateTournamentInput): void;
  importJson(text: string): boolean;
  exportJson(): void;
  /** Start over: keep the old tournament in IndexedDB but make a fresh draft. */
  newTournament(): void;
  openTournament(id: string): Promise<void>;
  renameTournament(id: string, name: string): Promise<void>;
  deleteTournament(id: string): Promise<void>;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tournament';
}

export const useApp = create<AppState>()((set, get) => ({
  hydrated: false,
  tournament: null,
  view: 'tournament',
  selectedPlayerId: null,
  notice: null,

  async init() {
    try {
      const t = await loadActiveTournament();
      set({ tournament: t, hydrated: true, view: t ? 'round' : 'tournament' });
      if (t && t.status === 'DRAFT') set({ view: 'tournament' });
    } catch {
      set({ hydrated: true });
    }
  },

  setView(view) {
    set({ view });
  },

  selectPlayer(id) {
    set({ selectedPlayerId: id, view: id ? 'players' : get().view });
  },

  dismissNotice() {
    set({ notice: null });
  },

  mutate(op) {
    const t = get().tournament;
    if (!t) return;
    try {
      const next = op(t);
      set({ tournament: next, notice: null });
      void persistTournament(next);
    } catch (e) {
      const text = e instanceof DomainError ? e.message : `Unexpected error: ${String(e)}`;
      set({ notice: { kind: 'error', text } });
    }
  },

  createNew(input) {
    try {
      const t = createTournament(input);
      set({ tournament: t, view: 'tournament', selectedPlayerId: null, notice: null });
      void persistTournament(t);
    } catch (e) {
      set({ notice: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
    }
  },

  importJson(text) {
    try {
      const t = deserializeTournament(text);
      set({
        tournament: t,
        view: t.status === 'DRAFT' ? 'tournament' : 'round',
        selectedPlayerId: null,
        notice: { kind: 'info', text: `Imported "${t.name}"` },
      });
      void persistTournament(t);
      return true;
    } catch (e) {
      set({
        notice: {
          kind: 'error',
          text: e instanceof DomainError ? e.message : 'Could not import file',
        },
      });
      return false;
    }
  },

  exportJson() {
    const t = get().tournament;
    if (!t) return;
    const json = serializeTournament(t);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${slug(t.name)}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  newTournament() {
    const t = createTournament({ name: '', format: 'SINGLE_ELIMINATION' });
    set({ tournament: t, view: 'tournament', selectedPlayerId: null, notice: null });
    void persistTournament(t);
  },

  async openTournament(id) {
    try {
      const row = await db.tournaments.get(id);
      if (!row) {
        set({ notice: { kind: 'error', text: 'Tournament not found' } });
        return;
      }
      await setActiveTournamentId(id);
      set({
        tournament: row.data,
        view: row.data.status === 'DRAFT' ? 'tournament' : 'round',
        selectedPlayerId: null,
        notice: null,
      });
    } catch (e) {
      set({ notice: { kind: 'error', text: `Could not open tournament: ${String(e)}` } });
    }
  },

  async renameTournament(id, name) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      set({ notice: { kind: 'error', text: 'Tournament name is required' } });
      return;
    }
    const current = get().tournament;
    if (current?.id === id && current.status === 'DRAFT') {
      get().mutate((t) => updateTournamentSettings(t, { name: normalizedName }));
      const renamed = get().tournament;
      if (renamed) await persistTournament(renamed);
      return;
    }
    try {
      const row = await db.tournaments.get(id);
      if (!row) {
        set({ notice: { kind: 'error', text: 'Tournament not found' } });
        return;
      }
      const updatedAt = new Date().toISOString();
      const data = { ...row.data, name: normalizedName, updatedAt };
      await db.tournaments.put({ id, updatedAt, data });
      if (get().tournament?.id === id) set({ tournament: data, notice: null });
    } catch (e) {
      set({ notice: { kind: 'error', text: `Could not rename tournament: ${String(e)}` } });
    }
  },

  async deleteTournament(id) {
    const wasActive = get().tournament?.id === id;
    try {
      await deleteStoredTournament(id);
      if (!wasActive || get().tournament?.id !== id) return;
      const remaining = await listTournaments();
      if (remaining[0]) {
        await get().openTournament(remaining[0].id);
      } else {
        get().newTournament();
        const fresh = get().tournament;
        if (fresh) await persistTournament(fresh);
      }
    } catch (e) {
      set({ notice: { kind: 'error', text: `Could not delete tournament: ${String(e)}` } });
    }
  },
}));
