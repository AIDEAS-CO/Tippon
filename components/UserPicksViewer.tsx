import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { Competitor, Match } from '../types';
import { supabase } from '../lib/supabaseClient';
import { buildMatchesForBracket, simulateBracket, sortedUniqueRounds } from '../lib/bracketUtils';
import { weightsMatch } from '../lib/rankings';

interface UserPicksViewerProps {
  tournamentId: string;
  userId: string;
  hasRepechage?: boolean;
  /** Global tournament lock (`tournaments.picks_locked`). */
  picksLocked?: boolean;
}

const ROUND_LABELS: Record<string, string> = {
  R1: 'Round 1', R2: 'Round 2', R3: 'Round 3', R4: 'Round 4',
  QF: 'Quarterfinals', REP: 'Repechage', SF: 'Semifinals',
  B: 'Bronze', BRONZE: 'Bronze', F: 'Final',
};

const MEDAL_KEY = '__medal_table__';
const MEDAL_ROWS: { key: string; label: string }[] = [
  { key: '_medal_table_men_', label: 'Men' },
  { key: '_medal_table_women_', label: 'Women' },
  { key: '_medal_table_total_', label: 'Total' },
  { key: '_medal_table_', label: 'Total' },
];

/**
 * Read-only view of another user's picks. RLS only returns rows that are visible to the
 * viewer (category locked/closed, global lock, own picks, or admin); everything else shows
 * as hidden.
 */
