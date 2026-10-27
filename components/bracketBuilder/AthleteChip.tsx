import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Trash2, Check } from 'lucide-react';
import Flag from '../ui/Flag';
import type { DrawAthlete } from '../../lib/bracketDraft';

/** Visual chip (also used inside the DragOverlay). */
export const ChipBody: React.FC<{ athlete: DrawAthlete; dragging?: boolean; overlay?: boolean }> = ({ athlete, dragging, overlay }) => (
  <div
    className={`flex items-center gap-1.5 min-w-0 w-full px-2 py-1.5 rounded-lg border text-xs bg-white select-none ${
      overlay ? 'shadow-xl border-blue-400 ring-2 ring-blue-200 cursor-grabbing' : 'border-slate-200 hover:border-blue-300 cursor-grab'
    } ${dragging ? 'opacity-30' : ''}`}
  >
    <GripVertical size={12} className="text-slate-300 shrink-0" />
    <Flag countryCode={athlete.country} className="w-5 h-3.5 shrink-0" />
    <span className="font-semibold text-slate-800 truncate flex-1">{athlete.name || 'Unnamed'}</span>
    <span className="font-mono text-[10px] text-slate-400 shrink-0">{athlete.country}</span>
  </div>
);

interface AthleteChipProps {
  athlete: DrawAthlete;
  /** Category the athlete currently belongs to. */
  weight: string;
  categoryNames: string[];
  onUpdate: (id: string, patch: { name?: string; country?: string }) => void;
  onDelete: (id: string) => void;
  onMoveToCategory: (id: string, weight: string) => void;
}

/** Draggable athlete; click opens an inline editor (name, country, move, delete). */
const AthleteChip: React.FC<AthleteChipProps> = ({ athlete, weight, categoryNames, onUpdate, onDelete, onMoveToCategory }) => {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `ath:${athlete.id}`,
    data: { athleteId: athlete.id },
    disabled: editing,
  });

  if (editing) {
    return (
      <div className="w-full p-2 rounded-lg border border-blue-300 bg-blue-50/60 space-y-1.5" onClick={e => e.stopPropagation()}>
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={athlete.name}
            onChange={e => onUpdate(athlete.id, { name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') setEditing(false); }}
            placeholder="LAST First"
            className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-white"
          />
          <input
            value={athlete.country}
            maxLength={3}
            onChange={e => onUpdate(athlete.id, { country: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
            onKeyDown={e => { if (e.key === 'Enter') setEditing(false); }}
            placeholder="XXX"
            className="w-14 px-1.5 py-1 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-white uppercase text-center"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value=""
            onChange={e => { if (e.target.value) { onMoveToCategory(athlete.id, e.target.value); setEditing(false); } }}
            className="flex-1 min-w-0 px-1.5 py-1 text-xs border border-slate-200 rounded bg-white text-slate-600"
          >
            <option value="">Move to category…</option>
            {categoryNames.filter(c => c !== weight).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => { if (confirm(`Delete ${athlete.name || 'this athlete'}?`)) onDelete(athlete.id); }}
            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
            title="Delete athlete"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="p-1 text-blue-600 hover:bg-blue-100 rounded"
            title="Done"
          >
            <Check size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => setEditing(true)}
      className="w-full min-w-0 touch-manipulation"
      title="Drag to move · click to edit"
    >
      <ChipBody athlete={athlete} dragging={isDragging} />
    </div>
  );
};

export default AthleteChip;
