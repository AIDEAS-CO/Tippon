# Tippon — Scoring System

## How Scoring Works

Users pick match winners in the bracket from Round 1 onward. Only the **derived final 8 positions** per category matter for scoring — nothing before QF gives points.

From any set of bracket picks (user predictions OR actual results), the final standings are derived as:

| Position | Source |
|----------|--------|
| 1st (Gold) | Final winner |
| 2nd (Silver) | Final loser |
| 3rd (Bronze) | Bronze match 1 winner + Bronze match 2 winner |
| 5th | Bronze match 1 loser + Bronze match 2 loser |
| 7th | Repechage match 1 loser + Repechage match 2 loser |

If no repechage bracket: SF losers = 3rd, no 5th or 7th.

---

## Per-Category Scoring

### 1. Gold & Silver (max 12 pts default)

For each of the user's predicted 1st and 2nd place athletes:
- Find where that athlete **actually finished**
- Calculate the **rank-step distance** over the placement order `1, 2, 3, 5, 7` (positions 4 and 6 do not exist):
  `RANK_INDEX = {1:0, 2:1, 3:2, 5:3, 7:4}`, `deviation = |RANK_INDEX[predicted] − RANK_INDEX[actual]|`.
  If the athlete has no actual placement (did not finish top 7), `deviation = 99` (0 pts).
- Stored as `PositionScoreDetail.deviation` in the breakdown.

| Deviation (steps) | Rule ID | Default Pts |
|:---------:|---------|:-----------:|
| 0 (exact) | `gold_silver_exact` | **6** |
| 1 | `gold_silver_dev1` | **3** |
| 2 | `gold_silver_dev2` | **2** |
| 3 | `gold_silver_dev3` | **1** |
| 4+ | — | 0 |

Example: User predicts Gold = Athlete A, Silver = Athlete B.
Actual: Athlete A = Silver (pos 2), Athlete B = Gold (pos 1).
Score: deviation 1 each = 3 + 3 = **6 pts**.

Example: predicted Gold finishes 5th → 3 steps → `gold_silver_dev3` = **1 pt**.

### 2. Bronze — 3rd Place (max 8 pts default)

Same deviation logic for the user's two predicted bronze medalists.
Both bronze positions are **equivalent** — if predicted as 3rd and actually won either bronze, deviation = 0.

| Deviation (steps) | Rule ID | Default Pts | Example |
|:---------:|---------|:-----------:|---------|
| 0 (exact) | `bronze_exact` | **4** | 3rd → 3rd |
| 1 | `bronze_dev1` | **3** | 3rd → 5th (or 2nd) |
| 2 | `bronze_dev2` | **1** | 3rd → 7th (or 1st) |
| 3+ | — | 0 | |

### 3. Pool Finals — QF Participants (max 8 pts default)

8 athletes reach the QF per category. The user's bracket picks determine who they predict as those 8.

