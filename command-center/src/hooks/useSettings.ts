import { createContext, useContext, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';

// ── Settings types ──────────────────────────────────────────────────

export type PollingInterval = 5000 | 10000 | 15000 | 30000 | 60000;
export type PageSize = 10 | 20 | 50 | 100;

export interface AppSettings {
  /** Global polling interval in ms (default: 10 000) */
  pollingInterval: PollingInterval;
  /** Default page size for paginated tables (default: 20) */
  defaultPageSize: PageSize;
  /** Whether to enable auto-refresh for data panels (default: true) */
  autoRefresh: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollingInterval: 10000,
  defaultPageSize: 20,
  autoRefresh: true,
};

export const POLLING_INTERVAL_OPTIONS: { value: PollingInterval; label: string }[] = [
  { value: 5000,  label: '5 seconds'  },
  { value: 10000, label: '10 seconds' },
  { value: 15000, label: '15 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute'   },
];

export const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: 10,  label: '10 per page'  },
  { value: 20,  label: '20 per page'  },
  { value: 50,  label: '50 per page'  },
  { value: 100, label: '100 per page' },
];

// ── Context ─────────────────────────────────────────────────────────

export interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

import React from 'react';

export const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [rawSettings, setRawSettings] = useLocalStorage<AppSettings>(
    'kubex-settings',
    DEFAULT_SETTINGS,
  );

  // Merge stored settings with defaults to handle new keys added over time
  const settings = useMemo<AppSettings>(
    () => ({ ...DEFAULT_SETTINGS, ...rawSettings }),
    [rawSettings],
  );

  function updateSettings(patch: Partial<AppSettings>) {
    setRawSettings((prev) => ({ ...DEFAULT_SETTINGS, ...prev, ...patch }));
  }

  function resetSettings() {
    setRawSettings(DEFAULT_SETTINGS);
  }

  return React.createElement(
    SettingsContext.Provider,
    { value: { settings, updateSettings, resetSettings } },
    children,
  );
}

/**
 * Hook to read and update app-wide preferences.
 * Must be called within a `<SettingsProvider>`.
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
