import React, { useState, useEffect } from 'react';
import { ViewState, Tournament } from '../types';
import { ArrowLeft, Save, FileUp, CheckCircle, Upload, Loader2, X, Plus, Trash2, ArrowLeftRight, ChevronDown, AlertTriangle, PenLine } from 'lucide-react';
import Flag from '../components/ui/Flag';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { getBracketParticipantCount } from '../lib/bracketUtils';

interface BuildBracketProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
}

import { GoogleGenAI, Type } from '@google/genai';

// --- Types ---
interface ExtractedCompetitor {
  name: string;
  country: string;
}

interface ExtractedMatch {
  matchNumber: number;
  competitor1: ExtractedCompetitor | null;
  competitor2: ExtractedCompetitor | null;
}

interface ExtractedCategory {
  weight: string;
  participantCount: number;
  matches: ExtractedMatch[];
}

// --- PDF helpers ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

const buildGeminiPrompt = (singleCategory?: string) => {
  if (singleCategory) {
    return `Extract the tournament bracket from this Judo draw PDF.
This PDF contains ONLY the weight category: ${singleCategory}. All matches belong to this single category.
Return a JSON array with exactly ONE object representing this weight category.
Provide the 'weight' (e.g., '${singleCategory}') and an array of 'matches' for the FIRST ROUND ONLY.
The matches MUST be in the exact visual order they appear in the PDF (top to bottom, Pool A, then B, then C, then D).

CRITICAL RULES:
- Set 'weight' to exactly: "${singleCategory}"
- If the category header shows a participant count in parentheses (e.g. "Seniors (32)"), set 'participant_count' to that integer.
- For each first-round match, include 'pdf_match_number' as the small integer printed next to that match (1, 2, 3, ...).
- Each match has 'competitor1' (top athlete) and 'competitor2' (bottom athlete). Either may be null for a BYE.
- If a competitor has a BYE, 'competitor2' MUST be null. Do NOT duplicate competitor1 into competitor2.
- Extract 'name' (LAST NAME First Name) and 'country' (3-letter IOC code).
- Extract EVERY first-round match, including those with empty slots.
- Do not hallucinate matches or competitors. Only extract what is visible.`;
  }

  return `Extract the tournament bracket from this Judo draw PDF.
Return a JSON array of objects, where each object represents a weight category found in the PDF.
For each weight category, provide the 'weight' (e.g., '-100kg') and an array of 'matches' for the FIRST ROUND ONLY.
The matches MUST be in the exact visual order they appear in the PDF (top to bottom, which corresponds to Pool A, then B, then C, then D).

CRITICAL RULES:
- If the category header shows a participant count in parentheses (e.g. "Seniors (32)", "(16 athletes)", "32"), set 'participant_count' to that integer. This is required to build the full first round (e.g. 32 athletes => 16 first-round matches).
- For each first-round match, include 'pdf_match_number' as the small integer printed next to that match on the draw (1, 2, 3, ...). If not visible, omit it.
- Each match has 'competitor1' and 'competitor2' (either may be null for a BYE or empty slot).
- 'competitor1' is always the top athlete in the pair.
- If a competitor has a BYE (no opponent, empty slot, or the line is blank), 'competitor2' MUST be null. Do NOT duplicate competitor1 into competitor2.
- A BYE means one side of the match is empty. Never repeat the same athlete on both sides.
- For each competitor, extract their 'name' (LAST NAME First Name) and 'country' (3-letter IOC code: e.g. BRN=Bahrain, BRA=Brazil — never confuse similar codes).
- Extract EVERY first-round match shown in the draw, including matches with empty slots. Do not skip the last match in a pool.
- Do not hallucinate matches or competitors. Only extract what is visible in the PDF.`;
};

