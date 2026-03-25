import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION = 4000;

/** Optional side-effect called for every toast added — used to mirror toasts into NotificationCenter. */
export type ToastSideEffect = (message: string, type: ToastType) => void;

/**
 * Optional filter predicate.  When provided, a toast is suppressed (not
 * rendered) if the function returns `false` for that toast type.  The
 * side-effect (`onToastAdded`) is still called so the notification history
 * continues to capture all events regardless of suppression.
 */
export type ToastFilter = (type: ToastType) => boolean;

export function ToastProvider({
  children,
  onToastAdded,
  toastFilter,
}: {
  children: React.ReactNode;
  onToastAdded?: ToastSideEffect;
  toastFilter?: ToastFilter;
}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Keep stable refs so addToast closure doesn't capture stale values
  const onToastAddedRef = useRef<ToastSideEffect | undefined>(onToastAdded);
  onToastAddedRef.current = onToastAdded;
  const toastFilterRef = useRef<ToastFilter | undefined>(toastFilter);
  toastFilterRef.current = toastFilter;

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = DEFAULT_DURATION) => {
      // Mirror into notification history regardless of filter
      onToastAddedRef.current?.(message, type);

      // Check filter — if it returns false, skip rendering the toast UI
      if (toastFilterRef.current && !toastFilterRef.current(type)) {
        return;
      }

      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const toast: ToastMessage = { id, message, type, duration };
      setToasts((prev) => [...prev, toast]);
      const timer = setTimeout(() => removeToast(id), duration);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
