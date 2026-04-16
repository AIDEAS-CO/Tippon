import React, { useState, useEffect, useMemo } from 'react';
import { ViewState, UserRole, UserPicks, Match, Tournament, Competitor, CategoryStatus } from '../types';
import MatchCard from '../components/MatchCard';
import { ArrowLeft, ChevronDown, Loader2, CheckCircle, Trophy, Lock, PanelLeftOpen, PanelLeftClose, Search, Check, Play, BarChart3, ClipboardCheck, Medal } from 'lucide-react';
import Flag from '../components/ui/Flag';
import { supabase } from '../lib/supabaseClient';
import { calculateMyScore } from '../lib/scoringEngine';
import { getBracketParticipantCount, buildMatchesForBracket, sortedUniqueRounds, getPredictedMedalistCompetitorIds, deriveStandings } from '../lib/bracketUtils';

interface BracketProps {
  onNavigate: (view: ViewState) => void;
  returnView: ViewState;
  tournament: Tournament | null;
  existingPicks?: Record<string, UserPicks>;
  onSavePicks?: (tournamentId: string, category: string, picks: UserPicks, completion: number) => void;
  userId?: string;
  userRole?: UserRole;
  onStatusChange?: (tournamentId: string, newStatus: string) => void;
  categoryStatuses?: Record<string, CategoryStatus>;
}

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

