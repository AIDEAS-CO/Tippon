
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ViewState, Tournament, Competitor } from '../types';
import { UserPlus, Filter, Search, ChevronLeft, Save, User, Upload, Loader2, X, Plus, Users, Globe, Scale, Trophy, ChevronDown, CheckCircle, GitMerge, Trash2 } from 'lucide-react';
import Button from './ui/Button';
import Flag from './ui/Flag';
import { supabase } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';
import { buildCategoryLookup, resolveCanonicalWeightCategory } from '../lib/rosterImportUtils';

interface TournamentRosterProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
  onProceed?: (t: Tournament) => void;
}

const TournamentRoster: React.FC<TournamentRosterProps> = ({ onNavigate, tournament, onProceed }) => {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  
  // Filters
  const [selectedSex, setSelectedSex] = useState<'ALL' | 'M' | 'F'>('ALL');
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL');
  const [selectedWeight, setSelectedWeight] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  
  // UI States
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Data States
  const [dbCategories, setDbCategories] = useState<{name: string, gender: 'Male'|'Female'}[]>([]);

  // Add Athlete Form State
  const [newAthlete, setNewAthlete] = useState({
      first_name: '',
      last_name: '',
      country: '',
      gender: 'Male',
      weight_category: '',
      world_rank: ''
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- FETCH CATEGORIES ---
  useEffect(() => {
    const fetchCategories = async () => {
        if (!tournament?.id) return;
        const { data } = await supabase
            .from('categories')
            .select('name, gender')
            .eq('tournament_id', tournament.id);
        if (data) setDbCategories(data);
    };
    fetchCategories();
  }, [tournament?.id]);

  // --- FETCH ROSTER FROM DB ---
  const fetchRoster = async () => {
    if (!tournament?.id) return;
    setIsLoading(true);

    try {
        const { data, error } = await supabase
            .from('tournament_roster')
            .select('*')
            .eq('tournament_id', tournament.id);

        if (error) throw error;

        if (data) {
            const mappedCompetitors: Competitor[] = data.map((item: any) => ({
                id: item.id,
                name: `${item.first_name} ${item.last_name}`.trim(),
                country: item.country,
                sex: item.gender === 'Female' ? 'F' : 'M',
                weight: item.weight_category,
                rank: item.world_rank,
                flagUrl: ''
            }));
            setCompetitors(mappedCompetitors);
        }
    } catch (err) {
        console.error("Error fetching roster:", err);
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoster();
  }, [tournament?.id]);


  // Derived filters
  const uniqueCountries = useMemo(() => Array.from(new Set(competitors.map(c => c.country))).sort(), [competitors]);
  const uniqueWeights = useMemo(() => {
    const weightSet = new Set<string>();
    for (const c of competitors) {
      weightSet.add(c.weight ?? '');
    }
    return Array.from(weightSet).sort((a, b) => {
        const parseWeight = (w: string) => {
            if (!w) return 0;
            const num = parseInt(w.replace(/[^0-9]/g, ''), 10);
            if (isNaN(num)) return -1;
            if (w.includes('+')) return num + 0.5;
            return num;
        };
        return parseWeight(b) - parseWeight(a); // Descending
    });
  }, [competitors]);

  const filteredCompetitors = useMemo(() => {
    return competitors.filter(c => {
        const matchesSex = selectedSex === 'ALL' || c.sex === selectedSex;
        const matchesCountry = selectedCountry === 'ALL' || c.country === selectedCountry;
        const matchesWeight = selectedWeight === 'ALL' || c.weight === selectedWeight;
        const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              c.country.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesSex && matchesCountry && matchesWeight && matchesSearch;
    });
  }, [competitors, selectedSex, selectedCountry, selectedWeight, searchQuery]);

  const handleSaveTournament = async () => {
      if (!tournament?.id) return;
      
      console.log("Saving tournament ID:", tournament.id);
      
      setIsProcessing(true);
      try {
          // Changed to lowercase 'upcoming' as requested for persistence
          const { error } = await supabase
              .from('tournaments')
              .update({ status: 'upcoming' })
              .eq('id', tournament.id);

          if (error) throw error;

          // Only navigate AFTER a successful save
          alert("Tournament saved successfully!");
          onNavigate('HOME');
          
      } catch (err: any) {
          console.error("Error saving tournament:", err);
          
          if (err.message?.includes('enum') || err.message?.includes('violates check constraint')) {
              alert("Database ENUM Error: Please check if your database expects 'UPCOMING', 'upcoming', or 'DRAFT'.");
          } else {
              alert("Error saving: " + err.message);
          }
      } finally {
          setIsProcessing(false);
      }
  };

  const triggerFileUpload = () => {
      fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file || !tournament?.id) {
      if (!tournament?.id) {
        console.error('UPLOAD ERROR: Tournament ID is missing from state!');
        alert(
          'Error: Tournament ID is missing. Go back to the previous step and try again.'
        );
      }
      return;
    }

    setIsProcessing(true);
    const reader = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith('.csv');

    reader.onload = async (e) => {
      try {
        const lookup = buildCategoryLookup(dbCategories || []);

        let workbook: XLSX.WorkBook;
        if (isCsv) {
          const text = String(e.target?.result ?? '');
          workbook = XLSX.read(text, { type: 'string', raw: false });
        } else {
          workbook = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array' });
        }

        const dataRows: any[][] = [];
        for (const sheetName of workbook.SheetNames) {
          const ws = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
          for (let i = 1; i < rows.length; i++) {
            dataRows.push(rows[i]);
          }
        }

        const insertPayload: {
          tournament_id: string;
          first_name: string;
          last_name: string;
          country: string;
          gender: string;
          weight_category: string;
          world_rank: number;
        }[] = [];
        let skippedNoName = 0;
        let skippedCategory = 0;
        const skipSamples: string[] = [];

        const clean = (val: unknown) => (val !== undefined && val !== null && val !== '' ? String(val).trim() : '');

        for (let ri = 0; ri < dataRows.length; ri++) {
          const row = dataRows[ri];
          if (!row || row.length === 0) continue;

          const rankStr = clean(row[1]).replace('#', '');
          const country = clean(row[4]) || 'UNK';
          const firstName = clean(row[6]);
          const lastName = clean(row[7]);
          const genderRaw = clean(row[8]).toLowerCase();
          const categoryRaw = clean(row[9]);

          if (!firstName && !lastName) {
            skippedNoName++;
            continue;
          }

          const rank = parseInt(rankStr, 10) || 999;
          const sex: 'Male' | 'Female' =
            genderRaw.includes('f') || genderRaw === 'female' ? 'Female' : 'Male';

          const canonical = resolveCanonicalWeightCategory(categoryRaw, sex, lookup);
          if (!canonical) {
            skippedCategory++;
            if (skipSamples.length < 12) {
              skipSamples.push(
                `Row ~${ri + 2}: "${lastName}, ${firstName}" — category "${categoryRaw}" (${sex})`
              );
            }
            continue;
          }

          insertPayload.push({
            tournament_id: tournament.id,
            first_name: firstName,
            last_name: lastName,
            country: country.toUpperCase(),
            gender: sex,
            weight_category: canonical,
            world_rank: rank,
          });
        }

        if (insertPayload.length === 0) {
          const detail =
            skipSamples.length > 0
              ? `\n\nSkipped row examples:\n${skipSamples.slice(0, 8).join('\n')}`
              : '';
          alert(
            `No athletes imported. Rows without name: ${skippedNoName}; category not in tournament: ${skippedCategory}.${detail}`
          );
          return;
        }

        const { error } = await supabase.from('tournament_roster').insert(insertPayload);
        if (error) throw error;

        const sampleNote =
          skipSamples.length > 0
            ? `\nSkipped row examples (category mismatch):\n${skipSamples.slice(0, 5).join('\n')}`
            : '';
        alert(
          `Imported ${insertPayload.length} athletes (all worksheets in the workbook).` +
            `\nSkipped: ${skippedNoName} without name; ${skippedCategory} with unrecognized category.${sampleNote}`
        );
        await fetchRoster();
      } catch (err: any) {
        console.error('Error processing file:', err);
        alert('Error: ' + err.message);
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    if (isCsv) {
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handleAddAthleteSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!tournament?.id) return;
      
      try {
          setIsProcessing(true);
          const { error } = await supabase.from('tournament_roster').insert([{
              tournament_id: tournament.id,
              first_name: newAthlete.first_name,
              last_name: newAthlete.last_name,
              country: newAthlete.country.toUpperCase(),
              gender: newAthlete.gender,
              weight_category: newAthlete.weight_category,
              world_rank: parseInt(newAthlete.world_rank) || 999
          }]);

          if (error) throw error;

          await fetchRoster();
          setIsAddModalOpen(false);
          setShowSuccessToast(true);
          setTimeout(() => setShowSuccessToast(false), 3000);
          
          setNewAthlete({ first_name: '', last_name: '', country: '', gender: 'Male', weight_category: '', world_rank: '' });

      } catch (err: any) {
          alert('Error adding athlete: ' + err.message);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleDeleteAthlete = async (athleteId: string, athleteName: string) => {
      if (!confirm(`Remove "${athleteName}" from the roster?`)) return;
      try {
          const { error } = await supabase
              .from('tournament_roster')
              .delete()
              .eq('id', athleteId);
          if (error) throw error;
          await fetchRoster();
      } catch (err: any) {
          alert('Error deleting athlete: ' + err.message);
      }
  };

  // Filter categories for the Add Modal based on selected gender
  // Prioritize tournament categories if available (from parent), else fall back to DB
  const availableCategoriesForAdd = useMemo(() => {
      if (tournament?.categories) {
          return newAthlete.gender === 'Male' ? tournament.categories.male : tournament.categories.female;
      }
      return dbCategories.filter(c => c.gender === newAthlete.gender).map(c => c.name);
  }, [tournament, dbCategories, newAthlete.gender]);

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden relative">
        {isProcessing && !isAddModalOpen && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                <Loader2 size={64} className="text-blue-600 animate-spin mb-4" />
                <h2 className="text-2xl font-black text-slate-900">Processing...</h2>
            </div>
        )}

        {/* Success Toast */}
        {showSuccessToast && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 fade-in duration-300">
                <div className="bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
                    <CheckCircle size={20} className="text-green-400" />
                    <span className="font-bold">Athlete added successfully</span>
                </div>
            </div>
        )}

        {/* PROFESSIONAL ADD ATHLETE MODAL */}
        {isAddModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div className="bg-slate-50/50 px-8 py-6 border-b border-slate-100 flex justify-between items-center">
                        <div>
                            <h3 className="font-black text-2xl text-slate-900">Add Athlete</h3>
                            <p className="text-sm text-slate-500 font-medium">Register a new competitor manually.</p>
                        </div>
                        <button 
                            onClick={() => setIsAddModalOpen(false)}
                            className="p-2 bg-white border border-slate-200 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <form onSubmit={handleAddAthleteSubmit} className="p-8 space-y-6">
                        
                        {/* Name Row */}
                        <div className="grid grid-cols-2 gap-5">
                            <div className="space-y-1.5">
                                <label className="block text-sm font-bold text-slate-700 ml-1">First Name</label>
                                <div className="relative group">
                                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                    <input 
                                        required 
                                        type="text" 
                                        value={newAthlete.first_name} 
                                        onChange={e => setNewAthlete({...newAthlete, first_name: e.target.value})} 
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 placeholder:text-slate-400" 
                                        placeholder="Teddy" 
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-sm font-bold text-slate-700 ml-1">Last Name</label>
                                <div className="relative group">
                                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                    <input 
                                        required 
                                        type="text" 
                                        value={newAthlete.last_name} 
                                        onChange={e => setNewAthlete({...newAthlete, last_name: e.target.value})} 
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 placeholder:text-slate-400" 
                                        placeholder="Riner" 
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Country & Rank */}
                        <div className="grid grid-cols-2 gap-5">
                            <div className="space-y-1.5">
                                <label className="block text-sm font-bold text-slate-700 ml-1">Country (IOC)</label>
                                <div className="relative group">
                                    <Globe size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                    <input 
                                        required 
                                        type="text" 
                                        maxLength={3}
                                        value={newAthlete.country} 
                                        onChange={e => setNewAthlete({...newAthlete, country: e.target.value.toUpperCase()})} 
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 placeholder:text-slate-400 uppercase" 
                                        placeholder="FRA" 
                                    />
                                </div>
                            </div>
                             <div className="space-y-1.5">
                                <label className="block text-sm font-bold text-slate-700 ml-1">World Rank</label>
                                <div className="relative group">
                                    <Trophy size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                    <input 
                                        required 
                                        type="number" 
                                        value={newAthlete.world_rank} 
                                        onChange={e => setNewAthlete({...newAthlete, world_rank: e.target.value})} 
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 placeholder:text-slate-400" 
                                        placeholder="1" 
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Gender & Weight */}
                        <div className="grid grid-cols-2 gap-5">
                             <div className="space-y-1.5">
                                <label className="block text-sm font-bold text-slate-700 ml-1">Gender</label>
                                <div className="relative group">
                                     <Users size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" />
                                     <select
                                        value={newAthlete.gender}
                                        onChange={e => setNewAthlete({...newAthlete, gender: e.target.value, weight_category: ''})}
                                        className="w-full pl-10 pr-8 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 appearance-none cursor-pointer"
                                     >
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                     </select>
                                     <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                             </div>
                             <div className="space-y-1.5">
                                <label className="block text-sm font-bold text-slate-700 ml-1">Category</label>
                                <div className="relative group">
                                     <Scale size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10" />
                                     <select
                                        required
                                        value={newAthlete.weight_category}
                                        onChange={e => setNewAthlete({...newAthlete, weight_category: e.target.value})}
                                        className="w-full pl-10 pr-8 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 appearance-none cursor-pointer"
                                     >
                                        <option value="">Select...</option>
                                        {availableCategoriesForAdd.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                     </select>
                                     <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                             </div>
                        </div>

                        {/* Buttons */}
                        <div className="pt-4 flex gap-3">
                             <Button type="button" variant="secondary" onClick={() => setIsAddModalOpen(false)} fullWidth>Cancel</Button>
                             <Button type="submit" variant="primary" isLoading={isProcessing} fullWidth icon={UserPlus}>Add Athlete</Button>
                        </div>

                    </form>
                </div>
            </div>
        )}

        {/* Hidden File Input */}
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" 
            className="hidden" 
        />

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button onClick={() => onNavigate('SCORING_RULES')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
                    <ChevronLeft size={20} />
                </button>
                <div>
                    <h1 className="text-xl font-bold text-slate-900">{tournament?.name || 'New Tournament'}</h1>
                    <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-bold uppercase">Roster Management</span>
                        <span>•</span>
                        <span>{competitors.length} Athletes Registered</span>
                    </div>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                {/* FORCE ADMIN BUTTON - NO STATUS CHECK */}
                {onProceed && (
                    <div className="mt-4 md:mt-0 flex gap-4">
                        <Button 
                            onClick={() => tournament && onProceed(tournament)} 
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            icon={GitMerge}
                        >
                            Generate Brackets (Upload PDF)
                        </Button>
                    </div>
                )}
                <Button 
                    variant="primary" 
                    onClick={handleSaveTournament}
                    icon={Save}
                    disabled={competitors.length === 0}
                >
                    Save Tournament
                </Button>
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-6xl mx-auto space-y-6">
                
                {/* Toolbar */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col xl:flex-row items-center justify-between gap-4">
                    <div className="flex flex-col md:flex-row items-center gap-3 w-full xl:w-auto">
                        <div className="flex bg-slate-100 rounded-lg p-1 w-full md:w-auto">
                            <button 
                                onClick={() => setSelectedSex('ALL')}
                                className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-xs font-bold transition-all ${selectedSex === 'ALL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                All
                            </button>
                            <button 
                                onClick={() => setSelectedSex('M')}
                                className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-xs font-bold transition-all ${selectedSex === 'M' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Men
                            </button>
                            <button 
                                onClick={() => setSelectedSex('F')}
                                className={`flex-1 md:flex-none px-4 py-1.5 rounded-md text-xs font-bold transition-all ${selectedSex === 'F' ? 'bg-pink-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Women
                            </button>
                        </div>
                        
                        <div className="flex gap-2 w-full md:w-auto">
                             <select 
                                value={selectedCountry}
                                onChange={(e) => setSelectedCountry(e.target.value)}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                             >
                                 <option value="ALL">All Countries</option>
                                 {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
                             </select>
                             
                             <select 
                                value={selectedWeight}
                                onChange={(e) => setSelectedWeight(e.target.value)}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                             >
                                 <option value="ALL">All Weights</option>
                                 {uniqueWeights.map(w => <option key={w} value={w}>{w}</option>)}
                             </select>
                        </div>

                        <div className="relative flex-1 w-full md:w-64">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input 
                                type="text" 
                                placeholder="Search by name..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 w-full xl:w-auto">
                        <Button
                            onClick={triggerFileUpload}
                            variant="secondary"
                            icon={isProcessing ? Loader2 : Upload}
                            size="sm"
                            disabled={isProcessing}
                            className={isProcessing ? "opacity-70 cursor-wait" : ""}
                        >
                            {isProcessing ? 'Importing...' : 'Bulk Upload'}
                        </Button>
                        
                        <Button 
                            onClick={() => setIsAddModalOpen(true)}
                            icon={UserPlus}
                            size="sm"
                        >
                            Add Athlete
                        </Button>
                    </div>
                    <p className="text-[11px] text-slate-500 w-full xl:max-w-xl leading-relaxed">
                      <span className="font-bold text-slate-600">Excel/CSV template (row 1 = header; all sheets are imported):</span>{' '}
                      col B rank, E country, G first name, H last name, I gender (M/F), J weight category (e.g. -60kg or Men -60).
                      Categories are matched flexibly to the tournament configuration.
                    </p>
                </div>

                {/* Conditional Rendering for Empty State vs Roster Table */}
                {!isLoading && competitors.length === 0 ? (
                    // Empty State
                    <div className="flex flex-col items-center justify-center p-16 bg-white border-2 border-dashed border-slate-200 rounded-2xl text-center animate-in fade-in zoom-in-95 duration-300 min-h-[400px]">
                        <div className="size-24 bg-blue-50 rounded-full flex items-center justify-center mb-6 shadow-sm">
                            <Users size={48} className="text-blue-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Ready to build your roster?</h2>
                        <p className="text-slate-500 max-w-md mb-8 leading-relaxed">
                            Upload your judokas from a CSV/Excel file or add them manually to get started with the tournament configuration.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                             <Button onClick={triggerFileUpload} icon={Upload} size="lg" fullWidth={false} className="min-w-[180px]">Upload Roster</Button>
                             <Button onClick={() => setIsAddModalOpen(true)} variant="secondary" icon={UserPlus} size="lg" fullWidth={false} className="min-w-[180px]">Add Manually</Button>
                        </div>
                    </div>
                ) : (
                    // Roster Table
                    <div className="bg-white rounded-xl shadow-zen border border-slate-200 overflow-hidden min-h-[400px]">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    <th className="px-6 py-4 w-16 text-center">Rank</th>
                                    <th className="px-6 py-4">Athlete Name</th>
                                    <th className="px-6 py-4">Country</th>
                                    <th className="px-6 py-4 text-center">Gender</th>
                                    <th className="px-6 py-4 text-center">Weight Category</th>
                                    <th className="px-4 py-4 w-12"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-slate-400">
                                                <Loader2 size={32} className="animate-spin mb-2" />
                                                <p>Loading roster from database...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredCompetitors.length > 0 ? (
                                    filteredCompetitors.map((competitor) => (
                                        <tr key={competitor.id} className="hover:bg-slate-50 transition-colors group">
                                            <td className="px-6 py-4 text-center font-mono font-bold text-slate-400 group-hover:text-slate-600">
                                                #{competitor.rank}
                                            </td>
                                            <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-3">
                                                <div className="p-1.5 bg-slate-100 rounded-full text-slate-400">
                                                    <User size={16} />
                                                </div>
                                                {competitor.name}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <Flag countryCode={competitor.country} className="rounded-[1px]" />
                                                    <span className="font-medium text-slate-600">{competitor.country}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${competitor.sex === 'M' ? 'bg-blue-50 text-blue-600' : 'bg-pink-50 text-pink-600'}`}>
                                                    {competitor.sex === 'M' ? 'Male' : 'Female'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center font-bold text-slate-800">
                                                {competitor.weight}
                                            </td>
                                            <td className="px-4 py-4 text-center">
                                                <button
                                                    onClick={() => handleDeleteAthlete(competitor.id, competitor.name)}
                                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Remove athlete"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                                            No athletes found matching your filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

            </div>
        </div>
    </div>
  );
};

export default TournamentRoster;
