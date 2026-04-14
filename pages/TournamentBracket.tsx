import React, { useState, useEffect, useMemo } from 'react';
import { ViewState, UserRole, UserPicks, Match, Tournament, Competitor } from '../types';
import MatchCard from '../components/MatchCard';
import { ArrowLeft, ChevronDown, Loader2, CheckCircle, Trophy, Lock, PanelLeftOpen, PanelLeftClose, Search, Check, Play, BarChart3, ClipboardCheck } from 'lucide-react';
import Flag from '../components/ui/Flag';
import { supabase } from '../lib/supabaseClient';

interface BracketProps {
  onNavigate: (view: ViewState) => void;
  returnView: ViewState;
  tournament: Tournament | null;
  existingPicks?: Record<string, UserPicks>;
  onSavePicks?: (tournamentId: string, category: string, picks: UserPicks, completion: number) => void;
  userId?: string;
  userRole?: UserRole;
  onStatusChange?: (tournamentId: string, newStatus: string) => void;
}

const getBracketSize = (participants: number) => {
  const sizes = [2, 4, 8, 16, 32, 64, 128];
  return sizes.find(s => s >= participants) || 128;
};

const getRoundOrder = (round: string) => {
  if (round === 'F') return 100;
  if (round === 'SF') return 90;
  if (round === 'QF') return 80;
  if (round.startsWith('R')) return parseInt(round.substring(1));
  return 0;
};

const BracketNode: React.FC<{
  match: Match;
  matches: Match[];
  picks: UserPicks;
  handlePick: (matchId: string, competitorId: string) => void;
  handleDrop: (matchId: string, slot: 'competitor1' | 'competitor2', competitor: Competitor) => void;
  isReadOnly: boolean;
  matchResults?: Record<string, string>;
  showDragDrop?: boolean;
}> = ({ match, matches, picks, handlePick, handleDrop, isReadOnly, matchResults = {}, showDragDrop = false }) => {
  const children = matches.filter(m => m.nextMatchId === match.id);
  const topChild = children.find(m => m.nextMatchSlot === 1);
  const bottomChild = children.find(m => m.nextMatchSlot === 2);

  return (
    <div className="flex items-center h-full">
      {(topChild || bottomChild) && (
        <div className="flex flex-col justify-around h-full relative">
          {topChild && (
            <div className="relative flex items-center flex-1">
              <BracketNode match={topChild} matches={matches} picks={picks} handlePick={handlePick} handleDrop={handleDrop} isReadOnly={isReadOnly} matchResults={matchResults} showDragDrop={showDragDrop} />
              <div className="w-4 border-t border-slate-300 absolute right-0 top-[50%] translate-x-full"></div>
            </div>
          )}
          {bottomChild && (
            <div className="relative flex items-center flex-1">
              <BracketNode match={bottomChild} matches={matches} picks={picks} handlePick={handlePick} handleDrop={handleDrop} isReadOnly={isReadOnly} matchResults={matchResults} showDragDrop={showDragDrop} />
              <div className="w-4 border-t border-slate-300 absolute right-0 top-[50%] translate-x-full"></div>
            </div>
          )}
          {(topChild && bottomChild) && (
             <div className="absolute right-[-1rem] top-[25%] bottom-[25%] border-r border-slate-300"></div>
          )}
        </div>
      )}

      {(topChild || bottomChild) && (
        <div className="w-4 border-t border-slate-300 ml-4"></div>
      )}

      <div className="relative px-2">
        <MatchCard
          match={match}
          onPick={handlePick}
          onDropCompetitor={showDragDrop ? handleDrop : undefined}
          selectedId={picks[match.id]}
          topCompetitor={match.competitor1}
          bottomCompetitor={match.competitor2}
          isLocked={isReadOnly || (match.round === 'R1' && (!match.competitor1 || !match.competitor2))}
          resultStatus={
            matchResults[match.id] && picks[match.id]
              ? (matchResults[match.id] === picks[match.id] ? 'correct' : 'incorrect')
              : null
          }
          actualWinnerId={matchResults[match.id]}
        />
      </div>
    </div>
  );
};

