import { useState } from 'react';
import type { PenaltyType, Tournament } from '@tourney/engine';
import {
  disqualifyPlayer,
  dropPlayer,
  getStanding,
  issuePenalty,
  issueWarning,
  playerMatchHistory,
  revokePenalty,
  revokeWarning,
  updatePlayer,
} from '@tourney/engine';
import { useApp } from '../store';
import { formatTime, pct, playerName, resultLabel, statusBadge } from '../helpers';
import { ConfirmDialog, Modal } from '../components/Modal';

const PENALTY_TYPES: PenaltyType[] = [
  'WARNING',
  'MATCH_LOSS',
  'ROUND_LOSS',
  'DISQUALIFICATION',
  'CUSTOM',
];

export function PlayersView({ t }: { t: Tournament }) {
  const selectedId = useApp((s) => s.selectedPlayerId);
  const selectPlayer = useApp((s) => s.selectPlayer);
  const selected = selectedId ? t.players.find((p) => p.id === selectedId) : undefined;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px_1fr]">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-3">
        <h2 className="mb-2 px-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Players ({t.players.length})
        </h2>
        <ul className="space-y-0.5">
          {t.players.map((p) => {
            const badge = statusBadge(p);
            return (
              <li key={p.id}>
                <button
                  onClick={() => selectPlayer(p.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    selectedId === p.id ? 'bg-sky-950/60 text-sky-200' : 'hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">
                    {p.seed !== undefined && (
                      <span className="mr-1.5 font-mono text-xs text-slate-500">#{p.seed}</span>
                    )}
                    {p.displayName}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${badge.className}`}>
                    {badge.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {selected ? (
        <PlayerDetail t={t} playerId={selected.id} />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-500">
          Select a player to see details and organizer actions.
        </div>
      )}
    </div>
  );
}

function PlayerDetail({ t, playerId }: { t: Tournament; playerId: string }) {
  const mutate = useApp((s) => s.mutate);
  const [editOpen, setEditOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [penOpen, setPenOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'drop' | 'dq'>(null);
  const [editName, setEditName] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [penType, setPenType] = useState<PenaltyType>('WARNING');

  const p = t.players.find((x) => x.id === playerId)!;
  const standing = getStanding(t, playerId);
  const history = playerMatchHistory(t, playerId);
  const badge = statusBadge(p);
  const draft = t.status === 'DRAFT';

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">
              {p.displayName}
              {p.seed !== undefined && (
                <span className="ml-2 align-middle font-mono text-sm text-slate-500">
                  seed #{p.seed}
                </span>
              )}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className={`rounded border px-2 py-0.5 text-xs ${badge.className}`}>
                {badge.label}
              </span>
              {p.statusReason && <span className="text-slate-400">— {p.statusReason}</span>}
              {p.statusRoundNumber !== undefined && (
                <span className="text-slate-500">in round {p.statusRoundNumber}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setEditName(p.displayName);
                setEditOpen(true);
              }}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
            >
              Edit
            </button>
            {p.status === 'ACTIVE' && !draft && (
              <>
                <button
                  onClick={() => {
                    setReason('');
                    setNotes('');
                    setWarnOpen(true);
                  }}
                  className="rounded-lg border border-amber-700 px-3 py-2 text-sm text-amber-300 hover:bg-amber-950/50"
                >
                  Issue Warning
                </button>
                <button
                  onClick={() => {
                    setReason('');
                    setNotes('');
                    setPenType('WARNING');
                    setPenOpen(true);
                  }}
                  className="rounded-lg border border-orange-700 px-3 py-2 text-sm text-orange-300 hover:bg-orange-950/50"
                >
                  Issue Penalty
                </button>
                <button
                  onClick={() => setConfirm('drop')}
                  className="rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Drop
                </button>
                <button
                  onClick={() => setConfirm('dq')}
                  className="rounded-lg border border-red-700 px-3 py-2 text-sm text-red-300 hover:bg-red-950/50"
                >
                  Disqualify
                </button>
              </>
            )}
            {p.status === 'ACTIVE' && draft && (
              <span className="self-center text-sm text-slate-500">
                Use the setup screen to remove or rename.
              </span>
            )}
          </div>
        </div>

        {standing && !draft && (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {(
              [
                ['Record', `${standing.wins}-${standing.losses}-${standing.draws}`],
                ['Points', String(standing.matchPoints)],
                ['Win %', pct(standing.matchWinPct)],
                ['Opp %', pct(standing.oppMatchWinPct)],
                ['Byes', String(standing.byes)],
                ['Rank', `#${standing.rank}`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-950 p-3 text-center">
                <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!draft && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <h3 className="mb-3 font-semibold">Match history</h3>
          {history.length === 0 ? (
            <div className="text-sm text-slate-500">No completed matches yet.</div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {history.map((m) => {
                const oppId = m.playerAId === p.id ? m.playerBId : m.playerAId;
                return (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-400">R{m.roundNumber}</span>
                    <span className="flex-1 px-3">
                      {m.result === 'BYE' ? 'Bye' : `vs ${playerName(t, oppId)}`}
                    </span>
                    <span
                      className={
                        m.status === 'VOID'
                          ? 'text-slate-500'
                          : m.result === 'BYE'
                            ? 'text-sky-300'
                            : ''
                      }
                    >
                      {m.status === 'VOID' ? 'Voided' : resultLabel(t, m)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <h3 className="mb-3 font-semibold">Warnings</h3>
          {t.warnings.filter((w) => w.playerId === p.id).length === 0 ? (
            <div className="text-sm text-slate-500">No warnings.</div>
          ) : (
            <ul className="space-y-2">
              {t.warnings
                .filter((w) => w.playerId === p.id)
                .map((w) => (
                  <li
                    key={w.id}
                    className={`flex items-start justify-between gap-2 rounded-lg border p-2 text-sm ${
                      w.active ? 'border-amber-800 bg-amber-950/30' : 'border-slate-800 opacity-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{w.reason}</div>
                      <div className="text-xs text-slate-500">
                        {formatTime(w.createdAt)}
                        {w.notes ? ` — ${w.notes}` : ''}
                        {!w.active ? ' — revoked' : ''}
                      </div>
                    </div>
                    {w.active && (
                      <button
                        onClick={() => mutate((d) => revokeWarning(d, w.id))}
                        className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
          <h3 className="mb-3 font-semibold">Penalties</h3>
          {t.penalties.filter((x) => x.playerId === p.id).length === 0 ? (
            <div className="text-sm text-slate-500">No penalties.</div>
          ) : (
            <ul className="space-y-2">
              {t.penalties
                .filter((x) => x.playerId === p.id)
                .map((pen) => (
                  <li
                    key={pen.id}
                    className={`flex items-start justify-between gap-2 rounded-lg border p-2 text-sm ${
                      pen.active ? 'border-red-900 bg-red-950/30' : 'border-slate-800 opacity-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">
                        <span className="mr-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                          {pen.type}
                        </span>
                        {pen.reason}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatTime(pen.createdAt)}
                        {pen.notes ? ` — ${pen.notes}` : ''}
                        {!pen.active ? ' — revoked' : ''}
                      </div>
                    </div>
                    {pen.active && (
                      <button
                        onClick={() => mutate((d) => revokePenalty(d, pen.id))}
                        className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {editOpen && (
        <Modal title={`Edit ${p.displayName}`} onClose={() => setEditOpen(false)}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Display name</span>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setEditOpen(false)}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                mutate((d) => updatePlayer(d, p.id, { displayName: editName }));
                setEditOpen(false);
              }}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold hover:bg-sky-600"
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {warnOpen && (
        <Modal title={`Warn ${p.displayName}`} onClose={() => setWarnOpen(false)}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Slow play"
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm text-slate-400">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setWarnOpen(false)}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              disabled={!reason.trim()}
              onClick={() => {
                mutate((d) =>
                  issueWarning(d, { playerId: p.id, reason, notes: notes || undefined }),
                );
                setWarnOpen(false);
              }}
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold hover:bg-amber-600 disabled:opacity-40"
            >
              Issue warning
            </button>
          </div>
        </Modal>
      )}

      {penOpen && (
        <Modal title={`Penalize ${p.displayName}`} onClose={() => setPenOpen(false)}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Type</span>
            <select
              value={penType}
              onChange={(e) => setPenType(e.target.value as PenaltyType)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            >
              {PENALTY_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {pt.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm text-slate-400">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm text-slate-400">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
            />
          </label>
          <p className="mt-3 text-xs text-slate-500">
            Penalties are recorded for the audit log. To remove the player from future rounds, use
            Disqualify.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setPenOpen(false)}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              disabled={!reason.trim()}
              onClick={() => {
                mutate((d) =>
                  issuePenalty(d, {
                    playerId: p.id,
                    type: penType,
                    reason,
                    notes: notes || undefined,
                  }),
                );
                setPenOpen(false);
              }}
              className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold hover:bg-orange-600 disabled:opacity-40"
            >
              Issue penalty
            </button>
          </div>
        </Modal>
      )}

      {confirm === 'drop' && (
        <DropDialog
          t={t}
          playerId={p.id}
          onClose={() => setConfirm(null)}
          onConfirm={(reasonText) => {
            mutate((d) => dropPlayer(d, p.id, reasonText || undefined));
            setConfirm(null);
          }}
        />
      )}
      {confirm === 'dq' && (
        <DqDialog
          t={t}
          playerId={p.id}
          onClose={() => setConfirm(null)}
          onConfirm={(reasonText, notesText) => {
            mutate((d) => disqualifyPlayer(d, p.id, reasonText, notesText || undefined));
            setConfirm(null);
          }}
        />
      )}
    </section>
  );
}

function DropDialog({
  t,
  playerId,
  onConfirm,
  onClose,
}: {
  t: Tournament;
  playerId: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const p = t.players.find((x) => x.id === playerId)!;
  return (
    <Modal title={`Drop ${p.displayName}?`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-300">
        A dropped player keeps their existing results but is removed from all future rounds. They
        stay visible in standings and history.
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          autoFocus
          onClick={() => onConfirm(reason)}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold hover:bg-amber-600"
        >
          Drop player
        </button>
      </div>
    </Modal>
  );
}

function DqDialog({
  t,
  playerId,
  onConfirm,
  onClose,
}: {
  t: Tournament;
  playerId: string;
  onConfirm: (reason: string, notes: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const p = t.players.find((x) => x.id === playerId)!;
  return (
    <Modal title={`Disqualify ${p.displayName}?`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-300">
        Disqualification removes the player from all future rounds.{' '}
        <strong>Completed match results are not rewritten</strong> — edit or void them explicitly if
        needed.
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 focus:border-sky-500 focus:outline-none"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          disabled={!reason.trim()}
          onClick={() => onConfirm(reason, notes)}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-40"
        >
          Disqualify
        </button>
      </div>
    </Modal>
  );
}
