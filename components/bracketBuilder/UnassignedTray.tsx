import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronUp, ChevronDown, Plus, Inbox } from 'lucide-react';
import AthleteChip from './AthleteChip';
import type { ChipHandlers } from './PoolGrid';
import type { BracketDraft } from '../../lib/bracketDraft';

const TrayGroup: React.FC<{ draft: BracketDraft; weight: string; current: boolean; handlers: ChipHandlers }> = ({ draft, weight, current, handlers }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `tray:${weight}`, data: { weight, tray: true } });
  const athletes = draft.categories[weight]?.unassigned ?? [];
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg p-2 transition-colors ${isOver ? 'bg-blue-100 ring-2 ring-blue-400' : current ? 'bg-slate-50' : 'bg-white border border-slate-100'}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[11px] font-bold uppercase tracking-wider ${current ? 'text-blue-600' : 'text-slate-500'}`}>
          {weight}{current ? ' (current)' : ''}
        </span>
        <span className="text-[10px] text-slate-400">{athletes.length}</span>
      </div>
      {athletes.length === 0 ? (
        <div className="text-[11px] text-slate-400 text-center py-3 border border-dashed border-slate-200 rounded-lg">
          Drop athletes here to unassign
        </div>
      ) : (
        <div className="space-y-1">
          {athletes.map(a => <AthleteChip key={a.id} athlete={a} weight={weight} {...handlers} />)}
        </div>
      )}
    </div>
  );
};

interface UnassignedTrayProps {
  draft: BracketDraft;
  currentWeight: string;
  handlers: ChipHandlers;
  onAddAthlete: (name: string, country: string) => void;
}

/**
 * Unassigned athletes. The current category's tray comes first; other categories' trays stay
 * visible so athletes can be dragged across categories. Sticky side panel on desktop,
 * collapsible bottom drawer on small screens.
 */
const UnassignedTray: React.FC<UnassignedTrayProps> = ({ draft, currentWeight, handlers, onAddAthlete }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const others = Object.keys(draft.categories).filter(w => w !== currentWeight && draft.categories[w].unassigned.length > 0);
  const total = Object.keys(draft.categories).reduce((n, w) => n + draft.categories[w].unassigned.length, 0);

  const submit = () => {
    if (!name.trim()) return;
    onAddAthlete(name, country);
    setName('');
    setCountry('');
  };

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-30 bg-white border-t border-slate-200 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] flex flex-col
        lg:z-auto lg:w-80 lg:shrink-0 lg:border lg:rounded-xl lg:shadow-sm lg:self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-12rem)]
        ${open ? 'max-h-[60vh]' : 'max-h-12'} lg:max-h-[calc(100vh-12rem)]`}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-slate-100 lg:cursor-default"
      >
        <span className="flex items-center gap-2 font-bold text-sm text-slate-800">
          <Inbox size={16} className="text-slate-500" /> Unassigned
          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] text-slate-600">{total}</span>
        </span>
        <span className="lg:hidden text-slate-400">{open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</span>
      </button>

      <div className={`flex-1 overflow-y-auto p-3 space-y-3 ${open ? '' : 'hidden'} lg:block`}>
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="LAST First"
            className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400"
          />
          <input
            value={country}
            maxLength={3}
            onChange={e => setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="XXX"
            className="w-14 px-1.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 uppercase text-center"
          />
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-2 rounded-lg bg-blue-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            title="Add athlete"
          >
            <Plus size={14} />
          </button>
        </div>
        <TrayGroup draft={draft} weight={currentWeight} current handlers={handlers} />
        {others.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Other categories</div>
            {others.map(w => <TrayGroup key={w} draft={draft} weight={w} current={false} handlers={handlers} />)}
          </div>
        )}
      </div>
    </aside>
  );
};

export default UnassignedTray;