const TournamentBracket: React.FC<BracketProps> = ({ onNavigate, returnView, tournament, existingPicks, onSavePicks, userId, userRole, onStatusChange }) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [picks, setPicks] = useState<UserPicks>({});
  const [champion, setChampion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(
    tournament?.categories?.male?.[0] ? `Men ${tournament.categories.male[0]}` : ''
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [allCategoryCompetitors, setAllCategoryCompetitors] = useState<Competitor[]>([]);
  const [rawDbMatches, setRawDbMatches] = useState<any[]>([]);
  const [matchResults, setMatchResults] = useState<Record<string, string>>({});
  const [userScore, setUserScore] = useState<{ points: number; correct: number; total: number } | null>(null);
  const [localStatus, setLocalStatus] = useState(tournament?.status);

  const isAdmin = userRole === 'ADMIN';
  const effectiveStatus = localStatus || tournament?.status;
  const isReadOnly = effectiveStatus === 'LIVE' || effectiveStatus === 'COMPLETED';
  const showDragDrop = isAdmin && effectiveStatus !== 'LIVE' && effectiveStatus !== 'COMPLETED';

  const placedIds = useMemo(() => {
    const ids = new Set<string>();
    matches.filter(m => m.round === 'R1').forEach(m => {
      if (m.competitor1?.id) ids.add(m.competitor1.id);
      if (m.competitor2?.id) ids.add(m.competitor2.id);
    });
    return ids;
  }, [matches]);

  const filteredSidebarCompetitors = useMemo(() => {
    let list = [...allCategoryCompetitors];
    if (sidebarSearch.trim()) {
      const q = sidebarSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q));
    }
    const unplaced = list.filter(c => !placedIds.has(c.id));
    const placed = list.filter(c => placedIds.has(c.id));
    return { unplaced, placed };
  }, [allCategoryCompetitors, placedIds, sidebarSearch]);

  useEffect(() => {
    const loadData = async () => {
      if (!tournament?.id) return;
      setIsLoading(true);

      try {
        const { data: dbMatches, error: bracketError } = await supabase
          .from('competition_brackets')
          .select('*')
          .eq('tournament_id', tournament.id)
          .order('match_number', { ascending: true });

        if (bracketError && bracketError.code !== 'PGRST116') throw bracketError;

        setRawDbMatches(dbMatches || []);

        if (dbMatches && dbMatches.length > 0) {
          const bracketCategories = Array.from(
            new Set(dbMatches.map((m: any) => m.weight_category).filter(Boolean))
          ) as string[];

          if (bracketCategories.length > 0) {
            setCategories(bracketCategories);
            if (!selectedCategory || !bracketCategories.includes(selectedCategory)) {
              setSelectedCategory(bracketCategories[0]);
              return;
            }
          }
        }

        const { data: roster } = await supabase
          .from('tournament_roster')
          .select('*')
          .eq('tournament_id', tournament.id);

        const rosterMap: Record<string, any> = {};
        if (roster) {
          roster.forEach(athlete => {
            rosterMap[athlete.id] = {
              id: athlete.id,
              name: `${(athlete.last_name || '').toUpperCase()} ${athlete.first_name || ''}`.trim(),
              country: athlete.country || 'N/A',
              flagUrl: '',
              rank: 'UR',
              weight: athlete.weight_category,
            };
          });
        }

        let freshMatches: Match[] = [];
        const categoryCompetitors: Competitor[] = [];

        if (dbMatches && dbMatches.length > 0) {
          const categoryMatches = dbMatches.filter(
            (m: any) => m.weight_category === selectedCategory
          );

          categoryMatches.forEach((m: any) => {
            const bd = m?.bracket_data;
            if (bd?.competitor1?.name) {
              categoryCompetitors.push({
                id: `pdf-${m.id}-competitor1`,
                name: bd.competitor1.name,
                country: bd.competitor1.country || 'N/A',
                flagUrl: '',
                rank: 'UR',
              });
            }
            if (bd?.competitor2?.name) {
              categoryCompetitors.push({
                id: `pdf-${m.id}-competitor2`,
                name: bd.competitor2.name,
                country: bd.competitor2.country || 'N/A',
                flagUrl: '',
                rank: 'UR',
              });
            }
          });

          if (categoryMatches.length > 0) {
            const numR1FromDb = categoryMatches.length;
            const size = getBracketSize(numR1FromDb * 2);
            const fullR1Count = size / 2;

            const resolveCompetitor = (m: any, slot: 'competitor1' | 'competitor2', idField: string) => {
              if (m && m[idField] && rosterMap[m[idField]]) return rosterMap[m[idField]];
              const bd = m?.bracket_data;
              if (bd && bd[slot] && bd[slot].name) {
                return {
                  id: `pdf-${m.id}-${slot}`,
                  name: bd[slot].name,
                  country: bd[slot].country || 'N/A',
                  flagUrl: '',
                  rank: 'UR',
                };
              }
              return null;
            };

            // Only create R1 matches for actual DB entries — NO padding
            for (let i = 0; i < numR1FromDb; i++) {
              const m = categoryMatches[i];

              let pool = '';
              if (fullR1Count >= 4) {
                const poolSize = fullR1Count / 4;
                pool = String.fromCharCode(65 + Math.floor(i / poolSize));
              } else if (fullR1Count === 2) {
                pool = i === 0 ? 'A' : 'B';
              }

              const c1 = resolveCompetitor(m, 'competitor1', 'competitor_1');
              const c2 = resolveCompetitor(m, 'competitor2', 'competitor_2');

              freshMatches.push({
                id: m.id || `r1-m${i}`,
                round: 'R1',
                pool: pool || undefined,
                matchNumber: m.match_number || i + 1,
                competitor1: c1,
                competitor2: c2,
                winnerId: null,
                nextMatchId: size > 2 ? `r2-m${Math.floor(i / 2)}` : undefined,
                nextMatchSlot: i % 2 === 0 ? 1 : 2,
              });
            }

            // Build R2+ based on the full bracket size
            let currentRoundMatches = fullR1Count / 2;
            let roundLevel = 2;
            let matchCounter = fullR1Count + 1;
            while (currentRoundMatches >= 1) {
              for (let i = 0; i < currentRoundMatches; i++) {
                const isFinal = currentRoundMatches === 1;
                let pool = '';
                if (!isFinal) {
                  if (currentRoundMatches >= 4) {
                    const poolSize = currentRoundMatches / 4;
                    pool = String.fromCharCode(65 + Math.floor(i / poolSize));
                  } else if (currentRoundMatches === 2) {
                    pool = i === 0 ? 'A' : 'B';
                  }
                }
                freshMatches.push({
                  id: `r${roundLevel}-m${i}`,
                  round: isFinal ? 'F' : `R${roundLevel}`,
                  pool: pool || undefined,
                  matchNumber: matchCounter++,
                  competitor1: null,
                  competitor2: null,
                  winnerId: null,
                  nextMatchId: isFinal ? undefined : `r${roundLevel + 1}-m${Math.floor(i / 2)}`,
                  nextMatchSlot: i % 2 === 0 ? 1 : 2,
                });
              }
              currentRoundMatches /= 2;
              roundLevel++;
            }
          }
        }

        setAllCategoryCompetitors(categoryCompetitors);

        // BYE auto-advance: only for R1 matches with exactly one competitor
        let currentPicks: UserPicks = {};
        freshMatches.forEach(m => {
          if (m.round !== 'R1') return;
          const hasC1 = m.competitor1 !== null;
          const hasC2 = m.competitor2 !== null;
          // Exactly one competitor = BYE
          if (hasC1 && !hasC2) currentPicks[m.id] = m.competitor1!.id;
          if (!hasC1 && hasC2) currentPicks[m.id] = m.competitor2!.id;
        });

        // Fase 1: Load picks from Supabase DB first, fallback to localStorage
        let savedDb: UserPicks = {};
        if (userId) {
          try {
            const { data: dbPicks } = await supabase
              .from('user_picks')
              .select('picks_data')
              .eq('user_id', userId)
              .eq('tournament_id', tournament.id)
              .eq('category', selectedCategory)
              .single();

            if (dbPicks?.picks_data) {
              savedDb = dbPicks.picks_data as UserPicks;
            }
          } catch { /* table may not exist yet */ }
        }

        const storageKey = `tippon-picks-${tournament.id}-${selectedCategory}`;
        let savedLocal: UserPicks = {};
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) savedLocal = JSON.parse(raw);
        } catch { /* ignore */ }

        // Priority: DB > existingPicks (React state) > localStorage
        const saved = Object.keys(savedDb).length > 0
          ? savedDb
          : (existingPicks?.[selectedCategory] || savedLocal);
        const mergedPicks = { ...currentPicks, ...saved };

        // Fase 5: Load match results when tournament is COMPLETED
        if (tournament.status === 'COMPLETED' || localStatus === 'COMPLETED') {
          try {
            const { data: resultsData } = await supabase
              .from('match_results')
              .select('match_id, winner_competitor_id')
              .eq('tournament_id', tournament.id)
              .eq('category', selectedCategory);

            if (resultsData && resultsData.length > 0) {
              const resultsMap: Record<string, string> = {};
              resultsData.forEach(r => { resultsMap[r.match_id] = r.winner_competitor_id; });
              setMatchResults(resultsMap);

              // Calculate user score for this category
              let correct = 0;
              let total = 0;
              Object.entries(mergedPicks).forEach(([matchId, pickedId]) => {
                if (resultsMap[matchId]) {
                  total++;
                  if (resultsMap[matchId] === pickedId) correct++;
                }
              });
              setUserScore({ points: 0, correct, total });
            } else {
              setMatchResults({});
              setUserScore(null);
            }
          } catch { /* table may not exist */ }
        } else {
          setMatchResults({});
          setUserScore(null);
        }

        // Rehydrate winners — sorted by round order to propagate correctly
        const sortedRounds = Array.from(new Set(freshMatches.map(m => m.round)))
          .sort((a, b) => getRoundOrder(a) - getRoundOrder(b));

        sortedRounds.forEach(r => {
          freshMatches.filter(m => m.round === r).forEach(match => {
            const winnerId = mergedPicks[match.id];
            if (!winnerId) return;

            const winner = match.competitor1?.id === winnerId
              ? match.competitor1
              : (match.competitor2?.id === winnerId ? match.competitor2 : null);

            if (winner && match.nextMatchId) {
              const target = freshMatches.find(tm => tm.id === match.nextMatchId);
              if (target) {
                if (match.nextMatchSlot === 1) target.competitor1 = winner;
                else target.competitor2 = winner;
              }
            }
            if (match.round === 'F' && winnerId) setChampion(winnerId);
          });
        });

        setMatches(freshMatches);
        setPicks(mergedPicks);
      } catch (err) {
        console.error("Error loading bracket data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [selectedCategory, tournament?.id, existingPicks, userId, localStatus]);

  // --- ADMIN: Status Change Handlers ---
  const handleGoLive = async () => {
    if (!tournament?.id || !isAdmin) return;
    if (!confirm('¿Iniciar el torneo? Los picks de los jugadores quedarán bloqueados.')) return;
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'live' })
        .eq('id', tournament.id);
      if (error) throw error;
      setLocalStatus('LIVE');
      onStatusChange?.(tournament.id, 'LIVE');
    } catch (err) {
      console.error('Error changing status to LIVE:', err);
      alert('Error al cambiar estado del torneo');
    }
  };

  // --- DROP HANDLER ---
  const handleDropCompetitor = (matchId: string, slot: 'competitor1' | 'competitor2', competitor: Competitor) => {
    if (isReadOnly) return;

    setMatches(prev => {
      const cloned = prev.map(m => ({ ...m }));

      // Remove competitor from any existing R1 slot
      cloned.filter(m => m.round === 'R1').forEach(m => {
        if (m.competitor1?.id === competitor.id) m.competitor1 = null;
        if (m.competitor2?.id === competitor.id) m.competitor2 = null;
      });

      // Place into the target slot
      const target = cloned.find(m => m.id === matchId);
      if (target && target.round === 'R1') {
        if (slot === 'competitor1') target.competitor1 = competitor;
        else target.competitor2 = competitor;
      }

      return cloned;
    });

    // Persist to Supabase
    const dbMatch = rawDbMatches.find((m: any) => m.id === matchId);
    if (dbMatch) {
      const updatedBd = { ...(dbMatch.bracket_data || {}) };
      updatedBd[slot] = { name: competitor.name, country: competitor.country };
      supabase.from('competition_brackets')
        .update({ bracket_data: updatedBd })
        .eq('id', matchId)
        .then(({ error }) => { if (error) console.error("Error saving drop:", error); });
    }
  };

  // --- PICK HANDLER ---
  const handlePick = (matchId: string, competitorId: string) => {
    if (isReadOnly) return;
    const match = matches.find(m => m.id === matchId);
    if (!match) return;

    const newPicks = { ...picks, [matchId]: competitorId };
    setPicks(newPicks);

    if (match.nextMatchId) {
      setMatches(prev => {
        const cloned = prev.map(m => ({ ...m }));
        const winner = match.competitor1?.id === competitorId ? match.competitor1 : match.competitor2;
        const target = cloned.find(m => m.id === match.nextMatchId);
        if (target && winner) {
          if (match.nextMatchSlot === 1) target.competitor1 = winner;
          else target.competitor2 = winner;
        }
        return cloned;
      });
    } else if (match.round === 'F') {
      setChampion(competitorId);
    }
  };

  // --- SAVE HANDLER ---
  const handleSave = () => {
    if (isReadOnly || !tournament) return;
    setIsSubmitting(true);

    const storageKey = `tippon-picks-${tournament.id}-${selectedCategory}`;
    localStorage.setItem(storageKey, JSON.stringify(picks));

    const completion = matches.length > 0
      ? Math.round((Object.keys(picks).length / matches.length) * 100)
      : 0;

    onSavePicks?.(tournament.id, selectedCategory, picks, completion);

    setTimeout(() => {
      setIsSubmitting(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2500);
    }, 600);
  };

  if (isLoading) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={48} /></div>;

  const roundsToRender = Array.from(new Set(matches.map(m => m.round))).sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
  const totalSidebar = filteredSidebarCompetitors.unplaced.length + filteredSidebarCompetitors.placed.length;

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      <header className="bg-white p-4 border-b flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => onNavigate(returnView)} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft size={20}/></button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg">{tournament?.name}</h1>
              {effectiveStatus && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  effectiveStatus === 'LIVE' ? 'bg-red-100 text-red-600' :
                  effectiveStatus === 'COMPLETED' ? 'bg-slate-100 text-slate-600' :
                  'bg-blue-100 text-blue-600'
                }`}>
                  {effectiveStatus}
                </span>
              )}
              {userScore && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">
                  {userScore.correct}/{userScore.total} aciertos
                </span>
              )}
            </div>
            <div className="relative">
                <button onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)} className="text-primary text-sm font-bold flex items-center gap-1">
                {selectedCategory || 'Seleccionar categoría'} <ChevronDown size={14}/>
                </button>
                {isCategoryDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-slate-200 z-50 max-h-72 overflow-y-auto">
                    <ul className="py-1">
                      {categories.map(cat => (
                        <li key={cat}>
                          <button
                            onClick={() => { setSelectedCategory(cat); setIsCategoryDropdownOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${selectedCategory === cat ? 'font-bold text-primary bg-blue-50' : 'text-slate-700'}`}
                          >
                            {cat}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Admin controls */}
          {isAdmin && effectiveStatus !== 'COMPLETED' && effectiveStatus !== 'LIVE' && (
            <button
              onClick={handleGoLive}
              className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-600 transition-colors text-sm"
            >
              <Play size={16} />
              Iniciar Torneo
            </button>
          )}

          {isAdmin && effectiveStatus === 'LIVE' && (
            <button
              onClick={() => onNavigate('TOURNAMENT_RESULTS')}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors text-sm"
            >
              <ClipboardCheck size={16} />
              Ingresar Resultados
            </button>
          )}

          {effectiveStatus === 'COMPLETED' && (
            <button
              onClick={() => onNavigate('TOURNAMENT_LEADERBOARD')}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 transition-colors text-sm"
            >
              <BarChart3 size={16} />
              Leaderboard
            </button>
          )}

          {/* Sidebar toggle — only for admins building brackets */}
          {showDragDrop && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
              title={sidebarOpen ? 'Cerrar panel' : 'Abrir panel de Judokas'}
            >
              {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
            </button>
          )}

          {isReadOnly ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded-lg border border-slate-200">
              <Lock size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">Picks Locked</span>
            </div>
          ) : showSaved ? (
            <div className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-lg font-bold shadow-lg shadow-green-500/20 animate-pulse">
              <Check size={18} />
              Guardado!
            </div>
          ) : (
            <button 
              onClick={handleSave}
              disabled={isSubmitting}
              className="bg-primary text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>}
              {isSubmitting ? 'Guardando...' : 'Save Picks'}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* --- JUDOKA SIDEBAR (admin bracket building only) --- */}
        {sidebarOpen && showDragDrop && (
          <aside className="w-72 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
            <div className="p-3 border-b border-slate-100">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
                Judokas ({totalSidebar})
              </h3>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={sidebarSearch}
                  onChange={e => setSidebarSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {/* Unplaced competitors first */}
              {filteredSidebarCompetitors.unplaced.length > 0 && (
                <>
                  <p className="text-[10px] font-bold text-orange-500 uppercase tracking-wider px-1 pt-1">
                    Sin colocar ({filteredSidebarCompetitors.unplaced.length})
                  </p>
                  {filteredSidebarCompetitors.unplaced.map(c => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify(c));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="flex items-center gap-2 p-2 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 cursor-grab active:cursor-grabbing transition-colors select-none"
                    >
                      <Flag countryCode={c.country} className="w-5 h-3.5 shadow-sm flex-shrink-0" />
                      <span className="text-xs font-semibold text-slate-800 truncate flex-1">{c.name}</span>
                      <span className="text-[10px] text-slate-400 font-bold">{c.country}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Placed competitors */}
              {filteredSidebarCompetitors.placed.length > 0 && (
                <>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 pt-2">
                    Colocados ({filteredSidebarCompetitors.placed.length})
                  </p>
                  {filteredSidebarCompetitors.placed.map(c => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify(c));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 bg-slate-50 hover:bg-blue-50 cursor-grab active:cursor-grabbing transition-colors select-none opacity-60"
                    >
                      <Check size={12} className="text-green-500 flex-shrink-0" />
                      <Flag countryCode={c.country} className="w-5 h-3.5 shadow-sm flex-shrink-0" />
                      <span className="text-xs font-medium text-slate-500 truncate flex-1">{c.name}</span>
                      <span className="text-[10px] text-slate-400 font-bold">{c.country}</span>
                    </div>
                  ))}
                </>
              )}

              {totalSidebar === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">
                  {sidebarSearch ? 'Sin resultados' : 'No hay judokas para esta categoría'}
                </p>
              )}
            </div>
          </aside>
        )}

        {/* --- BRACKET AREA --- */}
        <main className="flex-1 overflow-auto p-12">
          <div className="flex flex-col min-w-max h-full">
            <div className="flex mb-8">
              {roundsToRender.map((round, index) => (
                <div key={round} className={`${index === 0 ? 'w-[19rem]' : 'w-[21rem]'} flex-shrink-0 flex justify-center`}>
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {round === 'F' ? 'Final' : round === 'SF' ? 'Semi Finals' : round === 'QF' ? 'Quarter Finals' : `Round ${index + 1}`}
                  </span>
                </div>
              ))}
              <div className="w-64 flex-shrink-0 flex justify-center ml-4">
                <span className="text-xs font-black text-gold uppercase tracking-widest">Champion</span>
              </div>
            </div>

            <div className="flex items-center flex-1">
              {matches.filter(m => m.round === 'F').map(finalMatch => (
                <BracketNode 
                  key={finalMatch.id}
                  match={finalMatch}
                  matches={matches}
                  picks={picks}
                  handlePick={handlePick}
                  handleDrop={handleDropCompetitor}
                  isReadOnly={isReadOnly}
                  matchResults={matchResults}
                  showDragDrop={showDragDrop}
                />
              ))}
              
              <div className="flex items-center h-full">
                <div className="w-8 border-t border-slate-300"></div>
                <div className={`w-64 h-48 rounded-xl border-2 flex flex-col items-center justify-center gap-4 ml-4 ${champion ? 'border-gold bg-white shadow-xl' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                  <Trophy size={48} className={champion ? 'text-gold' : 'text-slate-200'} />
                  {champion && <span className="font-black text-center px-4 uppercase text-lg text-slate-800">
                    {(() => {
                      const match = matches.find(m => m.competitor1?.id === champion || m.competitor2?.id === champion);
                      if (!match) return '';
                      return match.competitor1?.id === champion ? match.competitor1.name : match.competitor2?.name;
                    })()}
                  </span>}
                  {!champion && <span className="text-sm font-medium text-slate-400">Complete your bracket</span>}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default TournamentBracket;
