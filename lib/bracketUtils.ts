import { Match, Competitor, CategoryStandings } from '../types';

/**
 * Single-elimination bracket sizing (IJF-style draw).
 * Participant count is rounded up to the next power-of-two field size.
 */
export function getBracketParticipantCount(athletes: number): number {
  const n = Math.max(2, Math.ceil(athletes));
  const sizes = [2, 4, 8, 16, 32, 64, 128];
  return sizes.find((s) => s >= n) || 128;
}

/** First-round match count for a bracket that fits `participantCount` athletes. */
export function expectedR1MatchCountFromParticipants(participantCount: number): number {
  return getBracketParticipantCount(participantCount) / 2;
}

/** Round display order (lower = earlier in tournament). */
export function getRoundOrder(round: string): number {
  if (round === 'F') return 100;
  if (round === 'SF') return 90;
  if (round === 'B') return 88;   // Bronze (played alongside SF/F)
  if (round === 'REP') return 82; // Repechage (after QF)
  if (round === 'QF') return 80;
  if (round.startsWith('R')) return parseInt(round.substring(1), 10);
  return 0;
}

/**
 * Unique `round` labels from matches, sorted in display/bracket order.
 * Prefer this over `Array.from(new Set(...map(m => m.round)))` so TypeScript
 * keeps a `string[]` (some call sites infer `unknown[]` from `Set` + `Array.from`).
 */
export function sortedUniqueRounds(matches: { round: string }[]): string[] {
  const labels = matches.map((m) => m.round);
  return [...new Set(labels)].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
}

/**
 * Build a complete set of Match objects for one weight category.
 *
 * Generates:
 *   R1 → R2 → … → QF → SF → F  (main bracket, always)
 *   REP → B                      (repechage/bronze, only when hasRepechage=true)
 *
 * Repechage routing (IJF cross-over):
 *   QF_A loser → rep-0 slot 1   QF_B loser → rep-0 slot 2
 *   QF_C loser → rep-1 slot 1   QF_D loser → rep-1 slot 2
 *   SF_1 loser → bronze-1 slot 2 (cross-over: SF1 loser → BRONZE_2)
 *   SF_2 loser → bronze-0 slot 2 (cross-over: SF2 loser → BRONZE_1)
 *   REP-0 winner → bronze-0 slot 1
 *   REP-1 winner → bronze-1 slot 1
 *
 * Result: BRONZE_1 = Winner REP_AB + Loser SF_2
 *         BRONZE_2 = Winner REP_CD + Loser SF_1
 */
