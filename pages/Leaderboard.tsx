

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ViewState,
  Tournament,
  ScoringBreakdown,
  TournamentBonusBreakdown,
  MedalTableScoreBreakdown,
  GoldenMatchScoreLine,
  PositionScoreDetail,
} from '../types';
import {
  ChevronUp, ChevronDown, Minus,
  Search, X, Trophy, TrendingUp, Star, History, Target, Loader2, ArrowLeft, Globe, BarChart3,
  CheckCircle2, XCircle, Eye, FastForward
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { calculateMyScore } from '../lib/scoringEngine';
import { buildDayRankings, dayOfCategory, aggregateRanking, CategoryDay } from '../lib/rankings';
import UserPicksViewer from '../components/UserPicksViewer';

/** Rank-step deviation label (positions 1→2→3→5→7). */
export const deviationLabel = (d: PositionScoreDetail): string =>
  d.actual == null || d.deviation >= 99
    ? 'no placement'
    : d.deviation === 0
      ? 'exact'
      : `${d.deviation} step${d.deviation === 1 ? '' : 's'} off`;

/** ★ Golden match lines for a category breakdown. */
export const GoldenLinesList: React.FC<{ lines?: GoldenMatchScoreLine[] }> = ({ lines }) => {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="pt-1 border-t border-slate-100">
      <p className="font-black text-amber-600 uppercase tracking-wider text-[10px] mb-1">Golden matches</p>
      <ul className="space-y-1">
        {lines.map((g) => (
          <li key={g.matchId} className="flex justify-between gap-2 text-[11px]">
            <span className="text-slate-700 truncate">
              <span className="text-amber-500">★</span> {g.label || g.round || 'Golden Match'}:{' '}
              <span className="text-slate-500">
                picked {g.pickedName || g.pickedId || '—'}, winner {g.winnerName || g.winnerId || 'TBD'}
              </span>
            </span>
            <span className={`font-black flex-shrink-0 ${g.points > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
              +{g.points} pts
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

type DayTab = 'total' | number;

/** Delay between revealed rows (ms), last place first. */
const REVEAL_STEP_MS = 400;

interface LeaderboardProps {
  onNavigate: (view: ViewState) => void;
  tournament?: Tournament | null;
}

interface LeaderboardUser {
  id: string;
  rank: number;
  previousRank: number;
  name: string;
  username: string; // Renamed from nickname
  points: number;
  avatar: string;
  isMe?: boolean;
  accuracy: number;
  perfectBrackets: number;
  streak: ('W' | 'L')[]; 
  recentAchievement?: string;
  countryCode?: string;
}

const Leaderboard: React.FC<LeaderboardProps> = ({ tournament, onNavigate }) => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardUser[]>([]);
  const [currentUserData, setCurrentUserData] = useState<LeaderboardUser | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<LeaderboardUser | null>(null);
  const [selectedUserBreakdown, setSelectedUserBreakdown] = useState<any[] | null>(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'global' | 'tournament'>(tournament ? 'tournament' : 'global');

  // Tournament view: raw score rows + category days, ranked client-side per tab
  const [tScoreRows, setTScoreRows] = useState<any[]>([]);
  const [tCategoryDays, setTCategoryDays] = useState<CategoryDay[]>([]);
  const [tProfiles, setTProfiles] = useState<Map<string, any>>(new Map());
  const [meId, setMeId] = useState<string | undefined>(undefined);
  const [dayTab, setDayTab] = useState<DayTab>('total');
  const defaultTabSetFor = useRef<string | null>(null);
  const [modalTab, setModalTab] = useState<'breakdown' | 'picks'>('breakdown');

  // Reveal animation: number of rows shown from the bottom; null = everything visible
  const [revealCount, setRevealCount] = useState<number | null>(null);

  useEffect(() => {
    if (tournament) setViewMode('tournament');
  }, [tournament]);

  useEffect(() => {
    if (viewMode === 'tournament' && tournament) {
      fetchTournamentLeaderboard();
    } else {
      fetchGlobalLeaderboard();
    }
  }, [viewMode, tournament?.id]);

  // Live refresh: window focus + realtime changes on tournament_scores
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (viewMode === 'tournament' && tournament?.id) fetchTournamentLeaderboard(true);
        else fetchGlobalLeaderboard(true);
      }, 800);
    };
    window.addEventListener('focus', refresh);
    const channel = supabase
      .channel(`leaderboard-${viewMode}-${tournament?.id ?? 'global'}-${Date.now()}`)
      .on(
        'postgres_changes',
        viewMode === 'tournament' && tournament?.id
          ? { event: '*', schema: 'public', table: 'tournament_scores', filter: `tournament_id=eq.${tournament.id}` }
          : { event: '*', schema: 'public', table: 'tournament_scores' },
        refresh
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      supabase.removeChannel(channel);
    };
  }, [viewMode, tournament?.id]);

  const fetchTournamentLeaderboard = async (silent = false, selfScored = false) => {
    if (!tournament?.id) return;
    if (!silent) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;
      setMeId(currentUserId);

      const [{ data: scores, error }, { data: cats }] = await Promise.all([
        supabase
          .from('tournament_scores')
          .select('user_id, category, total_points, correct_picks, total_picks')
          .eq('tournament_id', tournament.id),
        supabase.from('categories').select('name, day').eq('tournament_id', tournament.id),
      ]);

      if (error && error.code !== '42P01') throw error;

      const rows = scores || [];
      const userIds = Array.from(new Set(rows.map((s: any) => s.user_id as string)));
      if (userIds.length === 0) {
        // Fallback: trigger self-score calculation for current user so at least they appear (once)
        if (currentUserId && !selfScored) {
          const { data: myPicks } = await supabase
            .from('user_picks')
            .select('category, picks_data')
            .eq('tournament_id', tournament.id)
            .eq('user_id', currentUserId);
          if (myPicks && myPicks.length > 0) {
            await Promise.all(
              myPicks.map((p: any) =>
                calculateMyScore(tournament.id, p.category, currentUserId, p.picks_data, tournament.goldenMatches)
              )
            );
            // Retry fetch after self-scoring
            await fetchTournamentLeaderboard(silent, true);
            return;
          }
        }
        setTScoreRows([]);
        setTCategoryDays((cats || []) as CategoryDay[]);
        return;
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', userIds);

      const profileMap = new Map<string, any>();
      (profiles || []).forEach((p: any) => profileMap.set(p.id, p));

      const categoryDays = (cats || []) as CategoryDay[];
      setTProfiles(profileMap);
      setTCategoryDays(categoryDays);
      setTScoreRows(rows);

      // Default tab: latest competition day with scores (only on first load of this tournament)
      if (defaultTabSetFor.current !== tournament.id) {
        defaultTabSetFor.current = tournament.id;
        const { latestDay } = buildDayRankings(rows, categoryDays);
        setDayTab(latestDay ?? 'total');
      }
    } catch (err) {
      console.error('Error fetching tournament leaderboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const dayRankings = useMemo(() => buildDayRankings(tScoreRows, tCategoryDays), [tScoreRows, tCategoryDays]);
  const dayTabs = useMemo(
    () => Object.keys(dayRankings.byDay).map(Number).sort((a, b) => a - b),
    [dayRankings]
  );

  // Tournament rows for the active tab (ties share rank)
  const tournamentData: LeaderboardUser[] = useMemo(() => {
    const ranking = dayTab === 'total' ? dayRankings.total : dayRankings.byDay[dayTab] || [];
    const acc = new Map<string, { c: number; t: number }>();
    for (const r of tScoreRows) {
      if (dayTab !== 'total' && dayOfCategory(r.category, tCategoryDays) !== dayTab) continue;
      const a = acc.get(r.user_id) || { c: 0, t: 0 };
      a.c += r.correct_picks || 0;
      a.t += r.total_picks || 0;
      acc.set(r.user_id, a);
    }
    return ranking.map((r) => {
      const profile = tProfiles.get(r.userId);
      const name = profile?.full_name || 'Anonymous Judoka';
      const a = acc.get(r.userId);
      return {
        id: r.userId,
        rank: r.rank,
        previousRank: r.rank,
        name,
        username: profile?.username || 'user',
        points: r.points,
        accuracy: a && a.t > 0 ? Math.round((a.c / a.t) * 100) : 0,
        avatar: profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
        isMe: r.userId === meId,
        perfectBrackets: 0,
        streak: [],
        countryCode: 'JP',
      };
    });
  }, [dayTab, dayRankings, tScoreRows, tCategoryDays, tProfiles, meId]);

  const isTournamentView = viewMode === 'tournament' && !!tournament;
  const boardData = isTournamentView ? tournamentData : leaderboardData;

  // Reveal ticker: one more row every REVEAL_STEP_MS until all are visible
  useEffect(() => {
    if (revealCount === null) return;
    if (revealCount >= boardData.length) {
      const t = setTimeout(() => setRevealCount(null), REVEAL_STEP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealCount((c) => (c === null ? null : c + 1)), REVEAL_STEP_MS);
    return () => clearTimeout(t);
  }, [revealCount, boardData.length]);

  // Cancel reveal when switching view or tab
  useEffect(() => { setRevealCount(null); }, [viewMode, dayTab]);

  const ROUND_LABELS: Record<string, string> = {
    R1: 'Round 1', R2: 'Round 2', R3: 'Round 3',
    QF: 'Quarterfinals', REP: 'Repechage', SF: 'Semifinals',
    B: 'Bronze Medal', F: 'Final',
  };

  const ROUND_ORDER = ['R1', 'R2', 'R3', 'QF', 'REP', 'SF', 'B', 'F'];

  const isBonusBreakdown = (b: unknown): b is TournamentBonusBreakdown =>
    typeof b === 'object' &&
    b !== null &&
    'bonusLines' in b &&
    Array.isArray((b as TournamentBonusBreakdown).bonusLines);

  const isPositionBreakdown = (b: unknown): b is ScoringBreakdown =>
    typeof b === 'object' &&
    b !== null &&
    'goldSilver' in b &&
    Array.isArray((b as ScoringBreakdown).goldSilver);

  const isMedalTableBreakdown = (b: unknown): b is MedalTableScoreBreakdown =>
    typeof b === 'object' &&
    b !== null &&
    'lines' in b &&
    'maxPossible' in b &&
    Array.isArray((b as MedalTableScoreBreakdown).lines);

  const handleSelectUser = async (user: LeaderboardUser) => {
    setSelectedUser(user);
    setSelectedUserBreakdown(null);
    setModalTab('breakdown');
    if (viewMode === 'tournament' && tournament?.id) {
      setLoadingBreakdown(true);
      try {
        const { data } = await supabase
          .from('tournament_scores')
          .select('category, total_points, correct_picks, total_picks, breakdown')
          .eq('user_id', user.id)
          .eq('tournament_id', tournament.id)
          .order('category');
        setSelectedUserBreakdown(data || []);
      } catch {
        setSelectedUserBreakdown([]);
      } finally {
        setLoadingBreakdown(false);
      }
    }
  };

  const fetchGlobalLeaderboard = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;

      // Derive points live from tournament_scores so deleting a tournament
      // immediately reflects a lower (or zero) score without stale profile data.
      const { data: allScores } = await supabase
        .from('tournament_scores')
        .select('user_id, category, total_points');

      // Ties share a rank (1, 1, 3)
      const ranking = aggregateRanking(allScores || []);
      const userTotals = new Map<string, number>(ranking.map(r => [r.userId, r.points]));
      const rankOf = new Map<string, number>(ranking.map(r => [r.userId, r.rank]));

      // Take top 100
      const sorted = ranking.slice(0, 100).map(r => [r.userId, r.points] as [string, number]);

      if (sorted.length === 0) {
        setLeaderboardData([]);
        // Still show the current user at rank — with 0 points
        if (currentUserId) {
          const { data: myProfile } = await supabase
            .from('profiles')
            .select('id, full_name, username, avatar_url')
            .eq('id', currentUserId)
            .single();
          const myName = myProfile?.full_name || 'Me';
          setCurrentUserData({
            id: currentUserId, rank: 1, previousRank: 1, name: myName,
            username: myProfile?.username || 'user', points: 0, accuracy: 0,
            avatar: myProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(myName)}&background=random&color=fff`,
            isMe: true, perfectBrackets: 0, streak: [], countryCode: 'JP',
          });
        }
        setLoading(false);
        return;
      }

      const userIds = sorted.map(([id]) => id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, previous_rank')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      const mappedData: LeaderboardUser[] = sorted.map(([uid, totalPoints], index) => {
        const profile = profileMap.get(uid);
        const rank = rankOf.get(uid) ?? index + 1;
        const name = profile?.full_name || 'Anonymous Judoka';
        const isMe = uid === currentUserId;
        return {
          id: uid,
          rank,
          previousRank: profile?.previous_rank || rank,
          name,
          username: profile?.username || 'user',
          points: totalPoints,
          accuracy: 0,
          avatar: profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
          isMe,
          perfectBrackets: 0,
          streak: [],
          countryCode: 'JP',
        };
      });

      setLeaderboardData(mappedData);

      const meInTop = mappedData.find(u => u.isMe);
      if (meInTop) {
        setCurrentUserData(meInTop);
      } else if (currentUserId) {
        const myTotal = userTotals.get(currentUserId) || 0;
        const myRank = rankOf.get(currentUserId) ?? Array.from(userTotals.values()).filter(p => p > myTotal).length + 1;
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .eq('id', currentUserId)
          .single();
        const myName = myProfile?.full_name || 'Me';
        setCurrentUserData({
          id: currentUserId, rank: myRank, previousRank: myRank, name: myName,
          username: myProfile?.username || 'user', points: myTotal, accuracy: 0,
          avatar: myProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(myName)}&background=random&color=fff`,
          isMe: true, perfectBrackets: 0, streak: [], countryCode: 'JP',
        });
      }
    } catch (err) {
      console.error("Error fetching leaderboard:", err);
    } finally {
      setLoading(false);
    }
  };

  // Filter logic: Search by name OR username
  const isRevealing = revealCount !== null;
  const filteredData = isRevealing ? boardData : boardData.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // "My Rank" bar: tournament view derives it from the active tab
  const myUser = isTournamentView ? (tournamentData.find(u => u.isMe) || null) : currentUserData;

  // Closest user with more points (ties share a rank, so look by points, not rank - 1).
  // Outside the top 100 in global view, no specific rival is shown.
  const userAbove = myUser && myUser.rank > 1
      ? [...boardData].reverse().find(u => u.points > myUser.points) || null
      : null;

  const pointsToOvertake = myUser && userAbove ? userAbove.points - myUser.points + 1 : 0;

  const getRankChangeIcon = (current: number, prev: number) => {
      const diff = prev - current; 
      if (diff > 0) return <div className="flex items-center text-[10px] text-green-600 font-bold bg-green-50 px-1 rounded"><ChevronUp size={10} /> {diff}</div>;
      if (diff < 0) return <div className="flex items-center text-[10px] text-red-500 font-bold bg-red-50 px-1 rounded"><ChevronDown size={10} /> {Math.abs(diff)}</div>;
      return <div className="text-slate-300"><Minus size={12} /></div>;
  };

  const top3 = boardData.slice(0, 3);
  const showPodium = !isRevealing && searchQuery === '' && top3.length >= 3;
  const listToRender = showPodium ? boardData.slice(3) : filteredData;
  /** During reveal, row i (0 = 1st) is visible once the last `revealCount` rows are shown. */
  const isRowHidden = (index: number) => isRevealing && index < boardData.length - (revealCount as number);

  if (loading) {
      return (
          <div className="flex flex-col h-full items-center justify-center p-8 text-slate-400">
              <Loader2 size={40} className="animate-spin mb-4 text-primary" />
              <p className="font-bold">Calculating Ranks...</p>
          </div>
      );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8 relative">
      
      {/* Header with Active Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 animate-fade-in-up">
         <div>
             <div className="flex items-center gap-3">
               {tournament && (
                 <button onClick={() => onNavigate('BRACKET')} className="p-2 hover:bg-slate-100 rounded-full">
                   <ArrowLeft size={20} />
                 </button>
               )}
               <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                 {viewMode === 'tournament' && tournament ? tournament.name : 'World Rankings'}
               </h1>
             </div>
             <p className="text-slate-500 font-medium mt-2">
               {viewMode === 'tournament' ? 'Rankings for this tournament' : 'Top predictors competing for the Black Belt.'}
             </p>
             {tournament && (
               <div className="flex mt-3 bg-slate-100 rounded-lg p-1 w-fit">
                 <button
                   onClick={() => setViewMode('tournament')}
                   className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-1.5 ${
                     viewMode === 'tournament' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                   }`}
                 >
                   <BarChart3 size={14} />
                   Tournament
                 </button>
                 <button
                   onClick={() => setViewMode('global')}
                   className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-1.5 ${
                     viewMode === 'global' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                   }`}
                 >
                   <Globe size={14} />
                   Global
                 </button>
               </div>
             )}
             {isTournamentView && (
               <div className="flex flex-wrap items-center gap-2 mt-3">
                 <div className="flex bg-slate-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
                   {(['total', ...dayTabs] as DayTab[]).map(tab => (
                     <button
                       key={String(tab)}
                       onClick={() => setDayTab(tab)}
                       className={`px-3 py-1.5 rounded-md text-sm font-bold transition-colors whitespace-nowrap ${
                         dayTab === tab ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                       }`}
                     >
                       {tab === 'total' ? 'Total' : `Day ${tab}`}
                     </button>
                   ))}
                 </div>
                 {boardData.length > 0 && (
                   isRevealing ? (
                     <button
                       onClick={() => setRevealCount(null)}
                       className="px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                     >
                       <FastForward size={14} /> Skip
                     </button>
                   ) : (
                     <button
                       onClick={() => { setSearchQuery(''); setRevealCount(0); }}
                       className="px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 bg-primary text-white hover:opacity-90"
                     >
                       <Eye size={14} /> Reveal
                     </button>
                   )
                 )}
               </div>
             )}
         </div>
         
         {/* Search Input */}
         <div className="relative w-full md:w-80 group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                <Search size={18} />
            </div>
            <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or username..." // Updated placeholder
                className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
            />
            {searchQuery && (
                <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                    <X size={16} />
                </button>
            )}
         </div>
      </div>

      {/* Preview banner — shown when tournament scores are not yet final */}
      {viewMode === 'tournament' && tournament && tournament.status?.toUpperCase() !== 'COMPLETED' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm font-medium">
          <span className="shrink-0 bg-amber-200 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">Preview</span>
          Scores shown are estimates — not all categories have been finalized yet. Final scores may change.
        </div>
      )}

      {/* Main Content */}
      <div className="space-y-6">

        {/* Podium Section - Top 3 (Only visible when not searching) */}
        {showPodium && (
            <div className="bg-white pb-8 pt-4 px-4 rounded-3xl shadow-zen border border-slate-100 animate-fade-in-up stagger-1">
                <div className="flex justify-center items-end gap-2 sm:gap-4 max-w-md mx-auto">
                    {/* 2nd Place */}
                    <div 
                        onClick={() => handleSelectUser(top3[1])}
                        className="flex flex-col items-center cursor-pointer group w-1/3"
                    >
                         <div className="relative mb-2 transition-transform group-hover:-translate-y-1">
                            <div className="size-16 sm:size-20 rounded-full border-4 border-slate-200 shadow-lg overflow-hidden relative z-10 bg-slate-100">
                                <img src={top3[1].avatar} className="w-full h-full object-cover" />
                            </div>
                            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-slate-200 text-slate-600 text-xs font-black px-2 py-0.5 rounded-md shadow-sm border border-white z-20">
                                #2
                            </div>
                         </div>
                         <p className="font-bold text-slate-900 text-sm text-center line-clamp-1 w-full px-1">{top3[1].name}</p>
                         <p className="text-[10px] font-bold text-slate-400 text-center">@{top3[1].username}</p> {/* Updated */}
                         <p className="text-xs font-medium text-slate-500 mt-1">{top3[1].points}</p>
                    </div>

                    {/* 1st Place */}
                    <div 
                        onClick={() => handleSelectUser(top3[0])}
                        className="flex flex-col items-center cursor-pointer group w-1/3 -mt-4"
                    >
                         <div className="relative mb-3 transition-transform group-hover:-translate-y-1">
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-yellow-400 animate-bounce">
                                <Trophy size={24} fill="currentColor" />
                            </div>
                            <div className="size-20 sm:size-24 rounded-full border-4 border-yellow-400 shadow-gold overflow-hidden relative z-10 ring-4 ring-yellow-100 bg-slate-100">
                                <img src={top3[0].avatar} className="w-full h-full object-cover" />
                            </div>
                            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 text-sm font-black px-3 py-0.5 rounded-md shadow-sm border border-white z-20">
                                #1
                            </div>
                         </div>
                         <p className="font-bold text-slate-900 text-base text-center line-clamp-1 w-full px-1">{top3[0].name}</p>
                         <p className="text-[10px] font-bold text-slate-400 text-center">@{top3[0].username}</p> {/* Updated */}
                         <p className="text-xs font-bold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full mt-1">{top3[0].points} pts</p>
                    </div>

                    {/* 3rd Place */}
                    <div 
                        onClick={() => handleSelectUser(top3[2])}
                        className="flex flex-col items-center cursor-pointer group w-1/3"
                    >
                         <div className="relative mb-2 transition-transform group-hover:-translate-y-1">
                            <div className="size-16 sm:size-20 rounded-full border-4 border-orange-200 shadow-lg overflow-hidden relative z-10 bg-slate-100">
                                <img src={top3[2].avatar} className="w-full h-full object-cover" />
                            </div>
                            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-orange-200 text-orange-800 text-xs font-black px-2 py-0.5 rounded-md shadow-sm border border-white z-20">
                                #3
                            </div>
                         </div>
                         <p className="font-bold text-slate-900 text-sm text-center line-clamp-1 w-full px-1">{top3[2].name}</p>
                         <p className="text-[10px] font-bold text-slate-400 text-center">@{top3[2].username}</p> {/* Updated */}
                         <p className="text-xs font-medium text-slate-500 mt-1">{top3[2].points}</p>
                    </div>
                </div>
            </div>
        )}

        {/* List Section - Compact */}
        <div className="max-w-4xl mx-auto space-y-3 pb-24">
            {listToRender.length > 0 ? (
                listToRender.map((user, index) => isRowHidden(index) ? (
                    <div
                        key={user.id}
                        className="flex items-center p-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60"
                    >
                        <div className="w-8 font-black text-slate-300 text-sm text-center">?</div>
                        <div className="size-10 rounded-full bg-slate-200/70 mr-4" />
                        <div className="flex-1 h-3 rounded bg-slate-200/70 max-w-[10rem]" />
                    </div>
                ) : (
                    <div
                        key={user.id}
                        onClick={() => handleSelectUser(user)}
                        style={{ animationDelay: isRevealing ? '0ms' : `${index * 50 + 150}ms` }}
                        className={`flex items-center p-4 rounded-2xl border bg-white shadow-sm transition-all active:scale-[0.99] cursor-pointer opacity-0 animate-fade-in-up
                            ${user.isMe ? 'border-primary/50 bg-blue-50/30' : 'border-slate-100 hover:border-slate-300'}
                        `}
                    >
                        <div className="w-8 font-black text-slate-400 text-sm text-center">{user.rank}</div>
                        
                        <div className="relative mr-4">
                            <img src={user.avatar} className="size-10 rounded-full object-cover border border-slate-100 bg-slate-100" />
                            {user.rank < user.previousRank && (
                                <div className="absolute -top-1 -right-1 bg-green-500 border-2 border-white rounded-full p-0.5">
                                    <TrendingUp size={8} className="text-white" />
                                </div>
                            )}
                        </div>
                        
                        <div className="flex-1 min-w-0 mr-2">
                            <div className="flex items-center gap-1.5">
                                <p className={`text-sm font-bold truncate ${user.isMe ? 'text-primary' : 'text-slate-900'}`}>
                                    {user.name} {user.isMe && '(You)'}
                                </p>
                                {user.perfectBrackets > 0 && <Star size={10} className="text-yellow-400 fill-current" />}
                            </div>
                            <p className="text-[10px] font-bold text-slate-400">@{user.username}</p> {/* Updated */}
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col items-end hidden sm:flex">
                                <div className="flex items-center gap-1">
                                    {getRankChangeIcon(user.rank, user.previousRank)}
                                </div>
                                <span className="text-[10px] text-slate-400">{user.accuracy}% Acc</span>
                            </div>

                            <div className="text-right w-16">
                                <p className="font-mono font-bold text-slate-900 text-base">{user.points}</p>
                                <p className="text-[10px] text-slate-400 uppercase tracking-wide">PTS</p>
                            </div>
                        </div>
                    </div>
                ))
            ) : (
                <div className="text-center py-12 opacity-50">
                    <p className="text-slate-500 font-bold">No judokas found</p>
                </div>
            )}
        </div>
      </div>

      {/* Sticky "Me" Bar - CENTERED (Using currentUserData) */}
      {myUser && (
        <div className="fixed bottom-6 w-[calc(100%-32px)] max-w-lg left-1/2 -translate-x-1/2 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between border border-slate-700 z-30 animate-in slide-in-from-bottom-5">
            <div className="flex items-center gap-4">
                <div className="flex flex-col items-center bg-slate-800 rounded-lg px-3 py-1.5 min-w-[3.5rem]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Rank</span>
                    <span className="text-xl font-black text-white leading-none">{myUser.rank}</span>
                </div>
                <div className="flex flex-col">
                    <p className="text-sm font-bold text-white leading-tight">Your Performance</p>
                    {userAbove ? (
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <Target size={10} className="text-primary" />
                            <span><span className="text-white font-mono">{pointsToOvertake}pts</span> to beat {userAbove.username}</span> {/* Updated */}
                        </p>
                    ) : (
                        <p className="text-[10px] text-gold">{myUser.rank === 1 ? 'Current Leader!' : 'Keep pushing!'}</p>
                    )}
                </div>
            </div>
            <button 
                onClick={() => handleSelectUser(myUser)}
                className="size-10 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-full border border-slate-600 transition-colors"
            >
                <ChevronUp size={20} />
            </button>
        </div>
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => { setSelectedUser(null); setSelectedUserBreakdown(null); }}
        >
            <div
              className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0 md:zoom-in-95 duration-300"
              onClick={e => e.stopPropagation()}
            >
                
                {/* Modal Header — avatar lives here so it's never clipped by the scroll container */}
                <div className="relative bg-primary pt-4 pb-14">
                    {/* pointer-events-none: decorative overlay must never block clicks */}
                    <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 2px, transparent 2px)', backgroundSize: '16px 16px' }}></div>
                    <button 
                        onClick={() => { setSelectedUser(null); setSelectedUserBreakdown(null); }}
                        className="absolute top-4 right-4 z-20 p-2 bg-black/20 hover:bg-black/30 text-white rounded-full transition-colors"
                    >
                        <X size={16} />
                    </button>
                    {/* Avatar centered, sitting on the header/body boundary */}
                    <div className="flex flex-col items-center relative z-10">
                        <div className="relative">
                            <div className="size-24 rounded-full border-4 border-white shadow-lg overflow-hidden bg-white">
                                <img src={selectedUser.avatar} className="w-full h-full object-cover" alt={selectedUser.name} />
                            </div>
                            <div className="absolute bottom-0 right-0 bg-slate-900 text-white text-xs font-black px-2 py-0.5 rounded-full border-2 border-white">
                                #{selectedUser.rank}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-y-auto max-h-[65vh] pb-6">
                  <div className="px-6 pt-3 text-center">
                      <h2 className="text-xl font-black text-slate-900">{selectedUser.name}</h2>
                      <p className="text-sm font-bold text-slate-400">@{selectedUser.username}</p>

                      <div className="flex items-center justify-center gap-2 mt-2 mb-4">
                          <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              {selectedUser.points} PTS
                          </span>
                          {selectedUser.rank < selectedUser.previousRank && (
                              <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <TrendingUp size={10} /> +{selectedUser.previousRank - selectedUser.rank}
                              </span>
                          )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                              <div className="text-slate-400 text-[10px] font-bold uppercase mb-1">Accuracy</div>
                              <div className="text-xl font-black text-slate-900">{selectedUser.accuracy}%</div>
                          </div>
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                               <div className="text-slate-400 text-[10px] font-bold uppercase mb-1">Total Points</div>
                               <div className="text-xl font-black text-primary">{selectedUser.points}</div>
                          </div>
                      </div>
                  </div>

                  {/* Score breakdown — only in tournament mode */}
                  {isTournamentView && (
                    <div className="px-6 mb-3">
                      <div className="flex bg-slate-100 rounded-lg p-1">
                        {(['breakdown', 'picks'] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => setModalTab(t)}
                            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                              modalTab === t ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
                            }`}
                          >
                            {t === 'breakdown' ? 'Breakdown' : 'Picks'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {isTournamentView && modalTab === 'picks' && (
                    <div className="px-6">
                      <UserPicksViewer
                        tournamentId={tournament!.id}
                        userId={selectedUser.id}
                        hasRepechage={!!tournament?.scoring_configuration?.has_repechage}
                        picksLocked={!!tournament?.picksLocked}
                      />
                    </div>
                  )}
                  {viewMode === 'tournament' && modalTab === 'breakdown' && (
                    <div className="px-6">
                      {loadingBreakdown ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-slate-400">
                          <Loader2 size={16} className="animate-spin" />
                          <span className="text-xs font-bold">Loading breakdown...</span>
                        </div>
                      ) : selectedUserBreakdown && selectedUserBreakdown.length > 0 ? (
                        <div className="space-y-3">
                          <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider text-left">
                            Score Breakdown
                          </h4>
                          {selectedUserBreakdown.map((catScore: any) => {
                            const rawBreakdown = catScore.breakdown;
                            const accuracy = catScore.total_picks > 0
                              ? Math.round((catScore.correct_picks / catScore.total_picks) * 100)
                              : 0;
                            const categoryTitle =
                              catScore.category === '_medal_table_men_'
                                ? 'Medal table (Men)'
                                : catScore.category === '_medal_table_women_'
                                  ? 'Medal table (Women)'
                                  : (catScore.category === '_medal_table_total_' || catScore.category === '_medal_table_')
                                    ? 'Medal table (Total)'
                                    : catScore.category === '_bonuses_'
                                      ? 'Tournament bonuses'
                                      : catScore.category;

                            if (isBonusBreakdown(rawBreakdown)) {
                              const bb = rawBreakdown;
                              return (
                                <div key={catScore.category} className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden text-left">
                                  <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-100">
                                    <span className="text-xs font-black text-slate-800 truncate">{categoryTitle}</span>
                                    <span className="text-xs font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                                      {catScore.total_points} pts
                                    </span>
                                  </div>
                                  <ul className="divide-y divide-slate-100 px-3 py-2 space-y-2 text-[11px]">
                                    {bb.bonusLines.map((line) => (
                                      <li key={line.key} className="pt-1 first:pt-0">
                                        <div className="flex justify-between gap-2 items-start">
                                          <span className="font-bold text-slate-700">{line.label}</span>
                                          <span
                                            className={`font-black flex-shrink-0 ${
                                              line.earned ? 'text-green-600' : 'text-slate-400'
                                            }`}
                                          >
                                            {line.points > 0 ? `+${line.points}` : line.earned ? '0' : '0'} pts
                                          </span>
                                        </div>
                                        {line.progressLabel && (
                                          <p className="text-[10px] text-indigo-600 font-bold mt-1">
                                            Progress: {line.progressLabel}
                                            {typeof line.progressRatio === 'number'
                                              ? ` (${Math.round(line.progressRatio * 100)}%)`
                                              : ''}
                                          </p>
                                        )}
                                        {typeof line.progressRatio === 'number' && (
                                          <div className="h-1.5 bg-slate-100 rounded mt-1 overflow-hidden">
                                            <div
                                              className="h-full bg-indigo-400 rounded"
                                              style={{
                                                width: `${Math.min(100, Math.round(line.progressRatio * 100))}%`,
                                              }}
                                            />
                                          </div>
                                        )}
                                        {line.detail && (
                                          <p className="text-[10px] text-slate-500 mt-1 leading-snug">{line.detail}</p>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                  <div className="px-3 pb-2 flex justify-between border-t border-slate-200 pt-2">
                                    <span className="font-black text-slate-600 text-[11px]">Bonus total</span>
                                    <span className="font-black text-primary text-[11px]">{bb.categoryTotal} pts</span>
                                  </div>
                                </div>
                              );
                            }

                            if (isMedalTableBreakdown(rawBreakdown)) {
                              const mt = rawBreakdown;
                              const pct =
                                mt.maxPossible > 0 ? Math.round((mt.categoryTotal / mt.maxPossible) * 100) : 0;
                              return (
                                <div
                                  key={catScore.category}
                                  className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden text-left"
                                >
                                  <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 border-b border-indigo-100">
                                    <span className="text-xs font-black text-slate-800 truncate">{categoryTitle}</span>
                                    <span className="text-xs font-black text-indigo-800 bg-indigo-100 px-2 py-0.5 rounded-full">
                                      {catScore.total_points} pts
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-600 px-3 pt-2">
                                    {mt.categoryTotal}/{mt.maxPossible} possible ({pct}%)
                                  </p>
                                  <ul className="divide-y divide-slate-100 px-3 py-2 space-y-1 text-[11px]">
                                    {mt.lines.map((line) => (
                                      <li key={`${line.slot}-${line.country}`} className="py-1 flex justify-between gap-2">
                                        <span className="text-slate-700">
                                          {line.slot}° {line.country} → act.{' '}
                                          {line.actualRank != null ? `${line.actualRank}°` : '—'} (Δ{line.deviation})
                                        </span>
                                        <span className="text-green-600 font-black flex-shrink-0">{line.points} pts</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            }

                            if (catScore.category === '_bonuses_' && rawBreakdown && typeof rawBreakdown === 'object' && !isBonusBreakdown(rawBreakdown)) {
                              const legTot = (rawBreakdown as { categoryTotal?: number }).categoryTotal ?? catScore.total_points;
                              return (
                                <div key={catScore.category} className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden text-left px-3 py-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-black text-slate-800">{categoryTitle}</span>
                                    <span className="text-xs font-black text-primary">{legTot} pts</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-1">
                                    Detailed bonus lines are available after the next full score calculation.
                                  </p>
                                </div>
                              );
                            }

                            if (isPositionBreakdown(rawBreakdown)) {
                              const b = rawBreakdown;
                              return (
                                <div key={catScore.category} className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden text-left">
                                  <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-slate-100">
                                    <span className="text-xs font-black text-slate-800 truncate">{categoryTitle}</span>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                      <span className="text-[10px] text-slate-500 font-medium">
                                        {catScore.correct_picks}/{catScore.total_picks} ({accuracy}%)
                                      </span>
                                      <span className="text-xs font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                        {catScore.total_points} pts
                                      </span>
                                    </div>
                                  </div>
                                  <div className="px-3 py-2 space-y-3 text-[11px]">
                                    {b.goldSilver.length > 0 && (
                                      <div>
                                        <p className="font-black text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                                          Gold / Silver
                                        </p>
                                        <ul className="space-y-1.5">
                                          {b.goldSilver.map((d) => (
                                            <li key={`gs-${d.competitorId}-${d.predicted}`} className="flex justify-between gap-2">
                                              <span className="text-slate-700 font-semibold truncate">
                                                {d.competitorName || d.competitorId}
                                                <span className="text-slate-400 font-normal">
                                                  {' '}
                                                  pred {d.predicted}° → act {d.actual ?? '—'} ({deviationLabel(d)})
                                                </span>
                                              </span>
                                              <span className="text-green-600 font-black flex-shrink-0">{d.points} pts</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {b.bronze.length > 0 && (
                                      <div>
                                        <p className="font-black text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                                          Bronze
                                        </p>
                                        <ul className="space-y-1.5">
                                          {b.bronze.map((d) => (
                                            <li key={`br-${d.competitorId}`} className="flex justify-between gap-2">
                                              <span className="text-slate-700 font-semibold truncate">
                                                {d.competitorName || d.competitorId}
                                                <span className="text-slate-400 font-normal">
                                                  {' '}
                                                  pred {d.predicted}° → act {d.actual ?? '—'} ({deviationLabel(d)})
                                                </span>
                                              </span>
                                              <span className="text-green-600 font-black flex-shrink-0">{d.points} pts</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    <div className="pt-1 border-t border-slate-100">
                                      <div className="flex justify-between items-center">
                                        <span className="text-slate-500 font-bold">Pool finals (QF)</span>
                                        <span className="font-black text-slate-800">
                                          {b.poolFinals.correct}/{b.poolFinals.total} — {b.poolFinals.points} pts
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                                        1 pt per athlete you picked who actually reached the quarter-finals (up to 8
                                        athletes). Missing slots mean either wrong athletes or incomplete bracket picks.
                                      </p>
                                    </div>
                                    <div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-slate-500 font-bold">Additional pick (underdog)</span>
                                        <span className="font-black text-slate-800">
                                          {b.additionalPick.points} pts
                                          {b.additionalPick.actualPosition != null && (
                                            <span className="text-slate-400 font-medium">
                                              {' '}
                                              (finished {b.additionalPick.actualPosition === 1 ? '1st' : `${b.additionalPick.actualPosition}th`})
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                                        Points only if this athlete finishes in the top 7 <strong>and</strong> was not one
                                        of your predicted medalists. {b.additionalPick.points === 0 && b.additionalPick.competitorId
                                          ? 'No points: overlapped medal picks, or athlete placed outside top 7.'
                                          : ''}
                                      </p>
                                    </div>
                                    <GoldenLinesList lines={b.goldenLines} />
                                    <div className="flex justify-between items-center border-t border-slate-200 pt-2">
                                      <span className="font-black text-slate-600">Category total</span>
                                      <span className="font-black text-primary">{b.categoryTotal} pts</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            const breakdown: Record<string, { correct: boolean; points: number; round?: string }> =
                              rawBreakdown && typeof rawBreakdown === 'object' && !Array.isArray(rawBreakdown)
                                ? rawBreakdown
                                : {};
                            const byRound: Record<string, { correct: number; total: number; points: number }> = {};
                            for (const entry of Object.values(breakdown)) {
                              if (!entry || typeof entry !== 'object') continue;
                              const r = (entry as { round?: string }).round || 'R1';
                              if (!byRound[r]) byRound[r] = { correct: 0, total: 0, points: 0 };
                              byRound[r].total++;
                              if ((entry as { correct?: boolean }).correct) {
                                byRound[r].correct++;
                                byRound[r].points += (entry as { points?: number }).points || 0;
                              }
                            }
                            return (
                              <div key={catScore.category} className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                                <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-slate-100">
                                  <span className="text-xs font-black text-slate-800 truncate">{categoryTitle}</span>
                                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                    <span className="text-[10px] text-slate-500 font-medium">
                                      {catScore.correct_picks}/{catScore.total_picks} ({accuracy}%)
                                    </span>
                                    <span className="text-xs font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                      {catScore.total_points} pts
                                    </span>
                                  </div>
                                </div>
                                <div className="divide-y divide-slate-100">
                                  {ROUND_ORDER.filter(r => byRound[r]).map(r => {
                                    const rd = byRound[r];
                                    const allCorrect = rd.correct === rd.total;
                                    const noneCorrect = rd.correct === 0;
                                    return (
                                      <div key={r} className="flex items-center justify-between px-3 py-1.5">
                                        <div className="flex items-center gap-2">
                                          {allCorrect ? (
                                            <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                                          ) : noneCorrect ? (
                                            <XCircle size={13} className="text-red-400 flex-shrink-0" />
                                          ) : (
                                            <div className="size-3 rounded-full border-2 border-yellow-400 flex-shrink-0" />
                                          )}
                                          <span className="text-[11px] font-bold text-slate-600">
                                            {ROUND_LABELS[r] || r}
                                          </span>
                                          <span className="text-[10px] text-slate-400">
                                            {rd.correct}/{rd.total}
                                          </span>
                                        </div>
                                        <span className={`text-[11px] font-black ${rd.points > 0 ? 'text-green-600' : 'text-slate-300'}`}>
                                          {rd.points > 0 ? `+${rd.points}` : '0'} pts
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : selectedUserBreakdown !== null ? (
                        <div className="text-center py-3 text-slate-400 text-xs">
                          No score data available yet for this tournament.
                        </div>
                      ) : null}
                    </div>
                  )}

                  {!selectedUser.isMe && viewMode !== 'tournament' && (
                    <div className="mx-6 bg-blue-50/50 rounded-xl p-3 border border-blue-100 text-left">
                        <h4 className="flex items-center gap-1.5 font-bold text-primary text-xs mb-1">
                            <History size={12} />
                            <span>Rivalry Intel</span>
                        </h4>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            {selectedUser.name} is ranked #{selectedUser.rank} in the world. Predict better than them in the next Grand Slam!
                        </p>
                    </div>
                  )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Leaderboard;