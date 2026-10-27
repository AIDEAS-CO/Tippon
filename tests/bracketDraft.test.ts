import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  addAthlete,
  deleteAthlete,
  draftToBracketRows,
  emptyCategory,
  findAthlete,
  matchConfiguredCategory,
  matchesToSlots,
  moveBetweenCategories,
  moveToSlot,
  moveToUnassigned,
  newerDraft,
  normalizeWeightKey,
  rowsToDraftCategory,
  setFieldSize,
  swapSlots,
  updateAthlete,
  validateCategory,
  type BracketDraft,
  type DraftCategory,
  type DrawAthlete,
} from '../lib/bracketDraft';
import { buildMatchesForBracket } from '../lib/bracketUtils';
import { parseDrawPages, type PdfPageText, type PdfTextItem } from '../lib/drawPdfParser';

const ath = (n: string, country = 'AAA'): DrawAthlete => ({ id: `id-${n}`, name: `${n} Name`, country });

function cat8(weight = '-60kg'): DraftCategory {
  const c = emptyCategory(weight, 'Male', 8, 'pdf');
  c.slots = [ath('a'), null, ath('b'), ath('c'), ath('d'), null, ath('e'), ath('f')];
  return c;
}

function draftOf(...cats: DraftCategory[]): BracketDraft {
  return { version: 1, updatedAt: '2026-01-01T00:00:00.000Z', categories: Object.fromEntries(cats.map((c) => [c.weight, c])) };
}

const names = (c: DraftCategory) => c.slots.map((a) => a?.id ?? null);

describe('weight matching', () => {
  it('normalizes labels', () => {
    expect(normalizeWeightKey('Men -60 kg')).toBe('-60');
    expect(normalizeWeightKey("Women's +78KG")).toBe('+78');
    expect(normalizeWeightKey('Mixed Teams')).toBe('teams');
    expect(matchConfiguredCategory('-60kg', ['-66kg', '-60kg'])).toBe('-60kg');
    expect(matchConfiguredCategory('Women -48 kg', ['-48kg'])).toBe('-48kg');
    expect(matchConfiguredCategory('Teams', ['Teams'])).toBe('Teams');
    expect(matchConfiguredCategory('-61kg', ['-60kg'])).toBeNull();
  });
});

describe('moves', () => {
  it('swapSlots swaps positions without mutating input', () => {
    const c = cat8();
    const s = swapSlots(c, 0, 3);
    expect(names(s).slice(0, 4)).toEqual(['id-c', null, 'id-b', 'id-a']);
    expect(c.slots[0]?.id).toBe('id-a');
  });

  it('moveToSlot moves into empty slot and swaps with occupant', () => {
    const d = draftOf(cat8());
    const m1 = moveToSlot(d, 'id-a', '-60kg', 1);
    expect(names(m1.categories['-60kg']).slice(0, 2)).toEqual([null, 'id-a']);
    const m2 = moveToSlot(d, 'id-a', '-60kg', 7);
    expect(m2.categories['-60kg'].slots[7]?.id).toBe('id-a');
    expect(m2.categories['-60kg'].slots[0]?.id).toBe('id-f');
    expect(d.categories['-60kg'].slots[0]?.id).toBe('id-a');
  });

  it('tray: move out, back in, occupant goes to tray on swap', () => {
    let d = draftOf(cat8());
    d = moveToUnassigned(d, 'id-b');
    expect(d.categories['-60kg'].slots[2]).toBeNull();
    expect(d.categories['-60kg'].unassigned.map((a) => a.id)).toEqual(['id-b']);
    d = moveToSlot(d, 'id-b', '-60kg', 0); // occupied by a
    expect(d.categories['-60kg'].slots[0]?.id).toBe('id-b');
    expect(d.categories['-60kg'].unassigned.map((a) => a.id)).toEqual(['id-a']);
  });

  it('cross-category via tray and direct slot drop', () => {
    let d = draftOf(cat8('-60kg'), cat8x('-66kg'));
    d = moveBetweenCategories(d, 'id-a', '-66kg');
    expect(d.categories['-60kg'].slots[0]).toBeNull();
    expect(d.categories['-66kg'].unassigned.map((a) => a.id)).toEqual(['id-a']);
    d = moveToSlot(d, 'id-a', '-66kg', 1);
    expect(d.categories['-66kg'].slots[1]?.id).toBe('id-a');
    expect(d.categories['-66kg'].unassigned).toEqual([]);
    // Direct slot→slot across categories swaps
    d = moveToSlot(d, 'id-x1', '-60kg', 2);
    expect(d.categories['-60kg'].slots[2]?.id).toBe('id-x1');
    expect(findAthlete(d, 'id-b')?.loc).toEqual({ weight: '-66kg', kind: 'slot', index: 0 });
  });

  it('add / update / delete athlete', () => {
    let d = draftOf(cat8());
    d = addAthlete(d, '-60kg', { name: ' NEW Guy ', country: 'fra' });
    const added = d.categories['-60kg'].unassigned[0];
    expect(added.name).toBe('NEW Guy');
    expect(added.country).toBe('FRA');
    d = updateAthlete(d, added.id, { country: 'gerx' });
    expect(findAthlete(d, added.id)?.athlete.country).toBe('GER');
    d = deleteAthlete(d, added.id);
    expect(findAthlete(d, added.id)).toBeNull();
  });
});

