# CONFIG_PROTOCOL_README — Tippon

## Project Overview

**Tippon** is a Judo tournament prediction app (fantasy-sports style). Admins create tournaments, upload rosters and draw PDFs (from IJF), and the system builds visual brackets. Players then predict match winners to earn points and compete on a leaderboard.

### Documentation pairing (required)

When you document or implement changes to **architecture, routing, user flows, database schema, migrations, or scoring behavior**, update **both** of these files:

| File | Role |
|------|------|
| **`CONFIG_PROTOCOL_README.md`** (this file) | Canonical detail: full schema, migration history, extended flows |
| **`CLAUDE.md`** | Shorter agent-oriented overview; must stay aligned at headline level |

Agents and humans should treat the pair as a single documentation surface. Updating only one file is considered incomplete.

**Cursor:** `.cursor/rules/documentation-pairing.mdc` applies this convention in every chat (`alwaysApply: true`).

### Language

All user-facing copy, developer comments in source files, and in-repo technical docs for this project are **English** unless a dedicated i18n layer is added. **Disclaimer:** do not introduce Spanish or other languages in the codebase or UI by default. This is enforced for agents via `.cursor/rules/english-only.mdc` (`alwaysApply: true`).

### Tech Stack

| Layer       | Technology                                      |
| ----------- | ----------------------------------------------- |
| Frontend    | React 19 + TypeScript + Vite 6                  |
| Styling     | Tailwind CSS (CDN in dev, PostCSS for prod)     |
| Backend/DB  | Supabase (Auth, PostgreSQL, Storage)             |
| AI          | Google Gemini API (`@google/genai` SDK v1.48+)   |
| Icons       | Lucide React                                     |
| PDF parsing | pdfjs-dist — local draw-PDF parser (`lib/drawPdfParser.ts`); Gemini only for results PDFs and scanned draws |
| Drag & drop | @dnd-kit/core (bracket builder pool grid)       |
| Excel       | xlsx (SheetJS) for optional roster imports       |
| Tests       | vitest (`npm test`), `npm run typecheck` (`tsc --noEmit`) |
| Deployment  | Vercel                                           |

**Commands:** `npm run dev` (port 3000), `npm run build`, `npm run preview`, `npm test` (vitest run, `tests/*.test.ts`), `npm run typecheck` (2 known errors in `lib/supabaseClient.ts`: `import.meta.env` typing).

### Key Flows

1. **Admin creates tournament** → `AdminDashboard` wizard: `CREATE_TOURNAMENT` (name, start + optional **End Date** → `tournaments.end_date`, categories with **Day** per category → `categories.day`, **Mixed Teams** checkbox → category `Teams` with gender `Mixed`) → `SCORING_RULES` → **Save & Build Brackets** → `BUILD_BRACKET`
2. **Roster upload is optional** (Excel `.xlsx` / `.xls` or `.csv`) → `MANAGE_ROSTER` / `TournamentRoster` → reads **all worksheets** with `defval`, normalizes weight labels → `tournament_roster`. Brackets no longer need a roster: athletes live in `competition_brackets.bracket_data`.
3. **Admin builds brackets** → `BuildBracket` (see **Bracket builder** below) → publishes to `competition_brackets`, status → `upcoming`
4. **Player views bracket** → `TournamentBracket` → picks winners → `handleSavePicks` upserts `user_picks` (DB first; localStorage cache only after success). Rejected by RLS when picks are locked.
5. **Leaderboard** → `Leaderboard` → rankings aggregated live from `tournament_scores` (Total + per-day tabs)
6. **Medal table picks** → `MedalTablePicks` (`ViewState`: `MEDAL_TABLE_PICKS`) → user ranks countries in 3 tabs (Men / Women / Total); saved in `user_picks` with `category` = `_medal_table_men_` / `_medal_table_women_` / `_medal_table_total_` and `picks_data` keys `"1"`…`"3"` → IOC country codes (legacy `_medal_table_` rows are read as Total)

### Bracket builder (`BuildBracket.tsx`, v2)

- **Import:** `DrawImportPanel` accepts one or more draw PDFs. `lib/drawPdfParser.ts` parses the pdfjs text layer deterministically (one category per page: header weight + declared count, IOC-code rows → draw positions via R1 fight numbers, lattice fallback). Pages without a text layer fall back to Gemini (`components/bracketBuilder/aiDrawExtraction.ts`, model `gemini-2.5-flash`), marked `source: 'ai'` for review. Parsed weights are matched to configured `categories.name` with `normalizeWeightKey` (strips gender prefix, spaces, `kg`); unmatched categories can be added (inserted into `categories`) or ignored.
- **Draft model** (`lib/bracketDraft.ts`, pure): `BracketDraft { version: 1, updatedAt, categories: Record<name, DraftCategory> }`; `DraftCategory { weight, gender, fieldSize (8–128), slots[], unassigned[], warnings, source, reviewed, declaredCount }`. Slot index = draw position (Pool A first); R1 fight k = `slots[2k]` vs `slots[2k+1]`. Athletes `{ id: 'ath-<uuid>', name, country }`. Helpers: `moveToSlot`, `moveToUnassigned`, `swapSlots`, `setFieldSize`, `validateCategory`, `draftToBracketRows`, `rowsToDraftCategory` (rebuild from published rows, ids mirror `buildMatchesForBracket`).
- **Editor:** `BracketEditor` + `PoolGrid` (4 pools, drag & drop with @dnd-kit/core) + `UnassignedTray`; manual mode creates empty brackets of a chosen field size.
- **Autosave** (`useDraftAutosave`): every change → localStorage `tippon-bracket-draft-${tournamentId}` immediately and `tournaments.bracket_draft` / `bracket_draft_updated_at` debounced; on load the newer `updatedAt` wins; degrades to device-only if the columns are missing. Without a draft, published rows are loaded for editing.
- **Publish:** blocks on validation errors, confirms warnings / unreviewed categories / existing picks, then per category maps `draftToBracketRows` onto existing `competition_brackets` rows by `match_number` → `upsert` with the **existing row id** (so `user_picks`, `match_results` and golden match ids stay valid), `insert` for new fights, `delete` for surplus fights and categories removed from the draft. Sets status `upcoming` (if draft) and clears the draft.