const extractBracketFromPDF = async (file: File, singleCategory?: string) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .env.local and restart the server.");
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log("[Draw Reader] Converting PDF to base64...");
  const base64Data = await fileToBase64(file);
  console.log(`[Draw Reader] PDF converted (${(base64Data.length / 1024 / 1024).toFixed(2)} MB base64)`);

  const prompt = buildGeminiPrompt(singleCategory);

  const models = ["gemini-2.5-flash-lite"];
  const maxRetries = 3;
  const contentParts = [
    { inlineData: { mimeType: "application/pdf", data: base64Data } },
    prompt,
  ];
  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        weight: { type: Type.STRING },
        participant_count: { type: Type.INTEGER, nullable: true },
        matches: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pdf_match_number: { type: Type.INTEGER, nullable: true },
              competitor1: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                  name: { type: Type.STRING },
                  country: { type: Type.STRING },
                },
              },
              competitor2: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                  name: { type: Type.STRING },
                  country: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    },
  };

  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Draw Reader] Attempt ${attempt}/${maxRetries} with model ${model}...`);

        const response = await ai.models.generateContent({
          model,
          contents: contentParts,
          config: {
            httpOptions: { timeout: 120_000 },
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
            responseJsonSchema: schema,
          },
        });

        console.log("[Draw Reader] Response received from Gemini");

        const responseText = response.text;
        if (!responseText) {
          throw new Error("Gemini returned an empty response. Try a different PDF.");
        }

        console.log("[Draw Reader] First 300 chars:", responseText.substring(0, 300));

        const parsed = JSON.parse(responseText);
        console.log(`[Draw Reader] Categories extracted: ${parsed.length}`);
        return parsed;

      } catch (err: any) {
        lastError = err;
        const is503 = err?.message?.includes("503") || err?.message?.includes("UNAVAILABLE") || err?.message?.includes("high demand");
        console.warn(`[Draw Reader] Error on attempt ${attempt} with ${model}:`, err?.message?.substring(0, 150));

        if (!is503) throw err;

        if (attempt < maxRetries) {
          const waitSec = attempt * 3;
          console.log(`[Draw Reader] Waiting ${waitSec}s before retry...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
        }
      }
    }
  }

  throw lastError || new Error("Could not connect to the Gemini API after multiple attempts.");
};

function padAndOrderR1Matches(categoryData: any): ExtractedMatch[] {
  const raw: any[] = [...(categoryData.matches || [])];
  const pcRaw = categoryData.participant_count ?? categoryData.participants;
  const participantCount =
    typeof pcRaw === 'number' ? pcRaw : typeof pcRaw === 'string' ? parseInt(pcRaw, 10) : NaN;
  const validPc = Number.isFinite(participantCount) && participantCount > 0 ? participantCount : 0;

  const pdfNums = raw
    .map((m) => (typeof m.pdf_match_number === 'number' ? m.pdf_match_number : 0))
    .filter((n) => n > 0);
  const maxPdf = pdfNums.length > 0 ? Math.max(...pdfNums) : 0;

  let athleteTarget: number;
  if (validPc > 0) {
    athleteTarget = validPc;
  } else {
    athleteTarget = Math.max(raw.length * 2, maxPdf * 2, 2);
  }

  const bracketFieldSize = getBracketParticipantCount(athleteTarget);
  const expectedR1 = bracketFieldSize / 2;

  if (expectedR1 <= 0) {
    return raw.map((m, i) => ({
      matchNumber: i + 1,
      competitor1: m.competitor1 ? { name: m.competitor1.name, country: m.competitor1.country } : null,
      competitor2: m.competitor2 ? { name: m.competitor2.name, country: m.competitor2.country } : null,
    }));
  }

  const bySlot = new Map<number, any>();
  raw.forEach((m, i) => {
    const slot =
      typeof m.pdf_match_number === 'number' && m.pdf_match_number > 0
        ? m.pdf_match_number
        : i + 1;
    if (!bySlot.has(slot)) bySlot.set(slot, m);
  });

  const out: ExtractedMatch[] = [];
  for (let slot = 1; slot <= expectedR1; slot++) {
    const existing = bySlot.get(slot);
    if (existing) {
      const c1 = existing.competitor1 ? { name: existing.competitor1.name, country: existing.competitor1.country } : null;
      let c2 = existing.competitor2 ? { name: existing.competitor2.name, country: existing.competitor2.country } : null;
      // Deduplicate: if both slots same athlete, set c2 to null
      if (c1 && c2 && c1.name === c2.name && c1.country === c2.country) c2 = null;
      out.push({ matchNumber: slot, competitor1: c1, competitor2: c2 });
    } else {
      out.push({ matchNumber: slot, competitor1: null, competitor2: null });
    }
  }
  return out;
}

