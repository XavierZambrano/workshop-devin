import { useEffect, useState } from 'react';
import { listTournaments, type StoredTournament } from '../db';
import { useApp } from '../store';
import { ConfirmDialog, Modal } from './Modal';

function formatName(format: StoredTournament['data']['format']): string {
  if (format === 'SINGLE_ELIMINATION') return 'Single Elimination';
  if (format === 'SWISS') return 'Swiss';
  return 'Round Robin';
}

export function TournamentPicker() {
  const [open, setOpen] = useState(false);
  const [tournaments, setTournaments] = useState<StoredTournament[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StoredTournament | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeId = useApp((state) => state.tournament?.id ?? null);
  const openTournament = useApp((state) => state.openTournament);
  const renameTournament = useApp((state) => state.renameTournament);
  const deleteActiveOrSavedTournament = useApp((state) => state.deleteTournament);

  async function refresh() {
    try {
      setTournaments(await listTournaments());
      setLoadError(null);
    } catch (error) {
      setLoadError(`Could not load tournaments: ${String(error)}`);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    await renameTournament(id, renameValue);
    setEditingId(null);
    await refresh();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await deleteActiveOrSavedTournament(deleteTarget.id);
    setDeleteTarget(null);
    await refresh();
  }

  const deletingActive = deleteTarget?.id === activeId;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
      >
        Tournaments
      </button>
      {open && (
        <Modal title="Saved Tournaments" onClose={() => setOpen(false)}>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            {loadError && (
              <p role="alert" className="rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
                {loadError}
              </p>
            )}
            {tournaments.length === 0 && !loadError && (
              <p className="text-sm text-slate-400">No saved tournaments.</p>
            )}
            {tournaments.map((row) => {
              const isActive = row.id === activeId;
              return (
                <section
                  key={row.id}
                  className={`rounded-lg border p-3 ${
                    isActive ? 'border-sky-600 bg-sky-950/30' : 'border-slate-700 bg-slate-950/40'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {editingId === row.id ? (
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveRename(row.id);
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            aria-label="Tournament name"
                            className="min-w-0 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
                          />
                          <button
                            type="submit"
                            disabled={!renameValue.trim()}
                            className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <h3 className="break-words font-semibold text-slate-100">{row.data.name}</h3>
                      )}
                      <p className="mt-1 text-xs text-slate-400">
                        {formatName(row.data.format)} · {row.data.status} ·{' '}
                        {new Date(row.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    {isActive && (
                      <span className="rounded border border-sky-700 px-2 py-0.5 text-xs font-semibold text-sky-300">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        void openTournament(row.id);
                        setOpen(false);
                      }}
                      className="rounded-md bg-sky-800 px-3 py-1.5 text-xs font-semibold hover:bg-sky-700"
                    >
                      Open
                    </button>
                    {editingId !== row.id && (
                      <button
                        onClick={() => {
                          setEditingId(row.id);
                          setRenameValue(row.data.name);
                        }}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs hover:bg-slate-800"
                      >
                        Rename
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(row)}
                      className="rounded-md border border-red-800 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/50"
                    >
                      Delete
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={deletingActive ? 'Delete active tournament?' : 'Delete saved tournament?'}
          body={
            deletingActive
              ? 'This is the active tournament. Deleting it will open the most recently updated saved tournament, or create a new draft if none remain.'
              : `Delete "${deleteTarget.data.name}"? This cannot be undone.`
          }
          confirmLabel="Delete tournament"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
