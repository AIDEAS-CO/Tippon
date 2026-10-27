import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ViewState, UserRole, UserPicks, Match, Tournament, Competitor, CategoryStatus, GoldenMatch } from '../types';
import MatchCard from '../components/MatchCard';
import MobileBracketTabs from '../components/MobileBracketTabs';
import BracketZoom from '../components/BracketZoom';
import { ArrowLeft, ChevronDown, Loader2, CheckCircle, Trophy, Lock, PanelLeftOpen, PanelLeftClose, Search, Check, Play, BarChart3, ClipboardCheck, Medal, MoreVertical } from 'lucide-react';
import { normalizeWeightCategoryLabel } from '../lib/rosterImportUtils';
import Flag from '../components/ui/Flag';
import { supabase } from '../lib/supabaseClient';
import { calculateMyScore, getCfg } from '../lib/scoringEngine';
import { buildMatchesForBracket, sortedUniqueRounds, getPredictedMedalistCompetitorIds, deriveStandings, resolveBracket } from '../lib/bracketUtils';
import { weightsMatch } from '../lib/rankings';
import { showToast } from '../lib/toast';

interface BracketProps {
  onNavigate: (view: ViewState) => void;
  returnView: ViewState;
  tournament: Tournament | null;
  existingPicks?: Record<string, UserPicks>;
  onSavePicks?: (tournamentId: string, category: string, picks: UserPicks, completion: number) => boolean | void | Promise<boolean | void>;
  userId?: string;
  userRole?: UserRole;
  onStatusChange?: (tournamentId: string, newStatus: string) => void;
  categoryStatuses?: Record<string, CategoryStatus>;
  medalTableStatus?: 'open' | 'locked';
  /** Admin only: mark/unmark a Golden Match. `points === null` removes it. */
  onToggleGolden?: (category: string, matchId: string, points: number | null) => void;
}

/** Same weight class despite label differences ('Men -60kg' vs '-60 kg'); empty labels never match. */
const sameCategory = (a: string, b: string) => !!a && !!b && weightsMatch(a, b);

/** Same athlete in a `bracket_data` slot: by stable id, else by name + country (legacy rows). */
const sameAthlete = (entry: any, c: Competitor) =>
  !!entry && ((!!entry.id && String(entry.id) === c.id) || (entry.name === c.name && entry.country === c.country));

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};

