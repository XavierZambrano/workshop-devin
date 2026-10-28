import type { Match, Tournament } from '../model/types';

/**
 * Standings and per-player statistics derived from tournament state.
 * Nothing here is stored; everything is recalculated on demand.
 */

export interface StandingEntry {
  playerId: string;
  rank: number;
  matchPoints: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  /** Completed non-bye, non-void matches the player participated in. */
  matchesPlayed: number;
  /** matchPoints / (matchesPlayed * winPoints). Byes excluded from the denominator. */
  matchWinPct: number;
  /** Average match-win percentage of all opponents faced (byes excluded). */
  oppMatchWinPct: number;
}

interface Accumulator {
  playerId: string;
  matchPoints: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  matchesPlayed: number;
  opponents: string[];
}

function isScoredMatch(m: Match): boolean {
  return m.status === 'COMPLETE' && m.result !== 'PENDING';
}

function accumulate(t: Tournament): Map<string, Accumulator> {
  const { scoring } = t.settings;
  const acc = new Map<string, Accumulator>();
  for (const p of t.players) {
    acc.set(p.id, {
      playerId: p.id,
      matchPoints: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      byes: 0,
      matchesPlayed: 0,
      opponents: [],
    });
  }

  for (const m of t.matches) {
    if (!isScoredMatch(m)) continue;
    const a = m.playerAId ? acc.get(m.playerAId) : undefined;
    const b = m.playerBId ? acc.get(m.playerBId) : undefined;

    const record = (
      self: Accumulator | undefined,
      oppId: string | undefined,
      points: number,
      kind: 'win' | 'loss' | 'draw',
    ) => {
      if (!self) return;
      if (kind === 'win') self.wins += 1;
      if (kind === 'loss') self.losses += 1;
      if (kind === 'draw') self.draws += 1;
      self.matchesPlayed += 1;
      self.matchPoints += points;
      if (oppId) self.opponents.push(oppId);
    };

    switch (m.result) {
      case 'BYE':
        if (a) {
          a.byes += 1;
          a.matchPoints += scoring.bye;
        }
        break;
      case 'PLAYER_A_WIN':
        record(a, m.playerBId, scoring.win, 'win');
        record(b, m.playerAId, scoring.loss, 'loss');
        break;
      case 'PLAYER_B_WIN':
        record(b, m.playerAId, scoring.win, 'win');
        record(a, m.playerBId, scoring.loss, 'loss');
        break;
      case 'DRAW':
        record(a, m.playerBId, scoring.draw, 'draw');
        record(b, m.playerAId, scoring.draw, 'draw');
        break;
      case 'DOUBLE_LOSS':
        record(a, m.playerBId, scoring.loss, 'loss');
        record(b, m.playerAId, scoring.loss, 'loss');
        break;
      default:
        break;
    }
  }
  return acc;
}

export function matchWinPct(a: { matchPoints: number; matchesPlayed: number }, winPoints: number): number {
  if (a.matchesPlayed === 0) return 0;
  return a.matchPoints / (a.matchesPlayed * winPoints);
}

/**
 * Opponent Match Win Percentage: the mean of each faced opponent's
 * match-win percentage. Byes are not opponents.
 */
