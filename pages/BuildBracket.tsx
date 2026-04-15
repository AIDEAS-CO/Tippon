import React, { useState } from 'react';
import { ViewState, Tournament } from '../types';
import { ArrowLeft, Save, FileUp, CheckCircle, Upload, Loader2 } from 'lucide-react';
import Flag from '../components/ui/Flag';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import { getBracketParticipantCount } from '../lib/bracketUtils';

interface BuildBracketProps {
  onNavigate: (view: ViewState) => void;
  tournament: Tournament | null;
}

import { GoogleGenAI, Type } from '@google/genai';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data:application/pdf;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

const extractBracketFromPDF = async (file: File, roster: any[]) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .env.local and restart the server.");
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log("[Draw Reader] Converting PDF to base64...");
  const base64Data = await fileToBase64(file);
  console.log(`[Draw Reader] PDF converted (${(base64Data.length / 1024 / 1024).toFixed(2)} MB base64)`);

  const prompt = `Extract the tournament bracket from this Judo draw PDF.
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
          console.error("[Draw Reader] Empty response from Gemini:", response);
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
    console.log(`[Draw Reader] Model ${model} exhausted retries, trying next model...`);
  }

  throw lastError || new Error("Could not connect to the Gemini API after multiple attempts.");
};

/**
 * Pad R1 to a full single-elimination field: participant count is rounded up to 2^n
 * (same as UI bracket). Match slots 1..N; empty slots get null competitors.
 */
function padAndOrderR1Matches(categoryData: any): any[] {
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

  if (expectedR1 <= 0) return raw;

  const bySlot = new Map<number, any>();
  raw.forEach((m, i) => {
    const slot =
      typeof m.pdf_match_number === 'number' && m.pdf_match_number > 0
        ? m.pdf_match_number
        : i + 1;
    if (!bySlot.has(slot)) bySlot.set(slot, m);
  });

  const out: any[] = [];
  for (let slot = 1; slot <= expectedR1; slot++) {
    const existing = bySlot.get(slot);
    if (existing) {
      out.push({ ...existing, pdf_match_number: slot });
    } else {
      out.push({
        pdf_match_number: slot,
        competitor1: null,
        competitor2: null,
      });
    }
  }
  return out;
}

// Mock Data from PDF
const mockPoolA = [
  { id: 1, name: 'BEKAURI Lasha', country: 'GEO' },
  { id: 2, name: 'CRET Alex', country: 'ROU' },
  { id: 3, name: 'BOBONOV Davlat', country: 'UZB' },
  { id: 4, name: 'GRIGORIAN Aram', country: 'UAE' },
  { id: 5, name: 'VARAPAYEU Yahor', country: 'BLR' },
  { id: 6, name: 'NYZHNYK Oleksandr', country: 'USA' },
  { id: 7, name: 'KIM Jonghoon', country: 'KOR' },
  { id: 8, name: 'SONG Jiaze', country: 'CHN' },
];
const mockPoolB = [
  { id: 9, name: 'FRONCKOWIAK Marcelo', country: 'BRA' },
  { id: 10, name: 'SIVAN Roy', country: 'ISR' },
  { id: 11, name: 'RASULOV Umar', country: 'TJK' },
  { id: 12, name: 'ALLABERDIEV Ramazon', country: 'UZB' },
  { id: 13, name: 'JABNIASHVILI Giorgi', country: 'GEO' },
  { id: 14, name: 'TSECHOEV Adam', country: 'RUS' },
  { id: 15, name: 'OKADA Riku', country: 'JPN' },
  { id: 16, name: 'NINGTHOUJAM Sheetal Singh', country: 'IND' },
];
const mockPoolC = [
  { id: 17, name: 'MACEDO Rafael', country: 'BRA' },
  { id: 18, name: 'ABAZOV Astemir', country: 'RUS' },
  { id: 19, name: 'MELISOV Daniiar', country: 'KGZ' },
  { id: 20, name: 'ARKABAY Barak', country: 'KAZ' },
  { id: 21, name: 'FATIYEV Murad', country: 'AZE' },
  { id: 22, name: 'VISAN Vlad', country: 'ROU' },
  { id: 23, name: 'BOZOROV Umar', country: 'UZB' },
  { id: 24, name: 'KAWABATA Komei', country: 'JPN' },
];
const mockPoolD = [
  { id: 25, name: 'TSELIDIS Theodoros', country: 'GRE' },
  { id: 26, name: 'KARIMZODA Muzamir', country: 'TJK' },
  { id: 27, name: 'SIDORYK Aliaksandr', country: 'BLR' },
  { id: 28, name: 'LENZ Johann', country: 'GER' },
  { id: 29, name: 'SHARIPOV Shakhzodxuja', country: 'UZB' },
  { id: 30, name: 'IVANOV Ivaylo', country: 'BUL' },
  { id: 31, name: 'BU Hebilige', country: 'CHN' },
  { id: 32, name: 'SONG Minki', country: 'KOR' },
];

const PoolBlock = ({ name, athletes, colorClass, startMatchNum }: any) => (
  <div className="flex mb-6 relative w-80">
    <div className={`w-8 flex items-center justify-center rounded-l-lg border border-r-0 border-slate-400 ${colorClass}`}>
      <span className="transform -rotate-90 font-black tracking-widest text-sm whitespace-nowrap">{name}</span>
    </div>
    <div className="flex-1 bg-white rounded-r-lg border border-slate-400 flex flex-col">
      {Array.from({ length: 4 }).map((_, pairIndex) => {
        const a1 = athletes[pairIndex * 2];
        const a2 = athletes[pairIndex * 2 + 1];
        const matchNum = startMatchNum + pairIndex;
        return (
          <div key={pairIndex} className={`flex relative ${pairIndex !== 3 ? 'border-b-2 border-slate-400' : ''}`}>
            <div className="flex-1">
              <div className="flex items-center px-3 py-1.5 border-b border-slate-200 h-8">
                <Flag countryCode={a1.country} className="mr-2 w-5 h-3.5" />
                <span className="font-bold flex-1 text-xs truncate">{a1.name}</span>
                <span className="text-slate-500 text-[10px] font-mono ml-2">{a1.country}</span>
              </div>
              <div className="flex items-center px-3 py-1.5 h-8 bg-slate-50">
                <Flag countryCode={a2.country} className="mr-2 w-5 h-3.5" />
                <span className="font-bold flex-1 text-xs truncate">{a2.name}</span>
                <span className="text-slate-500 text-[10px] font-mono ml-2">{a2.country}</span>
              </div>
            </div>
            {/* Match Number Circle */}
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 bg-slate-100 border border-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold text-slate-600 z-10">
              {matchNum}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const BuildBracket: React.FC<BuildBracketProps> = ({ onNavigate, tournament }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleProcessPDF = async () => {
    if (!file) return alert("Please upload a PDF first.");
    if (!tournament) return alert("No tournament selected.");
    
    setIsProcessing(true);
    
    try {
      // Coerce to integer — FK failures happen if id is missing, wrong type, or tournament was deleted
      const tournamentIdNum = parseInt(String(tournament.id), 10);
      if (!Number.isFinite(tournamentIdNum) || tournamentIdNum <= 0) {
        alert(
          'This event has no valid database ID. Open Tournaments, select your event again, then use "Generate Brackets" from the roster (or the bracket build step) so the app loads a saved tournament.'
        );
        return;
      }

      const { data: tournamentRow, error: tournamentLookupError } = await supabase
        .from('tournaments')
        .select('id')
        .eq('id', tournamentIdNum)
        .maybeSingle();

      if (tournamentLookupError) {
        console.error('[Draw Reader] Tournament lookup failed:', tournamentLookupError);
        alert(
          'Could not verify this tournament: ' + tournamentLookupError.message +
            '\n\nIf you use row-level security, ensure authenticated users can SELECT from `tournaments`.'
        );
        return;
      }
      if (!tournamentRow) {
        alert(
          'This tournament was not found in the database. It may have been deleted, or the page is out of date.\n\nRefresh the app, open the tournament from the list again, then upload the Draw PDF.'
        );
        return;
      }

      console.log("[Draw Reader] Step 1: Extracting brackets from PDF with Gemini...");
      const extractedData = await extractBracketFromPDF(file, []);
      console.log("[Draw Reader] Data extracted:", extractedData?.length, "categories");

      // Filter: only import categories configured for this tournament
      const configuredWeights = [
        ...(tournament.categories?.male || []),
        ...(tournament.categories?.female || []),
      ];
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
        alert(`No matching categories found.\nPDF has: ${pdfCats}\nTournament expects: ${confCats}\nCheck that the correct Draw PDF was uploaded.`);
        return;
      }

      console.log(`[Draw Reader] Filtered to ${filteredData.length}/${extractedData.length} configured categories`);

      const matchesToInsert: any[] = [];

      for (const categoryData of filteredData) {
        const weight = categoryData.weight;
        const matches = padAndOrderR1Matches(categoryData);
        /** Per-category display index: R1 = 1..N, then next category starts at 1 again in the UI (stored as match_number per row within category). */
        let categoryMatchIndex = 1;

        console.log(
          `[Draw Reader]   Category: "${weight}" | ${matches.length} R1 rows (after pad/order; raw had ${(categoryData.matches || []).length})`
        );

        for (const match of matches) {
          const c1 = match.competitor1 || null;
          let c2 = match.competitor2 || null;

          if (c1 && c2 && c1.name === c2.name && c1.country === c2.country) {
            c2 = null;
          }

          matchesToInsert.push({
            tournament_id: tournamentIdNum,
            match_number: categoryMatchIndex++,
            weight_category: weight,
            competitor_1: null,
            competitor_2: null,
            bracket_data: {
              competitor1: c1 ? { name: c1.name, country: c1.country } : null,
              competitor2: c2 ? { name: c2.name, country: c2.country } : null,
            },
          });
        }
      }

      console.log(`[Draw Reader] Step 2: Saving ${matchesToInsert.length} matches to Supabase...`);

      if (matchesToInsert.length > 0) {
        await supabase.from('competition_brackets').delete().eq('tournament_id', tournamentIdNum);
        const { error: insertError } = await supabase.from('competition_brackets').insert(matchesToInsert);
        if (insertError) throw insertError;
      }

      console.log("[Draw Reader] Step 3: Updating tournament status...");
      await supabase.from('tournaments').update({ status: 'upcoming' }).eq('id', tournamentIdNum);

      console.log("[Draw Reader] Complete!");
      alert(`Brackets generated! ${matchesToInsert.length} matches across ${filteredData.length} categories.`);
      onNavigate('BRACKET');

    } catch (error: any) {
      console.error("[Draw Reader] ERROR:", error);
      alert("Error processing PDF: " + (error?.message || String(error)));
    } finally {
      setIsProcessing(false);
    }
  };

  if (showPreview) {
    return (
      <div className="flex flex-col h-full bg-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-white px-6 py-4 shadow-sm border-b border-slate-200 z-10 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => setShowPreview(false)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Bracket Preview</h1>
              <p className="text-sm text-slate-500">Review the PDF extraction before saving</p>
            </div>
          </div>
          <Button onClick={() => onNavigate('ROSTER')} icon={Save} className="bg-green-600 hover:bg-green-700 text-white">
            Save Brackets
          </Button>
        </div>

        {/* Bracket Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="bg-white p-8 rounded-xl shadow-xl border border-slate-200 min-w-max">
            
            {/* PDF Header Replica */}
            <div className="flex justify-between items-center border-b-4 border-slate-900 pb-4 mb-8">
               <div>
                 <h2 className="text-3xl font-black uppercase tracking-tight">{tournament?.name || 'OTP Group Tashkent Grand Slam 2026'}</h2>
                 <p className="text-slate-600 text-lg font-medium">Uzbekistan, Tashkent, 27 Feb - 1 Mar 2026</p>
               </div>
               <div className="text-right border-l-2 border-slate-300 pl-6">
                 <h2 className="text-5xl font-black">-90 kg</h2>
                 <p className="text-slate-600 font-bold text-lg">Seniors (32)</p>
               </div>
            </div>

            {/* Bracket Layout */}
            <div className="flex gap-16 relative">
               {/* Round 1 (Pools) */}
               <div className="flex flex-col gap-4">
                  <PoolBlock name="POOL A" athletes={mockPoolA} colorClass="bg-red-200 text-red-900" startMatchNum={1} />
                  <PoolBlock name="POOL B" athletes={mockPoolB} colorClass="bg-blue-200 text-blue-900" startMatchNum={5} />
                  <PoolBlock name="POOL C" athletes={mockPoolC} colorClass="bg-yellow-200 text-yellow-900" startMatchNum={9} />
                  <PoolBlock name="POOL D" athletes={mockPoolD} colorClass="bg-green-200 text-green-900" startMatchNum={13} />
               </div>
               
               {/* Round 2 (Placeholders) */}
               <div className="flex flex-col justify-around py-8 w-32">
                  {Array.from({length: 8}).map((_, i) => (
                    <div key={i} className="relative h-16 flex items-center">
                       <div className="w-full border-t border-slate-400"></div>
                       <div className="absolute -right-4 bg-slate-100 border border-slate-400 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold text-slate-600 z-10">
                          {17 + i}
                       </div>
                    </div>
                  ))}
               </div>

               {/* Quarter Finals */}
               <div className="flex flex-col justify-around py-24 w-32">
                  {Array.from({length: 4}).map((_, i) => (
                    <div key={i} className="relative h-32 flex items-center">
                       <div className="w-full border-t border-slate-400"></div>
                       <div className="absolute -right-4 bg-slate-100 border border-slate-400 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold text-slate-600 z-10">
                          {25 + i}
                       </div>
                    </div>
                  ))}
               </div>

               {/* Semi Finals */}
               <div className="flex flex-col justify-around py-48 w-32">
                  {Array.from({length: 2}).map((_, i) => (
                    <div key={i} className="relative h-64 flex items-center">
                       <div className="w-full border-t border-slate-400"></div>
                       <div className="absolute -right-4 bg-slate-100 border border-slate-400 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold text-slate-600 z-10">
                          {31 + i}
                       </div>
                    </div>
                  ))}
               </div>

               {/* Final */}
               <div className="flex flex-col justify-center py-48 w-48">
                  <div className="relative h-64 flex items-center">
                     <div className="w-full border-t border-slate-400"></div>
                     <div className="absolute -right-4 bg-slate-100 border border-slate-400 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold text-slate-600 z-10">
                        35
                     </div>
                  </div>
               </div>

               {/* Repechage & Final Results Box */}
               <div className="absolute bottom-0 right-0 w-80">
                  <div className="border-2 border-red-200 rounded-lg overflow-hidden bg-white shadow-sm">
                    <div className="bg-red-50 text-red-600 font-bold text-center py-2 border-b-2 border-red-200">
                      FINAL RESULTS
                    </div>
                    <div className="h-48"></div>
                  </div>
               </div>
            </div>

            {/* Repechage Section */}
            <div className="mt-16 flex gap-4">
              <div className="w-8 flex items-center justify-center rounded-lg border border-slate-400 bg-slate-200 text-slate-600">
                <span className="transform -rotate-90 font-black tracking-widest text-sm whitespace-nowrap">REPECHAGE</span>
              </div>
              <div className="flex-1 flex flex-col gap-8 py-4">
                 <div className="flex items-center gap-8">
                    <div className="w-64 border-b border-slate-400 relative">
                       <div className="absolute -right-3 top-1/2 -translate-y-1/2 bg-slate-100 border border-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold text-slate-600 z-10">29</div>
                    </div>
                    <div className="w-64 border-b border-slate-400 relative">
                       <div className="absolute -right-3 top-1/2 -translate-y-1/2 bg-slate-100 border border-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold text-slate-600 z-10">33</div>
                    </div>
                 </div>
                 <div className="flex items-center gap-8">
                    <div className="w-64 border-b border-slate-400 relative">
                       <div className="absolute -right-3 top-1/2 -translate-y-1/2 bg-slate-100 border border-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold text-slate-600 z-10">30</div>
                    </div>
                    <div className="w-64 border-b border-slate-400 relative">
                       <div className="absolute -right-3 top-1/2 -translate-y-1/2 bg-slate-100 border border-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold text-slate-600 z-10">34</div>
                    </div>
                 </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button onClick={() => onNavigate('ROSTER')} className="mb-4 text-blue-600 font-bold flex items-center gap-2">
        <ArrowLeft size={16} /> Back to Roster
      </button>
      
      <div className="bg-white p-12 rounded-2xl shadow-xl border border-slate-200 text-center">
        <h1 className="text-4xl font-black mb-4 text-slate-900">Draw PDF Reader</h1>
        <p className="text-slate-500 mb-12 text-lg">Upload the IJF draw PDF to extract the tournament brackets for: <span className="font-bold text-slate-800">{tournament?.name}</span></p>
        
        <div className="border-4 border-dashed border-purple-200 bg-purple-50 rounded-3xl p-16 text-center hover:bg-purple-100 transition-colors cursor-pointer relative group">
          <input 
            type="file" 
            accept=".pdf" 
            onChange={(e) => setFile(e.target.files?.[0] || null)} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 bg-purple-200 text-purple-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileUp size={40} />
            </div>
            {file ? (
              <p className="text-green-600 font-bold text-xl flex items-center gap-2">
                <CheckCircle size={24} /> {file.name}
              </p>
            ) : (
              <div>
                <p className="text-purple-900 font-bold text-xl">Click or drag your PDF here</p>
                <p className="text-purple-500 mt-2">Supported format: .pdf</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-12">
          <Button 
            onClick={handleProcessPDF}
            disabled={!file || isProcessing}
            className={`px-12 py-4 rounded-xl font-black text-lg shadow-xl transition-all ${file ? 'bg-purple-600 hover:bg-purple-700 text-white hover:scale-105' : 'bg-slate-200 text-slate-400'}`}
            icon={isProcessing ? Loader2 : Upload}
          >
            {isProcessing ? 'Processing PDF...' : 'Analyze & Build Bracket'}
          </Button>
        </div>
      </div>
    </div>
  );
};
export default BuildBracket;
