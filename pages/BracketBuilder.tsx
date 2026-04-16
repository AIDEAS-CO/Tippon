
import React, { useState, useEffect, useRef } from 'react';
import { ViewState, Tournament, Competitor } from '../types';
import { ChevronRight, GripVertical, Save, Trash2, Search, ArrowLeft, Upload, Loader2, Check, FileText, CheckCircle, AlertTriangle, Lock, UserPlus, RefreshCw, X, Plus, ChevronDown, MapPin, Hash, AlertOctagon } from 'lucide-react';
import Flag from '../components/ui/Flag';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';
import Button from '../components/ui/Button';
import { showToast } from '../lib/toast';

// Common Judo Nations for Autocomplete
const JUDO_COUNTRIES = [
    "Japan", "France", "Georgia", "Brazil", "Uzbekistan", "Italy", "Korea", 
    "Azerbaijan", "Canada", "Mongolia", "Netherlands", "Germany", "Spain", 
    "Cuba", "Kazakhstan", "Israel", "Tajikistan", "Belgium", "Austria", 
    "Turkey", "USA", "Great Britain", "Portugal", "Ukraine", "Hungary", 
    "Serbia", "Croatia", "Slovenia", "Moldova", "Switzerland"
];

interface BracketBuilderProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  onSave: (finalTournament: Tournament) => void;
}