### Player bracket (`TournamentBracket.tsx`, v2)

- **Ids:** competitors use `bracket_data.competitorN.id` (fallback roster FK, then `pdf-${row.id}-competitorN`); R1 match id = `competition_brackets.id`; later rounds `r{level}-m{i}` (same in `buildMatchesForBracket` for picks, results, scoring, `UserPicksViewer`).
- **Byes:** R1 fight with exactly one athlete (either side) auto-advances.
- **Locks:** read-only if COMPLETED, category `locked`/`closed`, or `tournaments.picks_locked`; realtime channel on `categories` + `tournaments` refreshes lock state and golden matches.
- **Mobile:** < 768px → `MobileBracketTabs` (round tabs with per-tab progress + Extra pick tab); otherwise zoomable tree (`BracketZoom`, pinch / buttons, zoom stored in localStorage). Sticky bottom bar (progress + Save) inside the App scroll container (`.app-shell` uses `100dvh`; safe-area padding).

### Frontend views (`ViewState` in `types.ts`)

Includes: `MEDAL_TABLE_PICKS` — opened from the bracket header while the tournament is `DRAFT` or `UPCOMING`. Uses the same `handleSavePicks` path as weight categories.

- `TOURNAMENT_FINAL_RESULTS` — after `COMPLETED`: tabs for standings per weight category and **country medal table**; total points; per-user `tournament_scores` breakdown (weight categories, `_medal_table_`, `_bonuses_`). Entry: **Final results** on tournament cards or bracket header.

**Placement scoring:** deviation for gold/silver/bronze picks is the **rank-step distance** over placements 1→2→3→5→7 (`rankStepDistance` in `lib/scoringEngine.ts`; e.g. predicted 1st, actual 5th = 3 steps → `gold_silver_dev3`; missing actual = no points). Golden matches add `points` when the pick equals the actual winner (`breakdown.goldenLines`). Full point table in `SCORING.md`.

**Finalize / batch scoring order** (`calculateAllCategoryScores` in `lib/scoringEngine.ts`): (1) each weight category → `calculateScores`, (2) **`calculateMedalTableScores`** → rows `_medal_table_men_` / `_medal_table_women_` / `_medal_table_total_`, (3) **`'_bonuses_'`** from `calculateBonusesDetailed` (weight-category results only).

**`tournament_scores.breakdown` for `category = '_bonuses_'`:** JSON with `bonusLines` (array of `{ key, label, points, earned, detail, progressRatio?, progressLabel? }`) and `categoryTotal`, produced by `calculateBonusesDetailed`.

**`tournament_scores.breakdown` for `category` = `_medal_table_men_` / `_women_` / `_total_`:** JSON `MedalTableScoreBreakdown`: `{ lines: [{ slot, country, predictedRank, actualRank, deviation, points }], categoryTotal, maxPossible }`, produced by `calculateMedalTableScores`.

### Tournament results UI (`TournamentResults.tsx`)

- **Final standings**: After the bracket (same scroll area), when the final has a winner and every bronze match (if any) has a winner, shows positions derived via `deriveStandings(matches, results)`.
- **Country medal summary**: Collapsible table aggregates gold/silver/bronze counts by country across all weight categories (saved `match_results` only).
- **Global lock**: header buttons **Lock all picks** / **Unlock all picks** (confirm dialog; badge shows state). Lock → `tournaments.picks_locked = true`, `status = 'live'`, `medal_table_status = 'locked'` (only if open/null), every `categories.status = 'open'` → `'locked'` (`handleLockAllPicks` in `App.tsx`). Unlock → `picks_locked = false` only; categories keep their status and must be reopened individually.
- **Per-category lock** (`handleCategoryLock`): matches `categories.name` by normalized weight (`weightsMatch`), uses `.select()` to verify a row was updated, error toast otherwise. Category dropdown shows lock icons for `locked` (amber) and `closed` (grey).
- **Competition days panel** (collapsible): Day 1..N select per category → `categories.day` (`handleSetCategoryDay`). N = max(4, inclusive days from `start_date` to `end_date`).
- **Golden matches**: admin toggles in `TournamentBracket` call `handleToggleGolden(category, matchId, points|null)` in `App.tsx` → add/replace/remove in `tournaments.golden_matches`. Scoring calls pass `tournament.goldenMatches`.
- **Pick saves rejected by RLS** (`42501` / "row-level security") → toast "Picks are locked for this category"; `handleSavePicks` resolves `false`.

### Leaderboard breakdown (`Leaderboard.tsx`)

- **New**: `tournament_scores.breakdown` as `ScoringBreakdown` (gold/silver, bronze, pool finals, additional pick, category total) — see `types.ts`.
- **Legacy**: Older rows with per-match `breakdown` maps grouped by round still render as before.
- **Day tabs** (tournament view): `Total | Day 1 | Day 2 | …` from `buildDayRankings(tournament_scores rows, categories(name, day))` (`lib/rankings.ts`); default tab = latest day with scores. Ties share rank (1, 1, 3) in both tournament and global views.
- **Reveal**: reveals rows from last place up to 1st (one every 400 ms), with Skip.
- **Live refresh**: refetches on window focus and on realtime `tournament_scores` changes (filtered by `tournament_id` in tournament view).
- **User modal**: tabs **Breakdown** (incl. ★ golden match lines; deviation shown as rank steps over 1→2→3→5→7, e.g. "2 steps off") and **Picks** (`components/UserPicksViewer.tsx`: read-only picks per round, additional pick, medal table picks; categories RLS hides show "Hidden until picks are locked"). Same Picks tab in `TournamentFinalResults`.
- **Home / Profile**: Global rank computed from all `tournament_scores` (`aggregateRanking`); standing card for the current LIVE (else most recent COMPLETED) tournament the user scored in: Total `#x of N` + latest Day rank.
- **Mixed categories**: Men/Women medal tables only count exact `Male`/`Female` category gender (`lookupByWeight` tolerates bracket-vs-category label differences); `Mixed`/unknown count in Total only.

---

## Database Schema

### `tournaments`
Main tournament entity.