function cat8x(weight: string): DraftCategory {
  const c = emptyCategory(weight, 'Male', 8, 'pdf');
  c.slots = [ath('x1'), null, ath('x2'), null, ath('x3'), null, ath('x4'), null];
  return c;
}

describe('setFieldSize', () => {
  it('grows by padding each pool and keeps pool membership', () => {
    const g = setFieldSize(cat8(), 16)!;
    expect(g.fieldSize).toBe(16);
    expect(names(g)).toEqual([
      'id-a', null, null, null,
      'id-b', 'id-c', null, null,
      'id-d', null, null, null,
      'id-e', 'id-f', null, null,
    ]);
  });

  it('shrinks only when dropped slots are empty', () => {
    const g = setFieldSize(cat8(), 16)!;
    expect(names(setFieldSize(g, 8)!)).toEqual(names(cat8()));
    const blocked = { ...g, slots: [...g.slots] };
    blocked.slots[3] = ath('z');
    expect(setFieldSize(blocked, 8)).toBeNull();
  });
});

describe('validateCategory', () => {
  it('reports duplicates, empty fights, count and tray', () => {
    expect(validateCategory(cat8()).errors).toEqual([]);
    const c = cat8();
    c.declaredCount = 7;
    c.slots[1] = { ...c.slots[0]! };
    c.slots[4] = null; // fight 3 now empty with 6 athletes > 4 fights
    c.unassigned = [ath('t')];
    const v = validateCategory(c);
    expect(v.athleteCount).toBe(6);
    expect(v.errors.some((e) => e.includes('Duplicate athlete id'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('declares 7'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('Fight 3 has no athletes'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('unassigned'))).toBe(true);
    expect(validateCategory(emptyCategory('-60kg', 'Male', 8)).errors).toContain('At least 2 athletes are required');
  });
});

describe('DB mapping', () => {
  it('draftToBracketRows → rowsToDraftCategory round trip', () => {
    const c = setFieldSize(cat8(), 32)!;
    const rows = draftToBracketRows(7, '-60kg', c).map((r, i) => ({ ...r, id: `row-${i}` }));
    expect(rows).toHaveLength(16);
    expect(rows[0].match_number).toBe(1);
    expect(rows.map((r) => r.bracket_data.pool).join('')).toBe('AAAABBBBCCCCDDDD');
    const back = rowsToDraftCategory(rows, '-60kg', 'Male');
    expect(back.fieldSize).toBe(32);
    expect(names(back)).toEqual(names(c));
  });

  it('legacy rows keep buildMatchesForBracket ids (pdf-<row>-competitorN and roster FK)', () => {
    const legacy = [
      { id: 'r1', match_number: 1, bracket_data: { competitor1: { name: 'A A', country: 'FRA' }, competitor2: null } },
      { id: 'r2', match_number: 2, competitor_1: 'uuid-1', bracket_data: { competitor1: null, competitor2: { name: 'B B', country: 'JPN' } } },
      { id: 'r3', match_number: 3, bracket_data: { competitor1: { id: 'ath-3', name: 'C C', country: 'GER' }, competitor2: null } },
      { id: 'r4', match_number: 4, bracket_data: null },
    ];
    const roster = { 'uuid-1': { name: 'ROSTER Guy', country: 'BRA' } };
    const cat = rowsToDraftCategory(legacy, '-60kg', 'Male', roster);
    expect(cat.fieldSize).toBe(8);
    const ids = names(cat);
    expect(ids).toEqual(['pdf-r1-competitor1', null, 'uuid-1', 'pdf-r2-competitor2', 'ath-3', null, null, null]);

    const rosterMap = { 'uuid-1': { id: 'uuid-1', name: 'ROSTER Guy', country: 'BRA', flagUrl: '' } };
    const before = buildMatchesForBracket(legacy, rosterMap, '-60kg').filter((m) => m.round === 'R1');
    const after = buildMatchesForBracket(
      draftToBracketRows(1, '-60kg', cat).map((r, i) => ({ ...r, id: legacy[i].id })),
      rosterMap,
      '-60kg'
    ).filter((m) => m.round === 'R1');
    expect(after.map((m) => [m.id, m.competitor1?.id ?? null, m.competitor2?.id ?? null])).toEqual(
      before.map((m) => [m.id, m.competitor1?.id ?? null, m.competitor2?.id ?? null])
    );
  });

  it('matchesToSlots sizes to the bracket', () => {
    const s = matchesToSlots([
      { competitor1: { name: 'A', country: 'fra' }, competitor2: null },
      { competitor1: { name: 'B', country: 'JPN' }, competitor2: { name: 'C', country: 'GER' } },
    ]);
    expect(s).toHaveLength(8);
    expect(s[0]?.country).toBe('FRA');
    expect(s[1]).toBeNull();
    expect(s[3]?.name).toBe('C');
  });
});

describe('newerDraft', () => {
  it('picks later updatedAt, handles nulls', () => {
    const a: BracketDraft = { version: 1, updatedAt: '2026-01-01T10:00:00Z', categories: {} };
    const b: BracketDraft = { version: 1, updatedAt: '2026-01-01T11:00:00Z', categories: {} };
    expect(newerDraft(a, b)).toBe(b);
    expect(newerDraft(b, a)).toBe(b);
    expect(newerDraft(null, a)).toBe(a);
    expect(newerDraft(a, undefined)).toBe(a);
    expect(newerDraft(null, null)).toBeNull();
  });
});

// ── End-to-end: PDF → draft → rows → bracket ─────────────────────────────────

async function loadPages(file: string): Promise<PdfPageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(file));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const pages: PdfPageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], height: it.height, width: it.width });
    }
    pages.push({ pageNumber: p, width: viewport.width, height: viewport.height, items });
  }
  await doc.destroy();
  return pages;
}

