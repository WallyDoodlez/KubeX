import { useEffect, useState } from 'react';
import { useToast, type ToastMessage } from '../context/ToastContext';

const TYPE_STYLES: Record<ToastMessage['type'], { bar: string; border: string; icon: string; text: string }> = {
  success: { bar: 'bg-emerald-500', border: 'border-emerald-500/40', icon: '✓', text: 'text-emerald-400' },
  error:   { bar: 'bg-red-500',     border: 'border-red-500/40',     icon: '✕', text: 'text-red-400'     },
  warning: { bar: 'bg-amber-500',   border: 'border-amber-500/40',   icon: '⚠', text: 'text-amber-400'   },
  info:    { bar: 'bg-blue-500',    border: 'border-blue-500/40',    icon: 'ℹ', text: 'text-blue-400'    },
};

function ToastItem({ toast }: { toast: ToastMessage }) {
  const { removeToast } = useToast();
  const styles = TYPE_STYLES[toast.type];
  const duration = toast.duration ?? 4000;

  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [duration]);

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="toast"
      className={`relative flex items-start gap-3 px-4 py-3 rounded-lg border bg-[#12151f] ${styles.border} shadow-xl min-w-[280px] max-w-[380px] overflow-hidden`}
    >
      {/* Progress bar */}
      <div
        className={`absolute bottom-0 left-0 h-0.5 ${styles.bar} transition-all ease-linear`}
        style={{ width: `${progress}%` }}
      />

      {/* Icon */}
      <span className={`flex-shrink-0 font-bold text-sm mt-0.5 ${styles.text}`}>{styles.icon}</span>

      {/* Message */}
      <p className="flex-1 text-sm text-[#e2e8f0] leading-snug pr-2">{toast.message}</p>

      {/* Dismiss */}
      <button
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 text-[#3a3f5a] hover:text-[#94a3b8] transition-colors text-xs mt-0.5 leading-none"
      >
        ✕
      </button>
    </div>
  );
}

export default function Toast() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
