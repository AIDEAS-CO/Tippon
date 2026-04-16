import React, { useEffect, useMemo, useState } from 'react';
import { ViewState, Tournament, UserPicks } from '../types';
import { ArrowLeft, CheckCircle, Loader2, Lock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Flag from '../components/ui/Flag';
import {
  MEDAL_TABLE_MEN,
  MEDAL_TABLE_WOMEN,
  MEDAL_TABLE_TOTAL,
  MEDAL_TABLE_CATEGORY,
} from '../lib/tournamentConstants';

/** Stored in `user_picks.category` — distinct from weight-class keys. */
export { MEDAL_TABLE_CATEGORY };

const RANK_SLOTS = 3;
const RANK_LABELS = ['1st', '2nd', '3rd'];

type GenderTab = 'Men' | 'Women' | 'Total';
const TABS: GenderTab[] = ['Men', 'Women', 'Total'];
const TAB_CATEGORY: Record<GenderTab, string> = {
  Men: MEDAL_TABLE_MEN,
  Women: MEDAL_TABLE_WOMEN,
  Total: MEDAL_TABLE_TOTAL,
};

/** IOC-ish codes from PDF/draw `bracket_data` blobs. */
function countriesFromBracketRows(rows: Array<{ bracket_data?: unknown; weight_category?: string }>): Map<string, Set<string>> {
  // Returns map: country → Set<weight_category>
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const bd = row.bracket_data as Record<string, { country?: string } | null> | undefined;
    if (!bd || typeof bd !== 'object') continue;
    for (const side of ['competitor1', 'competitor2'] as const) {
      const c = bd[side];
      if (c && typeof c === 'object' && c.country) {
        const code = String(c.country).trim().toUpperCase();
        if (code.length >= 2 && code.length <= 4 && code !== 'N/A') {
          if (!out.has(code)) out.set(code, new Set());
          if (row.weight_category) out.get(code)!.add(row.weight_category);
        }
      }
    }
  }
  return out;
}

interface MedalTablePicksProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  userId?: string;
  onSavePicks?: (tournamentId: string, category: string, picks: UserPicks, completion: number) => void;
  medalTableStatus?: 'open' | 'locked';
}

