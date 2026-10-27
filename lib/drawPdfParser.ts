/**
 * Deterministic parser for IJF/EJU-style judo draw PDFs (one weight category per page).
 *
 * Geometry (derived from the text layer, no hardcoded page coordinates):
 * - Header (top of page): weight label ("-60 kg") and declared count ("Seniors (26)").
 * - Draw rows: an IOC code item ("AZE") in the country column, with the athlete name
 *   item(s) to its left on the same baseline.
 * - Primary slot mapping: R1 fight numbers 1..fieldSize/2 printed at each R1 pair midpoint
 *   (the leftmost numeric column). A row above a number's y is the upper slot (2k),
 *   below is the lower slot (2k + 1).
 * - Fallback slot mapping (no fight numbers): a lattice fitted from the data —
 *   step = typical gap between consecutive rows, pool pitch = spacing of "POOL X" labels.
 * Bye-advanced names in later columns ("AGHAYEV B. (AZE)") are never standalone
 * IOC codes, so they are ignored automatically.
 */

export interface DrawAthlete {
  id: string;
  name: string;
  country: string;
}

export interface ParsedCategory {
  /** Normalized like "-60kg", "+78kg" (no space), or "Teams". */
  weight: string;
  gender: 'Male' | 'Female' | 'Mixed' | null;
  declaredCount: number | null;
  /** 8 / 16 / 32 / 64 / 128 */
  fieldSize: number;
  /** Length fieldSize; index = draw position top→bottom, Pool A first. */
  slots: (DrawAthlete | null)[];
  pageNumber: number;
  warnings: string[];
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  height: number;
  width: number;
}

