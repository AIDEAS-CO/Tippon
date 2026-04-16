/** `user_picks.category` / `tournament_scores.category` for medal table predictions. */
/** Legacy key — now maps to Total. Kept for backward compatibility. */
export const MEDAL_TABLE_CATEGORY = '_medal_table_total_' as const;
export const MEDAL_TABLE_MEN = '_medal_table_men_' as const;
export const MEDAL_TABLE_WOMEN = '_medal_table_women_' as const;
export const MEDAL_TABLE_TOTAL = '_medal_table_total_' as const;
export const ALL_MEDAL_TABLE_CATEGORIES = [MEDAL_TABLE_MEN, MEDAL_TABLE_WOMEN, MEDAL_TABLE_TOTAL] as const;

export const BONUSES_CATEGORY = '_bonuses_' as const;
