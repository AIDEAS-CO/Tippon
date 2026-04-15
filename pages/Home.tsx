
import React, { useEffect, useState } from 'react';
import { 
  ArrowRight, Trophy, Zap, Calendar, 
  Activity, TrendingUp, ChevronRight, Plus 
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { ViewState, Tournament, UserProfile } from '../types';
import Button from '../components/ui/Button';
import Flag from '../components/ui/Flag';

interface HomeProps {
    onNavigate: (view: ViewState) => void;
    onSelectTournament: (t: Tournament) => void;
    userProfile: UserProfile | null;
    userRole?: string;
    tournaments?: Tournament[]; // NEW: Accept global tournaments
}

const Home: React.FC<HomeProps> = ({ onNavigate, onSelectTournament, userProfile, userRole, tournaments = [] }) => {
  const [loading, setLoading] = useState(true);
  /** Sum of tournament_scores — source of truth (profiles.points can be stale after tournament deletes) */
  const [seasonPointsLive, setSeasonPointsLive] = useState<number | null>(null);
  
  // Use global prop for source of truth with robust fallbacks
  const userName = userProfile?.username || userProfile?.full_name?.split(' ')[0] || 'Judoka';
                   
  const isAdmin = userRole === 'ADMIN' || userProfile?.role?.toLowerCase() === 'admin';
  
  // Derived state from props
  const [heroTournament, setHeroTournament] = useState<Tournament | null>(null);
  const [upcomingTournaments, setUpcomingTournaments] = useState<Tournament[]>([]);
  const [featuredJudokas, setFeaturedJudokas] = useState<any[]>([]);

  // Effect to process tournaments passed from App.tsx
  useEffect(() => {
    if (tournaments.length > 0) {
        // 1. HERO TOURNAMENT: Most recent created (or logic for 'Active')
        // Using the first one from the list (which is sorted by created_at desc in App.tsx)
        const t = tournaments[0];
        setHeroTournament(t);

        // 2. UPCOMING LIST: Next 3 tournaments (excluding the hero if you want, or just next 3 sorted by date)
        // Sort by start_date ascending for the "Upcoming" list
        const sortedByDate = [...tournaments]
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .filter(t => new Date(t.date).getTime() >= new Date().setHours(0,0,0,0)); // Only future/today

        setUpcomingTournaments(sortedByDate.slice(0, 3));
    }
  }, [tournaments]);

  // Fetch Featured Judokas (Rank 1-3 from Rosters)
  useEffect(() => {
    const fetchTopJudokas = async () => {
      setLoading(true);
      try {
         // Query tournament_roster for high ranking athletes
         // Assuming world_rank is numeric based on previous imports
         const { data, error } = await supabase
           .from('tournament_roster')
           .select('*')
           .lte('world_rank', 3) 
           .order('world_rank', { ascending: true })
           .limit(10);

         if (error) throw error;
         
         // Basic deduplication by name (simple approach for MVP)
         const uniqueJudokas = [];
         const seenNames = new Set();
         if (data) {
             for (const j of data) {
                 const fullName = `${j.first_name} ${j.last_name}`;
                 if (!seenNames.has(fullName)) {
                     seenNames.add(fullName);
                     uniqueJudokas.push(j);
                 }
             }
         }
         
         setFeaturedJudokas(uniqueJudokas.slice(0, 5)); // Take top 5 unique

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTopJudokas();
  }, []);

  useEffect(() => {
    const uid = userProfile?.id;
    if (!uid) {
      setSeasonPointsLive(0);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('tournament_scores')
        .select('total_points')
        .eq('user_id', uid);
      if (error) {
        setSeasonPointsLive(userProfile?.points ?? 0);
        return;
      }
      const sum = (data || []).reduce((acc, row) => acc + (row.total_points || 0), 0);
      setSeasonPointsLive(sum);
    })();
  }, [userProfile?.id, userProfile?.points]);

  const handleManagePredictions = () => {
    if (heroTournament) {
        onSelectTournament(heroTournament);
        const status = heroTournament.status?.toUpperCase();
        if (status === 'DRAFT' || status === 'UPCOMING' || status === 'COMING_SOON') {
            onNavigate('ROSTER');
        } else {
            onNavigate('BRACKET'); 
        }
    }
  };
  
  // --- DATE HELPERS (SAFE PARSE) ---
  const getSafeDateObj = (dateString: string | undefined) => {
      if (!dateString) return null;
      const parts = dateString.split('T')[0].split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      return new Date(year, month - 1, day);
  };

  const formatHeroDate = (dateString: string | undefined) => {
      const date = getSafeDateObj(dateString);
      if (!date) return '';
      // Full date string (e.g. 15/10/2024 or local equivalent)
      return date.toLocaleDateString();
  };
  
  const getUpcomingDateParts = (dateString: string | undefined) => {
      const date = getSafeDateObj(dateString);
      if (!date) return { day: '?', month: '-' };
      return {
          day: date.getDate(),
          month: date.toLocaleDateString('default', { month: 'short' })
      };
  };

  if (loading && tournaments.length === 0 && featuredJudokas.length === 0) {
    return <div className="flex h-screen items-center justify-center text-slate-500 font-bold animate-pulse">Loading Dojo...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8 animate-fade-in">
        
       {/* HEADER */}
       <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Dashboard</h1>
            <div className="flex items-center gap-2">
                <p className="text-slate-500 font-medium mt-1">Welcome back, {userName}.</p>
                {isAdmin && (
                    <span className="bg-slate-900 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase">Admin</span>
                )}
            </div>
          </div>
          
          <div className="flex gap-3">
             {isAdmin && (
                 <Button 
                    onClick={() => onNavigate('CREATE_TOURNAMENT')} 
                    icon={Plus}
                    variant="primary"
                 >
                    Create Tournament
                 </Button>
             )}

             <div className="px-4 py-2 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
                <span className="size-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-sm font-bold text-slate-700">System Online</span>
             </div>
          </div>
       </div>

       {/* STATS ROW */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <StatCard 
             label="Global Rank" 
             value={userProfile?.rank ? `#${userProfile.rank}` : '-'} 
             subValue="Global" 
             icon={Trophy} 
             color="text-amber-500" 
             bg="bg-amber-50" 
             delay="delay-0"
          />
          <StatCard 
             label="Daily Accuracy" 
             value={userProfile?.daily_accuracy ? `${userProfile.daily_accuracy}%` : '0%'} 
             subValue="vs Average" 
             icon={Activity} 
             color="text-blue-600" 
             bg="bg-blue-50" 
             delay="delay-100"
          />
          <StatCard 
             label="Season Points" 
             value={seasonPointsLive !== null ? seasonPointsLive.toLocaleString() : (userProfile?.points?.toLocaleString() ?? '0')} 
             subValue="Total accumulated" 
             icon={Zap} 
             color="text-purple-600" 
             bg="bg-purple-50" 
             delay="delay-200"
          />
       </div>

       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Column (Hero Tournament) */}
          <div className="lg:col-span-2 space-y-8">
              
              {heroTournament ? (
                  <div 
                    className="group relative overflow-hidden bg-slate-900 rounded-2xl shadow-zen text-white p-6 md:p-8 transition-all hover:shadow-xl hover:-translate-y-1 duration-500 cursor-pointer"
                    onClick={handleManagePredictions}
                  >
                      <div className={`absolute top-0 right-0 p-24 rounded-full blur-[80px] opacity-40 -translate-y-1/2 translate-x-1/3 animate-pulse-soft ${
                        (heroTournament.status || '').toUpperCase() === 'SORTING' ? 'bg-amber-500'
                        : (heroTournament.status || '').toUpperCase() === 'COMPLETED' ? 'bg-slate-500'
                        : (heroTournament.status || '').toUpperCase() === 'LIVE' ? 'bg-red-500'
                        : 'bg-blue-500'
                      }`}></div>
                      
                      <div className="relative z-10">
                          <div className="flex items-center gap-3 mb-4">
                              {(() => {
                                const s = (heroTournament.status || '').toUpperCase();
                                const isCompleted = s === 'COMPLETED';
                                const isSorting = s === 'SORTING';
                                const isDraft = s === 'DRAFT' || s === 'UPCOMING';
                                const isLive = s === 'LIVE';
                                return (
                                  <span className={`px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${!isCompleted ? 'animate-pulse' : ''} ${
                                    isSorting ? 'bg-amber-500/20 border-amber-500/30 text-amber-200'
                                    : isDraft ? 'bg-blue-500/20 border-blue-500/30 text-blue-200'
                                    : isCompleted ? 'bg-slate-500/20 border-slate-500/30 text-slate-300'
                                    : 'bg-red-500/20 border-red-500/30 text-red-400'
                                  }`}>
                                    <span className={`size-1.5 rounded-full ${
                                      isSorting ? 'bg-amber-400' : isDraft ? 'bg-blue-400' : isCompleted ? 'bg-slate-400' : 'bg-red-500'
                                    }`}></span>
                                    {isSorting ? 'PREDICTIONS OPEN' : isDraft ? 'COMING SOON' : isCompleted ? 'COMPLETED' : 'LIVE'}
                                  </span>
                                );
                              })()}
                              <span className="text-slate-400 text-sm font-medium">
                                  {formatHeroDate(heroTournament.date)}
                              </span>
                          </div>
                          
                          <h2 className="text-3xl md:text-4xl font-black mb-8 tracking-tight">{heroTournament.name}</h2>

                          <Button 
                            variant="primary"
                            onClick={(e) => { e.stopPropagation(); handleManagePredictions(); }}
                            icon={ArrowRight}
                            className="group-hover:pl-8 transition-all"
                          >
                            {(() => {
                              const s = (heroTournament.status || '').toUpperCase();
                              return s === 'SORTING' ? 'Make Predictions'
                                : (s === 'DRAFT' || s === 'UPCOMING') ? 'View Athletes'
                                : s === 'COMPLETED' ? 'View Results'
                                : 'View Bracket';
                            })()}
                          </Button>
                      </div>
                  </div>
              ) : (
                  <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center h-[300px]">
                      <Calendar size={48} className="text-slate-300 mb-4" />
                      <h3 className="text-xl font-bold text-slate-900">No Active Tournaments</h3>
                      <p className="text-slate-500 max-w-xs mt-2">No live tournaments or prediction phases right now.</p>
                      {isAdmin && (
                        <div className="mt-4">
                            <Button variant="ghost" onClick={() => onNavigate('CREATE_TOURNAMENT')}>
                                + Create one now
                            </Button>
                        </div>
                      )}
                  </div>
              )}

          </div>

          {/* Sidebar */}
          <div className="space-y-8">
              
              {/* UPCOMING EVENTS */}
              <div className="bg-white rounded-2xl shadow-zen border border-slate-100 p-6">
                  <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-bold text-slate-900">Upcoming Events</h3>
                  </div>
                  <div className="space-y-4">
                      {upcomingTournaments.length > 0 ? upcomingTournaments.map((t) => {
                          const dateParts = getUpcomingDateParts(t.date);
                          return (
                          <div key={t.id} onClick={() => { onSelectTournament(t); onNavigate('ROSTER'); }} className="flex gap-4 items-center group cursor-pointer hover:bg-slate-50 p-2 -mx-2 rounded-lg transition-all duration-300">
                              <div className="flex flex-col items-center min-w-[3.5rem] bg-slate-50 border border-slate-100 rounded-lg p-2 group-hover:bg-white group-hover:border-blue-600/20 transition-all group-hover:scale-105">
                                  <span className="text-xs font-bold text-slate-400 uppercase">{dateParts.month}</span>
                                  <span className="text-xl font-black text-slate-900">{dateParts.day}</span>
                              </div>
                              <div className="flex-1">
                                  <h4 className="font-bold text-slate-900 text-sm line-clamp-1 group-hover:text-blue-600">{t.name}</h4>
                              </div>
                          </div>
                      )}) : (
                        <div className="text-center py-4">
                            <p className="text-xs text-slate-400">No scheduled tournaments.</p>
                        </div>
                      )}
                  </div>
              </div>

              {/* ATHLETES TO WATCH (REAL DATA) */}
              <div className="bg-white rounded-2xl shadow-zen border border-slate-100 p-6">
                  <div className="flex items-center gap-2 mb-6">
                      <TrendingUp size={20} className="text-blue-600" />
                      <h3 className="text-lg font-bold text-slate-900">Featured Judokas</h3>
                  </div>
                  <div className="space-y-0">
                      {featuredJudokas.length > 0 ? featuredJudokas.map((judoka) => (
                          <div key={judoka.id || Math.random()} className="flex items-center justify-between group cursor-pointer hover:translate-x-1 transition-transform border-b last:border-0 border-slate-50 py-3 first:pt-0 last:pb-0">
                                <div className="flex items-center gap-3">
                                    {/* Rank Badge */}
                                    <div className={`font-black w-6 text-center text-sm ${judoka.world_rank === 1 ? 'text-amber-500' : judoka.world_rank === 2 ? 'text-slate-400' : 'text-orange-700'}`}>
                                        #{judoka.world_rank}
                                    </div>
                                    
                                    {/* Flag & Name */}
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <Flag countryCode={judoka.country} className="rounded-[1px]" />
                                            <span className="font-bold text-slate-900 text-sm group-hover:text-blue-600 line-clamp-1">
                                                {judoka.first_name} {judoka.last_name}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-medium ml-6">{judoka.weight_category}</span>
                                    </div>
                                </div>
                              <ChevronRight size={14} className="text-slate-200 group-hover:text-blue-600" />
                          </div>
                      )) : (
                        <div className="text-center py-8">
                            <p className="text-xs text-slate-400">No world-class judokas found yet.</p>
                        </div>
                      )}
                  </div>
              </div>
          </div>
       </div>
    </div>
  );
};

const StatCard = ({ label, value, subValue, icon: Icon, color, bg, delay }: any) => (
    <div className={`bg-white p-5 rounded-2xl shadow-zen border border-slate-100 flex items-start justify-between group hover:border-blue-600/20 transition-all duration-300 hover:shadow-lg ${delay}`}>
        <div>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{label}</p>
            <h3 className="text-2xl font-black text-slate-900 mb-1">{value}</h3>
            <p className="text-xs font-medium text-slate-400">{subValue}</p>
        </div>
        <div className={`p-3 rounded-xl ${bg} ${color} transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
            <Icon size={24} />
        </div>
    </div>
);

export default Home;
