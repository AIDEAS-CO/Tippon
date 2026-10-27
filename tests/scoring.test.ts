import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }));

import {
  scoreCategory,
  rankStepDistance,
  getCfg,
  goldenMatchesForCategory,
  splitMedalTableCategories,
} from '../lib/scoringEngine';
import { buildMatchesForBracket, deriveStandings, getQFParticipants } from '../lib/bracketUtils';
import { computeCountryMedalRanking, countryRanksFromMedalRows } from '../lib/countryMedalRanking';
import { CategoryStandings, Match } from '../types';

const CAT = '-73kg';
const ath = (n: number) => ({ id: `a${n}`, name: `ATH ${n}`, country: `C${n}` });

function rows(count: number, cat = CAT) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${cat}-m${i + 1}`,
    match_number: i + 1,
    weight_category: cat,
    bracket_data: { competitor1: ath(2 * i + 1), competitor2: ath(2 * i + 2) },
  }));
}

/**
 * 16-athlete bracket with repechage. Actual results:
 * 1 a1, 2 a9, 3 a3 + a11, 5 a13 + a5, 7 a7 + a15.
 */
function bracket16() {
  const matches = buildMatchesForBracket(rows(8), {}, CAT, true);
  const results: Record<string, string> = {};
  for (let i = 0; i < 8; i++) results[`${CAT}-m${i + 1}`] = `a${2 * i + 1}`;
  Object.assign(results, {
    'r2-m0': 'a1', 'r2-m1': 'a5', 'r2-m2': 'a9', 'r2-m3': 'a13',
    'r3-m0': 'a1', 'r3-m1': 'a9',
    'r4-m0': 'a1',
    'rep-0': 'a3', 'rep-1': 'a11',
    'bronze-0': 'a3', 'bronze-1': 'a11',
  });
  return { matches, results };
}

function score(
  matches: Match[],
  results: Record<string, string>,
  predicted: CategoryStandings[],
  picks: Record<string, string> = {},
  config: Record<string, any> = {},
  golden: any[] = []
) {
  const actual = deriveStandings(matches, results);
  return scoreCategory(
    predicted, actual, getQFParticipants(matches, picks), getQFParticipants(matches, results),
    picks, config, golden, results, matches
  );
}

const pred = (position: number, id: string): CategoryStandings => ({ position, competitorId: id });

describe('rank-step distance', () => {
  it('maps positions 1,2,3,5,7 to steps', () => {
    expect(rankStepDistance(3, 5)).toBe(1);
    expect(rankStepDistance(3, 7)).toBe(2);
    expect(rankStepDistance(1, 5)).toBe(3);
    expect(rankStepDistance(1, 1)).toBe(0);
    expect(rankStepDistance(2, null)).toBe(99);
  });
});

describe('scoreCategory — 16 field with repechage', () => {
  it('derives actual standings 1,2,3,3,5,5,7,7', () => {
    const { matches, results } = bracket16();
    const st = deriveStandings(matches, results);
    expect(st.map((s) => `${s.position}:${s.competitorId}`)).toEqual([
      '1:a1', '2:a9', '3:a3', '3:a11', '5:a13', '5:a5', '7:a7', '7:a15',
    ]);
  });

  it('exact medals from identical picks', () => {
    const { matches, results } = bracket16();
    const predicted = deriveStandings(matches, results).filter((s) => s.position <= 3);
    const { breakdown } = score(matches, results, predicted, results);
    expect(breakdown.goldSilver.map((d) => d.points)).toEqual([6, 6]);
    expect(breakdown.bronze.map((d) => d.points)).toEqual([4, 4]);
    expect(breakdown.poolFinals).toEqual({ correct: 8, total: 8, points: 8 });
    expect(breakdown.categoryTotal).toBe(28);
  });

  it('3rd→5th = bronze_dev1, 3rd→7th = bronze_dev2', () => {
    const { matches, results } = bracket16();
    const { breakdown } = score(matches, results, [pred(3, 'a13'), pred(3, 'a7')]);
    expect(breakdown.bronze.map((d) => [d.actual, d.deviation, d.points])).toEqual([
      [5, 1, 3],
      [7, 2, 1],
    ]);
  });

  it('gold→5th = gold_silver_dev3', () => {
    const { matches, results } = bracket16();
    const { breakdown } = score(matches, results, [pred(1, 'a5')]);
    expect(breakdown.goldSilver[0]).toMatchObject({ actual: 5, deviation: 3, points: 1 });
  });

  it('missing actual placement scores 0 with deviation 99', () => {
    const { matches, results } = bracket16();
    const { breakdown } = score(matches, results, [pred(2, 'a2')]);
    expect(breakdown.goldSilver[0]).toMatchObject({ actual: null, deviation: 99, points: 0 });
  });

  it('additional pick in top 7 scores; outside top 7 does not; predicted medalist does not', () => {
    const { matches, results } = bracket16();
    expect(score(matches, results, [], { additional_pick: 'a15' }).breakdown.additionalPick.points).toBe(2);
    expect(score(matches, results, [], { additional_pick: 'a2' }).breakdown.additionalPick.points).toBe(0);
    expect(
      score(matches, results, [pred(3, 'a15')], { additional_pick: 'a15' }).breakdown.additionalPick.points
    ).toBe(0);
  });

  it('config value 0 disables a rule; missing key uses default', () => {
    const { matches, results } = bracket16();
    const { breakdown } = score(matches, results, [pred(3, 'a13')], {}, { bronze_dev1: 0 });
    expect(breakdown.bronze[0].points).toBe(0);
    expect(getCfg({ bronze_dev1: 0 }, 'bronze_dev1')).toBe(0);
    expect(getCfg({}, 'bronze_dev1')).toBe(3);
  });
});

describe('scoreCategory — 8 field without repechage', () => {
  it('SF losers share 3rd and exact medals score', () => {
    const matches = buildMatchesForBracket(rows(4), {}, CAT, false);
    const results: Record<string, string> = {
      [`${CAT}-m1`]: 'a1', [`${CAT}-m2`]: 'a3', [`${CAT}-m3`]: 'a5', [`${CAT}-m4`]: 'a7',
      'r2-m0': 'a1', 'r2-m1': 'a5', 'r3-m0': 'a5',
    };
    const actual = deriveStandings(matches, results);
    expect(actual.map((s) => `${s.position}:${s.competitorId}`)).toEqual(['1:a5', '2:a1', '3:a3', '3:a7']);
    const { breakdown } = score(matches, results, actual, results);
    expect(breakdown.categoryTotal).toBe(6 + 6 + 4 + 4);
    // Pick gold = a1 (actual silver) → 1 step
    const swapped = score(matches, results, [pred(1, 'a1')]);
    expect(swapped.breakdown.goldSilver[0]).toMatchObject({ deviation: 1, points: 3 });
  });
});

describe('golden matches', () => {
  const golden = [
    { category: 'Men -73kg', matchId: 'r4-m0', points: 5 },
    { category: '-81kg', matchId: 'r4-m0', points: 9 },
  ];

  it('filters by category using weight matching', () => {
    expect(goldenMatchesForCategory(golden, CAT)).toEqual([golden[0]]);
    expect(goldenMatchesForCategory(undefined, CAT)).toEqual([]);
  });

  it('hit adds points to total and records a line', () => {
    const { matches, results } = bracket16();
    const g = goldenMatchesForCategory(golden, CAT);
    const { total, breakdown } = score(matches, results, [], { 'r4-m0': 'a1' }, {}, g);
    expect(breakdown.goldenLines).toEqual([
      { matchId: 'r4-m0', round: 'F', pickedId: 'a1', pickedName: 'ATH 1', winnerId: 'a1', winnerName: 'ATH 1', points: 5 },
    ]);
    expect(total).toBe(5);
    expect(breakdown.categoryTotal).toBe(5);
  });

  it('miss scores 0', () => {
    const { matches, results } = bracket16();
    const g = goldenMatchesForCategory(golden, CAT);
    const { total, breakdown } = score(matches, results, [], { 'r4-m0': 'a9' }, {}, g);
    expect(breakdown.goldenLines?.[0].points).toBe(0);
    expect(total).toBe(0);
  });

  it('no golden matches → no goldenLines field', () => {
    const { matches, results } = bracket16();
    expect(score(matches, results, []).breakdown.goldenLines).toBeUndefined();
  });
});

describe('medal table — Mixed category', () => {
  it('Mixed counts only in Total', () => {
    const cats = ['-60kg', '-48kg', 'Mixed Teams'];
    const gender = new Map([['-60kg', 'Male'], ['-48kg', 'Female'], ['Mixed Teams', 'Mixed']]);
    const { menCats, womenCats, totalCats } = splitMedalTableCategories(cats, gender);
    expect(menCats).toEqual(['-60kg']);
    expect(womenCats).toEqual(['-48kg']);
    expect(totalCats).toEqual(cats);

    // Teams bracket: competitors are countries (name = IOC code, no country field)
    const team = (code: string) => ({ id: `t-${code}`, name: code });
    const teamRows = [
      { id: 'tm1', match_number: 1, weight_category: 'Mixed Teams', bracket_data: { competitor1: team('JPN'), competitor2: team('FRA') } },
      { id: 'tm2', match_number: 2, weight_category: 'Mixed Teams', bracket_data: { competitor1: team('GEO'), competitor2: team('KOR') } },
    ];
    const menRows = rows(2, '-60kg');
    const resultsByCat = new Map<string, Record<string, string>>([
      ['Mixed Teams', { tm1: 't-JPN', tm2: 't-GEO', 'r2-m0': 't-JPN' }],
      ['-60kg', { '-60kg-m1': 'a1', '-60kg-m2': 'a3', 'r2-m0': 'a1' }],
    ]);
    const dbMatches = [...teamRows, ...menRows];

    const men = computeCountryMedalRanking(menCats, dbMatches, {}, resultsByCat, false);
    expect(men.map((r) => r.country)).toEqual(['C1', 'C3']);

    const total = computeCountryMedalRanking(totalCats, dbMatches, {}, resultsByCat, false);
    const ranks = countryRanksFromMedalRows(total);
    expect(total.find((r) => r.country === 'JPN')).toMatchObject({ g: 1, s: 0 });
    expect(total.find((r) => r.country === 'GEO')).toMatchObject({ g: 0, s: 1 });
    expect(ranks.has('JPN')).toBe(true);
  });
});