| Column                 | Type        | Notes                                           |
| ---------------------- | ----------- | ----------------------------------------------- |
| `id`                   | bigint (PK) | Auto-generated identity                         |
| `name`                 | text        | Tournament name                                 |
| `start_date`           | timestamptz | Start date                                      |
| `status`               | text        | `draft`, `upcoming`, `live`, `completed`         |
| `location`             | text        | City/Country                                     |
| `scoring_rules`        | jsonb       | Default: `{"win": 10, "ippon": 5}`              |
| `scoring_configuration`| jsonb       | Extended scoring config                          |
| `brackets`             | jsonb       | Legacy: stored bracket data (deprecated)         |
| `roster`               | jsonb       | Legacy: stored roster data (deprecated)          |
| `medal_table_status`   | text        | `open` (default), `locked`, `closed` — medal table picks lock (Migration 008) |
| `picks_locked`         | boolean     | Default `false`. Global lock: when `true`, no picks can be written for any category (Migration 009) |
| `bracket_draft`        | jsonb       | Draw-parser draft autosave (unpublished bracket work in `BuildBracket`) (Migration 009) |
| `bracket_draft_updated_at` | timestamptz | Last autosave time of `bracket_draft` (Migration 009) |
| `golden_matches`       | jsonb       | Default `[]`. `[{ category, matchId, points }]` — bonus points for correctly picking these matches; scored into that category's `tournament_scores.breakdown.goldenLines` (Migration 009) |
| `end_date`             | date        | Last competition day, nullable (Migration 009)   |
| `created_at`           | timestamptz | Auto-generated                                   |

### `categories`
Weight categories per tournament.

| Column          | Type        | Notes                            |
| --------------- | ----------- | -------------------------------- |
| `id`            | bigint (PK) | Auto-generated identity          |
| `tournament_id` | bigint (FK) | → `tournaments.id`              |
| `name`          | text        | e.g., `-73kg`, `-90kg`          |
| `gender`        | text        | `Male`, `Female`, or `Mixed` (mixed team events, Migration 009) |
| `status`        | text        | `open` (default), `locked`, `closed` (Migration 007/008). Enforced server-side for picks by `picks_open()` (Migration 009) |
| `day`           | smallint    | Competition day (1, 2, …), nullable — used for day ranking (Migration 009) |
| `created_at`    | timestamptz | Auto-generated                   |

### `tournament_roster`
Athletes registered for a specific tournament. Used as the source of truth for competitor info.

| Column           | Type        | Notes                                   |
| ---------------- | ----------- | --------------------------------------- |
| `id`             | uuid (PK)   | Auto-generated                          |
| `tournament_id`  | bigint (FK) | → `tournaments.id`                     |
| `first_name`     | text        | Athlete first name                      |
| `last_name`      | text        | Athlete last name                       |
| `country`        | text        | 3-letter country code (e.g., `GEO`)    |
| `gender`         | text        | `Male` or `Female`                      |
| `weight_category`| text        | e.g., `Men -90kg` or `-90kg`           |
| `world_rank`     | integer     | IJF world ranking                       |
| `created_at`     | timestamptz | Auto-generated                          |

### `competition_brackets`
Stores first-round matches extracted from PDF draws. Competitors reference `tournament_roster.id`.

| Column          | Type        | Notes                                          |
| --------------- | ----------- | ---------------------------------------------- |
| `id`            | uuid (PK)   | Auto-generated                                 |
| `tournament_id` | bigint (FK) | → `tournaments.id` (ON DELETE CASCADE, Migration 006) |
| `weight_category` | text      | Category name (Migration 001)                  |
| `match_number`  | bigint      | Sequential match number                        |
| `competitor_1`  | uuid (FK)   | → `tournament_roster.id` (nullable)            |
| `competitor_2`  | uuid (FK)   | → `tournament_roster.id` (nullable)            |
| `bracket_data`  | jsonb       | First-round slot data — see shape below        |
| `created_at`    | timestamptz | Auto-generated                                 |
| `updated_at`    | timestamptz | Auto-generated                                 |

**Unique:** `(tournament_id, weight_category, match_number)` — constraint `competition_brackets_tournament_category_match_key` (Migration 009; used by the draw-parser publish upsert).

**`bracket_data` shape (current):**

```
{
  competitor1: { id: <draft athlete id 'ath-<uuid>' or tournament_roster uuid>, name, country } | null,
  competitor2: { id, name, country } | null,
  pool: 'A' | 'B' | 'C' | 'D',
  slot: number
}
```

Legacy rows with `competitor1` / `competitor2` as `{ name, country }` (no `id`) are still supported by the readers.

### `tournament_matches`
Alternative match storage with richer schema. **Currently unused by the frontend** but has the ideal structure.

| Column           | Type        | Notes                                   |
| ---------------- | ----------- | --------------------------------------- |
| `id`             | uuid (PK)   | Auto-generated                          |
| `tournament_id`  | bigint (FK) | → `tournaments.id`                     |
| `weight_category`| text        | Category name                           |
| `pool`           | text        | Pool letter (A, B, C, D)               |
| `round`          | text        | Round identifier                        |
| `match_number`   | integer     | Sequential number                       |
| `athlete1_id`    | uuid (FK)   | → `tournament_roster.id`              |
| `athlete2_id`    | uuid (FK)   | → `tournament_roster.id`              |
| `winner_id`      | uuid (FK)   | → `tournament_roster.id`              |
| `next_match_id`  | uuid (FK)   | Self-referencing for bracket tree       |
| `is_completed`   | boolean     | Default: `false`                        |
| `created_at`     | timestamptz | Auto-generated                          |

### `profiles`
User profiles linked to Supabase Auth.

| Column          | Type             | Notes                              |
| --------------- | ---------------- | ---------------------------------- |
| `id`            | uuid (PK)        | Same as `auth.users.id`           |
| `email`         | text             |                                    |
| `username`      | text (unique)    | Display name                       |
| `full_name`     | text             |                                    |
| `avatar_url`    | text             |                                    |
| `role`          | user_role (enum) | `player` or `admin`                |
| `points`        | integer          | Total prediction points            |
| `total_points`  | integer          | Aggregate points                   |
| `daily_accuracy`| double precision | Daily prediction accuracy          |
| `accuracy`      | double precision | Overall accuracy                   |
| `previous_rank` | integer          | Last known rank                    |
| `nickname`      | text             | Legacy field                       |
| `created_at`    | timestamptz      |                                    |
| `updated_at`    | timestamptz      |                                    |

