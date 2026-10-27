import React from 'react';
import { Loader2, CheckCircle, CloudOff, HardDrive } from 'lucide-react';
import type { SaveState } from './useDraftAutosave';

export const formatTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const SaveStatusChip: React.FC<{ state: SaveState }> = ({ state }) => {
  if (state.kind === 'idle') return null;
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap';
  if (state.kind === 'saving') {
    return <span className={`${base} bg-slate-100 text-slate-600`}><Loader2 size={12} className="animate-spin" /> Saving…</span>;
  }
  if (state.kind === 'saved') {
    return <span className={`${base} bg-green-50 text-green-700`}><CheckCircle size={12} /> Saved · {formatTime(state.at)}</span>;
  }
  if (state.kind === 'local') {
    return <span className={`${base} bg-amber-50 text-amber-700`} title="Server draft storage unavailable"><HardDrive size={12} /> Saved on this device · {formatTime(state.at)}</span>;
  }
  return <span className={`${base} bg-red-50 text-red-700`}><CloudOff size={12} /> Offline – saved on this device</span>;
};

export default SaveStatusChip;
