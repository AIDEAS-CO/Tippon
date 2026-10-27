import React, { useMemo, useEffect } from 'react';
import { Match, UserPicks } from '../types';
import { sortedUniqueRounds } from '../lib/bracketUtils';

export interface MobileBracketTab {
  key: string;
  label: string;
  /** Matches grouped by round label, in bracket order. */
  groups: { title: string; matches: Match[] }[];
}

const POOLS = ['A', 'B', 'C', 'D'];

const roundTitle = (round: string, allMainRounds: string[]): string => {
  if (round === 'F') return 'Final';
  if (round === 'SF') return 'Semi Finals';
  if (round === 'QF') return 'Quarter Finals';
  if (round === 'REP') return 'Repechage';
  if (round === 'B') return 'Bronze';
  const idx = allMainRounds.indexOf(round);
  return `Round ${idx >= 0 ? idx + 1 : round.replace(/^R/, '')}`;
};

const groupByRound = (list: Match[], allMainRounds: string[]) =>
  sortedUniqueRounds(list).map(r => ({
    title: roundTitle(r, allMainRounds),
    matches: list.filter(m => m.round === r).sort((a, b) => a.matchNumber - b.matchNumber),
  }));

/**
 * Derive phone tabs from the category's matches:
 * - Pool A–D: main-bracket matches tagged with that pool, excluding SF/F (SF reuses pool A/B
 *   as half labels). This covers R1 up to the pool final (QF in 16+ draws, R1 in 8-draws).
 * - "QF"/"Rounds": any remaining main matches before SF that have no A–D pool (rare/legacy).
 * - SF, Final, Repechage / Bronze: by round / roundType.
 * Empty tabs are omitted.
 */
export function deriveMobileTabs(matches: Match[]): MobileBracketTab[] {
  const main = matches.filter(m => m.roundType !== 'repechage' && m.roundType !== 'bronze');
  const allMainRounds = sortedUniqueRounds(main);
  const tabs: MobileBracketTab[] = [];
  const used = new Set<string>();

  POOLS.forEach(p => {
    const list = main.filter(m => m.pool === p && m.round !== 'SF' && m.round !== 'F');
    if (list.length === 0) return;
    list.forEach(m => used.add(m.id));
    tabs.push({ key: `pool-${p}`, label: `Pool ${p}`, groups: groupByRound(list, allMainRounds) });
  });

  const rest = main.filter(m => !used.has(m.id) && m.round !== 'SF' && m.round !== 'F');
  if (rest.length > 0) {
    const allQf = rest.every(m => m.round === 'QF');
    tabs.push({ key: 'qf', label: allQf ? 'QF' : 'Rounds', groups: groupByRound(rest, allMainRounds) });
  }

  const sf = main.filter(m => m.round === 'SF');
  if (sf.length > 0) tabs.push({ key: 'sf', label: 'SF', groups: groupByRound(sf, allMainRounds) });

  const final = main.filter(m => m.round === 'F');
  if (final.length > 0) tabs.push({ key: 'final', label: 'Final', groups: groupByRound(final, allMainRounds) });

  const repBronze = matches.filter(m => m.roundType === 'repechage' || m.roundType === 'bronze');
  if (repBronze.length > 0) {
    tabs.push({ key: 'rep', label: 'Repechage / Bronze', groups: groupByRound(repBronze, allMainRounds) });
  }

  return tabs;
}

interface MobileBracketTabsProps {
  matches: Match[];
  picks: UserPicks;
  activeTab: string | undefined;
  onTabChange: (tab: string) => void;
  /** Renders one match card (same pick/golden wiring as the desktop tree). */
  renderMatch: (match: Match) => React.ReactNode;
  /** Additional pick (Zusatztipp) block; tab hidden when null. */
  extraPick: React.ReactNode | null;
}

const EXTRA_TAB = 'extra';

const MobileBracketTabs: React.FC<MobileBracketTabsProps> = ({ matches, picks, activeTab, onTabChange, renderMatch, extraPick }) => {
  const tabs = useMemo(() => deriveMobileTabs(matches), [matches]);
  const allKeys = [...tabs.map(t => t.key), ...(extraPick ? [EXTRA_TAB] : [])];
  const current = activeTab && allKeys.includes(activeTab) ? activeTab : allKeys[0];

  useEffect(() => {
    if (current && current !== activeTab) onTabChange(current);
  }, [current, activeTab, onTabChange]);

  const tabProgress = (t: MobileBracketTab) => {
    const list = t.groups.flatMap(g => g.matches);
    return { done: list.filter(m => !!picks[m.id]).length, total: list.length };
  };

  const currentTab = tabs.find(t => t.key === current);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur border-b border-slate-200">
        <div className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
          {tabs.map(t => {
            const { done, total } = tabProgress(t);
            const active = t.key === current;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onTabChange(t.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${
                  active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 ${active ? 'text-blue-100' : done === total ? 'text-green-600' : 'text-slate-400'}`}>
                  {done}/{total}
                </span>
              </button>
            );
          })}
          {extraPick && (
            <button
              type="button"
              onClick={() => onTabChange(EXTRA_TAB)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${
                current === EXTRA_TAB ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              Extra pick
              {picks['additional_pick'] && <span className={`ml-1.5 ${current === EXTRA_TAB ? 'text-blue-100' : 'text-green-600'}`}>✓</span>}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {current === EXTRA_TAB ? (
          extraPick
        ) : currentTab ? (
          currentTab.groups.map(g => (
            <section key={g.title}>
              <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{g.title}</h3>
              <div className="space-y-3">
                {g.matches.map(m => (
                  <React.Fragment key={m.id}>{renderMatch(m)}</React.Fragment>
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className="text-sm text-slate-400 text-center py-8">No matches in this category yet.</p>
        )}
      </div>
    </div>
  );
};

export default MobileBracketTabs;
