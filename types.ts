
export interface Competitor {
  id: string;
  name: string;
  country: string;
  flagUrl: string;
  rank: number | string; // Modified to allow text based ranks
  sex?: 'M' | 'F';      // From Excel Column A
  weight?: string;      // From Excel Column B
}

export interface Match {
  id: string;
  round: string; // Changed from specific union to string to allow dynamic rounds (e.g. R1, R2)
  pool?: string;
  matchNumber: number;
  competitor1: Competitor | null;
  competitor2: Competitor | null;
  winnerId: string | null;
  nextMatchId?: string;
  nextMatchSlot?: 1 | 2; // 1 for top slot, 2 for bottom slot
}

export type ViewState = 'LOGIN' | 'FORGOT_PASSWORD' | 'UPDATE_PASSWORD' | 'HOME' | 'TOURNAMENTS' | 'CREATE_TOURNAMENT' | 'SCORING_RULES' | 'MANAGE_ROSTER' | 'BUILD_BRACKET' | 'BRACKET' | 'ROSTER' | 'LEADERBOARD' | 'TOURNAMENT_LEADERBOARD' | 'TOURNAMENT_RESULTS' | 'PROFILE';

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
}

export type TournamentStatus = 'DRAFT' | 'LIVE' | 'UPCOMING' | 'COMPLETED' | 'SORTING';

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
}

export interface UserPicks {
  [matchId: string]: string; // matchId -> competitorId
}
