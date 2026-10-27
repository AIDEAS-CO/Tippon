import { normalizeWeightCategoryLabel } from './rosterImportUtils';

/** One `tournament_scores` row (subset) used to build leaderboards. */
export interface ScoreRow {
  user_id: string;
  category: string;
  total_points: number | null;
}

export interface Ranking {
  userId: string;
  points: number;
  rank: number;
}

export interface CategoryDay {
  name: string;
  day?: number | null;
}

/** Normalize a weight label for matching: strip gender prefix, whitespace, case and trailing "kg". */
function weightKey(s: string): string {
  return normalizeWeightCategoryLabel(s).replace(/kg$/, '');
}

/** True when two category labels refer to the same weight class (e.g. "Men -60kg" vs "-60kg"). */
export function weightsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const ka = weightKey(a);
  return ka !== '' && ka === weightKey(b);
}

/** Special score rows (`_medal_table_*_`, `_bonuses_`) belong to no weight category. */
export function isSpecialCategory(category: string): boolean {
  return category.startsWith('_');
}

/**
 * Sum points per user and rank them (desc). Ties share a rank using
 * competition ranking (1, 1, 3).
 */
export function aggregateRanking(
  rows: ScoreRow[],
  opts: { categoryFilter?: (cat: string) => boolean } = {}
): Ranking[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (opts.categoryFilter && !opts.categoryFilter(r.category)) continue;
    totals.set(r.user_id, (totals.get(r.user_id) || 0) + (Number(r.total_points) || 0));
  }
  const sorted = Array.from(totals.entries())
    .map(([userId, points]) => ({ userId, points }))
    .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));

  const out: Ranking[] = [];
  sorted.forEach((r, i) => {
    const rank = i > 0 && sorted[i - 1].points === r.points ? out[i - 1].rank : i + 1;
    out.push({ ...r, rank });
  });
  return out;
}

/** Competition day of a category, or null for special rows / unknown categories. */
export function dayOfCategory(category: string, categories: CategoryDay[]): number | null {
  if (isSpecialCategory(category)) return null;
  const c = categories.find((x) => weightsMatch(x.name, category));
  return c && typeof c.day === 'number' ? c.day : null;
}

/** Total leaderboard plus one leaderboard per competition day that has score rows. */
export function buildDayRankings(
  rows: ScoreRow[],
  categories: CategoryDay[]
): { total: Ranking[]; byDay: Record<number, Ranking[]>; latestDay: number | null } {
  const dayByCategory = new Map<string, number | null>();
  const dayOf = (cat: string) => {
    if (!dayByCategory.has(cat)) dayByCategory.set(cat, dayOfCategory(cat, categories));
    return dayByCategory.get(cat)!;
  };

  const days = new Set<number>();
  for (const r of rows) {
    const d = dayOf(r.category);
    if (d !== null) days.add(d);
  }

  const byDay: Record<number, Ranking[]> = {};
  for (const d of days) {
    byDay[d] = aggregateRanking(rows, { categoryFilter: (cat) => dayOf(cat) === d });
  }

  return {
    total: aggregateRanking(rows),
    byDay,
    latestDay: days.size > 0 ? Math.max(...days) : null,
  };
}

/**
 * Look up a value keyed by category name, tolerating label differences between
 * bracket `weight_category` and `categories.name` (exact key first, then normalized weight).
 */
export function lookupByWeight<T>(map: Map<string, T>, label: string): T | undefined {
  if (map.has(label)) return map.get(label);
  for (const [k, v] of map) {
    if (weightsMatch(k, label)) return v;
  }
  return undefined;
}

/** Rank of a user in a ranking plus the field size, or null if absent. */
export function rankOf(ranking: Ranking[], userId: string): { rank: number; of: number; points: number } | null {
  const r = ranking.find((x) => x.userId === userId);
  return r ? { rank: r.rank, of: ranking.length, points: r.points } : null;
}

/**
 * Tournament to show the user's standing for: LIVE first, else COMPLETED, most recent date first,
 * restricted to tournaments the user has score rows in.
 */
export function selectStandingTournament<T extends { id: string | number; status?: string; date?: string }>(
  tournaments: T[],
  participatedIds: Set<string>
): T | null {
  const time = (d?: string) => {
    const t = d ? Date.parse(d) : NaN;
    return isNaN(t) ? 0 : t;
  };
  const pick = (status: string) =>
    tournaments
      .filter((t) => (t.status || '').toUpperCase() === status && participatedIds.has(String(t.id)))
      .sort((a, b) => time(b.date) - time(a.date))[0] || null;
  return pick('LIVE') || pick('COMPLETED');
}