const BracketNode: React.FC<{
  match: Match;
  matches: Match[];
  renderCard: (match: Match) => React.ReactNode;
}> = ({ match, matches, renderCard }) => {
  const children = matches.filter(m => m.nextMatchId === match.id);
  const topChild = children.find(m => m.nextMatchSlot === 1);
  const bottomChild = children.find(m => m.nextMatchSlot === 2);

  return (
    <div className="flex items-center h-full">
      {(topChild || bottomChild) && (
        <div className="flex flex-col justify-around h-full relative">
          {topChild && (
            <div className="relative flex items-center flex-1">
              <BracketNode match={topChild} matches={matches} renderCard={renderCard} />
              <div className="w-4 border-t border-slate-300 absolute right-0 top-[50%] translate-x-full"></div>
            </div>
          )}
          {bottomChild && (
            <div className="relative flex items-center flex-1">
              <BracketNode match={bottomChild} matches={matches} renderCard={renderCard} />
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
        {renderCard(match)}
      </div>
    </div>
  );
};

const TournamentBracket: React.FC<BracketProps> = ({ onNavigate, returnView, tournament, existingPicks, onSavePicks, userId, userRole, onStatusChange, categoryStatuses, medalTableStatus = 'open', onToggleGolden }) => {
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
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [mobileTabByCategory, setMobileTabByCategory] = useState<Record<string, string>>({});
  const [liveCategoryStatuses, setLiveCategoryStatuses] = useState<Record<string, CategoryStatus> | null>(null);
  const [livePicksLocked, setLivePicksLocked] = useState<boolean>(!!tournament?.picksLocked);
  const [goldenMatches, setGoldenMatches] = useState<GoldenMatch[]>(tournament?.goldenMatches || []);
  const isMobile = useMediaQuery('(max-width: 767px)');

  useEffect(() => { setLivePicksLocked(!!tournament?.picksLocked); }, [tournament?.picksLocked]);
  useEffect(() => { setGoldenMatches(tournament?.goldenMatches || []); }, [tournament?.goldenMatches]);

  // Fresh lock state: fetch category statuses + tournament flags, then follow realtime changes
  useEffect(() => {
    const tid = tournament?.id;
    if (!tid) return;
    let cancelled = false;

    const fetchCategoryStatuses = async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('name, status')
        .eq('tournament_id', tid);
      if (cancelled || error || !data) return;
      const map: Record<string, CategoryStatus> = {};
      data.forEach((row: any) => { map[row.name] = (row.status as CategoryStatus) || 'open'; });
      setLiveCategoryStatuses(map);
    };

    const applyTournamentRow = (row: any) => {
      if (!row || cancelled) return;
      if (typeof row.picks_locked === 'boolean') setLivePicksLocked(row.picks_locked);
      if (Array.isArray(row.golden_matches)) {
        setGoldenMatches(row.golden_matches.map((g: any) => ({
          category: String(g.category ?? ''),
          matchId: String(g.matchId ?? g.match_id ?? ''),
          points: Number(g.points) || 0,
        })));
      }
      if (row.status) setLocalStatus(String(row.status).toUpperCase());
    };

    fetchCategoryStatuses();
    supabase.from('tournaments').select('*').eq('id', tid).maybeSingle()
      .then(({ data }) => applyTournamentRow(data));

    const channel = supabase
      .channel(`bracket-locks-${tid}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `tournament_id=eq.${tid}` }, () => {
        fetchCategoryStatuses();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, (payload: any) => {
        applyTournamentRow(payload.new);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tournament?.id, selectedCategory]);

  const handleMobileTabChange = useCallback((tab: string) => {
    setMobileTabByCategory(prev => (prev[selectedCategory] === tab ? prev : { ...prev, [selectedCategory]: tab }));
  }, [selectedCategory]);

  useEffect(() => {
    if (tournament?.status) {
      setLocalStatus(tournament.status.toUpperCase());
    }
  }, [tournament?.status]);

  const isAdmin = userRole === 'ADMIN';
  const effectiveStatus = (localStatus || tournament?.status || '').toUpperCase();
  const statusMap: Record<string, CategoryStatus> = { ...(categoryStatuses || {}), ...(liveCategoryStatuses || {}) };
  const lookupCategoryStatus = (cat: string): CategoryStatus | undefined =>
    statusMap[cat] ?? Object.entries(statusMap).find(([name]) => sameCategory(name, cat))?.[1];
  const catStatus = lookupCategoryStatus(selectedCategory);
  const isCategoryClosed = catStatus === 'closed';
  const isCategoryLocked = catStatus === 'locked' || catStatus === 'closed' || livePicksLocked;
  const isReadOnly = effectiveStatus === 'COMPLETED' || isCategoryLocked;
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

  const goldenByMatch = useMemo(() => {
    const map = new Map<string, number>();
    goldenMatches.forEach(g => {
      if (sameCategory(g.category, selectedCategory)) map.set(g.matchId, g.points);
    });
    return map;
  }, [goldenMatches, selectedCategory]);

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
          ).sort() as string[];

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
                id: bd.competitor1.id ? String(bd.competitor1.id) : `pdf-${m.id}-competitor1`,
                name: bd.competitor1.name,
                country: bd.competitor1.country || 'N/A',
                flagUrl: '',
              });
            }
            if (bd?.competitor2?.name) {
              categoryCompetitors.push({
                id: bd.competitor2.id ? String(bd.competitor2.id) : `pdf-${m.id}-competitor2`,
                name: bd.competitor2.name,
                country: bd.competitor2.country || 'N/A',
                flagUrl: '',
              });
            }
          });

          // Pool must include every roster athlete in this weight class — not only names
          // still present in bracket_data. After unassign, slots are null in DB; those
          // judokas would otherwise disappear from the sidebar when reloading the category.
          const selNorm = normalizeWeightCategoryLabel(selectedCategory || '');
          Object.values(rosterMap).forEach((athlete: Competitor) => {
            const w = (athlete as Competitor & { weight?: string }).weight || '';
            if (!w || !selNorm) return;
            const wNorm = normalizeWeightCategoryLabel(w);
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
              // Only picks saved in the DB are scored — never device-only (localStorage) picks.
              if (userId && Object.keys(savedDb).length > 0) {
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

        // Rehydrate winners (drops picks that no longer fit the bracket) and the champion
        const resolved = resolveBracket(freshMatches, mergedPicks);
        const finalMatch = resolved.matches.find(m => m.round === 'F');
        setChampion(finalMatch ? resolved.picks[finalMatch.id] || null : null);
        setMatches(resolved.matches);
        setPicks(resolved.picks);
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
    if (!confirm('Start the tournament? Lock categories individually from Enter Results.')) return;
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
      showToast('error', 'Error changing tournament status.');
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

    persistBracketData(withoutCompetitor(competitor));
  };

  /** bracket_data of every R1 row that holds `competitor`, with that athlete removed. */
  const withoutCompetitor = (competitor: Competitor): Map<string, any> => {
    const out = new Map<string, any>();
    rawDbMatches.forEach((r: any) => {
      const bd = r.bracket_data || {};
      const in1 = sameAthlete(bd.competitor1, competitor);
      const in2 = sameAthlete(bd.competitor2, competitor);
      if (in1 || in2) {
        out.set(r.id, { ...bd, competitor1: in1 ? null : bd.competitor1, competitor2: in2 ? null : bd.competitor2 });
      }
    });
    return out;
  };

  /** Writes R1 bracket_data changes and keeps rawDbMatches in sync so later edits start from them. */
  const persistBracketData = (changes: Map<string, any>) => {
    if (changes.size === 0) return;
    setRawDbMatches(prev => prev.map((r: any) => (changes.has(r.id) ? { ...r, bracket_data: changes.get(r.id) } : r)));
    changes.forEach((bd, id) => {
      supabase.from('competition_brackets')
        .update({ bracket_data: bd })
        .eq('id', id)
        .then(({ error }) => { if (error) console.error('Error saving bracket slot:', error); });
    });
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

    // Persist: clear the athlete's previous slot, then fill the target slot
    const dbMatch = rawDbMatches.find((m: any) => m.id === matchId);
    if (dbMatch) {
      const changes = withoutCompetitor(competitor);
      const updatedBd = { ...(changes.get(matchId) ?? dbMatch.bracket_data ?? {}) };
      // Keep the athlete id so picks keyed by it stay valid (same id rule as buildMatchesForBracket)
      updatedBd[slot] = { id: competitor.id, name: competitor.name, country: competitor.country };
      changes.set(matchId, updatedBd);
      persistBracketData(changes);
    }
  };

  // --- PICK HANDLER ---
  const handlePick = (matchId: string, competitorId: string) => {
    if (isReadOnly) return;
    if (!matches.some(m => m.id === matchId)) return;

    // Re-propagate from R1 so later-round picks that depended on the old winner are cleared
    const resolved = resolveBracket(matches, { ...picks, [matchId]: competitorId });
    const newPicks = resolved.picks;
    const medalists = getPredictedMedalistCompetitorIds(resolved.matches, newPicks);
    if (newPicks['additional_pick'] && medalists.has(newPicks['additional_pick'])) {
      delete newPicks['additional_pick'];
    }

    setMatches(resolved.matches);
    setPicks(newPicks);
    const finalMatch = resolved.matches.find(m => m.round === 'F');
    setChampion(finalMatch ? newPicks[finalMatch.id] || null : null);
  };

  // --- GOLDEN MATCH TOGGLE (admin) ---
  const handleToggleGolden = (matchId: string) => {
    if (!isAdmin || !onToggleGolden || !selectedCategory) return;
    if (goldenByMatch.has(matchId)) {
      onToggleGolden(selectedCategory, matchId, null);
      setGoldenMatches(prev => prev.filter(g => !(g.matchId === matchId && sameCategory(g.category, selectedCategory))));
      return;
    }
    const raw = window.prompt('Golden Match bonus points:', '5');
    if (raw === null) return;
    const points = Number(raw);
    if (!Number.isFinite(points) || points <= 0) {
      showToast('error', 'Enter a positive number of points.');
      return;
    }
    onToggleGolden(selectedCategory, matchId, points);
    setGoldenMatches(prev => [
      ...prev.filter(g => !(g.matchId === matchId && sameCategory(g.category, selectedCategory))),
      { category: selectedCategory, matchId, points },
    ]);
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

    // Same basis as the progress bar: empty R1 fights can never be picked
    const pickable = matches.filter(m => !(m.round === 'R1' && !m.competitor1 && !m.competitor2));
    const completion = pickable.length > 0
      ? Math.round((pickable.filter(m => !!toSave[m.id]).length / pickable.length) * 100)
      : 0;

    setPendingSaveData({ picks: toSave, completion });
    setShowConfirmation(true);
  };

  // --- SAVE HANDLER (phase 2: confirmed) ---
  const handleConfirmSave = async () => {
    if (!tournament || !pendingSaveData) return;
    setShowConfirmation(false);
    setIsSubmitting(true);

    const { picks: toSave, completion } = pendingSaveData;
    const ok = (await onSavePicks?.(tournament.id, selectedCategory, toSave, completion)) !== false;
    setIsSubmitting(false);
    setPendingSaveData(null);
    // Rejected (picks locked): the parent already showed an error toast
    if (!ok) return;

    try {
      const storageKey = `tippon-picks-${userId || 'anon'}-${tournament.id}-${selectedCategory}`;
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    } catch { /* storage unavailable */ }
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2500);
  };

  if (isLoading) return <div className="h-full min-h-[50vh] flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={48} /></div>;

  const mainMatches = matches.filter(m => m.roundType !== 'repechage' && m.roundType !== 'bronze');
  const repMatches = matches.filter(m => m.roundType === 'repechage');
  const bronzeMatches = matches.filter(m => m.roundType === 'bronze');
  const hasRepechageSection = repMatches.length > 0 || bronzeMatches.length > 0;
  const roundsToRender = sortedUniqueRounds(mainMatches);
  const totalSidebar = filteredSidebarCompetitors.unplaced.length + filteredSidebarCompetitors.placed.length;

  // Progress: matches that can ever be picked (skip empty R1 slots)
  const pickableMatches = matches.filter(m => !(m.round === 'R1' && !m.competitor1 && !m.competitor2));
  const pickedCount = pickableMatches.filter(m => !!picks[m.id]).length;
  const pickableCount = pickableMatches.length;
  const progressPct = pickableCount > 0 ? Math.round((pickedCount / pickableCount) * 100) : 0;

  const isPrePicks = effectiveStatus === 'DRAFT' || effectiveStatus === 'UPCOMING';
  const showMedalLockedBadge = isPrePicks && medalTableStatus === 'locked' && !isAdmin;

  const lockMessage = !isReadOnly
    ? null
    : effectiveStatus === 'COMPLETED'
    ? 'Tournament completed — picks are read-only.'
    : isCategoryClosed
    ? `${selectedCategory} is closed — picks are read-only.`
    : catStatus === 'locked'
    ? `Picks locked for ${selectedCategory}.`
    : 'Picks locked for this tournament.';

  // Secondary header actions (buttons on desktop, overflow menu on phone)
  const headerActions: { key: string; label: string; icon: React.ReactNode; onClick: () => void; className: string }[] = [];
  if (isAdmin && effectiveStatus !== 'COMPLETED' && effectiveStatus !== 'LIVE') {
    headerActions.push({ key: 'start', label: 'Start Tournament', icon: <Play size={16} />, onClick: handleGoLive, className: 'bg-red-500 hover:bg-red-600' });
  }
  if (isAdmin && effectiveStatus === 'LIVE') {
    headerActions.push({ key: 'results', label: 'Enter Results', icon: <ClipboardCheck size={16} />, onClick: () => onNavigate('TOURNAMENT_RESULTS'), className: 'bg-emerald-600 hover:bg-emerald-700' });
  }
  if (effectiveStatus === 'COMPLETED') {
    headerActions.push({ key: 'final', label: 'Final results', icon: <Trophy size={16} />, onClick: () => onNavigate('TOURNAMENT_FINAL_RESULTS'), className: 'bg-indigo-600 hover:bg-indigo-700' });
    headerActions.push({ key: 'leaderboard', label: 'Leaderboard', icon: <BarChart3 size={16} />, onClick: () => onNavigate('TOURNAMENT_LEADERBOARD'), className: 'bg-purple-600 hover:bg-purple-700' });
  }
  if (isPrePicks && medalTableStatus === 'open') {
    headerActions.push({ key: 'medal', label: 'Medal table picks', icon: <Medal size={16} />, onClick: () => onNavigate('MEDAL_TABLE_PICKS'), className: 'bg-amber-500 hover:bg-amber-600' });
  }

  const renderCard = (m: Match, opts: { fullWidth?: boolean; allowDrop?: boolean } = {}) => {
    const missingSlot = !m.competitor1 || !m.competitor2;
    const structurallyLocked = m.round === 'R1' || m.roundType === 'repechage' || m.roundType === 'bronze'
      ? missingSlot
      : false;
    return (
      <MatchCard
        match={m}
        onPick={handlePick}
        onDropCompetitor={opts.allowDrop && showDragDrop ? handleDropCompetitor : undefined}
        selectedId={picks[m.id]}
        topCompetitor={m.competitor1}
        bottomCompetitor={m.competitor2}
        isLocked={isReadOnly || structurallyLocked}
        resultStatus={
          matchResults[m.id] && picks[m.id]
            ? (matchResults[m.id] === picks[m.id] ? 'correct' : 'incorrect')
            : null
        }
        actualWinnerId={matchResults[m.id]}
        fullWidth={opts.fullWidth}
        isGolden={goldenByMatch.has(m.id)}
        goldenPoints={goldenByMatch.get(m.id)}
        onToggleGolden={isAdmin && onToggleGolden ? handleToggleGolden : undefined}
      />
    );
  };

  // ── ADDITIONAL PICK (Zusatztipp) ───────────────────────────────────────
  const athleteById = new Map<string, Competitor>();
  matches.filter(m => m.round === 'R1').forEach(m => {
    if (m.competitor1) athleteById.set(m.competitor1.id, m.competitor1);
    if (m.competitor2) athleteById.set(m.competitor2.id, m.competitor2);
  });
  const uniqueAthletes: Competitor[] = [];
  athleteById.forEach(c => uniqueAthletes.push(c));
  uniqueAthletes.sort((a, b) => a.name.localeCompare(b.name));
  const eligibleForAp = uniqueAthletes.filter((c) => !predictedMedalistIds.has(c.id));
  const selectedAP = picks['additional_pick'] || '';
  const additionalPickCard = uniqueAthletes.length === 0 ? null : (
    <div className="w-full max-w-sm mx-auto bg-white rounded-xl border border-slate-200 shadow-sm p-4">
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
        className="w-full h-11 px-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none disabled:opacity-60"
      >
        <option value="">— No selection —</option>
        {eligibleForAp.map((c) => (
          <option key={c.id} value={c.id}>{c.name} ({c.country})</option>
        ))}
      </select>
      {selectedAP && (
        <p className="mt-2 text-[11px] text-slate-400 text-center">
          +{getCfg(tournament?.scoring_configuration, 'additional_pick_top7')} pts if this athlete reaches the top 7
        </p>
      )}
    </div>
  );

  const championName = (() => {
    if (!champion) return '';
    const match = matches.find(m => m.competitor1?.id === champion || m.competitor2?.id === champion);
    if (!match) return '';
    return match.competitor1?.id === champion ? match.competitor1.name : match.competitor2?.name;
  })();

  return (
    <div className="flex flex-col min-h-full md:h-full bg-slate-50 md:overflow-hidden">
      <header className="bg-white px-3 py-3 md:p-4 border-b flex flex-wrap justify-between items-center gap-3 shadow-sm">
        <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
          <button onClick={() => onNavigate(returnView)} className="p-2 hover:bg-slate-100 rounded-full flex-shrink-0" aria-label="Back"><ArrowLeft size={20}/></button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-base md:text-lg truncate max-w-[60vw] md:max-w-none">{tournament?.name}</h1>
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
                <button onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)} className="text-primary text-sm font-bold flex items-center gap-1 py-1">
                {selectedCategory || 'Select category'} <ChevronDown size={14}/>
                </button>
                {isCategoryDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsCategoryDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-md shadow-lg border border-slate-200 z-50 max-h-72 overflow-y-auto">
                      <ul className="py-1">
                        {categories.map(cat => {
                          const st = lookupCategoryStatus(cat);
                          return (
                            <li key={cat}>
                              <button
                                onClick={() => { setSelectedCategory(cat); setIsCategoryDropdownOpen(false); }}
                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2 ${selectedCategory === cat ? 'font-bold text-primary bg-blue-50' : 'text-slate-700'}`}
                              >
                                <span className="flex-1">{cat}</span>
                                {st === 'locked' && <Lock size={12} className="text-amber-400 flex-shrink-0" />}
                                {st === 'closed' && <Lock size={12} className="text-slate-400 flex-shrink-0" />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </>
                )}
            </div>
          </div>
        </div>

        {/* Desktop / tablet actions */}
        <div className="hidden md:flex flex-wrap items-center justify-end gap-2">
          {headerActions.map(a => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              className={`${a.className} text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors text-sm`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
          {showMedalLockedBadge && (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-600 rounded-lg border border-purple-200 text-sm font-bold">
              <Lock size={14} />
              Medal picks locked
            </div>
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
        </div>

        {/* Phone: overflow menu */}
        {(headerActions.length > 0 || showMedalLockedBadge) && (
          <div className="relative md:hidden">
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen(o => !o)}
              className="p-2 rounded-full hover:bg-slate-100 text-slate-600"
              aria-label="More actions"
            >
              <MoreVertical size={20} />
            </button>
            {isMoreMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsMoreMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-slate-200 z-50 py-1">
                  {headerActions.map(a => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => { setIsMoreMenuOpen(false); a.onClick(); }}
                      className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                    >
                      {a.icon}
                      {a.label}
                    </button>
                  ))}
                  {showMedalLockedBadge && (
                    <div className="px-4 py-3 text-sm font-semibold text-purple-600 flex items-center gap-3">
                      <Lock size={16} />
                      Medal picks locked
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {lockMessage && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 text-amber-800 text-sm font-semibold">
          <Lock size={16} className="flex-shrink-0" />
          <span>{lockMessage}</span>
        </div>
      )}

      <div className="flex flex-1 md:min-h-0 md:overflow-hidden">
        {/* --- JUDOKA SIDEBAR (admin bracket building only, desktop) --- */}
        {sidebarOpen && showDragDrop && !isMobile && (
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

        {isMobile ? (
          /* --- PHONE: tabbed match list --- */
          <main className="flex-1 min-w-0">
            <MobileBracketTabs
              matches={matches}
              picks={picks}
              activeTab={mobileTabByCategory[selectedCategory]}
              onTabChange={handleMobileTabChange}
              renderMatch={(m) => renderCard(m, { fullWidth: true })}
              extraPick={additionalPickCard}
            />
            {champion && (
              <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border-2 border-gold bg-white p-3 shadow">
                <Trophy size={28} className="text-gold flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Your champion</p>
                  <p className="font-black uppercase text-slate-800 truncate">{championName}</p>
                </div>
              </div>
            )}
          </main>
        ) : (
          /* --- DESKTOP / TABLET: zoomable tree --- */
          <main className="flex-1 min-w-0 overflow-auto p-6 lg:p-12">
            <BracketZoom>
              <div className="flex flex-col">
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

                <div className="flex items-center">
                  {mainMatches.filter(m => m.round === 'F').map(finalMatch => (
                    <BracketNode
                      key={finalMatch.id}
                      match={finalMatch}
                      matches={mainMatches}
                      renderCard={(m) => renderCard(m, { allowDrop: true })}
                    />
                  ))}

                  <div className="flex items-center h-full">
                    <div className="w-8 border-t border-slate-300"></div>
                    <div className={`w-64 h-48 rounded-xl border-2 flex flex-col items-center justify-center gap-4 ml-4 ${champion ? 'border-gold bg-white shadow-xl' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                      <Trophy size={48} className={champion ? 'text-gold' : 'text-slate-200'} />
                      {champion && <span className="font-black text-center px-4 uppercase text-lg text-slate-800">{championName}</span>}
                      {!champion && <span className="text-sm font-medium text-slate-400">Complete your bracket</span>}
                    </div>
                  </div>
                </div>
              </div>
            </BracketZoom>

            {/* ── REPECHAGE & BRONZE SECTION ─────────────────────────────────── */}
            {hasRepechageSection && (
              <div className="mt-14 pt-10 border-t-2 border-dashed border-slate-300">
                {repMatches.length > 0 && (
                  <div className="mb-10">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 text-center">
                      Repechage
                    </p>
                    <div className="flex flex-wrap gap-8 lg:gap-12 justify-center">
                      {repMatches.map((m, i) => (
                        <div key={m.id} className="flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {repMatches.length > 1 ? `Pool ${i === 0 ? 'A/B' : 'C/D'}` : 'Repechage'}
                          </span>
                          {renderCard(m)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                    <div className="flex flex-wrap gap-8 lg:gap-12 justify-center">
                      {bronzeMatches.map((m, i) => (
                        <div key={m.id} className="flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                            {bronzeMatches.length > 1 ? `Bronze ${i + 1}` : 'Bronze'}
                          </span>
                          {renderCard(m)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── ADDITIONAL PICK (Zusatztipp) ───────────────────────────── */}
            {additionalPickCard && (
              <div className="mt-10 pt-8 pb-4 border-t-2 border-dashed border-slate-300">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 text-center">
                  Additional Pick — Zusatztipp
                </p>
                {additionalPickCard}
              </div>
            )}
          </main>
        )}
      </div>

      {/* --- STICKY SAVE BAR --- */}
      {!isReadOnly && (
        <div className="sticky bottom-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-3">
          <div className="flex-1 min-w-0 md:max-w-md">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-black text-slate-800 tabular-nums">{pickedCount} / {pickableCount}</span>
              <span className="text-xs text-slate-500 truncate">picks · {selectedCategory}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${progressPct === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <div className="md:ml-auto flex-shrink-0">
            {showSaved ? (
              <div className="flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white rounded-lg font-bold shadow-lg shadow-green-500/20 animate-pulse">
                <Check size={18} />
                Saved!
              </div>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSubmitting}
                className="bg-primary text-white px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>}
                {isSubmitting ? 'Saving...' : 'Save picks'}
              </button>
            )}
          </div>
        </div>
      )}

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
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90dvh]">
              <div className="bg-primary text-white px-6 py-4 flex-shrink-0">
                <h2 className="text-lg font-black">Confirm Picks — {selectedCategory}</h2>
                <p className="text-sm text-blue-100 mt-0.5">{bracketPickCount} match{bracketPickCount !== 1 ? 'es' : ''} picked · {pendingSaveData.completion}% complete</p>
              </div>

              <div className="p-6 overflow-y-auto flex-1 min-h-0">
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

              </div>
              <div className="flex gap-3 px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6 border-t border-slate-100 flex-shrink-0">
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
        );
      })()}
    </div>
  );
};

export default TournamentBracket;
