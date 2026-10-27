import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ViewState, Tournament } from '../types';
import { ArrowLeft, Save, Loader2, PenLine, Send, FileUp, X, Plus, Trash2, Users } from 'lucide-react';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { showToast } from '../lib/toast';
import {
  FIELD_SIZES,
  draftToBracketRows,
  emptyCategory,
  emptyDraft,
  matchConfiguredCategory,
  normalizeWeightKey,
  rowsToDraftCategory,
  validateCategory,
  type BracketDraft,
  type DraftCategory,
  type DraftGender,
} from '../lib/bracketDraft';
import { useDraftAutosave } from '../components/bracketBuilder/useDraftAutosave';
import SaveStatusChip, { formatTime } from '../components/bracketBuilder/SaveStatusChip';
import DrawImportPanel, { type ImportedCategory } from '../components/bracketBuilder/DrawImportPanel';
import BracketEditor from '../components/bracketBuilder/BracketEditor';

interface BuildBracketProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
}

interface ConfiguredCategory {
  name: string;
  gender: DraftGender;
}

const GENDERS: Exclude<DraftGender, null>[] = ['Male', 'Female', 'Mixed'];

function configuredFromTournament(t: Tournament | null): ConfiguredCategory[] {
  return [
    ...(t?.categories?.male || []).map(name => ({ name, gender: 'Male' as const })),
    ...(t?.categories?.female || []).map(name => ({ name, gender: 'Female' as const })),
    ...(t?.categories?.mixed || []).map(name => ({ name, gender: 'Mixed' as const })),
  ];
}

