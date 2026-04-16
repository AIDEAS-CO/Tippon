import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ViewState, Tournament, Match, Competitor, CategoryStandings } from '../types';
import { supabase } from '../lib/supabaseClient';
import { calculateAllCategoryScores, calculateScores, calculateBonusesAndMedalTable } from '../lib/scoringEngine';
import { CategoryStatus } from '../types';
import Flag from '../components/ui/Flag';
import { GoogleGenAI, Type } from '@google/genai';
import {
  ArrowLeft, ChevronDown, Loader2, Trophy, CheckCircle, Calculator,
  Lock, AlertCircle, Check, FileUp, Upload, X, Trash2,
} from 'lucide-react';
import { buildMatchesForBracket, deriveStandings, sortedUniqueRounds } from '../lib/bracketUtils';
import { computeCountryMedalRanking } from '../lib/countryMedalRanking';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalize a weight string for comparison: strips gender prefix and whitespace. */
const normalizeWeight = (s: string) =>
  s.toLowerCase().replace(/\s+/g, '').replace(/^(men'?s?|women'?s?|male|female)/i, '');

const weightsMatch = (dbCat: string, pdfCat: string): boolean => {
  const a = normalizeWeight(dbCat);
  const b = normalizeWeight(pdfCat);
  return a === b || a.includes(b) || b.includes(a);
};

function sortStandingsForDisplay(rows: CategoryStandings[]): CategoryStandings[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position || (a.competitorName || '').localeCompare(b.competitorName || '')
  );
}

function ordinalPosition(pos: number): string {
  if (pos === 1) return '1st';
  if (pos === 2) return '2nd';
  if (pos === 3) return '3rd';
  if (pos === 5) return '5th';
  if (pos === 7) return '7th';
  return `${pos}th`;
}

function medalEmoji(pos: number): string {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  return '';
}


// ─── Gemini PDF Results Extraction ──────────────────────────────────────────

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
  });

const extractResultsFromPDF = async (file: File) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing. Add it to .env.local and restart the server.');

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = await fileToBase64(file);

  const prompt = `Extract the tournament RESULTS from this Judo bracket PDF.
This PDF shows the completed bracket with winners filled in for every round.

Return a JSON array where each element represents a weight category.
For each category, extract ALL matches from ALL completed rounds with their winners.

CRITICAL RULES:
- Include matches from every round present: R1 (Round 1), R2, R3, QF (Quarter Finals), REP (Repechage), SF (Semi Finals), B (Bronze Medal Match), F (Final).
- For each match: the round identifier, the position within that round (1 = topmost, incrementing down), and the winner's name and country.
- Round identifiers exactly: "R1", "R2", "R3", "QF", "REP", "SF", "B", "F".
- If the bracket has a repechage system: QF losers fight in REP matches; REP winners + SF losers fight in B (Bronze Medal) matches. Extract winners of REP and B matches too.
- winner_name: LAST NAME First Name format (e.g. "BEKAURI Lasha").
- winner_country: 3-letter IOC code (e.g. "GEO").
- Only include rounds where results are clearly visible.`;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        weight: { type: Type.STRING },
        matches: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              round: { type: Type.STRING },
              position: { type: Type.INTEGER },
              winner_name: { type: Type.STRING },
              winner_country: { type: Type.STRING },
            },
          },
        },
      },
    },
  };

  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Results Reader] Attempt ${attempt}/${maxRetries}...`);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
          { inlineData: { mimeType: 'application/pdf', data: base64Data } },
          prompt,
        ],
        config: {
          httpOptions: { timeout: 120_000 },
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
        },
      });

      const responseText = response.text;
      if (!responseText) throw new Error('Gemini returned an empty response. Try a different PDF.');

      const parsed = JSON.parse(responseText);
      console.log(`[Results Reader] Extracted ${parsed.length} categories`);
      return parsed as Array<{
        weight: string;
        matches: Array<{ round: string; position: number; winner_name: string; winner_country: string }>;
      }>;
    } catch (err: any) {
      lastError = err;
      const is503 =
        err?.message?.includes('503') ||
        err?.message?.includes('UNAVAILABLE') ||
        err?.message?.includes('high demand');
      console.warn(`[Results Reader] Error on attempt ${attempt}:`, err?.message?.substring(0, 150));
      if (!is503) throw err;
      if (attempt < maxRetries) {
        const waitSec = attempt * 3;
        console.log(`[Results Reader] Waiting ${waitSec}s before retry...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }

  throw lastError || new Error('Could not connect to Gemini API after multiple attempts.');
};

// ─── Name-matching helper ────────────────────────────────────────────────────

const namesMatch = (extracted: string, bracket: string): boolean => {
  if (!extracted || !bracket) return false;
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');
  const a = normalize(extracted);
  const b = normalize(bracket);
  if (!a || !b) return false;
  const aKey = a.substring(0, Math.min(6, a.length));
  const bKey = b.substring(0, Math.min(6, b.length));
  return aKey === bKey || a.includes(b.substring(0, 5)) || b.includes(a.substring(0, 5));
};

// ─── Apply extracted results to bracket ─────────────────────────────────────

