import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastMessage {
  type: ToastType;
  message: string;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-emerald-600 shrink-0" />,
  error: <XCircle size={18} className="text-red-500 shrink-0" />,
  warning: <AlertTriangle size={18} className="text-amber-500 shrink-0" />,
};

const BG: Record<ToastType, string> = {
  success: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  error: 'bg-red-50 border-red-300 text-red-800',
  warning: 'bg-amber-50 border-amber-300 text-amber-800',
};

/** Self-contained toast that listens for 'tippon-toast' CustomEvents. */
const Toast: React.FC = () => {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { type, message } = (e as CustomEvent<ToastMessage>).detail;
      setToast({ type, message });
    };
    window.addEventListener('tippon-toast', handler);
    return () => window.removeEventListener('tippon-toast', handler);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm font-medium max-w-sm w-full ${BG[toast.type]}`}>
      {ICONS[toast.type]}
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
        <X size={16} />
      </button>
    </div>
  );
};

export default Toast;