const UserPicksViewer: React.FC<UserPicksViewerProps> = ({ tournamentId, userId, hasRepechage = false, picksLocked = false }) => {
  const [loading, setLoading] = useState(true);
  const [picksByCat, setPicksByCat] = useState<Record<string, Record<string, string>>>({});
  const [bracketRows, setBracketRows] = useState<any[]>([]);
  const [rosterMap, setRosterMap] = useState<Record<string, Competitor>>({});
  const [catStatus, setCatStatus] = useState<{ name: string; status: string | null }[]>([]);
  const [medalTableStatus, setMedalTableStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [picksRes, bracketRes, rosterRes, catRes, tRes] = await Promise.all([
          supabase.from('user_picks').select('category, picks_data').eq('tournament_id', tournamentId).eq('user_id', userId),
          supabase.from('competition_brackets').select('*').eq('tournament_id', tournamentId).order('match_number', { ascending: true }),
          supabase.from('tournament_roster').select('*').eq('tournament_id', tournamentId),
          supabase.from('categories').select('name, status').eq('tournament_id', tournamentId),
          supabase.from('tournaments').select('medal_table_status').eq('id', tournamentId).single(),
        ]);
        if (cancelled) return;
        const picks: Record<string, Record<string, string>> = {};
        for (const r of picksRes.data || []) {
          if (r.picks_data && typeof r.picks_data === 'object') picks[r.category] = r.picks_data;
        }
        const roster: Record<string, Competitor> = {};
        for (const a of rosterRes.data || []) {
          roster[a.id] = {
            id: a.id,
            name: `${(a.last_name || '').toUpperCase()} ${a.first_name || ''}`.trim(),
            country: a.country || 'N/A',
            flagUrl: '',
            weight: a.weight_category,
          };
        }
        setPicksByCat(picks);
        setBracketRows(bracketRes.data || []);
        setRosterMap(roster);
        setCatStatus(catRes.data || []);
        setMedalTableStatus((tRes.data as any)?.medal_table_status ?? null);
      } catch (e) {
        console.error('[UserPicksViewer] load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tournamentId, userId]);

  const categories = useMemo(
    () => (Array.from(new Set(bracketRows.map((r: any) => r.weight_category).filter(Boolean))) as string[]).sort(),
    [bracketRows]
  );

  useEffect(() => {
    if (!selected && categories.length > 0) setSelected(categories[0]);
  }, [categories, selected]);

  const isVisible = (cat: string): boolean => {
    if (picksLocked) return true;
    if (cat === MEDAL_KEY) return medalTableStatus === 'locked';
    const row = catStatus.find((c) => weightsMatch(c.name, cat));
    return row?.status === 'locked' || row?.status === 'closed';
  };

  const matches: Match[] = useMemo(() => {
    if (!selected || selected === MEDAL_KEY) return [];
    const rows = bracketRows.filter((r: any) => r.weight_category === selected);
    const built = buildMatchesForBracket(rows, rosterMap, selected, hasRepechage);
    return simulateBracket(built, picksByCat[selected] || {});
  }, [selected, bracketRows, rosterMap, hasRepechage, picksByCat]);

  const findCompetitor = (id: string | undefined): Competitor | null => {
    if (!id) return null;
    if (rosterMap[id]) return rosterMap[id];
    for (const m of matches) {
      if (m.competitor1?.id === id) return m.competitor1;
      if (m.competitor2?.id === id) return m.competitor2;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-slate-400">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs font-bold">Loading picks...</span>
      </div>
    );
  }

  const tabs = [...categories, MEDAL_KEY];
  const picks = selected && selected !== MEDAL_KEY ? picksByCat[selected] : undefined;
  const hidden = (
    <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-xs font-bold">
      <Lock size={14} /> Hidden until picks are locked
    </div>
  );

  const renderCategory = () => {
    if (!picks) {
      return isVisible(selected) ? (
        <p className="text-center py-6 text-slate-400 text-xs font-bold">No picks made for this category.</p>
      ) : hidden;
    }
    const additional = findCompetitor(picks['additional_pick']);
    return (
      <div className="space-y-3">
        {sortedUniqueRounds(matches).map((round) => {
          const roundMatches = matches
            .filter((m) => m.round === round && (m.competitor1 || m.competitor2))
            .sort((a, b) => a.matchNumber - b.matchNumber);
          if (roundMatches.length === 0) return null;
          return (
            <div key={round}>
              <p className="font-black text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                {ROUND_LABELS[round] || round}
              </p>
              <ul className="space-y-1">
                {roundMatches.map((m) => {
                  const winnerId = picks[m.id];
                  const side = (c: Competitor | null) => (
                    <span
                      className={`flex-1 min-w-0 truncate px-1.5 py-0.5 rounded ${
                        c && c.id === winnerId ? 'bg-primary/10 text-primary font-black' : 'text-slate-500'
                      }`}
                    >
                      {c ? `${c.name} (${c.country})` : '—'}
                    </span>
                  );
                  return (
                    <li key={m.id} className="flex items-center gap-1 text-[11px] bg-white border border-slate-100 rounded-lg px-1 py-1">
                      {side(m.competitor1)}
                      <span className="text-[9px] text-slate-300 font-bold flex-shrink-0">vs</span>
                      {side(m.competitor2)}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <div className="flex justify-between items-center border-t border-slate-200 pt-2 text-[11px]">
          <span className="text-slate-500 font-bold">Additional pick</span>
          <span className="font-black text-slate-800 truncate ml-2">
            {additional ? `${additional.name} (${additional.country})` : '—'}
          </span>
        </div>
      </div>
    );
  };

  const renderMedalTable = () => {
    const rows = MEDAL_ROWS.filter((r) => picksByCat[r.key]);
    if (rows.length === 0) {
      return isVisible(MEDAL_KEY) ? (
        <p className="text-center py-6 text-slate-400 text-xs font-bold">No medal table picks.</p>
      ) : hidden;
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {rows.map((r) => {
          const ranks = picksByCat[r.key];
          const keys = Object.keys(ranks).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
          return (
            <div key={r.key} className="bg-white border border-slate-100 rounded-lg p-2">
              <p className="font-black text-slate-500 uppercase tracking-wider text-[10px] mb-1">{r.label}</p>
              <ol className="space-y-0.5 text-[11px]">
                {keys.map((k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-slate-400 font-bold w-5 text-right">{k}.</span>
                    <span className="font-semibold text-slate-700">{ranks[k] || '—'}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3 text-left">
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelected(cat)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
              selected === cat ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {cat === MEDAL_KEY ? 'Medal table' : cat}
            {!isVisible(cat) && !(cat === MEDAL_KEY ? MEDAL_ROWS.some((r) => picksByCat[r.key]) : picksByCat[cat]) && (
              <Lock size={9} className="inline ml-1 -mt-0.5" />
            )}
          </button>
        ))}
      </div>
      {selected === MEDAL_KEY ? renderMedalTable() : selected ? renderCategory() : null}
    </div>
  );
};

export default UserPicksViewer;
