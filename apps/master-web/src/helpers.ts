import type { Match, Player, Tournament } from '@tourney/engine';
import { computeStandings, winnerOf } from '@tourney/engine';

export function playerOf(t: Tournament, id?: string): Player | undefined {
  return id ? t.players.find((p) => p.id === id) : undefined;
}

export function playerName(t: Tournament, id?: string): string {
  return playerOf(t, id)?.displayName ?? 'TBD';
}

export function recordString(t: Tournament, playerId: string): string {
  const s = computeStandings(t).find((e) => e.playerId === playerId);
  return s ? `${s.wins}-${s.losses}-${s.draws}` : '0-0-0';
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Result label shown on a completed match. */
export function resultLabel(t: Tournament, m: Match): string {
  const a = playerName(t, m.playerAId);
  const b = playerName(t, m.playerBId);
  switch (m.result) {
    case 'PLAYER_A_WIN':
      return `${a} won`;
    case 'PLAYER_B_WIN':
      return `${b} won`;
    case 'DRAW':
      return 'Draw';
    case 'DOUBLE_LOSS':
      return 'Double loss';
    case 'BYE':
      return `${a} — bye`;
    default:
      return 'Pending';
  }
}

export function statusBadge(p: Player): { label: string; className: string } {
  switch (p.status) {
    case 'ACTIVE':
      return { label: 'Active', className: 'bg-emerald-900/60 text-emerald-300 border-emerald-700' };
    case 'DROPPED':
      return { label: 'Dropped', className: 'bg-amber-900/60 text-amber-300 border-amber-700' };
    case 'DISQUALIFIED':
      return { label: 'Disqualified', className: 'bg-red-900/60 text-red-300 border-red-700' };
  }
}

/** A single-elimination player is eliminated once they lose or are removed. */
export function isEliminated(t: Tournament, playerId: string): boolean {
  const p = playerOf(t, playerId);
  if (!p || p.status !== 'ACTIVE') return true;
  return t.matches.some(
    (m) =>
      m.status === 'COMPLETE' &&
      ((m.result === 'PLAYER_A_WIN' && m.playerBId === playerId) ||
        (m.result === 'PLAYER_B_WIN' && m.playerAId === playerId) ||
        (m.result === 'DOUBLE_LOSS' && (m.playerAId === playerId || m.playerBId === playerId))),
  );
}

/**
 * Does correcting this match risk invalidating later results?
 * Swiss: any subsequent round exists. SE: any resolved downstream match.
 */
export function correctionRisk(t: Tournament, m: Match): string | null {
  if (t.format === 'SWISS') {
    const later = t.rounds.some((r) => r.number > m.roundNumber);
    if (later) {
      return 'Later rounds have already been paired. Correcting this result changes the standings those pairings were based on. Pairings will NOT be regenerated automatically.';
    }
    return null;
  }
  // SE: walk the nextMatchId chain looking for resolved matches.
  let cur = m;
  while (cur.nextMatchId) {
    const next = t.matches.find((x) => x.id === cur.nextMatchId);
    if (!next) break;
    if (next.status === 'COMPLETE' || next.status === 'VOID') {
      return 'Downstream bracket matches already have results. They will be voided and must be re-entered.';
    }
    cur = next;
  }
  return null;
}

export function isMatchWinner(t: Tournament, m: Match, playerId?: string): boolean {
  return !!playerId && winnerOf(m) === playerId;
}