export function buildMatchesForBracket(
  dbRows: any[],
  rosterMap: Record<string, any>,
  categoryLabel: string,
  hasRepechage: boolean = false
): Match[] {
  const freshMatches: Match[] = [];
  if (dbRows.length === 0) return freshMatches;

  const sortedR1 = [...dbRows].sort(
    (a: any, b: any) => (a.match_number ?? 0) - (b.match_number ?? 0)
  );
  const hasMatchNumbers = sortedR1.some((r: any) => r.match_number != null);
  const numR1FromDb = sortedR1.length;
  const bracketParticipantSize = getBracketParticipantCount(Math.max(numR1FromDb * 2, 2));
  const fullR1Count = bracketParticipantSize / 2;

  const resolveCompetitor = (
    m: any,
    slot: 'competitor1' | 'competitor2',
    idField: string
  ): Competitor | null => {
    if (!m) return null;
    if (m[idField] && rosterMap[m[idField]]) return rosterMap[m[idField]];
    const bd = m?.bracket_data;
    if (bd && bd[slot] && bd[slot].name) {
      return {
        id: `pdf-${m.id}-${slot}`,
        name: bd[slot].name,
        country: bd[slot].country || 'N/A',
        flagUrl: '',
      };
    }
    return null;
  };

  const getR1Row = (i: number): any | null => {
    if (hasMatchNumbers) return sortedR1.find((r: any) => r.match_number === i + 1) ?? null;
    return sortedR1[i] ?? null;
  };

  // ── R1 ───────────────────────────────────────────────────────────────────
  for (let i = 0; i < fullR1Count; i++) {
    const m = getR1Row(i);
    let pool = '';
    if (fullR1Count >= 4) {
      pool = String.fromCharCode(65 + Math.floor(i / (fullR1Count / 4)));
    } else if (fullR1Count === 2) {
      pool = i === 0 ? 'A' : 'B';
    }

    freshMatches.push({
      id: m?.id || `r1-m${i}-${categoryLabel}`,
      round: 'R1',
      roundType: 'main',
      pool: pool || undefined,
      matchNumber: i + 1,
      competitor1: resolveCompetitor(m, 'competitor1', 'competitor_1'),
      competitor2: resolveCompetitor(m, 'competitor2', 'competitor_2'),
      winnerId: null,
      nextMatchId: bracketParticipantSize > 2 ? `r2-m${Math.floor(i / 2)}` : undefined,
      nextMatchSlot: (i % 2 === 0 ? 1 : 2) as 1 | 2,
    });
  }

  // ── R2+ through FINAL ─────────────────────────────────────────────────────
  let currentRoundMatches = fullR1Count / 2;
  let roundLevel = 2;
  let matchCounter = fullR1Count + 1;

  const qfMatchIds: string[] = [];
  const sfMatchIds: string[] = [];

  while (currentRoundMatches >= 1) {
    for (let i = 0; i < currentRoundMatches; i++) {
      const isFinal = currentRoundMatches === 1;
      let roundId: string;
      if (isFinal) roundId = 'F';
      else if (currentRoundMatches === 2) roundId = 'SF';
      else if (currentRoundMatches === 4) roundId = 'QF';
      else roundId = `R${roundLevel}`;

      let pool = '';
      if (!isFinal) {
        if (currentRoundMatches >= 4) {
          pool = String.fromCharCode(65 + Math.floor(i / (currentRoundMatches / 4)));
        } else if (currentRoundMatches === 2) {
          pool = i === 0 ? 'A' : 'B';
        }
      }

      const matchId = `r${roundLevel}-m${i}`;
      if (roundId === 'QF') qfMatchIds.push(matchId);
      if (roundId === 'SF') sfMatchIds.push(matchId);

      freshMatches.push({
        id: matchId,
        round: roundId,
        roundType: 'main',
        pool: pool || undefined,
        matchNumber: matchCounter++,
        competitor1: null,
        competitor2: null,
        winnerId: null,
        nextMatchId: isFinal ? undefined : `r${roundLevel + 1}-m${Math.floor(i / 2)}`,
        nextMatchSlot: (i % 2 === 0 ? 1 : 2) as 1 | 2,
      });
    }
    currentRoundMatches /= 2;
    roundLevel++;
  }

  // ── REPECHAGE + BRONZE ────────────────────────────────────────────────────
  if (hasRepechage && qfMatchIds.length >= 2) {
    const repCount = Math.floor(qfMatchIds.length / 2); // 2 for 4 QFs, 1 for 2 QFs

    // Wire QF losers to repechage pairs: (QF0,QF1)→rep-0, (QF2,QF3)→rep-1
    for (let i = 0; i < qfMatchIds.length; i++) {
      const repIdx = Math.floor(i / 2);
      const slot = ((i % 2) + 1) as 1 | 2;
      const qf = freshMatches.find(m => m.id === qfMatchIds[i]);
      if (qf) { qf.loserNextMatchId = `rep-${repIdx}`; qf.loserNextMatchSlot = slot; }
    }

    // Wire SF losers to bronze with IJF cross-over
    if (sfMatchIds.length >= 2) {
      // SF_1 loser → BRONZE_2 (bronze-1), SF_2 loser → BRONZE_1 (bronze-0)
      const sf1 = freshMatches.find(m => m.id === sfMatchIds[0]);
      const sf2 = freshMatches.find(m => m.id === sfMatchIds[1]);
      if (sf1) { sf1.loserNextMatchId = 'bronze-1'; sf1.loserNextMatchSlot = 2; }
      if (sf2) { sf2.loserNextMatchId = 'bronze-0'; sf2.loserNextMatchSlot = 2; }
    } else if (sfMatchIds.length === 1) {
      const sf = freshMatches.find(m => m.id === sfMatchIds[0]);
      if (sf) { sf.loserNextMatchId = 'bronze-0'; sf.loserNextMatchSlot = 2; }
    }

    // REP matches: winner goes to corresponding bronze slot 1
    for (let i = 0; i < repCount; i++) {
      freshMatches.push({
        id: `rep-${i}`,
        round: 'REP',
        roundType: 'repechage',
        matchNumber: matchCounter++,
        competitor1: null,
        competitor2: null,
        winnerId: null,
        nextMatchId: `bronze-${i}`,
        nextMatchSlot: 1,
      });
    }

    // BRONZE matches
    const bronzeCount = sfMatchIds.length || 1;
    for (let i = 0; i < bronzeCount; i++) {
      const label = bronzeCount > 1
        ? (i === 0 ? 'BRONZE_1' : 'BRONZE_2')
        : 'BRONZE';
      freshMatches.push({
        id: `bronze-${i}`,
        round: 'B',
        roundType: 'bronze',
        pool: label,
        matchNumber: matchCounter++,
        competitor1: null,
        competitor2: null,
        winnerId: null,
      });
    }
  }

  return freshMatches;
}

