

import React, { useState, useEffect } from 'react';
import { ViewState, Tournament } from '../types';
import { 
  ChevronUp, ChevronDown, Minus, 
  Search, X, Trophy, TrendingUp, Star, History, Target, Loader2, ArrowLeft, Globe, BarChart3
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface LeaderboardProps {
  onNavigate: (view: ViewState) => void;
  userStats: any;
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

const Leaderboard: React.FC<LeaderboardProps> = ({ userStats, tournament, onNavigate }) => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardUser[]>([]);
  const [currentUserData, setCurrentUserData] = useState<LeaderboardUser | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<LeaderboardUser | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'global' | 'tournament'>(tournament ? 'tournament' : 'global');
  
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

  const fetchTournamentLeaderboard = async () => {
    if (!tournament?.id) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;

      const { data: scores, error } = await supabase
        .from('tournament_scores')
        .select('user_id, total_points, correct_picks, total_picks')
        .eq('tournament_id', tournament.id);

      if (error && error.code !== '42P01') throw error;

      // Aggregate scores across categories per user
      const userScoreMap = new Map<string, { total_points: number; correct_picks: number; total_picks: number }>();
      (scores || []).forEach((s: any) => {
        const existing = userScoreMap.get(s.user_id) || { total_points: 0, correct_picks: 0, total_picks: 0 };
        existing.total_points += s.total_points || 0;
        existing.correct_picks += s.correct_picks || 0;
        existing.total_picks += s.total_picks || 0;
        userScoreMap.set(s.user_id, existing);
      });

      const userIds = Array.from(userScoreMap.keys());
      if (userIds.length === 0) {
        setLeaderboardData([]);
        setCurrentUserData(null);
        setLoading(false);
        return;
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', userIds);

      const profileMap = new Map<string, any>();
      (profiles || []).forEach((p: any) => profileMap.set(p.id, p));

      const sorted = Array.from(userScoreMap.entries())
        .sort((a, b) => b[1].total_points - a[1].total_points);

      const mappedData: LeaderboardUser[] = sorted.map(([userId, score], index) => {
        const profile = profileMap.get(userId);
        const name = profile?.full_name || 'Anonymous Judoka';
        const isMe = userId === currentUserId;
        const accuracy = score.total_picks > 0
          ? Math.round((score.correct_picks / score.total_picks) * 100)
          : 0;

        return {
          id: userId,
          rank: index + 1,
          previousRank: index + 1,
          name,
          username: profile?.username || 'user',
          points: score.total_points,
          accuracy,
          avatar: profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
          isMe,
          perfectBrackets: 0,
          streak: [],
          countryCode: 'JP',
        };
      });

      setLeaderboardData(mappedData);
      setCurrentUserData(mappedData.find((u) => u.isMe) || null);
    } catch (err) {
      console.error('Error fetching tournament leaderboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchGlobalLeaderboard = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;

      const { data: topProfiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, points, daily_accuracy, avatar_url, previous_rank')
        .order('points', { ascending: false })
        .limit(100);

      if (error) throw error;

      let mappedData: LeaderboardUser[] = [];

      if (topProfiles) {
        mappedData = topProfiles.map((profile: any, index: number) => {
          const rank = index + 1;
          const name = profile.full_name || 'Anonymous Judoka';
          const isMe = profile.id === currentUserId;
          
          return {
            id: profile.id,
            rank,
            previousRank: profile.previous_rank || rank,
            name,
            username: profile.username || 'user',
            points: profile.points || 0,
            accuracy: profile.daily_accuracy || 0,
            avatar: profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
            isMe,
            perfectBrackets: 0,
            streak: ['W', 'L', 'W', 'W', 'L'],
            countryCode: 'JP'
          };
        });
        
        setLeaderboardData(mappedData);
      }

      if (currentUserId) {
        const meInTop = mappedData.find(u => u.isMe);
        
        if (meInTop) {
          setCurrentUserData(meInTop);
        } else {
          const { data: myProfile } = await supabase
            .from('profiles')
            .select('id, full_name, username, points, daily_accuracy, avatar_url, previous_rank')
            .eq('id', currentUserId)
            .single();

          if (myProfile) {
            const { count: rankCount } = await supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .gt('points', myProfile.points || 0);
            
            const realRank = (rankCount || 0) + 1;
            const myName = myProfile.full_name || 'Me';

            setCurrentUserData({
              id: myProfile.id,
              rank: realRank,
              previousRank: myProfile.previous_rank || realRank,
              name: myName,
              username: myProfile.username || 'user',
              points: myProfile.points || 0,
              accuracy: myProfile.daily_accuracy || 0,
              avatar: myProfile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(myName)}&background=random&color=fff`,
              isMe: true,
              perfectBrackets: 0,
              streak: ['L', 'W', 'W', 'L', 'W'],
              countryCode: 'JP'
            });
          }
        }
      }
    } catch (err) {
      console.error("Error fetching leaderboard:", err);
    } finally {
      setLoading(false);
    }
  };

  // Filter logic: Search by name OR username
  const filteredData = leaderboardData.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Logic for "My Rank" Bar - Usamos currentUserData en lugar de buscar en el array
  const myUser = currentUserData;
  
  // Para calcular a quién adelantar, buscamos en el array global si mi rango está cerca, 
  // o si estoy fuera del top 100, no mostramos rival específico.
  const userAbove = myUser && myUser.rank > 1 
      ? leaderboardData.find(u => u.rank === myUser.rank - 1) 
      : null;
      
  const pointsToOvertake = myUser && userAbove ? userAbove.points - myUser.points + 1 : 0;

  const getRankChangeIcon = (current: number, prev: number) => {
      const diff = prev - current; 
      if (diff > 0) return <div className="flex items-center text-[10px] text-green-600 font-bold bg-green-50 px-1 rounded"><ChevronUp size={10} /> {diff}</div>;
      if (diff < 0) return <div className="flex items-center text-[10px] text-red-500 font-bold bg-red-50 px-1 rounded"><ChevronDown size={10} /> {Math.abs(diff)}</div>;
      return <div className="text-slate-300"><Minus size={12} /></div>;
  };

  const top3 = leaderboardData.slice(0, 3);
  const showPodium = searchQuery === '' && top3.length >= 3;
  const listToRender = showPodium ? leaderboardData.slice(3) : filteredData;

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
               {viewMode === 'tournament' ? 'Rankings para este torneo' : 'Top predictors competing for the Black Belt.'}
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
                   Torneo
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

      {/* Main Content */}
      <div className="space-y-6">
        
        {/* Podium Section - Top 3 (Only visible when not searching) */}
        {showPodium && (
            <div className="bg-white pb-8 pt-4 px-4 rounded-3xl shadow-zen border border-slate-100 animate-fade-in-up stagger-1">
                <div className="flex justify-center items-end gap-2 sm:gap-4 max-w-md mx-auto">
                    {/* 2nd Place */}
                    <div 
                        onClick={() => setSelectedUser(top3[1])}
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
                        onClick={() => setSelectedUser(top3[0])}
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
                        onClick={() => setSelectedUser(top3[2])}
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
                listToRender.map((user, index) => (
                    <div 
                        key={user.id}
                        onClick={() => setSelectedUser(user)}
                        style={{ animationDelay: `${index * 50 + 150}ms` }}
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
                onClick={() => setSelectedUser(myUser)}
                className="size-10 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-full border border-slate-600 transition-colors"
            >
                <ChevronUp size={20} />
            </button>
        </div>
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0 md:zoom-in-95 duration-300 pb-6">
                
                {/* Modal Header */}
                <div className="relative h-24 bg-primary">
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#fff 2px, transparent 2px)', backgroundSize: '16px 16px' }}></div>
                    <button 
                        onClick={() => setSelectedUser(null)}
                        className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/30 text-white rounded-full transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="px-6 relative -mt-12 text-center">
                    <div className="inline-block relative">
                        <div className="size-24 rounded-full border-4 border-white shadow-lg overflow-hidden bg-white mx-auto">
                            <img src={selectedUser.avatar} className="w-full h-full object-cover" alt={selectedUser.name} />
                        </div>
                        <div className="absolute bottom-0 right-0 bg-slate-900 text-white text-xs font-black px-2 py-0.5 rounded-full border-2 border-white">
                            #{selectedUser.rank}
                        </div>
                    </div>
                    
                    <h2 className="text-xl font-black text-slate-900 mt-2">{selectedUser.name}</h2>
                    <p className="text-sm font-bold text-slate-400">@{selectedUser.username}</p> {/* Updated */}

                    <div className="flex items-center justify-center gap-2 mt-2 mb-6">
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
                             <div className="text-slate-400 text-[10px] font-bold uppercase mb-1">Form</div>
                             <div className="flex justify-center gap-0.5 h-5 items-center">
                                {selectedUser.streak.map((result, i) => (
                                    <div key={i} className={`w-1.5 h-4 rounded-full ${result === 'W' ? 'bg-green-500' : 'bg-red-300'}`}></div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {!selectedUser.isMe && (
                        <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100 text-left">
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