import type { Match, Player, Round, Tournament } from '../../model/types';
import { makeEvent, now } from '../../model/util';
import type { TournamentFormatEngine } from '../../engine';
import { computeStandings } from '../../standings';
import { assignSeeds, makeMatch, makeRound } from '../util';

function matchLabel(t: Tournament, match: Match): string {
  const name = (id?: string) => t.players.find((player) => player.id === id)?.displayName ?? 'TBD';
  return `${name(match.playerAId)} vs ${name(match.playerBId)}`;
}

function matchesForRound(t: Tournament, round: Round): Match[] {
  return round.matchIds
    .map((id) => t.matches.find((match) => match.id === id))
    .filter((match): match is Match => !!match);
}

function isCompleteRound(t: Tournament, round: Round): boolean {
  const matches = matchesForRound(t, round);
  return matches.length > 0 && matches.every((match) => match.status === 'COMPLETE');
}

function activateCurrentRound(t: Tournament): void {
  const current = t.rounds.find((round) => !isCompleteRound(t, round));
  if (!current) return;
  for (const match of matchesForRound(t, current)) {
    if (match.status === 'SCHEDULED') match.status = 'ACTIVE';
  }
}

function finishTournament(t: Tournament): void {
  if (!roundRobinEngine.isComplete(t)) return;
  const wasComplete = t.status === 'COMPLETE';
  const champion = computeStandings(t)[0];
  t.status = 'COMPLETE';
  t.championId = champion?.playerId;
  if (!wasComplete && champion) {
    const name = t.players.find((player) => player.id === champion.playerId)?.displayName ?? 'Unknown';
    t.events.push(
      makeEvent('TOURNAMENT_COMPLETED', `${name} finishes first in the standings`, {
        playerId: champion.playerId,
      }),
    );
  }
}

function roundRobinPairs(
  playerIds: string[],
): Array<Array<[string | undefined, string | undefined]>> {
  const ring: Array<string | undefined> = [...playerIds];
  if (ring.length % 2 === 1) ring.push(undefined);

  const rounds: Array<Array<[string | undefined, string | undefined]>> = [];
  const roundCount = ring.length - 1;
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    const pairs: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < ring.length / 2; i++) {
      pairs.push([ring[i], ring[ring.length - 1 - i]]);
    }
    rounds.push(pairs);
    const last = ring.pop()!;
    ring.splice(1, 0, last);
  }
  return rounds;
}

export const roundRobinEngine: TournamentFormatEngine = {
  format: 'ROUND_ROBIN',
  minPlayers: 2,
  maxPlayers: 32,

  start(t) {
    const seededPlayers = assignSeeds(t);
    const scheduledRounds = roundRobinPairs(seededPlayers.map((player) => player.id));
    const roundCount = seededPlayers.length % 2 === 0 ? seededPlayers.length - 1 : seededPlayers.length;
    const rounds = Array.from({ length: roundCount }, (_, index) => {
      const round = makeRound(index + 1, `Round ${index + 1}`);
      if (index === 0) round.status = 'ACTIVE';
      return round;
    });
    const matches: Match[] = [];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
      const round = rounds[roundIndex]!;
      let tableNumber = 1;
      for (const [playerAId, playerBId] of scheduledRounds[roundIndex]!) {
        if (!playerAId || !playerBId) continue;
        const match = makeMatch({
          roundId: round.id,
          roundNumber: round.number,
          playerAId,
          playerBId,
          tableNumber: tableNumber++,
          status: roundIndex === 0 ? 'ACTIVE' : 'SCHEDULED',
        });
        round.matchIds.push(match.id);
        matches.push(match);
      }
    }

    return { players: seededPlayers, rounds, matches };
  },

  canGenerateNextRound() {
    return { ok: false, reason: 'Round Robin schedule is generated at start' };
  },

  afterResultRecorded(t) {
    activateCurrentRound(t);
    finishTournament(t);
  },

  afterResultCorrected(t) {
    finishTournament(t);
  },

  afterPlayerRemoved(t, player) {
    for (const match of t.matches) {
      if (match.status === 'COMPLETE') continue;
      const inA = match.playerAId === player.id;
      const inB = match.playerBId === player.id;
      if (!inA && !inB) continue;
      const opponentId = inA ? match.playerBId : match.playerAId;
      if (!opponentId) continue;

      match.result = inA ? 'PLAYER_B_WIN' : 'PLAYER_A_WIN';
      match.status = 'COMPLETE';
      match.completedAt = now();
      t.events.push(
        makeEvent(
          'MATCH_RESULT_RECORDED',
          `${matchLabel(t, match)} — walkover (${player.displayName} ${
            player.status === 'DISQUALIFIED' ? 'disqualified' : 'dropped'
          })`,
          { matchId: match.id, roundId: match.roundId, playerId: player.id },
          { automatic: true },
        ),
      );
    }
    activateCurrentRound(t);
    finishTournament(t);
  },

  isComplete(t) {
    return t.matches.length > 0 && t.matches.every((match) => match.status === 'COMPLETE');
  },
};
