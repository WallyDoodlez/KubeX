import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import {
  useSettings,
  POLLING_INTERVAL_OPTIONS,
  PAGE_SIZE_OPTIONS,
  DEFAULT_SETTINGS,
} from '../hooks/useSettings';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { GATEWAY, REGISTRY, MANAGER } from '../api';

// ── Section wrapper ──────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 md:p-6"
      aria-labelledby={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="mb-4">
        <h2
          id={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          {title}
        </h2>
        {description && (
          <p className="text-xs text-[var(--color-text-dim)] mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// ── Labelled row ─────────────────────────────────────────────────────

function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer"
        >
          {label}
        </label>
        {description && (
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Select control ───────────────────────────────────────────────────

function Select<T extends string | number>({
  id,
  value,
  onChange,
  options,
  'data-testid': testId,
}: {
  id?: string;
  value: T;
  onChange: (val: T) => void;
  options: { value: T; label: string }[];
  'data-testid'?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        // Cast back to T — numeric values need parseInt
        const parsed = (typeof value === 'number' ? parseInt(raw, 10) : raw) as T;
        onChange(parsed);
      }}
      data-testid={testId}
      className="
        text-xs bg-[var(--color-surface-dark)] text-[var(--color-text)]
        border border-[var(--color-border)] rounded-lg px-2.5 py-1.5
        hover:border-[var(--color-border-hover)] transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
        focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]
        cursor-pointer
      "
    >
      {options.map((opt) => (
        <option key={String(opt.value)} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ── Toggle switch ────────────────────────────────────────────────────

function Toggle({
  id,
  checked,
  onChange,
  'data-testid': testId,
}: {
  id?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  'data-testid'?: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={[
        'relative inline-flex w-10 h-5 rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]',
        checked ? 'bg-emerald-500' : 'bg-[var(--color-border)]',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow',
          'transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ── Danger button ────────────────────────────────────────────────────

function DangerButton({
  onClick,
  children,
  'data-testid': testId,
}: {
  onClick: () => void;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="
        text-xs font-medium px-3 py-1.5 rounded-lg
        bg-red-500/10 text-red-400 border border-red-500/30
        hover:bg-red-500/20 hover:border-red-500/50
        transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500
        focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]
      "
    >
      {children}
    </button>
  );
}

// ── Read-only info row ───────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-xs text-[var(--color-text-dim)]">{label}</span>
      <code className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-dark)] px-2 py-0.5 rounded border border-[var(--color-border)] max-w-[200px] truncate">
        {value}
      </code>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [theme, toggleTheme] = useTheme();
  const { settings, updateSettings, resetSettings } = useSettings();
  const { token, setToken, clearToken, isConfigured } = useAuth();
  const { clearTrafficLog, setChatMessages } = useAppContext();

  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenEditMode, setTokenEditMode] = useState(false);
  const [clearTrafficConfirm, setClearTrafficConfirm] = useState(false);
  const [clearChatConfirm, setClearChatConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  function handleTokenSave() {
    if (tokenDraft.trim()) {
      setToken(tokenDraft.trim());
    }
    setTokenDraft('');
    setTokenEditMode(false);
  }

  function handleTokenCancel() {
    setTokenDraft('');
    setTokenEditMode(false);
  }

  function handleClearTraffic() {
    if (clearTrafficConfirm) {
      clearTrafficLog();
      setClearTrafficConfirm(false);
    } else {
      setClearTrafficConfirm(true);
    }
  }

  function handleClearChat() {
    if (clearChatConfirm) {
      setChatMessages([
        {
          id: 'welcome',
          role: 'system',
          content:
            'KubexClaw Command Center — dispatch tasks to the orchestrator via the Gateway. Enter a capability and message below.',
          timestamp: new Date(),
        },
      ]);
      setClearChatConfirm(false);
    } else {
      setClearChatConfirm(true);
    }
  }

  function handleResetSettings() {
    if (resetConfirm) {
      resetSettings();
      setResetConfirm(false);
    } else {
      setResetConfirm(true);
    }
  }

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="settings-page"
      role="main"
      aria-label="Settings and Preferences"
    >
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)]">Settings &amp; Preferences</h1>
          <p className="text-xs text-[var(--color-text-dim)] mt-1">
            Customize the appearance, connection, and data behavior of KubexClaw Command Center.
          </p>
        </div>

        {/* ── Appearance ───────────────────────────────────────────── */}
        <Section title="Appearance" description="Visual theme for the command center interface.">
          <Row
            label="Color Theme"
            description="Switch between dark and light mode."
            htmlFor="theme-select"
          >
            <Select
              id="theme-select"
              data-testid="settings-theme-select"
              value={theme}
              onChange={(val) => {
                if (val !== theme) toggleTheme();
              }}
              options={[
                { value: 'dark' as const, label: 'Dark' },
                { value: 'light' as const, label: 'Light' },
              ]}
            />
          </Row>
        </Section>

        {/* ── Connection ───────────────────────────────────────────── */}
        <Section
          title="Connection"
          description="Manager API token and service endpoint configuration."
        >
          {/* Token */}
          <Row
            label="Manager Token"
            description={isConfigured ? 'A token is currently configured.' : 'No token set — API calls will fail.'}
          >
            {tokenEditMode ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTokenSave();
                    if (e.key === 'Escape') handleTokenCancel();
                  }}
                  placeholder="Paste token…"
                  aria-label="New manager token"
                  data-testid="settings-token-input"
                  autoFocus
                  className="
                    text-xs bg-[var(--color-surface-dark)] text-[var(--color-text)]
                    border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 w-40
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
                  "
                />
                <button
                  onClick={handleTokenSave}
                  data-testid="settings-token-save"
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  Save
                </button>
                <button
                  onClick={handleTokenCancel}
                  data-testid="settings-token-cancel"
                  className="text-xs px-2.5 py-1.5 rounded-lg text-[var(--color-text-dim)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  data-testid="settings-token-status"
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                    isConfigured
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-red-500/10 text-red-400 border-red-500/30'
                  }`}
                >
                  {isConfigured ? '● Configured' : '● Not set'}
                </span>
                <button
                  onClick={() => setTokenEditMode(true)}
                  data-testid="settings-token-edit"
                  className="text-xs px-2.5 py-1.5 rounded-lg text-[var(--color-text-dim)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  {isConfigured ? 'Change' : 'Set Token'}
                </button>
                {isConfigured && (
                  <button
                    onClick={clearToken}
                    data-testid="settings-token-clear"
                    className="text-xs px-2.5 py-1.5 rounded-lg text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </Row>

          {/* API endpoint info */}
          <div className="pt-2 border-t border-[var(--color-border)]">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] mb-2">
              Service Endpoints
            </p>
            <div className="space-y-1" data-testid="settings-endpoints">
              <InfoRow label="Gateway" value={GATEWAY} />
              <InfoRow label="Registry" value={REGISTRY} />
              <InfoRow label="Manager" value={MANAGER} />
            </div>
          </div>
        </Section>

        {/* ── Data ─────────────────────────────────────────────────── */}
        <Section
          title="Data"
          description="Polling behavior, display defaults, and stored data management."
        >
          <Row
            label="Auto-Refresh"
            description="Automatically refresh data panels on a timer."
            htmlFor="settings-auto-refresh"
          >
            <Toggle
              id="settings-auto-refresh"
              data-testid="settings-auto-refresh"
              checked={settings.autoRefresh}
              onChange={(val) => updateSettings({ autoRefresh: val })}
            />
          </Row>

          <Row
            label="Polling Interval"
            description="How often data panels refresh when auto-refresh is on."
            htmlFor="settings-polling-interval"
          >
            <Select
              id="settings-polling-interval"
              data-testid="settings-polling-interval"
              value={settings.pollingInterval}
              onChange={(val) => updateSettings({ pollingInterval: val })}
              options={POLLING_INTERVAL_OPTIONS}
            />
          </Row>

          <Row
            label="Default Page Size"
            description="Number of rows shown per page in tables."
            htmlFor="settings-page-size"
          >
            <Select
              id="settings-page-size"
              data-testid="settings-page-size"
              value={settings.defaultPageSize}
              onChange={(val) => updateSettings({ defaultPageSize: val })}
              options={PAGE_SIZE_OPTIONS}
            />
          </Row>

          {/* Danger zone */}
          <div className="pt-2 border-t border-[var(--color-border)] space-y-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
              Data Management
            </p>

            <Row
              label="Clear Traffic Log"
              description="Permanently removes all stored traffic log entries from localStorage."
            >
              <DangerButton
                onClick={handleClearTraffic}
                data-testid="settings-clear-traffic"
              >
                {clearTrafficConfirm ? 'Confirm Clear?' : 'Clear Log'}
              </DangerButton>
            </Row>

            <Row
              label="Clear Chat History"
              description="Permanently removes all chat messages from localStorage."
            >
              <DangerButton
                onClick={handleClearChat}
                data-testid="settings-clear-chat"
              >
                {clearChatConfirm ? 'Confirm Clear?' : 'Clear Chat'}
              </DangerButton>
            </Row>
          </div>
        </Section>

        {/* ── About ────────────────────────────────────────────────── */}
        <Section title="About" description="Version and build information.">
          <div className="space-y-2" data-testid="settings-about">
            <InfoRow label="Application" value="KubexClaw Command Center" />
            <InfoRow label="Version" value="v1.1" />
            <InfoRow label="Build" value="Iteration 24" />
            <InfoRow label="Framework" value="React 18 + Vite" />
            <InfoRow label="Theme" value={theme === 'dark' ? 'Dark (default)' : 'Light'} />
            <InfoRow label="Polling" value={`${settings.pollingInterval / 1000}s interval`} />
          </div>
        </Section>

        {/* ── Reset ────────────────────────────────────────────────── */}
        <Section
          title="Reset"
          description="Restore all preferences to their factory defaults."
        >
          <Row
            label="Reset All Settings"
            description={`Resets polling interval to ${DEFAULT_SETTINGS.pollingInterval / 1000}s, page size to ${DEFAULT_SETTINGS.defaultPageSize}, and auto-refresh to ${DEFAULT_SETTINGS.autoRefresh ? 'on' : 'off'}.`}
          >
            <DangerButton
              onClick={handleResetSettings}
              data-testid="settings-reset"
            >
              {resetConfirm ? 'Confirm Reset?' : 'Reset Defaults'}
            </DangerButton>
          </Row>
        </Section>

        {/* spacer at the bottom */}
        <div className="h-6" />
      </div>
    </div>
  );
}
