import { readFileSync } from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  pageHasTextLayer,
  parseDrawPages,
  slotsToR1Matches,
  type DrawAthlete,
  type ParsedCategory,
  type PdfPageText,
  type PdfTextItem,
} from '../lib/drawPdfParser';

const PDF_PATH = path.resolve(__dirname, '..', 'Draw (1).pdf');

/** Node-side loader (legacy pdfjs build, no worker) producing the same shape as extractPdfPageTexts. */
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

const EXPECTED = [
  { weight: '-60kg', gender: 'Male', count: 26, size: 32 },
  { weight: '-66kg', gender: 'Male', count: 28, size: 32 },
  { weight: '-73kg', gender: 'Male', count: 41, size: 64 },
  { weight: '-81kg', gender: 'Male', count: 38, size: 64 },
  { weight: '-90kg', gender: 'Male', count: 38, size: 64 },
  { weight: '-100kg', gender: 'Male', count: 32, size: 32 },
  { weight: '+100kg', gender: 'Male', count: 24, size: 32 },
  { weight: '-48kg', gender: 'Female', count: 21, size: 32 },
  { weight: '-52kg', gender: 'Female', count: 24, size: 32 },
  { weight: '-57kg', gender: 'Female', count: 33, size: 64 },
  { weight: '-63kg', gender: 'Female', count: 23, size: 32 },
  { weight: '-70kg', gender: 'Female', count: 35, size: 64 },
  { weight: '-78kg', gender: 'Female', count: 19, size: 32 },
  { weight: '+78kg', gender: 'Female', count: 18, size: 32 },
];

const brief = (a: DrawAthlete | null) => (a ? `${a.name}|${a.country}` : null);

/** "AGHAYEV Balabay" → "AGHAYEV"; "VALADIER PICARD Romain" → "VALADIER PICARD". */
function surnameOf(name: string): string {
  const tokens = name.split(' ');
  const caps: string[] = [];
  for (const t of tokens) {
    if (/[a-z]/.test(t)) break;
    caps.push(t);
  }
  return caps.join(' ');
}

let pages: PdfPageText[];
let cats: ParsedCategory[];

beforeAll(async () => {
  pages = await loadPages(PDF_PATH);
  cats = parseDrawPages(pages);
}, 60_000);

