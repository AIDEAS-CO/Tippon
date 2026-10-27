import { describe, it, expect } from 'vitest';
import { aggregateRanking, dayOfCategory, buildDayRankings, weightsMatch } from '../lib/rankings';

const categories = [
  { name: 'Men -60kg', day: 1 },
  { name: 'Women -48kg', day: 1 },
  { name: 'Men -73kg', day: 2 },
  { name: 'Mixed Teams', day: 3 },
];

describe('aggregateRanking', () => {
  it('sums per user and uses competition ranking for ties (1,1,3)', () => {
    const r = aggregateRanking([
      { user_id: 'u1', category: '-60kg', total_points: 10 },
      { user_id: 'u2', category: '-60kg', total_points: 6 },
      { user_id: 'u2', category: '-73kg', total_points: 4 },
      { user_id: 'u3', category: '-60kg', total_points: 3 },
    ]);
    expect(r).toEqual([
      { userId: 'u1', points: 10, rank: 1 },
      { userId: 'u2', points: 10, rank: 1 },
      { userId: 'u3', points: 3, rank: 3 },
    ]);
  });

  it('applies the category filter', () => {
    const r = aggregateRanking(
      [
        { user_id: 'u1', category: 'a', total_points: 5 },
        { user_id: 'u1', category: 'b', total_points: 7 },
      ],
      { categoryFilter: (c) => c === 'b' }
    );
    expect(r).toEqual([{ userId: 'u1', points: 7, rank: 1 }]);
  });
});

describe('dayOfCategory', () => {
  it('matches weight labels and excludes special rows', () => {
    expect(weightsMatch('Men -60kg', '-60kg')).toBe(true);
    expect(weightsMatch('-60kg', '-66kg')).toBe(false);
    expect(dayOfCategory('-60kg', categories)).toBe(1);
    expect(dayOfCategory('Men -73kg', categories)).toBe(2);
    expect(dayOfCategory('Mixed Teams', categories)).toBe(3);
    expect(dayOfCategory('_medal_table_total_', categories)).toBeNull();
    expect(dayOfCategory('_bonuses_', categories)).toBeNull();
    expect(dayOfCategory('-100kg', categories)).toBeNull();
  });
});

describe('buildDayRankings', () => {
  const rows = [
    { user_id: 'u1', category: '-60kg', total_points: 8 },
    { user_id: 'u2', category: 'Women -48kg', total_points: 4 },
    { user_id: 'u2', category: '-73kg', total_points: 12 },
    { user_id: 'u1', category: '_bonuses_', total_points: 10 },
    { user_id: 'u2', category: '_medal_table_total_', total_points: 3 },
  ];

  it('splits by day; special rows count only in Total', () => {
    const { total, byDay, latestDay } = buildDayRankings(rows, categories);
    expect(total).toEqual([
      { userId: 'u2', points: 19, rank: 1 },
      { userId: 'u1', points: 18, rank: 2 },
    ]);
    expect(byDay[1]).toEqual([
      { userId: 'u1', points: 8, rank: 1 },
      { userId: 'u2', points: 4, rank: 2 },
    ]);
    expect(byDay[2]).toEqual([{ userId: 'u2', points: 12, rank: 1 }]);
    expect(Object.keys(byDay)).toEqual(['1', '2']);
    expect(latestDay).toBe(2);
  });

  it('latestDay is null without day-scoped rows', () => {
    const r = buildDayRankings([{ user_id: 'u1', category: '_bonuses_', total_points: 5 }], categories);
    expect(r.latestDay).toBeNull();
    expect(r.byDay).toEqual({});
    expect(r.total).toEqual([{ userId: 'u1', points: 5, rank: 1 }]);
  });
});
