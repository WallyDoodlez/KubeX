import { useState, useCallback } from 'react';

interface CopyButtonProps {
  /** The text to copy to the clipboard when clicked. */
  text: string;
  /** Optional extra className applied to the button element. */
  className?: string;
  /** aria-label override — defaults to "Copy to clipboard". */
  ariaLabel?: string;
  /** data-testid for test targeting. */
  testId?: string;
}

/**
 * Small icon button that copies `text` to the clipboard.
 *
 * - Uses `navigator.clipboard.writeText` (secure context / modern browsers).
 * - Shows a brief "✓ Copied!" tooltip state for 1.5 s after a successful copy.
 * - Accessible: keyboard-operable, aria-label, title attribute.
 * - Falls back silently when the Clipboard API is unavailable.
 */
export default function CopyButton({ text, className = '', ariaLabel, testId }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (copied) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard API unavailable or denied — silently ignore.
      }
    },
    [text, copied],
  );

  const label = ariaLabel ?? 'Copy to clipboard';

  return (
    <button
      type="button"
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleCopy(e);
      }}
      aria-label={copied ? 'Copied!' : label}
      title={copied ? 'Copied!' : label}
      data-testid={testId ?? 'copy-button'}
      className={`
        inline-flex items-center justify-center
        h-5 w-5 rounded
        text-[var(--color-text-muted)]
        hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]
        focus:outline-none focus:ring-1 focus:ring-emerald-500/40
        transition-all duration-150 flex-shrink-0
        ${copied ? 'text-emerald-400 hover:text-emerald-400' : ''}
        ${className}
      `}
    >
      {copied ? (
        /* Checkmark — "Copied!" state */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        /* Clipboard icon — default state */
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M4 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12 2H4Zm1 2.5A.5.5 0 0 1 5.5 4h5a.5.5 0 0 1 0 1h-5A.5.5 0 0 1 5 4.5ZM5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5Zm0 2.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
}