describe('parseDrawPages on Draw (1).pdf', () => {
  it('finds 14 categories in page order with weights and genders', () => {
    expect(pages.every(pageHasTextLayer)).toBe(true);
    expect(cats).toHaveLength(14);
    expect(cats.map((c) => c.weight)).toEqual(EXPECTED.map((e) => e.weight));
    expect(cats.map((c) => c.gender)).toEqual(EXPECTED.map((e) => e.gender));
    expect(cats.map((c) => c.pageNumber)).toEqual(EXPECTED.map((_, i) => i + 1));
  });

  it('fills exactly declaredCount slots with no warnings or duplicates', () => {
    cats.forEach((c, i) => {
      const filled = c.slots.filter(Boolean) as DrawAthlete[];
      expect(c.declaredCount, c.weight).toBe(EXPECTED[i].count);
      expect(c.fieldSize, c.weight).toBe(EXPECTED[i].size);
      expect(c.slots, c.weight).toHaveLength(c.fieldSize);
      expect(filled.length, c.weight).toBe(c.declaredCount);
      expect(c.warnings, c.weight).toEqual([]);
      expect(new Set(filled.map((a) => a.name)).size, c.weight).toBe(filled.length);
      expect(new Set(filled.map((a) => a.id)).size, c.weight).toBe(filled.length);
      for (const a of filled) {
        expect(a.country).toMatch(/^[A-Z]{3}$/);
        expect(a.id).toMatch(/^ath-/);
        expect(a.name).toMatch(/^[A-Z].* \S/);
      }
      // Every R1 match has at least one athlete.
      for (const m of slotsToR1Matches(c.slots)) {
        expect(m.competitor1 || m.competitor2, `${c.weight} match ${m.matchIndex}`).toBeTruthy();
      }
    });
  });

  it('page 1 (-60kg, 32 grid) spot checks', () => {
    const s = cats[0].slots.map(brief);
    expect(s[0]).toBe('AGHAYEV Balabay|AZE');
    expect(s[1]).toBeNull();
    expect(s[2]).toBe('BLAZIC Gal|SLO');
    expect(s[3]).toBe('CARLINO Andrea|ITA');
    expect(s[7]).toBe('AGHASYAN Vahe|ARM');
    // Pool B
    expect(s[8]).toBe('SARDALASHVILI Giorgi|GEO');
    expect(s[9]).toBeNull();
    expect(s[12]).toBe('VERSTRAETEN Jorre|BEL');
    expect(s[13]).toBeNull();
    expect(s[15]).toBe('IGNASIAK Ksawery|POL');
    // Pool C / D
    expect(s[16]).toBe('VALADIER PICARD Romain|FRA');
    expect(s[23]).toBe('YILDIZ Salih|TUR');
    expect(s[24]).toBe('YUSIFOV Ahmad|AZE');
    expect(s[28]).toBe('MKHEIDZE Luka|FRA');
    expect(s[29]).toBeNull();
    expect(s[30]).toBe('FERNANDES B.Tralhao|POR');
    expect(s[31]).toBe('BARROSO LOPEZ Luis|ESP');
  });

  it('page 3 (-73kg, 64 grid) spot checks', () => {
    const s = cats[2].slots.map(brief);
    expect(s[0]).toBe('GABA Joan-Benjamin|FRA');
    expect(s[1]).toBeNull(); // bye
    expect(s[2]).toBe('TOROSYAN Artak|ARM');
    expect(s[3]).toBeNull(); // bye
    expect(s[4]).toBe('HRISTOV Mark|BUL'); // fight
    expect(s[5]).toBe('OGRIZEK Urh|SLO');
    expect(s[6]).toBe('KHALIDOV Said-Magomed|UKR');
    expect(s[7]).toBeNull();
    expect(s[12]).toBe('SZABO Aron|HUN');
    expect(s[13]).toBe('ERRBOE Morgan|DEN');
    // Pool B starts at slot 16
    expect(s[16]).toBe('SHAVDATUASHVILI Lasha|GEO');
    expect(s[18]).toBe('OLIN Valtteri|FIN');
    expect(s[19]).toBe('ANDREOU Kyprianos|CYP');
    // Pool D last athlete
    expect(s[48]).toBe('VALERIANI Leonardo|ITA');
    expect(s[62]).toBe('CILOGLU Bilal|TUR');
    expect(s[63]).toBeNull();
  });

  it('cross-check: single-athlete R1 matches equal the bye-advanced names in the next column', () => {
    cats.forEach((c, i) => {
      const page = pages[i];
      const codeX = Math.min(
        ...page.items.filter((it) => /^[A-Z]{3}$/.test(it.str.trim()) && it.x < 300).map((it) => it.x)
      );
      // "AGHAYEV B. (AZE)" items printed in the R2 column for athletes with a bye.
      // Some are split into several items ("VARAPAYEU Y" + ". (BLR)"), so join items per baseline.
      const colItems = page.items
        .filter((it) => it.x > codeX + 20 && it.x < 300 && !/^\d+$/.test(it.str.trim()))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: string[] = [];
      let lastY = Infinity;
      for (const it of colItems) {
        if (Math.abs(it.y - lastY) < 1) lines[lines.length - 1] += it.str;
        else lines.push(it.str);
        lastY = it.y;
      }
      const fromPdf = lines
        .map((l) => l.trim().match(/^(.*) [A-Z]\. ?\(([A-Z]{3})\)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => `${m[1]}|${m[2]}`)
        .sort();
      expect(fromPdf.length, c.weight).toBe(lines.length);
      const fromSlots = slotsToR1Matches(c.slots)
        .filter((m) => !m.competitor1 !== !m.competitor2)
        .map((m) => (m.competitor1 ?? m.competitor2)!)
        .map((a) => `${surnameOf(a.name)}|${a.country}`)
        .sort();
      expect(fromSlots, c.weight).toEqual(fromPdf);
      expect(fromSlots.length, c.weight).toBe(c.fieldSize - c.declaredCount!);
    });
  });

  it('lattice fallback (fight numbers removed) yields identical slots', () => {
    const stripped = pages.map((p) => ({
      ...p,
      items: p.items.filter((it) => !/^\d{1,3}$/.test(it.str.trim())),
    }));
    const fb = parseDrawPages(stripped);
    expect(fb).toHaveLength(14);
    fb.forEach((c, i) => {
      expect(c.warnings, c.weight).toEqual([]);
      expect(c.slots.map(brief), c.weight).toEqual(cats[i].slots.map(brief));
    });
  });
});

describe('slotsToR1Matches', () => {
  it('splits matches into 4 pools', () => {
    const a = (n: string): DrawAthlete => ({ id: n, name: n, country: 'XXX' });
    const slots = Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? null : a(`P${i}`)));
    const m = slotsToR1Matches(slots);
    expect(m).toHaveLength(16);
    expect(m.map((x) => x.pool).join('')).toBe('AAAABBBBCCCCDDDD');
    expect(m[0].competitor1).toBeNull();
    expect(m[0].competitor2?.name).toBe('P1');
    expect(m[15].competitor1).toBeNull();
    expect(m[15].competitor2?.name).toBe('P31');
    expect(slotsToR1Matches(new Array(64).fill(null)).filter((x) => x.pool === 'B')).toHaveLength(8);
    expect(slotsToR1Matches(new Array(8).fill(null)).map((x) => x.pool).join('')).toBe('ABCD');
  });

  it('skips pages without weight label and names', () => {
    expect(
      parseDrawPages([{ pageNumber: 1, width: 595, height: 842, items: [{ str: 'Notes', x: 50, y: 400, height: 8, width: 30 }] }])
    ).toEqual([]);
  });
});