export interface PdfPageText {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface R1Match {
  matchIndex: number;
  pool: 'A' | 'B' | 'C' | 'D';
  competitor1: DrawAthlete | null;
  competitor2: DrawAthlete | null;
}

const MEN_WEIGHTS = new Set(['-60kg', '-66kg', '-73kg', '-81kg', '-90kg', '-100kg', '+100kg']);
const WOMEN_WEIGHTS = new Set(['-48kg', '-52kg', '-57kg', '-63kg', '-70kg', '-78kg', '+78kg']);

const WEIGHT_RE = /([+-])\s*(\d{2,3})\s*kg\b/i;
const COUNT_RE = /\((\d{1,3})\)\s*$/;
const IOC_RE = /^[A-Z]{3}$/;
const NUMBER_RE = /^\d{1,3}$/;
const LABEL_RE = /^(POOL\s+[A-Z]|REPECHAGE|FINAL\s+RESULTS)\b/i;
const POOL_LABEL_RE = /^POOL\s+([A-D])$/i;
/** One or more ALL-CAPS surname tokens followed by a token containing a lowercase letter. */
const NAME_LIKE_RE = /^(?:[A-ZÀ-ÞĀ-ſ'’.\-]{2,}\s+)+\S*[a-zß-ÿĀ-ſ]/;

/** Footer band (timestamps, organizer) — ignored. */
const FOOTER_MAX_Y = 20;

interface DrawRow {
  name: string;
  country: string;
  y: number;
  x: number;
}

function newAthleteId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return `ath-${c.randomUUID()}`;
  return `ath-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function nextFieldSize(n: number): number {
  let size = 8;
  while (size < n && size < 128) size *= 2;
  return size;
}

export function genderForWeight(weight: string): ParsedCategory['gender'] {
  if (MEN_WEIGHTS.has(weight)) return 'Male';
  if (WOMEN_WEIGHTS.has(weight)) return 'Female';
  if (/team|mixed/i.test(weight)) return 'Mixed';
  return null;
}

/** True if the page has at least two "SURNAME Given" items (i.e. a usable text layer). */
export function pageHasTextLayer(page: PdfPageText): boolean {
  let n = 0;
  for (const it of page.items) {
    if (NAME_LIKE_RE.test(collapse(it.str)) && ++n >= 2) return true;
  }
  return false;
}

interface HeaderInfo {
  weight: string | null;
  declaredCount: number | null;
  /** Rows at or above this y belong to the header. */
  cutoffY: number;
}

function readHeader(page: PdfPageText): HeaderInfo {
  const topBand = page.height * 0.85;
  let weight: string | null = null;
  let weightY = Infinity;
  let declaredCount: number | null = null;
  let countY = Infinity;
  let teams = false;
  for (const it of page.items) {
    if (it.y < topBand) continue;
    const s = collapse(it.str);
    const w = s.match(WEIGHT_RE);
    if (w && weight === null) {
      weight = `${w[1]}${w[2]}kg`;
      weightY = it.y;
      continue;
    }
    const c = s.match(COUNT_RE);
    if (c && declaredCount === null) {
      declaredCount = parseInt(c[1], 10);
      countY = it.y;
      continue;
    }
    if (/\bteams?\b/i.test(s)) teams = true;
  }
  if (weight === null && teams) weight = 'Teams';
  const anchor = Math.min(weightY, countY);
  return {
    weight,
    declaredCount,
    cutoffY: Number.isFinite(anchor) ? anchor - 3 : page.height * 0.94,
  };
}

/** Pair each IOC code in the country column with the name text to its left on the same row. */
function readRows(page: PdfPageText, cutoffY: number, warnings: string[]): DrawRow[] {
  const body = page.items.filter(
    (it) => it.str.trim() !== '' && it.y > FOOTER_MAX_Y && it.y < cutoffY
  );
  const codeCandidates = body.filter(
    (it) => IOC_RE.test(it.str.trim()) && it.x < page.width * 0.4
  );
  if (codeCandidates.length === 0) return [];
  // Keep the dominant country column only.
  const colX = median(codeCandidates.map((c) => c.x));
  const codes = codeCandidates.filter((c) => Math.abs(c.x - colX) < 20);
  const used = new Set<PdfTextItem>();
  const rows: DrawRow[] = [];

  for (const code of codes) {
    const tol = Math.max(2, code.height * 0.4);
    const parts = body
      .filter(
        (it) =>
          it !== code &&
          !codes.includes(it) &&
          it.x < code.x - 1 &&
          Math.abs(it.y - code.y) <= tol &&
          !LABEL_RE.test(it.str.trim()) &&
          !NUMBER_RE.test(it.str.trim())
      )
      .sort((a, b) => a.x - b.x);
    let name = '';
    let prevEnd = -Infinity;
    for (const p of parts) {
      used.add(p);
      const gap = p.x - prevEnd;
      name += (name && gap > 1 ? ' ' : '') + p.str;
      prevEnd = p.x + p.width;
    }
    name = collapse(name);
    const country = code.str.trim();
    if (!name || name.toUpperCase() === country) name = country;
    const nameX = parts.length ? parts[0].x : code.x;
    rows.push({ name, country, y: code.y, x: nameX });
  }

  // Name-like items left of the country column that were not paired with a code.
  for (const it of body) {
    if (used.has(it) || it.x >= colX) continue;
    if (NAME_LIKE_RE.test(collapse(it.str))) {
      warnings.push(`Name without country code: "${collapse(it.str)}" (y=${it.y.toFixed(1)})`);
    }
  }

  rows.sort((a, b) => b.y - a.y);
  return rows;
}

/** Primary mapping: R1 fight numbers sit at the midpoint of each R1 pair. */
function slotsFromFightNumbers(
  page: PdfPageText,
  rows: DrawRow[],
  fieldSize: number
): number[] | null {
  const matchCount = fieldSize / 2;
  const nameX = Math.min(...rows.map((r) => r.x));
  const yMax = Math.max(...rows.map((r) => r.y));
  const yMin = Math.min(...rows.map((r) => r.y));
  const byValue = new Map<number, PdfTextItem>();
  for (const it of page.items) {
    const s = it.str.trim();
    if (!NUMBER_RE.test(s)) continue;
    const v = parseInt(s, 10);
    if (v < 1 || v > matchCount) continue;
    if (it.x <= nameX || it.x > page.width * 0.5) continue;
    if (it.y > yMax + 20 || it.y < yMin - 20) continue;
    const prev = byValue.get(v);
    if (!prev || it.x < prev.x) byValue.set(v, it);
  }
  if (byValue.size !== matchCount) return null;
  const mids: number[] = [];
  for (let v = 1; v <= matchCount; v++) {
    const y = byValue.get(v)!.y;
    if (mids.length && y >= mids[mids.length - 1]) return null; // must run top→bottom
    mids.push(y);
  }
  let minSpacing = Infinity;
  for (let k = 1; k < mids.length; k++) minSpacing = Math.min(minSpacing, mids[k - 1] - mids[k]);
  if (!Number.isFinite(minSpacing)) minSpacing = 40;

  const slots: number[] = [];
  for (const r of rows) {
    let best = 0;
    for (let k = 1; k < mids.length; k++) {
      if (Math.abs(r.y - mids[k]) < Math.abs(r.y - mids[best])) best = k;
    }
    if (Math.abs(r.y - mids[best]) > minSpacing / 2) return null;
    slots.push(2 * best + (r.y >= mids[best] ? 0 : 1));
  }
  return slots;
}

/** Fallback mapping: fit a slot lattice (step within pool, pitch between pools). */
function slotsFromLattice(page: PdfPageText, rows: DrawRow[], fieldSize: number): number[] {
  const perPool = fieldSize / 4;
  const ys = rows.map((r) => r.y);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const g = ys[i - 1] - ys[i];
    if (g > 1) gaps.push(g);
  }
  const minGap = gaps.length ? Math.min(...gaps) : 16;
  const step = median(gaps.filter((g) => g <= minGap * 1.3)) || minGap;

  const labels = page.items
    .map((it) => ({ m: collapse(it.str).match(POOL_LABEL_RE), y: it.y }))
    .filter((l): l is { m: RegExpMatchArray; y: number } => l.m !== null)
    .map((l) => ({ idx: l.m[1].toUpperCase().charCodeAt(0) - 65, y: l.y }))
    .sort((a, b) => a.idx - b.idx);
  let pitch = perPool * step;
  if (labels.length >= 2) {
    const first = labels[0];
    const last = labels[labels.length - 1];
    if (last.idx > first.idx) pitch = (first.y - last.y) / (last.idx - first.idx);
  }

  const assign = (top: number) => {
    let score = 0;
    const slots = rows.map((r) => {
      const d = top - r.y;
      const pool = Math.min(3, Math.max(0, Math.floor((d + step / 2) / pitch)));
      const j = Math.round((d - pool * pitch) / step);
      const residual = Math.abs(d - pool * pitch - j * step);
      if (j < 0 || j >= perPool || residual > step * 0.35) score += 1000;
      score += residual;
      return pool * perPool + Math.min(perPool - 1, Math.max(0, j));
    });
    if (new Set(slots).size !== slots.length) score += 1000;
    const filled = new Set(slots);
    for (let k = 0; k < fieldSize / 2; k++) {
      if (!filled.has(2 * k) && !filled.has(2 * k + 1)) score += 100;
      // Tie-breaker: IJF draws print a bye athlete in the upper slot of the pair.
      else if (!filled.has(2 * k)) score += 10;
    }
    return { slots, score };
  };

  // Each R1 pair holds at least one athlete, so the top row is slot 0 or slot 1.
  // When no pool's last slot is filled, both offsets fit the lattice; the bye tie-breaker decides.
  const yTop = Math.max(...ys);
  const a = assign(yTop);
  const b = assign(yTop + step);
  return b.score < a.score ? b.slots : a.slots;
}

function parsePage(page: PdfPageText): ParsedCategory | null {
  const warnings: string[] = [];
  const header = readHeader(page);
  const rows = readRows(page, header.cutoffY, warnings);
  if (!header.weight && rows.length === 0) return null;

  const weight = header.weight ?? 'Unknown';
  if (!header.weight) warnings.push('No weight label found in page header');
  const fieldSize = nextFieldSize(Math.max(header.declaredCount ?? 0, rows.length));
  const slots: (DrawAthlete | null)[] = new Array(fieldSize).fill(null);

  if (header.declaredCount !== null && header.declaredCount !== rows.length) {
    warnings.push(`Declared ${header.declaredCount} athletes but found ${rows.length}`);
  }

  if (rows.length > 0) {
    const positions =
      slotsFromFightNumbers(page, rows, fieldSize) ?? slotsFromLattice(page, rows, fieldSize);
    rows.forEach((r, i) => {
      const pos = positions[i];
      if (pos < 0 || pos >= fieldSize) {
        warnings.push(`Slot ${pos} out of range for ${r.name}`);
        return;
      }
      if (slots[pos]) {
        warnings.push(`Duplicate slot ${pos}: ${slots[pos]!.name} and ${r.name}`);
        return;
      }
      slots[pos] = { id: newAthleteId(), name: r.name, country: r.country };
    });

    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.name}|${r.country}`;
      if (seen.has(key)) warnings.push(`Duplicate athlete: ${r.name} (${r.country})`);
      seen.add(key);
    }
    if (rows.length > fieldSize / 2) {
      for (let k = 0; k < fieldSize / 2; k++) {
        if (!slots[2 * k] && !slots[2 * k + 1]) warnings.push(`R1 match ${k + 1} has no athletes`);
      }
    }
  }

