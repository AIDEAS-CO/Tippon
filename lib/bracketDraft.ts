/**
 * Bracket draft model used by the admin bracket builder (pure, no I/O).
 *
 * A draft holds, per weight category, the first-round draw as a flat slot array
 * (index = draw position top→bottom, Pool A first; R1 fight k = slots[2k] vs slots[2k+1])
 * plus a tray of unassigned athletes. Drafts are autosaved (localStorage + tournaments.bracket_draft)
 * and published into `competition_brackets` rows via `draftToBracketRows`.
 */
import type { DrawAthlete } from './drawPdfParser';

export type { DrawAthlete };

export type DraftGender = 'Male' | 'Female' | 'Mixed' | null;
export type DraftSource = 'pdf' | 'ai' | 'manual';
export type Pool = 'A' | 'B' | 'C' | 'D';

export interface DraftCategory {
  weight: string;
  gender: DraftGender;
  fieldSize: number;
  slots: (DrawAthlete | null)[];
  unassigned: DrawAthlete[];
  warnings: string[];
  source: DraftSource;
  reviewed: boolean;
  /** Athlete count printed on the draw header, when known. */
  declaredCount?: number | null;
}

export interface BracketDraft {
  version: 1;
  updatedAt: string;
  categories: Record<string, DraftCategory>;
}

export interface BracketRow {
  tournament_id: number;
  weight_category: string;
  match_number: number;
  competitor_1: null;
  competitor_2: null;
  bracket_data: {
    competitor1: DrawAthlete | null;
    competitor2: DrawAthlete | null;
    pool: Pool;
    slot: number;
  };
}

export const FIELD_SIZES = [8, 16, 32, 64, 128] as const;
const POOLS: Pool[] = ['A', 'B', 'C', 'D'];

// ── Basics ───────────────────────────────────────────────────────────────────

