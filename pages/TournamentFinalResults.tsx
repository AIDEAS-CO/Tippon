import React, { useEffect, useState, useCallback } from 'react';
import {
  ViewState,
  Tournament,
  ScoringBreakdown,
  TournamentBonusBreakdown,
  CategoryStandings,
  MedalTableScoreBreakdown,
} from '../types';
import { supabase } from '../lib/supabaseClient';
import { buildMatchesForBracket, deriveStandings } from '../lib/bracketUtils';
import { computeCountryMedalRanking, type CountryMedalRow } from '../lib/countryMedalRanking';
import { MEDAL_TABLE_CATEGORY } from '../lib/tournamentConstants';
import Flag from '../components/ui/Flag';
import { ArrowLeft, Loader2, ChevronDown, Trophy } from 'lucide-react';

interface TournamentFinalResultsProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
}

function ordinalPosition(pos: number): string {
  if (pos === 1) return '1st';
  if (pos === 2) return '2nd';
  if (pos === 3) return '3rd';
  if (pos === 5) return '5th';
  if (pos === 7) return '7th';
  return `${pos}th`;
}

function medalEmoji(pos: number): string {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  return '';
}

function sortStandings(rows: CategoryStandings[]): CategoryStandings[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position || (a.competitorName || '').localeCompare(b.competitorName || '')
  );
}

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