  return {
    weight,
    gender: genderForWeight(weight),
    declaredCount: header.declaredCount,
    fieldSize,
    slots,
    pageNumber: page.pageNumber,
    warnings,
  };
}

/** Pure parser: one category per draw page; pages without weight label and names are skipped. */
export function parseDrawPages(pages: PdfPageText[]): ParsedCategory[] {
  const out: ParsedCategory[] = [];
  for (const page of pages) {
    const cat = parsePage(page);
    if (!cat) continue;
    const prev = out[out.length - 1];
    if (prev && prev.weight === cat.weight && cat.weight !== 'Unknown') {
      cat.warnings.push(
        `Same weight ${cat.weight} as page ${prev.pageNumber}; category may span multiple pages`
      );
    }
    out.push(cat);
  }
  return out;
}

/** R1 match i = slots[2i] vs slots[2i+1]; pools split the matches into 4 equal quarters. */
export function slotsToR1Matches(slots: (DrawAthlete | null)[]): R1Match[] {
  const matchCount = Math.floor(slots.length / 2);
  const perPool = Math.max(1, matchCount / 4);
  const pools = ['A', 'B', 'C', 'D'] as const;
  const out: R1Match[] = [];
  for (let i = 0; i < matchCount; i++) {
    out.push({
      matchIndex: i,
      pool: pools[Math.min(3, Math.floor(i / perPool))],
      competitor1: slots[2 * i] ?? null,
      competitor2: slots[2 * i + 1] ?? null,
    });
  }
  return out;
}

/** Browser: extract positioned text items for every page using pdfjs-dist (worker via Vite ?url). */
export async function extractPdfPageTexts(data: ArrayBuffer | Uint8Array): Promise<PdfPageText[]> {
  const pdfjs = await import('pdfjs-dist');
  // @ts-ignore Vite-specific "?url" import (resolved by the bundler, not by tsc)
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
  // pdfjs transfers the buffer to the worker; pass a copy so the caller's data stays usable.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const pages: PdfPageText[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          height: it.height,
          width: it.width,
        });
      }
      pages.push({ pageNumber: p, width: viewport.width, height: viewport.height, items });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export async function parseDrawPdf(data: ArrayBuffer | Uint8Array): Promise<ParsedCategory[]> {
  return parseDrawPages(await extractPdfPageTexts(data));
}