### `predictions`
User match predictions.

| Column               | Type        | Notes                         |
| -------------------- | ----------- | ----------------------------- |
| `id`                 | bigint (PK) | Auto-generated identity       |
| `user_id`            | uuid (FK)   | → `profiles.id`             |
| `match_id`           | bigint (FK) | → `matches.id`               |
| `predicted_winner_id`| bigint (FK) | → `judokas.id`               |
| `points_earned`      | integer     | Points awarded after result   |
| `created_at`         | timestamptz |                               |

### `actual_results`
Official match results for scoring.

| Column          | Type        | Notes                            |
| --------------- | ----------- | -------------------------------- |
| `id`            | uuid (PK)   |                                  |
| `tournament_id` | uuid        |                                  |
| `match_id`      | uuid (FK)   | → `competition_brackets.id`     |
| `actual_winner` | uuid (FK)   | → `participants.id`             |
| `created_at`    | timestamptz |                                  |
| `updated_at`    | timestamptz |                                  |

### Other Tables

| Table                      | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `judokas`                  | Global judoka registry (name, country, gender)        |
| `matches`                  | Legacy match table linked to `categories`/`judokas`  |
| `competitors`              | Standalone competitor entries with bracket positions  |
| `participants`             | Tournament participants (alternative to roster)       |
| `tournament_participants`  | Junction: tournament ↔ judoka ↔ category             |
| `player_rankings`          | Per-tournament user rankings                          |
| `users`                    | Extended user data linked to `auth.users`            |

### `user_picks`
Stores each user's bracket predictions per tournament/category.

| Column                 | Type        | Notes                                    |
| ---------------------- | ----------- | ---------------------------------------- |
| `id`                   | uuid (PK)   | Auto-generated                           |
| `user_id`              | uuid (FK)   | → `auth.users.id`                       |
| `tournament_id`        | bigint (FK) | → `tournaments.id`                      |
| `category`             | text        | Weight category name, or medal table key `_medal_table_men_` / `_medal_table_women_` / `_medal_table_total_` |
| `picks_data`           | jsonb       | Weight category: `{ matchId: competitorId }` map. Medal table: `{ "1": IOC, "2": IOC, "3": IOC }` |
| `completion_percentage`| integer     | 0–100                                    |
| `created_at`           | timestamptz | Auto-generated                           |
| `updated_at`           | timestamptz | Auto-generated                           |

**Unique:** `(user_id, tournament_id, category)`

**RLS (Migration 009):**

| Command | Policy | Rule |
|---------|--------|------|
| SELECT | `Read own, locked, or admin picks` | `auth.uid() = user_id OR picks_visible(tournament_id, category) OR is_admin()` — other users' picks become visible only once that category (or medal table, or whole tournament) is locked/closed; admins read all (batch scoring runs in the admin browser session) |
| INSERT | `Insert own picks while open` | `WITH CHECK (auth.uid() = user_id AND picks_open(tournament_id, category))` |
| UPDATE | `Update own picks while open` | Same expression in `USING` and `WITH CHECK` |
| DELETE | unchanged | Users delete their own rows |

Helper functions (`SECURITY DEFINER`, `STABLE`, `search_path = public`):

- `is_admin()` — `profiles.role` (enum, compared as upper-case text) = `ADMIN` for `auth.uid()`.
- `picks_open(t_id bigint, cat text)` — `false` if `tournaments.picks_locked` (or tournament not found); medal table keys (`_medal_table_%`) → `medal_table_status` is NULL or `open`; `_bonuses_` → `false`; weight category → no matching `categories` row has a status other than `open` (names normalized like `weightsMatch` in `lib/rankings.ts`: lower-case, whitespace removed, leading gender prefix `men`/`men's`/`women`/`women's`/`male`/`female` removed, trailing `kg` removed, so `Men -60kg` = `-60 kg` = `-60kg` = `-60`); no matching row → `true`.
- `picks_visible(t_id bigint, cat text)` — `NOT picks_open(t_id, cat)` (medal table: `medal_table_status` in `locked`/`closed`).

### `match_results`
Official match results entered by admin after tournament completes.

| Column                  | Type        | Notes                                   |
| ----------------------- | ----------- | --------------------------------------- |
| `id`                    | uuid (PK)   | Auto-generated                          |
| `tournament_id`         | bigint (FK) | → `tournaments.id`                     |
| `category`              | text        | Weight category name                    |
| `match_id`              | text        | Frontend match ID (e.g., bracket UUID)  |
| `round`                 | text        | R1, R2, QF, SF, F                       |
| `winner_competitor_id`  | text        | Competitor ID of the winner             |
| `winner_name`           | text        | Display name (optional)                 |
| `entered_by`            | uuid (FK)   | → `auth.users.id`                      |
| `created_at`            | timestamptz | Auto-generated                          |

**Unique:** `(tournament_id, category, match_id)`

### `tournament_scores`
Calculated scores per user/tournament/category (written by scoring engine).

| Column          | Type        | Notes                                   |
| --------------- | ----------- | --------------------------------------- |
| `id`            | uuid (PK)   | Auto-generated                          |
| `user_id`       | uuid (FK)   | → `auth.users.id`                      |
| `tournament_id` | bigint (FK) | → `tournaments.id`                     |
| `category`      | text        | Weight class label **or** synthetic `'_medal_table_men_'` / `'_medal_table_women_'` / `'_medal_table_total_'` / `'_bonuses_'` |
| `total_points`  | integer     | Sum of points earned                    |
| `correct_picks` | integer     | Contextual (e.g. slots with points for medal table) |
| `total_picks`   | integer     | Contextual                              |
| `breakdown`     | jsonb       | `ScoringBreakdown` (weight categories; includes `goldenLines` for golden-match points), `MedalTableScoreBreakdown`, or `TournamentBonusBreakdown` |
| `created_at`    | timestamptz | Auto-generated                          |

**Unique:** `(user_id, tournament_id, category)`

---

## Migrations

### Migration 001
**Add `weight_category` to `competition_brackets`**