const BracketBuilder: React.FC<BracketBuilderProps> = ({ onNavigate, tournament, onSave }) => {
  // Global Roster State
  const [allCompetitors, setAllCompetitors] = useState<Competitor[]>(tournament?.roster || []);
  
  // Filtered Roster for current category
  const [filteredRoster, setFilteredRoster] = useState<Competitor[]>([]);
  
  // GLOBAL BRACKET STATE: Record<CategoryName, Record<SlotId, Competitor>>
  const [globalBrackets, setGlobalBrackets] = useState<Record<string, Record<string, Competitor | null>>>(tournament?.brackets || {});
  
  // Local bracket state (derived/synced with global)
  const [bracketState, setBracketState] = useState<Record<string, Competitor | null>>({});
  
  const [selectedCategory, setSelectedCategory] = useState(tournament?.categories?.male?.[0] ? `Men ${tournament.categories.male[0]}` : 'Men -60kg');

  // Upload State
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'refreshing'>('idle');
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Publish State
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [showDraftAlert, setShowDraftAlert] = useState(false);
  
  // Manual Add State
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [manualForm, setManualForm] = useState<{name: string, country: string, rank: string | number}>({ name: '', country: '', rank: '' });
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  
  // Ref for hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- HELPER: Parse Category ---
  const parseCategory = (catString: string): { sex: 'M' | 'F'; weight: string } => {
      const isMale = catString.startsWith('Men');
      const sex: 'M' | 'F' = isMale ? 'M' : 'F';
      // Remove "Men " or "Women " prefix and "kg" suffix
      let weightPart = catString.replace(isMale ? 'Men ' : 'Women ', '').replace('kg', '').trim();
      return { sex, weight: weightPart };
  };

  // --- VALIDATION LOGIC ---
  const validateTournamentCompletion = (): boolean => {
      if (allCompetitors.length === 0) return false;
      const totalAthleteCount = allCompetitors.length;
      const placedAthleteIds = new Set<string>();
      
      Object.values(globalBrackets).forEach((categoryBracket: any) => {
          Object.values(categoryBracket).forEach((competitor: any) => {
              if (competitor && competitor.id) {
                  placedAthleteIds.add(competitor.id);
              }
          });
      });

      return placedAthleteIds.size === totalAthleteCount;
  };

  const canPublish = validateTournamentCompletion();
  const unplacedCount = allCompetitors.length - (function() {
      const ids = new Set<string>();
      Object.values(globalBrackets).forEach((b: any) => Object.values(b).forEach((c: any) => c && ids.add(c.id)));
      return ids.size;
  })();

  // --- REAL EXCEL PARSING LOGIC ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadState('uploading');
      setUploadWarning(null); 
      setUploadError(null);

      const reader = new FileReader();
      
      reader.onload = (evt) => {
          try {
              const bstr = evt.target?.result;
              const wb = XLSX.read(bstr, { type: 'binary' });
              
              const wsname = wb.SheetNames[0];
              const ws = wb.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

              const importedCompetitors: Competitor[] = [];
              let ignoredCount = 0;
              let totalFoundRows = 0;
              const startIndex = 1;

              // Build a set of allowed category keys for O(1) lookup
              const allowedCategories = new Set<string>();
              tournament?.categories?.male?.forEach(w => allowedCategories.add(`M_${w}`));
              tournament?.categories?.female?.forEach(w => allowedCategories.add(`F_${w}`));

              for (let i = startIndex; i < data.length; i++) {
                  const row = data[i];
                  if (row[2] && row[0]) {
                      totalFoundRows++;
                      let rawWeight = String(row[1] || '').trim();
                      if (!rawWeight.toLowerCase().endsWith('kg')) {
                          rawWeight = rawWeight + 'kg';
                      }
                      
                      let rawSexString = String(row[0] || 'M').trim().toUpperCase().charAt(0);
                      const rawSex: 'M' | 'F' = (rawSexString === 'F') ? 'F' : 'M';
                      
                      const categoryKey = `${rawSex}_${rawWeight}`;
                      
                      if (allowedCategories.has(categoryKey)) {
                          importedCompetitors.push({
                              id: `imported-${Date.now()}-${i}`,
                              sex: rawSex,
                              weight: rawWeight.replace('kg', ''), 
                              name: String(row[2]).trim(),
                              country: String(row[3]).trim(),
                              rank: row[4] || 999,
                              flagUrl: ''
                          });
                      } else {
                          ignoredCount++;
                      }
                  }
              }

              // STRICT VALIDATION: If we found potential data rows, but 0 were valid
              if (totalFoundRows > 0 && importedCompetitors.length === 0) {
                   setUploadError(`Upload Failed: Found ${totalFoundRows} athletes, but NONE matched the selected tournament categories. Please check your Excel file or tournament settings.`);
                   setUploadState('idle');
                   return;
              }

              if (importedCompetitors.length > 0) {
                  setUploadState('refreshing');
                  
                  setTimeout(() => {
                      setAllCompetitors(prev => [...prev, ...importedCompetitors]);
                      
                      if (ignoredCount > 0) {
                          setUploadWarning(`${ignoredCount} athletes were ignored because their categories are not enabled for this tournament.`);
                      }

                      setTimeout(() => {
                           setUploadState('success');
                           setTimeout(() => {
                               setUploadState('idle');
                               setUploadWarning(null);
                           }, 8000);
                      }, 200); 
                  }, 1500); 
              } else {
                  setUploadError("No valid competitor data found in Excel rows.");
                  setUploadState('idle');
              }

          } catch (error) {
              console.error("Error parsing Excel:", error);
              setUploadError("Critical Error: Could not parse file. Ensure it is a valid .xlsx file.");
              setUploadState('idle');
          }
      };

      reader.readAsBinaryString(file);
  };

  const triggerFileUpload = () => {
      fileInputRef.current?.click();
  };

  // --- MANUAL ADD LOGIC ---
  const handleOpenManualAdd = () => {
      setManualForm({ name: '', country: '', rank: filteredRoster.length + 1 });
      setIsManualAddOpen(true);
      setShowCountryDropdown(false);
  };

  const handleCountrySelect = (countryName: string) => {
      setManualForm(prev => ({ ...prev, country: countryName }));
      setShowCountryDropdown(false);
  };

  const handleSaveManualCompetitor = (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualForm.name || !manualForm.country) return;

      const { sex, weight } = parseCategory(selectedCategory);

      const newCompetitor: Competitor = {
          id: `manual-${Date.now()}`,
          name: manualForm.name,
          country: manualForm.country,
          rank: manualForm.rank || 'UR',
          sex,
          weight,
          flagUrl: ''
      };

      setAllCompetitors(prev => [...prev, newCompetitor]);
      setIsManualAddOpen(false);
  };

  // --- REFRESH DATA LOGIC ---
  const handleRefreshData = () => {
      setUploadState('refreshing');
      setTimeout(() => {
          setUploadState('idle');
      }, 800);
  };

  // --- SUPABASE INTEGRATION LOGIC ---

  // Main Save Function with Debugging Logs
  const saveToSupabase = async (newStatus: 'draft' | 'sorting') => {
    if (!tournament?.id) {
        setUploadError("Error: Missing Tournament ID");
        return;
    }

    console.log("Iniciando guardado. Participantes a procesar:", allCompetitors.length);
    setUploadState('refreshing');
    setUploadError(null);

    try {
        // 0. GET CATEGORIES (to map IDs correctly)
        const { data: dbCategories, error: catError } = await supabase
            .from('categories')
            .select('*')
            .eq('tournament_id', tournament.id);

        if (catError) throw catError;

        // 1. Sincronizar Judokas (Asegurar que existan y obtener sus IDs)
        // Usamos un Map para asegurar unicidad antes del upsert
        const uniqueJudokasMap = new Map();
        
        allCompetitors.forEach(c => {
            const fullName = c.name.trim();
            if (!uniqueJudokasMap.has(fullName)) {
                uniqueJudokasMap.set(fullName, {
                    full_name: fullName,
                    country_code: (c.country || 'Unknown').trim(),
                    gender: c.sex === 'M' ? 'Male' : 'Female'
                });
            }
        });

        const judokasToSync = Array.from(uniqueJudokasMap.values());

        console.log("Syncing judokas table...", judokasToSync.length);
        const { data: syncedJudokas, error: jError } = await supabase
            .from('judokas')
            .upsert(judokasToSync, { onConflict: 'full_name,country_code,gender' })
            .select('id, full_name');

        if (jError) throw jError;
        console.log("Judokas synced successfully. Total returned:", syncedJudokas?.length);

        // 2. Limpiar participantes actuales del torneo
        console.log("Limpiando participantes previos del torneo:", tournament.id);
        const { error: delError } = await supabase.from('tournament_participants').delete().eq('tournament_id', tournament.id);
        
        if (delError) throw delError;

        // 3. Vincular Judokas al Torneo CON CATEGORY_ID CORRECTO
        if (allCompetitors.length > 0 && syncedJudokas) {
            const participantsData = allCompetitors.map(comp => {
                const foundJudoka = syncedJudokas.find(sj => sj.full_name === comp.name.trim());
                if (!foundJudoka) {
                    console.warn(`No ID found for judoka: ${comp.name}`);
                    return null;
                }

                // KEY LOGIC: Find the correct category
                const compGenderFull = comp.sex === 'M' ? 'Male' : 'Female';
                // Aseguramos que el peso tenga 'kg' si la DB lo usa (asumimos que la DB usa formato '-60kg')
                let compWeightNormalized = String(comp.weight || '').trim();
                if (!compWeightNormalized.toLowerCase().endsWith('kg')) {
                    compWeightNormalized += 'kg';
                }

                const matchedCategory = dbCategories?.find(cat => 
                    cat.gender === compGenderFull && 
                    cat.name.trim().toLowerCase() === compWeightNormalized.toLowerCase()
                );

                return {
                    tournament_id: tournament.id,
                    judoka_id: foundJudoka.id,
                    category_id: matchedCategory ? matchedCategory.id : null, // AQUI INSERTAMOS EL ID
                    ranking_external: String(comp.rank || 'UR')
                };
            }).filter(p => p !== null);

            console.log("Insertando en tournament_participants:", participantsData.length);
            if (participantsData.length > 0) {
                const { error: pError } = await supabase.from('tournament_participants').insert(participantsData);
                if (pError) throw pError;
            }
        }

        // 4. Update tournaments row with roster and status
        const dbStatus = newStatus.toLowerCase();
        console.log("Updating tournaments table with roster and status:", dbStatus);
        
        const { error: tError } = await supabase
            .from('tournaments')
            .update({ 
                status: dbStatus,
                roster: allCompetitors, // Guardamos el JSON como respaldo
                brackets: globalBrackets
            })
            .eq('id', tournament.id);

        if (tError) throw tError;

        console.log("Saved successfully!");
        
        if (dbStatus === 'draft') {
            showToast('success', 'Saved successfully! Draft and categories updated.');
        }

        // UI Feedback Logic
        if (dbStatus === 'sorting') {
            setShowPublishSuccess(true);
            setTimeout(() => {
                onSave({ 
                    ...tournament, 
                    roster: allCompetitors,
                    participantCount: allCompetitors.length,
                    brackets: globalBrackets,
                    status: 'SORTING'
                });
            }, 2000);
        } else {
            setShowDraftAlert(true);
            onSave({ 
              ...tournament, 
              roster: allCompetitors,
              participantCount: allCompetitors.length,
              brackets: globalBrackets,
              status: 'DRAFT'
            });
            setTimeout(() => setShowDraftAlert(false), 3000);
        }

    } catch (err: any) {
        console.error("CRITICAL SAVE ERROR:", err);
        showToast('error', "Critical save error: " + (err.message || JSON.stringify(err)));
        setUploadError("Error saving to database: " + err.message);
    } finally {
        setUploadState('idle');
    }
  };


  // --- EFFECT: Handle Category Switching & Filtering ---
  useEffect(() => {
    // 1. Restore the Bracket State for the selected category
    const savedStateForCategory: Record<string, Competitor | null> = globalBrackets[selectedCategory] || {};
    setBracketState(savedStateForCategory);

    // 2. Filter the Roster for the selected category
    if (allCompetitors.length > 0) {
        const { sex, weight } = parseCategory(selectedCategory);
        
        // Find IDs that are ALREADY in the bracket
        const placedCompetitorIds = new Set<string>();
        // Fix: Explicitly cast Object.values to handle potential 'unknown' type inference issue
        (Object.values(savedStateForCategory) as any[]).forEach((comp) => {
            if (comp && comp.id) placedCompetitorIds.add(comp.id);
        });

        // Filter: Match Category AND Not Placed
        const filtered = allCompetitors.filter((c: Competitor) => {
            const matchesCategory = c.sex === sex && c.weight === weight;
            const isNotPlaced = !placedCompetitorIds.has(c.id);
            return matchesCategory && isNotPlaced;
        });
        
        // Sort logic
        filtered.sort((a, b) => {
            const rankA = parseInt(String(a.rank));
            const rankB = parseInt(String(b.rank));
            
            const isANum = !isNaN(rankA);
            const isBNum = !isNaN(rankB);

            if (isANum && isBNum) return rankA - rankB;
            if (isANum && !isBNum) return -1;
            if (!isANum && isBNum) return 1;
            return 0;
        });

        setFilteredRoster(filtered);
    } else {
        setFilteredRoster([]);
    }
  }, [selectedCategory, allCompetitors, globalBrackets]); 


  // Dynamic Bracket Logic
  const participantCount = (filteredRoster.length + Object.values(bracketState).filter(c => c !== null).length); 
  const bracketSize = Math.max(8, Math.pow(2, Math.ceil(Math.log2(participantCount || 2))));
  const matchesInFirstRound = bracketSize / 2;
  
  const roundName = 
      bracketSize === 64 ? 'Round of 64' : 
      bracketSize === 32 ? 'Round of 32' : 
      bracketSize === 16 ? 'Round of 16' : 
      'Quarter Finals';

  // --- DRAG & DROP HANDLERS ---
  
  const handleDragStart = (e: React.DragEvent, competitor: Competitor) => {
    e.dataTransfer.setData('competitorId', competitor.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, slotId: string) => {
    e.preventDefault();
    const competitorId = e.dataTransfer.getData('competitorId');
    
    let competitor = filteredRoster.find(c => c.id === competitorId);
    
    if (!competitor) {
         const existingSlot = (Object.values(bracketState) as any[]).find(c => c?.id === competitorId);
         if (existingSlot) competitor = existingSlot;
    }

    if (competitor) {
      const newLocalState: Record<string, Competitor | null> = { ...bracketState };
      
      Object.keys(newLocalState).forEach(key => {
          const currentComp = newLocalState[key];
          if (currentComp?.id === competitor!.id) newLocalState[key] = null;
      });
      
      newLocalState[slotId] = competitor;
      setBracketState(newLocalState);

      setGlobalBrackets(prev => ({
          ...prev,
          [selectedCategory]: newLocalState
      }));
    }
  };

  const handleRemoveFromSlot = (slotId: string) => {
      const newLocalState = { ...bracketState };
      newLocalState[slotId] = null;
      setBracketState(newLocalState);

      setGlobalBrackets(prev => ({
          ...prev,
          [selectedCategory]: newLocalState
      }));
  };

  // --- ACTION HANDLERS USING SUPABASE ---

  const handleSaveDraft = () => {
      saveToSupabase('draft');
  };

  const handlePublishTournament = () => {
      if (tournament && canPublish) {
          saveToSupabase('sorting');
      }
  };

  const leftMatches = Array.from({ length: Math.ceil(matchesInFirstRound / 2) }, (_, i) => i + 1);
  const rightMatches = Array.from({ length: Math.floor(matchesInFirstRound / 2) }, (_, i) => i + 1 + Math.ceil(matchesInFirstRound / 2));

  // --- RENDER ---

  // REFRESH LOADING SCREEN
  if (uploadState === 'refreshing') {
      return (
          <div className="h-full flex flex-col items-center justify-center bg-white z-50 animate-in fade-in duration-300">
              <Loader2 size={48} className="text-primary animate-spin mb-4" />
              <h2 className="text-xl font-bold text-slate-900">Updating Database...</h2>
              <p className="text-slate-500">Syncing roster and brackets</p>
          </div>
      );
  }

  // Filter countries for dropdown
  const filteredCountries = JUDO_COUNTRIES.filter(c => 
     c.toLowerCase().includes(manualForm.country.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-background-light overflow-hidden relative">
      
      {/* Draft Alert */}
      {showDraftAlert && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
            <div className="bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700">
                <CheckCircle size={20} className="text-green-400" />
                <div>
                    <p className="font-bold text-sm">Draft Saved</p>
                    <p className="text-xs text-slate-400">Your changes have been stored to the database.</p>
                </div>
            </div>
        </div>
      )}
      
      {/* Upload Warning Alert */}
      {uploadWarning && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 animate-in slide-in-from-top-2 fade-in duration-300">
               <div className="bg-amber-50 text-amber-900 px-4 py-3 rounded-xl shadow-xl flex items-start gap-3 border border-amber-200">
                   <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                   <div>
                       <p className="font-bold text-sm">Upload Warning</p>
                       <p className="text-xs opacity-90 leading-relaxed">{uploadWarning}</p>
                   </div>
                   <button onClick={() => setUploadWarning(null)} className="ml-auto text-amber-500 hover:text-amber-700"><X size={16} /></button>
               </div>
          </div>
      )}

      {/* Strict Upload Error Alert */}
      {uploadError && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 animate-in slide-in-from-top-2 fade-in duration-300">
               <div className="bg-red-50 text-red-900 px-4 py-3 rounded-xl shadow-xl flex items-start gap-3 border border-red-200">
                   <AlertOctagon size={20} className="text-red-600 shrink-0 mt-0.5" />
                   <div>
                       <p className="font-bold text-sm">Action Failed</p>
                       <p className="text-xs opacity-90 leading-relaxed">{uploadError}</p>
                   </div>
                   <button onClick={() => setUploadError(null)} className="ml-auto text-red-500 hover:text-red-700"><X size={16} /></button>
               </div>
          </div>
      )}

      {/* Publish Success Alert */}
      {showPublishSuccess && (
          <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
               <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm text-center animate-in zoom-in-95 duration-300">
                   <div className="size-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-4 shadow-lg shadow-green-100">
                       <CheckCircle size={32} />
                   </div>
                   <h2 className="text-2xl font-black text-slate-900 mb-2">Tournament Published!</h2>
                   <p className="text-slate-500 text-sm mb-4">The event is now in "Sorting" mode. Players can start making predictions.</p>
                   <Loader2 size={24} className="text-primary animate-spin" />
               </div>
          </div>
      )}

      {/* Manual Add Modal */}
      {isManualAddOpen && (
          <div className="absolute inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white">
                      <div>
                          <h3 className="font-bold text-lg text-slate-900">New Competitor</h3>
                          <p className="text-xs text-slate-500">Add an athlete manually to the roster.</p>
                      </div>
                      <button onClick={() => setIsManualAddOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <form onSubmit={handleSaveManualCompetitor} className="p-6 space-y-5">
                      {/* Name Input */}
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
                          <div className="relative">
                            <input 
                                type="text" 
                                required
                                value={manualForm.name}
                                onChange={e => setManualForm({...manualForm, name: e.target.value})}
                                className="w-full pl-4 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all placeholder:text-slate-400"
                                placeholder="e.g. Teddy Riner"
                            />
                          </div>
                      </div>

                      <div className="flex gap-4">
                          {/* Country Input with Searchable Dropdown */}
                          <div className="flex-1 relative">
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Country</label>
                              <div className="relative">
                                  <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                  <input 
                                      type="text" 
                                      required
                                      value={manualForm.country}
                                      onFocus={() => setShowCountryDropdown(true)}
                                      onChange={e => {
                                          setManualForm({...manualForm, country: e.target.value});
                                          setShowCountryDropdown(true);
                                      }}
                                      className="w-full pl-9 pr-8 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all placeholder:text-slate-400"
                                      placeholder="Select..."
                                  />
                                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                              
                              {/* Dropdown List */}
                              {showCountryDropdown && filteredCountries.length > 0 && (
                                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50 py-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
                                      {filteredCountries.map(country => (
                                          <div 
                                              key={country}
                                              onClick={() => handleCountrySelect(country)}
                                              className="px-4 py-2 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-sm text-slate-700 font-medium"
                                          >
                                              <Flag countryCode={country} />
                                              <span>{country}</span>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>

                          {/* Rank Input (Text allowed) */}
                          <div className="w-28">
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Rank</label>
                              <div className="relative">
                                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                  <input 
                                      type="text" 
                                      value={manualForm.rank}
                                      onChange={e => setManualForm({...manualForm, rank: e.target.value})}
                                      className="w-full pl-8 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all placeholder:text-slate-400"
                                      placeholder="UR"
                                  />
                              </div>
                          </div>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-xl text-xs text-slate-500 border border-slate-100 flex items-center gap-2">
                          <span className="font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded">Category</span>
                          <span>Adding to <span className="font-bold text-primary">{selectedCategory}</span></span>
                      </div>

                      <Button 
                        type="submit" 
                        fullWidth 
                        variant="primary" 
                        icon={Plus}
                      >
                          Add Athlete
                      </Button>
                  </form>
              </div>
          </div>
      )}

      {/* Header */}
      <div className="flex-none bg-white px-4 py-3 shadow-sm z-20 border-b border-slate-200">
        <div className="w-full flex items-center justify-between">
           <div className="flex items-center gap-4">
               <button onClick={() => onNavigate('CREATE_TOURNAMENT')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
                   <ArrowLeft size={20} />
               </button>
               <div>
                   <h1 className="text-xl font-bold text-slate-900">{tournament?.name}</h1>
                   <div className="flex items-center gap-2 text-sm text-slate-500">
                       <span>Bracket Builder</span>
                       <ChevronRight size={14} />
                       <div className="relative group">
                           <select 
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="font-bold text-primary bg-primary/5 border border-primary/20 rounded focus:ring-2 focus:ring-primary/20 py-1 pl-2 pr-8 h-auto cursor-pointer appearance-none hover:bg-primary/10 transition-colors"
                           >
                               {tournament?.categories?.male?.map(c => <option key={c} value={`Men ${c}`}>Men {c}</option>)}
                               {tournament?.categories?.female?.map(c => <option key={c} value={`Women ${c}`}>Women {c}</option>)}
                           </select>
                           <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 text-primary pointer-events-none rotate-90" size={14} />
                       </div>
                   </div>
               </div>
           </div>
           
           <div className="flex items-center gap-3">
               <button 
                    onClick={handleSaveDraft}
                    className="px-4 py-2.5 rounded-lg font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-2"
               >
                   <FileText size={18} />
                   <span>Save Draft</span>
               </button>
               
               {/* PUBLISH BUTTON WITH VALIDATION */}
               <div className="relative group/publish">
                   <button 
                        onClick={handlePublishTournament}
                        disabled={!canPublish}
                        className={`px-6 py-2.5 rounded-lg font-bold shadow-lg transition-all flex items-center gap-2
                            ${canPublish 
                                ? 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/20' 
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border border-slate-300'}
                        `}
                   >
                       {canPublish ? <Save size={18} /> : <Lock size={18} />}
                       <span>Publish Tournament</span>
                   </button>
                   
                   {!canPublish && allCompetitors.length > 0 && (
                       <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 text-white text-xs p-3 rounded-lg shadow-xl opacity-0 group-hover/publish:opacity-100 transition-opacity pointer-events-none z-50">
                           <div className="flex items-start gap-2">
                               <AlertTriangle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                               <p>You cannot publish yet. There are <span className="font-bold text-yellow-400">{unplacedCount} unplaced athletes</span> across all categories.</p>
                           </div>
                       </div>
                   )}
               </div>
           </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Roster / Upload */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-10 shadow-xl">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
                <div className="flex justify-between items-center">
                    <h2 className="font-bold text-slate-900">Competitor Pool</h2>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${allCompetitors.length > 0 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-200 text-slate-500 border-slate-300'}`}>
                        {filteredRoster.length} Available
                    </span>
                </div>
                
                {/* Search Bar */}
                <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        <Search size={16} />
                    </div>
                    <input 
                        type="text" 
                        placeholder="Search Judoka..." 
                        className="w-full pl-10 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" 
                    />
                </div>

                {/* NEW ACTION BUTTONS */}
                <div className="flex gap-2">
                    <button 
                        onClick={triggerFileUpload}
                        className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-primary transition-colors"
                    >
                        <Upload size={14} />
                        Import
                    </button>
                    <button 
                        onClick={handleOpenManualAdd}
                        className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-primary transition-colors"
                    >
                        <UserPlus size={14} />
                        Manual Add
                    </button>
                    <button 
                        onClick={handleRefreshData}
                        className="w-9 flex-none flex items-center justify-center py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-primary transition-colors"
                        title="Refresh Data"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {/* Content Area with CUSTOM LIGHT SCROLLBAR */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 relative [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
                {/* Always render hidden input so it doesn't get unmounted */}
                <input 
                    type="file" 
                    accept=".xlsx, .xls"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden" 
                />

                {filteredRoster.length === 0 ? (
                    // Upload UI - Shown initially OR if current category is empty AND no one is available
                    <div className="absolute inset-0 p-4 flex flex-col items-center justify-center text-center">
                        <div 
                            onClick={triggerFileUpload}
                            className="w-full h-48 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center hover:bg-blue-50/30 hover:border-primary transition-all cursor-pointer group"
                        >
                            {uploadState === 'uploading' ? (
                                <>
                                    <Loader2 size={32} className="text-primary animate-spin mb-2" />
                                    <p className="text-xs font-bold text-slate-500">Parsing Roster...</p>
                                </>
                            ) : uploadState === 'success' ? (
                                <>
                                    <div className="size-10 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2">
                                        <Check size={24} />
                                    </div>
                                    <p className="text-sm font-bold text-slate-900">Upload Complete</p>
                                </>
                            ) : (
                                <>
                                    <div className="size-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-3 group-hover:bg-white group-hover:text-primary transition-colors shadow-sm">
                                        <Upload size={24} />
                                    </div>
                                    <p className="text-sm font-bold text-slate-900">Upload Roster</p>
                                    <p className="text-xs text-slate-500 mt-1">.xlsx / .xls</p>
                                </>
                            )}
                            
                            {/* Contextual text if adding to existing tournament */}
                            {allCompetitors.length > 0 && uploadState === 'idle' && (
                                <p className="text-[10px] text-primary/70 font-bold mt-2 animate-pulse">All active athletes placed</p>
                            )}
                        </div>
                        <div className="mt-4 text-xs text-left w-full bg-slate-50 p-3 rounded-lg border border-slate-100">
                             <p className="font-bold text-slate-700 mb-1">Excel Columns (A-E):</p>
                             <ul className="list-disc list-inside text-slate-500 space-y-0.5">
                                 <li>Sex (M/F)</li>
                                 <li>Weight (-60, -48, etc)</li>
                                 <li>Name</li>
                                 <li>Country</li>
                                 <li>Rank</li>
                             </ul>
                        </div>
                    </div>
                ) : (
                    // Roster List - FLAG ONLY (NO COUNTRY NAME)
                    filteredRoster.map(competitor => {
                        // Logic moved to useEffect: We only map competitors NOT in the bracket
                        return (
                            <div 
                                key={competitor.id}
                                draggable={true}
                                onDragStart={(e) => handleDragStart(e, competitor)}
                                className="flex items-start gap-3 p-3 rounded-lg border bg-white shadow-sm cursor-grab active:cursor-grabbing hover:border-primary/50 transition-all group border-slate-100"
                            >
                                <div className="mt-1">
                                    <GripVertical size={16} className="text-slate-300 group-hover:text-slate-400" />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                    {/* Name */}
                                    <p className="text-sm font-bold text-slate-900 truncate leading-tight mb-1">{competitor.name}</p>
                                    
                                    <div className="flex items-center justify-between">
                                        {/* Country Flag Only */}
                                        <div className="flex items-center gap-1.5">
                                            <Flag countryCode={competitor.country} className="rounded-[1px]" />
                                        </div>
                                        
                                        {/* Rank Badge */}
                                        <span className="text-[10px] font-black text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                            #{competitor.rank}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>

        {/* Right Area: Bracket Canvas - CUSTOM LIGHT SCROLLBAR */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-8">
                    <h2 className="font-bold text-slate-400 uppercase tracking-widest text-sm">{roundName} Setup</h2>
                    <p className="text-slate-500 text-sm mt-1">Category: <span className="font-bold text-primary">{selectedCategory}</span> • Bracket Size: <span className="font-bold text-slate-900">{bracketSize} Slots</span></p>
                </div>
                
                <div className="grid grid-cols-2 gap-x-8 md:gap-x-16 gap-y-8">
                    {/* Left Side Matches */}
                    <div className="space-y-6">
                         {leftMatches.map(matchNum => (
                             <div key={matchNum} className="relative">
                                 <div className="text-xs font-bold text-slate-400 mb-2 pl-2">Match {matchNum}</div>
                                 <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                     <BracketSlot slotId={`m${matchNum}-p1`} competitor={bracketState[`m${matchNum}-p1`]} onDrop={handleDrop} onRemove={handleRemoveFromSlot} />
                                     <div className="h-px bg-slate-100 w-full relative">
                                        <div className="absolute right-4 -top-3 text-[10px] bg-white px-1 text-slate-400 font-bold">VS</div>
                                     </div>
                                     <BracketSlot slotId={`m${matchNum}-p2`} competitor={bracketState[`m${matchNum}-p2`]} onDrop={handleDrop} onRemove={handleRemoveFromSlot} />
                                 </div>
                                 <div className="hidden lg:block absolute top-1/2 -right-8 w-8 h-[calc(100%+24px)] border-r-2 border-slate-300 rounded-r-lg pointer-events-none" style={{ display: matchNum % 2 !== 0 ? 'block' : 'none' }}></div>
                             </div>
                         ))}
                    </div>

                    {/* Right Side Matches */}
                     <div className="space-y-6">
                         {rightMatches.map(matchNum => (
                             <div key={matchNum} className="relative">
                                 <div className="text-xs font-bold text-slate-400 mb-2 pl-2">Match {matchNum}</div>
                                 <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                     <BracketSlot slotId={`m${matchNum}-p1`} competitor={bracketState[`m${matchNum}-p1`]} onDrop={handleDrop} onRemove={handleRemoveFromSlot} />
                                     <div className="h-px bg-slate-100 w-full relative">
                                        <div className="absolute right-4 -top-3 text-[10px] bg-white px-1 text-slate-400 font-bold">VS</div>
                                     </div>
                                     <BracketSlot slotId={`m${matchNum}-p2`} competitor={bracketState[`m${matchNum}-p2`]} onDrop={handleDrop} onRemove={handleRemoveFromSlot} />
                                 </div>
                             </div>
                         ))}
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

// Helper Sub-component for a single slot - FLAG ONLY (NO COUNTRY NAME)
const BracketSlot = ({ slotId, competitor, onDrop, onRemove }: { slotId: string, competitor: Competitor | null | undefined, onDrop: any, onRemove: any }) => {
    return (
        <div 
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, slotId)}
            className={`h-16 flex items-center px-4 transition-colors ${competitor ? 'bg-white' : 'bg-slate-50 hover:bg-slate-100'}`}
        >
            {competitor ? (
                <div className="flex items-center justify-between w-full group">
                    <div className="flex items-center gap-3">
                         <Flag countryCode={competitor.country} />
                         <div>
                             <p className="text-sm font-bold text-slate-900 leading-none">{competitor.name}</p>
                         </div>
                    </div>
                    <button 
                        onClick={() => onRemove(slotId)}
                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            ) : (
                <div className="w-full border-2 border-dashed border-slate-200 rounded-lg h-10 flex items-center justify-center text-xs font-bold text-slate-300 uppercase tracking-wider pointer-events-none">
                    Empty Slot
                </div>
            )}
        </div>
    )
}

export default BracketBuilder;
