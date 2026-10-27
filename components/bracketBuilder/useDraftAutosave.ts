import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { isBracketDraft, newerDraft, type BracketDraft } from '../../lib/bracketDraft';
import { showToast } from '../../lib/toast';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'local'; at: string } // server draft column unavailable; device only
  | { kind: 'offline'; at: string }; // server save failed; device only

const DEBOUNCE_MS = 1500;

export const draftStorageKey = (tournamentId: string | number) => `tippon-bracket-draft-${tournamentId}`;

/** PostgREST / Postgres error for a column that does not exist (migration 009 not run). */
function isMissingColumn(err: any): boolean {
  const msg = String(err?.message ?? '');
  return err?.code === '42703' || err?.code === 'PGRST204' || /bracket_draft/.test(msg) && /column/i.test(msg);
}

function readLocal(key: string): BracketDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isBracketDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, draft: BracketDraft | null): boolean {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export interface LoadedDraft {
  draft: BracketDraft | null;
  /** True when a saved draft (DB or device) was found. */
  restored: boolean;
}

/**
 * Bracket draft state with autosave: every change goes to localStorage immediately and
 * to `tournaments.bracket_draft` after DEBOUNCE_MS. Degrades to device-only storage
 * when the column is missing.
 */
export function useDraftAutosave(tournamentId: number | null) {
  const [draft, setDraftState] = useState<BracketDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const draftRef = useRef<BracketDraft | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbAvailableRef = useRef(true);
  const warnedRef = useRef(false);
  const key = tournamentId != null ? draftStorageKey(tournamentId) : null;

  const markDbUnavailable = useCallback(() => {
    dbAvailableRef.current = false;
    if (!warnedRef.current) {
      warnedRef.current = true;
      showToast('warning', 'Server draft storage is not available yet (run migration 009). Drafts are saved on this device only.');
    }
  }, []);

  const saveToDb = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const current = draftRef.current;
    if (tournamentId == null || !current || !dirtyRef.current) return;
    if (!dbAvailableRef.current) {
      dirtyRef.current = false;
      setSaveState({ kind: 'local', at: current.updatedAt });
      return;
    }
    dirtyRef.current = false;
    setSaveState({ kind: 'saving' });
    const { error } = await supabase
      .from('tournaments')
      .update({ bracket_draft: current, bracket_draft_updated_at: current.updatedAt })
      .eq('id', tournamentId);
    if (error) {
      if (isMissingColumn(error)) {
        markDbUnavailable();
        setSaveState({ kind: 'local', at: current.updatedAt });
      } else {
        console.error('[BracketDraft] server save failed:', error);
        dirtyRef.current = true; // retry on next change / flush
        setSaveState({ kind: 'offline', at: current.updatedAt });
      }
      return;
    }
    if (!dirtyRef.current) setSaveState({ kind: 'saved', at: current.updatedAt });
  }, [tournamentId, markDbUnavailable]);

  /** Replace the draft (stamped with a new updatedAt) and schedule autosave. */
  const setDraft = useCallback(
    (updater: BracketDraft | null | ((prev: BracketDraft | null) => BracketDraft | null)) => {
      const prev = draftRef.current;
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next === prev) return;
      const stamped = next ? { ...next, updatedAt: new Date().toISOString() } : null;
      draftRef.current = stamped;
      setDraftState(stamped);
      if (!key || !stamped) return;
      writeLocal(key, stamped);
      dirtyRef.current = true;
      setSaveState({ kind: 'saving' });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void saveToDb(); }, DEBOUNCE_MS);
    },
    [key, saveToDb]
  );

  /** Set the draft without marking it dirty (e.g. built from already published brackets). */
  const initDraft = useCallback((d: BracketDraft | null) => {
    draftRef.current = d;
    setDraftState(d);
  }, []);

  const flush = useCallback(async () => {
    if (key && draftRef.current) writeLocal(key, draftRef.current);
    if (draftRef.current) dirtyRef.current = true;
    await saveToDb();
  }, [key, saveToDb]);

  /** Remove the draft from device and server (after publish / discard). */
  const clearDraft = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    dirtyRef.current = false;
    draftRef.current = null;
    setDraftState(null);
    if (key) writeLocal(key, null);
    setSaveState({ kind: 'idle' });
    if (tournamentId == null || !dbAvailableRef.current) return;
    const { error } = await supabase
      .from('tournaments')
      .update({ bracket_draft: null, bracket_draft_updated_at: null })
      .eq('id', tournamentId);
    if (error && !isMissingColumn(error)) console.error('[BracketDraft] clear failed:', error);
  }, [key, tournamentId]);

  /** Loads the newer of the server and device drafts. */
  const load = useCallback(async (): Promise<LoadedDraft> => {
    if (tournamentId == null || !key) return { draft: null, restored: false };
    const local = readLocal(key);
    let remote: BracketDraft | null = null;
    const { data, error } = await supabase
      .from('tournaments')
      .select('bracket_draft, bracket_draft_updated_at')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) {
      if (isMissingColumn(error)) markDbUnavailable();
      else console.error('[BracketDraft] load failed:', error);
    } else if (data && isBracketDraft((data as any).bracket_draft)) {
      remote = (data as any).bracket_draft;
    }
    const chosen = newerDraft(remote, local);
    if (chosen) {
      draftRef.current = chosen;
      setDraftState(chosen);
      // Device draft newer than server (e.g. saved while offline) → push it up.
      if (chosen === local && local !== remote) {
        dirtyRef.current = true;
        void saveToDb();
      } else {
        setSaveState(dbAvailableRef.current ? { kind: 'saved', at: chosen.updatedAt } : { kind: 'local', at: chosen.updatedAt });
      }
    }
    return { draft: chosen, restored: !!chosen };
  }, [tournamentId, key, markDbUnavailable, saveToDb]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  // Device copy on tab close; server flush on unmount.
  useEffect(() => {
    const onUnload = () => { if (key && draftRef.current) writeLocal(key, draftRef.current); };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      if (dirtyRef.current) void saveToDb();
    };
  }, [key, saveToDb]);

  return { draft, setDraft, initDraft, loading, saveState, flush, clearDraft, dbAvailable: () => dbAvailableRef.current };
}
