import { describe, it, expect } from 'vitest';
import { buildMatchesForBracket, deriveStandings, getQFParticipants, simulateBracket, resolveBracket } from '../lib/bracketUtils';

const ath = (n: number) => ({ id: `a${n}`, name: `ATH ${n}`, country: `C${n}` });

/** R1 rows in the new bracket_data shape: row i pairs athletes 2i+1 vs 2i+2. */
function rows(count: number, override: (i: number) => any = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    match_number: i + 1,
    weight_category: '-73kg',
    bracket_data: { competitor1: ath(2 * i + 1), competitor2: ath(2 * i + 2), ...override(i) },
  }));
}

describe('buildMatchesForBracket', () => {
  it('uses stable athlete ids from bracket_data', () => {
    const ms = buildMatchesForBracket(rows(4), {}, '-73kg');
    const r1 = ms.filter((m) => m.round === 'R1');
    expect(r1[0].competitor1?.id).toBe('a1');
    expect(r1[0].competitor2?.id).toBe('a2');
    expect(r1[0].competitor1?.country).toBe('C1');
  });

  it('falls back to legacy pdf ids when bracket_data has no id', () => {
    const legacy = [{ id: 'row9', match_number: 1, bracket_data: { competitor1: { name: 'X', country: 'JPN' }, competitor2: { name: 'Y' } } }];
    const ms = buildMatchesForBracket(legacy, {}, '-73kg');
    expect(ms[0].competitor1?.id).toBe('pdf-row9-competitor1');
    expect(ms[0].competitor2?.id).toBe('pdf-row9-competitor2');
    expect(ms[0].competitor2?.country).toBe('N/A');
  });

  it('uses stored pool when present, computed pool otherwise', () => {
    const ms = buildMatchesForBracket(rows(4, (i) => (i === 0 ? { pool: 'C' } : {})), {}, '-73kg');
    const r1 = ms.filter((m) => m.round === 'R1');
    expect(r1[0].pool).toBe('C');
    expect(r1[1].pool).toBe('B');
  });
});

describe('byes and stale winners', () => {
  it('auto-advances a bye in the competitor1 position', () => {
    const data = rows(4, (i) => (i === 0 ? { competitor1: null } : {}));
    const ms = buildMatchesForBracket(data, {}, '-73kg');
    expect(ms[0].competitor1).toBeNull();
    const sim = simulateBracket(ms, {});
    const sf1 = sim.find((m) => m.id === 'r2-m0')!;
    expect(sf1.competitor1?.id).toBe('a2');

    const picks = { m2: 'a3', m3: 'a5', m4: 'a7', 'r2-m0': 'a2', 'r2-m1': 'a5', 'r3-m0': 'a2' };
    const st = deriveStandings(ms, picks);
    expect(st.find((s) => s.position === 1)?.competitorId).toBe('a2');
    expect(st.find((s) => s.position === 2)?.competitorId).toBe('a5');
  });

  it('explicit pick of competitor2 still works when competitor1 is a bye', () => {
    const ms = buildMatchesForBracket(rows(4, (i) => (i === 0 ? { competitor1: null } : {})), {}, '-73kg');
    const sim = simulateBracket(ms, { m1: 'a2' });
    expect(sim.find((m) => m.id === 'r2-m0')!.competitor1?.id).toBe('a2');
  });

  it('stale winner id (not in the match) yields no standing', () => {
    const ms = buildMatchesForBracket(rows(4), {}, '-73kg');
    const picks = { m1: 'a1', m2: 'a3', m3: 'a5', m4: 'a7', 'r2-m0': 'a1', 'r2-m1': 'a5', 'r3-m0': 'ghost' };
    const st = deriveStandings(ms, picks);
    expect(st.some((s) => s.position <= 2)).toBe(false);
    // SF losers still get 3rd (no repechage)
    expect(st.filter((s) => s.position === 3).map((s) => s.competitorId).sort()).toEqual(['a3', 'a7']);
  });

  it('stale winner does not propagate to the next round', () => {
    const ms = buildMatchesForBracket(rows(4), {}, '-73kg');
    const sim = simulateBracket(ms, { m1: 'a9' });
    expect(sim.find((m) => m.id === 'r2-m0')!.competitor1).toBeNull();
  });

  it('QF participants for a 16 field', () => {
    const ms = buildMatchesForBracket(rows(8), {}, '-73kg', true);
    const picks: Record<string, string> = {};
    for (let i = 0; i < 8; i++) picks[`m${i + 1}`] = `a${2 * i + 1}`;
    expect(getQFParticipants(ms, picks).sort()).toEqual(['a1', 'a11', 'a13', 'a15', 'a3', 'a5', 'a7', 'a9']);
  });
});

describe('resolveBracket', () => {
  it('propagates winners and drops downstream picks invalidated by a changed winner', () => {
    const ms = buildMatchesForBracket(rows(4), {}, '-73kg'); // 8 athletes: R1 (4) → SF (2) → F
    const sf0 = ms.find((m) => m.round === 'SF' && m.nextMatchSlot === 1)!;
    const final = ms.find((m) => m.round === 'F')!;
    const picks = { m1: 'a1', m2: 'a3', [sf0.id]: 'a1', [final.id]: 'a1', additional_pick: 'a5' };

    const ok = resolveBracket(ms, picks);
    expect(ok.picks).toEqual(picks);
    expect(ok.matches.find((m) => m.id === sf0.id)?.competitor1?.id).toBe('a1');

    // Changing R1 m1 to a2 invalidates the SF and Final picks of a1; other keys stay
    const changed = resolveBracket(ok.matches, { ...ok.picks, m1: 'a2' });
    expect(changed.picks[sf0.id]).toBeUndefined();
    expect(changed.picks[final.id]).toBeUndefined();
    expect(changed.picks.m2).toBe('a3');
    expect(changed.picks.additional_pick).toBe('a5');
    expect(changed.matches.find((m) => m.id === sf0.id)?.competitor1?.id).toBe('a2');
  });
});
