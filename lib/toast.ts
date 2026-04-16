import type { ToastType } from '../components/ui/Toast';

/** Fire a toast from anywhere — no prop drilling needed. */
export function showToast(type: ToastType, message: string) {
  window.dispatchEvent(new CustomEvent('tippon-toast', { detail: { type, message } }));
}