// ── Standings Derivation ──────────────────────────────────────────────────────

/**
 * Simulates a bracket by applying picks/results to propagate competitors
 * through each round. Returns a new match array with competitors filled in.
 * `picks` works for both user predictions and actual results: {matchId: winnerId}.
 */
function simulateBracket(matches: Match[], picks: Record<string, string>): Match[] {
  const working = matches.map(m => ({ ...m }));
  const rounds = sortedUniqueRounds(working);

  for (const round of rounds) {
    for (const match of working.filter(m => m.round === round)) {
      const winnerId = picks[match.id];
      if (!winnerId) continue;
      const winner = match.competitor1?.id === winnerId ? match.competitor1 : match.competitor2;
      const loser  = match.competitor1?.id === winnerId ? match.competitor2  : match.competitor1;
      if (winner && match.nextMatchId) {
        const target = working.find(m => m.id === match.nextMatchId);
        if (target) {
          if (match.nextMatchSlot === 1) target.competitor1 = winner;
          else target.competitor2 = winner;
        }
      }
      if (loser && match.loserNextMatchId) {
        const target = working.find(m => m.id === match.loserNextMatchId);
        if (target) {
          if (match.loserNextMatchSlot === 1) target.competitor1 = loser;
          else target.competitor2 = loser;
        }
      }
    }
  }
  return working;
}

/**
 * Derives the final 8 standings (positions 1, 2, 3, 5, 7) from a set of picks/results.
 * Pass actual match_results for real standings, or user picks for predicted standings.
 */
export function deriveStandings(matches: Match[], picks: Record<string, string>): CategoryStandings[] {
  const sim = simulateBracket(matches, picks);
  const out: CategoryStandings[] = [];

  const push = (pos: number, c: Competitor | null) => {
    if (c) out.push({ position: pos, competitorId: c.id, competitorName: c.name, country: c.country });
  };

  // 1st & 2nd — Final
  const finalM = sim.find(m => m.round === 'F');
  if (finalM) {
    const wId = picks[finalM.id];
    if (wId) {
      push(1, finalM.competitor1?.id === wId ? finalM.competitor1 : finalM.competitor2);
      push(2, finalM.competitor1?.id === wId ? finalM.competitor2  : finalM.competitor1);
    }
  }

  // 3rd & 5th — Bronze matches
  const bronzeMs = sim.filter(m => m.round === 'B');
  for (const bm of bronzeMs) {
    const wId = picks[bm.id];
    if (wId) {
      push(3, bm.competitor1?.id === wId ? bm.competitor1 : bm.competitor2);
      push(5, bm.competitor1?.id === wId ? bm.competitor2  : bm.competitor1);
    }
  }

  // Without repechage: SF losers = 3rd
  if (bronzeMs.length === 0) {
    for (const sf of sim.filter(m => m.round === 'SF')) {
      const wId = picks[sf.id];
      if (wId) push(3, sf.competitor1?.id === wId ? sf.competitor2 : sf.competitor1);
    }
  }

  // 7th — Repechage match losers
  for (const rm of sim.filter(m => m.round === 'REP')) {
    const wId = picks[rm.id];
    if (wId) push(7, rm.competitor1?.id === wId ? rm.competitor2 : rm.competitor1);
  }

  return out;
}

/**
 * Competitor IDs the user predicted would medal (positions 1–3: gold, silver, bronze).
 * Used to disallow "additional pick" overlapping predicted medalists.
 */
export function getPredictedMedalistCompetitorIds(matches: Match[], picks: Record<string, string>): Set<string> {
  const ids = new Set<string>();
  for (const s of deriveStandings(matches, picks)) {
    if (s.position <= 3) ids.add(s.competitorId);
  }
  return ids;
}

/**
 * Returns the competitor IDs of all 8 athletes who reached the QF.
 * Both competitors in each QF match are included.
 */
export function getQFParticipants(matches: Match[], picks: Record<string, string>): string[] {
  const sim = simulateBracket(matches, picks);
  return sim
    .filter(m => m.round === 'QF')
    .flatMap(m => [m.competitor1?.id, m.competitor2?.id])
    .filter((id): id is string => !!id);
}