const MedalTablePicks: React.FC<MedalTablePicksProps> = ({
  onNavigate,
  tournament,
  userId,
  onSavePicks,
  medalTableStatus = 'open',
}) => {
  const [activeTab, setActiveTab] = useState<GenderTab>('Men');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<GenderTab | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Countries available per tab
  const [countriesByTab, setCountriesByTab] = useState<Record<GenderTab, string[]>>({
    Men: [], Women: [], Total: [],
  });

  // Picks per tab: { Men: {'1': 'JPN', ...}, Women: {...}, Total: {...} }
  const [picksByTab, setPicksByTab] = useState<Record<GenderTab, Record<string, string>>>({
    Men: {}, Women: {}, Total: {},
  });

  const ranks = picksByTab[activeTab];
  const countries = countriesByTab[activeTab];

  const setRanks = (updater: (prev: Record<string, string>) => Record<string, string>) => {
    setPicksByTab(prev => ({ ...prev, [activeTab]: updater(prev[activeTab]) }));
  };

  // Load data
  useEffect(() => {
    const load = async () => {
      if (!tournament?.id) { setLoading(false); return; }
      setLoading(true);
      try {
        // 1. Load category → gender map
        const { data: catRows } = await supabase
          .from('categories')
          .select('name, gender')
          .eq('tournament_id', tournament.id);
        const catGender = new Map<string, string>();
        for (const r of catRows || []) {
          if (r.name && r.gender) catGender.set(r.name, r.gender);
        }

        // 2. Load brackets (need weight_category for gender filtering)
        const { data: bracketRows } = await supabase
          .from('competition_brackets')
          .select('bracket_data, weight_category')
          .eq('tournament_id', tournament.id);

        // 3. Load roster countries (no per-category in roster, goes to Total only as fallback)
        const { data: rosterRows } = await supabase
          .from('tournament_roster')
          .select('country, weight_category')
          .eq('tournament_id', tournament.id);

        // Build country sets per gender
        const menSet = new Set<string>();
        const womenSet = new Set<string>();
        const totalSet = new Set<string>();

        const bracketCountryMap = countriesFromBracketRows(bracketRows || []);
        for (const [country, cats] of bracketCountryMap) {
          totalSet.add(country);
          for (const cat of cats) {
            const gender = catGender.get(cat);
            if (gender === 'Male') menSet.add(country);
            else if (gender === 'Female') womenSet.add(country);
          }
        }

        // Roster fallback: if roster has weight_category, use gender map; else add to total only
        for (const r of rosterRows || []) {
          const code = String(r.country || '').trim().toUpperCase();
          if (!code || code === 'N/A' || code.length < 2) continue;
          totalSet.add(code);
          if (r.weight_category) {
            const gender = catGender.get(r.weight_category);
            if (gender === 'Male') menSet.add(code);
            else if (gender === 'Female') womenSet.add(code);
          }
        }

        const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));

        setCountriesByTab({
          Men: sort(menSet),
          Women: sort(womenSet),
          Total: sort(totalSet),
        });

        // 4. Load saved picks for all 3 categories
        const newPicksByTab: Record<GenderTab, Record<string, string>> = { Men: {}, Women: {}, Total: {} };

        if (userId) {
          const allKeys = [MEDAL_TABLE_MEN, MEDAL_TABLE_WOMEN, MEDAL_TABLE_TOTAL, '_medal_table_'];
          const { data: pickRows } = await supabase
            .from('user_picks')
            .select('category, picks_data')
            .eq('user_id', userId)
            .eq('tournament_id', tournament.id)
            .in('category', allKeys);

          for (const row of pickRows || []) {
            const p = row.picks_data as Record<string, string> | null;
            if (!p) continue;
            let tab: GenderTab | null = null;
            if (row.category === MEDAL_TABLE_MEN) tab = 'Men';
            else if (row.category === MEDAL_TABLE_WOMEN) tab = 'Women';
            else if (row.category === MEDAL_TABLE_TOTAL || row.category === '_medal_table_') tab = 'Total';
            if (!tab) continue;
            const next: Record<string, string> = {};
            for (let i = 1; i <= RANK_SLOTS; i++) {
              const key = String(i);
              if (p[key]) next[key] = p[key];
            }
            newPicksByTab[tab] = next;
          }
        } else {
          for (const tab of TABS) {
            try {
              const raw = localStorage.getItem(`tippon-picks-anon-${tournament.id}-${TAB_CATEGORY[tab]}`);
              if (raw) {
                const p = JSON.parse(raw) as Record<string, string>;
                const next: Record<string, string> = {};
                for (let i = 1; i <= RANK_SLOTS; i++) {
                  const key = String(i);
                  if (p[key]) next[key] = p[key];
                }
                newPicksByTab[tab] = next;
              }
            } catch { /* ignore */ }
          }
        }

        setPicksByTab(newPicksByTab);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tournament?.id, userId]);

  const filledCount = useMemo(
    () => Object.values(ranks).filter(Boolean).length,
    [ranks]
  );

  const completion = filledCount >= RANK_SLOTS ? 100 : Math.round((filledCount / RANK_SLOTS) * 100);

  const handleSave = () => {
    if (!tournament?.id || !onSavePicks) return;
    const vals = Object.values(ranks).filter(Boolean);
    if (new Set(vals).size !== vals.length) {
      setSaveError('Each position must be a different country. Remove duplicates before saving.');
      return;
    }
    setSaveError(null);
    setSaving(activeTab);
    onSavePicks(tournament.id, TAB_CATEGORY[activeTab], ranks, completion);
    setTimeout(() => {
      setSaving(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    }, 400);
  };

  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500 font-medium">No tournament selected.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('BRACKET')}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-600"
            aria-label="Back to bracket"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0">
            <h1 className="font-black text-slate-900 truncate text-lg">Medal table picks</h1>
            <p className="text-xs text-slate-500 font-medium truncate">{tournament.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedFlash && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
              <CheckCircle size={14} /> Saved
            </span>
          )}
          {medalTableStatus === 'locked' ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg border border-purple-200 text-sm font-bold">
              <Lock size={14} />
              Picks locked
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving !== null || countries.length === 0}
              className="bg-primary text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {saving !== null ? 'Saving…' : `Save ${activeTab}`}
            </button>
          )}
        </div>
      </header>

      {/* Gender tabs */}
      <div className="bg-white border-b border-slate-200 px-4 flex gap-1">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSaveError(null); }}
            className={`px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
            <span className={`ml-1.5 text-xs font-normal ${activeTab === tab ? 'text-blue-400' : 'text-slate-400'}`}>
              ({Object.values(picksByTab[tab]).filter(Boolean).length}/{RANK_SLOTS})
            </span>
          </button>
        ))}
      </div>

      <main className="flex-1 max-w-lg mx-auto w-full p-4 pb-12">
        <p className="text-sm text-slate-600 mb-4">
          Rank the top {RANK_SLOTS} countries for the <strong>{activeTab}</strong> medal table.
          Max 12 points per table (4 for exact, 3 for ±1, 2 for ±2, 1 for ±3).
          <span className="block mt-1 text-slate-400">36 points total across Men + Women + Total.</span>
        </p>
        {saveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2 font-medium">
            {saveError}
          </div>
        )}

        {countries.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm p-4">
            No countries found for <strong>{activeTab}</strong> categories. Add athletes in <strong>Manage roster</strong> first.
          </div>
        ) : (
          <ul className="space-y-3">
            {RANK_LABELS.map((label, idx) => {
              const key = String(idx + 1);
              const value = ranks[key] || '';
              const takenElsewhere = new Set(
                Object.entries(ranks)
                  .filter(([k, v]) => k !== key && v)
                  .map(([, v]) => v as string)
              );
              const optionsForRow = countries.filter((c) => c === value || !takenElsewhere.has(c));
              const isLocked = medalTableStatus === 'locked';
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm"
                >
                  <span className="w-10 text-xs font-black text-slate-400 tabular-nums">{label}</span>
                  <select
                    value={value}
                    disabled={isLocked}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSaveError(null);
                      setRanks((prev) => {
                        const next = { ...prev };
                        if (!v) delete next[key];
                        else next[key] = v;
                        return next;
                      });
                    }}
                    className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-semibold text-slate-800 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">— Country —</option>
                    {optionsForRow.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {value ? (
                    <Flag countryCode={value} className="w-8 h-5 flex-shrink-0 shadow-sm rounded-sm" />
                  ) : (
                    <span className="w-8 flex-shrink-0" />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-6 text-[11px] text-slate-400 text-center">
          {activeTab} completion: {filledCount}/{RANK_SLOTS} ({completion}%)
        </p>
      </main>
    </div>
  );
};

export default MedalTablePicks;
