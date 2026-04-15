/**
 * Normalize a weight/category label for matching Excel ↔ DB tournament categories.
 * Aligns with bracket roster matching (strip Men/Women, spaces, case).
 */
export function normalizeWeightCategoryLabel(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^(men'?s?|women'?s?|male|female)/i, '');
}

/** Map normalized key → canonical DB category name (as stored in `categories.name`). */
export function buildCategoryLookup(
  dbCategories: { name: string; gender: 'Male' | 'Female' }[]
): { male: Map<string, string>; female: Map<string, string> } {
  const male = new Map<string, string>();
  const female = new Map<string, string>();
  for (const c of dbCategories) {
    const key = normalizeWeightCategoryLabel(c.name);
    if (c.gender === 'Male') male.set(key, c.name);
    else female.set(key, c.name);
  }
  return { male, female };
}

/**
 * Resolve Excel category text to the canonical `categories.name` for insert, or null.
 */
export function resolveCanonicalWeightCategory(
  categoryRaw: string,
  sex: 'Male' | 'Female',
  lookup: { male: Map<string, string>; female: Map<string, string> }
): string | null {
  const raw = String(categoryRaw || '').trim();
  if (!raw) return null;

  let token = raw.split(/[\s,;/]+/).find((t) => /\d/.test(t) || t.toLowerCase().includes('kg')) || raw.split(' ')[0];
  token = token.trim();
  if (token && !token.toLowerCase().endsWith('kg')) {
    if (/^[\-+]?[\d]/.test(token) || token.includes('+')) token = `${token.replace(/\s/g, '')}kg`;
  }

  const norm = normalizeWeightCategoryLabel(token);
  const table = sex === 'Male' ? lookup.male : lookup.female;

  if (table.has(norm)) return table.get(norm)!;

  for (const [k, canonical] of table) {
    if (k === norm || k.includes(norm) || norm.includes(k)) return canonical;
  }
  return null;
}
