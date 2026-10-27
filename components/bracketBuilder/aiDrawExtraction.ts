/**
 * AI fallback for scanned draw PDFs (no text layer): Gemini extracts R1 pairs, which are
 * padded/ordered and converted to the same slot model as the deterministic parser.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { getBracketParticipantCount } from '../../lib/bracketUtils';
import { matchesToSlots, type DrawAthlete } from '../../lib/bracketDraft';

interface ExtractedCompetitor {
  name: string;
  country: string;
}

interface ExtractedMatch {
  matchNumber: number;
  competitor1: ExtractedCompetitor | null;
  competitor2: ExtractedCompetitor | null;
}

export interface AiExtractedCategory {
  weight: string;
  declaredCount: number | null;
  slots: (DrawAthlete | null)[];
}

const MODEL = 'gemini-2.5-flash';

const PROMPT = `Extract the tournament bracket from this Judo draw PDF.
Return a JSON array of objects, where each object represents a weight category found in the PDF.
For each weight category, provide the 'weight' (e.g., '-100kg') and an array of 'matches' for the FIRST ROUND ONLY.
The matches MUST be in the exact visual order they appear in the PDF (top to bottom, which corresponds to Pool A, then B, then C, then D).

CRITICAL RULES — CATEGORY SEPARATION (most important):
- Each weight category is a COMPLETELY SEPARATE bracket. NEVER mix athletes from one category into another.
- Weight categories are separated by clear visual headers (e.g. "-60kg", "-73kg", "Men -81kg", "Women -57kg"). Each header starts a NEW independent bracket.
- If the PDF has multiple pages, check the category header on each page — a new page usually means a new category.
- Return one object per category. Each object must only contain matches from its own category.

CRITICAL RULES — MATCH EXTRACTION:
- If the category header shows a participant count in parentheses (e.g. "Seniors (32)"), set 'participant_count' to that integer.
- For each first-round match, include 'pdf_match_number' as the small integer printed next to that match on the draw (1, 2, 3, ...). If not visible, omit it.
- Each match has 'competitor1' (top athlete) and 'competitor2' (bottom athlete); either may be null for a BYE or empty slot.
- A BYE means one side of the match is empty. Never repeat the same athlete on both sides.
- For each competitor, extract their 'name' (LAST NAME First Name) and 'country' (3-letter IOC code).
- Extract EVERY first-round match shown in the draw, including matches with empty slots.
- Do not hallucinate matches or competitors. Only extract what is visible in the PDF.`;

const competitorSchema = {
  type: Type.OBJECT,
  nullable: true,
  properties: { name: { type: Type.STRING }, country: { type: Type.STRING } },
};

const SCHEMA = {
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
            competitor1: competitorSchema,
            competitor2: competitorSchema,
          },
        },
      },
    },
  },
};

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Orders R1 matches by printed fight number and pads to the full first round. */
function padAndOrderR1Matches(categoryData: any): ExtractedMatch[] {
  const raw: any[] = [...(categoryData.matches || [])];
  const pcRaw = categoryData.participant_count ?? categoryData.participants;
  const participantCount = typeof pcRaw === 'number' ? pcRaw : typeof pcRaw === 'string' ? parseInt(pcRaw, 10) : NaN;
  const validPc = Number.isFinite(participantCount) && participantCount > 0 ? participantCount : 0;

  const pdfNums = raw.map(m => (typeof m.pdf_match_number === 'number' ? m.pdf_match_number : 0)).filter(n => n > 0);
  const maxPdf = pdfNums.length > 0 ? Math.max(...pdfNums) : 0;
  const athleteTarget = validPc > 0 ? validPc : Math.max(raw.length * 2, maxPdf * 2, 2);
  const expectedR1 = getBracketParticipantCount(athleteTarget) / 2;

  const pick = (c: any): ExtractedCompetitor | null => (c ? { name: c.name, country: c.country } : null);
  const bySlot = new Map<number, any>();
  raw.forEach((m, i) => {
    const slot = typeof m.pdf_match_number === 'number' && m.pdf_match_number > 0 ? m.pdf_match_number : i + 1;
    if (!bySlot.has(slot)) bySlot.set(slot, m);
  });

  const out: ExtractedMatch[] = [];
  for (let slot = 1; slot <= expectedR1; slot++) {
    const m = bySlot.get(slot);
    const c1 = m ? pick(m.competitor1) : null;
    let c2 = m ? pick(m.competitor2) : null;
    if (c1 && c2 && c1.name === c2.name && c1.country === c2.country) c2 = null;
    out.push({ matchNumber: slot, competitor1: c1, competitor2: c2 });
  }
  return out;
}

export async function extractDrawWithAi(bytes: Uint8Array): Promise<AiExtractedCategory[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing. Add it to .env.local and restart the server.');
  const ai = new GoogleGenAI({ apiKey });
  const contents = [{ inlineData: { mimeType: 'application/pdf', data: toBase64(bytes) } }, PROMPT];

  let lastError: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          httpOptions: { timeout: 180_000 },
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseJsonSchema: SCHEMA,
        },
      });
      const text = response.text;
      if (!text) throw new Error('Gemini returned an empty response.');
      const parsed: any[] = JSON.parse(text);
      return parsed.map(cat => {
        const pc = typeof cat.participant_count === 'number' && cat.participant_count > 0 ? cat.participant_count : null;
        return { weight: String(cat.weight || 'Unknown'), declaredCount: pc, slots: matchesToSlots(padAndOrderR1Matches(cat)) };
      });
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message ?? '');
      const retryable = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('429');
      if (!retryable || attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 3000));
    }
  }
  throw lastError || new Error('Could not connect to the Gemini API.');
}
