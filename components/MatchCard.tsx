
import React, { useState } from 'react';
import { Match, Competitor } from '../types';
import Flag from './ui/Flag';
import { CheckCircle, GripVertical } from 'lucide-react';

type ResultStatus = 'correct' | 'incorrect' | null;

interface MatchCardProps {
  match: Match;
  onPick: (matchId: string, competitorId: string) => void;
  selectedId: string | undefined;
  topCompetitor: Competitor | null;
  bottomCompetitor: Competitor | null;
  isLocked?: boolean;
  onDropCompetitor?: (matchId: string, slot: 'competitor1' | 'competitor2', competitor: Competitor) => void;
  resultStatus?: ResultStatus;
  actualWinnerId?: string;
}

const MatchCard: React.FC<MatchCardProps> = ({ 
  match, 
  onPick, 
  selectedId, 
  topCompetitor, 
  bottomCompetitor,
  isLocked = false,
  onDropCompetitor,
  resultStatus = null,
  actualWinnerId,
}) => {
  const [dragOverSlot, setDragOverSlot] = useState<'top' | 'bottom' | null>(null);

  const handleDragOver = (e: React.DragEvent, slot: 'top' | 'bottom') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSlot(slot);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverSlot(null);
    }
  };

  const handleDrop = (e: React.DragEvent, slot: 'competitor1' | 'competitor2') => {
    e.preventDefault();
    setDragOverSlot(null);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.name && onDropCompetitor) {
        onDropCompetitor(match.id, slot, data as Competitor);
      }
    } catch { /* ignore bad data */ }
  };

  const renderCompetitor = (competitor: Competitor | null, isTop: boolean) => {
    const isSelected = selectedId === competitor?.id;
    const slot: 'competitor1' | 'competitor2' = isTop ? 'competitor1' : 'competitor2';
    const isDragTarget = (isTop && dragOverSlot === 'top') || (!isTop && dragOverSlot === 'bottom');

    const canDrag = match.round === 'R1' && !!onDropCompetitor;
    
    const dragHandlers = canDrag && competitor ? {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData('application/json', JSON.stringify(competitor));
        e.dataTransfer.effectAllowed = 'move';
      }
    } : {};

    const dropHandlers = onDropCompetitor ? {
      onDragOver: (e: React.DragEvent) => handleDragOver(e, isTop ? 'top' : 'bottom'),
      onDragLeave: handleDragLeave,
      onDrop: (e: React.DragEvent) => handleDrop(e, slot),
    } : {};
    
    if (!competitor) {
      return (
        <div 
          {...dropHandlers}
          className={`flex items-center p-3 h-12 transition-colors ${isTop ? 'border-b border-slate-200' : ''} ${isDragTarget ? 'bg-blue-50 border-l-4 border-l-blue-400' : ''}`}
        >
          <span className={`text-sm italic ${isDragTarget ? 'text-blue-400 font-medium' : 'text-slate-300'}`}>
            {isDragTarget ? 'Drop here' : '---'}
          </span>
        </div>
      );
    }

    const isActualWinner = actualWinnerId === competitor.id;

    let borderClass = 'bg-white border-l-4 border-l-transparent hover:bg-slate-50';
    if (isDragTarget) {
      borderClass = 'bg-blue-100 border-l-4 border-l-blue-400';
    } else if (resultStatus === 'correct' && isSelected) {
      borderClass = 'bg-emerald-50 border-l-4 border-l-emerald-500';
    } else if (resultStatus === 'incorrect' && isSelected) {
      borderClass = 'bg-red-50 border-l-4 border-l-red-400';
    } else if (resultStatus && isActualWinner && !isSelected) {
      borderClass = 'bg-emerald-50/50 border-l-4 border-l-emerald-300';
    } else if (isSelected) {
      borderClass = 'bg-green-50 border-l-4 border-l-green-500';
    }

    return (
      <div 
        {...dropHandlers}
        {...dragHandlers}
        onClick={() => !isLocked && onPick(match.id, competitor.id)}
        className={`flex items-center justify-between p-3 h-12 cursor-pointer transition-colors ${isTop ? 'border-b border-slate-200' : ''} ${borderClass}`}
      >
        <div className="flex items-center gap-3">
          {canDrag && (
            <div className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing mr-[-4px]">
               <GripVertical size={14} />
            </div>
          )}
          {competitor.rank != null && competitor.rank !== '' && competitor.rank !== 'UR' && (
            <span className="text-xs text-slate-400 w-8 font-medium shrink-0">({competitor.rank})</span>
          )}
          <Flag countryCode={competitor.country} className="w-5 h-3.5 shadow-sm" />
          <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
            {competitor.name}
          </span>
          <span className="text-xs text-slate-500 font-bold">{competitor.country}</span>
        </div>
        <div className="flex items-center gap-1">
          {resultStatus === 'correct' && isSelected && <CheckCircle size={16} className="text-emerald-500" />}
          {resultStatus === 'incorrect' && isSelected && <span className="text-red-400 text-xs font-bold">✗</span>}
          {resultStatus && isActualWinner && !isSelected && <CheckCircle size={14} className="text-emerald-400 opacity-60" />}
          {!resultStatus && isSelected && <CheckCircle size={16} className="text-green-500" />}
        </div>
      </div>
    );
  };

  const cardBorderClass = resultStatus === 'correct'
    ? 'border-emerald-400'
    : resultStatus === 'incorrect'
    ? 'border-red-300'
    : 'border-slate-300';

  const headerBgClass = resultStatus === 'correct'
    ? 'bg-emerald-50'
    : resultStatus === 'incorrect'
    ? 'bg-red-50'
    : 'bg-slate-50';

  return (
    <div className={`flex flex-col w-72 bg-white border ${cardBorderClass} rounded-lg shadow-sm overflow-hidden z-10 relative`}>
      <div className={`flex justify-between items-center px-3 py-1.5 ${headerBgClass} border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider`}>
        <span className={resultStatus === 'correct' ? 'text-emerald-600' : resultStatus === 'incorrect' ? 'text-red-500' : 'text-blue-600'}>
          Match {match.matchNumber}
        </span>
        {match.round === 'SF' ? (
          <span className="text-slate-500">Semi</span>
        ) : match.round === 'F' ? (
          <span className="text-slate-500">Final</span>
        ) : match.round === 'B' ? (
          <span className="text-slate-500">Bronze</span>
        ) : match.pool ? (() => {
          const poolColorMap: Record<string, string> = {
            A: 'text-red-600',
            B: 'text-blue-600',
            C: 'text-green-600',
            D: 'text-yellow-500',
          };
          const colorClass = poolColorMap[match.pool] ?? 'text-slate-400';
          return <span className={colorClass}>Pool {match.pool}</span>;
        })() : null}
      </div>
      {renderCompetitor(topCompetitor, true)}
      {renderCompetitor(bottomCompetitor, false)}
    </div>
  );
};

export default MatchCard;