// --- Per-category upload state ---
interface CategoryUploadState {
  file: File | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  error?: string;
}

// --- Review UI helpers ---
const CountryInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder = 'XXX' }) => (
  <input
    type="text"
    maxLength={3}
    value={value}
    onChange={e => onChange(e.target.value.toUpperCase())}
    placeholder={placeholder}
    className="w-14 px-1.5 py-1 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-white uppercase text-center"
  />
);

const NameInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <input
    type="text"
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder="LAST First"
    className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-white"
  />
);

// --- Main component ---
const BuildBracket: React.FC<BuildBracketProps> = ({ onNavigate, tournament }) => {
  // Upload modes: 'single' = one PDF for all categories, 'per-category' = one PDF per category, 'manual' = no PDF
  const [uploadMode, setUploadMode] = useState<'single' | 'per-category' | 'manual'>('single');

  // Single PDF mode
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Per-category mode
  const [categoryUploads, setCategoryUploads] = useState<Record<string, CategoryUploadState>>({});

  // Review mode
  const [mode, setMode] = useState<'upload' | 'review'>('upload');
  const [extractedCategories, setExtractedCategories] = useState<ExtractedCategory[]>([]);
  const [selectedReviewCategory, setSelectedReviewCategory] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Manual mode roster
  const [rosterByCategory, setRosterByCategory] = useState<Record<string, { name: string; country: string }[]>>({});
  const [selectedManualCategory, setSelectedManualCategory] = useState<string>('');

  const allConfiguredCategories = [
    ...(tournament?.categories?.male || []).map(w => ({ weight: w, gender: 'Male' })),
    ...(tournament?.categories?.female || []).map(w => ({ weight: w, gender: 'Female' })),
  ];

  // Initialize per-category upload state when tournament loads
  useEffect(() => {
    if (allConfiguredCategories.length > 0) {
      const init: Record<string, CategoryUploadState> = {};
      allConfiguredCategories.forEach(c => {
        init[c.weight] = { file: null, status: 'idle' };
      });
      setCategoryUploads(prev => {
        const merged = { ...init };
        Object.keys(prev).forEach(k => { if (merged[k]) merged[k] = prev[k]; });
        return merged;
      });
    }
  }, [tournament?.id]);

  // Set initial manual category
  useEffect(() => {
    if (allConfiguredCategories.length > 0 && !selectedManualCategory) {
      setSelectedManualCategory(allConfiguredCategories[0].weight);
    }
  }, [tournament?.id]);

  // Fetch roster for manual mode
  useEffect(() => {
    if (uploadMode !== 'manual' || !tournament?.id) return;
    const fetchRoster = async () => {
      const { data } = await supabase
        .from('tournament_roster')
        .select('first_name, last_name, country, weight_category')
        .eq('tournament_id', tournament.id);
      if (!data) return;
      const grouped: Record<string, { name: string; country: string }[]> = {};
      data.forEach((r: any) => {
        const w = r.weight_category;
        if (!grouped[w]) grouped[w] = [];
        grouped[w].push({ name: `${r.last_name} ${r.first_name}`.trim(), country: r.country });
      });
      setRosterByCategory(grouped);
    };
    fetchRoster();
  }, [uploadMode, tournament?.id]);

  // --- Process single PDF ---
  const handleProcessSinglePDF = async () => {
    if (!singleFile) return alert("Please upload a PDF first.");
    if (!tournament) return alert("No tournament selected.");

    setIsProcessing(true);
    try {
      const tournamentIdNum = parseInt(String(tournament.id), 10);
      if (!Number.isFinite(tournamentIdNum) || tournamentIdNum <= 0) {
        alert('Invalid tournament ID. Select the tournament again and retry.');
        return;
      }

      console.log("[Draw Reader] Extracting brackets from PDF with Gemini...");
      const extractedData = await extractBracketFromPDF(singleFile);

      const configuredWeights = allConfiguredCategories.map(c => c.weight);
      const normalizeWeight = (s: string) =>
        s.toLowerCase().replace(/\s+/g, '').replace(/^(men'?s?|women'?s?|male|female)/i, '');

      const filteredData = configuredWeights.length > 0
        ? extractedData.filter((cat: any) => {
            const pdfNorm = normalizeWeight(cat.weight || '');
            return configuredWeights.some(w => normalizeWeight(w) === pdfNorm
              || pdfNorm.includes(normalizeWeight(w))
              || normalizeWeight(w).includes(pdfNorm));
          })
        : extractedData;

      if (filteredData.length === 0) {
        const pdfCats = extractedData.map((c: any) => c.weight).join(', ');
        const confCats = configuredWeights.join(', ');
        alert(`No matching categories found.\nPDF has: ${pdfCats}\nTournament expects: ${confCats}`);
        return;
      }

      const categories: ExtractedCategory[] = filteredData.map((cat: any) => ({
        weight: cat.weight,
        participantCount: cat.participant_count || 0,
        matches: padAndOrderR1Matches(cat),
      }));

      setExtractedCategories(categories);
      setSelectedReviewCategory(categories[0]?.weight || '');
      setMode('review');
    } catch (error: any) {
      alert("Error processing PDF: " + (error?.message || String(error)));
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Process per-category PDFs ---
  const handleProcessCategoryPDF = async (weight: string) => {
    const uploadState = categoryUploads[weight];
    if (!uploadState?.file) return;
    if (!tournament) return;

    setCategoryUploads(prev => ({ ...prev, [weight]: { ...prev[weight], status: 'processing' } }));
    try {
      const extracted = await extractBracketFromPDF(uploadState.file, weight);
      const catData = extracted[0]; // single-category mode returns array with 1 item
      if (!catData) throw new Error('No data extracted');

      const matches = padAndOrderR1Matches({ ...catData, weight });
      const newCat: ExtractedCategory = {
        weight,
        participantCount: catData.participant_count || 0,
        matches,
      };

      setExtractedCategories(prev => {
        const filtered = prev.filter(c => c.weight !== weight);
        return [...filtered, newCat];
      });

      setCategoryUploads(prev => ({ ...prev, [weight]: { ...prev[weight], status: 'done' } }));
    } catch (err: any) {
      setCategoryUploads(prev => ({ ...prev, [weight]: { ...prev[weight], status: 'error', error: err.message } }));
    }
  };

  // Enter review from per-category uploads
  const handleReviewPerCategory = () => {
    if (extractedCategories.length === 0) {
      alert('Upload and process at least one category PDF first.');
      return;
    }
    setSelectedReviewCategory(extractedCategories[0]?.weight || '');
    setMode('review');
  };

  // Enter review from manual mode
  const handleStartManualBracket = () => {
    if (allConfiguredCategories.length === 0) {
      alert('No categories configured for this tournament.');
      return;
    }
    // Build empty match structure from roster counts
    const categories: ExtractedCategory[] = allConfiguredCategories.map(c => {
      const rosterAthletes = rosterByCategory[c.weight] || [];
      const fieldSize = getBracketParticipantCount(Math.max(rosterAthletes.length, 2));
      const matchCount = fieldSize / 2;
      const matches: ExtractedMatch[] = Array.from({ length: matchCount }, (_, i) => ({
        matchNumber: i + 1,
        competitor1: rosterAthletes[i * 2] || null,
        competitor2: rosterAthletes[i * 2 + 1] || null,
      }));
      return { weight: c.weight, participantCount: rosterAthletes.length, matches };
    });
    setExtractedCategories(categories);
    setSelectedReviewCategory(categories[0]?.weight || '');
    setMode('review');
  };

  // --- Save reviewed brackets to DB ---
  const handleSaveReviewedBrackets = async () => {
    if (!tournament) return;
    setIsSaving(true);
    try {
      const tournamentIdNum = parseInt(String(tournament.id), 10);
      if (!Number.isFinite(tournamentIdNum) || tournamentIdNum <= 0) {
        alert('Invalid tournament ID.');
        return;
      }

      const matchesToInsert: any[] = [];

      for (const cat of extractedCategories) {
        let categoryMatchIndex = 1;
        for (const match of cat.matches) {
          matchesToInsert.push({
            tournament_id: tournamentIdNum,
            match_number: categoryMatchIndex++,
            weight_category: cat.weight,
            competitor_1: null,
            competitor_2: null,
            bracket_data: {
              competitor1: match.competitor1 ? { name: match.competitor1.name, country: match.competitor1.country } : null,
              competitor2: match.competitor2 ? { name: match.competitor2.name, country: match.competitor2.country } : null,
            },
          });
        }
      }

      await supabase.from('competition_brackets').delete().eq('tournament_id', tournamentIdNum);
      if (matchesToInsert.length > 0) {
        const { error } = await supabase.from('competition_brackets').insert(matchesToInsert);
        if (error) throw error;
      }

      await supabase.from('tournaments').update({ status: 'upcoming' }).eq('id', tournamentIdNum);

      alert(`Brackets saved! ${matchesToInsert.length} matches across ${extractedCategories.length} categories.`);
      onNavigate('BRACKET');
    } catch (error: any) {
      alert("Error saving brackets: " + (error?.message || String(error)));
    } finally {
      setIsSaving(false);
    }
  };

  // --- Review editing helpers ---
  const updateCompetitor = (
    categoryWeight: string,
    matchIndex: number,
    slot: 'competitor1' | 'competitor2',
    field: 'name' | 'country',
    value: string
  ) => {
    setExtractedCategories(prev => prev.map(cat => {
      if (cat.weight !== categoryWeight) return cat;
      const matches = cat.matches.map((m, i) => {
        if (i !== matchIndex) return m;
        const existing = m[slot] || { name: '', country: '' };
        return { ...m, [slot]: { ...existing, [field]: value } };
      });
      return { ...cat, matches };
    }));
  };

  const clearSlot = (categoryWeight: string, matchIndex: number, slot: 'competitor1' | 'competitor2') => {
    setExtractedCategories(prev => prev.map(cat => {
      if (cat.weight !== categoryWeight) return cat;
      const matches = cat.matches.map((m, i) => {
        if (i !== matchIndex) return m;
        return { ...m, [slot]: null };
      });
      return { ...cat, matches };
    }));
  };

  const swapCompetitors = (categoryWeight: string, matchIndex: number) => {
    setExtractedCategories(prev => prev.map(cat => {
      if (cat.weight !== categoryWeight) return cat;
      const matches = cat.matches.map((m, i) => {
        if (i !== matchIndex) return m;
        return { ...m, competitor1: m.competitor2, competitor2: m.competitor1 };
      });
      return { ...cat, matches };
    }));
  };

  const deleteMatch = (categoryWeight: string, matchIndex: number) => {
    setExtractedCategories(prev => prev.map(cat => {
      if (cat.weight !== categoryWeight) return cat;
      const matches = cat.matches.filter((_, i) => i !== matchIndex).map((m, i) => ({ ...m, matchNumber: i + 1 }));
      return { ...cat, matches };
    }));
  };

  const addMatch = (categoryWeight: string) => {
    setExtractedCategories(prev => prev.map(cat => {
      if (cat.weight !== categoryWeight) return cat;
      const newMatch: ExtractedMatch = {
        matchNumber: cat.matches.length + 1,
        competitor1: null,
        competitor2: null,
      };
      return { ...cat, matches: [...cat.matches, newMatch] };
    }));
  };

  // --- Render: Review mode ---
  if (mode === 'review') {
    const currentCat = extractedCategories.find(c => c.weight === selectedReviewCategory);
    const athleteCount = currentCat ? currentCat.matches.reduce((acc, m) => {
      if (m.competitor1?.name) acc++;
      if (m.competitor2?.name) acc++;
      return acc;
    }, 0) : 0;
    const byeCount = currentCat ? currentCat.matches.reduce((acc, m) => {
      if (!m.competitor1 || !m.competitor1.name) acc++;
      if (!m.competitor2 || !m.competitor2.name) acc++;
      return acc;
    }, 0) : 0;

    return (
      <div className="flex flex-col h-full bg-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-white px-6 py-4 shadow-sm border-b border-slate-200 z-10 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (confirm('Discard extracted data and go back to upload?')) {
                  setMode('upload');
                  setExtractedCategories([]);
                }
              }}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Review & Edit Brackets</h1>
              <p className="text-sm text-slate-500">Verify extraction, fix errors, add missing athletes, then save.</p>
            </div>
          </div>
          <Button
            onClick={handleSaveReviewedBrackets}
            disabled={isSaving || extractedCategories.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white"
            icon={isSaving ? Loader2 : Save}
          >
            {isSaving ? 'Saving...' : 'Confirm & Save All'}
          </Button>
        </div>

        {/* Category tabs */}
        <div className="bg-white border-b border-slate-200 px-6 flex gap-1 overflow-x-auto">
          {extractedCategories.map(cat => {
            const count = cat.matches.reduce((acc, m) => {
              if (m.competitor1?.name) acc++;
              if (m.competitor2?.name) acc++;
              return acc;
            }, 0);
            return (
              <button
                key={cat.weight}
                onClick={() => setSelectedReviewCategory(cat.weight)}
                className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-colors ${
                  selectedReviewCategory === cat.weight
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {cat.weight}
                <span className="ml-1.5 text-xs font-normal opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Summary bar */}
        {currentCat && (
          <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 flex items-center gap-6 text-xs text-blue-700">
            <span><strong>{currentCat.matches.length}</strong> matches</span>
            <span><strong>{athleteCount}</strong> athletes</span>
            {byeCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle size={12} />
                <strong>{byeCount}</strong> empty slots (BYEs)
              </span>
            )}
          </div>
        )}

        {/* Match table */}
        <div className="flex-1 overflow-auto p-6">
          {currentCat ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-3 w-12 text-center">#</th>
                    <th className="px-4 py-3">Competitor 1 (Top)</th>
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3">Competitor 2 (Bottom)</th>
                    <th className="px-4 py-3 w-16 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentCat.matches.map((match, matchIdx) => (
                    <tr key={matchIdx} className="hover:bg-slate-50 group">
                      <td className="px-4 py-2 text-center font-mono text-slate-400 text-xs">{match.matchNumber}</td>

                      {/* Competitor 1 */}
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {match.competitor1?.country ? (
                            <Flag countryCode={match.competitor1.country} className="w-5 h-3.5 shrink-0" />
                          ) : (
                            <div className="w-5 h-3.5 bg-slate-100 rounded shrink-0" />
                          )}
                          <NameInput
                            value={match.competitor1?.name || ''}
                            onChange={v => updateCompetitor(currentCat.weight, matchIdx, 'competitor1', 'name', v)}
                          />
                          <CountryInput
                            value={match.competitor1?.country || ''}
                            onChange={v => updateCompetitor(currentCat.weight, matchIdx, 'competitor1', 'country', v)}
                          />
                          {match.competitor1?.name && (
                            <button
                              onClick={() => clearSlot(currentCat.weight, matchIdx, 'competitor1')}
                              className="text-slate-300 hover:text-red-400 transition-colors shrink-0"
                              title="Clear slot"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Swap button */}
                      <td className="px-1 py-2 text-center">
                        <button
                          onClick={() => swapCompetitors(currentCat.weight, matchIdx)}
                          className="p-1 text-slate-300 hover:text-blue-500 transition-colors rounded"
                          title="Swap competitors"
                        >
                          <ArrowLeftRight size={14} />
                        </button>
                      </td>

                      {/* Competitor 2 */}
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {match.competitor2?.country ? (
                            <Flag countryCode={match.competitor2.country} className="w-5 h-3.5 shrink-0" />
                          ) : (
                            <div className="w-5 h-3.5 bg-slate-100 rounded shrink-0" />
                          )}
                          <NameInput
                            value={match.competitor2?.name || ''}
                            onChange={v => updateCompetitor(currentCat.weight, matchIdx, 'competitor2', 'name', v)}
                          />
                          <CountryInput
                            value={match.competitor2?.country || ''}
                            onChange={v => updateCompetitor(currentCat.weight, matchIdx, 'competitor2', 'country', v)}
                          />
                          {match.competitor2?.name && (
                            <button
                              onClick={() => clearSlot(currentCat.weight, matchIdx, 'competitor2')}
                              className="text-slate-300 hover:text-red-400 transition-colors shrink-0"
                              title="Clear slot"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Delete row */}
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => deleteMatch(currentCat.weight, matchIdx)}
                          className="p-1 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Delete match"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Add match row */}
              <div className="px-4 py-3 border-t border-slate-100">
                <button
                  onClick={() => addMatch(currentCat.weight)}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                >
                  <Plus size={16} />
                  Add Match
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-400 py-12">Select a category tab above.</div>
          )}
        </div>
      </div>
    );
  }

  // --- Render: Upload mode ---
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button onClick={() => onNavigate('ROSTER')} className="mb-4 text-blue-600 font-bold flex items-center gap-2">
        <ArrowLeft size={16} /> Back to Roster
      </button>

      <div className="bg-white p-10 rounded-2xl shadow-xl border border-slate-200">
        <h1 className="text-3xl font-black mb-1 text-slate-900">Build Brackets</h1>
        <p className="text-slate-500 mb-8">
          Tournament: <span className="font-bold text-slate-800">{tournament?.name}</span>
        </p>

        {/* Mode selector */}
        <div className="flex gap-3 mb-8">
          {[
            { key: 'single', label: 'Single PDF', desc: 'All categories in one PDF' },
            { key: 'per-category', label: 'Per-Category PDFs', desc: 'One PDF per weight class (recommended)' },
            { key: 'manual', label: 'Build Manually', desc: 'No PDF — select athletes from roster' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setUploadMode(opt.key as any)}
              className={`flex-1 px-4 py-4 rounded-xl border-2 text-left transition-all ${
                uploadMode === opt.key
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className={`font-bold text-sm ${uploadMode === opt.key ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>

        {/* Single PDF mode */}
        {uploadMode === 'single' && (
          <div className="space-y-6">
            <div className="border-4 border-dashed border-purple-200 bg-purple-50 rounded-2xl p-10 text-center relative">
              <input
                type="file"
                accept=".pdf"
                onChange={e => setSingleFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 bg-purple-200 text-purple-600 rounded-full flex items-center justify-center">
                  <FileUp size={32} />
                </div>
                {singleFile ? (
                  <p className="text-green-600 font-bold flex items-center gap-2">
                    <CheckCircle size={20} /> {singleFile.name}
                  </p>
                ) : (
                  <div>
                    <p className="text-purple-900 font-bold">Click or drag PDF here</p>
                    <p className="text-purple-500 text-sm mt-1">Contains all weight categories</p>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
              <strong>Note:</strong> Single PDF mode may mix categories after the 3rd weight class. If you see incorrect athletes, use <strong>Per-Category PDFs</strong> mode instead.
            </div>
            <Button
              onClick={handleProcessSinglePDF}
              disabled={!singleFile || isProcessing}
              className={`w-full py-4 rounded-xl font-black text-lg ${singleFile ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-200 text-slate-400'}`}
              icon={isProcessing ? Loader2 : Upload}
            >
              {isProcessing ? 'Processing PDF...' : 'Analyze & Review Bracket'}
            </Button>
          </div>
        )}

        {/* Per-category mode */}
        {uploadMode === 'per-category' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 mb-4">
              Upload one PDF per weight category. Gemini will extract only that category — this prevents cross-category mixing.
            </p>
            {allConfiguredCategories.length === 0 ? (
              <div className="text-center text-slate-400 py-8">No categories configured for this tournament.</div>
            ) : (
              <>
                {allConfiguredCategories.map(cat => {
                  const state = categoryUploads[cat.weight] || { file: null, status: 'idle' };
                  const isExtracted = extractedCategories.some(e => e.weight === cat.weight);
                  return (
                    <div key={cat.weight} className={`flex items-center gap-4 p-4 rounded-xl border-2 ${
                      isExtracted ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'
                    }`}>
                      <div className="w-20 shrink-0">
                        <span className="font-bold text-slate-700">{cat.weight}</span>
                        <span className={`block text-xs ${cat.gender === 'Male' ? 'text-blue-500' : 'text-pink-500'}`}>{cat.gender}</span>
                      </div>

                      {isExtracted ? (
                        <div className="flex-1 flex items-center gap-2 text-green-700 text-sm font-medium">
                          <CheckCircle size={16} />
                          Extracted ({extractedCategories.find(e => e.weight === cat.weight)?.matches.length} matches)
                        </div>
                      ) : (
                        <label className="flex-1 flex items-center gap-3 cursor-pointer">
                          <div className={`flex-1 px-3 py-2 rounded-lg border text-sm ${state.file ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                            {state.file ? state.file.name : 'Click to select PDF...'}
                          </div>
                          <input
                            type="file"
                            accept=".pdf"
                            className="hidden"
                            onChange={e => {
                              const f = e.target.files?.[0] || null;
                              setCategoryUploads(prev => ({ ...prev, [cat.weight]: { file: f, status: 'idle' } }));
                            }}
                          />
                        </label>
                      )}

                      {!isExtracted && (
                        <Button
                          onClick={() => handleProcessCategoryPDF(cat.weight)}
                          disabled={!state.file || state.status === 'processing'}
                          size="sm"
                          className={state.file ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-200 text-slate-400'}
                          icon={state.status === 'processing' ? Loader2 : Upload}
                        >
                          {state.status === 'processing' ? 'Reading...' : 'Extract'}
                        </Button>
                      )}

                      {state.status === 'error' && (
                        <span className="text-red-500 text-xs">{state.error?.substring(0, 40)}</span>
                      )}
                    </div>
                  );
                })}

                <Button
                  onClick={handleReviewPerCategory}
                  disabled={extractedCategories.length === 0}
                  className={`w-full py-4 mt-4 rounded-xl font-black text-lg ${extractedCategories.length > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-200 text-slate-400'}`}
                  icon={PenLine}
                >
                  Review Extracted Categories ({extractedCategories.length}/{allConfiguredCategories.length})
                </Button>
              </>
            )}
          </div>
        )}

        {/* Manual mode */}
        {uploadMode === 'manual' && (
          <div className="space-y-6">
            <p className="text-sm text-slate-600">
              Build brackets by selecting athletes from your roster. Slots will be pre-filled based on roster order — you can edit everything in the review step.
            </p>

            {allConfiguredCategories.length === 0 ? (
              <div className="text-center text-slate-400 py-8">No categories configured for this tournament.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {allConfiguredCategories.map(cat => {
                    const athletes = rosterByCategory[cat.weight] || [];
                    return (
                      <div key={cat.weight} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
                        <div>
                          <span className="font-bold text-slate-700">{cat.weight}</span>
                          <span className={`ml-2 text-xs ${cat.gender === 'Male' ? 'text-blue-500' : 'text-pink-500'}`}>{cat.gender}</span>
                        </div>
                        <span className="text-sm text-slate-500">{athletes.length} athletes in roster</span>
                      </div>
                    );
                  })}
                </div>

                <Button
                  onClick={handleStartManualBracket}
                  className="w-full py-4 rounded-xl font-black text-lg bg-slate-800 hover:bg-slate-900 text-white"
                  icon={PenLine}
                >
                  Build Brackets Manually
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BuildBracket;
