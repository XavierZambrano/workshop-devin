import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  addPlayer,
  importPlayers,
  MAX_PLAYERS,
  parsePlayersCsv,
  removePlayer,
  recommendedSwissRounds,
  reorderPlayers,
  randomizeSeeds,
  startTournament,
  updatePlayer,
  updateTournamentSettings,
  type Player,
  type ParsedPlayersCsv,
  type SeedingMode,
  type Tournament,
  type TournamentFormat,
} from '@tourney/engine';
import { useApp } from '../store';
import { recordString, statusBadge } from '../helpers';
import { ConfirmDialog, Modal } from '../components/Modal';

function recommendedRounds(t: Tournament): number {
  return recommendedSwissRounds(t.players.length);
}

export function SetupView({ t }: { t: Tournament }) {
  if (t.status === 'DRAFT') return <DraftSetup t={t} />;
  return <TournamentOverview t={t} />;
}

/** Text input that commits on blur/Enter so clearing-and-retyping never throws. */
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => local.trim() && local !== value && onCommit(local)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
    />
  );
}

function PlayerNameInput({
  player,
  index,
  onCommit,
}: {
  player: Player;
  index: number;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(player.displayName);
  useEffect(() => setLocal(player.displayName), [player.displayName]);
  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => local.trim() && local !== player.displayName && onCommit(local)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={`Player ${index + 1} name`}
      className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-slate-700 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
    />
  );
}

