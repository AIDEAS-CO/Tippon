import { supabase } from './supabaseClient';
import {
  CategoryStandings,
  ScoringBreakdown,
  PositionScoreDetail,
  BonusBreakdownLine,
  TournamentBonusBreakdown,
  MedalTableScoreBreakdown,
  MedalTableScoreLine,
} from '../types';
import { buildMatchesForBracket, deriveStandings, getQFParticipants } from './bracketUtils';
import { computeCountryMedalRanking, countryRanksFromMedalRows } from './countryMedalRanking';
import { MEDAL_TABLE_MEN, MEDAL_TABLE_WOMEN, MEDAL_TABLE_TOTAL } from './tournamentConstants';

/** One user's scored category — used to aggregate tournament bonuses. */
export interface ScoringCategoryResult {
  userId: string;
  category: string;
  breakdown: ScoringBreakdown;
}

// ── Config helpers ────────────────────────────────────────────────────────────

/** Default point values for each scoring rule. */
const DEFAULTS: Record<string, number> = {
  gold_silver_exact:     6,
  gold_silver_dev1:      3,
  gold_silver_dev2:      2,
  gold_silver_dev3:      1,
  bronze_exact:          4,
  bronze_dev1:           3,
  bronze_dev2:           1,
  pool_finals_per_correct: 1,
  additional_pick_top7:  2,
  medal_table_exact:     4,
  medal_table_dev1:      3,
  medal_table_dev2:      2,
  medal_table_dev3:      1,
  bonus_perfect_weight:  10,
  bonus_majority_champs: 8,
  bonus_10_additional:   6,
  bonus_all_pools:       5,
};

function getCfg(config: Record<string, any> | null | undefined, key: string): number {
  if (config && typeof config[key] === 'number') return config[key];
  return DEFAULTS[key] ?? 0;
}

// ── Pure scoring function ─────────────────────────────────────────────────────

/**
 * Scores one user's predictions against actual results for a single category.
 * All inputs are pre-computed; no DB access.
 */
