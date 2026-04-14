# CONFIG_PROTOCOL_README — Tippon

## Project Overview

**Tippon** is a Judo tournament prediction app (fantasy-sports style). Admins create tournaments, upload rosters and draw PDFs (from IJF), and the system builds visual brackets. Players then predict match winners to earn points and compete on a leaderboard.

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
| Deployment  | Vercel (planned)                                 |

### Key Flows

1. **Admin creates tournament** → `AdminDashboard` → saves to `tournaments` table
2. **Admin uploads roster** (Excel) → `TournamentRoster` component → saves to `tournament_roster` table
3. **Admin uploads Draw PDF** → `BuildBracket` → Gemini extracts brackets → saves to `competition_brackets`
4. **Player views bracket** → `TournamentBracket` → picks winners → saves to local state (predictions planned)
5. **Leaderboard** → `Leaderboard` → shows rankings from `profiles` / `player_rankings`

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
| `category`      | text        | Weight category name                    |
| `total_points`  | integer     | Sum of points earned                    |
| `correct_picks` | integer     | Number of correct picks                 |
| `total_picks`   | integer     | Number of picks with a result           |
| `breakdown`     | jsonb       | Per-match detail `{ correct, points }`  |
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

---

## Environment Variables

| Variable         | File         | Purpose                              |
| ---------------- | ------------ | ------------------------------------ |
| `GEMINI_API_KEY`  | `.env.local` | Google Gemini API key                |

Supabase credentials are hardcoded in `lib/supabaseClient.ts` (anon key + project URL).

> `.env.local` is covered by `.gitignore` (`*.local` pattern).

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
└── .env.local                 # GEMINI_API_KEY (not committed)
```

## AI Integration (Gemini)

- **Model:** `gemini-2.5-flash-lite` (low latency, high availability)
- **SDK:** `@google/genai` v1.48+
- **Usage:** PDF draw extraction in `BuildBracket.tsx`
- **Config:** thinking disabled (`thinkingBudget: 0`), JSON structured output via `responseJsonSchema`
- **Timeout:** 120 seconds via `httpOptions`
- **Retry:** up to 3 attempts on 503 errors with progressive backoff (3s, 6s, 9s)

## Conventions

- **Language:** UI text in Spanish, code/comments in English
- **State management:** React `useState` + prop drilling (no Redux/Zustand)
- **Routing:** Manual view switching via `ViewState` enum in `App.tsx`
- **Styling:** Tailwind utility classes, consistent color palette (`slate`, `blue`, `purple`)
- **DB IDs:** Mix of `bigint` (identity) and `uuid` depending on the table