function DraftSetup({ t }: { t: Tournament }) {
  const mutate = useApp((s) => s.mutate);
  const setView = useApp((s) => s.setView);
  const [name, setName] = useState('');
  const csvInput = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<ParsedPlayersCsv | null>(null);
  const [csvReadError, setCsvReadError] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    mutate((d) => addPlayer(d, name));
    setName('');
  };

  const move = (p: Player, dir: -1 | 1) => {
    const ids = t.players.map((x) => x.id);
    const i = ids.indexOf(p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    mutate((d) => reorderPlayers(d, ids));
  };

  const planned = t.settings.plannedRounds ?? recommendedRounds(t);
  const [starting, setStarting] = useState(false);

  const closeCsvPreview = () => {
    setCsvPreview(null);
    setCsvReadError(null);
  };

  const readCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        text = new TextDecoder('windows-1252').decode(buffer);
      }
      setCsvReadError(null);
      setCsvPreview(parsePlayersCsv(text));
    } catch (error) {
      setCsvReadError(error instanceof Error ? error.message : 'Could not read CSV file');
      setCsvPreview({ rows: [], errors: [], separator: ',', hasHeader: false });
    }
  };

  const importCsvPlayers = () => {
    if (!csvPreview) return;
    mutate((d) =>
      importPlayers(
        d,
        csvPreview.rows.map(({ displayName, seed, photoRef }) => ({
          displayName,
          ...(seed === undefined ? {} : { seed }),
          ...(photoRef === undefined ? {} : { photoRef }),
        })),
      ),
    );
    closeCsvPreview();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h2 className="mb-4 text-lg font-semibold">Tournament setup</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Tournament name</span>
            <NameInput
              value={t.name}
              onCommit={(v) => mutate((d) => updateTournamentSettings(d, { name: v }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Seeding</span>
            <select
              value={t.settings.seedingMode}
              onChange={(e) =>
                mutate((d) =>
                  updateTournamentSettings(d, { seedingMode: e.target.value as SeedingMode }),
                )
              }
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            >
              <option value="RANDOM">Random</option>
              <option value="REGISTRATION_ORDER">Registration order</option>
              <option value="MANUAL">Manual (use arrows to order)</option>
            </select>
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-sm text-slate-400">Format</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['SINGLE_ELIMINATION', 'Single Elimination', 'Bracket. Lose once and you are out.'],
                ['SWISS', 'Swiss', 'Fixed rounds. Paired by score each round.'],
              ] as Array<[TournamentFormat, string, string]>
            ).map(([value, label, desc]) => (
              <button
                key={value}
                onClick={() => mutate((d) => setFormat(d, value))}
                className={`rounded-lg border p-4 text-left ${
                  t.format === value
                    ? 'border-sky-500 bg-sky-950/50'
                    : 'border-slate-700 bg-slate-950 hover:border-slate-500'
                }`}
              >
                <div className="font-semibold">{label}</div>
                <div className="text-sm text-slate-400">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {t.format === 'SWISS' && (
          <label className="mt-4 block max-w-xs">
            <span className="mb-1 block text-sm text-slate-400">
              Planned rounds (recommended: {recommendedRounds(t)})
            </span>
            <input
              type="number"
              min={1}
              max={15}
              value={planned}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                mutate((d) =>
                  updateTournamentSettings(d, {
                    plannedRounds: Number.isFinite(v) ? Math.max(1, Math.min(15, v)) : undefined,
                  }),
                );
              }}
              className="w-32 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            />
          </label>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Players{' '}
            <span className="ml-2 text-base font-normal text-slate-400">
              {t.players.length} / {MAX_PLAYERS} registered
            </span>
          </h2>
          <button
            onClick={() => mutate((d) => randomizeSeeds(d))}
            disabled={t.players.length < 2}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
          >
            Randomize seeds
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Player name"
            aria-label="New player name"
            className="flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
          />
          <button
            onClick={add}
            disabled={!name.trim() || t.players.length >= MAX_PLAYERS}
            className="rounded-lg bg-sky-700 px-5 py-2 font-semibold hover:bg-sky-600 disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => csvInput.current?.click()}
            className="rounded-lg border border-slate-600 px-4 py-2 font-semibold hover:bg-slate-800"
          >
            Import CSV
          </button>
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={readCsv}
          />
        </div>

        <ul className="divide-y divide-slate-800">
          {t.players.map((p, i) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="w-8 text-center font-mono text-sm text-slate-500">
                {p.seed ?? i + 1}
              </span>
              <PlayerNameInput
                player={p}
                index={i}
                onCommit={(v) => mutate((d) => updatePlayer(d, p.id, { displayName: v }))}
              />
              <button
                onClick={() => move(p, -1)}
                disabled={i === 0}
                aria-label={`Move ${p.displayName} up`}
                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => move(p, 1)}
                disabled={i === t.players.length - 1}
                aria-label={`Move ${p.displayName} down`}
                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                onClick={() => mutate((d) => removePlayer(d, p.id))}
                aria-label={`Remove ${p.displayName}`}
                className="rounded px-2 py-1 text-red-400 hover:bg-red-950/60"
              >
                Remove
              </button>
            </li>
          ))}
          {t.players.length === 0 && (
            <li className="py-6 text-center text-slate-500">No players yet — add some above.</li>
          )}
        </ul>
      </section>

      <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900 p-5">
        <div className="text-sm text-slate-400">
          {t.players.length < 2
            ? 'Add at least 2 players to start.'
            : t.format === 'SINGLE_ELIMINATION'
              ? 'A bracket will be generated on start.'
              : `${planned} rounds will be played.`}
        </div>
        <button
          onClick={() => setStarting(true)}
          disabled={t.players.length < 2}
          className="rounded-lg bg-emerald-700 px-8 py-3 text-lg font-bold hover:bg-emerald-600 disabled:opacity-40"
        >
          Start Tournament
        </button>
      </div>

      {starting && (
        <ConfirmDialog
          title="Start tournament?"
          body={`${t.players.length} players, ${t.format === 'SWISS' ? `Swiss, ${planned} rounds` : 'Single Elimination'}. Players cannot be added or removed after starting.`}
          confirmLabel="Start"
          onConfirm={() => {
            mutate((d) => startTournament(d));
            setStarting(false);
            setView('round');
          }}
          onCancel={() => setStarting(false)}
        />
      )}

      {csvPreview && (
        <Modal title="Import players from CSV" onClose={closeCsvPreview}>
          <div className="space-y-4 text-sm">
            <p className="text-slate-300">
              Detected separator:{' '}
              {csvPreview.separator === '\t' ? 'tab' : `"${csvPreview.separator}"`}.{' '}
              {csvPreview.hasHeader ? 'Header detected.' : 'No header detected.'}
            </p>
            {csvReadError && <p className="text-red-300">{csvReadError}</p>}
            {csvPreview.rows.some((row) => row.seed !== undefined) &&
              t.settings.seedingMode !== 'MANUAL' && (
                <p className="text-amber-300">
                  Seeds are present, but seeding is not Manual; seeds will be ignored.
                </p>
              )}
            <section>
              <h3 className="mb-2 font-semibold">Valid players ({csvPreview.rows.length})</h3>
              {csvPreview.rows.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-700 p-2">
                  {csvPreview.rows.map((row) => (
                    <li key={`${row.line}-${row.displayName}`} className="flex justify-between gap-3">
                      <span className="truncate">
                        Line {row.line}: {row.displayName}
                      </span>
                      {row.seed !== undefined && (
                        <span className="shrink-0 text-slate-400">Seed {row.seed}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">No valid players.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 font-semibold">Errors ({csvPreview.errors.length})</h3>
              {csvPreview.errors.length > 0 ? (
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded border border-red-900/70 p-2 text-red-300">
                  {csvPreview.errors.map((error, index) => (
                    <li key={`${error.line}-${index}`}>
                      Line {error.line}: {error.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">No row errors.</p>
              )}
            </section>
            <div className="flex justify-end gap-2">
              <button
                onClick={closeCsvPreview}
                className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={importCsvPlayers}
                disabled={
                  !!csvReadError ||
                  csvPreview.errors.length > 0 ||
                  csvPreview.rows.length === 0 ||
                  t.players.length + csvPreview.rows.length > MAX_PLAYERS
                }
                className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold hover:bg-emerald-600 disabled:opacity-40"
              >
                Import
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function setFormat(t: Tournament, format: TournamentFormat): Tournament {
  // Format is set at creation; recreate the draft shell to switch formats
  // safely while keeping players.
  const next = structuredClone(t);
  next.format = format;
  return next;
}

function TournamentOverview({ t }: { t: Tournament }) {
  const setView = useApp((s) => s.setView);
  const selectPlayer = useApp((s) => s.selectPlayer);
  const currentRound = t.rounds.filter((r) => r.status !== 'PENDING').slice(-1)[0];
  const totalRounds =
    t.format === 'SWISS' ? (t.settings.plannedRounds ?? t.rounds.length) : t.rounds.length;
  const champion = t.championId ? t.players.find((p) => p.id === t.championId) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold">{t.name}</h2>
          <span className="rounded border border-sky-700 bg-sky-950/60 px-2 py-0.5 text-xs font-semibold text-sky-300">
            {t.format === 'SWISS' ? 'Swiss' : 'Single Elimination'}
          </span>
          <span
            className={`rounded border px-2 py-0.5 text-xs font-semibold ${
              t.status === 'COMPLETE'
                ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                : 'border-amber-700 bg-amber-950/60 text-amber-300'
            }`}
          >
            {t.status}
          </span>
        </div>
        <div className="mt-3 text-slate-400">
          {t.players.length} players · Round {currentRound?.number ?? 0} of {totalRounds}
          {champion && (
            <span className="ml-3 font-semibold text-emerald-300">
              Champion: {champion.displayName}
            </span>
          )}
        </div>
        {t.format === 'SINGLE_ELIMINATION' && t.status !== 'DRAFT' && (
          <p className="mt-2 text-xs text-slate-500">
            Eliminated players are marked on the bracket. Disqualification never rewrites completed
            matches.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h3 className="mb-3 font-semibold">Players</h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          {t.players.map((p) => {
            const badge = statusBadge(p);
            return (
              <li key={p.id}>
                <button
                  onClick={() => selectPlayer(p.id)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-800"
                >
                  <span>
                    <span className="mr-2 font-mono text-xs text-slate-500">
                      {p.seed ? `#${p.seed}` : ''}
                    </span>
                    {p.displayName}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{recordString(t, p.id)}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-xs ${badge.className}`}>
                      {badge.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex gap-3">
        <button
          onClick={() => setView('round')}
          className="rounded-lg bg-sky-700 px-5 py-2 font-semibold hover:bg-sky-600"
        >
          Go to current round
        </button>
        <button
          onClick={() => setView('standings')}
          className="rounded-lg border border-slate-600 px-5 py-2 hover:bg-slate-800"
        >
          View standings
        </button>
      </div>
    </div>
  );
}