function scoreCategory(
  predictedStandings: CategoryStandings[],
  actualStandings: CategoryStandings[],
  predictedQF: string[],
  actualQF: string[],
  picks: Record<string, string>,
  config: Record<string, any> | null | undefined
): { total: number; breakdown: ScoringBreakdown } {
  const actualPos = new Map(actualStandings.map(s => [s.competitorId, s.position]));

  const scoreDetail = (
    pred: CategoryStandings,
    group: 'goldSilver' | 'bronze'
  ): PositionScoreDetail => {
    const actual = actualPos.get(pred.competitorId) ?? null;
    const deviation = actual !== null ? Math.abs(pred.position - actual) : 99;
    let points = 0;
    if (group === 'goldSilver') {
      if (deviation === 0) points = getCfg(config, 'gold_silver_exact');
      else if (deviation === 1) points = getCfg(config, 'gold_silver_dev1');
      else if (deviation === 2) points = getCfg(config, 'gold_silver_dev2');
      else if (deviation === 3) points = getCfg(config, 'gold_silver_dev3');
    } else {
      if (deviation === 0) points = getCfg(config, 'bronze_exact');
      else if (deviation === 1) points = getCfg(config, 'bronze_dev1');
      else if (deviation === 2) points = getCfg(config, 'bronze_dev2');
    }
    return { competitorId: pred.competitorId, competitorName: pred.competitorName, predicted: pred.position, actual, deviation, points };
  };

  const goldSilver = predictedStandings
    .filter(s => s.position <= 2)
    .map(s => scoreDetail(s, 'goldSilver'));

  const bronze = predictedStandings
    .filter(s => s.position === 3)
    .map(s => scoreDetail(s, 'bronze'));

  // Pool Finals: 1 pt per correctly predicted QF participant
  const correctQF = predictedQF.filter(id => actualQF.includes(id)).length;
  const pfPoints = correctQF * getCfg(config, 'pool_finals_per_correct');

  // Additional Pick — no points if same athlete was predicted as a medalist (1–3)
  const apId = picks['additional_pick'] || null;
  const predictedMedalistIds = new Set(
    predictedStandings.filter((s) => s.position <= 3).map((s) => s.competitorId)
  );
  const apInvalid = !!(apId && predictedMedalistIds.has(apId));
  const apActualPos = apId ? (actualPos.get(apId) ?? null) : null;
  const apPoints =
    apInvalid
      ? 0
      : apActualPos !== null && apActualPos <= 7
        ? getCfg(config, 'additional_pick_top7')
        : 0;

  const categoryTotal =
    goldSilver.reduce((s, d) => s + d.points, 0) +
    bronze.reduce((s, d) => s + d.points, 0) +
    pfPoints + apPoints;

  return {
    total: categoryTotal,
    breakdown: {
      goldSilver,
      bronze,
      poolFinals: { correct: correctQF, total: actualQF.length, points: pfPoints },
      additionalPick: { competitorId: apId, actualPosition: apActualPos, points: apPoints },
      categoryTotal,
    },
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function loadBracketForCategory(tournamentId: string | number, category: string, hasRepechage: boolean) {
  const [{ data: dbMatches }, { data: roster }] = await Promise.all([
    supabase.from('competition_brackets').select('*')
      .eq('tournament_id', tournamentId)
      .eq('weight_category', category)
      .order('match_number', { ascending: true }),
    supabase.from('tournament_roster').select('*')
      .eq('tournament_id', tournamentId),
  ]);

  const rosterMap: Record<string, any> = {};
  (roster || []).forEach((a: any) => {
    rosterMap[a.id] = {
      id: a.id,
      name: `${(a.last_name || '').toUpperCase()} ${a.first_name || ''}`.trim(),
      country: a.country || 'N/A',
      flagUrl: '',
      weight: a.weight_category,
    };
  });

  return buildMatchesForBracket(dbMatches || [], rosterMap, category, hasRepechage);
}

// ── Batch scoring (admin finalization) ───────────────────────────────────────

/**
 * Scores all users for one category and upserts to tournament_scores.
 * Requires an open RLS policy on user_picks (see SUPABASE_MIGRATION.sql).
 */
export async function calculateScores(
  tournamentId: string | number,
  category: string
): Promise<{ success: boolean; error?: string; usersScored?: number; categoryResults?: ScoringCategoryResult[] }> {
  try {
    // Load tournament config
    const { data: tournamentData, error: tErr } = await supabase
      .from('tournaments')
      .select('scoring_configuration')
      .eq('id', tournamentId)
      .single();
    if (tErr) throw tErr;

    const config: Record<string, any> = tournamentData?.scoring_configuration ?? {};
    const hasRepechage = !!config.has_repechage;

    // Build match structure
    const matches = await loadBracketForCategory(tournamentId, category, hasRepechage);
    if (matches.length === 0) {
      return { success: false, error: `No bracket data found for category: ${category}`, categoryResults: [] };
    }

    // Load actual results
    const { data: results, error: rErr } = await supabase
      .from('match_results')
      .select('match_id, winner_competitor_id')
      .eq('tournament_id', tournamentId)
      .eq('category', category);
    if (rErr) throw rErr;
    if (!results || results.length === 0) {
      return { success: false, error: `No match results found for category: ${category}`, categoryResults: [] };
    }

    const actualPicksMap: Record<string, string> = {};
    results.forEach((r: any) => { actualPicksMap[r.match_id] = r.winner_competitor_id; });

    const actualStandings = deriveStandings(matches, actualPicksMap);
    const actualQF = getQFParticipants(matches, actualPicksMap);

    // Load all user picks
    const { data: allPicks, error: pErr } = await supabase
      .from('user_picks')
      .select('user_id, picks_data')
      .eq('tournament_id', tournamentId)
      .eq('category', category);
    if (pErr) throw pErr;
    if (!allPicks || allPicks.length === 0) {
      return { success: true, usersScored: 0, categoryResults: [] };
    }

    // Score each user
    const scoreRows: any[] = [];
    for (const pick of allPicks as { user_id: string; picks_data: Record<string, string> }[]) {
      const predicted = deriveStandings(matches, pick.picks_data);
      const predictedQF = getQFParticipants(matches, pick.picks_data);
      const { total, breakdown } = scoreCategory(predicted, actualStandings, predictedQF, actualQF, pick.picks_data, config);
      scoreRows.push({
        user_id: pick.user_id,
        tournament_id: tournamentId,
        category,
        total_points: total,
        correct_picks: breakdown.goldSilver.filter(d => d.deviation === 0).length + breakdown.bronze.filter(d => d.deviation === 0).length,
        total_picks: breakdown.goldSilver.length + breakdown.bronze.length,
        breakdown,
      });
    }

    // Upsert scores
    if (scoreRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('tournament_scores')
        .upsert(scoreRows, { onConflict: 'user_id,tournament_id,category' });
      if (upsertErr) throw upsertErr;

      // Update global profile points
      for (const row of scoreRows) {
        const { data: allScores } = await supabase
          .from('tournament_scores')
          .select('total_points')
          .eq('user_id', row.user_id);
        if (allScores) {
          const globalPoints = allScores.reduce((s: number, r: any) => s + (r.total_points || 0), 0);
          await supabase.from('profiles').update({ points: globalPoints }).eq('id', row.user_id);
        }
      }
    }

    const categoryResults: ScoringCategoryResult[] = scoreRows.map((row) => ({
      userId: row.user_id,
      category,
      breakdown: row.breakdown as ScoringBreakdown,
    }));

    return { success: true, usersScored: scoreRows.length, categoryResults };
  } catch (err: any) {
    console.error('[scoringEngine] calculateScores error:', err);
    return { success: false, error: err?.message || String(err), categoryResults: [] };
  }
}

// ── Self-scoring (called when user views completed tournament) ────────────────

/**
 * Calculates and persists the current user's score for one category.
 * Uses picks passed in directly (from local state) — avoids RLS issues.
 */
export async function calculateMyScore(
  tournamentId: string | number,
  category: string,
  userId: string,
  myPicks: Record<string, string>
): Promise<{ points: number; correct: number; total: number }> {
  try {
    const { data: tournamentData } = await supabase
      .from('tournaments')
      .select('scoring_configuration')
      .eq('id', tournamentId)
      .single();
    const config: Record<string, any> = tournamentData?.scoring_configuration ?? {};
    const hasRepechage = !!config.has_repechage;

    const [matches, resultsData] = await Promise.all([
      loadBracketForCategory(tournamentId, category, hasRepechage),
      supabase.from('match_results')
        .select('match_id, winner_competitor_id')
        .eq('tournament_id', tournamentId)
        .eq('category', category),
    ]);

    if (!resultsData.data?.length) return { points: 0, correct: 0, total: 0 };

    const actualPicksMap: Record<string, string> = {};
    resultsData.data.forEach((r: any) => { actualPicksMap[r.match_id] = r.winner_competitor_id; });

    const actualStandings = deriveStandings(matches, actualPicksMap);
    const actualQF = getQFParticipants(matches, actualPicksMap);
    const predicted = deriveStandings(matches, myPicks);
    const predictedQF = getQFParticipants(matches, myPicks);

    const { total, breakdown } = scoreCategory(predicted, actualStandings, predictedQF, actualQF, myPicks, config);

    // Persist
    await supabase.from('tournament_scores').upsert(
      {
        user_id: userId,
        tournament_id: tournamentId,
        category,
        total_points: total,
        correct_picks: breakdown.goldSilver.filter(d => d.deviation === 0).length + breakdown.bronze.filter(d => d.deviation === 0).length,
        total_picks: breakdown.goldSilver.length + breakdown.bronze.length,
        breakdown,
      },
      { onConflict: 'user_id,tournament_id,category' }
    );

    // Update global profile points
    const { data: allScores } = await supabase
      .from('tournament_scores')
      .select('total_points')
      .eq('user_id', userId);
    if (allScores) {
      const globalPoints = allScores.reduce((s: number, r: any) => s + (r.total_points || 0), 0);
      await supabase.from('profiles').update({ points: globalPoints }).eq('id', userId);
    }

    return {
      points: total,
      correct: breakdown.goldSilver.filter(d => d.deviation === 0).length + breakdown.bronze.filter(d => d.deviation === 0).length,
      total: breakdown.goldSilver.length + breakdown.bronze.length,
    };
  } catch (err) {
    console.error('[scoringEngine] calculateMyScore error:', err);
    return { points: 0, correct: 0, total: 0 };
  }
}

// ── Bonus scoring (tournament-wide) ──────────────────────────────────────────

function calculateBonusesDetailed(
  results: ScoringCategoryResult[],
  totalCategories: number,
  config: Record<string, any> | null | undefined
): Map<string, TournamentBonusBreakdown> {
  const byUser = new Map<string, ScoringCategoryResult[]>();
  for (const r of results) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push(r);
  }

  const out = new Map<string, TournamentBonusBreakdown>();
  for (const [userId, userCats] of byUser) {
    const lines: BonusBreakdownLine[] = [];
    let total = 0;

    const perfectCats: string[] = [];
    for (const cat of userCats) {
      const gsExact =
        cat.breakdown.goldSilver.length === 2 && cat.breakdown.goldSilver.every((d) => d.deviation === 0);
      const bExact =
        cat.breakdown.bronze.length === 2 && cat.breakdown.bronze.every((d) => d.deviation === 0);
      if (gsExact && bExact) {
        perfectCats.push(cat.category);
      }
    }
    const pwVal = getCfg(config, 'bonus_perfect_weight');
    const pwEarned = perfectCats.length > 0;
    const pwPts = perfectCats.length * pwVal;
    if (pwPts > 0) total += pwPts;
    lines.push({
      key: 'bonus_perfect_weight',
      label: 'Perfect weight (10 pts per category with all four medal positions exact)',
      points: pwPts,
      earned: pwEarned,
      progressRatio: pwEarned ? 1 : 0,
      progressLabel: `${perfectCats.length}/${userCats.length} perfect`,
      detail: pwEarned
        ? `Earned in: ${perfectCats.join(', ')}`
        : 'Need gold, silver, and both bronze predictions exact in at least one category.',
    });

    const correctGolds = userCats.filter((c) =>
      c.breakdown.goldSilver.some((d) => d.predicted === 1 && d.deviation === 0)
    ).length;
    const ratio = userCats.length > 0 ? correctGolds / userCats.length : 0;
    const majEarned = userCats.length > 0 && ratio > 0.5;
    const majVal = getCfg(config, 'bonus_majority_champs');
    const majPts = majEarned ? majVal : 0;
    if (majEarned) total += majPts;
    lines.push({
      key: 'bonus_majority_champs',
      label: 'Majority exact gold predictions',
      points: majPts,
      earned: majEarned,
      progressRatio: userCats.length > 0 ? Math.min(1, ratio / 0.51) : 0,
      progressLabel: `${correctGolds}/${userCats.length} (${Math.round(ratio * 100)}%) · need >50%`,
      detail: `${correctGolds}/${userCats.length} categories with exact gold (${Math.round(ratio * 100)}%). Need strictly more than 50%.`,
    });

    const correctAdditional = userCats.filter((c) => c.breakdown.additionalPick.points > 0).length;
    const addThreshold = Math.max(1, Math.ceil(0.7 * totalCategories));
    const addEarned = correctAdditional >= addThreshold;
    const addVal = getCfg(config, 'bonus_10_additional');
    const addPts = addEarned ? addVal : 0;
    if (addEarned) total += addPts;
    lines.push({
      key: 'bonus_10_additional',
      label: `70%+ weight categories with additional pick in top 7 (need ${addThreshold}/${totalCategories})`,
      points: addPts,
      earned: addEarned,
      progressRatio: Math.min(1, correctAdditional / addThreshold),
      progressLabel: `${correctAdditional}/${addThreshold}`,
      detail: addEarned
        ? `${correctAdditional} categories earned additional-pick points.`
        : `${correctAdditional}/${addThreshold} categories needed where additional pick scores (top 7 actual).`,
    });

    const perfectPoolCats = userCats.filter(
      (c) => c.breakdown.poolFinals.total > 0 && c.breakdown.poolFinals.correct === c.breakdown.poolFinals.total
    );
    const perfectPoolCount = perfectPoolCats.length;
    const poolVal = getCfg(config, 'bonus_all_pools');
    const poolPts = perfectPoolCount * poolVal;
    if (poolPts > 0) total += poolPts;
    const poolProgress = totalCategories > 0 ? perfectPoolCount / totalCategories : 0;
    const imperfectCats = userCats
      .filter((c) => !(c.breakdown.poolFinals.total > 0 && c.breakdown.poolFinals.correct === c.breakdown.poolFinals.total))
      .map((c) => {
        const pf = c.breakdown.poolFinals;
        return pf.total === 0 ? `${c.category}: no QF field` : `${c.category}: ${pf.correct}/${pf.total}`;
      });
    lines.push({
      key: 'bonus_all_pools',
      label: 'Perfect QF pool (per category)',
      points: poolPts,
      earned: perfectPoolCount > 0,
      progressRatio: Math.min(1, poolProgress),
      progressLabel: `${perfectPoolCount}/${totalCategories} perfect`,
      detail: perfectPoolCount > 0
        ? `${perfectPoolCount} categor${perfectPoolCount === 1 ? 'y' : 'ies'} with all QF slots correct: ${perfectPoolCats.map((c) => c.category).join(', ')}.` +
          (imperfectCats.length > 0 ? ` Not perfect: ${imperfectCats.slice(0, 5).join(' · ')}${imperfectCats.length > 5 ? ' …' : ''}` : '')
        : imperfectCats.slice(0, 5).join(' · ') + (imperfectCats.length > 5 ? ' …' : ''),
    });

    out.set(userId, { bonusLines: lines, categoryTotal: total });
  }
  return out;
}

const MEDAL_TABLE_SLOTS = 3;

async function refreshProfilePointsFromAllScores(userId: string) {
  const { data: allScores } = await supabase.from('tournament_scores').select('total_points').eq('user_id', userId);
  if (allScores) {
    const globalPoints = allScores.reduce((s: number, r: any) => s + (r.total_points || 0), 0);
    await supabase.from('profiles').update({ points: globalPoints }).eq('id', userId);
  }
}

/**
 * Scores country medal table predictions for Men, Women, and Total tables.
 * Persists `tournament_scores` rows for `_medal_table_men_`, `_medal_table_women_`, `_medal_table_total_`.
 * Each table awards up to 12 points (4/3/2/1 for exact/±1/±2/±3). Total max: 36 pts.
 */
export async function calculateMedalTableScores(
  tournamentId: string | number,
  categories: string[]
): Promise<{ success: boolean; usersScored: number; error?: string }> {
  try {
    const { data: tournamentData, error: tErr } = await supabase
      .from('tournaments')
      .select('scoring_configuration')
      .eq('id', tournamentId)
      .single();
    if (tErr) throw tErr;
    const config: Record<string, any> = tournamentData?.scoring_configuration ?? {};
    const hasRepechage = !!config.has_repechage;

    // Load category → gender map
    const { data: catRows } = await supabase
      .from('categories')
      .select('name, gender')
      .eq('tournament_id', tournamentId);
    const catGenderMap = new Map<string, string>();
    for (const c of catRows || []) {
      if (c.name && c.gender) catGenderMap.set(c.name, c.gender);
    }

    const [{ data: dbMatches }, { data: roster }, { data: resultRows }] = await Promise.all([
      supabase.from('competition_brackets').select('*').eq('tournament_id', tournamentId).order('match_number', { ascending: true }),
      supabase.from('tournament_roster').select('*').eq('tournament_id', tournamentId),
      supabase.from('match_results').select('category, match_id, winner_competitor_id').eq('tournament_id', tournamentId),
    ]);

    const rosterMap: Record<string, any> = {};
    (roster || []).forEach((a: any) => {
      rosterMap[a.id] = {
        id: a.id,
        name: `${(a.last_name || '').toUpperCase()} ${a.first_name || ''}`.trim(),
        country: a.country || 'N/A',
        flagUrl: '',
        weight: a.weight_category,
      };
    });

    const resultsByCat = new Map<string, Record<string, string>>();
    for (const r of resultRows || []) {
      const row = r as { category: string; match_id: string; winner_competitor_id: string };
      if (!resultsByCat.has(row.category)) resultsByCat.set(row.category, {});
      resultsByCat.get(row.category)![row.match_id] = row.winner_competitor_id;
    }

    // Build gender-filtered category lists
    const menCats = categories.filter(c => catGenderMap.get(c) === 'Male');
    const womenCats = categories.filter(c => catGenderMap.get(c) === 'Female');

    const tableConfigs: Array<{ catKey: string; filteredCats: string[]; legacyKey?: string }> = [
      { catKey: MEDAL_TABLE_MEN, filteredCats: menCats },
      { catKey: MEDAL_TABLE_WOMEN, filteredCats: womenCats },
      { catKey: MEDAL_TABLE_TOTAL, filteredCats: categories, legacyKey: '_medal_table_' },
    ];

    const maxPerSlot = getCfg(config, 'medal_table_exact');
    const maxPossible = MEDAL_TABLE_SLOTS * maxPerSlot;

    const allScoreRows: any[] = [];

    for (const { catKey, filteredCats, legacyKey } of tableConfigs) {
      const medalRows = computeCountryMedalRanking(
        filteredCats,
        dbMatches || [],
        rosterMap,
        resultsByCat,
        hasRepechage
      );
      const rankByCountry = countryRanksFromMedalRows(medalRows);

      // Fetch picks for this category key (and legacy key if applicable)
      const keysToFetch = legacyKey ? [catKey, legacyKey] : [catKey];
      const { data: picksRows } = await supabase
        .from('user_picks')
        .select('user_id, picks_data, category')
        .eq('tournament_id', tournamentId)
        .in('category', keysToFetch);

      // Deduplicate by user_id — prefer the new key over legacy
      const picksByUser = new Map<string, Record<string, string>>();
      for (const pr of picksRows || []) {
        const uid = (pr as { user_id: string }).user_id;
        const picks = (pr as { picks_data?: Record<string, string> }).picks_data;
        const cat = (pr as { category: string }).category;
        if (!picks || typeof picks !== 'object') continue;
        // New key overrides legacy
        if (!picksByUser.has(uid) || cat === catKey) {
          picksByUser.set(uid, picks);
        }
      }

      for (const [uid, picks] of picksByUser) {
        const lines: MedalTableScoreLine[] = [];
        let total = 0;

        for (let slot = 1; slot <= MEDAL_TABLE_SLOTS; slot++) {
          const cc = String(picks[String(slot)] || '').trim().toUpperCase();
          if (!cc || cc === 'N/A') continue;

          const actualRank = rankByCountry.get(cc) ?? null;
          const deviation = actualRank === null ? 99 : Math.abs(slot - actualRank);
          let pts = 0;
          if (deviation === 0) pts = getCfg(config, 'medal_table_exact');
          else if (deviation === 1) pts = getCfg(config, 'medal_table_dev1');
          else if (deviation === 2) pts = getCfg(config, 'medal_table_dev2');
          else if (deviation === 3) pts = getCfg(config, 'medal_table_dev3');
          total += pts;
          lines.push({
            slot,
            country: cc,
            predictedRank: slot,
            actualRank,
            deviation,
            points: pts,
          });
        }

        const breakdown: MedalTableScoreBreakdown = {
          lines,
          categoryTotal: total,
          maxPossible,
        };
        const filled = lines.length;
        const correctSlots = lines.filter((l) => l.points > 0).length;

        allScoreRows.push({
          user_id: uid,
          tournament_id: tournamentId,
          category: catKey,
          total_points: total,
          correct_picks: correctSlots,
          total_picks: filled,
          breakdown,
        });
      }
    }

    if (allScoreRows.length > 0) {
      const { error: upErr } = await supabase
        .from('tournament_scores')
        .upsert(allScoreRows, { onConflict: 'user_id,tournament_id,category' });
      if (upErr) throw upErr;
      const uniqueUsers = [...new Set(allScoreRows.map((r) => r.user_id))];
      for (const uid of uniqueUsers) {
        await refreshProfilePointsFromAllScores(uid);
      }
    }

    return { success: true, usersScored: allScoreRows.length };
  } catch (err: any) {
    console.error('[scoringEngine] calculateMedalTableScores:', err);
    return { success: false, usersScored: 0, error: err?.message || String(err) };
  }
}

// ── All-category batch scoring ────────────────────────────────────────────────

export async function calculateAllCategoryScores(
  tournamentId: string | number,
  categories: string[]
): Promise<{ success: boolean; totalUsersScored: number; errors: string[] }> {
  let totalUsersScored = 0;
  const errors: string[] = [];
  const allResults: ScoringCategoryResult[] = [];

  for (const category of categories) {
    const result = await calculateScores(tournamentId, category);
    if (result.success) {
      totalUsersScored += result.usersScored || 0;
      if (result.categoryResults?.length) {
        allResults.push(...result.categoryResults);
      }
    } else if (result.error) {
      errors.push(`${category}: ${result.error}`);
    }
  }

  const medalRes = await calculateMedalTableScores(tournamentId, categories);
  totalUsersScored += medalRes.usersScored || 0;
  if (!medalRes.success && medalRes.error) {
    errors.push(`_medal_table_: ${medalRes.error}`);
  }

  if (allResults.length > 0) {
    const { data: tournamentData } = await supabase
      .from('tournaments')
      .select('scoring_configuration')
      .eq('id', tournamentId)
      .single();
    const config = tournamentData?.scoring_configuration ?? {};

    const bonusMap = calculateBonusesDetailed(allResults, categories.length, config);
    const bonusRows = Array.from(bonusMap.entries()).map(([userId, tb]) => ({
      user_id: userId,
      tournament_id: tournamentId,
      category: '_bonuses_',
      total_points: tb.categoryTotal,
      correct_picks: tb.bonusLines.filter((l) => l.earned).length,
      total_picks: tb.bonusLines.length,
      breakdown: tb,
    }));
    if (bonusRows.length > 0) {
      const { error: bonusErr } = await supabase
        .from('tournament_scores')
        .upsert(bonusRows, { onConflict: 'user_id,tournament_id,category' });
      if (bonusErr) console.error('[scoringEngine] bonus upsert:', bonusErr);

      for (const row of bonusRows) {
        const { data: allScores } = await supabase
          .from('tournament_scores')
          .select('total_points')
          .eq('user_id', row.user_id);
        if (allScores) {
          const globalPoints = allScores.reduce((s: number, r: any) => s + (r.total_points || 0), 0);
          await supabase.from('profiles').update({ points: globalPoints }).eq('id', row.user_id);
        }
      }
    }
  }

  return { success: errors.length === 0, totalUsersScored, errors };
}

/**
 * Calculates medal table scores and bonuses from already-persisted category scores.
 * Call this after all categories have been closed individually.
 */
export async function calculateBonusesAndMedalTable(
  tournamentId: string | number,
  allCategories: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    // Medal table
    await calculateMedalTableScores(tournamentId, allCategories);

    // Re-read all persisted category scores to compute bonuses
    const { data: scoreRows } = await supabase
      .from('tournament_scores')
      .select('user_id, category, breakdown')
      .eq('tournament_id', tournamentId)
      .not('category', 'in', '(_bonuses_,_medal_table_total_,_medal_table_men_,_medal_table_women_,_medal_table_)');

    const { data: tournamentData } = await supabase
      .from('tournaments')
      .select('scoring_configuration')
      .eq('id', tournamentId)
      .single();
    const config = tournamentData?.scoring_configuration ?? {};

    // Group scores by user
    const byUser = new Map<string, ScoringCategoryResult[]>();
    for (const row of scoreRows || []) {
      const uid = (row as any).user_id;
      const cat = (row as any).category;
      const breakdown = (row as any).breakdown as ScoringBreakdown;
      if (!breakdown || !('poolFinals' in breakdown)) continue;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push({ userId: uid, category: cat, breakdown, total: breakdown.categoryTotal });
    }

    const allResults: ScoringCategoryResult[] = [];
    byUser.forEach((cats) => allResults.push(...cats));

    if (allResults.length > 0) {
      const bonusMap = calculateBonusesDetailed(allResults, allCategories.length, config);
      const bonusRows = Array.from(bonusMap.entries()).map(([userId, tb]) => ({
        user_id: userId,
        tournament_id: tournamentId,
        category: '_bonuses_',
        total_points: tb.categoryTotal,
        correct_picks: tb.bonusLines.filter((l) => l.earned).length,
        total_picks: tb.bonusLines.length,
        breakdown: tb,
      }));
      if (bonusRows.length > 0) {
        await supabase
          .from('tournament_scores')
          .upsert(bonusRows, { onConflict: 'user_id,tournament_id,category' });
        for (const row of bonusRows) {
          const { data: allScores } = await supabase
            .from('tournament_scores')
            .select('total_points')
            .eq('user_id', row.user_id);
          if (allScores) {
            const globalPoints = allScores.reduce((s: number, r: any) => s + (r.total_points || 0), 0);
            await supabase.from('profiles').update({ points: globalPoints }).eq('id', row.user_id);
          }
        }
      }
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}
