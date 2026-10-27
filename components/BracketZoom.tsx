import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';

const STORAGE_KEY = 'tippon-bracket-zoom';
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const STEP = 0.1;

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(v * 100) / 100));

const readStoredScale = (): number => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(n) ? clamp(n) : 1;
  } catch {
    return 1;
  }
};

/**
 * Zoomable wrapper for the desktop/tablet bracket tree.
 * Uses CSS transform scale (top-left origin) inside a wrapper sized to the scaled
 * content so the surrounding scroll container gets correct scrollbars.
 * Supports -/+/Fit buttons, ctrl/cmd + wheel, and two-finger pinch (pointer events).
 */
const BracketZoom: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scale, setScale] = useState<number>(readStoredScale);
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(scale)); } catch { /* ignore */ }
  }, [scale]);

  // Track the unscaled size of the content (offset sizes ignore transforms)
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setNatural({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const outer = outerRef.current;
    if (!outer || !natural.w) return;
    setScale(clamp(outer.clientWidth / natural.w));
  }, [natural.w]);

  // ctrl/cmd + wheel zoom (needs a non-passive listener to prevent page zoom)
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale(s => clamp(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const distance = () => {
    const pts: { x: number; y: number }[] = [];
    pointers.current.forEach(p => pts.push(p));
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinchStart.current = { dist: distance(), scale: scaleRef.current };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current && pinchStart.current.dist > 0) {
      const ratio = distance() / pinchStart.current.dist;
      setScale(clamp(pinchStart.current.scale * ratio));
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  return (
    <div ref={outerRef} className="w-full">
      <div className="sticky left-0 z-20 flex items-center gap-1 mb-4 w-max bg-white/90 backdrop-blur border border-slate-200 rounded-lg shadow-sm p-1">
        <button type="button" onClick={() => setScale(s => clamp(s - STEP))} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Zoom out" aria-label="Zoom out">
          <Minus size={16} />
        </button>
        <button type="button" onClick={() => setScale(1)} className="px-2 text-xs font-bold text-slate-600 tabular-nums w-14 hover:bg-slate-100 rounded py-1" title="Reset zoom">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={() => setScale(s => clamp(s + STEP))} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Zoom in" aria-label="Zoom in">
          <Plus size={16} />
        </button>
        <button type="button" onClick={fit} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 text-slate-600 text-xs font-bold" title="Fit to width">
          <Maximize2 size={14} />
          Fit
        </button>
      </div>
      <div
        style={{ width: natural.w * scale || undefined, height: natural.h * scale || undefined, touchAction: 'pan-x pan-y' }}
        className="relative"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
      >
        <div
          ref={innerRef}
          className="w-max absolute top-0 left-0"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default BracketZoom;