const applyExtractedResults = (
  extractedMatches: Array<{ round: string; position: number; winner_name: string; winner_country: string }>,
  freshMatches: Match[]
): { results: Record<string, string>; updatedMatches: Match[] } => {
  const newResults: Record<string, string> = {};
  const workingMatches = freshMatches.map(m => ({ ...m }));

  const sortedRounds = sortedUniqueRounds(workingMatches);

  for (const roundId of sortedRounds) {
    const extractedRound = extractedMatches
      .filter(m => m.round === roundId)
      .sort((a, b) => a.position - b.position);

    if (extractedRound.length === 0) continue;

    const bracketRound = workingMatches
      .filter(m => m.round === roundId)
      .sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0));

    for (let i = 0; i < Math.min(extractedRound.length, bracketRound.length); i++) {
      const extracted = extractedRound[i];
      const match = bracketRound[i];

      let winnerId: string | null = null;
      if (match.competitor1 && match.competitor2) {
        if (namesMatch(extracted.winner_name, match.competitor1.name)) {
          winnerId = match.competitor1.id;
        } else if (namesMatch(extracted.winner_name, match.competitor2.name)) {
          winnerId = match.competitor2.id;
        }
      } else if (match.competitor1 && !match.competitor2) {
        winnerId = match.competitor1.id;
      } else if (!match.competitor1 && match.competitor2) {
        winnerId = match.competitor2.id;
      }

      if (winnerId) {
        newResults[match.id] = winnerId;
        const winner = match.competitor1?.id === winnerId ? match.competitor1 : match.competitor2;
        const loser = match.competitor1?.id === winnerId ? match.competitor2 : match.competitor1;

        // Propagate winner forward
        if (winner && match.nextMatchId) {
          const target = workingMatches.find(m => m.id === match.nextMatchId);
          if (target) {
            if (match.nextMatchSlot === 1) target.competitor1 = winner;
            else target.competitor2 = winner;
          }
        }

        // Propagate loser to repechage / bronze (IJF cross-over)
        if (loser && match.loserNextMatchId && match.competitor1 && match.competitor2) {
          const loserTarget = workingMatches.find(m => m.id === match.loserNextMatchId);
          if (loserTarget) {
            if (match.loserNextMatchSlot === 1) loserTarget.competitor1 = loser;
            else loserTarget.competitor2 = loser;
          }
        }
      }
    }
  }

  return { results: newResults, updatedMatches: workingMatches };
};

// ─── Result Match Card ───────────────────────────────────────────────────────

