import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Open / close the native dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // Auto-focus cancel for safety — Enter won't accidentally confirm
      cancelRef.current?.focus();
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open]);

  // Handle native cancel event (Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleCancel(e: Event) {
      e.preventDefault(); // prevent browser from closing before we handle it
      onCancel();
    }

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onCancel]);

  // Clicking the backdrop (outside the inner card) closes the dialog
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      onCancel();
    }
  }

  const confirmButtonClass =
    variant === 'danger'
      ? 'rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 active:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/40'
      : variant === 'warning'
      ? 'rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-400 active:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40'
      : 'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 active:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40';

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      className="
        m-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-2xl
        backdrop:bg-black/60 backdrop:backdrop-blur-sm
        open:flex open:flex-col
        w-full max-w-sm
      "
    >
      {/* Inner card — clicks here don't bubble to the backdrop handler */}
      <div className="flex flex-col gap-5 p-6">

        {/* Header */}
        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 border border-red-500/30">
              <svg
                className="h-4 w-4 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
          )}
          {variant === 'warning' && (
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/30">
              <svg
                className="h-4 w-4 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)] leading-relaxed">{message}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[var(--color-border)]" />

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="
              rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium
              text-[var(--color-text-secondary)] transition-colors
              hover:border-[var(--color-border-hover)] hover:text-[var(--color-text)]
              focus:outline-none focus:ring-2 focus:ring-[var(--color-border)]
            "
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmButtonClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
