
import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import UpdatePassword from './pages/UpdatePassword';
import Home from './pages/Home';
import TournamentList from './pages/TournamentList';
import AdminDashboard from './pages/AdminDashboard';
import BracketBuilder from './pages/BracketBuilder';
import TournamentBracket from './pages/TournamentBracket';
import TournamentRoster from './pages/TournamentRoster';
import AdminTournamentRoster from './components/TournamentRoster'; 
import BuildBracket from './pages/BuildBracket';
import TournamentResults from './pages/TournamentResults';
import MedalTablePicks from './pages/MedalTablePicks';
import TournamentFinalResults from './pages/TournamentFinalResults';
import Leaderboard from './pages/Leaderboard';
import Profile from './pages/Profile';
import Navigation from './components/Navigation';
import { ViewState, UserRole, Tournament, UserPicks, Competitor, UserProfile } from './types';
import { supabase } from './lib/supabaseClient';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('LOGIN');
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const hasInitialSession = useRef(false);
  
  // GLOBAL TOURNAMENT STATE
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  
  // GLOBAL USER STATE
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // draftTournament is used for both Creating NEW and Editing EXISTING tournaments
  const [draftTournament, setDraftTournament] = useState<Tournament | null>(null);
  
  // Track where the user came from to redirect correctly after finishing picks
  const [returnView, setReturnView] = useState<ViewState>('HOME');

  // Store user picks: Record<TournamentId, Record<CategoryName, UserPicks>>
  const [allUserPicks, setAllUserPicks] = useState<Record<string, Record<string, UserPicks>>>({});

  // Unified User Stats (Simulating Database for Leaderboard view mock)
  const [userStats] = useState({
    rank: 9,
    points: 2120,
    accuracy: 78,
    name: "Sensei John",
    username: "JudoMaster99",
    avatar: "https://ui-avatars.com/api/?name=Sensei+John&background=0D8ABC&color=fff"
  });

  // Derived Role helper
  const userRole: UserRole = userProfile?.role === 'ADMIN' ? 'ADMIN' : 'PLAYER';

  // --- GLOBAL: Refresh Profile Function ---
  const refreshProfile = async (sessionUser?: any) => {
      try {
          const user = sessionUser || (await supabase.auth.getUser()).data.user;
          if (!user) return;

          // Optimistic update
          const metaName = user.user_metadata?.full_name || user.user_metadata?.name;
          const email = user.email || '';
          
          setUserProfile(prev => ({
              id: user.id,
              email: email,
              full_name: metaName || prev?.full_name,
              username: prev?.username, 
              avatar_url: prev?.avatar_url,
              role: prev?.role || 'PLAYER',
              points: prev?.points || 0,
              rank: prev?.rank || 0,
              daily_accuracy: prev?.daily_accuracy || 0
          }));

          const { data, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', user.id)
              .single();
          
          if (error) {
              if (error.message === 'Failed to fetch' || error.message.includes('Failed to fetch')) {
                  return; // Silently ignore known iframe artifact
              }
              console.error("Error fetching profile from DB:", error);
              return;
          }

          if (data) {
              const dbRole = data.role ? data.role.toUpperCase() : 'PLAYER';
              const finalRole: UserRole = dbRole === 'ADMIN' ? 'ADMIN' : 'PLAYER';
              
              setUserProfile({
                  id: user.id,
                  email: email,
                  full_name: data.full_name || metaName,
                  username: data.username,
                  avatar_url: data.avatar_url,
                  role: finalRole,
                  points: data.points || 0,
                  rank: data.rank || 0,
                  daily_accuracy: data.daily_accuracy || 0
              });
          }
      } catch (err) {
          console.error("Error in refreshProfile:", err);
      }
  };

  // --- Auth Persistence & Initial Fetch ---
  useEffect(() => {
    const initSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            hasInitialSession.current = true;
            setCurrentView('HOME');
            refreshProfile(session.user);
        }
        setIsAuthChecking(false);
    };
    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setCurrentView('UPDATE_PASSWORD');
      } else if (event === 'SIGNED_IN' && session) {
        const isRecovery = window.location.hash && window.location.hash.includes('type=recovery');
        // Only redirect to HOME on the very first sign-in.
        // Supabase also fires SIGNED_IN on token refreshes (e.g. when switching back to this tab),
        // which would kick the user out of whatever view they were on.
        if (!isRecovery && !hasInitialSession.current) {
            setCurrentView('HOME');
        }
        hasInitialSession.current = true;
        refreshProfile(session.user);
      } else if (event === 'SIGNED_OUT') {
        hasInitialSession.current = false;
        setCurrentView('LOGIN');
        setUserProfile(null);
        // Clear picks state so the next user doesn't see the previous user's data
        setAllUserPicks({});
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- HELPER: DATA MAPPING ---
  const mapTournamentData = (data: any): Tournament => {
      let finalRoster: Competitor[] = Array.isArray(data.roster) && data.roster.length > 0 ? data.roster : [];

      if (finalRoster.length === 0 && data.tournament_participants && data.tournament_participants.length > 0) {
          finalRoster = data.tournament_participants.map((p: any) => {
              const judoka = p.judokas;
              if (!judoka) return null;

              return {
                  id: String(judoka.id),
                  name: judoka.full_name,
                  country: judoka.country_code || 'N/A', 
                  sex: judoka.gender === 'Male' ? 'M' : 'F',
                  rank: p.ranking_external || 'UR',
                  flagUrl: '', 
                  weight: p.categories ? p.categories.name : 'N/A'
              };
          }).filter((c: any) => c !== null);
      }

      // Map Categories correctly into { male: [], female: [] }
      let categoriesObj = { male: [], female: [] };
      if (Array.isArray(data.categories)) {
          // If fetched from categories table relation
          categoriesObj.male = data.categories.filter((c: any) => c.gender === 'Male').map((c: any) => c.name);
          categoriesObj.female = data.categories.filter((c: any) => c.gender === 'Female').map((c: any) => c.name);
      } else if (data.categories && (data.categories.male || data.categories.female)) {
          // Fallback if data structure is already correct
          categoriesObj = data.categories;
      }

      return {
          ...data,
          id: String(data.id),
          date: data.start_date || data.date, // Robust mapping
          status: data.status ? data.status.toUpperCase() : 'UPCOMING',
          roster: finalRoster,
          participantCount: finalRoster.length,
          categories: categoriesObj
      };
  };

  // --- FETCH TOURNAMENTS (GLOBAL) ---
  const fetchTournaments = async () => {
      try {
          // 1. Get all tournaments
          const { data: tournamentsData, error: tError } = await supabase
              .from('tournaments')
              .select('*')
              .order('created_at', { ascending: false });

          if (tError) throw tError;

          if (tournamentsData) {
              // 2. Get counts from tournament_roster for each tournament
              const tournamentsWithCounts = await Promise.all(tournamentsData.map(async (t) => {
                  const { count, error: cError } = await supabase
                      .from('tournament_roster')
                      .select('*', { count: 'exact', head: true })
                      .eq('tournament_id', t.id);
                  
                  if (cError) {
                      console.error(`Error counting roster for tournament ${t.id}:`, cError);
                  }

                  // Need to also fetch category counts if needed for list display, but currently simple mapping is enough for list
                  // We'll rely on fetchTournamentDetails for deep data
                  return {
                      ...t,
                      date: t.start_date || t.date, 
                      status: t.status ? t.status.toUpperCase() : 'DRAFT',
                      roster: t.roster || [], 
                      participantCount: count || 0
                  };
              }));
              
              setTournaments(tournamentsWithCounts);
          }
      } catch (err) {
          console.error("Error fetching tournaments:", err);
      }
  };

  // Fetch on mount and when navigating to main views
  useEffect(() => {
      if (currentView === 'TOURNAMENTS' || currentView === 'HOME') {
          fetchTournaments();
      }
  }, [currentView]);

  // --- FETCH DETAILS ---
  const fetchTournamentDetails = async (tournamentId: string | number) => {
      try {
          const idAsNumber = parseInt(String(tournamentId), 10);
          
          const { data, error } = await supabase
            .from('tournaments')
            .select(`
              *,
              tournament_participants (
                ranking_external,
                judokas (
                  id,
                  full_name,
                  country_code,
                  gender
                ),
                categories (
                  name
                )
              ),
              categories (
                name,
                gender
              )
            `)
            .eq('id', idAsNumber)
            .single();

          if (error) throw error;
          
          if (data) {
              return mapTournamentData(data);
          }
      } catch (err) {
          console.error("Error fetching tournament details:", err);
      }
      return null;
  };

  // Navigation Handlers
  const handleProceedToRoster = (newTournament: Tournament) => {
      setDraftTournament(newTournament);
      setCurrentView('MANAGE_ROSTER');
  };

  const handleProceedToBracket = (newTournament: Tournament) => {
    setDraftTournament(newTournament);
    setCurrentView('BUILD_BRACKET');
  };

  const handleEditTournament = async (t: Tournament) => {
      setDraftTournament(t);
      const freshDetails = await fetchTournamentDetails(t.id);
      if (freshDetails) {
          setDraftTournament(freshDetails);
      }
      const status = (freshDetails?.status || t.status || '').toUpperCase();
      if (status === 'DRAFT' || status === 'UPCOMING') {
         setCurrentView('CREATE_TOURNAMENT'); 
      } else {
         setCurrentView('BUILD_BRACKET');
      }
  };

  const handleSelectTournament = async (t: Tournament) => {
      setSelectedTournament(t);
      const freshDetails = await fetchTournamentDetails(t.id);
      if (freshDetails) {
          setSelectedTournament(freshDetails);
      }

      // Check if brackets exist for this tournament
      try {
        const { data: bracketsData, error: bracketsError } = await supabase
          .from('competition_brackets')
          .select('id')
          .eq('tournament_id', t.id)
          .limit(1);

        if (!bracketsError && bracketsData && bracketsData.length > 0) {
          // Brackets exist, go straight to BRACKET view
          setReturnView(currentView);
          setCurrentView('BRACKET');
          return;
        }
      } catch (err) {
        console.error("Error checking for brackets:", err);
      }

      const status = t.status?.toUpperCase();
      // Logic for navigation: If draft/upcoming -> Roster view. Else -> Bracket view.
      if (status === 'UPCOMING' || status === 'DRAFT' || status === 'COMING_SOON') {
          setCurrentView('ROSTER');
      } else {
          setReturnView(currentView);
          setCurrentView('BRACKET');
      }
  };

  const handleDeleteTournament = async (t: Tournament) => {
    if (!confirm(`Are you sure you want to delete "${t.name}"? This action cannot be undone.`)) return;
    try {
      // Attempt to delete child rows explicitly (works when the admin owns them).
      // Even if some fail silently due to RLS (e.g. other users' picks), the
      // DB-level ON DELETE CASCADE (Migration 006) will clean them up automatically
      // when the parent tournament row is deleted.
      await supabase.from('tournament_scores').delete().eq('tournament_id', t.id);
      await supabase.from('match_results').delete().eq('tournament_id', t.id);
      await supabase.from('user_picks').delete().eq('tournament_id', t.id);
      await supabase.from('competition_brackets').delete().eq('tournament_id', t.id);
      await supabase.from('tournament_roster').delete().eq('tournament_id', t.id);
      await supabase.from('categories').delete().eq('tournament_id', t.id);

      // This is the definitive delete — CASCADE handles any remaining child rows
      const { error } = await supabase.from('tournaments').delete().eq('id', t.id);
      if (error) {
        // If we get a FK constraint error here it means Migration 006 has not been
        // run yet in Supabase. Direct the admin to run it.
        if (error.code === '23503') {
          alert(
            'Cannot delete this tournament because other users have picks saved for it.\n\n' +
            'To fix this permanently, run Migration 006 in your Supabase Dashboard → SQL Editor.\n' +
            'See CONFIG_PROTOCOL_README.md → Migrations → Migration 006.'
          );
          return;
        }
        throw error;
      }
      setTournaments(prev => prev.filter(tour => tour.id !== t.id));
    } catch (err: any) {
      console.error("Error deleting tournament:", err);
      alert("Error deleting tournament: " + (err?.message || String(err)));
    }
  };

  const handleFinalizeTournament = (finalizedTournament: Tournament) => {
      // Optimistic update of the list
      setTournaments(prev => {
          const exists = prev.find(t => t.id === finalizedTournament.id);
          if (exists) {
              return prev.map(t => t.id === finalizedTournament.id ? finalizedTournament : t);
          }
          return [finalizedTournament, ...prev];
      });
      fetchTournaments(); // Ensure sync with DB
      setDraftTournament(null);
      setCurrentView('TOURNAMENTS');
  };

  const handleStatusChange = (tournamentId: string, newStatus: string) => {
    setTournaments(prev => prev.map(t =>
      t.id === tournamentId ? { ...t, status: newStatus as any } : t
    ));
    if (selectedTournament?.id === tournamentId) {
      setSelectedTournament(prev => prev ? { ...prev, status: newStatus as any } : null);
    }
  };

  const handleSavePicks = async (tournamentId: string, category: string, picks: UserPicks, completion: number) => {
      setAllUserPicks(prev => ({
          ...prev,
          [tournamentId]: {
              ...(prev[tournamentId] || {}),
              [category]: picks
          }
      }));
      setTournaments(prev => prev.map(t => t.id === tournamentId ? { ...t, completion } : t));
      if (selectedTournament?.id === tournamentId) {
          setSelectedTournament(prev => prev ? { ...prev, completion } : null);
      }

      // Fallback: Save to localStorage (key includes userId to prevent cross-user data leakage)
      try {
          const uid = userProfile?.id || 'anon';
          const storageKey = `tippon-picks-${uid}-${tournamentId}-${category}`;
          localStorage.setItem(storageKey, JSON.stringify(picks));
      } catch (e) {
          console.error("Failed to persist picks to localStorage:", e);
      }

      // DB Save: requires user_picks table in Supabase
      if (userProfile?.id) {
          try {
              const { error } = await supabase
                  .from('user_picks')
                  .upsert({
                      user_id: userProfile.id,
                      tournament_id: tournamentId,
                      category: category,
                      picks_data: picks,
                      completion_percentage: completion,
                      updated_at: new Date().toISOString()
                  }, { onConflict: 'user_id,tournament_id,category' });
              
              if (error && error.code !== '42P01') { // 42P01 is relation does not exist
                  console.error("Error saving picks to DB:", error);
              }
          } catch (dbErr) {
              console.error("DB error saving picks:", dbErr);
          }
      }
  };

  const renderContent = () => {
    switch (currentView) {
      case 'HOME':
        return <Home 
          userProfile={userProfile}
          onNavigate={(view) => {
            if (view === 'BRACKET') setReturnView('HOME');
            setCurrentView(view);
          }} 
          onSelectTournament={handleSelectTournament}
          tournaments={tournaments} // Pass global tournaments to Home
        />;
      case 'TOURNAMENTS':
        return <TournamentList 
          onNavigate={(view) => {
            if (view === 'BRACKET') setReturnView('TOURNAMENTS');
            setCurrentView(view);
          }} 
          userRole={userRole} 
          tournaments={tournaments} 
          onSelectTournament={handleSelectTournament}
          onEditTournament={handleEditTournament}
          onDeleteTournament={handleDeleteTournament}
          onCreateNew={() => {
              setDraftTournament(null); 
              setCurrentView('CREATE_TOURNAMENT');
          }}
        />;
      case 'CREATE_TOURNAMENT':
        if (userRole !== 'ADMIN') {
             setCurrentView('TOURNAMENTS');
             return null;
        }
        return <AdminDashboard 
            onNavigate={setCurrentView} 
            onProceedToRoster={handleProceedToRoster} 
            initialData={draftTournament}
            initialStep={1}
        />;
      case 'SCORING_RULES':
         if (userRole !== 'ADMIN') {
             setCurrentView('TOURNAMENTS');
             return null;
        }
        return <AdminDashboard 
            onNavigate={setCurrentView} 
            onProceedToRoster={handleProceedToRoster} 
            initialData={draftTournament}
            initialStep={2}
        />;
      case 'MANAGE_ROSTER':
         if (userRole !== 'ADMIN' || !draftTournament) {
            setCurrentView('TOURNAMENTS');
            return null;
        }
        return <AdminTournamentRoster 
            onNavigate={setCurrentView} 
            tournament={draftTournament}
            onProceed={handleProceedToBracket}
        />;
      case 'BUILD_BRACKET':
        if (userRole !== 'ADMIN' || !draftTournament) {
            setCurrentView('TOURNAMENTS');
            return null;
        }
        return <BuildBracket onNavigate={(view) => {
            if (view === 'BRACKET') {
              setSelectedTournament(draftTournament);
              setReturnView('TOURNAMENTS');
            }
            setCurrentView(view);
        }} tournament={draftTournament} />;
      case 'BRACKET':
        return <TournamentBracket 
            onNavigate={setCurrentView} 
            returnView={returnView}
            tournament={selectedTournament} 
            existingPicks={selectedTournament ? allUserPicks[selectedTournament.id] : undefined}
            onSavePicks={handleSavePicks}
            userId={userProfile?.id}
            userRole={userRole}
            onStatusChange={handleStatusChange}
        />;
      case 'MEDAL_TABLE_PICKS':
        return (
          <MedalTablePicks
            onNavigate={setCurrentView}
            tournament={selectedTournament}
            userId={userProfile?.id}
            onSavePicks={handleSavePicks}
          />
        );
      case 'ROSTER':
          return <TournamentRoster 
              onNavigate={setCurrentView} 
              tournament={selectedTournament} 
              userRole={userRole}
              onBuildBracket={() => {
                  setDraftTournament(selectedTournament);
                  setCurrentView('BUILD_BRACKET');
              }}
          />;
      case 'TOURNAMENT_RESULTS':
        if (userRole !== 'ADMIN') {
            setCurrentView('BRACKET');
            return null;
        }
        return <TournamentResults 
            onNavigate={setCurrentView}
            tournament={selectedTournament}
            onTournamentUpdated={() => {
              fetchTournaments();
              handleStatusChange(selectedTournament?.id || '', 'COMPLETED');
            }}
        />;
      case 'TOURNAMENT_LEADERBOARD':
        return <Leaderboard 
            onNavigate={setCurrentView} 
            userStats={userStats}
            tournament={selectedTournament}
        />;
      case 'TOURNAMENT_FINAL_RESULTS':
        return (
          <TournamentFinalResults
            onNavigate={setCurrentView}
            tournament={selectedTournament}
          />
        );
      case 'LEADERBOARD':
        return <Leaderboard onNavigate={setCurrentView} userStats={userStats} />;
      case 'PROFILE':
        return <Profile 
            onNavigate={setCurrentView} 
            userProfile={userProfile} 
            refreshProfile={refreshProfile} 
        />;
      default:
        return <Home 
            userProfile={userProfile} 
            onNavigate={setCurrentView} 
            onSelectTournament={handleSelectTournament} 
            tournaments={tournaments}
        />;
    }
  };

  // --- INITIAL LOADING SCREEN ---
  if (isAuthChecking) {
      return (
        <div className="flex h-screen items-center justify-center bg-background-light">
          <div className="flex flex-col items-center gap-4">
             <div className="size-16 rounded-2xl bg-slate-900 flex items-center justify-center animate-pulse shadow-xl shadow-blue-900/10">
                <span className="text-white font-black text-2xl tracking-tighter">T</span>
             </div>
             <Loader2 className="animate-spin text-slate-400" size={24} />
          </div>
        </div>
      );
  }

  if (currentView === 'LOGIN') {
      return <Login onNavigate={(view) => setCurrentView(view)} />;
  }

  if (currentView === 'FORGOT_PASSWORD') {
      return <ForgotPassword onNavigate={(view) => setCurrentView(view)} />;
  }

  if (currentView === 'UPDATE_PASSWORD') {
      return <UpdatePassword onNavigate={(view) => setCurrentView(view)} />;
  }

  return (
    <div className="flex flex-col h-screen bg-background-light">
      {currentView !== 'BUILD_BRACKET' && currentView !== 'MANAGE_ROSTER' && currentView !== 'TOURNAMENT_RESULTS' && (
        <Navigation 
            currentView={currentView} 
            onNavigate={setCurrentView} 
            userProfile={userProfile}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  );
};

export default App;
