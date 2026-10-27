import { describe, it, expect } from 'vitest';
import { lookupByWeight, rankOf, aggregateRanking, selectStandingTournament } from '../lib/rankings';

describe('lookupByWeight', () => {
  const genders = new Map<string, string>([
    ['Men -60kg', 'Male'],
    ['Women -48kg', 'Female'],
    ['Mixed Teams', 'Mixed'],
  ]);

  it('prefers the exact key', () => {
    expect(lookupByWeight(genders, 'Mixed Teams')).toBe('Mixed');
  });

  it('falls back to normalized weight matching', () => {
    expect(lookupByWeight(genders, '-60kg')).toBe('Male');
    expect(lookupByWeight(genders, '-48 kg')).toBe('Female');
  });

  it('returns undefined when nothing matches', () => {
    expect(lookupByWeight(genders, '-100kg')).toBeUndefined();
  });
});

describe('rankOf', () => {
  const ranking = aggregateRanking([
    { user_id: 'a', category: '-60kg', total_points: 5 },
    { user_id: 'b', category: '-60kg', total_points: 5 },
    { user_id: 'c', category: '-60kg', total_points: 1 },
  ]);

  it('returns shared rank and field size', () => {
    expect(rankOf(ranking, 'b')).toEqual({ rank: 1, of: 3, points: 5 });
    expect(rankOf(ranking, 'c')).toEqual({ rank: 3, of: 3, points: 1 });
  });

  it('returns null for unknown users', () => {
    expect(rankOf(ranking, 'z')).toBeNull();
  });
});

describe('selectStandingTournament', () => {
  const ts = [
    { id: '1', status: 'COMPLETED', date: '2026-01-10' },
    { id: '2', status: 'COMPLETED', date: '2026-05-10' },
    { id: '3', status: 'LIVE', date: '2026-03-01' },
    { id: '4', status: 'UPCOMING', date: '2026-12-01' },
  ];

  it('prefers a LIVE tournament the user participates in', () => {
    expect(selectStandingTournament(ts, new Set(['1', '2', '3']))?.id).toBe('3');
  });

  it('falls back to the most recent COMPLETED one', () => {
    expect(selectStandingTournament(ts, new Set(['1', '2']))?.id).toBe('2');
  });

  it('returns null when the user has no LIVE/COMPLETED participation', () => {
    expect(selectStandingTournament(ts, new Set(['4']))).toBeNull();
  });
});
