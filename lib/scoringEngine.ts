import { supabase } from './supabaseClient';

interface MatchResult {
  match_id: string;
  round: string;
  winner_competitor_id: string;
}

interface UserPickRow {
  user_id: string;
  picks_data: Record<string, string>;
}

interface ScoringRule {
  id: string;
  label: string;
  points: number;
  enabled: boolean;
}

const DEFAULT_ROUND_POINTS: Record<string, number> = {
  R1: 2,
  R2: 4,
  R3: 6,
  QF: 8,
  SF: 16,
  F: 32,
};

function getPointsForRound(round: string, scoringConfig: ScoringRule[] | null): number {
  if (scoringConfig && Array.isArray(scoringConfig)) {
    const roundKey = round.toLowerCase();
    const rule = scoringConfig.find(
      (r) => r.enabled && r.id.toLowerCase().includes(roundKey)
    );
    if (rule) return rule.points;
  }
  return DEFAULT_ROUND_POINTS[round] ?? 2;
}

export async function calculateScores(
  tournamentId: string | number,
  category: string
): Promise<{ success: boolean; error?: string; usersScored?: number }> {
  try {
    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('scoring_configuration')
      .eq('id', tournamentId)
      .single();

    if (tErr) throw tErr;

    const scoringConfig: ScoringRule[] | null = tournament?.scoring_configuration ?? null;

    const { data: results, error: rErr } = await supabase
      .from('match_results')
      .select('match_id, round, winner_competitor_id')
      .eq('tournament_id', tournamentId)
      .eq('category', category);

    if (rErr) throw rErr;
    if (!results || results.length === 0) {
      return { success: false, error: 'No match results found for this category' };
    }

    const resultsMap = new Map<string, MatchResult>();
    results.forEach((r) => resultsMap.set(r.match_id, r));

    const { data: allPicks, error: pErr } = await supabase
      .from('user_picks')
      .select('user_id, picks_data')
      .eq('tournament_id', tournamentId)
      .eq('category', category);

    if (pErr) throw pErr;
    if (!allPicks || allPicks.length === 0) {
      return { success: true, usersScored: 0 };
    }

    const scoreRows: {
      user_id: string;
      tournament_id: string | number;
      category: string;
      total_points: number;
      correct_picks: number;
      total_picks: number;
      breakdown: Record<string, any>;
    }[] = [];

    for (const pick of allPicks as UserPickRow[]) {
      let totalPoints = 0;
      let correctPicks = 0;
      let totalPicks = 0;
      const breakdown: Record<string, { correct: boolean; points: number }> = {};

      for (const [matchId, pickedWinnerId] of Object.entries(pick.picks_data)) {
        const result = resultsMap.get(matchId);
        if (!result) continue;

        totalPicks++;
        const isCorrect = pickedWinnerId === result.winner_competitor_id;

        if (isCorrect) {
          const pts = getPointsForRound(result.round, scoringConfig);
          totalPoints += pts;
          correctPicks++;
          breakdown[matchId] = { correct: true, points: pts };
        } else {
          breakdown[matchId] = { correct: false, points: 0 };
        }
      }

      scoreRows.push({
        user_id: pick.user_id,
        tournament_id: tournamentId,
        category,
        total_points: totalPoints,
        correct_picks: correctPicks,
        total_picks: totalPicks,
        breakdown,
      });
    }

    if (scoreRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('tournament_scores')
        .upsert(
          scoreRows.map((r) => ({
            user_id: r.user_id,
            tournament_id: r.tournament_id,
            category: r.category,
            total_points: r.total_points,
            correct_picks: r.correct_picks,
            total_picks: r.total_picks,
            breakdown: r.breakdown,
          })),
          { onConflict: 'user_id,tournament_id,category' }
        );

      if (upsertErr) throw upsertErr;

      for (const row of scoreRows) {
        const { data: allScores } = await supabase
          .from('tournament_scores')
          .select('total_points')
          .eq('user_id', row.user_id);

        if (allScores) {
          const globalPoints = allScores.reduce((sum, s) => sum + (s.total_points || 0), 0);
          await supabase
            .from('profiles')
            .update({ points: globalPoints })
            .eq('id', row.user_id);
        }
      }
    }

    return { success: true, usersScored: scoreRows.length };
  } catch (err: any) {
    console.error('Scoring engine error:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function calculateAllCategoryScores(
  tournamentId: string | number,
  categories: string[]
): Promise<{ success: boolean; totalUsersScored: number; errors: string[] }> {
  let totalUsersScored = 0;
  const errors: string[] = [];

  for (const category of categories) {
    const result = await calculateScores(tournamentId, category);
    if (result.success) {
      totalUsersScored += result.usersScored || 0;
    } else if (result.error) {
      errors.push(`${category}: ${result.error}`);
    }
  }

  return { success: errors.length === 0, totalUsersScored, errors };
}