- **1 point per correctly predicted QF athlete** (order doesn't matter)
- Rule ID: `pool_finals_per_correct` — default **1 pt**

### 4. Additional Pick — Zusatztipp (max 2 pts)

User manually selects one athlete per category using the pick box below the bracket. The athlete **must not** be one of the user’s predicted medalists (gold / silver / bronze from their bracket picks); if they are the same, the UI clears the pick and scoring awards **0** pts for this component.

- If that athlete finishes **Top 7** (positions 1–7) → `additional_pick_top7` = **2 pts**
- Key in `picks_data`: `"additional_pick": competitorId`

### 5. Golden Matches (optional, admin-defined)

Admins can flag individual matches as **golden** in `tournaments.golden_matches` (JSONB array of `{ category, matchId, points }`; frontend `Tournament.goldenMatches`).

- If the user's `picks_data[matchId]` equals the actual winner (`match_results.winner_competitor_id`) → `points` are added to that category's total.
- Category matching is weight-label tolerant (`"Men -73kg"` ≡ `"-73kg"`, see `weightsMatch` in `lib/rankings.ts`).
- Breakdown field: `ScoringBreakdown.goldenLines[]` — `{ matchId, round?, label?, pickedId, pickedName?, winnerId, winnerName?, points }` (omitted when the category has no golden matches). Included in `categoryTotal` / `total_points`.

### Disabling a rule

Any rule key set to `0` in `scoring_configuration` disables it (0 is respected). A **missing** key falls back to the default value.

---

## Tournament-Wide Scoring

### 6. Medal Table (separate prediction page)

User predicts country **ranking** in the medal table (by most golds, then silvers, then bronzes).

Deviation per predicted country:

| Deviation | Rule ID | Default Pts |
|:---------:|---------|:-----------:|
| 0 | `medal_table_exact` | **4** |
| 1 | `medal_table_dev1` | **3** |
| 2 | `medal_table_dev2` | **2** |
| 3 | `medal_table_dev3` | **1** |
| 4+ | — | 0 |

Three tables (3 rank slots each), stored in `user_picks` as categories `_medal_table_men_`, `_medal_table_women_`, `_medal_table_total_` (legacy `_medal_table_` rows are read as Total).

**Men / Women / Total:** Men and Women tables only include categories whose `categories.gender` is exactly `Male` / `Female`. **Mixed** categories (e.g. Mixed Teams) count only toward **Total** (`splitMedalTableCategories`). In Teams brackets the competitors are countries; when a competitor has no `country`, a 3-letter competitor name is used as the country code.

**Actual ranking:** Countries are ordered by total gold, then silver, then bronze (aggregated from final standings across all weight categories — see `lib/countryMedalRanking.ts`). For each filled rank slot `1`…`3`, deviation = `|predicted rank − actual rank|` for that country code.

**Persisted score:** On finalize, `calculateMedalTableScores` writes one `tournament_scores` row per table (`_medal_table_men_` / `_women_` / `_total_`, max 12 pts each by default) with `breakdown` of type `MedalTableScoreBreakdown` (`lines`, `categoryTotal`, `maxPossible`).

---

## Bonuses

Calculated after all **weight** categories are scored. Batch order: weight categories → medal tables (`_medal_table_men_` / `_women_` / `_total_`) → bonuses (`'_bonuses_'`). Bonus rules use only per–weight-class `ScoringBreakdown` results, not the medal table row.

| Rule ID | Description | Default Pts |
|---------|-------------|:-----------:|
| `bonus_perfect_weight` | All 4 medalists (G, S, B×2) exactly correct — awarded **per category** where this happens | **10** each |
| `bonus_majority_champs` | Exact gold in **more than 50%** of the categories the user has picks in | **8** |
| `bonus_10_additional` | Additional pick scores in at least `ceil(70%)` of all weight categories | **6** |
| `bonus_all_pools` | All QF participants correct — awarded **per category** where this happens | **5** each |

Bonuses are stored as category `'_bonuses_'` in `tournament_scores`.

---

## Maximum Possible Points (per category, default values)

| Component | Max |
|-----------|:---:|
| Gold/Silver | 12 |
| Bronze | 8 |
| Pool Finals | 8 |
| Additional Pick | 2 |
| **Category Total** | **30** (+ golden match points, if any) |

---

## Modifying Point Values

**Per-tournament (recommended):** Admin goes to tournament Step 2 (Scoring Rules) → adjust values in the UI.

**Change defaults globally:** Edit `lib/scoringEngine.ts` → `DEFAULTS` object.

**AdminDashboard defaults:** Edit `pages/AdminDashboard.tsx` → `DEFAULT_SCORING_RULES` array.

---

## Repechage Toggle

Set in tournament Step 2 → "Repechage Bracket" toggle.

When ON:
- Two repechage matches (REP_AB, REP_CD) and two bronze matches generated
- QF losers → REP → REP winners fight SF losers for bronze (IJF cross-over)
- 5th and 7th place positions are available for scoring

When OFF:
- No REP or Bronze matches
- SF losers = 3rd place (both equivalent)
- No 5th or 7th positions

---

## Scoring Config DB Format

`tournaments.scoring_configuration` (JSONB):
```json
{
  "gold_silver_exact": 6,
  "gold_silver_dev1": 3,
  "gold_silver_dev2": 2,
  "gold_silver_dev3": 1,
  "bronze_exact": 4,
  "bronze_dev1": 3,
  "bronze_dev2": 1,
  "pool_finals_per_correct": 1,
  "additional_pick_top7": 2,
  "medal_table_exact": 4,
  "medal_table_dev1": 3,
  "medal_table_dev2": 2,
  "medal_table_dev3": 1,
  "bonus_perfect_weight": 10,
  "bonus_majority_champs": 8,
  "bonus_10_additional": 6,
  "bonus_all_pools": 5,
  "has_repechage": true
}
```
