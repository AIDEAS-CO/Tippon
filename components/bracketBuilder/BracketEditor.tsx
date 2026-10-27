import React, { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AlertTriangle, CheckCircle, Trash2, Sparkles, X } from 'lucide-react';
import PoolGrid, { type ChipHandlers } from './PoolGrid';
import UnassignedTray from './UnassignedTray';
import { ChipBody } from './AthleteChip';
import {
  FIELD_SIZES,
  addAthlete,
  deleteAthlete,
  findAthlete,
  moveBetweenCategories,
  moveToSlot,
  moveToUnassigned,
  setFieldSize,
  updateAthlete,
  updateCategory,
  validateCategory,
  type BracketDraft,
} from '../../lib/bracketDraft';
import { showToast } from '../../lib/toast';

interface BracketEditorProps {
  draft: BracketDraft;
  setDraft: (updater: (prev: BracketDraft | null) => BracketDraft | null) => void;
  /** Category keys in display order. */
  order: string[];
  selected: string;
  onSelect: (weight: string) => void;
  onRemoveCategory: (weight: string) => void;
}

const BracketEditor: React.FC<BracketEditorProps> = ({ draft, setDraft, order, selected, onSelect, onRemoveCategory }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

  const validations = useMemo(() => {
    const out: Record<string, ReturnType<typeof validateCategory>> = {};
    for (const w of order) if (draft.categories[w]) out[w] = validateCategory(draft.categories[w]);
    return out;
  }, [draft, order]);

  const apply = (fn: (d: BracketDraft) => BracketDraft) => setDraft(prev => (prev ? fn(prev) : prev));

  const handlers: ChipHandlers = {
    categoryNames: order,
    onUpdate: (id, patch) => apply(d => updateAthlete(d, id, patch)),
    onDelete: id => apply(d => deleteAthlete(d, id)),
    onMoveToCategory: (id, w) => {
      apply(d => moveBetweenCategories(d, id, w));
      showToast('success', `Moved to ${w} (unassigned tray)`);
    },
  };

  const onDragStart = (e: DragStartEvent) => setActiveId((e.active.data.current as any)?.athleteId ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const athleteId = (e.active.data.current as any)?.athleteId as string | undefined;
    const over = e.over?.data.current as { weight: string; slot?: number; tray?: boolean } | undefined;
    if (!athleteId || !over) return;
    if (over.tray) apply(d => moveToUnassigned(d, athleteId, over.weight));
    else if (typeof over.slot === 'number') apply(d => moveToSlot(d, athleteId, over.weight, over.slot!));
  };

  const cat = draft.categories[selected];
  const v = validations[selected];
  const activeAthlete = activeId ? findAthlete(draft, activeId)?.athlete : null;

  const changeFieldSize = (size: number) => {
    if (!cat) return;
    const next = setFieldSize(cat, size);
    if (!next) {
      showToast('warning', 'Cannot shrink: move athletes out of the last slots of each pool first.');
      return;
    }
    apply(d => updateCategory(d, selected, next));
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      {/* Category tabs */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 flex gap-1 overflow-x-auto">
        {order.map(w => {
          const c = draft.categories[w];
          const val = validations[w];
          if (!c || !val) return null;
          const issues = val.errors.length + val.warnings.length + c.warnings.length;
          const ok = c.reviewed && val.errors.length === 0;
          return (
            <button
              key={w}
              onClick={() => onSelect(w)}
              className={`px-3 py-3 text-sm font-bold border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                selected === w ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {w}
              <span className="text-xs font-normal opacity-70">({val.athleteCount})</span>
              {ok && <CheckCircle size={14} className="text-green-600" />}
              {issues > 0 && (
                <span className={`inline-flex items-center gap-0.5 text-[11px] px-1 rounded ${val.errors.length ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                  <AlertTriangle size={11} />{issues}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {cat && v ? (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 pb-24 lg:pb-6 flex flex-col lg:flex-row gap-4 lg:gap-6">
            <div className="flex-1 min-w-0 space-y-4">
              {/* Category header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-slate-900">{selected}</h2>
                    {cat.gender && (
                      <span className={`text-xs font-bold ${cat.gender === 'Male' ? 'text-blue-500' : cat.gender === 'Female' ? 'text-pink-500' : 'text-purple-500'}`}>
                        {cat.gender}
                      </span>
                    )}
                    {cat.source === 'ai' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                        <Sparkles size={11} /> AI extracted
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">
                    <strong className="text-slate-800">{v.athleteCount}</strong>
                    {cat.declaredCount != null && <> / {cat.declaredCount} declared</>} athletes · {cat.fieldSize / 2} fights
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Field size
                  <select
                    value={cat.fieldSize}
                    onChange={e => changeFieldSize(Number(e.target.value))}
                    className="px-2 py-1 text-sm font-medium normal-case border border-slate-200 rounded-lg bg-white text-slate-800"
                  >
                    {FIELD_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cat.reviewed}
                    onChange={e => apply(d => updateCategory(d, selected, { reviewed: e.target.checked }))}
                    className="rounded text-green-600 w-4 h-4"
                  />
                  Mark reviewed
                </label>
                <button
                  onClick={() => onRemoveCategory(selected)}
                  className="ml-auto flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-red-500"
                  title="Remove this category from the draft"
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>

              {/* Issues */}
              {(v.errors.length > 0 || v.warnings.length > 0 || cat.warnings.length > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-1">
                  {v.errors.map((m, i) => (
                    <div key={`e${i}`} className="flex items-start gap-1.5 text-red-700 font-semibold"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{m}</div>
                  ))}
                  {v.warnings.map((m, i) => (
                    <div key={`w${i}`} className="flex items-start gap-1.5 text-amber-800"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{m}</div>
                  ))}
                  {cat.warnings.length > 0 && (
                    <div className="pt-1 mt-1 border-t border-amber-200">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900">Import notes</span>
                        <button
                          onClick={() => apply(d => updateCategory(d, selected, { warnings: [] }))}
                          className="flex items-center gap-0.5 text-amber-700 hover:text-amber-900 font-bold"
                        >
                          <X size={12} /> Dismiss
                        </button>
                      </div>
                      {cat.warnings.map((m, i) => <div key={`n${i}`} className="text-amber-800">{m}</div>)}
                    </div>
                  )}
                </div>
              )}

              <PoolGrid cat={cat} weight={selected} handlers={handlers} />
            </div>

            <UnassignedTray
              draft={draft}
              currentWeight={selected}
              handlers={handlers}
              onAddAthlete={(name, country) => apply(d => addAthlete(d, selected, { name, country }))}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 text-center text-slate-400 py-12">Select a category tab above.</div>
      )}

      <DragOverlay dropAnimation={null}>
        {activeAthlete ? <div className="w-56"><ChipBody athlete={activeAthlete} overlay /></div> : null}
      </DragOverlay>
    </DndContext>
  );
};

export default BracketEditor;
