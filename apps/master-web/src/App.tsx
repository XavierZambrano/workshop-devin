import { useEffect, useRef, useState } from 'react';
import { useApp, type View } from './store';
import { SetupView } from './views/SetupView';
import { RoundView } from './views/RoundView';
import { StandingsView } from './views/StandingsView';
import { BracketView } from './views/BracketView';
import { PlayersView } from './views/PlayersView';
import { HistoryView } from './views/HistoryView';
import { ConfirmDialog } from './components/Modal';

const NAV: Array<{ key: View; label: string }> = [
  { key: 'tournament', label: 'Tournament' },
  { key: 'round', label: 'Round' },
  { key: 'standings', label: 'Standings' },
  { key: 'bracket', label: 'Bracket' },
  { key: 'players', label: 'Players' },
  { key: 'history', label: 'History' },
];

export default function App() {
  const { hydrated, tournament, view, setView, notice, dismissNotice, init, exportJson, importJson, newTournament } =
    useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(dismissNotice, 6000);
    return () => clearTimeout(id);
  }, [notice, dismissNotice]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  const nav = NAV.filter(
    (n) => n.key !== 'bracket' || (tournament?.format === 'SINGLE_ELIMINATION' && tournament.status !== 'DRAFT'),
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-extrabold tracking-tight">Tournament Runner</span>
            {tournament && (
              <span className="text-slate-400">
                · {tournament.name}
                <span
                  className={`ml-2 rounded border px-1.5 py-0.5 text-xs font-semibold ${
                    tournament.status === 'ACTIVE'
                      ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                      : tournament.status === 'COMPLETE'
                        ? 'border-sky-700 bg-sky-950/60 text-sky-300'
                        : 'border-slate-600 bg-slate-800 text-slate-300'
                  }`}
                >
                  {tournament.status}
                </span>
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={exportJson}
              disabled={!tournament}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
            >
              Export
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
            >
              Import
            </button>
            <button
              onClick={() => setConfirmNew(true)}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold hover:bg-sky-600"
            >
              New Tournament
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) importJson(await file.text());
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {tournament && (
          <nav className="mx-auto flex max-w-7xl gap-1 px-4 pb-2" aria-label="Main">
            {nav.map((n) => (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                aria-current={view === n.key ? 'page' : undefined}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  view === n.key ? 'bg-sky-900/60 text-sky-200' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {notice && (
        <div className="mx-auto mt-4 max-w-7xl px-4">
          <div
            role="alert"
            className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
              notice.kind === 'error'
                ? 'border-red-800 bg-red-950/60 text-red-200'
                : 'border-emerald-800 bg-emerald-950/60 text-emerald-200'
            }`}
          >
            <span>{notice.text}</span>
            <button onClick={dismissNotice} aria-label="Dismiss" className="ml-4 px-2">
              ✕
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!tournament ? (
          <EmptyHome />
        ) : view === 'tournament' ? (
          <SetupView t={tournament} />
        ) : view === 'round' ? (
          <RoundView t={tournament} />
        ) : view === 'standings' ? (
          <StandingsView t={tournament} />
        ) : view === 'bracket' ? (
          <BracketView t={tournament} />
        ) : view === 'players' ? (
          <PlayersView t={tournament} />
        ) : (
          <HistoryView t={tournament} />
        )}
      </main>

      {confirmNew && (
        <ConfirmDialog
          title="Create a new tournament?"
          body={
            tournament
              ? 'The current tournament stays saved in this browser, but consider Exporting it first. A fresh draft will become active.'
              : 'Create a fresh draft tournament?'
          }
          confirmLabel="New tournament"
          onConfirm={() => {
            newTournament();
            setConfirmNew(false);
          }}
          onCancel={() => setConfirmNew(false)}
        />
      )}
    </div>
  );
}

function EmptyHome() {
  const newTournament = useApp((s) => s.newTournament);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-700 bg-slate-900 p-10 text-center">
      <h1 className="text-2xl font-bold">No tournament loaded</h1>
      <p className="mt-2 text-slate-400">
        Create a tournament or import a previously exported JSON file.
      </p>
      <button
        onClick={newTournament}
        className="mt-6 rounded-lg bg-sky-700 px-6 py-3 font-semibold hover:bg-sky-600"
      >
        Create Tournament
      </button>
    </div>
  );
}
