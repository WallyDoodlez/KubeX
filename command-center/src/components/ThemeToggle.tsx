import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';

interface ThemeToggleProps {
  /** Extra CSS classes forwarded to the button. */
  className?: string;
}

/** Sun icon — used in light mode (click to go dark) */
function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="4"  />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2"  y1="12" x2="4"  y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"  />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" />
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
    </svg>
  );
}

/** Moon icon — used in dark mode (click to go light) */
function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function themeLabel(theme: Theme): string {
  return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const [theme, toggleTheme] = useTheme();

  return (
    <button
      onClick={toggleTheme}
      data-testid="theme-toggle"
      aria-label={themeLabel(theme)}
      aria-pressed={theme === 'light'}
      title={themeLabel(theme)}
      className={[
        'flex items-center justify-center w-7 h-7',
        'text-[var(--color-text-dim)] border border-[var(--color-border)]',
        'rounded-lg transition-all',
        'hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-dark)]',
        className,
      ].join(' ')}
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
