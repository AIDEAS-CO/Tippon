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
npm test          # Unit tests (vitest run; tests/*.test.ts)
npm run typecheck # tsc --noEmit (2 known errors in lib/supabaseClient.ts: import.meta.env typing)
```

No linter is configured.

**Env:** `GEMINI_API_KEY` in `.env.local` — used for results-PDF extraction and as the AI fallback for draw PDFs without a text layer (normal draw PDFs are parsed locally).

**DB migrations:** `migrations/009_v2.sql` (run in Supabase SQL editor) is required for v2: global lock + RLS, draft autosave, golden matches, days, Mixed gender.

## Architecture Overview

**Tippon** is a Judo tournament prediction app. Admins create tournaments and brackets; players pick match winners to earn points on a leaderboard.

**Tech stack:** React 19 + TypeScript + Vite, Tailwind CSS, Supabase (auth + PostgreSQL), pdfjs-dist (local draw-PDF parsing), Google Gemini API (results PDFs + scanned-draw fallback), @dnd-kit/core (bracket builder drag & drop), SheetJS (optional Excel roster uploads), vitest.

### Routing

No React Router. All navigation uses a `ViewState` string union in `types.ts`, switched in `App.tsx` via `setCurrentView()` (`renderContent()`). There are **17** named views (auth, admin wizard, bracket, roster, results, medal table picks, final results, leaderboards, profile).

Key view transitions (see `App.tsx` → `renderContent`):

- Selecting a tournament routes to `ROSTER` (DRAFT/UPCOMING) or `BRACKET` (LIVE/COMPLETED)
- **`MEDAL_TABLE_PICKS`** — country ranking predictions; opened from `TournamentBracket` when status is DRAFT/UPCOMING; uses `handleSavePicks` with `category` = `_medal_table_men_` / `_medal_table_women_` / `_medal_table_total_` (3 rank slots each; not a weight class)
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
| `pages/BuildBracket.tsx` | Admin bracket builder: import draw PDFs, edit draft, publish to `competition_brackets` |
| `lib/drawPdfParser.ts` | Deterministic local parser for IJF/EJU draw PDFs (pdfjs text layer → slots per category) |
| `lib/bracketDraft.ts` | Pure draft model: slots/tray moves, `setFieldSize`, `validateCategory`, `draftToBracketRows`, `rowsToDraftCategory`, `normalizeWeightKey` |
| `components/bracketBuilder/` | `DrawImportPanel`, `BracketEditor`, `PoolGrid` (@dnd-kit/core), `UnassignedTray`, `useDraftAutosave`, `aiDrawExtraction` (Gemini fallback) |
| `components/MobileBracketTabs.tsx` / `BracketZoom.tsx` | Phone: tabbed match list; desktop/tablet: zoomable bracket tree |
| `pages/MedalTablePicks.tsx` | Medal table predictions (`user_picks.category` = `_medal_table_men_` / `_women_` / `_total_`, keys `"1"`…`"3"`) |
| `pages/TournamentFinalResults.tsx` | Post-close: actual standings, all users’ points and breakdowns |
| `components/UserPicksViewer.tsx` | Read-only view of another user's picks (RLS-visible rows only); Picks tab in Leaderboard modal + Final results |
| `lib/rankings.ts` | `aggregateRanking` (ties share rank), `buildDayRankings` (Total + per-day), `weightsMatch`, `lookupByWeight`, `selectStandingTournament` |
| `lib/iocCountryFlags.ts` | IOC country code → flag mappings |
| `migrations/009_v2.sql` | v2 schema + `is_admin()` / `picks_open()` / `picks_visible()` + `user_picks` RLS |
| `tests/` | vitest suites (draft model, draw parser, bracket utils, scoring, rankings) |
| `CONFIG_PROTOCOL_README.md` | DB schema reference and migration history |

### Database Tables (Supabase)

| Table | Purpose |
|-------|---------|
| `tournaments` | Core entity; `scoring_configuration` JSONB; v2: `picks_locked`, `bracket_draft` (+ `_updated_at`), `golden_matches` (`[{category, matchId, points}]`), `end_date` |
| `categories` | Weight categories per tournament: `name`, `gender` (`Male`/`Female`/`Mixed`), `status` (`open`/`locked`/`closed`), `day` |
| `tournament_roster` | Athletes per tournament (optional since v2; brackets carry athletes in `bracket_data`) |
| `competition_brackets` | One row per R1 fight: `weight_category` (= `categories.name`), `match_number`, `bracket_data {competitor1, competitor2: {id,name,country}|null, pool, slot}` |
| `user_picks` | Player predictions (`picks_data` JSONB: per category `matchId → competitorId` + `additional_pick`; medal rows `_medal_table_men_|_women_|_total_` with keys `"1"`…`"3"` → country codes). RLS: write only while `picks_open()`, read others' only when locked |
| `tournament_scores` | Calculated scores after results entry |
| `match_results` | Actual match outcomes |
| `profiles` | User info including `role: 'ADMIN' | 'PLAYER'` |

> Some tournaments store roster/brackets as JSONB directly on the `tournaments` row (legacy). New code uses relational tables.

### Admin Workflow (Multi-Step Wizard)

`AdminDashboard.tsx` drives tournament creation via an `initialStep` prop. The steps flow through:
`CREATE_TOURNAMENT` (dates incl. optional End Date, categories, Day per category, Mixed Teams → category `Teams`, gender `Mixed`) → `SCORING_RULES` → `BUILD_BRACKET`. Roster Excel upload (`MANAGE_ROSTER`) is optional.

`draftTournament` in `App.tsx` persists the in-progress tournament across steps.

**BuildBracket (v2):** draw PDFs are parsed locally by `lib/drawPdfParser.ts`; only PDFs without a text layer fall back to Gemini (`components/bracketBuilder/aiDrawExtraction.ts`, `gemini-2.5-flash`). Parsed categories are matched to `categories.name` via `normalizeWeightKey`. Work happens in a `BracketDraft` (`lib/bracketDraft.ts`): per category a flat slot array (R1 fight k = slots[2k] vs slots[2k+1], pools A–D) + unassigned tray, edited with drag & drop in a pool grid (@dnd-kit/core). Autosave (`useDraftAutosave`): localStorage `tippon-bracket-draft-${tournamentId}` + debounced `tournaments.bracket_draft`; newer `updatedAt` wins on load. **Publish** validates, then upserts `draftToBracketRows` onto existing `competition_brackets` rows by `match_number` (row ids preserved so `user_picks` / `match_results` keys stay valid), inserts new fights, deletes surplus, sets status `upcoming`, clears the draft. Athlete ids (`ath-<uuid>`) live in `bracket_data` and are the competitor ids used by picks.

### Bracket Rendering

`TournamentBracket.tsx` uses a recursive `BracketNode` component to render the single-elimination tree. It has two modes:
- **Read-only:** tournament is LIVE or COMPLETED (picks locked for players)
- **Editable:** tournament is DRAFT/UPCOMING (players can pick winners). Header includes **Medal table picks** → `MEDAL_TABLE_PICKS`.
- **Locks:** read-only when COMPLETED, the category is `locked`/`closed`, or `tournaments.picks_locked`; followed live via a realtime channel on `categories` + `tournaments`. Server side, RLS (`picks_open()`, category names normalized like `weightsMatch`) rejects writes → `handleSavePicks` returns `false` + toast.
- **Golden matches:** admins toggle a match (★) → `handleToggleGolden` updates `tournaments.golden_matches`; R1 ids are `competition_brackets.id`, later rounds `r{level}-m{i}`, always paired with the category.
- **Layout:** phones (<768px) use `MobileBracketTabs` (round tabs + Extra pick); larger screens a zoomable tree (`BracketZoom`). A sticky bottom bar (progress + Save) sits inside the App scroll container (`app-shell`, `100dvh`).
- **Byes:** an R1 fight with one athlete (either side) auto-advances (`simulateBracket`, results entry, bracket load).

### Results entry and standings

`TournamentResults.tsx` (admin): enter winners per match; optional PDF extract. Header: **Lock all picks / Unlock all picks** (`tournaments.picks_locked`; lock also locks open categories + medal table and sets LIVE; unlock clears only the global flag). Collapsible **Competition days** panel sets `categories.day`. After final (+ bronze if present) are filled, **Final standings** uses `deriveStandings(matches, results)`. Collapsible **country medal summary** (only when tournament status is **COMPLETED**) aggregates G/S/B across all categories from saved `match_results`.

### Scoring

`scoringEngine.ts` compares predicted placements (via `deriveStandings` on user picks) to actual results; persists `tournament_scores` including JSON **`breakdown`** as `ScoringBreakdown` per weight category, plus **`_bonuses_`** rows with `TournamentBonusBreakdown` (`bonusLines`). Gold/silver/bronze deviation is the **rank-step distance** over placements 1→2→3→5→7 (`rankStepDistance`; e.g. predicted 3rd, actual 7th = 2 steps). Golden matches add their points when the pick equals the actual winner (`breakdown.goldenLines`). Additional pick scores 0 if the athlete was also a predicted medalist. Day rankings (`lib/rankings.ts` `buildDayRankings`) group category scores by `categories.day`; Home/Profile show global rank + current tournament Total/Day rank. `Leaderboard.tsx` renders these shapes (tournament view: `Total | Day N` tabs via `buildDayRankings`, Reveal animation, realtime refresh, user modal with Breakdown + Picks tabs); legacy per-round breakdown maps are still supported for old rows. Batch scoring runs from `TournamentResults` via **Finalize & Close** only. See `CONFIG_PROTOCOL_README.md` for scoring keys and migrations.

### Role-Based Access

`userProfile.role` is either `'ADMIN'` or `'PLAYER'`. Checked inline as `userProfile?.role === 'ADMIN'`. No middleware — just conditional rendering and view redirects in `App.tsx`.
