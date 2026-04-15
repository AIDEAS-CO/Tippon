import React, { useEffect, useMemo, useState } from 'react';
import { ViewState, Tournament, UserPicks } from '../types';
import { ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Flag from '../components/ui/Flag';
import { MEDAL_TABLE_CATEGORY } from '../lib/tournamentConstants';

/** Stored in `user_picks.category` — distinct from weight-class keys. */
export { MEDAL_TABLE_CATEGORY };

const RANK_SLOTS = 10;

/** IOC-ish codes from PDF/draw `bracket_data` blobs. */
function countriesFromCompetitionBracketRows(rows: unknown[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const bd = (row as { bracket_data?: Record<string, { country?: string } | null> })?.bracket_data;
    if (!bd || typeof bd !== 'object') continue;
    for (const side of ['competitor1', 'competitor2'] as const) {
      const c = bd[side];
      if (c && typeof c === 'object' && c.country) {
        const code = String(c.country).trim().toUpperCase();
        if (code.length >= 2 && code.length <= 4 && code !== 'N/A') out.add(code);
      }
    }
  }
  return [...out];
}

interface MedalTablePicksProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  userId?: string;
  onSavePicks?: (tournamentId: string, category: string, picks: UserPicks, completion: number) => void;
}

const MedalTablePicks: React.FC<MedalTablePicksProps> = ({
  onNavigate,
  tournament,
  userId,
  onSavePicks,
}) => {
  const [countries, setCountries] = useState<string[]>([]);
  const [ranks, setRanks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rankLabels = useMemo(
    () => ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'],
    []
  );

  useEffect(() => {
    const load = async () => {
      if (!tournament?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [{ data: roster }, { data: bracketRows }] = await Promise.all([
          supabase.from('tournament_roster').select('country').eq('tournament_id', tournament.id),
          supabase.from('competition_brackets').select('bracket_data').eq('tournament_id', tournament.id),
        ]);

        const fromRoster = (roster || []).map((r: { country?: string }) =>
          (r.country || '').trim().toUpperCase()
        );
        const merged = new Set<string>();
        for (const c of fromRoster) {
          if (c && c !== 'N/A' && c.length >= 2) merged.add(c);
        }
        for (const c of countriesFromCompetitionBracketRows(bracketRows || [])) {
          merged.add(c);
        }
        const uniq = Array.from(merged).sort((a, b) => a.localeCompare(b));

        setCountries(uniq);

        if (userId) {
          const { data: row } = await supabase
            .from('user_picks')
            .select('picks_data')
            .eq('user_id', userId)
            .eq('tournament_id', tournament.id)
            .eq('category', MEDAL_TABLE_CATEGORY)
            .maybeSingle();

          if (row?.picks_data && typeof row.picks_data === 'object') {
            const p = row.picks_data as Record<string, string>;
            const next: Record<string, string> = {};
            for (let i = 1; i <= RANK_SLOTS; i++) {
              const key = String(i);
              if (p[key]) next[key] = p[key];
            }
            setRanks(next);
          }
        } else {
          try {
            const raw = localStorage.getItem(
              `tippon-picks-anon-${tournament.id}-${MEDAL_TABLE_CATEGORY}`
            );
            if (raw) {
              const p = JSON.parse(raw) as Record<string, string>;
              const next: Record<string, string> = {};
              for (let i = 1; i <= RANK_SLOTS; i++) {
                const key = String(i);
                if (p[key]) next[key] = p[key];
              }
              setRanks(next);
            }
          } catch {
            /* ignore */
          }
        }
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
    setSaving(true);
    onSavePicks(tournament.id, MEDAL_TABLE_CATEGORY, ranks, completion);
    setTimeout(() => {
      setSaving(false);
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
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || countries.length === 0}
            className="bg-primary text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full p-4 pb-12">
        <p className="text-sm text-slate-600 mb-4">
          Rank up to {RANK_SLOTS} countries by predicted medal performance (gold count). Countries include the roster
          and any country codes found in the draw (bracket) data.
        </p>
        {saveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-3 py-2 font-medium">
            {saveError}
          </div>
        )}

        {countries.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm p-4">
            No countries found in the roster. Add athletes in <strong>Manage roster</strong> first.
          </div>
        ) : (
          <ul className="space-y-3">
            {rankLabels.map((label, idx) => {
              const key = String(idx + 1);
              const value = ranks[key] || '';
              const takenElsewhere = new Set(
                Object.entries(ranks)
                  .filter(([k, v]) => k !== key && v)
                  .map(([, v]) => v as string)
              );
              const optionsForRow = countries.filter((c) => c === value || !takenElsewhere.has(c));
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm"
                >
                  <span className="w-10 text-xs font-black text-slate-400 tabular-nums">{label}</span>
                  <select
                    value={value}
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
                    className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-semibold text-slate-800 bg-white"
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
          Completion: {filledCount}/{RANK_SLOTS} ({completion}%)
        </p>
      </main>
    </div>
  );
};

export default MedalTablePicks;
