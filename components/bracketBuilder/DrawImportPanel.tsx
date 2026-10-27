import React, { useRef, useState } from 'react';
import { FileUp, Loader2, CheckCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { extractPdfPageTexts, genderForWeight, pageHasTextLayer, parseDrawPages } from '../../lib/drawPdfParser';
import { fieldSizeFor, type DraftGender, type DraftSource, type DrawAthlete } from '../../lib/bracketDraft';
import { extractDrawWithAi } from './aiDrawExtraction';

/** One category read from a draw PDF (before matching to configured categories). */
export interface ImportedCategory {
  parsedWeight: string;
  gender: DraftGender;
  declaredCount: number | null;
  fieldSize: number;
  slots: (DrawAthlete | null)[];
  warnings: string[];
  source: DraftSource;
  fileName: string;
}

interface FileStatus {
  name: string;
  status: 'processing' | 'done' | 'error';
  detail?: string;
  ai?: boolean;
}

async function importFile(file: File): Promise<{ cats: ImportedCategory[]; ai: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = await extractPdfPageTexts(bytes);
  if (pages.length > 0 && !pages.some(pageHasTextLayer)) {
    const aiCats = await extractDrawWithAi(bytes);
    return {
      ai: true,
      cats: aiCats.map(c => ({
        parsedWeight: c.weight,
        gender: genderForWeight(c.weight.replace(/\s+/g, '').toLowerCase().replace(/^(women|men)/, '')),
        declaredCount: c.declaredCount,
        fieldSize: c.slots.length || fieldSizeFor(2),
        slots: c.slots,
        warnings: ['Extracted by AI – please verify'],
        source: 'ai' as const,
        fileName: file.name,
      })),
    };
  }
  return {
    ai: false,
    cats: parseDrawPages(pages).map(c => ({
      parsedWeight: c.weight,
      gender: c.gender,
      declaredCount: c.declaredCount,
      fieldSize: c.fieldSize,
      slots: c.slots,
      warnings: c.warnings,
      source: 'pdf' as const,
      fileName: file.name,
    })),
  };
}

interface DrawImportPanelProps {
  onImported: (cats: ImportedCategory[]) => void;
}

/** Drop zone for one multi-category draw PDF or several per-category PDFs. */
const DrawImportPanel: React.FC<DrawImportPanelProps> = ({ onImported }) => {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const busy = files.some(f => f.status === 'processing');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (list: FileList | File[]) => {
    const pdfs = Array.from(list).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    setFiles(pdfs.map(f => ({ name: f.name, status: 'processing' })));
    const all: ImportedCategory[] = [];
    // Files are independent; process them in parallel.
    await Promise.all(
      pdfs.map(async (file, i) => {
        try {
          const { cats, ai } = await importFile(file);
          all.push(...cats);
          setFiles(prev => prev.map((f, j) => (j === i ? { ...f, status: 'done', ai, detail: `${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}` } : f)));
        } catch (err: any) {
          console.error('[Draw import]', file.name, err);
          setFiles(prev => prev.map((f, j) => (j === i ? { ...f, status: 'error', detail: err?.message || String(err) } : f)));
        }
      })
    );
    // Keep file order stable regardless of completion order.
    const order = new Map(pdfs.map((f, i) => [f.name, i]));
    all.sort((a, b) => (order.get(a.fileName) ?? 0) - (order.get(b.fileName) ?? 0));
    if (all.length > 0) onImported(all);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (!busy) void handleFiles(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`border-4 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-purple-400 bg-purple-100' : 'border-purple-200 bg-purple-50 hover:bg-purple-100/60'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 bg-purple-200 text-purple-600 rounded-full flex items-center justify-center">
            {busy ? <Loader2 size={28} className="animate-spin" /> : <FileUp size={28} />}
          </div>
          <div>
            <p className="text-purple-900 font-bold">{busy ? 'Reading draw…' : 'Click or drop draw PDF(s) here'}</p>
            <p className="text-purple-500 text-sm mt-1">One PDF with all categories, or one PDF per category</p>
          </div>
        </div>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-white border border-slate-200">
              {f.status === 'processing' && <Loader2 size={14} className="animate-spin text-slate-400" />}
              {f.status === 'done' && <CheckCircle size={14} className="text-green-600" />}
              {f.status === 'error' && <AlertTriangle size={14} className="text-red-500" />}
              <span className="font-medium text-slate-700 truncate flex-1">{f.name}</span>
              {f.ai && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700"><Sparkles size={11} /> AI</span>}
              {f.detail && <span className={`text-xs truncate max-w-[50%] ${f.status === 'error' ? 'text-red-500' : 'text-slate-500'}`}>{f.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DrawImportPanel;