export function newAthleteId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return `ath-${c.randomUUID()}`;
  return `ath-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Smallest supported field size (8..128) that fits `n` athletes. */
export function fieldSizeFor(n: number): number {
  return FIELD_SIZES.find((s) => s >= n) ?? 128;
}

/** "Men -60 kg" / "-60KG" / "men's -60" → "-60"; "Mixed Teams" → "teams". */
export function normalizeWeightKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^(women'?s?|men'?s?|female|male|mixed)/, '')
    .replace(/kg$/, '');
}

/** Configured category name matching a parsed weight label, or null. */
export function matchConfiguredCategory(parsedWeight: string, configured: string[]): string | null {
  const key = normalizeWeightKey(parsedWeight);
  if (!key) return null;
  return configured.find((c) => normalizeWeightKey(c) === key) ?? null;
}

export function emptyDraft(now = new Date().toISOString()): BracketDraft {
  return { version: 1, updatedAt: now, categories: {} };
}

export function emptyCategory(
  weight: string,
  gender: DraftGender,
  fieldSize: number,
  source: DraftSource = 'manual'
): DraftCategory {
  return {
    weight,
    gender,
    fieldSize,
    slots: new Array(fieldSize).fill(null),
    unassigned: [],
    warnings: [],
    source,
    reviewed: false,
  };
}

/** Draw position → R1 fight index and pool. */
export function slotInfo(slotIndex: number, fieldSize: number): { matchIndex: number; pool: Pool } {
  const matchIndex = Math.floor(slotIndex / 2);
  return { matchIndex, pool: poolOfMatch(matchIndex, fieldSize / 2) };
}

export function poolOfMatch(matchIndex: number, matchCount: number): Pool {
  const perPool = Math.max(1, matchCount / 4);
  return POOLS[Math.min(3, Math.floor(matchIndex / perPool))];
}

/** Converts R1 pairs (e.g. AI extraction output) to a slot array sized to the bracket. */
export function matchesToSlots(
  matches: { competitor1: { name: string; country: string } | null; competitor2: { name: string; country: string } | null }[]
): (DrawAthlete | null)[] {
  const fieldSize = fieldSizeFor(matches.length * 2);
  const slots: (DrawAthlete | null)[] = new Array(fieldSize).fill(null);
  const toAthlete = (c: { name: string; country: string } | null): DrawAthlete | null =>
    c && (c.name || '').trim()
      ? { id: newAthleteId(), name: c.name.trim(), country: (c.country || '').trim().toUpperCase() }
      : null;
  matches.forEach((m, i) => {
    if (2 * i + 1 >= fieldSize) return;
    slots[2 * i] = toAthlete(m.competitor1);
    slots[2 * i + 1] = toAthlete(m.competitor2);
  });
  return slots;
}

// ── Lookup ───────────────────────────────────────────────────────────────────

export type AthleteLocation =
  | { weight: string; kind: 'slot'; index: number }
  | { weight: string; kind: 'tray'; index: number };

export function findAthlete(
  draft: BracketDraft,
  athleteId: string
): { athlete: DrawAthlete; loc: AthleteLocation } | null {
  for (const [weight, cat] of Object.entries(draft.categories)) {
    const si = cat.slots.findIndex((a) => a?.id === athleteId);
    if (si >= 0) return { athlete: cat.slots[si]!, loc: { weight, kind: 'slot', index: si } };
    const ti = cat.unassigned.findIndex((a) => a.id === athleteId);
    if (ti >= 0) return { athlete: cat.unassigned[ti], loc: { weight, kind: 'tray', index: ti } };
  }
  return null;
}

function cloneCat(cat: DraftCategory): DraftCategory {
  return { ...cat, slots: [...cat.slots], unassigned: [...cat.unassigned], warnings: [...cat.warnings] };
}

/** Shallow-clones the draft and the named categories so they can be mutated locally. */
function editable(draft: BracketDraft, weights: string[]): BracketDraft {
  const categories = { ...draft.categories };
  for (const w of new Set(weights)) if (categories[w]) categories[w] = cloneCat(categories[w]);
  return { ...draft, categories };
}

function removeAt(draft: BracketDraft, loc: AthleteLocation): void {
  const cat = draft.categories[loc.weight];
  if (loc.kind === 'slot') cat.slots[loc.index] = null;
  else cat.unassigned.splice(loc.index, 1);
}

// ── Moves ────────────────────────────────────────────────────────────────────

/** Swaps two draw positions inside one category. */
export function swapSlots(cat: DraftCategory, a: number, b: number): DraftCategory {
  if (a === b || a < 0 || b < 0 || a >= cat.slots.length || b >= cat.slots.length) return cat;
  const next = cloneCat(cat);
  [next.slots[a], next.slots[b]] = [next.slots[b], next.slots[a]];
  return next;
}

/**
 * Moves an athlete (from any category's slot or tray) to a draw position.
 * If the target is occupied, the occupant takes the athlete's old place
 * (slot↔slot swap; from a tray the occupant goes to that tray).
 */
export function moveToSlot(draft: BracketDraft, athleteId: string, weight: string, slot: number): BracketDraft {
  const found = findAthlete(draft, athleteId);
  const target = draft.categories[weight];
  if (!found || !target || slot < 0 || slot >= target.slots.length) return draft;
  const { athlete, loc } = found;
  if (loc.kind === 'slot' && loc.weight === weight && loc.index === slot) return draft;

  const next = editable(draft, [weight, loc.weight]);
  const occupant = next.categories[weight].slots[slot];
  removeAt(next, loc);
  next.categories[weight].slots[slot] = athlete;
  if (occupant) {
    const src = next.categories[loc.weight];
    if (loc.kind === 'slot') src.slots[loc.index] = occupant;
    else src.unassigned.splice(loc.index, 0, occupant);
  }
  return next;
}

/** Moves an athlete to the unassigned tray of `weight` (default: its current category). */
export function moveToUnassigned(draft: BracketDraft, athleteId: string, weight?: string): BracketDraft {
  const found = findAthlete(draft, athleteId);
  if (!found) return draft;
  const to = weight ?? found.loc.weight;
  if (!draft.categories[to]) return draft;
  if (found.loc.kind === 'tray' && found.loc.weight === to) return draft;
  const next = editable(draft, [to, found.loc.weight]);
  removeAt(next, found.loc);
  next.categories[to].unassigned.push(found.athlete);
  return next;
}

/** Moves an athlete into another category (lands in that category's tray). */
export function moveBetweenCategories(draft: BracketDraft, athleteId: string, toWeight: string): BracketDraft {
  return moveToUnassigned(draft, athleteId, toWeight);
}

export function addAthlete(draft: BracketDraft, weight: string, athlete: Omit<DrawAthlete, 'id'> & { id?: string }): BracketDraft {
  if (!draft.categories[weight]) return draft;
  const next = editable(draft, [weight]);
  next.categories[weight].unassigned.push({
    id: athlete.id ?? newAthleteId(),
    name: athlete.name.trim(),
    country: athlete.country.trim().toUpperCase(),
  });
  return next;
}

export function updateAthlete(
  draft: BracketDraft,
  athleteId: string,
  patch: Partial<Pick<DrawAthlete, 'name' | 'country'>>
): BracketDraft {
  const found = findAthlete(draft, athleteId);
  if (!found) return draft;
  const next = editable(draft, [found.loc.weight]);
  const updated: DrawAthlete = {
    ...found.athlete,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.country !== undefined ? { country: patch.country.toUpperCase().slice(0, 3) } : {}),
  };
  const cat = next.categories[found.loc.weight];
  if (found.loc.kind === 'slot') cat.slots[found.loc.index] = updated;
  else cat.unassigned[found.loc.index] = updated;
  return next;
}

export function deleteAthlete(draft: BracketDraft, athleteId: string): BracketDraft {
  const found = findAthlete(draft, athleteId);
  if (!found) return draft;
  const next = editable(draft, [found.loc.weight]);
  removeAt(next, found.loc);
  return next;
}

export function updateCategory(draft: BracketDraft, weight: string, patch: Partial<DraftCategory>): BracketDraft {
  const cat = draft.categories[weight];
  if (!cat) return draft;
  return { ...draft, categories: { ...draft.categories, [weight]: { ...cat, ...patch } } };
}

/**
 * Changes the field size. Grow: each pool keeps its athletes in order and is padded with
 * empty slots at its end. Shrink: only when every dropped slot (end of each pool) is empty;
 * otherwise returns null.
 */
export function setFieldSize(cat: DraftCategory, newSize: number): DraftCategory | null {
  const oldSize = cat.slots.length;
  if (newSize === oldSize) return cat;
  if (newSize < 8 || newSize % 8 !== 0) return null;
  const oldPer = oldSize / 4;
  const newPer = newSize / 4;
  if (newSize < oldSize) {
    for (let p = 0; p < 4; p++) {
      for (let j = newPer; j < oldPer; j++) if (cat.slots[p * oldPer + j]) return null;
    }
  }
  const slots: (DrawAthlete | null)[] = new Array(newSize).fill(null);
  for (let p = 0; p < 4; p++) {
    for (let j = 0; j < Math.min(oldPer, newPer); j++) slots[p * newPer + j] = cat.slots[p * oldPer + j] ?? null;
  }
  return { ...cloneCat(cat), fieldSize: newSize, slots };
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface CategoryValidation {
  athleteCount: number;
  errors: string[];
  warnings: string[];
}

export function validateCategory(cat: DraftCategory): CategoryValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const placed = cat.slots.filter((a): a is DrawAthlete => !!a);
  const athleteCount = placed.length;

  if (cat.slots.length !== cat.fieldSize) errors.push(`Slot count ${cat.slots.length} does not match field size ${cat.fieldSize}`);
  if (athleteCount < 2) errors.push('At least 2 athletes are required');
  if (cat.declaredCount != null && cat.declaredCount !== athleteCount) {
    warnings.push(`Draw declares ${cat.declaredCount} athletes, bracket has ${athleteCount}`);
  }

  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const a of placed) {
    if (ids.has(a.id)) errors.push(`Duplicate athlete id: ${a.name}`);
    ids.add(a.id);
    const key = `${a.name.trim().toLowerCase()}|${a.country}`;
    if (keys.has(key)) warnings.push(`Duplicate athlete: ${a.name} (${a.country})`);
    keys.add(key);
    if (!a.name.trim()) warnings.push('An athlete has no name');
    if (!/^[A-Z]{3}$/.test(a.country)) warnings.push(`${a.name || 'Athlete'}: country "${a.country}" is not a 3-letter code`);
  }

  // With more athletes than fights, every R1 fight should hold at least one athlete.
  if (athleteCount > cat.fieldSize / 2) {
    for (let k = 0; k < cat.fieldSize / 2; k++) {
      if (!cat.slots[2 * k] && !cat.slots[2 * k + 1]) warnings.push(`Fight ${k + 1} has no athletes`);
    }
  }
  if (cat.unassigned.length > 0) warnings.push(`${cat.unassigned.length} unassigned athlete(s) will not be published`);

  return { athleteCount, errors, warnings };
}

// ── DB mapping ───────────────────────────────────────────────────────────────

const strip = (a: DrawAthlete | null): DrawAthlete | null =>
  a ? { id: a.id, name: a.name, country: a.country } : null;

/** competition_brackets rows (one per R1 fight) for a category. */
export function draftToBracketRows(tournamentId: number, weight: string, cat: DraftCategory): BracketRow[] {
  const matchCount = cat.fieldSize / 2;
  const rows: BracketRow[] = [];
  for (let i = 0; i < matchCount; i++) {
    rows.push({
      tournament_id: tournamentId,
      weight_category: weight,
      match_number: i + 1,
      competitor_1: null,
      competitor_2: null,
      bracket_data: {
        competitor1: strip(cat.slots[2 * i] ?? null),
        competitor2: strip(cat.slots[2 * i + 1] ?? null),
        pool: poolOfMatch(i, matchCount),
        slot: i,
      },
    });
  }
  return rows;
}

/**
 * Rebuilds a draft category from published competition_brackets rows (new and legacy shapes).
 * Ids mirror `buildMatchesForBracket` so existing picks keep matching:
 * bracket_data id → roster FK id (competitor_1/2) → `pdf-${row.id}-competitorN`.
 */
export function rowsToDraftCategory(
  rows: any[],
  weight: string,
  gender: DraftGender = null,
  rosterMap: Record<string, { name: string; country: string }> = {}
): DraftCategory {
  const sorted = [...rows].sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0));
  const hasNumbers = sorted.some((r) => r.match_number != null);
  const maxNumber = hasNumbers ? Math.max(...sorted.map((r) => r.match_number ?? 0)) : 0;
  const matchCount = Math.max(sorted.length, maxNumber, 1);
  const fieldSize = fieldSizeFor(matchCount * 2);
  const cat = emptyCategory(weight, gender, fieldSize, 'pdf');
  cat.reviewed = true;

  const resolve = (row: any, slot: 'competitor1' | 'competitor2', fk: string): DrawAthlete | null => {
    const fkId = row[fk];
    const entry = row.bracket_data?.[slot];
    if (fkId && rosterMap[fkId]) {
      return { id: String(fkId), name: rosterMap[fkId].name, country: rosterMap[fkId].country || 'N/A' };
    }
    if (entry && (entry.name || entry.id)) {
      return {
        id: entry.id ? String(entry.id) : `pdf-${row.id}-${slot}`,
        name: entry.name || String(entry.id),
        country: entry.country || 'N/A',
      };
    }
    return null;
  };

  sorted.forEach((row, i) => {
    const mi = hasNumbers ? (row.match_number ?? 0) - 1 : i;
    if (mi < 0 || 2 * mi + 1 >= fieldSize) return;
    if (cat.slots[2 * mi] || cat.slots[2 * mi + 1]) {
      cat.warnings.push(`Duplicate rows for fight ${mi + 1}; kept the first`);
      return;
    }
    cat.slots[2 * mi] = resolve(row, 'competitor1', 'competitor_1');
    cat.slots[2 * mi + 1] = resolve(row, 'competitor2', 'competitor_2');
  });
  return cat;
}

/** The draft with the later `updatedAt` (either may be null). */
export function newerDraft(a: BracketDraft | null | undefined, b: BracketDraft | null | undefined): BracketDraft | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const ta = Date.parse(a.updatedAt) || 0;
  const tb = Date.parse(b.updatedAt) || 0;
  return tb > ta ? b : a;
}

/** Light structural check for drafts read from storage. */
export function isBracketDraft(x: unknown): x is BracketDraft {
  const d = x as BracketDraft;
  return !!d && d.version === 1 && typeof d.updatedAt === 'string' && !!d.categories && typeof d.categories === 'object';
}
