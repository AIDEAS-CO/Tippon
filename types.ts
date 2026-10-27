
export interface Competitor {
  id: string;
  name: string;
  country: string;
  flagUrl: string;
  rank?: number | string; // World ranking when known; omit for draw-only entries
  sex?: 'M' | 'F';      // From Excel Column A
  weight?: string;      // From Excel Column B
}

export interface Match {
  id: string;
  round: string; // 'R1', 'R2', 'QF', 'SF', 'F', 'REP', 'B'
  roundType?: 'main' | 'repechage' | 'bronze'; // section of the bracket
  pool?: string;
  matchNumber: number;
  competitor1: Competitor | null;
  competitor2: Competitor | null;
  winnerId: string | null;
  nextMatchId?: string;      // winner goes here
  nextMatchSlot?: 1 | 2;    // 1 = top slot, 2 = bottom slot
  loserNextMatchId?: string; // loser goes here (QF → REP, SF → BRONZE)
  loserNextMatchSlot?: 1 | 2;
}

export type ViewState = 'LOGIN' | 'FORGOT_PASSWORD' | 'UPDATE_PASSWORD' | 'HOME' | 'TOURNAMENTS' | 'CREATE_TOURNAMENT' | 'SCORING_RULES' | 'MANAGE_ROSTER' | 'BUILD_BRACKET' | 'BRACKET' | 'ROSTER' | 'LEADERBOARD' | 'TOURNAMENT_LEADERBOARD' | 'TOURNAMENT_RESULTS' | 'MEDAL_TABLE_PICKS' | 'TOURNAMENT_FINAL_RESULTS' | 'PROFILE';

export type UserRole = 'ADMIN' | 'PLAYER';

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  username?: string; // Renamed from nickname
  avatar_url?: string;
  role: UserRole;
  points?: number; 
  rank?: number;   
  daily_accuracy?: number;
}

export interface TournamentCategories {
  male: string[];
  female: string[];
  /** Mixed / Teams categories — count only toward the Total medal table. */
  mixed?: string[];
}

/** `categories.gender` values. Mixed (e.g. Mixed Teams) never counts toward Men/Women medal tables. */
export type CategoryGender = 'Male' | 'Female' | 'Mixed';

/** One `categories` row as needed by the UI (status, competition day). */
export interface TournamentCategoryInfo {
  name: string;
  gender?: CategoryGender;
  status?: CategoryStatus;
  /** Competition day (1-based). Used for per-day leaderboards. */
  day?: number;
}

/** Admin-flagged match worth extra points if the user picks its actual winner. */
export interface GoldenMatch {
  category: string;
  matchId: string;
  points: number;
}

export type TournamentStatus = 'DRAFT' | 'LIVE' | 'UPCOMING' | 'COMPLETED' | 'SORTING';
export type CategoryStatus = 'open' | 'locked' | 'closed';

// Frontend Representation of a Tournament
export interface Tournament {
  id: string;
  name: string;
  location: string;
  date: string;
  status: TournamentStatus;
  completion?: number; // For player progress
  categories?: TournamentCategories;
  participantCount?: number; 
  roster?: Competitor[]; 
  brackets?: Record<string, Record<string, Competitor | null>>;
  // Configuration options (optional)
  scoring_configuration?: any; 
  /** From DB column `tournaments.golden_matches` (jsonb). */
  goldenMatches?: GoldenMatch[];
  picksLocked?: boolean;
}

export interface UserPicks {
  [matchId: string]: string; // matchId -> competitorId, plus 'additional_pick' -> competitorId
}

/** Final placement of one competitor in a category (1, 2, 3, 5, or 7). */
export interface CategoryStandings {
  position: number;
  competitorId: string;
  competitorName?: string;
  country?: string;
}

/** Score detail for one predicted position (gold, silver, or bronze). */
export interface PositionScoreDetail {
  competitorId: string;
  competitorName?: string;
  predicted: number;
  actual: number | null; // null if athlete didn't reach QF at all
  /** Rank-step distance over positions 1,2,3,5,7 (e.g. 3rd→5th = 1); 99 if no actual placement. */
  deviation: number;
  points: number;
}

/** Full scoring breakdown for one user/category pair. */
export interface ScoringBreakdown {
  goldSilver: PositionScoreDetail[];
  bronze: PositionScoreDetail[];
  poolFinals: { correct: number; total: number; points: number };
  additionalPick: { competitorId: string | null; actualPosition: number | null; points: number };
  /** Golden match lines (included in categoryTotal). Absent on legacy rows. */
  goldenLines?: GoldenMatchScoreLine[];
  categoryTotal: number;
}

/** Score line for one golden match. */
export interface GoldenMatchScoreLine {
  matchId: string;
  round?: string;
  label?: string;
  pickedId: string | null;
  pickedName?: string;
  winnerId: string | null;
  winnerName?: string;
  points: number;
}

/** One tournament-wide bonus rule line (stored on `tournament_scores` row `category = '_bonuses_'`). */
export interface BonusBreakdownLine {
  key: string;
  label: string;
  points: number;
  earned: boolean;
  detail?: string;
  /** 0–1 progress toward earning the bonus (for UI). */
  progressRatio?: number;
  /** Short label, e.g. "7/10" or "57%". */
  progressLabel?: string;
}

/** One slot in medal table scoring (`category = '_medal_table_'`). */
export interface MedalTableScoreLine {
  slot: number;
  country: string;
  predictedRank: number;
  actualRank: number | null;
  deviation: number;
  points: number;
}

export interface MedalTableScoreBreakdown {
  lines: MedalTableScoreLine[];
  categoryTotal: number;
  maxPossible: number;
}

/** Breakdown for the synthetic `_bonuses_` category row. */
export interface TournamentBonusBreakdown {
  bonusLines: BonusBreakdownLine[];
  categoryTotal: number;
}