const ResultMatchCard: React.FC<{
  match: Match;
  results: Record<string, string>;
  onSelectWinner: (matchId: string, competitorId: string) => void;
}> = ({ match, results, onSelectWinner }) => {
  const selectedWinnerId = results[match.id];
  const hasBothCompetitors = match.competitor1 !== null && match.competitor2 !== null;

  const renderRow = (competitor: Competitor | null, isTop: boolean) => {
    if (!competitor) {
      return (
        <div className={`flex items-center p-3 h-12 ${isTop ? 'border-b border-slate-200' : ''}`}>
          <span className="text-xs italic text-slate-300">---</span>
        </div>
      );
    }
    const isSelected = selectedWinnerId === competitor.id;
    return (
      <div
        onClick={() => hasBothCompetitors && onSelectWinner(match.id, competitor.id)}
        className={`flex items-center justify-between p-3 h-12 transition-colors select-none ${
          isTop ? 'border-b border-slate-200' : ''
        } ${hasBothCompetitors ? 'cursor-pointer' : 'cursor-default'} ${
          isSelected
            ? 'bg-emerald-50 border-l-4 border-l-emerald-500'
            : 'bg-white border-l-4 border-l-transparent hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Flag countryCode={competitor.country} className="w-5 h-3.5 shadow-sm flex-shrink-0" />
          <span className="text-xs font-semibold text-slate-800 truncate">{competitor.name}</span>
          <span className="text-[10px] text-slate-400 font-bold">{competitor.country}</span>
        </div>
        {isSelected && <Check size={14} className="text-emerald-500 flex-shrink-0" />}
      </div>
    );
  };

  const roundLabel =
    match.round === 'F' ? 'Final' :
    match.round === 'SF' ? 'SF' :
    match.round === 'QF' ? 'QF' :
    `${match.round}`;

  return (
    <div className="w-64 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="flex justify-between items-center px-3 py-1.5 bg-emerald-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider">
        <span className="text-emerald-600">{roundLabel} · M{match.matchNumber}</span>
        {selectedWinnerId && <CheckCircle size={12} className="text-emerald-500" />}
      </div>
      {renderRow(match.competitor1, true)}
      {renderRow(match.competitor2, false)}
    </div>
  );
};

// ─── Results Bracket Node (recursive) ────────────────────────────────────────

const ResultsBracketNode: React.FC<{
  match: Match;
  matches: Match[];
  results: Record<string, string>;
  onSelectWinner: (matchId: string, competitorId: string) => void;
}> = ({ match, matches, results, onSelectWinner }) => {
  const children = matches.filter(m => m.nextMatchId === match.id);
  const topChild = children.find(m => m.nextMatchSlot === 1);
  const bottomChild = children.find(m => m.nextMatchSlot === 2);

  return (
    <div className="flex items-center h-full">
      {(topChild || bottomChild) && (
        <div className="flex flex-col justify-around h-full relative">
          {topChild && (
            <div className="relative flex items-center flex-1">
              <ResultsBracketNode match={topChild} matches={matches} results={results} onSelectWinner={onSelectWinner} />
              <div className="w-4 border-t border-slate-300 absolute right-0 top-[50%] translate-x-full"></div>
            </div>
          )}
          {bottomChild && (
            <div className="relative flex items-center flex-1">
              <ResultsBracketNode match={bottomChild} matches={matches} results={results} onSelectWinner={onSelectWinner} />
              <div className="w-4 border-t border-slate-300 absolute right-0 top-[50%] translate-x-full"></div>
            </div>
          )}
          {topChild && bottomChild && (
            <div className="absolute right-[-1rem] top-[25%] bottom-[25%] border-r border-slate-300"></div>
          )}
        </div>
      )}
      {(topChild || bottomChild) && (
        <div className="w-4 border-t border-slate-300 ml-4"></div>
      )}
      <div className="relative px-2">
        <ResultMatchCard match={match} results={results} onSelectWinner={onSelectWinner} />
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface TournamentResultsProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  onTournamentUpdated?: () => void;
  categoryStatuses?: Record<string, CategoryStatus>;
  onCategoryClose?: (tournamentId: string, categoryName: string) => Promise<void>;
  onCategoryDelete?: (tournamentId: string, categoryName: string) => Promise<void>;
  onCategoryLock?: (tournamentId: string, categoryName: string) => Promise<void>;
  onCategoryReopen?: (tournamentId: string, categoryName: string) => Promise<void>;
  onMedalTableLock?: (tournamentId: string) => Promise<void>;
  onMedalTableReopen?: (tournamentId: string) => Promise<void>;
  medalTableStatus?: 'open' | 'locked';
}

const TournamentResults: React.FC<TournamentResultsProps> = ({
  onNavigate,
  tournament,
  onTournamentUpdated,
  categoryStatuses,
  onCategoryClose,
  onCategoryDelete,
  onCategoryLock,
  onCategoryReopen,
  onMedalTableLock,
  onMedalTableReopen,
  medalTableStatus = 'open',
}) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [champion, setChampion] = useState<Competitor | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isClosingCategory, setIsClosingCategory] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // PDF extraction state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [showPdfUpload, setShowPdfUpload] = useState(false);

  const [countryMedalRows, setCountryMedalRows] = useState<
    { country: string; g: number; s: number; b: number; total: number }[] | null
  >(null);
  const [countryMedalLoading, setCountryMedalLoading] = useState(false);

  useEffect(() => {
    if (!tournament?.id) return;
    loadBracketData();
  }, [selectedCategory, tournament?.id]);

  const loadBracketData = async () => {
    if (!tournament?.id) return;
    setIsLoading(true);

    try {
      const { data: dbMatches, error: bracketError } = await supabase
        .from('competition_brackets')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('match_number', { ascending: true });

      if (bracketError) throw bracketError;
      if (!dbMatches || dbMatches.length === 0) { setIsLoading(false); return; }

      const bracketCategories = Array.from(
        new Set(dbMatches.map((m: any) => m.weight_category).filter(Boolean))
      ).sort() as string[];

      if (bracketCategories.length > 0) {
        setCategories(bracketCategories);
        if (!selectedCategory || !bracketCategories.includes(selectedCategory)) {
          setSelectedCategory(bracketCategories[0]);
          setIsLoading(false);
          return;
        }
      }

      const { data: roster } = await supabase
        .from('tournament_roster')
        .select('*')
        .eq('tournament_id', tournament.id);

      const rosterMap: Record<string, any> = {};
      if (roster) {
        roster.forEach((athlete) => {
          rosterMap[athlete.id] = {
            id: athlete.id,
            name: `${(athlete.last_name || '').toUpperCase()} ${athlete.first_name || ''}`.trim(),
            country: athlete.country || 'N/A',
            flagUrl: '',
            weight: athlete.weight_category,
          };
        });
      }

      const categoryDbMatches = dbMatches.filter(
        (m: any) => m.weight_category === selectedCategory
      );

      const hasRepechage = !!(tournament as any)?.scoring_configuration?.has_repechage;
      const freshMatches = buildMatchesForBracket(categoryDbMatches, rosterMap, selectedCategory, hasRepechage);

      // Load saved results
      const { data: existingResults } = await supabase
        .from('match_results')
        .select('match_id, winner_competitor_id')
        .eq('tournament_id', tournament.id)
        .eq('category', selectedCategory);

      const savedResults: Record<string, string> = {};
      if (existingResults) {
        existingResults.forEach((r) => { savedResults[r.match_id] = r.winner_competitor_id; });
      }

      // BYE auto-advance
      freshMatches.forEach((m) => {
        if (m.round !== 'R1') return;
        if (m.competitor1 && !m.competitor2) savedResults[m.id] = m.competitor1.id;
        if (!m.competitor1 && m.competitor2) savedResults[m.id] = m.competitor2.id;
      });

      // Propagate winners and losers
      const sortedRounds = sortedUniqueRounds(freshMatches);

      sortedRounds.forEach((r) => {
        freshMatches.filter(m => m.round === r).forEach((match) => {
          const winnerId = savedResults[match.id];
          if (!winnerId) return;
          const winner =
            match.competitor1?.id === winnerId ? match.competitor1 :
            match.competitor2?.id === winnerId ? match.competitor2 : null;

          // Winner forward
          if (winner && match.nextMatchId) {
            const target = freshMatches.find(tm => tm.id === match.nextMatchId);
            if (target) {
              if (match.nextMatchSlot === 1) target.competitor1 = winner;
              else target.competitor2 = winner;
            }
          }

          // Loser to repechage / bronze
          if (match.loserNextMatchId && match.competitor1 && match.competitor2) {
            const loser = match.competitor1.id === winnerId ? match.competitor2 : match.competitor1;
            const loserTarget = freshMatches.find(tm => tm.id === match.loserNextMatchId);
            if (loserTarget && loser) {
              if (match.loserNextMatchSlot === 1) loserTarget.competitor1 = loser;
              else loserTarget.competitor2 = loser;
            }
          }

          if (match.round === 'F' && winner) setChampion(winner);
        });
      });

      setMatches(freshMatches);
      setResults(savedResults);
    } catch (err) {
      console.error('Error loading results data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Select winner (manual click) ───────────────────────────────────────

  const handleSelectWinner = (matchId: string, competitorId: string) => {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;

    const newResults = { ...results, [matchId]: competitorId };
    setResults(newResults);

    const winner = match.competitor1?.id === competitorId ? match.competitor1 : match.competitor2;
    const loser = match.competitor1?.id === competitorId ? match.competitor2 : match.competitor1;

    if (match.nextMatchId || match.loserNextMatchId) {
      setMatches(prev => {
        const cloned = prev.map(m => ({ ...m }));

        // Winner forward
        if (match.nextMatchId && winner) {
          const target = cloned.find(m => m.id === match.nextMatchId);
          if (target) {
            if (match.nextMatchSlot === 1) target.competitor1 = winner;
            else target.competitor2 = winner;
          }
        }

        // Loser to repechage / bronze
        if (match.loserNextMatchId && loser && match.competitor1 && match.competitor2) {
          const loserTarget = cloned.find(m => m.id === match.loserNextMatchId);
          if (loserTarget) {
            if (match.loserNextMatchSlot === 1) loserTarget.competitor1 = loser;
            else loserTarget.competitor2 = loser;
          }
        }

        return cloned;
      });
    }

    if (match.round === 'F') setChampion(winner || null);
  };

  // ─── PDF Extraction — processes ALL categories from the PDF at once ──────

  const handleExtractFromPDF = async () => {
    if (!pdfFile || !tournament?.id) return;
    setIsExtractingPdf(true);
    setMessage(null);

    try {
      console.log('[Results Reader] Extracting results from PDF...');
      const extracted = await extractResultsFromPDF(pdfFile);
      console.log(`[Results Reader] PDF returned ${extracted.length} categories`);

      // Load everything from DB we'll need
      const [{ data: allDbMatches }, { data: roster }, { data: { user } }] = await Promise.all([
        supabase.from('competition_brackets').select('*').eq('tournament_id', tournament.id).order('match_number', { ascending: true }),
        supabase.from('tournament_roster').select('*').eq('tournament_id', tournament.id),
        supabase.auth.getUser(),
      ]);

      // Build roster map
      const rosterMap: Record<string, any> = {};
      if (roster) {
        roster.forEach((athlete) => {
          rosterMap[athlete.id] = {
            id: athlete.id,
            name: `${(athlete.last_name || '').toUpperCase()} ${athlete.first_name || ''}`.trim(),
            country: athlete.country || 'N/A',
            flagUrl: '',
          };
        });
      }

      const saved: Array<{ category: string; matchCount: number }> = [];
      const notMatched: string[] = [];

      // Process each category from the PDF
      for (const pdfCat of extracted) {
        if (!pdfCat.matches?.length) continue;

        // Find the tournament's category that matches this PDF weight
        const dbCategory = categories.find(c => weightsMatch(c, pdfCat.weight));
        if (!dbCategory) {
          notMatched.push(pdfCat.weight);
          console.log(`[Results Reader] No match for PDF category "${pdfCat.weight}". Tournament categories: ${categories.join(', ')}`);
          continue;
        }

        const categoryDbMatches = (allDbMatches || []).filter(
          (m: any) => m.weight_category === dbCategory
        );
        if (categoryDbMatches.length === 0) {
          notMatched.push(pdfCat.weight);
          continue;
        }

        const hasRepechage2 = !!(tournament as any)?.scoring_configuration?.has_repechage;
        const freshMatches = buildMatchesForBracket(categoryDbMatches, rosterMap, dbCategory, hasRepechage2);
        const { results: newResults } = applyExtractedResults(pdfCat.matches, freshMatches);

        if (Object.keys(newResults).length === 0) {
          notMatched.push(pdfCat.weight);
          continue;
        }

        // Build DB rows for upsert
        const rows = Object.entries(newResults).map(([matchId, winnerId]) => {
          const match = freshMatches.find(m => m.id === matchId);
          const winner = match?.competitor1?.id === winnerId ? match?.competitor1 : match?.competitor2;
          return {
            tournament_id: tournament.id,
            category: dbCategory,
            match_id: matchId,
            round: match?.round || 'R1',
            winner_competitor_id: winnerId,
            winner_name: winner?.name || null,
            entered_by: user?.id || null,
          };
        });

        const { error } = await supabase
          .from('match_results')
          .upsert(rows, { onConflict: 'tournament_id,category,match_id' });

        if (error) {
          console.error(`[Results Reader] Error saving ${dbCategory}:`, error);
        } else {
          saved.push({ category: dbCategory, matchCount: rows.length });
          console.log(`[Results Reader] Saved ${rows.length} results for ${dbCategory}`);
        }
      }

      // Reload the currently visible category
      await loadBracketData();

      setShowPdfUpload(false);
      setPdfFile(null);

      if (saved.length === 0 && notMatched.length > 0) {
        setMessage({
          type: 'error',
          text: `Could not match any PDF categories to this tournament.\nPDF found: ${notMatched.join(', ')}\nTournament has: ${categories.join(', ')}`,
        });
      } else {
        const summary = saved.map(s => `${s.category} (${s.matchCount} matches)`).join(', ');
        const skipped = notMatched.length > 0 ? ` · Skipped (not in tournament): ${notMatched.join(', ')}` : '';
        setMessage({
          type: 'success',
          text: `Results saved for ${saved.length} ${saved.length === 1 ? 'category' : 'categories'}: ${summary}.${skipped} Review each category and correct any errors before finalizing.`,
        });
      }
    } catch (err: any) {
      console.error('[Results Reader] ERROR:', err);
      setMessage({ type: 'error', text: 'Error extracting results: ' + (err?.message || String(err)) });
    } finally {
      setIsExtractingPdf(false);
    }
  };

  // ─── Save Results (current category only) ────────────────────────────────

  const handleSaveResults = async () => {
    if (!tournament?.id) return;
    setIsSaving(true);
    setMessage(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const rows = Object.entries(results).map(([matchId, winnerId]) => {
        const match = matches.find(m => m.id === matchId);
        const winner = match?.competitor1?.id === winnerId ? match?.competitor1 : match?.competitor2;
        return {
          tournament_id: tournament.id,
          category: selectedCategory,
          match_id: matchId,
          round: match?.round || 'R1',
          winner_competitor_id: winnerId,
          winner_name: winner?.name || null,
          entered_by: user?.id || null,
        };
      });

      const { error } = await supabase
        .from('match_results')
        .upsert(rows, { onConflict: 'tournament_id,category,match_id' });

      if (error) throw error;
      setMessage({ type: 'success', text: `Results saved for "${selectedCategory}".` });
    } catch (err: any) {
      console.error('Error saving results:', err);
      setMessage({ type: 'error', text: err?.message || 'Error saving results.' });
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Close Single Category ────────────────────────────────────────────────
  const handleCloseCategory = async (categoryName: string) => {
    if (!tournament?.id) return;
    if (!confirm(
      `Close "${categoryName}"?\n\nThis will calculate scores for this category. Players will no longer be able to edit picks for it.`
    )) return;

    setIsClosingCategory(true);
    setMessage({ type: 'info', text: `Calculating scores for ${categoryName}...` });

    try {
      const result = await calculateScores(tournament.id, categoryName);
      if (!result.success && result.error) {
        console.warn('[CloseCategory] score error:', result.error);
      }

      // Delegate status update + auto-finalize check to App.tsx
      if (onCategoryClose) {
        await onCategoryClose(tournament.id, categoryName);
      }

      setMessage({ type: 'success', text: `"${categoryName}" closed. Scores calculated.` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Error closing category.' });
    } finally {
      setIsClosingCategory(false);
    }
  };

  // ─── Finalize & Close Tournament ─────────────────────────────────────────
  // 1. Calculate scores for all categories
  // 2. Mark tournament as COMPLETED
  // 3. Navigate to leaderboard

  const handleFinalizeTournament = async () => {
    if (!tournament?.id) return;
    if (!confirm(
      `Finalize "${tournament.name}"?\n\n` +
      `This will:\n` +
      `1. Calculate scores for all ${categories.length} categories\n` +
      `2. Mark the tournament as COMPLETED\n\n` +
      `Make sure all results are saved before continuing.`
    )) return;

    setIsClosing(true);
    setMessage({ type: 'info', text: 'Step 1/2 — Calculating scores for all categories...' });

    try {
      // Step 1: Calculate scores
      const scoreResult = await calculateAllCategoryScores(tournament.id, categories);
      if (!scoreResult.success && scoreResult.errors.length > 0) {
        // Non-fatal — warn but continue
        console.warn('[Finalize] Score calculation errors:', scoreResult.errors);
      }

      setMessage({ type: 'info', text: 'Step 2/2 — Closing tournament...' });

      // Step 2: Close tournament
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', tournament.id);

      if (error) throw error;

      setMessage({ type: 'success', text: `Tournament finalized! Scores calculated for ${scoreResult.totalUsersScored} user(s). Redirecting to leaderboard...` });
      onTournamentUpdated?.();
      setTimeout(() => onNavigate('TOURNAMENT_LEADERBOARD'), 2000);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Error finalizing tournament.' });
    } finally {
      setIsClosing(false);
    }
  };

  const countryMedalsLoadedRef = useRef(false);

  const loadAllCategoryCountryMedals = useCallback(async () => {
    if (!tournament?.id || categories.length === 0) return;
    setCountryMedalLoading(true);
    try {
      const hasRepechage = !!(tournament as any)?.scoring_configuration?.has_repechage;
      const [{ data: dbMatches }, { data: roster }, { data: resultRows }] = await Promise.all([
        supabase
          .from('competition_brackets')
          .select('*')
          .eq('tournament_id', tournament.id)
          .order('match_number', { ascending: true }),
        supabase.from('tournament_roster').select('*').eq('tournament_id', tournament.id),
        supabase
          .from('match_results')
          .select('category, match_id, winner_competitor_id')
          .eq('tournament_id', tournament.id),
      ]);
      if (!dbMatches || !roster) {
        setCountryMedalRows([]);
        return;
      }
      const rosterMap: Record<string, any> = {};
      roster.forEach((athlete: any) => {
        rosterMap[athlete.id] = {
          id: athlete.id,
          name: `${(athlete.last_name || '').toUpperCase()} ${athlete.first_name || ''}`.trim(),
          country: athlete.country || 'N/A',
          flagUrl: '',
          weight: athlete.weight_category,
        };
      });
      const resultsByCat = new Map<string, Record<string, string>>();
      for (const r of resultRows || []) {
        if (!resultsByCat.has(r.category)) resultsByCat.set(r.category, {});
        resultsByCat.get(r.category)![r.match_id] = r.winner_competitor_id;
      }
      const rows = computeCountryMedalRanking(
        categories,
        dbMatches,
        rosterMap,
        resultsByCat,
        hasRepechage
      );
      setCountryMedalRows(rows);
    } catch (e) {
      console.error('[TournamentResults] country medal summary', e);
      setCountryMedalRows([]);
    } finally {
      setCountryMedalLoading(false);
    }
  }, [tournament, categories]);

  useEffect(() => {
    countryMedalsLoadedRef.current = false;
    setCountryMedalRows(null);
  }, [tournament?.id]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  const finalMatch = matches.find(m => m.round === 'F');

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">

      {/* Header */}
      <header className="bg-white p-4 border-b flex justify-between items-center shadow-sm flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <button onClick={() => onNavigate('BRACKET')} className="p-2 hover:bg-slate-100 rounded-full">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-lg">{tournament?.name}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-700">
                Results Entry
              </span>
            </div>
            {/* Category selector */}
            <div className="relative">
              <button
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="text-emerald-600 text-sm font-bold flex items-center gap-1"
              >
                {selectedCategory || 'Select category'} <ChevronDown size={14} />
              </button>
              {isCategoryDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-slate-200 z-50 max-h-72 overflow-y-auto">
                  <ul className="py-1">
                    {categories.map(cat => (
                      <li key={cat}>
                        <button
                          onClick={() => { setSelectedCategory(cat); setIsCategoryDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                            selectedCategory === cat ? 'font-bold text-emerald-600 bg-emerald-50' : 'text-slate-700'
                          }`}
                        >
                          <span className="flex-1">{cat}</span>
                          {categoryStatuses?.[cat] === 'closed' && <Lock size={12} className="text-slate-400" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Upload Results PDF — processes ALL categories at once */}
          <button
            onClick={() => setShowPdfUpload(!showPdfUpload)}
            className={`px-3 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors text-sm border ${
              showPdfUpload
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50'
            }`}
          >
            <FileUp size={16} />
            Upload Results PDF
          </button>

          {/* Save current category */}
          <button
            onClick={handleSaveResults}
            disabled={isSaving}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors text-sm disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            Save Results
          </button>

          {/* Per-category pick lock/reopen */}
          {selectedCategory && categoryStatuses?.[selectedCategory] === 'open' && onCategoryLock && (
            <button
              onClick={() => onCategoryLock(tournament!.id, selectedCategory)}
              className="bg-amber-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-amber-600 transition-colors text-sm"
            >
              <Lock size={16} />
              Lock Picks
            </button>
          )}
          {selectedCategory && categoryStatuses?.[selectedCategory] === 'locked' && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg border border-amber-200 text-sm font-bold">
                <Lock size={14} />
                Picks Locked
              </div>
              {onCategoryReopen && (
                <button
                  onClick={() => onCategoryReopen(tournament!.id, selectedCategory)}
                  className="text-amber-600 border border-amber-300 bg-white px-3 py-2 rounded-lg font-bold text-sm hover:bg-amber-50 transition-colors"
                >
                  Reopen
                </button>
              )}
            </div>
          )}

          {/* Close current category — scores & finalizes this category */}
          {selectedCategory && categoryStatuses?.[selectedCategory] === 'locked' && (
            <button
              onClick={() => handleCloseCategory(selectedCategory)}
              disabled={isClosingCategory}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors text-sm disabled:opacity-50"
            >
              {isClosingCategory ? <Loader2 className="animate-spin" size={16} /> : <Calculator size={16} />}
              Score & Close
            </button>
          )}
          {selectedCategory && categoryStatuses?.[selectedCategory] === 'closed' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 text-sm font-bold">
              <Lock size={14} />
              {selectedCategory} closed
            </div>
          )}

          {/* Delete current category */}
          {selectedCategory && categoryStatuses?.[selectedCategory] !== 'closed' && onCategoryDelete && (
            <button
              onClick={() => onCategoryDelete(tournament!.id, selectedCategory)}
              className="bg-red-50 text-red-600 border border-red-200 px-3 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-100 transition-colors text-sm"
            >
              <Trash2 size={15} />
              Delete
            </button>
          )}

          {/* Medal table picks lock/reopen */}
          {medalTableStatus === 'open' && onMedalTableLock && (
            <button
              onClick={() => onMedalTableLock(tournament!.id)}
              className="bg-purple-600 text-white px-3 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 transition-colors text-sm"
            >
              <Lock size={15} />
              Lock Medal Table
            </button>
          )}
          {medalTableStatus === 'locked' && (
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg border border-purple-200 text-sm font-bold">
                <Lock size={14} />
                Medal Table Locked
              </div>
              {onMedalTableReopen && (
                <button
                  onClick={() => onMedalTableReopen(tournament!.id)}
                  className="text-purple-600 border border-purple-300 bg-white px-3 py-2 rounded-lg font-bold text-sm hover:bg-purple-50 transition-colors"
                >
                  Reopen
                </button>
              )}
            </div>
          )}

          {/* Finalize & Close All — scores all remaining open categories + closes tournament */}
          <button
            onClick={handleFinalizeTournament}
            disabled={isClosing}
            className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-slate-900 transition-colors text-sm disabled:opacity-50"
          >
            {isClosing ? <Loader2 className="animate-spin" size={16} /> : <Lock size={16} />}
            Finalize & Close All
          </button>
        </div>
      </header>

      {/* Status message */}
      {message && (
        <div className={`mx-4 mt-3 p-3 rounded-lg flex items-start gap-2 text-sm font-medium ${
          message.type === 'success'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : message.type === 'info'
            ? 'bg-blue-50 text-blue-700 border border-blue-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.type === 'success' ? <CheckCircle size={16} className="flex-shrink-0 mt-0.5" /> :
           message.type === 'info' ? <Loader2 size={16} className="animate-spin flex-shrink-0 mt-0.5" /> :
           <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
          <span className="flex-1 whitespace-pre-line">{message.text}</span>
          <button onClick={() => setMessage(null)} className="flex-shrink-0"><X size={14} /></button>
        </div>
      )}

      {/* PDF Upload Panel */}
      {showPdfUpload && (
        <div className="mx-4 mt-3 p-4 bg-white rounded-xl border border-purple-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <FileUp size={16} className="text-purple-600" />
              Extract results from JudoTV / IJF Results PDF
            </h3>
            <button onClick={() => { setShowPdfUpload(false); setPdfFile(null); }} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Upload the official results PDF. Gemini will automatically extract results for{' '}
            <strong>all {categories.length} categories</strong> in one go, saving each to the database.
            Review and correct any errors after.
          </p>
          <div className="flex items-center gap-3">
            <label className="flex-1 relative border-2 border-dashed border-purple-200 bg-purple-50 rounded-lg p-3 text-center cursor-pointer hover:bg-purple-100 transition-colors">
              <input
                type="file"
                accept=".pdf"
                onChange={e => setPdfFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {pdfFile ? (
                <span className="text-emerald-600 font-bold text-sm flex items-center justify-center gap-2">
                  <CheckCircle size={16} /> {pdfFile.name}
                </span>
              ) : (
                <span className="text-purple-600 text-sm font-medium">Click or drag your PDF here</span>
              )}
            </label>
            <button
              onClick={handleExtractFromPDF}
              disabled={!pdfFile || isExtractingPdf}
              className="bg-purple-600 text-white px-4 py-3 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isExtractingPdf
                ? <><Loader2 className="animate-spin" size={16} /> Processing all categories...</>
                : <><Upload size={16} /> Extract &amp; Save All</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Workflow guide */}
      <div className="mx-4 mt-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 flex items-center gap-6 flex-wrap">
        <span className="font-black uppercase tracking-wider text-blue-400">Workflow</span>
        <span><span className="font-bold">1</span> — Upload Results PDF <span className="text-blue-400">(saves all categories)</span></span>
        <span className="text-blue-300">›</span>
        <span><span className="font-bold">2</span> — Review &amp; correct per category</span>
        <span className="text-blue-300">›</span>
        <span><span className="font-bold">3</span> — Click <span className="font-bold">Finalize &amp; Close</span> <span className="text-blue-400">(calculates scores + closes)</span></span>
      </div>

      {/* Bracket view */}
      <main className="flex-1 overflow-auto p-12">
        {matches.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Trophy size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-bold text-lg">No bracket found for this tournament</p>
            <p className="text-sm mt-2">Build the bracket first from the Draw PDF.</p>
          </div>
        ) : (() => {
          const mainMatchesR = matches.filter(m => m.roundType !== 'repechage' && m.roundType !== 'bronze');
          const repMatchesR = matches.filter(m => m.roundType === 'repechage');
          const bronzeMatchesR = matches.filter(m => m.roundType === 'bronze');
          const hasRepSectionR = repMatchesR.length > 0 || bronzeMatchesR.length > 0;

          const standingsList = sortStandingsForDisplay(deriveStandings(matches, results));
          const finalMForStandings = matches.find(m => m.round === 'F');
          const bronzeForStandings = matches.filter(m => m.round === 'B');
          const showFinalStandingsPanel =
            !!(finalMForStandings && results[finalMForStandings.id]) &&
            (bronzeForStandings.length === 0 || bronzeForStandings.every(m => results[m.id])) &&
            standingsList.some(s => s.position === 1) &&
            standingsList.some(s => s.position === 2);

          const tournamentCompleted = (tournament?.status || '').toUpperCase() === 'COMPLETED';

          return (
          <div className="flex flex-col min-w-max h-full">
            {/* Round headers */}
            <div className="flex mb-8">
              {sortedUniqueRounds(mainMatchesR)
                .map((round, index) => (
                  <div key={round} className={`${index === 0 ? 'w-[19rem]' : 'w-[21rem]'} flex-shrink-0 flex justify-center`}>
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                      {round === 'F' ? 'Final'
                        : round === 'SF' ? 'Semi Finals'
                        : round === 'QF' ? 'Quarter Finals'
                        : `Round ${index + 1}`}
                    </span>
                  </div>
                ))}
              <div className="w-64 flex-shrink-0 flex justify-center ml-4">
                <span className="text-xs font-black text-gold uppercase tracking-widest">Champion</span>
              </div>
            </div>

            {/* Bracket tree */}
            <div className="flex items-center flex-1">
              {finalMatch && (
                <ResultsBracketNode
                  match={finalMatch}
                  matches={mainMatchesR}
                  results={results}
                  onSelectWinner={handleSelectWinner}
                />
              )}

              {/* Champion display */}
              <div className="flex items-center h-full">
                <div className="w-8 border-t border-slate-300"></div>
                <div className={`w-64 h-48 rounded-xl border-2 flex flex-col items-center justify-center gap-4 ml-4 ${
                  champion ? 'border-gold bg-white shadow-xl' : 'border-dashed border-slate-300 bg-slate-50'
                }`}>
                  <Trophy size={48} className={champion ? 'text-gold' : 'text-slate-200'} />
                  {champion ? (
                    <div className="text-center px-4">
                      <p className="font-black uppercase text-lg text-slate-800 leading-tight">{champion.name}</p>
                      <div className="flex items-center justify-center gap-1 mt-1">
                        <Flag countryCode={champion.country} className="w-5 h-3.5" />
                        <span className="text-sm font-bold text-slate-500">{champion.country}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-slate-400 text-center px-4">
                      Enter results to reveal champion
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── REPECHAGE & BRONZE SECTION ────────────────────────────── */}
            {hasRepSectionR && (
              <div className="mt-14 pt-10 border-t-2 border-dashed border-slate-300">

                {repMatchesR.length > 0 && (
                  <div className="mb-10">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 text-center">
                      Repechage
                    </p>
                    <div className="flex gap-12 justify-center">
                      {repMatchesR.map((m, i) => (
                        <div key={m.id} className="flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {repMatchesR.length > 1 ? `Pool ${i === 0 ? 'A/B' : 'C/D'}` : 'Repechage'}
                          </span>
                          <ResultMatchCard
                            match={m}
                            results={results}
                            onSelectWinner={handleSelectWinner}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {bronzeMatchesR.length > 0 && (
                  <div>
                    <p className="text-xs font-black text-amber-600 uppercase tracking-widest mb-2 text-center">
                      🥉 Bronze Medal {bronzeMatchesR.length > 1 ? 'Matches' : 'Match'}
                    </p>
                    {bronzeMatchesR.length > 1 && (
                      <p className="text-[10px] text-slate-400 text-center mb-5">
                        Cross-over: SF_1 loser vs REP C/D winner · SF_2 loser vs REP A/B winner
                      </p>
                    )}
                    <div className="flex gap-12 justify-center">
                      {bronzeMatchesR.map((m, i) => (
                        <div key={m.id} className="flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                            {bronzeMatchesR.length > 1 ? `Bronze ${i + 1}` : 'Bronze'}
                          </span>
                          <ResultMatchCard
                            match={m}
                            results={results}
                            onSelectWinner={handleSelectWinner}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showFinalStandingsPanel && (
              <div className="mt-14 pt-10 border-t border-slate-200 w-full max-w-md mx-auto px-2">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 text-center">
                  Final standings
                </h3>
                <ul className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100 overflow-hidden">
                  {standingsList.map((row) => (
                    <li
                      key={`${row.position}-${row.competitorId}`}
                      className="flex items-center gap-3 px-4 py-3 text-sm"
                    >
                      <span className="text-lg w-8 flex-shrink-0" aria-hidden>
                        {medalEmoji(row.position) || <span className="text-slate-300 text-xs">·</span>}
                      </span>
                      <span className="font-bold text-slate-500 w-10 flex-shrink-0 tabular-nums">
                        {ordinalPosition(row.position)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-900 truncate">{row.competitorName || row.competitorId}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Flag countryCode={row.country || 'N/A'} className="w-5 h-3.5 flex-shrink-0" />
                          <span className="text-xs font-bold text-slate-500">{row.country || '—'}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                {tournamentCompleted && (
                <details
                  className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3"
                  onToggle={(e) => {
                    const el = e.currentTarget;
                    if (el.open && !countryMedalsLoadedRef.current) {
                      countryMedalsLoadedRef.current = true;
                      void loadAllCategoryCountryMedals();
                    }
                  }}
                >
                  <summary className="cursor-pointer text-sm font-black text-primary list-none flex items-center gap-2">
                    <span>Country medal summary (all categories)</span>
                  </summary>
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    {countryMedalLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="animate-spin text-primary" size={28} />
                      </div>
                    ) : countryMedalRows && countryMedalRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200">
                              <th className="pb-2 pr-2">Country</th>
                              <th className="pb-2 pr-2 text-center">G</th>
                              <th className="pb-2 pr-2 text-center">S</th>
                              <th className="pb-2 pr-2 text-center">B</th>
                              <th className="pb-2 text-center">Tot</th>
                            </tr>
                          </thead>
                          <tbody>
                            {countryMedalRows.map((r) => (
                              <tr key={r.country} className="border-b border-slate-100 last:border-0">
                                <td className="py-1.5 pr-2 font-bold text-slate-800 flex items-center gap-2">
                                  <Flag countryCode={r.country} className="w-6 h-4 flex-shrink-0" />
                                  {r.country}
                                </td>
                                <td className="py-1.5 text-center tabular-nums">{r.g}</td>
                                <td className="py-1.5 text-center tabular-nums">{r.s}</td>
                                <td className="py-1.5 text-center tabular-nums">{r.b}</td>
                                <td className="py-1.5 text-center font-black tabular-nums text-primary">{r.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 py-2">
                        Saved results across categories will populate this table.
                      </p>
                    )}
                  </div>
                </details>
                )}
              </div>
            )}
          </div>
          );
        })()}
      </main>
    </div>
  );
};

export default TournamentResults;
