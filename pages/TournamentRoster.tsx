
import React, { useState, useMemo, useEffect } from 'react';
import { ViewState, Tournament, Competitor, UserRole } from '../types';
import { ArrowLeft, Search, Filter, Star, Info, Trophy, Loader2 } from 'lucide-react';
import Flag from '../components/ui/Flag';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';

interface TournamentRosterProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  userRole?: UserRole;
  onBuildBracket?: () => void;
}

const TournamentRoster: React.FC<TournamentRosterProps> = ({ onNavigate, tournament, userRole, onBuildBracket }) => {
  const [roster, setRoster] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSex, setSelectedSex] = useState<'ALL' | 'M' | 'F'>('ALL');
  const [selectedWeight, setSelectedWeight] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // --- CARGA DE DATOS DESDE SUPABASE ---
  useEffect(() => {
    const fetchParticipants = async () => {
      if (!tournament?.id) return;
      
      try {
        setLoading(true);
        // Usamos parseInt para evitar errores de tipo UUID/BigInt
        const tournamentIdInt = parseInt(String(tournament.id), 10);

        // 1. Try Official Participants (Linked via tournament_participants)
        const { data: officialData, error: officialError } = await supabase
          .from('tournament_participants')
          .select(`
            ranking_external,
            judokas (
              id,
              full_name,
              country_code,
              gender
            ),
            categories (
              name
            )
          `)
          .eq('tournament_id', tournamentIdInt);

        if (officialError) {
           console.error("Error cargando participantes oficiales:", officialError);
        }

        if (officialData && officialData.length > 0) {
          // DATA TRANSFORMATION (flattening)
          const formattedRoster: Competitor[] = officialData.map((p: any) => {
            const judoka = p.judokas;
            // Si el join falla o es null, lo saltamos
            if (!judoka) return null;

            return {
                id: String(judoka.id),
                name: judoka.full_name,
                country: judoka.country_code || 'N/A',
                rank: p.ranking_external || 'UR',
                sex: judoka.gender === 'Male' ? 'M' : 'F',
                // Get the real weight from the categories relation
                weight: p.categories ? p.categories.name : 'N/A', 
                flagUrl: ''
            };
          }).filter((c: any) => c !== null) as Competitor[];
          
          setRoster(formattedRoster);
          return; // Exit if official data found
        }

        // 2. Fallback to Draft Roster (tournament_roster table)
        // This handles cases where the Admin uploaded the roster but didn't publish to official brackets yet.
        const { data: draftData, error: draftError } = await supabase
            .from('tournament_roster')
            .select('*')
            .eq('tournament_id', tournamentIdInt);

        if (draftError) {
            console.error("Error cargando roster borrador:", draftError);
        }

        if (draftData && draftData.length > 0) {
             const formattedRoster: Competitor[] = draftData.map((item: any) => ({
                id: String(item.id),
                name: `${item.first_name} ${item.last_name}`,
                country: item.country,
                sex: item.gender === 'Female' ? 'F' : 'M',
                rank: item.world_rank,
                weight: item.weight_category,
                flagUrl: ''
             }));
             setRoster(formattedRoster);
        } else {
            // No data found in either table
            setRoster([]);
        }

      } catch (err) {
        console.error("Error fetching participants:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchParticipants();
  }, [tournament]);

  if (!tournament) return null;

  // --- FILTER LOGIC ---
  const availableWeights = useMemo(() => {
    const weights = new Set<string>();
    roster.forEach(c => {
      if (selectedSex === 'ALL' || c.sex === selectedSex) {
        weights.add(c.weight || '');
      }
    });
    return Array.from(weights).sort((a, b) => {
        const parseWeight = (w: string | undefined) => {
            if (!w) return 0;
            const num = parseInt(w.replace(/[^0-9]/g, ''));
            if (isNaN(num)) return -1;
            if (w.includes('+')) return num + 0.5;
            return num;
        };
        return parseWeight(b) - parseWeight(a); // Descending
    });
  }, [selectedSex, roster]);

  const filteredRoster = useMemo(() => {
    return roster.filter(c => {
      const matchSex = selectedSex === 'ALL' || c.sex === selectedSex;
      const matchWeight = selectedWeight === 'ALL' || c.weight === selectedWeight;
      const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.country.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchSex && matchWeight && matchSearch;
    });
  }, [roster, selectedSex, selectedWeight, searchQuery]);

  // Atletas destacados (Top 3 por Ranking)
  const athletesToWatch = useMemo(() => {
    return [...roster]
      .filter(a => {
        // Handle rank being string or number
        const r = typeof a.rank === 'string' ? parseInt(a.rank) : a.rank;
        return !isNaN(r) && r > 0;
      })
      .sort((a, b) => {
        const rA = typeof a.rank === 'string' ? parseInt(a.rank) : a.rank;
        const rB = typeof b.rank === 'string' ? parseInt(b.rank) : b.rank;
        if (isNaN(rA)) return 1;
        if (isNaN(rB)) return -1;
        return rA - rB;
      })
      .slice(0, 3);
  }, [roster]);

  const getRankBadge = (rank: number | string) => {
    const r = typeof rank === 'string' ? parseInt(rank) : rank;
    if (r === 1) return <div className="size-6 bg-yellow-400 text-yellow-900 rounded-full flex items-center justify-center font-black text-xs shadow-sm">1</div>;
    if (r === 2) return <div className="size-6 bg-slate-300 text-slate-800 rounded-full flex items-center justify-center font-black text-xs shadow-sm">2</div>;
    if (r === 3) return <div className="size-6 bg-amber-600 text-amber-100 rounded-full flex items-center justify-center font-black text-xs shadow-sm">3</div>;
    return <div className="size-6 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center font-bold text-xs">{!isNaN(r) && r > 0 ? `#${r}` : '-'}</div>;
  }

  // Helper for status color (unified styling)
  const getStatusStyle = (status: string) => {
      switch(status) {
          case 'LIVE': return 'bg-red-50 text-red-600 animate-pulse';
          case 'SORTING': return 'bg-blue-50 text-blue-600';
          case 'DRAFT': return 'bg-slate-200 text-slate-600 border border-slate-300 border-dashed';
          default: return 'bg-slate-100 text-slate-600';
      }
  };

  const isDraft = tournament.status === 'DRAFT' || tournament.status === 'UPCOMING';

  // Formateo de fecha Seguro (Manual Parse)
  const formatSafeDate = (dateString: string | undefined) => {
      if (!dateString) return '';
      // Safe Date Parsing (YYYY-MM-DD)
      const parts = dateString.split('T')[0].split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString();
  };
  
  const formattedDate = formatSafeDate(tournament.date);

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white px-6 py-4 shadow-sm border-b border-slate-200 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => onNavigate('TOURNAMENTS')}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusStyle(tournament.status)}`}>
                    {isDraft ? 'Coming Soon' : tournament.status}
                </span>
                <span className="text-slate-400 text-xs font-medium">{formattedDate}</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">{tournament.name}</h1>
            </div>
          </div>
          
          {userRole === 'ADMIN' && onBuildBracket && (
              <div className="mt-4 md:mt-0">
                  <Button 
                      onClick={onBuildBracket} 
                      className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg px-6 py-2"
                  >
                      Build Brackets (Upload PDF)
                  </Button>
              </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {isDraft && (
             <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg shadow-sm animate-fade-in-up">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <Info size={20} className="text-blue-500" />
                    </div>
                    <div className="ml-3">
                        <p className="text-sm font-medium text-blue-700">
                            Competition brackets will be published soon. Check the registered athletes list below.
                        </p>
                    </div>
                </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Loader2 className="animate-spin mb-2" size={32} />
              <p>Loading roster...</p>
            </div>
          ) : (
            <>
              {/* Top Contenders */}
              {athletesToWatch.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex items-center gap-2">
                    <Star size={18} className="text-amber-500 fill-amber-500" />
                    <h2 className="text-lg font-bold text-slate-900">Top Contenders</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {athletesToWatch.map((athlete, idx) => (
                      <div key={athlete.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center gap-2">
                        <div className="flex items-center gap-1 mb-1">
                          <Trophy size={14} className="text-yellow-500" />
                          <span className="text-[10px] font-bold text-yellow-600 uppercase">World Class</span>
                        </div>
                        <p className="font-bold text-slate-900 text-lg line-clamp-1">{athlete.name}</p>
                        <div className="flex items-center gap-2">
                          <Flag countryCode={athlete.country} />
                          <span className="text-xs text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-full">{athlete.weight}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Roster Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
                {/* Controls */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <h2 className="font-bold text-slate-900 flex items-center gap-2">
                      <Info size={18} className="text-blue-600" />
                      Official Roster
                    </h2>
                    <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold">
                      {filteredRoster.length} Athletes
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3 items-center">
                    {/* Sex Filter */}
                    <div className="flex bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
                      <button 
                        onClick={() => { setSelectedSex('ALL'); setSelectedWeight('ALL'); }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md ${selectedSex === 'ALL' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                      >All</button>
                      <button 
                        onClick={() => { setSelectedSex('M'); setSelectedWeight('ALL'); }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md ${selectedSex === 'M' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                      >Men</button>
                      <button 
                        onClick={() => { setSelectedSex('F'); setSelectedWeight('ALL'); }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md ${selectedSex === 'F' ? 'bg-pink-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                      >Women</button>
                    </div>

                    {/* Weight Filter */}
                    <select
                      value={selectedWeight}
                      onChange={(e) => setSelectedWeight(e.target.value)}
                      className="pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                    >
                      <option value="ALL">All Weights</option>
                      {availableWeights.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>

                    {/* Search */}
                    <div className="relative flex-1 min-w-[160px]">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search judoka..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-white border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <div className="col-span-2 sm:col-span-1">Rank</div>
                  <div className="col-span-6 sm:col-span-5">Athlete</div>
                  <div className="col-span-4 sm:col-span-3">Country</div>
                  <div className="hidden sm:block col-span-3 text-right">Category</div>
                </div>

                {/* Table Body */}
                <div className="divide-y divide-slate-50 flex-1">
                  {filteredRoster.map((competitor) => (
                    <div key={competitor.id} className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-slate-50 transition-colors group">
                      <div className="col-span-2 sm:col-span-1">
                        {getRankBadge(competitor.rank)}
                      </div>
                      <div className="col-span-6 sm:col-span-5">
                        <p className="font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">{competitor.name}</p>
                      </div>
                      <div className="col-span-4 sm:col-span-3 flex items-center gap-2">
                        <Flag countryCode={competitor.country} />
                        <span className="text-xs font-medium text-slate-600 hidden sm:block">{competitor.country}</span>
                      </div>
                      <div className="hidden sm:block col-span-3 text-right">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
                          competitor.sex === 'M' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-pink-50 text-pink-600 border-pink-100'
                        }`}>
                          {competitor.weight}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TournamentRoster;
