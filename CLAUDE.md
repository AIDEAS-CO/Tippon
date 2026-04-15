# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation pairing (required)

When you document or implement changes to **architecture, routing, user flows, database schema, migrations, or scoring behavior**, update **both**:

| File | Purpose |
|------|---------|
| `CONFIG_PROTOCOL_README.md` | Canonical detail: full schema, migration history, extended flows |
| `CLAUDE.md` | Concise overview for coding agents (this file) |

Keep headlines and facts aligned between the two. If you only edit one, the other drifts and misleads the next session.

**Cursor:** the same convention is enforced project-wide via `.cursor/rules/documentation-pairing.mdc` (`alwaysApply: true`).

## Language (required)

**Disclaimer:** All project-related text—**UI copy**, **alerts**, **errors**, **comments in code**, and **agent-facing instructions in this repo**—must be in **English**. Do not add Spanish or other languages unless building explicit localization. Enforced via `.cursor/rules/english-only.mdc` (`alwaysApply: true`).

## Commands

```bash
npm run dev       # Start dev server (port 3000)
npm run build     # Production build
npm run preview   # Preview production build
```

No test runner or linter is configured.

**Required env:** `GEMINI_API_KEY` in `.env.local` (for PDF bracket extraction via Gemini).

## Architecture Overview

**Tippon** is a Judo tournament prediction app. Admins create tournaments and brackets; players pick match winners to earn points on a leaderboard.

**Tech stack:** React 19 + TypeScript + Vite, Tailwind CSS, Supabase (auth + PostgreSQL), Google Gemini API (PDF parsing), SheetJS (Excel roster uploads).

### Routing

No React Router. All navigation uses a `ViewState` string union in `types.ts`, switched in `App.tsx` via `setCurrentView()` (`renderContent()`). There are **17** named views (auth, admin wizard, bracket, roster, results, medal table picks, final results, leaderboards, profile).

Key view transitions (see `App.tsx` → `renderContent`):

- Selecting a tournament routes to `ROSTER` (DRAFT/UPCOMING) or `BRACKET` (LIVE/COMPLETED)
- **`MEDAL_TABLE_PICKS`** — country ranking predictions; opened from `TournamentBracket` when status is DRAFT/UPCOMING; uses `handleSavePicks` with `category = '_medal_table_'` (not a weight class)
- **`TOURNAMENT_FINAL_RESULTS`** — `COMPLETED` only: tabs (standings by weight, country medal table + per-user medal points), points table, verified total + full breakdown (`TournamentFinalResults.tsx`)
- Admin-only views (`CREATE_TOURNAMENT`, `BUILD_BRACKET`, `TOURNAMENT_RESULTS`, etc.) redirect non-admins where applicable (e.g. results → `BRACKET`)

### State Management

All global state lives in `App.tsx` (no Context or external store). Props are drilled to pages; pages call handler callbacks to update root state. Key state:

```typescript
currentView, tournaments, selectedTournament, userProfile,
draftTournament, allUserPicks, userStats
```

User picks are also cached to `localStorage` (keyed by `userId + tournamentId`) as a fallback if DB writes fail.

### Data Flow

1. Supabase returns nested/varied response shapes
2. `mapTournamentData()` in `App.tsx` (~line 155) normalizes all responses into `Tournament` objects
3. Normalized data is passed down via props

When editing data fetching or saving, follow this mapping pattern. The function handles multiple roster formats (`data.roster` direct vs. `data.tournament_participants` relational) and shape differences between DB versions.

### Key Architectural Files

| File | Role |
|------|------|
| `App.tsx` | Root: all global state, routing, Supabase calls, `mapTournamentData` |
| `types.ts` | Source of truth for all TypeScript interfaces (`Tournament`, `Competitor`, `Match`, `UserProfile`, etc.) |
| `lib/scoringEngine.ts` | Weight-category scoring; `calculateMedalTableScores`; `'_bonuses_'`; `scoring_configuration` |
| `lib/bracketUtils.ts` | Bracket build, `deriveStandings()`, `sortedUniqueRounds()`, IJF-style field sizing |
| `lib/countryMedalRanking.ts` | Aggregate G/S/B by country for medal table actuals + scoring |
| `lib/rosterImportUtils.ts` | Normalize weight labels for Excel/CSV roster import |
| `pages/MedalTablePicks.tsx` | Medal table predictions (`user_picks.category === '_medal_table_'`) |
| `pages/TournamentFinalResults.tsx` | Post-close: actual standings, all users’ points and breakdowns |
| `lib/iocCountryFlags.ts` | IOC country code → flag mappings |
| `CONFIG_PROTOCOL_README.md` | DB schema reference and migration history |

### Database Tables (Supabase)

| Table | Purpose |
|-------|---------|
| `tournaments` | Core entity; `scoring_configuration` is a JSONB column for custom round points |
| `tournament_roster` | Athletes per tournament (relational, preferred over `tournaments.roster` JSONB) |
| `competition_brackets` | First-round match data extracted from PDFs |
| `user_picks` | Player predictions (`picks_data` JSONB: per category, usually `matchId → competitorId`; special row `category = '_medal_table_'` with rank keys `"1"`…`"10"` → country codes) |
| `tournament_scores` | Calculated scores after results entry |
| `match_results` | Actual match outcomes |
| `profiles` | User info including `role: 'ADMIN' | 'PLAYER'` |

> Some tournaments store roster/brackets as JSONB directly on the `tournaments` row (legacy). New code uses relational tables.

### Admin Workflow (Multi-Step Wizard)

`AdminDashboard.tsx` drives tournament creation via an `initialStep` prop. The steps flow through:
`CREATE_TOURNAMENT` → `SCORING_RULES` → `MANAGE_ROSTER` (Excel upload) → `BUILD_BRACKET` (PDF → Gemini extraction)

`draftTournament` in `App.tsx` persists the in-progress tournament across steps.

### Bracket Rendering

`TournamentBracket.tsx` uses a recursive `BracketNode` component to render the single-elimination tree. It has two modes:
- **Read-only:** tournament is LIVE or COMPLETED (picks locked for players)
- **Editable:** tournament is DRAFT/UPCOMING (players can pick winners). Header includes **Medal table picks** → `MEDAL_TABLE_PICKS`.

### Results entry and standings

`TournamentResults.tsx` (admin): enter winners per match; optional PDF extract. After final (+ bronze if present) are filled, **Final standings** uses `deriveStandings(matches, results)`. Collapsible **country medal summary** (only when tournament status is **COMPLETED**) aggregates G/S/B across all categories from saved `match_results`.

### Scoring

`scoringEngine.ts` compares predicted placements (via `deriveStandings` on user picks) to actual results; persists `tournament_scores` including JSON **`breakdown`** as `ScoringBreakdown` per weight category, plus **`_bonuses_`** rows with `TournamentBonusBreakdown` (`bonusLines`). Additional pick scores 0 if the athlete was also a predicted medalist. `Leaderboard.tsx` renders these shapes; legacy per-round breakdown maps are still supported for old rows. Batch scoring runs from `TournamentResults` via **Finalize & Close** only. See `CONFIG_PROTOCOL_README.md` for scoring keys and migrations.

### Role-Based Access

`userProfile.role` is either `'ADMIN'` or `'PLAYER'`. Checked inline as `userProfile?.role === 'ADMIN'`. No middleware — just conditional rendering and view redirects in `App.tsx`.
