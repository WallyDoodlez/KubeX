import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

export type Theme = 'dark' | 'light';

/**
 * Manages the application color theme.
 * - Persists preference to localStorage under the key 'kubex-theme'.
 * - Applies `data-theme` attribute to `document.documentElement` so the
 *   CSS variable overrides in index.css take effect globally.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useLocalStorage<Theme>('kubex-theme', 'dark');

  // Sync the attribute on the root element whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return [theme, toggleTheme];
}
