import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import AthleteChip from './AthleteChip';
import { poolOfMatch, type DraftCategory, type DrawAthlete, type Pool } from '../../lib/bracketDraft';

export interface ChipHandlers {
  categoryNames: string[];
  onUpdate: (id: string, patch: { name?: string; country?: string }) => void;
  onDelete: (id: string) => void;
  onMoveToCategory: (id: string, weight: string) => void;
}

const SlotRow: React.FC<{ weight: string; index: number; athlete: DrawAthlete | null; handlers: ChipHandlers }> = ({ weight, index, athlete, handlers }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${weight}:${index}`, data: { weight, slot: index } });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[34px] flex items-center rounded-lg transition-colors ${isOver ? 'bg-blue-100 ring-2 ring-blue-400' : ''}`}
    >
      {athlete ? (
        <AthleteChip athlete={athlete} weight={weight} {...handlers} />
      ) : (
        <div className={`w-full px-2 py-1.5 rounded-lg border border-dashed text-[11px] font-bold tracking-wider text-center ${isOver ? 'border-blue-400 text-blue-500' : 'border-slate-200 text-slate-300'}`}>
          BYE
        </div>
      )}
    </div>
  );
};

const POOL_STYLES: Record<Pool, string> = {
  A: 'border-t-blue-500',
  B: 'border-t-emerald-500',
  C: 'border-t-amber-500',
  D: 'border-t-pink-500',
};

/** R1 draw split into Pool A–D columns; each fight card has two droppable slots. */
const PoolGrid: React.FC<{ cat: DraftCategory; weight: string; handlers: ChipHandlers }> = ({ cat, weight, handlers }) => {
  const matchCount = cat.fieldSize / 2;
  const pools: Record<Pool, number[]> = { A: [], B: [], C: [], D: [] };
  for (let i = 0; i < matchCount; i++) pools[poolOfMatch(i, matchCount)].push(i);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {(Object.keys(pools) as Pool[]).map(pool => {
        const filled = pools[pool].reduce((n, i) => n + (cat.slots[2 * i] ? 1 : 0) + (cat.slots[2 * i + 1] ? 1 : 0), 0);
        return (
          <div key={pool} className={`bg-white rounded-xl border border-slate-200 border-t-4 ${POOL_STYLES[pool]} shadow-sm`}>
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100">
              <h3 className="font-black text-slate-800 text-sm">Pool {pool}</h3>
              <span className="text-[11px] text-slate-400 font-medium">{filled} athletes</span>
            </div>
            <div className="p-2 space-y-2">
              {pools[pool].map(i => (
                <div key={i} className="rounded-lg bg-slate-50 border border-slate-100 p-1.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-1">Fight {i + 1}</div>
                  <div className="space-y-1">
                    <SlotRow weight={weight} index={2 * i} athlete={cat.slots[2 * i] ?? null} handlers={handlers} />
                    <SlotRow weight={weight} index={2 * i + 1} athlete={cat.slots[2 * i + 1] ?? null} handlers={handlers} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PoolGrid;
