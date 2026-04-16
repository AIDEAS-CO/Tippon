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
| PDF parsing | pdfjs-dist (unused currently; Gemini reads PDFs) |
| Excel       | xlsx (SheetJS) for roster imports                |
| Deployment  | Vercel                                           |

### Key Flows

1. **Admin creates tournament** → `AdminDashboard` → saves to `tournaments` table
2. **Admin uploads roster** (Excel `.xlsx` / `.xls` or `.csv`) → `TournamentRoster` → reads **all worksheets** with `defval`, normalizes weight labels to tournament categories → `tournament_roster`
3. **Admin uploads Draw PDF** → `BuildBracket` → Gemini extracts brackets → saves to `competition_brackets`
4. **Player views bracket** → `TournamentBracket` → picks winners → saves to local state (predictions planned)
5. **Leaderboard** → `Leaderboard` → shows rankings from `profiles` / `player_rankings`
6. **Medal table picks** → `MedalTablePicks` (`ViewState`: `MEDAL_TABLE_PICKS`) → user ranks countries; saved in `user_picks` with `category = '_medal_table_'` and `picks_data` keys `"1"`…`"10"` → IOC country codes

### Frontend views (`ViewState` in `types.ts`)

Includes: `MEDAL_TABLE_PICKS` — opened from the bracket header while the tournament is `DRAFT` or `UPCOMING`. Uses the same `handleSavePicks` path as weight categories.

- `TOURNAMENT_FINAL_RESULTS` — after `COMPLETED`: tabs for standings per weight category and **country medal table**; total points; per-user `tournament_scores` breakdown (weight categories, `_medal_table_`, `_bonuses_`). Entry: **Final results** on tournament cards or bracket header.

**Finalize / batch scoring order** (`calculateAllCategoryScores` in `lib/scoringEngine.ts`): (1) each weight category → `calculateScores`, (2) **`calculateMedalTableScores`** → row `category = '_medal_table_'`, (3) **`'_bonuses_'`** from `calculateBonusesDetailed` (weight-category results only).

**`tournament_scores.breakdown` for `category = '_bonuses_'`:** JSON with `bonusLines` (array of `{ key, label, points, earned, detail, progressRatio?, progressLabel? }`) and `categoryTotal`, produced by `calculateBonusesDetailed`.

**`tournament_scores.breakdown` for `category = '_medal_table_'`:** JSON `MedalTableScoreBreakdown`: `{ lines: [{ slot, country, predictedRank, actualRank, deviation, points }], categoryTotal, maxPossible }`, produced by `calculateMedalTableScores`.

### Tournament results UI (`TournamentResults.tsx`)

- **Final standings**: After the bracket (same scroll area), when the final has a winner and every bronze match (if any) has a winner, shows positions derived via `deriveStandings(matches, results)`.
- **Country medal summary**: Collapsible table aggregates gold/silver/bronze counts by country across all weight categories (saved `match_results` only).

### Leaderboard breakdown (`Leaderboard.tsx`)

- **New**: `tournament_scores.breakdown` as `ScoringBreakdown` (gold/silver, bronze, pool finals, additional pick, category total) — see `types.ts`.
- **Legacy**: Older rows with per-match `breakdown` maps grouped by round still render as before.

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
| `created_at`           | timestamptz | Auto-generated                                   |

### `categories`
Weight categories per tournament.

| Column          | Type        | Notes                            |
| --------------- | ----------- | -------------------------------- |
| `id`            | bigint (PK) | Auto-generated identity          |
| `tournament_id` | bigint (FK) | → `tournaments.id`              |
| `name`          | text        | e.g., `-73kg`, `-90kg`          |
| `gender`        | text        | `Male` or `Female`              |
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
| `tournament_id` | bigint (FK) | → `tournaments.id` (no explicit FK in schema)  |
| `match_number`  | bigint      | Sequential match number                        |
| `competitor_1`  | uuid (FK)   | → `tournament_roster.id` (nullable)            |
| `competitor_2`  | uuid (FK)   | → `tournament_roster.id` (nullable)            |
| `bracket_data`  | jsonb       | Optional extra data                            |
| `created_at`    | timestamptz | Auto-generated                                 |
| `updated_at`    | timestamptz | Auto-generated                                 |

> **Missing column:** `weight_category` (text) — needed to filter brackets by category in the UI. See [Migration 001](#migration-001).

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
| `category`             | text        | Weight category name                     |
| `picks_data`           | jsonb       | `{ matchId: competitorId }` map          |
| `completion_percentage`| integer     | 0–100                                    |
| `created_at`           | timestamptz | Auto-generated                           |
| `updated_at`           | timestamptz | Auto-generated                           |

**Unique:** `(user_id, tournament_id, category)`
**RLS:** Users can only see/insert/update their own picks.

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
| `category`      | text        | Weight class label **or** synthetic `'_medal_table_'` / `'_bonuses_'` |
| `total_points`  | integer     | Sum of points earned                    |
| `correct_picks` | integer     | Contextual (e.g. slots with points for medal table) |
| `total_picks`   | integer     | Contextual                              |
| `breakdown`     | jsonb       | `ScoringBreakdown`, `MedalTableScoreBreakdown`, or `TournamentBonusBreakdown` |
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
│   └── scoringEngine.ts       # Scoring engine: compares picks vs results
├── pages/
│   ├── Login.tsx              # Auth (login/register)
│   ├── ForgotPassword.tsx     # Password recovery
│   ├── UpdatePassword.tsx     # Password reset
│   ├── Home.tsx               # Dashboard home
│   ├── TournamentList.tsx     # Tournament listing + player counts
│   ├── TournamentRoster.tsx   # Player-facing roster view
│   ├── TournamentBracket.tsx  # Bracket viewer + pick system + result colors
│   ├── TournamentResults.tsx  # Admin: enter real match winners
│   ├── BuildBracket.tsx       # Admin: PDF → bracket extraction (Gemini)
│   ├── BracketBuilder.tsx     # Admin: manual bracket builder
│   ├── Leaderboard.tsx        # Global + per-tournament rankings
│   └── Profile.tsx            # User profile
├── components/
│   ├── Navigation.tsx         # Bottom nav bar
│   ├── MatchCard.tsx          # Single match display
│   ├── TournamentRoster.tsx   # Admin roster management (import Excel)
│   ├── FlatFlag.tsx           # Country flag component
│   └── ui/
│       ├── Button.tsx         # Reusable button
│       └── Flag.tsx           # Flag wrapper
├── vercel.json                # SPA rewrites for Vercel
└── .env.local                 # GEMINI_API_KEY + Supabase creds (not committed)
```

## AI Integration (Gemini)

- **Model:** `gemini-2.5-flash-lite` (low latency, high availability)
- **SDK:** `@google/genai` v1.48+
- **Usage:**
  - PDF draw extraction in `BuildBracket.tsx` — extracts Round 1 matchups from the IJF Draw PDF
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
- No server-side enforcement of pick lockout — only UI-level; direct Supabase writes could bypass lock

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