describe('Draw (1).pdf end-to-end placement', () => {
  it('every R1 match equals the PDF slots for all 14 categories', async () => {
    const cats = parseDrawPages(await loadPages(path.resolve(__dirname, '..', 'Draw (1).pdf')));
    expect(cats).toHaveLength(14);
    const configured = ['Men -60kg', '-66kg', '-73 kg', '-81kg', '-90kg', '-100kg', '+100kg', '-48kg', '-52kg', '-57kg', '-63kg', '-70kg', '-78kg', '+78kg'];
    for (const pc of cats) {
      const name = matchConfiguredCategory(pc.weight, configured);
      expect(name, pc.weight).not.toBeNull();
      const dc: DraftCategory = { ...emptyCategory(name!, pc.gender, pc.fieldSize, 'pdf'), slots: pc.slots, declaredCount: pc.declaredCount };
      expect(validateCategory(dc).errors, pc.weight).toEqual([]);
      expect(validateCategory(dc).warnings, pc.weight).toEqual([]);
      const rows = draftToBracketRows(1, name!, dc).map((r, i) => ({ ...r, id: `${name}-${i}` }));
      const r1 = buildMatchesForBracket(rows, {}, name!, true).filter((m) => m.round === 'R1');
      expect(r1).toHaveLength(pc.fieldSize / 2);
      r1.forEach((m, i) => {
        const exp1 = pc.slots[2 * i];
        const exp2 = pc.slots[2 * i + 1];
        expect(m.competitor1 && { id: m.competitor1.id, name: m.competitor1.name, country: m.competitor1.country }, `${pc.weight} fight ${i + 1}`).toEqual(exp1 ?? null);
        expect(m.competitor2 && { id: m.competitor2.id, name: m.competitor2.name, country: m.competitor2.country }, `${pc.weight} fight ${i + 1}`).toEqual(exp2 ?? null);
        expect(m.pool).toBe('ABCD'[Math.floor(i / (pc.fieldSize / 8))]);
      });
    }
  }, 60_000);
});
