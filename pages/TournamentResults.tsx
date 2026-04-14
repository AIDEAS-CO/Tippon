import React, { useState, useEffect } from 'react';
import { ViewState, Tournament, Match, Competitor, UserPicks } from '../types';
import { supabase } from '../lib/supabaseClient';
import { calculateAllCategoryScores } from '../lib/scoringEngine';
import Flag from '../components/ui/Flag';
import {
  ArrowLeft, ChevronDown, Loader2, Trophy, CheckCircle, Calculator,
  Lock, AlertCircle, Check
} from 'lucide-react';

interface TournamentResultsProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  onTournamentUpdated?: () => void;
}

const getBracketSize = (participants: number) => {
  const sizes = [2, 4, 8, 16, 32, 64, 128];
  return sizes.find(s => s >= participants) || 128;
};

const getRoundOrder = (round: string) => {
  if (round === 'F') return 100;
  if (round === 'SF') return 90;
  if (round === 'QF') return 80;
  if (round.startsWith('R')) return parseInt(round.substring(1));
  return 0;
};

const TournamentResults: React.FC<TournamentResultsProps> = ({
  onNavigate,
  tournament,
  onTournamentUpdated,
}) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      if (!dbMatches || dbMatches.length === 0) {
        setIsLoading(false);
        return;
      }

      const bracketCategories = Array.from(
        new Set(dbMatches.map((m: any) => m.weight_category).filter(Boolean))
      ) as string[];

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
            rank: 'UR',
            weight: athlete.weight_category,
          };
        });
      }

      const categoryMatches = dbMatches.filter(
        (m: any) => m.weight_category === selectedCategory
      );

      let freshMatches: Match[] = [];

      if (categoryMatches.length > 0) {
        const numR1FromDb = categoryMatches.length;
        const size = getBracketSize(numR1FromDb * 2);
        const fullR1Count = size / 2;

        const resolveCompetitor = (m: any, slot: 'competitor1' | 'competitor2', idField: string) => {
          if (m && m[idField] && rosterMap[m[idField]]) return rosterMap[m[idField]];
          const bd = m?.bracket_data;
          if (bd && bd[slot] && bd[slot].name) {
            return {
              id: `pdf-${m.id}-${slot}`,
              name: bd[slot].name,
              country: bd[slot].country || 'N/A',
              flagUrl: '',
              rank: 'UR',
            };
          }
          return null;
        };

        for (let i = 0; i < numR1FromDb; i++) {
          const m = categoryMatches[i];
          const c1 = resolveCompetitor(m, 'competitor1', 'competitor_1');
          const c2 = resolveCompetitor(m, 'competitor2', 'competitor_2');
          freshMatches.push({
            id: m.id || `r1-m${i}`,
            round: 'R1',
            matchNumber: m.match_number || i + 1,
            competitor1: c1,
            competitor2: c2,
            winnerId: null,
            nextMatchId: size > 2 ? `r2-m${Math.floor(i / 2)}` : undefined,
            nextMatchSlot: i % 2 === 0 ? 1 : 2,
          });
        }

        let currentRoundMatches = fullR1Count / 2;
        let roundLevel = 2;
        let matchCounter = fullR1Count + 1;
        while (currentRoundMatches >= 1) {
          for (let i = 0; i < currentRoundMatches; i++) {
            const isFinal = currentRoundMatches === 1;
            freshMatches.push({
              id: `r${roundLevel}-m${i}`,
              round: isFinal ? 'F' : `R${roundLevel}`,
              matchNumber: matchCounter++,
              competitor1: null,
              competitor2: null,
              winnerId: null,
              nextMatchId: isFinal ? undefined : `r${roundLevel + 1}-m${Math.floor(i / 2)}`,
              nextMatchSlot: i % 2 === 0 ? 1 : 2,
            });
          }
          currentRoundMatches /= 2;
          roundLevel++;
        }
      }

      // Load existing results from DB
      const { data: existingResults } = await supabase
        .from('match_results')
        .select('match_id, winner_competitor_id')
        .eq('tournament_id', tournament.id)
        .eq('category', selectedCategory);

      const savedResults: Record<string, string> = {};
      if (existingResults) {
        existingResults.forEach((r) => {
          savedResults[r.match_id] = r.winner_competitor_id;
        });
      }

      // BYE auto-advance
      freshMatches.forEach((m) => {
        if (m.round !== 'R1') return;
        const hasC1 = m.competitor1 !== null;
        const hasC2 = m.competitor2 !== null;
        if (hasC1 && !hasC2) savedResults[m.id] = m.competitor1!.id;
        if (!hasC1 && hasC2) savedResults[m.id] = m.competitor2!.id;
      });

      // Propagate winners through rounds
      const sortedRounds = Array.from(new Set(freshMatches.map((m) => m.round))).sort(
        (a, b) => getRoundOrder(a) - getRoundOrder(b)
      );

      sortedRounds.forEach((r) => {
        freshMatches.filter((m) => m.round === r).forEach((match) => {
          const winnerId = savedResults[match.id];
          if (!winnerId) return;
          const winner =
            match.competitor1?.id === winnerId
              ? match.competitor1
              : match.competitor2?.id === winnerId
              ? match.competitor2
              : null;
          if (winner && match.nextMatchId) {
            const target = freshMatches.find((tm) => tm.id === match.nextMatchId);
            if (target) {
              if (match.nextMatchSlot === 1) target.competitor1 = winner;
              else target.competitor2 = winner;
            }
          }
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

  const handleSelectWinner = (matchId: string, competitorId: string) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    const newResults = { ...results, [matchId]: competitorId };
    setResults(newResults);

    if (match.nextMatchId) {
      setMatches((prev) => {
        const cloned = prev.map((m) => ({ ...m }));
        const winner =
          match.competitor1?.id === competitorId ? match.competitor1 : match.competitor2;
        const target = cloned.find((m) => m.id === match.nextMatchId);
        if (target && winner) {
          if (match.nextMatchSlot === 1) target.competitor1 = winner;
          else target.competitor2 = winner;
        }
        return cloned;
      });
    }
  };

  const handleSaveResults = async () => {
    if (!tournament?.id) return;
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const rows = Object.entries(results).map(([matchId, winnerId]) => {
        const match = matches.find((m) => m.id === matchId);
        const winner = match?.competitor1?.id === winnerId
          ? match?.competitor1
          : match?.competitor2;

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
      setSaveMessage({ type: 'success', text: 'Resultados guardados correctamente' });
    } catch (err: any) {
      console.error('Error saving results:', err);
      setSaveMessage({ type: 'error', text: err?.message || 'Error al guardar' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCalculateScores = async () => {
    if (!tournament?.id) return;
    setIsCalculating(true);
    setSaveMessage(null);

    try {
      const result = await calculateAllCategoryScores(tournament.id, categories);
      if (result.success) {
        setSaveMessage({
          type: 'success',
          text: `Puntos calculados para ${result.totalUsersScored} usuario(s)`,
        });
      } else {
        setSaveMessage({
          type: 'error',
          text: `Errores: ${result.errors.join(', ')}`,
        });
      }
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err?.message || 'Error calculando puntos' });
    } finally {
      setIsCalculating(false);
    }
  };

  const handleCloseTournament = async () => {
    if (!tournament?.id) return;
    if (!confirm('¿Cerrar el torneo? Esto marcará el torneo como COMPLETED.')) return;

    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', tournament.id);

      if (error) throw error;
      setSaveMessage({ type: 'success', text: 'Torneo cerrado exitosamente' });
      onTournamentUpdated?.();
      setTimeout(() => onNavigate('TOURNAMENTS'), 1500);
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err?.message || 'Error cerrando torneo' });
    }
  };

  const roundsToRender = Array.from(new Set(matches.map((m) => m.round))).sort(
    (a, b) => getRoundOrder(a) - getRoundOrder(b)
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  const renderCompetitor = (match: Match, competitor: Competitor | null, isTop: boolean) => {
    if (!competitor) {
      return (
        <div className={`flex items-center p-3 h-12 ${isTop ? 'border-b border-slate-200' : ''}`}>
          <span className="text-sm italic text-slate-300">---</span>
        </div>
      );
    }

    const isSelected = results[match.id] === competitor.id;
    const hasBothCompetitors = match.competitor1 !== null && match.competitor2 !== null;

    return (
      <div
        onClick={() => hasBothCompetitors && handleSelectWinner(match.id, competitor.id)}
        className={`flex items-center justify-between p-3 h-12 transition-colors ${
          isTop ? 'border-b border-slate-200' : ''
        } ${
          hasBothCompetitors ? 'cursor-pointer' : 'cursor-default'
        } ${
          isSelected
            ? 'bg-emerald-50 border-l-4 border-l-emerald-500'
            : 'bg-white border-l-4 border-l-transparent hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 w-5 font-medium">({competitor.rank || '-'})</span>
          <Flag countryCode={competitor.country} className="w-5 h-3.5 shadow-sm" />
          <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
            {competitor.name}
          </span>
          <span className="text-xs text-slate-500 font-bold">{competitor.country}</span>
        </div>
        {isSelected && <CheckCircle size={16} className="text-emerald-500" />}
      </div>
    );
  };

  const renderMatchCard = (match: Match) => (
    <div className="flex flex-col w-72 bg-white border border-slate-300 rounded-lg shadow-sm overflow-hidden z-10 relative">
      <div className="flex justify-between items-center px-3 py-1.5 bg-emerald-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider">
        <span className="text-emerald-600">Match {match.matchNumber}</span>
        <span className="text-slate-400">{match.round}</span>
      </div>
      {renderCompetitor(match, match.competitor1, true)}
      {renderCompetitor(match, match.competitor2, false)}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      <header className="bg-white p-4 border-b flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => onNavigate('BRACKET')}
            className="p-2 hover:bg-slate-100 rounded-full"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg">{tournament?.name}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-700">
                Ingreso de Resultados
              </span>
            </div>
            <div className="relative">
              <button
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="text-emerald-600 text-sm font-bold flex items-center gap-1"
              >
                {selectedCategory || 'Seleccionar categoría'} <ChevronDown size={14} />
              </button>
              {isCategoryDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-slate-200 z-50 max-h-72 overflow-y-auto">
                  <ul className="py-1">
                    {categories.map((cat) => (
                      <li key={cat}>
                        <button
                          onClick={() => {
                            setSelectedCategory(cat);
                            setIsCategoryDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                            selectedCategory === cat
                              ? 'font-bold text-emerald-600 bg-emerald-50'
                              : 'text-slate-700'
                          }`}
                        >
                          {cat}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveResults}
            disabled={isSaving}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors text-sm disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            Guardar Resultados
          </button>
          <button
            onClick={handleCalculateScores}
            disabled={isCalculating}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
          >
            {isCalculating ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Calculator size={16} />
            )}
            Calcular Puntos
          </button>
          <button
            onClick={handleCloseTournament}
            className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-slate-900 transition-colors text-sm"
          >
            <Lock size={16} />
            Cerrar Torneo
          </button>
        </div>
      </header>

      {saveMessage && (
        <div
          className={`mx-4 mt-3 p-3 rounded-lg flex items-center gap-2 text-sm font-medium ${
            saveMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {saveMessage.type === 'success' ? (
            <CheckCircle size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          {saveMessage.text}
        </div>
      )}

      <main className="flex-1 overflow-auto p-8">
        <div className="space-y-8">
          {roundsToRender.map((round) => {
            const roundMatches = matches
              .filter((m) => m.round === round)
              .sort((a, b) => a.matchNumber - b.matchNumber);

            return (
              <div key={round}>
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                  {round === 'F'
                    ? 'Final'
                    : round === 'SF'
                    ? 'Semi Finals'
                    : round === 'QF'
                    ? 'Quarter Finals'
                    : `Round ${round.replace('R', '')}`}
                </h2>
                <div className="flex flex-wrap gap-4">
                  {roundMatches.map((match) => (
                    <div key={match.id}>{renderMatchCard(match)}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {matches.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            <Trophy size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-bold">No hay brackets para este torneo</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default TournamentResults;