Required so brackets can be filtered by weight category in the UI, even when competitors are not yet assigned.

```sql
ALTER TABLE public.competition_brackets
ADD COLUMN weight_category text;
```

After running this migration, update `BuildBracket.tsx` to include `weight_category` in the insert payload.

### Migration 002
**Create `user_picks` table**

```sql
CREATE TABLE IF NOT EXISTS public.user_picks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  tournament_id bigint references tournaments not null,
  category text not null,
  picks_data jsonb not null,
  completion_percentage integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  UNIQUE(user_id, tournament_id, category)
);
ALTER TABLE public.user_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own picks" ON user_picks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own picks" ON user_picks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own picks" ON user_picks FOR UPDATE USING (auth.uid() = user_id);
```

### Migration 003
**Create `match_results` table**

```sql
CREATE TABLE IF NOT EXISTS public.match_results (
  id uuid default gen_random_uuid() primary key,
  tournament_id bigint references tournaments not null,
  category text not null,
  match_id text not null,
  round text not null,
  winner_competitor_id text not null,
  winner_name text,
  entered_by uuid references auth.users,
  created_at timestamptz default now(),
  UNIQUE(tournament_id, category, match_id)
);
```

### Migration 004
**Create `tournament_scores` table**

```sql
CREATE TABLE IF NOT EXISTS public.tournament_scores (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  tournament_id bigint references tournaments not null,
  category text not null,
  total_points integer default 0,
  correct_picks integer default 0,
  total_picks integer default 0,
  breakdown jsonb,
  created_at timestamptz default now(),
  UNIQUE(user_id, tournament_id, category)
);
```

### Migration 005 — REQUIRED for leaderboard to work correctly
**Fix RLS policies so all authenticated users appear in the leaderboard.**

The default `user_picks` policy only lets users read their OWN rows. This means when
the admin runs **Finalize & Close** (batch scoring), the scoring engine can only
see the admin's picks → only the admin's score is stored → only the admin shows in the
leaderboard. The `tournament_scores` table also needs to be readable by all users so
the leaderboard can display everyone.

**Run this once in Supabase Dashboard → SQL Editor:**

```sql
-- Allow every authenticated user to read all picks
-- (needed so the scoring engine can calculate scores for all participants)
CREATE POLICY "Authenticated users can read all picks"
  ON public.user_picks
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow every authenticated user to read all scores
-- (needed so the leaderboard can display all participants)
CREATE POLICY "Authenticated users can read all scores"
  ON public.tournament_scores
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to write their own score rows (self-calculated fallback)
CREATE POLICY "Users insert own scores"
  ON public.tournament_scores
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own scores"
  ON public.tournament_scores
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Cascade-delete scores when a tournament is deleted
-- (so global leaderboard reflects 0 pts after tournament deletion)
ALTER TABLE public.tournament_scores
  DROP CONSTRAINT IF EXISTS tournament_scores_tournament_id_fkey,
  ADD CONSTRAINT tournament_scores_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
```

### Migration 009 — REQUIRED for v2 (draft autosave, global lock, golden matches, day ranking, Mixed teams, server-enforced pick lock)

**File:** `migrations/009_v2.sql` — idempotent (safe to re-run), wrapped in a single transaction. Run it in Supabase Dashboard → SQL Editor.

**Changes and why:**