const TournamentFinalResults: React.FC<TournamentFinalResultsProps> = ({ onNavigate, tournament }) => {
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [standings, setStandings] = useState<CategoryStandings[]>([]);
  const [loadingCat, setLoadingCat] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [leaderRows, setLeaderRows] = useState<
    { userId: string; total: number; name: string; username: string }[]
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userScoreRows, setUserScoreRows] = useState<any[] | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mainTab, setMainTab] = useState<'standings' | 'medalCountry'>('standings');
  const [countryMedalRows, setCountryMedalRows] = useState<CountryMedalRow[]>([]);
  const [loadingCountryMedals, setLoadingCountryMedals] = useState(false);
  const [medalTableUserPts, setMedalTableUserPts] = useState<
    { userId: string; points: number; name: string; username: string }[]
  >([]);

  const completed = (tournament?.status || '').toUpperCase() === 'COMPLETED';

  const loadLeaderboard = useCallback(async () => {
    if (!tournament?.id) return;
    setLoadingBoard(true);
    try {
      const { data: scoreRows, error } = await supabase
        .from('tournament_scores')
        .select('user_id, total_points')
        .eq('tournament_id', tournament.id);
      if (error && error.code !== '42P01') throw error;

      const byUser = new Map<string, number>();
      for (const r of scoreRows || []) {
        const uid = (r as any).user_id;
        byUser.set(uid, (byUser.get(uid) || 0) + ((r as any).total_points || 0));
      }

      const ids = Array.from(byUser.keys());
      if (ids.length === 0) {
        setLeaderRows([]);
        return;
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .in('id', ids);

      const pmap = new Map((profiles || []).map((p: any) => [p.id, p]));
      const rows = ids
        .map((userId) => ({
          userId,
          total: byUser.get(userId) || 0,
          name: pmap.get(userId)?.full_name || 'Player',
          username: pmap.get(userId)?.username || 'user',
        }))
        .sort((a, b) => b.total - a.total);

      setLeaderRows(rows);
    } catch (e) {
      console.error(e);
      setLeaderRows([]);
    } finally {
      setLoadingBoard(false);
    }
  }, [tournament?.id]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    const loadCats = async () => {
      if (!tournament?.id) return;
      const { data: dbMatches } = await supabase
        .from('competition_brackets')
        .select('weight_category')
        .eq('tournament_id', tournament.id);
      const cats = Array.from(
        new Set((dbMatches || []).map((m: any) => m.weight_category).filter(Boolean))
      ) as string[];
      cats.sort();
      setCategories(cats);
      if (cats.length && !selectedCategory) setSelectedCategory(cats[0]);
    };
    loadCats();
  }, [tournament?.id]);

  useEffect(() => {
    const loadCountryMedalData = async () => {
      if (!tournament?.id || categories.length === 0) {
        setCountryMedalRows([]);
        setMedalTableUserPts([]);
        setLoadingCountryMedals(false);
        return;
      }
      setLoadingCountryMedals(true);
      try {
        const hasRepechage = !!(tournament as any)?.scoring_configuration?.has_repechage;
        const [{ data: dbMatches }, { data: roster }, { data: resultRows }, { data: medalScoreRows }] =
          await Promise.all([
            supabase
              .from('competition_brackets')
              .select('*')
              .eq('tournament_id', tournament.id)
              .order('match_number', { ascending: true }),
            supabase.from('tournament_roster').select('*').eq('tournament_id', tournament.id),
            supabase
              .from('match_results')
              .select('category, match_id, winner_competitor_id')
              .eq('tournament_id', tournament.id),
            supabase
              .from('tournament_scores')
              .select('user_id, total_points')
              .eq('tournament_id', tournament.id)
              .eq('category', MEDAL_TABLE_CATEGORY),
          ]);

        const rosterMap: Record<string, any> = {};
        (roster || []).forEach((a: any) => {
          rosterMap[a.id] = {
            id: a.id,
            name: `${(a.last_name || '').toUpperCase()} ${a.first_name || ''}`.trim(),
            country: a.country || 'N/A',
            flagUrl: '',
            weight: a.weight_category,
          };
        });
        const resultsByCat = new Map<string, Record<string, string>>();
        for (const r of resultRows || []) {
          const row = r as { category: string; match_id: string; winner_competitor_id: string };
          if (!resultsByCat.has(row.category)) resultsByCat.set(row.category, {});
          resultsByCat.get(row.category)![row.match_id] = row.winner_competitor_id;
        }

        const rows = computeCountryMedalRanking(
          categories,
          dbMatches || [],
          rosterMap,
          resultsByCat,
          hasRepechage
        );
        setCountryMedalRows(rows);

        const byUser = new Map<string, number>();
        for (const r of medalScoreRows || []) {
          const uid = (r as any).user_id;
          byUser.set(uid, (byUser.get(uid) || 0) + ((r as any).total_points || 0));
        }
        const ids = Array.from(byUser.keys());
        if (ids.length === 0) {
          setMedalTableUserPts([]);
          return;
        }
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, username').in('id', ids);
        const pmap = new Map((profiles || []).map((p: any) => [p.id, p]));
        const mpts = ids
          .map((userId) => ({
            userId,
            points: byUser.get(userId) || 0,
            name: pmap.get(userId)?.full_name || 'Player',
            username: pmap.get(userId)?.username || 'user',
          }))
          .sort((a, b) => b.points - a.points);
        setMedalTableUserPts(mpts);
      } catch (e) {
        console.error(e);
        setCountryMedalRows([]);
        setMedalTableUserPts([]);
      } finally {
        setLoadingCountryMedals(false);
      }
    };
    loadCountryMedalData();
  }, [tournament?.id, categories]);

  useEffect(() => {
    const loadCat = async () => {
      if (!tournament?.id || !selectedCategory) {
        setLoadingCat(false);
        return;
      }
      setLoadingCat(true);
      try {
        const hasRepechage = !!(tournament as any)?.scoring_configuration?.has_repechage;
        const [{ data: dbMatches }, { data: roster }, { data: resultsData }] = await Promise.all([
          supabase
            .from('competition_brackets')
            .select('*')
            .eq('tournament_id', tournament.id)
            .eq('weight_category', selectedCategory)
            .order('match_number', { ascending: true }),
          supabase.from('tournament_roster').select('*').eq('tournament_id', tournament.id),
          supabase
            .from('match_results')
            .select('match_id, winner_competitor_id')
            .eq('tournament_id', tournament.id)
            .eq('category', selectedCategory),
        ]);

        const rosterMap: Record<string, any> = {};
        (roster || []).forEach((a: any) => {
          rosterMap[a.id] = {
            id: a.id,
            name: `${(a.last_name || '').toUpperCase()} ${a.first_name || ''}`.trim(),
            country: a.country || 'N/A',
            flagUrl: '',
            weight: a.weight_category,
          };
        });

        const fresh = buildMatchesForBracket(dbMatches || [], rosterMap, selectedCategory, hasRepechage);
        const actualMap: Record<string, string> = {};
        (resultsData || []).forEach((r: any) => {
          actualMap[r.match_id] = r.winner_competitor_id;
        });
        setStandings(sortStandings(deriveStandings(fresh, actualMap)));
      } finally {
        setLoadingCat(false);
      }
    };
    loadCat();
  }, [tournament?.id, selectedCategory]);

  useEffect(() => {
    const loadUserRows = async () => {
      if (!tournament?.id || !selectedUserId) {
        setUserScoreRows(null);
        return;
      }
      const { data } = await supabase
        .from('tournament_scores')
        .select('category, total_points, correct_picks, total_picks, breakdown')
        .eq('tournament_id', tournament.id)
        .eq('user_id', selectedUserId)
        .order('category');
      setUserScoreRows(data || []);
    };
    loadUserRows();
  }, [tournament?.id, selectedUserId]);

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500">No tournament selected.</p>
      </div>
    );
  }

  if (!completed) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <header className="bg-white border-b px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => onNavigate('BRACKET')} className="p-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={22} />
          </button>
          <h1 className="font-bold text-lg">Final results</h1>
        </header>
        <div className="flex-1 flex items-center justify-center p-6 text-slate-600 text-center">
          Final results are available after the tournament is finalized and closed.
        </div>
      </div>
    );
  }

  const categoryTitle = (c: string) =>
    c === '_medal_table_' ? 'Medal table' : c === '_bonuses_' ? 'Tournament bonuses' : c;

  const verifiedBreakdownSum =
    selectedUserId && userScoreRows
      ? userScoreRows.reduce((s, r: any) => s + (Number(r.total_points) || 0), 0)
      : null;
  const leaderTotalForSelected =
    selectedUserId ? leaderRows.find((x) => x.userId === selectedUserId)?.total ?? null : null;
  const totalsMatch =
    verifiedBreakdownSum !== null &&
    leaderTotalForSelected !== null &&
    verifiedBreakdownSum === leaderTotalForSelected;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('BRACKET')}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-600"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0">
            <h1 className="font-black text-slate-900 truncate text-lg">Final results</h1>
            <p className="text-xs text-slate-500 font-medium truncate">{tournament.name}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('TOURNAMENT_LEADERBOARD')}
          className="text-sm font-bold text-primary hover:underline"
        >
          Open leaderboard
        </button>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-4 pb-16 space-y-8">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 gap-1">
          <button
            type="button"
            onClick={() => setMainTab('standings')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-black transition-colors ${
              mainTab === 'standings' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Standings by category
          </button>
          <button
            type="button"
            onClick={() => setMainTab('medalCountry')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-black transition-colors ${
              mainTab === 'medalCountry' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Country medal table
          </button>
        </div>

        {mainTab === 'standings' && (
        <>
        <section>
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Trophy size={14} /> Actual standings (per category)
          </h2>
          <div className="relative mb-3">
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full max-w-sm flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-800"
            >
              {selectedCategory || 'Category'}
              <ChevronDown size={16} className="text-slate-400" />
            </button>
            {dropdownOpen && (
              <ul className="absolute z-20 mt-1 w-full max-w-sm bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {categories.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => {
                        setSelectedCategory(c);
                        setDropdownOpen(false);
                      }}
                    >
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {loadingCat ? (
            <Loader2 className="animate-spin text-primary" size={32} />
          ) : standings.length === 0 ? (
            <p className="text-sm text-slate-500">No saved results for this category yet.</p>
          ) : (
            <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {standings.map((row) => (
                <li key={`${row.position}-${row.competitorId}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="text-lg w-8">{medalEmoji(row.position) || '·'}</span>
                  <span className="font-bold text-slate-500 w-12">{ordinalPosition(row.position)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 truncate">{row.competitorName || row.competitorId}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Flag countryCode={row.country || 'N/A'} className="w-5 h-3.5" />
                      <span className="text-xs font-bold text-slate-500">{row.country}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">All players — total points</h2>
          {loadingBoard ? (
            <Loader2 className="animate-spin text-primary" size={32} />
          ) : leaderRows.length === 0 ? (
            <p className="text-sm text-slate-500">No scores stored for this tournament.</p>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Player</th>
                    <th className="px-3 py-2 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderRows.map((r, i) => (
                    <tr
                      key={r.userId}
                      className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50/50 ${
                        selectedUserId === r.userId ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => setSelectedUserId(r.userId)}
                    >
                      <td className="px-3 py-2 font-bold text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <span className="font-bold text-slate-900">{r.name}</span>
                        <span className="text-slate-400 text-xs ml-2">@{r.username}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-black text-primary">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}

        {mainTab === 'medalCountry' && (
          <section className="space-y-6">
            <div>
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
                Country medal table (actual results)
              </h2>
              {loadingCountryMedals ? (
                <Loader2 className="animate-spin text-primary" size={32} />
              ) : countryMedalRows.length === 0 ? (
                <p className="text-sm text-slate-500">No aggregated medal data yet.</p>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[320px]">
                    <thead className="bg-slate-50 text-left text-xs font-black text-slate-500 uppercase">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Country</th>
                        <th className="px-3 py-2 text-center">🥇</th>
                        <th className="px-3 py-2 text-center">🥈</th>
                        <th className="px-3 py-2 text-center">🥉</th>
                        <th className="px-3 py-2 text-right">Tot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {countryMedalRows.map((row, idx) => (
                        <tr key={row.country} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-bold text-slate-400">{idx + 1}</td>
                          <td className="px-3 py-2 font-bold text-slate-900">
                            <span className="inline-flex items-center gap-2">
                              <Flag countryCode={row.country} className="w-5 h-3.5" />
                              {row.country}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">{row.g}</td>
                          <td className="px-3 py-2 text-center">{row.s}</td>
                          <td className="px-3 py-2 text-center">{row.b}</td>
                          <td className="px-3 py-2 text-right font-bold">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
                Medal table points by player
              </h2>
              {loadingCountryMedals ? (
                <Loader2 className="animate-spin text-primary" size={32} />
              ) : medalTableUserPts.length === 0 ? (
                <p className="text-sm text-slate-500">No saved medal table scores.</p>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-black text-slate-500 uppercase">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2 text-right">Medal table pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medalTableUserPts.map((r, i) => (
                        <tr
                          key={r.userId}
                          className={`border-t border-slate-100 cursor-pointer hover:bg-indigo-50/50 ${
                            selectedUserId === r.userId ? 'bg-indigo-50' : ''
                          }`}
                          onClick={() => setSelectedUserId(r.userId)}
                        >
                          <td className="px-3 py-2 font-bold text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-slate-900">{r.name}</span>
                            <span className="text-slate-400 text-xs ml-2">@{r.username}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-black text-indigo-700">{r.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-2">
                Select a player to see the full breakdown below (including medal table and bonuses).
              </p>
            </div>
          </section>
        )}

        {selectedUserId && userScoreRows && (
          <section>
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
              Score breakdown — {leaderRows.find((x) => x.userId === selectedUserId)?.name || 'Player'}
            </h2>
            {verifiedBreakdownSum !== null && leaderTotalForSelected !== null && (
              <div
                className={`mb-3 rounded-xl border px-3 py-2 text-[11px] font-bold ${
                  totalsMatch
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                Verified total (weight categories + medal table + bonuses): {verifiedBreakdownSum} pts · Leaderboard:{' '}
                {leaderTotalForSelected} pts
                {totalsMatch ? ' ✓' : ' (recalculate if these differ)'}
              </div>
            )}
            <div className="space-y-3">
              {userScoreRows.map((catScore: any) => {
                const raw = catScore.breakdown;
                const ct = categoryTitle(catScore.category);

                if (isBonusBreakdown(raw)) {
                  const bb = raw;
                  return (
                    <div key={catScore.category} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex justify-between">
                        <span className="text-xs font-black text-slate-800">{ct}</span>
                        <span className="text-xs font-black text-amber-800">{catScore.total_points} pts</span>
                      </div>
                      <ul className="divide-y divide-slate-100 text-[11px] px-3 py-2">
                        {bb.bonusLines.map((line) => (
                          <li key={line.key} className="py-2">
                            <div className="flex justify-between gap-2">
                              <span className="font-bold text-slate-700">{line.label}</span>
                              <span className={line.earned ? 'text-green-600 font-black' : 'text-slate-400 font-bold'}>
                                {line.points > 0 ? `+${line.points}` : '0'} pts
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
                                  className="h-full bg-indigo-400 rounded transition-all"
                                  style={{ width: `${Math.min(100, Math.round(line.progressRatio * 100))}%` }}
                                />
                              </div>
                            )}
                            {line.detail && <p className="text-[10px] text-slate-500 mt-1">{line.detail}</p>}
                          </li>
                        ))}
                      </ul>
                      <div className="px-3 pb-2 flex justify-between border-t text-[11px] font-black">
                        <span>Total</span>
                        <span className="text-primary">{bb.categoryTotal} pts</span>
                      </div>
                    </div>
                  );
                }

                if (isMedalTableBreakdown(raw)) {
                  const mt = raw;
                  const pct =
                    mt.maxPossible > 0 ? Math.round((mt.categoryTotal / mt.maxPossible) * 100) : 0;
                  return (
                    <div key={catScore.category} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                        <span className="text-xs font-black text-slate-800">{ct}</span>
                        <span className="text-xs font-black text-indigo-800">{catScore.total_points} pts</span>
                      </div>
                      <p className="text-[10px] text-slate-600 px-3 pt-2">
                        {mt.categoryTotal}/{mt.maxPossible} possible pts ({pct}% of theoretical max for filled slots)
                      </p>
                      <ul className="divide-y divide-slate-100 text-[11px] px-3 py-2">
                        {mt.lines.map((line) => (
                          <li key={`${line.slot}-${line.country}`} className="py-2 flex justify-between gap-2">
                            <span className="text-slate-700">
                              Pred {line.slot}° → {line.country}: actual{' '}
                              {line.actualRank != null ? `${line.actualRank}°` : 'no medal'} (Δ{line.deviation})
                            </span>
                            <span className="text-green-600 font-black flex-shrink-0">{line.points} pts</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }

                if (isPositionBreakdown(raw)) {
                  const b = raw;
                  return (
                    <div key={catScore.category} className="bg-white rounded-xl border border-slate-200 overflow-hidden text-left">
                      <div className="px-3 py-2 bg-primary/5 border-b flex justify-between">
                        <span className="text-xs font-black text-slate-800">{ct}</span>
                        <span className="text-xs font-black text-primary">{catScore.total_points} pts</span>
                      </div>
                      <div className="px-3 py-2 space-y-2 text-[11px]">
                        {b.goldSilver.map((d) => (
                          <div key={`gs-${d.competitorId}`} className="flex justify-between">
                            <span className="text-slate-700">
                              G/S: {d.competitorName} — pred {d.predicted}° → act {d.actual ?? '—'} (Δ{d.deviation})
                            </span>
                            <span className="text-green-600 font-black">{d.points} pts</span>
                          </div>
                        ))}
                        {b.bronze.map((d) => (
                          <div key={`br-${d.competitorId}`} className="flex justify-between">
                            <span className="text-slate-700">
                              Bronze: {d.competitorName} — Δ{d.deviation}
                            </span>
                            <span className="text-green-600 font-black">{d.points} pts</span>
                          </div>
                        ))}
                        <p className="text-slate-500">
                          QF pool: {b.poolFinals.correct}/{b.poolFinals.total} = {b.poolFinals.points} pts
                        </p>
                        <p className="text-slate-500">
                          Additional pick: {b.additionalPick.points} pts
                          {b.additionalPick.actualPosition != null && ` (place ${b.additionalPick.actualPosition})`}
                        </p>
                        <p className="font-black text-primary border-t pt-2">Category: {b.categoryTotal} pts</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={catScore.category} className="bg-slate-50 rounded-xl border px-3 py-2 text-sm">
                    <span className="font-bold">{ct}</span>: {catScore.total_points} pts
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default TournamentFinalResults;
