import { buildMatchesForBracket, deriveStandings } from './bracketUtils';

export interface CountryMedalRow {
  country: string;
  g: number;
  s: number;
  b: number;
  total: number;
}

/**
 * Aggregate gold/silver/bronze by country across all weight categories from saved match results,
 * then sort by IJF-style medal table order (golds, then silvers, then bronzes, then code).
 */
export function computeCountryMedalRanking(
  categories: string[],
  dbMatches: any[],
  rosterMap: Record<string, { id: string; name?: string; country?: string; weight?: string }>,
  resultsByCat: Map<string, Record<string, string>>,
  hasRepechage: boolean
): CountryMedalRow[] {
  const medMap = new Map<string, { g: number; s: number; b: number }>();
  const bump = (country: string, kind: 'g' | 's' | 'b') => {
    const cur = medMap.get(country) || { g: 0, s: 0, b: 0 };
    cur[kind]++;
    medMap.set(country, cur);
  };

  for (const cat of categories) {
    const catDb = dbMatches.filter((m: any) => m.weight_category === cat);
    if (catDb.length === 0) continue;
    const built = buildMatchesForBracket(catDb, rosterMap as any, cat, hasRepechage);
    const picks = resultsByCat.get(cat) || {};
    const st = deriveStandings(built, picks);
    for (const row of st) {
      const cc =
        row.country && row.country !== 'N/A' ? String(row.country).toUpperCase() : '?';
      if (row.position === 1) bump(cc, 'g');
      else if (row.position === 2) bump(cc, 's');
      else if (row.position === 3) bump(cc, 'b');
    }
  }

  const rows: CountryMedalRow[] = Array.from(medMap.entries()).map(([country, { g, s, b }]) => ({
    country,
    g,
    s,
    b,
    total: g + s + b,
  }));
  rows.sort((a, b) => b.g - a.g || b.s - a.s || b.b - a.b || a.country.localeCompare(b.country));
  return rows;
}

/** 1-based rank per country code from a medal table (best = 1). */
export function countryRanksFromMedalRows(rows: CountryMedalRow[]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach((r, i) => m.set(r.country, i + 1));
  return m;
}