export function computeStandings(t: Tournament): StandingEntry[] {
  const acc = accumulate(t);
  const { win } = t.settings.scoring;

  const entries: StandingEntry[] = [...acc.values()].map((a) => {
    const oppPcts = a.opponents
      .map((id) => acc.get(id))
      .filter((o): o is Accumulator => !!o)
      .map((o) => matchWinPct(o, win));
    const oppMatchWinPct =
      oppPcts.length > 0 ? oppPcts.reduce((s, v) => s + v, 0) / oppPcts.length : 0;
    return {
      playerId: a.playerId,
      rank: 0,
      matchPoints: a.matchPoints,
      wins: a.wins,
      losses: a.losses,
      draws: a.draws,
      byes: a.byes,
      matchesPlayed: a.matchesPlayed,
      matchWinPct: matchWinPct(a, win),
      oppMatchWinPct,
    };
  });

  // Head-to-head matrix among completed matches, used inside tied groups.
  const h2hWins = new Map<string, Map<string, number>>();
  const addH2h = (winner: string, loser: string) => {
    const row = h2hWins.get(winner) ?? new Map<string, number>();
    row.set(loser, (row.get(loser) ?? 0) + 1);
    h2hWins.set(winner, row);
  };
  for (const m of t.matches) {
    if (!isScoredMatch(m) || m.result === 'BYE') continue;
    if (m.result === 'PLAYER_A_WIN' && m.playerAId && m.playerBId) addH2h(m.playerAId, m.playerBId);
    if (m.result === 'PLAYER_B_WIN' && m.playerAId && m.playerBId) addH2h(m.playerBId, m.playerAId);
  }

  const playerById = new Map(t.players.map((p, i) => [p.id, { seed: p.seed ?? i + 1 }]));
  const fallback = (x: StandingEntry, y: StandingEntry) => {
    const sx = playerById.get(x.playerId)?.seed ?? Number.MAX_SAFE_INTEGER;
    const sy = playerById.get(y.playerId)?.seed ?? Number.MAX_SAFE_INTEGER;
    if (sx !== sy) return sx - sy;
    return x.playerId < y.playerId ? -1 : x.playerId > y.playerId ? 1 : 0;
  };

  entries.sort((x, y) => {
    if (y.matchPoints !== x.matchPoints) return y.matchPoints - x.matchPoints;
    if (y.oppMatchWinPct !== x.oppMatchWinPct) return y.oppMatchWinPct - x.oppMatchWinPct;
    return fallback(x, y);
  });

  // Resolve head-to-head inside groups tied on (points, opp%) where it is
  // unambiguous: order subgroup members by wins against others in the group.
  let i = 0;
  while (i < entries.length) {
    let j = i + 1;
    while (
      j < entries.length &&
      entries[j]!.matchPoints === entries[i]!.matchPoints &&
      entries[j]!.oppMatchWinPct === entries[i]!.oppMatchWinPct
    ) {
      j++;
    }
    if (j - i > 1) {
      const group = entries.slice(i, j);
      const ids = new Set(group.map((g) => g.playerId));
      const intraWins = new Map<string, number>(group.map((g) => [g.playerId, 0]));
      for (const g of group) {
        const row = h2hWins.get(g.playerId);
        if (!row) continue;
        for (const [opp, n] of row) {
          if (ids.has(opp)) intraWins.set(g.playerId, (intraWins.get(g.playerId) ?? 0) + n);
        }
      }
      group.sort((x, y) => {
        const wx = intraWins.get(x.playerId) ?? 0;
        const wy = intraWins.get(y.playerId) ?? 0;
        if (wy !== wx) return wy - wx;
        return fallback(x, y);
      });
      for (let k = 0; k < group.length; k++) entries[i + k] = group[k]!;
    }
    i = j;
  }

  entries.forEach((e, idx) => {
    e.rank = idx + 1;
  });
  return entries;
}

export function getStanding(t: Tournament, playerId: string): StandingEntry | undefined {
  return computeStandings(t).find((e) => e.playerId === playerId);
}

/** Completed/void matches involving a player, oldest first. */
export function playerMatchHistory(t: Tournament, playerId: string): Match[] {
  return t.matches
    .filter(
      (m) =>
        (m.status === 'COMPLETE' || m.status === 'VOID') &&
        (m.playerAId === playerId || m.playerBId === playerId),
    )
    .sort((a, b) => a.roundNumber - b.roundNumber || a.createdAt.localeCompare(b.createdAt));
}

export function activeWarningCount(t: Tournament, playerId: string): number {
  return t.warnings.filter((w) => w.playerId === playerId && w.active).length;
}

export function activePenaltyCount(t: Tournament, playerId: string): number {
  return t.penalties.filter((p) => p.playerId === playerId && p.active).length;
}