| # | Change | Why |
|---|--------|-----|
| 1 | `categories.day smallint`; `gender` accepts `Mixed` (any existing gender CHECK is dropped and recreated as `Male`/`Female`/`Mixed`, `NOT VALID`) | Day ranking (points per competition day); mixed team events |
| 2 | `tournaments.picks_locked boolean NOT NULL DEFAULT false` | Global lock: admin freezes all picks at once |
| 2 | `tournaments.bracket_draft jsonb`, `bracket_draft_updated_at timestamptz` | Draw-parser draft autosave — unpublished bracket work survives reloads |
| 2 | `tournaments.golden_matches jsonb NOT NULL DEFAULT '[]'` | Golden matches `[{ category, matchId, points }]`, scored into that category's `tournament_scores.breakdown.goldenLines` |
| 2 | `tournaments.end_date date` | Multi-day events |
| 3 | Unique `competition_brackets (tournament_id, weight_category, match_number)` | Draw-parser publish upserts by match. Duplicate rows on that key are deleted first (lowest `id` kept; legacy `actual_results.match_id` references re-pointed to the kept row) |
| 3 | Ensures unique `user_picks (user_id, tournament_id, category)`, `match_results (tournament_id, category, match_id)`, `tournament_scores (user_id, tournament_id, category)` | App upserts (`onConflict`) rely on them; added only if missing (WARNING and skip if duplicates block it) |
| 4 | Functions `is_admin()`, `picks_open(bigint, text)`, `picks_visible(bigint, text)` | Shared logic for RLS (see `user_picks` above) |
| 5 | `user_picks` RLS replaced | **Server-enforced pick lock** (writes rejected once a category / medal table / whole tournament is locked) and **pick visibility after lock** (other players' picks readable only after lock; admin reads all) |
| 6 | `categories`, `tournaments`, `tournament_scores` added to the `supabase_realtime` publication | Live updates of lock status, tournament state, and scores |

**Policies dropped:** `"Users see own picks"`, `"Authenticated users can read all picks"`, `"authenticated_read_user_picks"`, `"Users insert own picks"`, `"Users update own picks"`. The DELETE policy is unchanged. The script raises a WARNING for any other remaining SELECT/INSERT/UPDATE/ALL policy on `user_picks` (permissive policies are OR-ed and would bypass the lock) — drop those manually.

---

### Migration 008 — REQUIRED for per-category lock/reopen + medal table status + 3-way medal picks

**Changes:**
1. `medal_table_status` column on `tournaments` — controls whether medal table picks are locked.
2. Rename existing `_medal_table_` pick/score rows to `_medal_table_total_` (backward compat).

**Run this in Supabase Dashboard → SQL Editor:**

```sql
-- 1. Medal table status per tournament
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS medal_table_status TEXT NOT NULL DEFAULT 'open';

-- 2. Rename legacy medal table picks to new Total key
UPDATE public.user_picks
  SET category = '_medal_table_total_'
  WHERE category = '_medal_table_';

UPDATE public.tournament_scores
  SET category = '_medal_table_total_'
  WHERE category = '_medal_table_';
```

After running:
- Admin can lock/reopen medal table picks independently via `Lock Medal Table` / `Reopen` buttons.
- Players see 3 tabs (Men/Women/Total) in medal table picks, each with 3 slots = 9 picks, 36 pts max.
- Category `status` TEXT already accepts `'locked'` (3-state: open → locked → closed) from Migration 007.

---

### Migration 007 — REQUIRED for per-category closing
**Add `status` column to the `categories` table.**

Without this, admin cannot close individual weight categories. The UI will gracefully
degrade (all categories show as open), but the "Close Category" button will update
a non-existent column and the pick-locking will not persist across sessions.

**Run this in Supabase Dashboard → SQL Editor:**

```sql
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
```

After running, category statuses persist in DB. The UI reads/writes this column
when admin clicks "Close [category]" in TournamentResults.

---

### Migration 006 — REQUIRED to delete tournaments that have players / picks
**Add ON DELETE CASCADE to all tournament child tables.**

Without this, deleting a tournament that has picks from any user fails with a
foreign key constraint error. The default RLS policy only lets users delete their
OWN `user_picks` rows, so the admin's explicit `DELETE FROM user_picks` only removes
the admin's own picks — other users' rows stay, and Postgres blocks the tournament delete.

`ON DELETE CASCADE` runs at the Postgres engine level (bypasses RLS entirely), so
deleting the parent `tournaments` row automatically removes all children.

**Run this in Supabase Dashboard → SQL Editor (STEP 1 — clean up orphaned rows first):**

If you ever deleted a tournament without cascade, child rows may still reference the
deleted tournament ID. Postgres will refuse to add a FK constraint while orphaned rows
exist. Run this cleanup before the ALTER TABLE block:

```sql
-- Remove child rows that reference tournaments which no longer exist
DELETE FROM public.tournament_scores
  WHERE tournament_id NOT IN (SELECT id FROM public.tournaments);

DELETE FROM public.match_results
  WHERE tournament_id NOT IN (SELECT id FROM public.tournaments);

DELETE FROM public.user_picks
  WHERE tournament_id NOT IN (SELECT id FROM public.tournaments);

DELETE FROM public.competition_brackets
  WHERE tournament_id NOT IN (SELECT id FROM public.tournaments);

DELETE FROM public.tournament_roster
  WHERE tournament_id NOT IN (SELECT id FROM public.tournaments);

DELETE FROM public.categories
  WHERE tournament_id NOT IN (SELECT id FROM public.tournaments);
```

**STEP 2 — add CASCADE constraints and admin-only delete policy:**

```sql
-- user_picks: cascade when tournament is deleted
ALTER TABLE public.user_picks
  DROP CONSTRAINT IF EXISTS user_picks_tournament_id_fkey,
  ADD CONSTRAINT user_picks_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- match_results: cascade when tournament is deleted
ALTER TABLE public.match_results
  DROP CONSTRAINT IF EXISTS match_results_tournament_id_fkey,
  ADD CONSTRAINT match_results_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- competition_brackets: cascade when tournament is deleted
ALTER TABLE public.competition_brackets
  DROP CONSTRAINT IF EXISTS competition_brackets_tournament_id_fkey,
  ADD CONSTRAINT competition_brackets_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- tournament_roster: cascade when tournament is deleted
ALTER TABLE public.tournament_roster
  DROP CONSTRAINT IF EXISTS tournament_roster_tournament_id_fkey,
  ADD CONSTRAINT tournament_roster_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- categories: cascade when tournament is deleted
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_tournament_id_fkey,
  ADD CONSTRAINT categories_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- tournament_scores: cascade when tournament is deleted (also in Migration 005)
ALTER TABLE public.tournament_scores
  DROP CONSTRAINT IF EXISTS tournament_scores_tournament_id_fkey,
  ADD CONSTRAINT tournament_scores_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;

-- Restrict tournament DELETE to admin users only (backend enforcement)
-- This complements the frontend check (delete button only shown to admins).
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tournaments"
  ON public.tournaments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert tournaments"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

CREATE POLICY "Admins can update tournaments"
  ON public.tournaments FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );

CREATE POLICY "Admins can delete tournaments"
  ON public.tournaments FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')
  );
```

After running both steps, deleting a tournament from the UI will cascade automatically
in the database — no RLS interference — and only admins can perform the deletion.

---

## Environment Variables

| Variable                | File         | Purpose                              |
| ----------------------- | ------------ | ------------------------------------ |
| `GEMINI_API_KEY`         | `.env.local` | Google Gemini API key                |
| `VITE_SUPABASE_URL`     | `.env.local` | Supabase project URL                 |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | Supabase anonymous/public key        |

Supabase credentials use `import.meta.env` with hardcoded fallbacks in `lib/supabaseClient.ts`.

> `.env.local` is covered by `.gitignore` (`*.local` pattern).

## Deployment (Vercel)

| Setting           | Value           |
| ----------------- | --------------- |
| **Framework**     | Vite            |
| **Build command** | `npm run build` |
| **Output dir**    | `dist`          |
| **SPA routing**   | `vercel.json` rewrites all paths to `/` |

**Required env vars in Vercel dashboard:**
- `GEMINI_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Project Structure

```
Tippon/
├── App.tsx                    # Root component, routing, global state
├── types.ts                   # TypeScript interfaces
├── vite.config.ts             # Vite config (port 3000, env injection)
├── lib/
│   ├── supabaseClient.ts      # Supabase client init
│   ├── scoringEngine.ts       # Scoring engine: compares picks vs results
│   ├── bracketUtils.ts        # buildMatchesForBracket, simulateBracket, deriveStandings
│   ├── bracketDraft.ts        # Bracket builder draft model (pure)
│   ├── drawPdfParser.ts       # Local IJF/EJU draw PDF parser (pdfjs text layer)
│   └── rankings.ts            # Ranking aggregation, day rankings, weightsMatch
├── pages/
│   ├── Login.tsx              # Auth (login/register)
│   ├── ForgotPassword.tsx     # Password recovery
│   ├── UpdatePassword.tsx     # Password reset
│   ├── Home.tsx               # Dashboard home
│   ├── TournamentList.tsx     # Tournament listing + player counts
│   ├── TournamentRoster.tsx   # Player-facing roster view
│   ├── TournamentBracket.tsx  # Bracket viewer + pick system + result colors
│   ├── TournamentResults.tsx  # Admin: enter real match winners
│   ├── BuildBracket.tsx       # Admin: draw PDF import (local parser, Gemini fallback) + draft editor + publish
│   ├── BracketBuilder.tsx     # Admin: manual bracket builder
│   ├── Leaderboard.tsx        # Global + per-tournament rankings
│   └── Profile.tsx            # User profile
├── components/
│   ├── Navigation.tsx         # Bottom nav bar
│   ├── MatchCard.tsx          # Single match display
│   ├── TournamentRoster.tsx   # Admin roster management (import Excel)
│   ├── FlatFlag.tsx           # Country flag component
│   ├── MobileBracketTabs.tsx  # Phone bracket: round tabs
│   ├── BracketZoom.tsx        # Zoomable bracket tree (desktop/tablet)
│   ├── UserPicksViewer.tsx    # Read-only picks of another user (RLS-visible)
│   ├── bracketBuilder/        # DrawImportPanel, BracketEditor, PoolGrid, UnassignedTray, useDraftAutosave, aiDrawExtraction
│   └── ui/
│       ├── Button.tsx         # Reusable button
│       └── Flag.tsx           # Flag wrapper
├── migrations/009_v2.sql      # v2 schema, picks_open()/picks_visible(), user_picks RLS
├── tests/                     # vitest suites
├── vercel.json                # SPA rewrites for Vercel
└── .env.local                 # GEMINI_API_KEY + Supabase creds (not committed)
```

## AI Integration (Gemini)

- **Model:** `gemini-2.5-flash-lite` for results PDFs; `gemini-2.5-flash` for the scanned-draw fallback (`components/bracketBuilder/aiDrawExtraction.ts`)
- **SDK:** `@google/genai` v1.48+
- **Usage:**
  - Draw PDFs are parsed locally (`lib/drawPdfParser.ts`); Gemini is only used for draw pages without a text layer (scanned PDFs), output marked `source: 'ai'` for review
  - PDF results extraction in `TournamentResults.tsx` — extracts all-round winners from the JudoTV/IJF Results PDF
- **Config:** thinking disabled (`thinkingBudget: 0`), JSON structured output via `responseJsonSchema`
- **Timeout:** 120 seconds via `httpOptions`
- **Retry:** up to 3 attempts on 503 errors with progressive backoff (3s, 6s, 9s)

## Conventions

- **Language:** 🚨 ALL text must be in English — UI labels, buttons, error messages, confirm dialogs, tooltips, console logs, code comments, README sections. This is a permanent project-wide requirement. No exceptions. If a Spanish string is found anywhere, translate it to English immediately.
- **State management:** React `useState` + prop drilling (no Redux/Zustand)
- **Routing:** Manual view switching via `ViewState` enum in `App.tsx`
- **Styling:** Tailwind utility classes, consistent color palette (`slate`, `blue`, `purple`)
- **DB IDs:** Mix of `bigint` (identity) and `uuid` depending on the table
- **Status casing:** DB stores lowercase (`live`, `completed`); all frontend comparisons normalize to uppercase via `.toUpperCase()`

## Testing Audit (Fase 8)

### Bugs Found & Fixed

| Bug | File | Fix |
|-----|------|-----|
| Status casing mismatch — DB stores `live`/`completed` but UI compared to `LIVE`/`COMPLETED` | `TournamentBracket.tsx` | Normalize `effectiveStatus` with `.toUpperCase()` |
| `localStatus` not syncing when parent `tournament.status` updates (LIVE not propagated to active users) | `TournamentBracket.tsx` | Added `useEffect` that syncs `localStatus` from `tournament?.status` |
| Player count overcounting (counted rows per category, not distinct users) | `TournamentList.tsx` | Fetch `user_id` values and deduplicate with `Set` |
| Users with 0 picks appearing in tournament leaderboard | `Leaderboard.tsx` | Filter `total_picks > 0` before building rankings |
| COMPLETED tournaments displayed as "LIVE" on Home hero badge | `Home.tsx` | Added explicit `COMPLETED` status branch with distinct styling |

### Known Limitations (Not Critical)

- `scoring_configuration` from admin is not consumed by `scoringEngine.ts` — engine uses default round-based points (`R1=2, R2=4, QF=8, SF=16, F=32`)
- Roster re-import can duplicate athletes if no DB unique constraint exists on `(tournament_id, first_name, last_name)`
- `BuildBracket.tsx` preview mode (`showPreview`) is defined but never triggered (dead code)
- Medal table picks are 3 slots × 3 keys (`_medal_table_men_`, `_medal_table_women_`, `_medal_table_total_`); legacy `_medal_table_` rows were renamed to `_medal_table_total_` in Migration 008
- Pick lockout is enforced server-side (RLS + `picks_open()`) only once Migration 009 is applied

## Feature Updates (Major Features)

### Results PDF Upload via Gemini (TournamentResults.tsx)
- Admin can now click **Upload Results PDF** in the Results Entry header
- Gemini (`gemini-2.5-flash-lite`) reads all rounds (R1 → Final) from the JudoTV/IJF results PDF
- Extracted winner names are fuzzy-matched (first 6 chars of last name) against bracket competitors
- Winners are propagated through rounds automatically using the same bracket traversal logic
- Admin can review and manually correct any mis-matches before hitting **Save Results**

### Results UI: Bracket Format (TournamentResults.tsx)
- Results entry now uses the same left-to-right recursive bracket tree as the picks view
- `ResultsBracketNode` (recursive) + `ResultMatchCard` replace the old flat round-by-round list
- Click any competitor row to select them as the match winner (green highlight + checkmark)
- Champion panel at far right shows the winner of the Final with flag

### Full English UI
- All user-facing strings translated: buttons, labels, alert dialogs, confirm dialogs, error messages
- Affected files: `TournamentResults.tsx`, `BuildBracket.tsx`, `TournamentBracket.tsx`, `TournamentList.tsx`, `App.tsx`, `Leaderboard.tsx`, `BracketBuilder.tsx`, `components/MatchCard.tsx`

### Drag-Out to Unassign Competitor (TournamentBracket.tsx)
- During bracket building (`showDragDrop` mode), admin can drag a competitor FROM a match slot back to the sidebar
- A "Drag here to remove" zone is displayed at the top of the Judokas sidebar
- Dropping any competitor on the sidebar (anywhere) calls `handleUnassignCompetitor`, which clears their slot from the R1 match and persists to Supabase
- The competitor immediately reappears as "Unplaced" in the sidebar

### Category Filtering in Draw PDF Import (BuildBracket.tsx)
- `handleProcessPDF` now filters Gemini-extracted categories against the tournament's configured categories
- Normalization removes gender prefixes (Men/Women) and whitespace for matching (e.g., `"Men -90kg"` → `"-90kg"`)
- If no configured categories match the PDF, an alert lists what the PDF has vs. what was configured
- This prevents extra categories from PDF bleeding into a tournament that only uses a subset

### Picks Isolation Fix (App.tsx + TournamentBracket.tsx)
- **Root cause**: `allUserPicks` React state was never cleared on logout → next logged-in user could see previous user's picks
- **Fix 1**: Added `setAllUserPicks({})` to the `SIGNED_OUT` auth event handler in `App.tsx`
- **Root cause 2**: `localStorage` key was not user-scoped (`tippon-picks-{tournamentId}-{category}`) → shared between users on the same device
- **Fix 2**: localStorage key now includes `userId`: `tippon-picks-{userId}-{tournamentId}-{category}`
- **Priority**: DB (user-scoped query with `eq('user_id', userId)`) > localStorage (user-scoped key) > empty

### Delete Tournament at Any Stage (TournamentList.tsx)
- The delete (trash) button is now always visible for ADMIN users, regardless of tournament status
- LIVE/COMPLETED tournaments still show the Lock icon to prevent editing; deletion remains available
- Cascading delete order: `competition_brackets` → `tournament_roster` → `categories` → `tournaments`

### Score Calculation Architecture (scoringEngine.ts + TournamentBracket.tsx + Leaderboard.tsx)

**Problem**: Supabase RLS (Row Level Security) by default only lets users read their
OWN rows in `user_picks`. When the admin runs "Finalize & Close", `calculateScores`
queries `user_picks` for all users — RLS silently returns only the admin's row →
only the admin's score is stored → only the admin appears in the leaderboard.

**Solution — two-layer approach:**

1. **Batch calculation on close** (`TournamentResults.tsx → handleFinalizeTournament`):
   - Calls `calculateAllCategoryScores(tournamentId, allCategories)` which iterates every
     category and every user in `user_picks`.
   - Works **after** running Migration 005 (the RLS fix) in Supabase.

2. **Self-calculation fallback** (`TournamentBracket.tsx`):
   - `calculateMyScore(tournamentId, category, userId, myPicks)` — each user computes
     their own score (reads only their own picks from React state, not DB) and upserts
     the result into `tournament_scores`.
   - A `useEffect` runs for **all categories** (not just the selected tab) the moment
     any authenticated user opens a COMPLETED bracket, ensuring full leaderboard coverage
     even before the admin runs the batch calculation.

3. **Global leaderboard** (`Leaderboard.tsx → fetchGlobalLeaderboard`):
   - No longer reads `profiles.points` (which was a stale, manually-incremented counter).
   - Aggregates `tournament_scores.total_points` per user at query time.
   - Deleting a tournament automatically reflects on the leaderboard once Migration 005's
     `ON DELETE CASCADE` is applied to `tournament_scores`.

4. **Home dashboard — Season Points** (`Home.tsx`):
   - The Season Points stat card sums `tournament_scores.total_points` for the logged-in user
     (same source of truth as the global leaderboard), not `profiles.points`, so the value
     drops to **0** after all tournaments are deleted.

5. **Flags & ranks (UI)**:
   - IOC code **BRN** maps to Bahrain (`bh`), not Brazil (`br`). Unknown 3-letter IOC codes no longer
     use the first two letters as ISO (that mis-flagged BRN as Brazil). Unmapped codes show a small
     grey badge with the letters.
   - **UR** (unranked placeholder) is no longer shown beside judokas on match cards; world ranking
     is only shown when a real rank exists.

6. **Draw PDF → R1 row count** (`BuildBracket.tsx` + `lib/bracketUtils.ts`):
   - `match_number` **restarts at 1 for each weight category** (not a global counter across categories).
   - R1 size uses the same power-of-two field as the UI: `getBracketParticipantCount(athletes)` then
     `expectedR1 = fieldSize / 2`. Missing first-round slots are inserted with empty `bracket_data`.
   - Gemini extracts `participant_count` from the category header (e.g. `(32)`) and optional
     `pdf_match_number` per match. Without `participant_count`, athlete count is inferred from
     extracted matches so the bracket still fills (e.g. 14 matches → 28 athletes → 32 field → 16 R1 rows).

6b. **Bracket tree in UI** (`TournamentBracket.tsx`, `TournamentResults.tsx`):
   - R1 nodes are built for **every** first-round slot (`fullR1Count`), not only rows returned from the API,
     so R2+ links always connect (no orphan upper-round nodes).
   - Display numbering: R1 uses **1 … fullR1Count** per category; the next round starts at **fullR1Count + 1**
     (e.g. 32-athlete draw: R1 = 1–16, R2 = 17 …).

7. **Draw PDF insert — FK on `competition_brackets.tournament_id`** (`BuildBracket.tsx`):
   - Before calling Gemini, the app verifies the tournament row exists (`SELECT id FROM tournaments`)
     and coerces `tournament_id` to an integer for inserts. This avoids confusing 409/23503 errors
     when the UI is stale (e.g. tournament deleted) or the ID is invalid.
   - **Supabase:** authenticated users must be allowed to `SELECT` from `tournaments` (see Migration 006
     policy `"Anyone can read tournaments"`). Without it, the pre-check fails even for valid events.

**⚠️ Action required**: Run **Migration 005** in Supabase Dashboard → SQL Editor
(see Migrations section above). Without it, only the admin will appear in the leaderboard.