const BuildBracket: React.FC<BuildBracketProps> = ({ onNavigate, tournament }) => {
  const tournamentIdNum = useMemo(() => {
    const n = parseInt(String(tournament?.id ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [tournament?.id]);

  const { draft, setDraft, initDraft, loading, saveState, flush, clearDraft } = useDraftAutosave(tournamentIdNum);
  const [configured, setConfigured] = useState<ConfiguredCategory[]>(() => configuredFromTournament(tournament));
  const [selected, setSelected] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [unmatched, setUnmatched] = useState<(ImportedCategory & { addGender: Exclude<DraftGender, null> })[]>([]);
  const [manualSize, setManualSize] = useState(32);
  const [isPublishing, setIsPublishing] = useState(false);
  const initializedRef = useRef(false);

  // Configured categories from the DB (source of truth for names and gender).
  useEffect(() => {
    if (!tournamentIdNum) return;
    supabase
      .from('categories')
      .select('name, gender')
      .eq('tournament_id', tournamentIdNum)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        setConfigured(data.map((c: any) => ({ name: c.name, gender: (c.gender as DraftGender) ?? null })));
      });
  }, [tournamentIdNum]);

  /** Builds a (not yet dirty) draft from already published competition_brackets rows. */
  const loadPublished = async () => {
    if (!tournamentIdNum) return;
    {
      const { data: rows, error } = await supabase
        .from('competition_brackets')
        .select('id, weight_category, match_number, competitor_1, competitor_2, bracket_data')
        .eq('tournament_id', tournamentIdNum);
      if (error || !rows || rows.length === 0) return;
      const rosterIds = new Set<string>();
      rows.forEach((r: any) => { if (r.competitor_1) rosterIds.add(r.competitor_1); if (r.competitor_2) rosterIds.add(r.competitor_2); });
      const rosterMap: Record<string, { name: string; country: string }> = {};
      if (rosterIds.size > 0) {
        const { data: roster } = await supabase
          .from('tournament_roster')
          .select('id, first_name, last_name, country')
          .in('id', [...rosterIds]);
        (roster || []).forEach((r: any) => {
          rosterMap[r.id] = { name: `${r.last_name ?? ''} ${r.first_name ?? ''}`.trim(), country: r.country || 'N/A' };
        });
      }
      const byWeight = new Map<string, any[]>();
      rows.forEach((r: any) => {
        const w = r.weight_category || 'Unknown';
        byWeight.set(w, [...(byWeight.get(w) || []), r]);
      });
      const d = emptyDraft();
      for (const [w, list] of byWeight) {
        // Publish uses the configured name; legacy labels ("Men -60kg") are mapped onto it.
        const conf = configured.find(c => normalizeWeightKey(c.name) === normalizeWeightKey(w));
        const name = conf?.name ?? w;
        d.categories[name] = rowsToDraftCategory(list, name, conf?.gender ?? null, rosterMap);
      }
      initDraft(d);
      showToast('success', 'Loaded published brackets for editing.');
    }
  };

  // After the saved draft is loaded: restore it, or start from already published brackets.
  useEffect(() => {
    if (loading || initializedRef.current || !tournamentIdNum) return;
    initializedRef.current = true;
    if (draft) showToast('success', `Restored draft from ${formatTime(draft.updatedAt)}`);
    else void loadPublished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tournamentIdNum]);

  // Category display order: configured order first, then any extra draft categories.
  const order = useMemo(() => {
    if (!draft) return [];
    const keys = Object.keys(draft.categories);
    const out: string[] = [];
    for (const c of configured) {
      const k = keys.find(key => key === c.name) ?? keys.find(key => normalizeWeightKey(key) === normalizeWeightKey(c.name));
      if (k && !out.includes(k)) out.push(k);
    }
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
  }, [draft, configured]);

  useEffect(() => {
    if (order.length > 0 && !order.includes(selected)) setSelected(order[0]);
  }, [order, selected]);

  const hasCategories = order.length > 0;

  // --- Import ---
  const toDraftCategory = (c: ImportedCategory, name: string, gender: DraftGender): DraftCategory => ({
    weight: name,
    gender: gender ?? c.gender,
    fieldSize: c.fieldSize,
    slots: c.slots,
    unassigned: [],
    warnings: [...c.warnings],
    source: c.source,
    reviewed: false,
    declaredCount: c.declaredCount,
  });

  const handleImported = (cats: ImportedCategory[]) => {
    const names = configured.map(c => c.name);
    const matched = new Map<string, ImportedCategory>();
    const notConfigured: ImportedCategory[] = [];
    for (const c of cats) {
      const name = matchConfiguredCategory(c.parsedWeight, names);
      if (!name) { notConfigured.push(c); continue; }
      if (matched.has(name)) c.warnings.push(`Also found in ${matched.get(name)!.fileName}; this file was used`);
      matched.set(name, c);
    }

    let accepted = [...matched.entries()];
    const existing = accepted.filter(([name]) => draft?.categories[name]);
    if (existing.length > 0) {
      const ok = confirm(
        `Replace ${existing.length} categor${existing.length === 1 ? 'y' : 'ies'} already in the draft (${existing.map(([n]) => n).join(', ')})?\n` +
        'Cancel keeps your current edits for those categories.'
      );
      if (!ok) accepted = accepted.filter(([name]) => !draft?.categories[name]);
    }

    if (accepted.length > 0) {
      setDraft(prev => {
        const base = prev ?? emptyDraft();
        const categories = { ...base.categories };
        for (const [name, c] of accepted) {
          categories[name] = toDraftCategory(c, name, configured.find(x => x.name === name)?.gender ?? null);
        }
        return { ...base, categories };
      });
      setSelected(accepted[0][0]);
    }
    if (notConfigured.length > 0) {
      setUnmatched(prev => [
        ...prev.filter(p => !notConfigured.some(n => normalizeWeightKey(n.parsedWeight) === normalizeWeightKey(p.parsedWeight))),
        ...notConfigured.map(c => ({ ...c, addGender: (c.gender ?? 'Male') as Exclude<DraftGender, null> })),
      ]);
    }
    const ai = accepted.filter(([, c]) => c.source === 'ai').length;
    showToast(
      accepted.length > 0 ? 'success' : 'warning',
      `Imported ${accepted.length} categor${accepted.length === 1 ? 'y' : 'ies'}` +
        (ai ? ` (${ai} by AI – please verify)` : '') +
        (notConfigured.length ? ` · ${notConfigured.length} not configured` : '')
    );
    if (accepted.length > 0) setShowImport(false);
  };

  const handleAddUnmatched = async (u: ImportedCategory & { addGender: Exclude<DraftGender, null> }) => {
    if (!tournamentIdNum) return;
    const name = u.parsedWeight;
    const { error } = await supabase.from('categories').insert({ tournament_id: tournamentIdNum, name, gender: u.addGender });
    if (error) {
      showToast('error', `Could not add category ${name}: ${error.message}`);
      return;
    }
    setConfigured(prev => [...prev, { name, gender: u.addGender }]);
    setDraft(prev => {
      const base = prev ?? emptyDraft();
      return { ...base, categories: { ...base.categories, [name]: toDraftCategory(u, name, u.addGender) } };
    });
    setUnmatched(prev => prev.filter(p => p !== u));
    setSelected(name);
    showToast('success', `Category ${name} added.`);
  };

  // --- Manual ---
  const missingConfigured = configured.filter(c => !order.some(k => normalizeWeightKey(k) === normalizeWeightKey(c.name)));

  const handleCreateEmpty = () => {
    if (missingConfigured.length === 0) {
      showToast('warning', 'All configured categories already have a bracket in the draft.');
      return;
    }
    setDraft(prev => {
      const base = prev ?? emptyDraft();
      const categories = { ...base.categories };
      for (const c of missingConfigured) categories[c.name] = emptyCategory(c.name, c.gender, manualSize, 'manual');
      return { ...base, categories };
    });
    setSelected(missingConfigured[0].name);
    setShowImport(false);
  };

  const handleRemoveCategory = (weight: string) => {
    if (!confirm(`Remove "${weight}" from the draft?\nIf it was already published, its bracket is deleted when you publish.`)) return;
    setDraft(prev => {
      if (!prev) return prev;
      const categories = { ...prev.categories };
      delete categories[weight];
      return { ...prev, categories };
    });
  };

  const handleDiscardDraft = async () => {
    if (!confirm('Discard the whole draft? Published brackets are not changed.')) return;
    await clearDraft();
    setUnmatched([]);
    showToast('success', 'Draft discarded.');
    await loadPublished();
  };

  // --- Publish ---
  const handlePublish = async () => {
    if (!draft || !tournamentIdNum) return;
    const entries = order.map(w => [w, draft.categories[w]] as [string, DraftCategory]);
    const results = entries.map(([w, c]) => ({ w, v: validateCategory(c), c }));
    const withErrors = results.filter(r => r.v.errors.length > 0);
    if (withErrors.length > 0) {
      setSelected(withErrors[0].w);
      showToast('error', `Fix errors before publishing: ${withErrors.map(r => r.w).join(', ')}`);
      return;
    }
    const warnCount = results.reduce((n, r) => n + r.v.warnings.length + r.c.warnings.length, 0);
    const unreviewed = results.filter(r => !r.c.reviewed).map(r => r.w);
    if (warnCount > 0 || unreviewed.length > 0) {
      const lines = [
        warnCount > 0 ? `${warnCount} warning(s) remain.` : '',
        unreviewed.length > 0 ? `Not marked reviewed: ${unreviewed.join(', ')}.` : '',
      ].filter(Boolean);
      if (!confirm(`${lines.join('\n')}\nPublish anyway?`)) return;
    }

    setIsPublishing(true);
    try {
      await flush();

      const { count: pickCount } = await supabase
        .from('user_picks')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentIdNum);
      if ((pickCount ?? 0) > 0 && !confirm('Players already have picks; athlete moves will change their brackets. Continue?')) return;

      const { data: existingRows, error: exErr } = await supabase
        .from('competition_brackets')
        .select('id, weight_category, match_number')
        .eq('tournament_id', tournamentIdNum);
      if (exErr) throw exErr;
      const existing = existingRows || [];

      const draftKeys = entries.map(([w]) => w);
      const keyOf = (w: string) => normalizeWeightKey(w || '');
      const removed = [...new Set(existing.map((r: any) => r.weight_category as string))]
        .filter(w => !draftKeys.some(k => keyOf(k) === keyOf(w)));
      if (removed.length > 0 && !confirm(`Published brackets not in the draft will be deleted: ${removed.join(', ')}. Continue?`)) return;

      const toDelete: string[] = existing.filter((r: any) => removed.includes(r.weight_category)).map((r: any) => r.id);
      const toUpsert: any[] = [];
      const toInsert: any[] = [];

      for (const [w, c] of entries) {
        const rows = draftToBracketRows(tournamentIdNum, w, c);
        const mine = existing
          .filter((r: any) => !removed.includes(r.weight_category) && keyOf(r.weight_category) === keyOf(w))
          .sort((a: any, b: any) => (a.match_number ?? 0) - (b.match_number ?? 0));
        const numbered = mine.some((r: any) => r.match_number != null);
        const byNumber = new Map<number, string>();
        mine.forEach((r: any, i: number) => {
          const n = numbered ? r.match_number : i + 1;
          if (n != null && !byNumber.has(n)) byNumber.set(n, r.id);
          else toDelete.push(r.id); // duplicate or unnumbered leftover
        });
        for (const row of rows) {
          const id = byNumber.get(row.match_number);
          if (id) { toUpsert.push({ ...row, id }); byNumber.delete(row.match_number); }
          else toInsert.push(row);
        }
        toDelete.push(...byNumber.values()); // fights beyond the new field size
      }

      if (toDelete.length > 0) {
        const { error } = await supabase.from('competition_brackets').delete().in('id', toDelete);
        if (error) throw error;
      }
      if (toUpsert.length > 0) {
        const { error } = await supabase.from('competition_brackets').upsert(toUpsert, { onConflict: 'id' });
        if (error) throw error;
      }
      if (toInsert.length > 0) {
        const { error } = await supabase.from('competition_brackets').insert(toInsert);
        if (error) throw error;
      }

      const { data: tRow } = await supabase.from('tournaments').select('status').eq('id', tournamentIdNum).maybeSingle();
      const status = String((tRow as any)?.status ?? '').toLowerCase();
      if (!status || status === 'draft') {
        const { error } = await supabase.from('tournaments').update({ status: 'upcoming' }).eq('id', tournamentIdNum);
        if (error) throw error;
      }

      await clearDraft();
      const fights = toUpsert.length + toInsert.length;
      showToast('success', `Brackets published: ${fights} fights across ${entries.length} categories.`);
      onNavigate('BRACKET');
    } catch (error: any) {
      console.error('[Publish brackets]', error);
      showToast('error', 'Error publishing brackets: ' + (error?.message || String(error)) + ' — your draft is still saved.');
    } finally {
      setIsPublishing(false);
    }
  };

  const goBack = async () => {
    await flush();
    const st = String(tournament?.status ?? '').toUpperCase();
    onNavigate(st === 'DRAFT' || st === 'UPCOMING' ? 'SCORING_RULES' : 'TOURNAMENTS');
  };

  if (!tournamentIdNum) {
    return <div className="p-8 text-center text-slate-500">No tournament selected.</div>;
  }

  const importSection = (
    <div className="space-y-6">
      <DrawImportPanel onImported={handleImported} />

      {unmatched.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-amber-900">Categories in the PDF that are not configured for this tournament</p>
          {unmatched.map((u, i) => (
            <div key={`${u.parsedWeight}-${i}`} className="flex flex-wrap items-center gap-2 text-sm bg-white rounded-lg border border-amber-100 px-3 py-2">
              <span className="font-bold text-slate-800">{u.parsedWeight}</span>
              <span className="text-xs text-slate-500">{u.slots.filter(Boolean).length} athletes · {u.fileName}</span>
              <select
                value={u.addGender}
                onChange={e => setUnmatched(prev => prev.map(p => (p === u ? { ...p, addGender: e.target.value as any } : p)))}
                className="ml-auto px-2 py-1 text-xs border border-slate-200 rounded bg-white"
              >
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <Button size="sm" icon={Plus} onClick={() => handleAddUnmatched(u)}>Add category</Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setUnmatched(prev => prev.filter(p => p !== u))}>Ignore</Button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-slate-100 pt-5">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><PenLine size={16} /> Build manually</h3>
        <p className="text-sm text-slate-500 mt-1 mb-3">
          Creates empty brackets for configured categories without a draw
          {missingConfigured.length > 0 ? ` (${missingConfigured.map(c => c.name).join(', ')})` : ' (none missing)'}.
          Add athletes to the unassigned tray and drag them into place.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
            Field size
            <select
              value={manualSize}
              onChange={e => setManualSize(Number(e.target.value))}
              className="px-2 py-1.5 text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-800"
            >
              {FIELD_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Button variant="secondary" icon={PenLine} onClick={handleCreateEmpty} disabled={missingConfigured.length === 0}>
            Create empty brackets
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-white px-4 md:px-6 py-3 shadow-sm border-b border-slate-200 z-10 flex flex-wrap gap-3 justify-between items-center">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={goBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500" title="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900">Build Brackets</h1>
            <p className="text-sm text-slate-500 truncate">{tournament?.name}</p>
          </div>
          <SaveStatusChip state={saveState} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={Users} onClick={async () => { await flush(); onNavigate('MANAGE_ROSTER'); }}>
            Roster
          </Button>
          {hasCategories && (
            <>
              <Button size="sm" variant="secondary" icon={showImport ? X : FileUp} onClick={() => setShowImport(s => !s)}>
                {showImport ? 'Close import' : 'Import draw'}
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={handleDiscardDraft}>Discard draft</Button>
              <Button size="sm" variant="secondary" icon={Save} onClick={() => void flush()}>Save draft</Button>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={isPublishing}
                className="bg-green-600 hover:bg-green-700 text-white shadow-green-600/20"
                icon={isPublishing ? Loader2 : Send}
              >
                {isPublishing ? 'Publishing…' : 'Publish brackets'}
              </Button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 gap-2"><Loader2 className="animate-spin" size={18} /> Loading draft…</div>
      ) : !hasCategories ? (
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-xl border border-slate-200">
            <h2 className="text-2xl font-black mb-1 text-slate-900">Import the draw</h2>
            <p className="text-slate-500 mb-6 text-sm">
              Athletes and first-round positions are read from the official draw PDF. Your work is saved automatically as a draft.
            </p>
            {importSection}
          </div>
        </div>
      ) : (
        <>
          {showImport && (
            <div className="bg-white border-b border-slate-200 p-4 md:p-6 max-h-[60vh] overflow-y-auto">
              <div className="max-w-3xl mx-auto">{importSection}</div>
            </div>
          )}
          {!showImport && unmatched.length > 0 && (
            <button
              onClick={() => setShowImport(true)}
              className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs font-bold text-amber-800 text-left"
            >
              {unmatched.length} imported categor{unmatched.length === 1 ? 'y is' : 'ies are'} not configured — review
            </button>
          )}
          <BracketEditor
            draft={draft as BracketDraft}
            setDraft={setDraft}
            order={order}
            selected={selected}
            onSelect={setSelected}
            onRemoveCategory={handleRemoveCategory}
          />
        </>
      )}
    </div>
  );
};

export default BuildBracket;