const TournamentBracket: React.FC<BracketProps> = ({ onNavigate, returnView, tournament, existingPicks, onSavePicks, userId, userRole, onStatusChange, categoryStatuses }) => {
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
  const [sidebarDropActive, setSidebarDropActive] = useState(false);
  const [userScore, setUserScore] = useState<{ points: number; correct: number; total: number } | null>(null);
  const [localStatus, setLocalStatus] = useState(tournament?.status?.toUpperCase());
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<{ picks: UserPicks; completion: number } | null>(null);

  useEffect(() => {
    if (tournament?.status) {
      setLocalStatus(tournament.status.toUpperCase());
    }
  }, [tournament?.status]);

  const isAdmin = userRole === 'ADMIN';
  const effectiveStatus = (localStatus || tournament?.status || '').toUpperCase();
  const isCategoryClosed = !isAdmin && categoryStatuses?.[selectedCategory] === 'closed';
  const isReadOnly = effectiveStatus === 'LIVE' || effectiveStatus === 'COMPLETED' || isCategoryClosed;
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

  const predictedMedalistIds = useMemo(
    () => getPredictedMedalistCompetitorIds(matches, picks),
    [matches, picks]
  );

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
              });
            }
            if (bd?.competitor2?.name) {
              categoryCompetitors.push({
                id: `pdf-${m.id}-competitor2`,
                name: bd.competitor2.name,
                country: bd.competitor2.country || 'N/A',
                flagUrl: '',
              });
            }
          });

          // Pool must include every roster athlete in this weight class — not only names
          // still present in bracket_data. After unassign, slots are null in DB; those
          // judokas would otherwise disappear from the sidebar when reloading the category.
          const normalizeWeight = (s: string) =>
            s.toLowerCase().replace(/\s+/g, '').replace(/^(men'?s?|women'?s?|male|female)/i, '');
          const selNorm = normalizeWeight(selectedCategory || '');
          Object.values(rosterMap).forEach((athlete: Competitor) => {
            const w = (athlete as Competitor & { weight?: string }).weight || '';
            if (!w || !selNorm) return;
            const wNorm = normalizeWeight(w);
            const matchesCat =
              wNorm === selNorm || wNorm.includes(selNorm) || selNorm.includes(wNorm);
            if (!matchesCat) return;
            const dup = categoryCompetitors.some(
              c => c.id === athlete.id || (c.name === athlete.name && c.country === athlete.country)
            );
            if (!dup) categoryCompetitors.push(athlete);
          });

          if (categoryMatches.length > 0) {
            const hasRepechage = !!tournament?.scoring_configuration?.has_repechage;
            freshMatches.push(...buildMatchesForBracket(
              categoryMatches,
              rosterMap,
              selectedCategory,
              hasRepechage
            ));
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

        // User-scoped localStorage key prevents cross-user data leakage on shared devices
        const storageKey = `tippon-picks-${userId || 'anon'}-${tournament.id}-${selectedCategory}`;
        let savedLocal: UserPicks = {};
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) savedLocal = JSON.parse(raw);
        } catch { /* ignore */ }

        // Priority: DB (user-scoped) > localStorage (user-scoped) > existingPicks fallback
        const saved = Object.keys(savedDb).length > 0
          ? savedDb
          : (savedLocal && Object.keys(savedLocal).length > 0 ? savedLocal : (existingPicks?.[selectedCategory] || {}));
        const mergedPicks = { ...currentPicks, ...saved };

        // Fase 5: Load match results when tournament is COMPLETED
        if (effectiveStatus === 'COMPLETED') {
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

              // Auto-calculate and persist this user's score (fixes RLS issue where
              // admin-side batch calculation can't read other users' picks).
              // Each user calculates their own score from their own picks.
              if (userId && Object.keys(mergedPicks).length > 0) {
                calculateMyScore(tournament.id as string, selectedCategory, userId, mergedPicks)
                  .then(score => setUserScore(score))
                  .catch(() => {
                    // Fallback: compute locally without persisting
                    let correct = 0, total = 0;
                    Object.entries(mergedPicks).forEach(([matchId, pickedId]) => {
                      if (resultsMap[matchId]) {
                        total++;
                        if (resultsMap[matchId] === pickedId) correct++;
                      }
                    });
                    setUserScore({ points: 0, correct, total });
                  });
              } else {
                setUserScore(null);
              }
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
        const sortedRounds = sortedUniqueRounds(freshMatches);

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

            // Propagate loser to repechage / bronze
            if (match.loserNextMatchId && match.competitor1 && match.competitor2) {
              const loser = match.competitor1.id === winnerId ? match.competitor2 : match.competitor1;
              const loserTarget = freshMatches.find(tm => tm.id === match.loserNextMatchId);
              if (loserTarget && loser) {
                if (match.loserNextMatchSlot === 1) loserTarget.competitor1 = loser;
                else loserTarget.competitor2 = loser;
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

  // When the tournament is COMPLETED, calculate and persist scores for ALL
  // categories at once. This ensures every user appears in the full leaderboard
  // regardless of which category tab they currently have open.
  useEffect(() => {
    if (effectiveStatus !== 'COMPLETED' || !userId || !tournament?.id) return;

    (async () => {
      // Fetch the exact category labels from competition_brackets (e.g. 'Men -60kg')
      // rather than tournament.categories.male (e.g. '-60kg') which won't match picks keys.
      const { data: bracketData } = await supabase
        .from('competition_brackets')
        .select('weight_category')
        .eq('tournament_id', tournament.id);

      const allCategories = Array.from(
        new Set((bracketData || []).map((m: any) => m.weight_category).filter(Boolean))
      ) as string[];

      for (const cat of allCategories) {
        try {
          const { data: dbPicks } = await supabase
            .from('user_picks')
            .select('picks_data')
            .eq('user_id', userId)
            .eq('tournament_id', tournament.id)
            .eq('category', cat)
            .single();

          if (dbPicks?.picks_data && Object.keys(dbPicks.picks_data).length > 0) {
            await calculateMyScore(tournament.id as string, cat, userId, dbPicks.picks_data);
          }
        } catch {
          // No picks for this user in this category — expected.
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.id, userId, effectiveStatus]);

  // --- ADMIN: Status Change Handlers ---
  const handleGoLive = async () => {
    if (!tournament?.id || !isAdmin) return;
    if (!confirm('Start the tournament? All player picks will be locked.')) return;
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
      alert('Error changing tournament status.');
    }
  };

  // --- UNASSIGN HANDLER (drag a competitor back to the sidebar) ---
  const handleUnassignCompetitor = (competitor: Competitor) => {
    setMatches(prev => {
      const cloned = prev.map(m => ({ ...m }));
      cloned.filter(m => m.round === 'R1').forEach(m => {
        if (m.competitor1?.id === competitor.id) m.competitor1 = null;
        if (m.competitor2?.id === competitor.id) m.competitor2 = null;
      });
      return cloned;
    });

    // Persist removal to Supabase
    const dbMatch = rawDbMatches.find((m: any) => {
      const bd = m.bracket_data || {};
      return (bd.competitor1?.name === competitor.name && bd.competitor1?.country === competitor.country)
          || (bd.competitor2?.name === competitor.name && bd.competitor2?.country === competitor.country);
    });
    if (dbMatch) {
      const updatedBd = { ...(dbMatch.bracket_data || {}) };
      if (updatedBd.competitor1?.name === competitor.name && updatedBd.competitor1?.country === competitor.country) {
        updatedBd.competitor1 = null;
      }
      if (updatedBd.competitor2?.name === competitor.name && updatedBd.competitor2?.country === competitor.country) {
        updatedBd.competitor2 = null;
      }
      supabase.from('competition_brackets')
        .update({ bracket_data: updatedBd })
        .eq('id', dbMatch.id)
        .then(({ error }) => { if (error) console.error("Error unassigning competitor:", error); });
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

    let newPicks: UserPicks = { ...picks, [matchId]: competitorId };
    const medalists = getPredictedMedalistCompetitorIds(matches, newPicks);
    if (newPicks['additional_pick'] && medalists.has(newPicks['additional_pick'])) {
      const next = { ...newPicks };
      delete next['additional_pick'];
      newPicks = next;
    }
    setPicks(newPicks);

    const winner = match.competitor1?.id === competitorId ? match.competitor1 : match.competitor2;
    const loser = match.competitor1?.id === competitorId ? match.competitor2 : match.competitor1;

    if (match.nextMatchId || match.loserNextMatchId) {
      setMatches(prev => {
        const cloned = prev.map(m => ({ ...m }));

        // Propagate winner forward
        if (match.nextMatchId && winner) {
          const target = cloned.find(m => m.id === match.nextMatchId);
          if (target) {
            if (match.nextMatchSlot === 1) target.competitor1 = winner;
            else target.competitor2 = winner;
          }
        }

        // Propagate loser to repechage / bronze (only when both slots are filled)
        if (match.loserNextMatchId && loser && match.competitor1 && match.competitor2) {
          const loserTarget = cloned.find(m => m.id === match.loserNextMatchId);
          if (loserTarget) {
            if (match.loserNextMatchSlot === 1) loserTarget.competitor1 = loser;
            else loserTarget.competitor2 = loser;
          }
        }

        return cloned;
      });
    }

    if (match.round === 'F') setChampion(competitorId);
  };

  // --- SAVE HANDLER (phase 1: show confirmation) ---
  const handleSave = () => {
    if (isReadOnly || !tournament) return;

    const medalists = getPredictedMedalistCompetitorIds(matches, picks);
    let toSave: UserPicks = { ...picks };
    if (toSave['additional_pick'] && medalists.has(toSave['additional_pick'])) {
      const { additional_pick: _x, ...rest } = toSave;
      toSave = rest as UserPicks;
      setPicks(toSave);
    }

    const bracketPickCount = Object.keys(toSave).filter(k => k !== 'additional_pick').length;
    const completion = matches.length > 0
      ? Math.round((bracketPickCount / matches.length) * 100)
      : 0;

    setPendingSaveData({ picks: toSave, completion });
    setShowConfirmation(true);
  };

  // --- SAVE HANDLER (phase 2: confirmed) ---
  const handleConfirmSave = () => {
    if (!tournament || !pendingSaveData) return;
    setShowConfirmation(false);
    setIsSubmitting(true);

    const { picks: toSave, completion } = pendingSaveData;
    const storageKey = `tippon-picks-${userId || 'anon'}-${tournament.id}-${selectedCategory}`;
    localStorage.setItem(storageKey, JSON.stringify(toSave));

    onSavePicks?.(tournament.id, selectedCategory, toSave, completion);

    setTimeout(() => {
      setIsSubmitting(false);
      setShowSaved(true);
      setPendingSaveData(null);
      setTimeout(() => setShowSaved(false), 2500);
    }, 600);
  };

  if (isLoading) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={48} /></div>;

  const mainMatches = matches.filter(m => m.roundType !== 'repechage' && m.roundType !== 'bronze');
  const repMatches = matches.filter(m => m.roundType === 'repechage');
  const bronzeMatches = matches.filter(m => m.roundType === 'bronze');
  const hasRepechageSection = repMatches.length > 0 || bronzeMatches.length > 0;
  const roundsToRender = sortedUniqueRounds(mainMatches);
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
                  {userScore.correct}/{userScore.total} correct
                </span>
              )}
            </div>
            <div className="relative">
                <button onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)} className="text-primary text-sm font-bold flex items-center gap-1">
                {selectedCategory || 'Select category'} <ChevronDown size={14}/>
                </button>
                {isCategoryDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-slate-200 z-50 max-h-72 overflow-y-auto">
                    <ul className="py-1">
                      {categories.map(cat => (
                        <li key={cat}>
                          <button
                            onClick={() => { setSelectedCategory(cat); setIsCategoryDropdownOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${selectedCategory === cat ? 'font-bold text-primary bg-blue-50' : 'text-slate-700'}`}
                          >
                            <span className="flex-1">{cat}</span>
                            {categoryStatuses?.[cat] === 'closed' && <Lock size={12} className="text-slate-400 flex-shrink-0" />}
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
              Start Tournament
            </button>
          )}

          {isAdmin && effectiveStatus === 'LIVE' && (
            <button
              onClick={() => onNavigate('TOURNAMENT_RESULTS')}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors text-sm"
            >
              <ClipboardCheck size={16} />
              Enter Results
            </button>
          )}

          {effectiveStatus === 'COMPLETED' && (
            <>
              <button
                onClick={() => onNavigate('TOURNAMENT_FINAL_RESULTS')}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-indigo-700 transition-colors text-sm"
              >
                <Trophy size={16} />
                Final results
              </button>
              <button
                onClick={() => onNavigate('TOURNAMENT_LEADERBOARD')}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 transition-colors text-sm"
              >
                <BarChart3 size={16} />
                Leaderboard
              </button>
            </>
          )}

          {(effectiveStatus === 'DRAFT' || effectiveStatus === 'UPCOMING') && (
            <button
              type="button"
              onClick={() => onNavigate('MEDAL_TABLE_PICKS')}
              className="bg-amber-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-amber-600 transition-colors text-sm"
            >
              <Medal size={16} />
              Medal table picks
            </button>
          )}

          {/* Sidebar toggle — only for admins building brackets */}
          {showDragDrop && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
              title={sidebarOpen ? 'Close panel' : 'Open Judokas panel'}
            >
              {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
            </button>
          )}

          {isReadOnly ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded-lg border border-slate-200">
              <Lock size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">
                {isCategoryClosed ? `${selectedCategory} Closed` : 'Picks Locked'}
              </span>
            </div>
          ) : showSaved ? (
            <div className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-lg font-bold shadow-lg shadow-green-500/20 animate-pulse">
              <Check size={18} />
              Saved!
            </div>
          ) : (
            <button 
              onClick={handleSave}
              disabled={isSubmitting}
              className="bg-primary text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>}
              {isSubmitting ? 'Saving...' : 'Save Picks'}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* --- JUDOKA SIDEBAR (admin bracket building only) --- */}
        {sidebarOpen && showDragDrop && (
          <aside
            className="w-72 bg-white border-r border-slate-200 flex flex-col flex-shrink-0"
            onDragOver={(e) => { e.preventDefault(); setSidebarDropActive(true); }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setSidebarDropActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setSidebarDropActive(false);
              try {
                const raw = e.dataTransfer.getData('application/json');
                if (raw) handleUnassignCompetitor(JSON.parse(raw) as Competitor);
              } catch { /* ignore */ }
            }}
          >
            {/* Drop-to-remove zone */}
            <div className={`mx-2 mt-2 mb-1 rounded-lg border-2 border-dashed flex items-center justify-center gap-2 transition-all text-xs font-bold uppercase tracking-wider py-2 ${
              sidebarDropActive
                ? 'border-red-400 bg-red-50 text-red-500'
                : 'border-slate-200 text-slate-300'
            }`}>
              <span>{sidebarDropActive ? '↩ Drop to unassign' : 'Drag here to remove'}</span>
            </div>

            <div className="p-3 border-b border-slate-100">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
                Judokas ({totalSidebar})
              </h3>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search..."
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
                    Unplaced ({filteredSidebarCompetitors.unplaced.length})
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
                    Placed ({filteredSidebarCompetitors.placed.length})
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
                  {sidebarSearch ? 'No results found' : 'No judokas in this category'}
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
              {mainMatches.filter(m => m.round === 'F').map(finalMatch => (
                <BracketNode
                  key={finalMatch.id}
                  match={finalMatch}
                  matches={mainMatches}
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

            {/* ── REPECHAGE & BRONZE SECTION ─────────────────────────────────── */}
            {hasRepechageSection && (
              <div className="mt-14 pt-10 border-t-2 border-dashed border-slate-300">

                {/* Repechage round */}
                {repMatches.length > 0 && (
                  <div className="mb-10">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 text-center">
                      Repechage
                    </p>
                    <div className="flex gap-12 justify-center">
                      {repMatches.map((m, i) => (
                        <div key={m.id} className="flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {repMatches.length > 1 ? `Pool ${i === 0 ? 'A/B' : 'C/D'}` : 'Repechage'}
                          </span>
                          <MatchCard
                            match={m}
                            onPick={handlePick}
                            selectedId={picks[m.id]}
                            topCompetitor={m.competitor1}
                            bottomCompetitor={m.competitor2}
                            isLocked={isReadOnly || !m.competitor1 || !m.competitor2}
                            resultStatus={
                              matchResults[m.id] && picks[m.id]
                                ? (matchResults[m.id] === picks[m.id] ? 'correct' : 'incorrect')
                                : null
                            }
                            actualWinnerId={matchResults[m.id]}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bronze medal matches */}
                {bronzeMatches.length > 0 && (
                  <div>
                    <p className="text-xs font-black text-amber-600 uppercase tracking-widest mb-2 text-center">
                      🥉 Bronze Medal {bronzeMatches.length > 1 ? 'Matches' : 'Match'}
                    </p>
                    {bronzeMatches.length > 1 && (
                      <p className="text-[10px] text-slate-400 text-center mb-5">
                        Cross-over: SF_1 loser vs REP C/D winner · SF_2 loser vs REP A/B winner
                      </p>
                    )}
                    <div className="flex gap-12 justify-center">
                      {bronzeMatches.map((m, i) => (
                        <div key={m.id} className="flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                            {bronzeMatches.length > 1 ? `Bronze ${i + 1}` : 'Bronze'}
                          </span>
                          <MatchCard
                            match={m}
                            onPick={handlePick}
                            selectedId={picks[m.id]}
                            topCompetitor={m.competitor1}
                            bottomCompetitor={m.competitor2}
                            isLocked={isReadOnly || !m.competitor1 || !m.competitor2}
                            resultStatus={
                              matchResults[m.id] && picks[m.id]
                                ? (matchResults[m.id] === picks[m.id] ? 'correct' : 'incorrect')
                                : null
                            }
                            actualWinnerId={matchResults[m.id]}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          {/* ── ADDITIONAL PICK (Zusatztipp) ───────────────────────────── */}
          {(() => {
            const allAthletes: Competitor[] = matches
              .filter(m => m.round === 'R1')
              .reduce<Competitor[]>((acc, m) => {
                if (m.competitor1) acc.push(m.competitor1);
                if (m.competitor2) acc.push(m.competitor2);
                return acc;
              }, []);
            const uniqueAthletes: Competitor[] = Array.from(
              new Map(allAthletes.map(c => [c.id, c])).values()
            ).sort((a, b) => a.name.localeCompare(b.name));
            const eligibleForAp = uniqueAthletes.filter((c) => !predictedMedalistIds.has(c.id));
            const selectedAP = picks['additional_pick'] || '';
            const apResult = matchResults && selectedAP
              ? (() => {
                  // check if in actual standings: look through match results for F/B/SF to see position
                  const finalM = matches.find(m => m.round === 'F');
                  const bronzeMs = matches.filter(m => m.round === 'B');
                  const sfMs = matches.filter(m => m.round === 'SF');
                  const allFinalMatches = [finalM, ...bronzeMs, ...sfMs].filter(Boolean);
                  const isTop7 = allFinalMatches.some(m => m && (matchResults[m!.id] === selectedAP || m!.competitor1?.id === selectedAP || m!.competitor2?.id === selectedAP));
                  return null; // detailed result shown in leaderboard
                })()
              : null;
            if (uniqueAthletes.length === 0) return null;
            return (
              <div className="mt-10 pt-8 border-t-2 border-dashed border-slate-300">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 text-center">
                  Additional Pick — Zusatztipp
                </p>
                <div className="flex justify-center">
                  <div className="w-80 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <p className="text-xs text-slate-500 mb-3">
                      Select one athlete you think will finish in the <strong>Top 7</strong> who is <strong>not</strong> one of your predicted medalists (gold/silver/bronze):
                    </p>
                    <select
                      value={selectedAP && !predictedMedalistIds.has(selectedAP) ? selectedAP : ''}
                      onChange={(e) => {
                        if (!isReadOnly) {
                          const v = e.target.value;
                          setPicks((prev) => {
                            const next = { ...prev };
                            if (!v) delete next['additional_pick'];
                            else next['additional_pick'] = v;
                            return next;
                          });
                        }
                      }}
                      disabled={isReadOnly}
                      className="w-full h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none disabled:opacity-60"
                    >
                      <option value="">— No selection —</option>
                      {eligibleForAp.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.country})</option>
                      ))}
                    </select>
                    {selectedAP && (
                      <p className="mt-2 text-[11px] text-slate-400 text-center">
                        +{2} pts if this athlete reaches the top 7
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          </div>
        </main>
      </div>

      {/* --- PICKS CONFIRMATION MODAL --- */}
      {showConfirmation && pendingSaveData && (() => {
        const standings = deriveStandings(matches, pendingSaveData.picks);
        const positionLabel: Record<number, string> = { 1: 'Gold', 2: 'Silver', 3: 'Bronze', 5: '5th', 7: '7th' };
        const positionColor: Record<number, string> = {
          1: 'text-yellow-600 font-black',
          2: 'text-slate-500 font-bold',
          3: 'text-amber-700 font-bold',
          5: 'text-slate-500',
          7: 'text-slate-400',
        };
        const apId = pendingSaveData.picks['additional_pick'];
        const apCompetitor = apId ? matches.flatMap(m => [m.competitor1, m.competitor2]).find(c => c?.id === apId) : null;
        const bracketPickCount = Object.keys(pendingSaveData.picks).filter(k => k !== 'additional_pick').length;

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="bg-primary text-white px-6 py-4">
                <h2 className="text-lg font-black">Confirm Picks — {selectedCategory}</h2>
                <p className="text-sm text-blue-100 mt-0.5">{bracketPickCount} match{bracketPickCount !== 1 ? 'es' : ''} picked · {pendingSaveData.completion}% complete</p>
              </div>

              <div className="p-6">
                {standings.length > 0 ? (
                  <table className="w-full text-sm mb-4">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left text-xs text-slate-400 uppercase pb-2 font-bold">Position</th>
                        <th className="text-left text-xs text-slate-400 uppercase pb-2 font-bold">Athlete</th>
                        <th className="text-left text-xs text-slate-400 uppercase pb-2 font-bold">Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((s, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className={`py-2 pr-3 ${positionColor[s.position] || 'text-slate-500'}`}>
                            {positionLabel[s.position] ?? `${s.position}th`}
                          </td>
                          <td className="py-2 pr-3 font-semibold text-slate-800">{s.competitorName}</td>
                          <td className="py-2 text-slate-500">
                            <div className="flex items-center gap-1.5">
                              <Flag countryCode={s.country} className="w-5 h-3.5 shadow-sm" />
                              <span>{s.country}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-slate-400 italic mb-4">No completed bracket path yet.</p>
                )}

                {apCompetitor && (
                  <div className="bg-slate-50 rounded-lg px-4 py-2 mb-4 text-sm flex items-center gap-2 border border-slate-200">
                    <Medal size={14} className="text-slate-500" />
                    <span className="text-slate-500 font-medium">Additional pick:</span>
                    <Flag countryCode={apCompetitor.country} className="w-4 h-3 shadow-sm" />
                    <span className="font-semibold text-slate-800">{apCompetitor.name}</span>
                    <span className="text-slate-500">{apCompetitor.country}</span>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirmation(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={handleConfirmSave}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary text-white font-bold hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    <CheckCircle size={16} />
                    Confirm Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default TournamentBracket;
