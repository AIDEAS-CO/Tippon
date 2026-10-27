
import React, { useState, useEffect } from 'react';
import { ViewState } from '../types';
import { 
  ChevronRight, Sliders, 
  ArrowRight, Tag, ArrowLeft,
  Target, Award, Zap, Save, Medal, Flag, Star, ChevronDown, List, LayoutGrid, Lock
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Button from '../components/ui/Button';
import { showToast } from '../lib/toast';

interface AdminDashboardProps {
  onNavigate: (view: ViewState) => void;
  onProceedToRoster: (t: any) => void;
  /** Next step after scoring rules (bracket builder). Falls back to onProceedToRoster when not provided. */
  onProceedToBracket?: (t: any) => void;
  initialData?: any;
  initialStep?: 1 | 2;
}

const MALE_WEIGHTS = ['-60kg', '-66kg', '-73kg', '-81kg', '-90kg', '-100kg', '+100kg'];
const FEMALE_WEIGHTS = ['-48kg', '-52kg', '-57kg', '-63kg', '-70kg', '-78kg', '+78kg'];
const TEAMS_CATEGORY = 'Teams';

/** Number of competition days: inclusive span start..end, or 4 when no valid end date. */
function dayCount(start: string, end: string): number {
  if (!start || !end) return 4;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (isNaN(a) || isNaN(b) || b < a) return 4;
  return Math.min(14, Math.round((b - a) / 86_400_000) + 1);
}

/** PostgREST / Postgres error for a column that does not exist yet (migration not run). */
function isMissingColumnError(err: any, column: string): boolean {
  return !!err && (err.code === '42703' || err.code === 'PGRST204') && String(err.message || '').includes(column);
}

interface ScoringRule {
  id: string;
  label: string;
  description: string;
  defaultPoints: number;
  enabled: boolean;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

const DEFAULT_SCORING_RULES: ScoringRule[] = [
    // 1st & 2nd Place
    { id: 'gold_silver_exact', label: 'Exact Match', description: 'Exact match for Gold or Silver medalist.', defaultPoints: 6, enabled: true, icon: Target, color: 'text-amber-500', bgColor: 'bg-amber-50' },
    { id: 'gold_silver_dev1', label: 'Deviation 1', description: 'Off by 1 ranking position.', defaultPoints: 3, enabled: true, icon: Target, color: 'text-amber-500', bgColor: 'bg-amber-50' },
    { id: 'gold_silver_dev2', label: 'Deviation 2', description: 'Off by 2 ranking positions.', defaultPoints: 2, enabled: true, icon: Target, color: 'text-amber-500', bgColor: 'bg-amber-50' },
    { id: 'gold_silver_dev3', label: 'Deviation 3', description: 'Off by 3 ranking positions.', defaultPoints: 1, enabled: true, icon: Target, color: 'text-amber-500', bgColor: 'bg-amber-50' },
    
    // 3rd Place
    { id: 'bronze_exact', label: 'Exact Match', description: 'Exact match for Bronze medalist.', defaultPoints: 4, enabled: true, icon: Target, color: 'text-orange-600', bgColor: 'bg-orange-50' },
    { id: 'bronze_dev1', label: 'Deviation 1', description: 'Off by 1 ranking position.', defaultPoints: 3, enabled: true, icon: Target, color: 'text-orange-600', bgColor: 'bg-orange-50' },
    { id: 'bronze_dev2', label: 'Deviation 2', description: 'Off by 2 ranking positions.', defaultPoints: 1, enabled: true, icon: Target, color: 'text-orange-600', bgColor: 'bg-orange-50' },

    // Zusatztipp (Additional Pick)
    { id: 'additional_pick_top7', label: 'Top 7 Pick', description: 'Chosen athlete finishes in Top 7.', defaultPoints: 2, enabled: true, icon: List, color: 'text-blue-600', bgColor: 'bg-blue-50' },

    // Pool Finals — 1 pt per correct QF participant (out of 8 per category)
    { id: 'pool_finals_per_correct', label: 'Per Correct QF Athlete', description: '1 point for each of the 8 QF participants correctly predicted (order doesn\'t matter).', defaultPoints: 1, enabled: true, icon: LayoutGrid, color: 'text-yellow-600', bgColor: 'bg-yellow-50' },

    // Medal Table
    { id: 'medal_table_exact', label: 'Exact Ranking', description: 'Country is at the exact predicted ranking position.', defaultPoints: 4, enabled: true, icon: Flag, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    { id: 'medal_table_dev1', label: 'Deviation 1', description: 'Country ranking off by 1 position.', defaultPoints: 3, enabled: true, icon: Flag, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    { id: 'medal_table_dev2', label: 'Deviation 2', description: 'Country ranking off by 2 positions.', defaultPoints: 2, enabled: true, icon: Flag, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    { id: 'medal_table_dev3', label: 'Deviation 3', description: 'Country ranking off by 3 positions.', defaultPoints: 1, enabled: true, icon: Flag, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },

    // Bonuses
    { id: 'bonus_perfect_weight', label: 'Perfect Weight Category', description: 'All 4 medalists (Gold, Silver, Bronze x2) exactly correct in one category.', defaultPoints: 10, enabled: true, icon: Star, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { id: 'bonus_majority_champs', label: 'Majority of Champions', description: 'More than 50% of Gold medal predictions correct across all categories.', defaultPoints: 8, enabled: true, icon: Star, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { id: 'bonus_10_additional', label: '10 Additional Picks', description: '10 or more additional (Zusatztipp) picks correct across all categories.', defaultPoints: 6, enabled: true, icon: Star, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { id: 'bonus_all_pools', label: 'All QF Athletes', description: 'All 8 QF participants correct in every category.', defaultPoints: 5, enabled: true, icon: Star, color: 'text-purple-600', bgColor: 'bg-purple-50' }
];

// Rule groups: which rules belong to each scoring category
const RULE_GROUPS = [
  {
    id: 'group_1st_2nd',
    title: '1st & 2nd Place',
    icon: Medal,
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    ruleIds: ['gold_silver_exact', 'gold_silver_dev1', 'gold_silver_dev2', 'gold_silver_dev3']
  },
  {
    id: 'group_3rd',
    title: '3rd Place',
    icon: Award,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    ruleIds: ['bronze_exact', 'bronze_dev1', 'bronze_dev2']
  },
  {
    id: 'group_additional',
    title: 'Additional Pick',
    icon: List,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    ruleIds: ['additional_pick_top7']
  },
  {
    id: 'group_pool',
    title: 'Pool Finals (QF)',
    icon: LayoutGrid,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    ruleIds: ['pool_finals_per_correct']
  },
  {
    id: 'group_medal',
    title: 'Medal Table',
    icon: Flag,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    ruleIds: ['medal_table_exact', 'medal_table_dev1', 'medal_table_dev2', 'medal_table_dev3']
  },
  {
    id: 'group_bonus',
    title: 'Bonuses',
    icon: Zap,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    ruleIds: ['bonus_perfect_weight', 'bonus_majority_champs', 'bonus_10_additional', 'bonus_all_pools']
  }
];

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate, onProceedToRoster, onProceedToBracket, initialData, initialStep = 1 }) => {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [isNavigating, setIsNavigating] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['group_1st_2nd']);
  
  // Track ID of newly created tournament if initialData was null
  const [createdTournamentId, setCreatedTournamentId] = useState<string | number | null>(null);

  // --- DATE CONSTANTS ---
  const today = new Date().toISOString().split('T')[0];
  const nextYearDate = new Date();
  nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
  const nextYear = nextYearDate.toISOString().split('T')[0];

  // Helper for date formatting
  const formatDateForInput = (dateString: string | undefined) => {
    if (!dateString) return '';
    try {
        // Returns only YYYY-MM-DD part
        return new Date(dateString).toISOString().split('T')[0];
    } catch (e) {
        return '';
    }
  };

  // Helper to merge saved config with rules
  function mergeScoringConfig(savedConfig: any) {
      return DEFAULT_SCORING_RULES.map(rule => {
          // Disabled rules are saved as 0 so the scoring engine does not fall back to defaults.
          if (typeof savedConfig[rule.id] === 'number' && savedConfig[rule.id] !== 0) {
              return { ...rule, defaultPoints: savedConfig[rule.id], enabled: true };
          }
          return { ...rule, enabled: false };
      });
  }
  
  const isEditing = !!initialData;

  // Unified Form Data
  const [formData, setFormData] = useState<{
      name: string;
      date: string;
      endDate: string;
      location: string;
      maleSelected: boolean;
      femaleSelected: boolean;
      selectedMaleWeights: string[];
      selectedFemaleWeights: string[];
      scoringRules: ScoringRule[];
      hasRepechage: boolean;
      mixedTeams: boolean;
      /** Competition day per category name (null = not set). */
      categoryDays: Record<string, number | null>;
  }>({
      name: initialData?.name || '',
      date: formatDateForInput(initialData?.start_date),
      endDate: formatDateForInput(initialData?.end_date),
      location: initialData?.location || '',
      // LOGIC: If editing, check if categories exist. If creating, default to TRUE.
      maleSelected: isEditing ? (initialData?.categories?.male?.length > 0) : true,
      femaleSelected: isEditing ? (initialData?.categories?.female?.length > 0) : true,
      // LOGIC: If editing, use saved weights. If creating, default to ALL weights.
      selectedMaleWeights: isEditing ? (initialData?.categories?.male || []) : MALE_WEIGHTS,
      selectedFemaleWeights: isEditing ? (initialData?.categories?.female || []) : FEMALE_WEIGHTS,
      scoringRules: initialData?.scoring_configuration
          ? mergeScoringConfig(initialData.scoring_configuration)
          : DEFAULT_SCORING_RULES,
      hasRepechage: initialData?.scoring_configuration?.has_repechage ?? false,
      mixedTeams: (initialData?.categories?.mixed || []).length > 0,
      categoryDays: {},
  });
  /** Categories whose picks are locked/closed: cannot be removed from the tournament. */
  const [lockedCategories, setLockedCategories] = useState<string[]>([]);

  // --- PERSISTENCE: Re-sync on initialData change ---
  useEffect(() => {
    if (initialData) {
        setFormData(prev => ({
            ...prev,
            name: initialData.name || prev.name,
            date: formatDateForInput(initialData.start_date) || prev.date,
            endDate: formatDateForInput(initialData.end_date) || prev.endDate,
            location: initialData.location || prev.location,
            maleSelected: initialData.categories?.male?.length > 0,
            femaleSelected: initialData.categories?.female?.length > 0,
            selectedMaleWeights: initialData.categories?.male || [],
            selectedFemaleWeights: initialData.categories?.female || [],
            scoringRules: initialData.scoring_configuration
                ? mergeScoringConfig(initialData.scoring_configuration)
                : prev.scoringRules,
            hasRepechage: initialData.scoring_configuration?.has_repechage ?? prev.hasRepechage,
            mixedTeams: (initialData.categories?.mixed || []).length > 0,
        }));
    }
  }, [initialData]);

  // Editing: load competition days and statuses of the saved categories.
  useEffect(() => {
    if (!initialData?.id) return;
    let cancelled = false;
    (async () => {
      let res: any = await supabase.from('categories').select('name, status, day').eq('tournament_id', initialData.id);
      if (isMissingColumnError(res.error, 'day')) {
        res = await supabase.from('categories').select('name, status').eq('tournament_id', initialData.id);
      }
      if (cancelled || res.error || !res.data) return;
      const days: Record<string, number | null> = {};
      res.data.forEach((c: any) => { days[c.name] = typeof c.day === 'number' ? c.day : null; });
      setFormData(prev => ({ ...prev, categoryDays: { ...days, ...prev.categoryDays } }));
      setLockedCategories(res.data.filter((c: any) => (c.status ?? 'open') !== 'open').map((c: any) => c.name));
    })();
    return () => { cancelled = true; };
  }, [initialData?.id]);

  const activeId = initialData?.id || createdTournamentId;

  // --- STEP 1 HANDLERS ---
  const toggleWeight = (weight: string, isMale: boolean) => {
    if (lockedCategories.includes(weight)) {
        showToast('warning', `${weight} has locked or closed picks and cannot be removed.`);
        return;
    }
    if (isMale) {
        setFormData(prev => ({
            ...prev,
            selectedMaleWeights: prev.selectedMaleWeights.includes(weight) 
                ? prev.selectedMaleWeights.filter((w: string) => w !== weight) 
                : [...prev.selectedMaleWeights, weight]
        }));
    } else {
        setFormData(prev => ({
            ...prev,
            selectedFemaleWeights: prev.selectedFemaleWeights.includes(weight) 
                ? prev.selectedFemaleWeights.filter((w: string) => w !== weight) 
                : [...prev.selectedFemaleWeights, weight]
        }));
    }
  };

  const handleStep1Save = async () => {
      // 1. Prevention of double submission
      if (isNavigating) return;

      if (!formData.name || !formData.date) { showToast('warning', 'Please complete the tournament name and date.'); return; }
      
      setIsNavigating(true);
      try {
          // Re-calculate activeId inside logic to be sure, though state should be source of truth
          let tournamentId = activeId;
          
          const basePayload = {
              name: formData.name,
              location: formData.location || 'TBD',
              start_date: formData.date,
              // DB stores lowercase status; initialData.status is upper-cased by mapTournamentData
              status: String(initialData?.status || 'upcoming').toLowerCase()
          };
          const payload = { ...basePayload, end_date: formData.endDate || null };

          if (tournamentId) {
              // UPDATE: If ID exists, ALWAYS update
              let { error } = await supabase.from('tournaments').update(payload).eq('id', tournamentId);
              if (isMissingColumnError(error, 'end_date')) {
                  ({ error } = await supabase.from('tournaments').update(basePayload).eq('id', tournamentId));
                  showToast('warning', 'End date not saved: run migration 009.');
              }
              if (error) throw error;
          } else {
              // INSERT: Only if no ID exists yet
              let { data, error } = await supabase.from('tournaments').insert([payload]).select().single();
              if (isMissingColumnError(error, 'end_date')) {
                  ({ data, error } = await supabase.from('tournaments').insert([basePayload]).select().single());
                  showToast('warning', 'End date not saved: run migration 009.');
              }
              if (error) throw error;
              tournamentId = data.id;
              setCreatedTournamentId(tournamentId);
          }

          await syncCategories(tournamentId as string | number);

          setStep(2);
          window.scrollTo(0,0);
      } catch (err: any) {
          console.error("Error saving step 1:", err);
          showToast('error', "Error saving: " + err.message);
      } finally {
          setIsNavigating(false);
      }
  };

  /** Desired categories from the form (name, gender, competition day). */
  const desiredCategories = () => {
      const out: { name: string; gender: 'Male' | 'Female' | 'Mixed'; day: number | null }[] = [];
      const day = (name: string) => formData.categoryDays[name] ?? null;
      if (formData.maleSelected) formData.selectedMaleWeights.forEach(w => out.push({ name: w, gender: 'Male', day: day(w) }));
      if (formData.femaleSelected) formData.selectedFemaleWeights.forEach(w => out.push({ name: w, gender: 'Female', day: day(w) }));
      if (formData.mixedTeams) out.push({ name: TEAMS_CATEGORY, gender: 'Mixed', day: day(TEAMS_CATEGORY) });
      return out;
  };

  /**
   * Sync `categories` rows with the form (create and edit): insert new, update gender/day,
   * delete deselected ones — except categories whose picks are locked/closed.
   */
  const syncCategories = async (tournamentId: string | number) => {
      const desired = desiredCategories();
      let includeDay = true;
      let res: any = await supabase.from('categories').select('id, name, gender, status, day').eq('tournament_id', tournamentId);
      if (isMissingColumnError(res.error, 'day')) {
          includeDay = false;
          res = await supabase.from('categories').select('id, name, gender, status').eq('tournament_id', tournamentId);
      }
      if (res.error) throw res.error;
      const existing: any[] = res.data || [];

      const removed = existing.filter(r => !desired.some(d => d.name === r.name));
      const deletable = removed.filter(r => (r.status ?? 'open') === 'open');
      const kept = removed.filter(r => (r.status ?? 'open') !== 'open');
      if (deletable.length > 0) {
          const { error } = await supabase.from('categories').delete().in('id', deletable.map(r => r.id));
          if (error) throw error;
      }

      for (const d of desired) {
          const ex = existing.find(r => r.name === d.name);
          if (!ex) continue;
          const dayChanged = includeDay && (ex.day ?? null) !== d.day;
          if (ex.gender !== d.gender || dayChanged) {
              const { error } = await supabase
                  .from('categories')
                  .update({ gender: d.gender, ...(includeDay ? { day: d.day } : {}) })
                  .eq('id', ex.id);
              if (error) throw error;
          }
      }

      const inserts = desired
          .filter(d => !existing.some(r => r.name === d.name))
          .map(d => ({ tournament_id: tournamentId, name: d.name, gender: d.gender, ...(includeDay ? { day: d.day } : {}) }));
      if (inserts.length > 0) {
          const { error } = await supabase.from('categories').insert(inserts);
          if (error) throw error;
      }

      if (!includeDay && desired.some(d => d.day != null)) showToast('warning', 'Competition days not saved: run migration 009.');
      if (kept.length > 0) showToast('warning', `Kept ${kept.map(r => r.name).join(', ')}: picks are locked or closed.`);
  };

  const handleBack = () => {
      if (step === 1) {
          onNavigate('HOME');
      } else {
          setStep(1); 
      }
  };

  // --- STEP 2 HANDLERS (RULES) ---

  const updateRulePoints = (id: string, points: number) => {
      setFormData(prev => ({
          ...prev,
          scoringRules: prev.scoringRules.map(rule => rule.id === id ? { ...rule, defaultPoints: points } : rule)
      }));
  };

  const toggleGroupExpansion = (groupId: string) => {
      setExpandedGroups(prev => 
          prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
      );
  };

  const toggleCategoryMaster = (groupId: string, targetState: boolean) => {
      const group = RULE_GROUPS.find(g => g.id === groupId);
      if (!group) return;

      setFormData(prev => ({
          ...prev,
          scoringRules: prev.scoringRules.map(rule => {
              if (group.ruleIds.includes(rule.id)) {
                  return { ...rule, enabled: targetState };
              }
              return rule;
          })
      }));

      if (targetState) {
          setExpandedGroups(prev => prev.includes(groupId) ? prev : [...prev, groupId]);
      } else {
          setExpandedGroups(prev => prev.filter(id => id !== groupId));
      }
  };

  const isGroupEnabled = (groupId: string) => {
      const group = RULE_GROUPS.find(g => g.id === groupId);
      if (!group) return false;
      const firstRuleId = group.ruleIds[0];
      const rule = formData.scoringRules.find(r => r.id === firstRuleId);
      return rule ? rule.enabled : false;
  };

  // --- SUBMIT ---
  const handleSaveAndProceed = async () => {
    if (isNavigating) return; // Prevention
    setIsNavigating(true);
    try {
        const tournamentId = activeId;
        if (!tournamentId) throw new Error("No tournament ID found. Please go back to Step 1.");

        // Disabled rules are saved as 0 (omitted keys would fall back to engine defaults).
        const scoringConfig = formData.scoringRules.reduce((acc, rule) => {
            acc[rule.id] = rule.enabled ? rule.defaultPoints : 0;
            return acc;
        }, {} as any);
        scoringConfig.has_repechage = formData.hasRepechage;

        const { error } = await supabase
            .from('tournaments')
            .update({ scoring_configuration: scoringConfig })
            .eq('id', tournamentId);

        if (error) throw error;

        // Construct object for next view
        const tournamentForBuilder = {
            id: tournamentId, 
            name: formData.name, 
            date: formData.date, 
            location: formData.location, 
            status: initialData?.status || 'upcoming', // Ensure consistency
            end_date: formData.endDate || null,
            categories: {
                male: formData.maleSelected ? formData.selectedMaleWeights : [],
                female: formData.femaleSelected ? formData.selectedFemaleWeights : [],
                ...(formData.mixedTeams ? { mixed: [TEAMS_CATEGORY] } : {}),
            },
            scoring_configuration: scoringConfig
        };

        if (!initialData) localStorage.removeItem('tournamentCreationDraft');

        (onProceedToBracket ?? onProceedToRoster)(tournamentForBuilder);

    } catch (error: any) {
        console.error("Error saving rules:", error);
        showToast('error', "Error saving scoring rules: " + error.message);
    } finally { setIsNavigating(false); }
  };

  // --- RENDER COMPONENTS ---

  const Switch = ({ checked, onChange, onClick }: { checked: boolean, onChange: () => void, onClick?: (e: any) => void }) => (
    <button 
      onClick={(e) => {
          if(onClick) onClick(e);
          onChange();
      }}
      className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out flex items-center ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`}></div>
    </button>
  );

  const renderStep1 = () => {
    // Validate Step 1 State
    const isDateValid = formData.date >= today && formData.date <= nextYear;
    const isNameValid = formData.name.trim().length > 0;
    const isCategoryValid = formData.maleSelected || formData.femaleSelected || formData.mixedTeams;
    const isEndDateValid = !formData.endDate || !formData.date || formData.endDate >= formData.date;
    const canProceed = isNameValid && isDateValid && isEndDateValid && isCategoryValid;
    const days = dayCount(formData.date, formData.endDate);
    const dayCategories = desiredCategories();
    const setDay = (name: string, value: string) =>
        setFormData(prev => ({ ...prev, categoryDays: { ...prev.categoryDays, [name]: value ? Number(value) : null } }));

    return (
    <div className="animate-in fade-in slide-in-from-right duration-300 w-full max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-zen border border-slate-100 p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-slate-900 text-white rounded-xl shadow-lg shadow-slate-900/20">
                    <Sliders size={24} />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-slate-900">Step 1: Basic Information</h3>
                    <p className="text-sm text-slate-500">Define name, date, and categories.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                 <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Event Name <span className="text-red-500">*</span></label>
                    <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full h-11 px-4 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none font-medium" placeholder="e.g. Grand Slam Tokyo 2024" />
                 </div>
                 <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Start Date <span className="text-red-500">*</span></label>
                    <input 
                        type="date" 
                        value={formData.date} 
                        onChange={(e) => setFormData({...formData, date: e.target.value})} 
                        className={`w-full h-11 px-4 rounded-lg border bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none font-medium cursor-pointer ${
                            !isDateValid && formData.date !== '' ? 'border-red-300 focus:ring-red-200' : 'border-slate-200'
                        }`}
                        min={today}
                        max={nextYear}
                    />
                    {!isDateValid && formData.date !== '' && (
                        <p className="text-xs text-red-500 font-bold mt-1">Date must be between {today} and {nextYear}</p>
                    )}
                 </div>
                 <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">End Date <span className="text-slate-400 normal-case font-medium">(optional)</span></label>
                    <input
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                        className={`w-full h-11 px-4 rounded-lg border bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 outline-none font-medium cursor-pointer ${
                            !isEndDateValid ? 'border-red-300 focus:ring-red-200' : 'border-slate-200'
                        }`}
                        min={formData.date || today}
                    />
                    {!isEndDateValid && (
                        <p className="text-xs text-red-500 font-bold mt-1">End date must be on or after the start date</p>
                    )}
                 </div>
            </div>

            <div className="w-full h-px bg-slate-100 mb-8"></div>
            
             <div className="flex flex-col gap-6">
                 <div className="flex justify-between items-center mb-1">
                    <label className="text-sm font-bold text-slate-900 flex items-center gap-2"><Tag size={16} className="text-blue-600" /> Weight Categories</label>
                    
                    <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600"><input type="checkbox" checked={formData.maleSelected} onChange={(e) => setFormData({...formData, maleSelected: e.target.checked})} className="rounded text-blue-600" /> Male</label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600"><input type="checkbox" checked={formData.femaleSelected} onChange={(e) => setFormData({...formData, femaleSelected: e.target.checked})} className="rounded text-blue-600" /> Female</label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                            <input
                                type="checkbox"
                                checked={formData.mixedTeams}
                                onChange={(e) => {
                                    if (!e.target.checked && lockedCategories.includes(TEAMS_CATEGORY)) {
                                        showToast('warning', `${TEAMS_CATEGORY} has locked or closed picks and cannot be removed.`);
                                        return;
                                    }
                                    setFormData({...formData, mixedTeams: e.target.checked});
                                }}
                                className="rounded text-purple-600"
                            /> Mixed Teams
                        </label>
                    </div>
                 </div>

                 {/* Male Weights */}
                 <div className={`space-y-3 transition-opacity duration-200 ${formData.maleSelected ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                    <div className="flex flex-wrap gap-2">
                        {MALE_WEIGHTS.map(w => (
                            <button
                                key={w}
                                onClick={() => toggleWeight(w, true)}
                                title={lockedCategories.includes(w) ? 'Picks locked or closed' : undefined}
                                className={`px-2.5 py-1.5 rounded-md text-xs font-bold border transition-all inline-flex items-center gap-1 ${
                                    formData.selectedMaleWeights.includes(w)
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white'
                                }`}
                            >
                                {lockedCategories.includes(w) && <Lock size={10} />}
                                {w}
                            </button>
                        ))}
                    </div>
                 </div>

                 {/* Female Weights */}
                 <div className={`space-y-3 transition-opacity duration-200 ${formData.femaleSelected ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                    <div className="flex flex-wrap gap-2">
                        {FEMALE_WEIGHTS.map(w => (
                            <button
                                key={w}
                                onClick={() => toggleWeight(w, false)}
                                title={lockedCategories.includes(w) ? 'Picks locked or closed' : undefined}
                                className={`px-2.5 py-1.5 rounded-md text-xs font-bold border transition-all inline-flex items-center gap-1 ${
                                    formData.selectedFemaleWeights.includes(w)
                                        ? 'bg-pink-600 text-white border-pink-600'
                                        : 'bg-white'
                                }`}
                            >
                                {lockedCategories.includes(w) && <Lock size={10} />}
                                {w}
                            </button>
                        ))}
                    </div>
                 </div>

                 {/* Competition day per category */}
                 {dayCategories.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-slate-900">Competition Day</label>
                            <span className="text-xs text-slate-400">{days} day{days === 1 ? '' : 's'}{formData.endDate ? '' : ' (set an end date to change)'}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {dayCategories.map(c => (
                                <label key={c.name} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50 text-sm">
                                    <span className={`font-semibold truncate ${c.gender === 'Male' ? 'text-blue-700' : c.gender === 'Female' ? 'text-pink-700' : 'text-purple-700'}`}>{c.name}</span>
                                    <select
                                        value={c.day ?? ''}
                                        onChange={(e) => setDay(c.name, e.target.value)}
                                        className="border border-slate-200 rounded-md px-1.5 py-1 text-sm bg-white"
                                    >
                                        <option value="">—</option>
                                        {Array.from({ length: days }, (_, i) => i + 1).map(d => (
                                            <option key={d} value={d}>Day {d}</option>
                                        ))}
                                    </select>
                                </label>
                            ))}
                        </div>
                    </div>
                 )}
            </div>
        </div>
        <div className="mt-6 flex justify-end">
            <Button 
                onClick={handleStep1Save} 
                isLoading={isNavigating} 
                icon={ArrowRight} 
                size="lg"
                disabled={!canProceed || isNavigating}
                className={!canProceed ? "opacity-50 cursor-not-allowed grayscale" : ""}
            >
                Next: Rules
            </Button>
        </div>
    </div>
  );
  };

  const renderStep2 = () => (
      <div className="animate-in fade-in slide-in-from-right duration-300 w-full max-w-3xl mx-auto pb-20">
          
          <div className="mb-8 text-center">
              <h2 className="text-2xl font-black text-slate-900">Scoring Rules</h2>
              <p className="text-slate-500">Configure points for each category.</p>
          </div>

          <div className="space-y-4">
              {RULE_GROUPS.map((group) => {
                  const isEnabled = isGroupEnabled(group.id);
                  const isExpanded = expandedGroups.includes(group.id);
                  const Icon = group.icon;

                  // Rules that belong to this group
                  const groupRules = formData.scoringRules.filter(r => group.ruleIds.includes(r.id));

                  return (
                      <div 
                        key={group.id} 
                        className={`bg-white rounded-xl shadow-zen border transition-all duration-300 overflow-hidden ${isEnabled ? 'border-slate-200 opacity-100' : 'border-slate-100 opacity-70'}`}
                      >
                          {/* Header / Accordion Trigger */}
                          <div 
                            className={`p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded && isEnabled ? 'bg-slate-50 border-b border-slate-100' : ''}`}
                            onClick={() => toggleGroupExpansion(group.id)}
                          >
                              <div className="flex items-center gap-4">
                                  <div className={`p-2.5 rounded-lg ${isEnabled ? group.bgColor + ' ' + group.color : 'bg-slate-100 text-slate-400'}`}>
                                      <Icon size={20} />
                                  </div>
                                  <span className={`font-bold text-lg ${isEnabled ? 'text-slate-900' : 'text-slate-400'}`}>
                                      {group.title}
                                  </span>
                              </div>

                              <div className="flex items-center gap-4">
                                  {/* Master Switch - Stop Propagation to prevent accordion toggle when clicking switch */}
                                  <div onClick={(e) => e.stopPropagation()}>
                                    <Switch 
                                        checked={isEnabled} 
                                        onChange={() => toggleCategoryMaster(group.id, !isEnabled)} 
                                    />
                                  </div>
                                  
                                  <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
                                      <ChevronDown size={20} className="text-slate-400" />
                                  </div>
                              </div>
                          </div>

                          {/* Accordion Body */}
                          <div 
                            className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded && isEnabled ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}
                          >
                              <div className="p-4 space-y-3 bg-slate-50/30">
                                  {groupRules.map(rule => (
                                      <div key={rule.id} className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                          <div className="flex-1">
                                              <p className="font-bold text-sm text-slate-800">{rule.label}</p>
                                              <p className="text-xs text-slate-400">{rule.description}</p>
                                          </div>
                                          
                                          {/* Points Input */}
                                          <div className="flex items-center gap-2">
                                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pts</span>
                                              <input 
                                                  type="number" 
                                                  value={rule.defaultPoints} 
                                                  onChange={(e) => updateRulePoints(rule.id, parseInt(e.target.value) || 0)}
                                                  className="w-20 h-10 px-2 text-center font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                              />
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>
                  );
              })}
          </div>

          {/* Repechage Toggle */}
          <div className="mt-6 bg-white rounded-xl shadow-zen border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                      <div className="p-2.5 rounded-lg bg-orange-50 text-orange-600">
                          <Award size={20} />
                      </div>
                      <div>
                          <span className="font-bold text-lg text-slate-900">Repechage Bracket</span>
                          <p className="text-xs text-slate-400 mt-0.5">
                              IJF quarter-final repechage with 2 bronze medal matches (cross-over system).
                          </p>
                      </div>
                  </div>
                  <Switch
                      checked={formData.hasRepechage}
                      onChange={() => setFormData(prev => ({ ...prev, hasRepechage: !prev.hasRepechage }))}
                  />
              </div>
          </div>

          <div className="mt-8 flex justify-between items-center sticky bottom-4 bg-white/80 backdrop-blur-md p-4 rounded-xl border border-slate-200 shadow-2xl z-20">
              <Button onClick={handleBack} variant="secondary" icon={ArrowLeft}>Back</Button>
              <Button 
                onClick={handleSaveAndProceed}
                isLoading={isNavigating}
                icon={isNavigating ? undefined : Save}
                size="lg"
                className="min-w-[200px]"
                disabled={isNavigating}
              >
                {isNavigating ? 'Saving...' : (onProceedToBracket ? 'Save & Build Brackets' : 'Save & Manage Roster')}
              </Button>
          </div>
      </div>
  );

  return (
    <div className="flex-1 flex flex-col w-full h-full overflow-y-auto bg-slate-50">
      <main className="flex-1 flex flex-col items-center w-full px-4 md:px-8 py-8">
        <div className="w-full max-w-4xl mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="hover:text-blue-600 cursor-pointer" onClick={() => onNavigate('HOME')}>Home</span>
              <ChevronRight size={14} />
              <span className="text-slate-900 font-medium">
                {isEditing ? `Edit: ${initialData.name}` : 'Create New'}
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
                {isEditing ? 'Tournament Editor' : 'Tournament Creator'}
            </h1>
          </div>
          <Button onClick={() => onNavigate('HOME')} variant="secondary">Cancel</Button>
        </div>
        
        {step === 1 ? renderStep1() : renderStep2()}
        
      </main>
    </div>
  );
};

export default AdminDashboard;
