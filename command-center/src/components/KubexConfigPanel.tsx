import { useState, useEffect, type ReactNode } from 'react';
import { getKubexConfig } from '../api';
import type { KubexConfigResponse } from '../types';
import CopyButton from './CopyButton';

interface KubexConfigPanelProps {
  kubexId: string;
}

/**
 * Inline panel that fetches and displays GET /kubexes/{id}/config.
 * Rendered by KubexRow when the user clicks the expand chevron.
 * Fetches on first mount; caches the result in local state.
 */
export default function KubexConfigPanel({ kubexId }: KubexConfigPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<KubexConfigResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchConfig() {
      setLoading(true);
      setError(null);
      const res = await getKubexConfig(kubexId);
      if (cancelled) return;
      if (res.ok && res.data) {
        setConfig(res.data);
      } else {
        setError(res.error ?? `HTTP ${res.status}`);
      }
      setLoading(false);
    }

    fetchConfig();

    return () => {
      cancelled = true;
    };
  }, [kubexId]);

  /** Stringify config object as pretty-printed JSON for display. */
  function configText(): string {
    if (!config?.config) return '{}';
    return JSON.stringify(config.config, null, 2);
  }

  return (
    <div
      className="border-t border-[var(--color-border)] bg-[var(--color-surface-dark)] px-4 pb-4"
      data-testid={`kubex-config-panel-${kubexId}`}
    >
      {/* Content area */}
      <div
        id={`kubex-config-content-${kubexId}`}
        data-testid={`kubex-config-content-${kubexId}`}
        className="pt-3"
      >
        {loading && (
          <div
            className="flex items-center gap-2 py-3 text-xs text-[var(--color-text-muted)]"
            data-testid={`kubex-config-loading-${kubexId}`}
          >
            <span className="animate-spin">⟳</span>
            Loading config…
          </div>
        )}

        {error && (
          <div
            className="py-2 text-xs text-red-400"
            data-testid={`kubex-config-error-${kubexId}`}
          >
            Failed to load config: {error}
          </div>
        )}

        {!loading && !error && config && (
          <>
            {/* Config metadata */}
            {config.config_path && (
              <div className="mb-2 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span className="font-semibold uppercase tracking-widest">Path:</span>
                <code className="font-mono text-[var(--color-text-dim)]">{config.config_path}</code>
              </div>
            )}

            {/* Config content */}
            {config.config && Object.keys(config.config).length > 0 ? (
              <div className="relative">
                <div className="absolute top-2 right-2 z-10">
                  <CopyButton
                    text={configText()}
                    ariaLabel="Copy config JSON"
                    testId={`kubex-config-copy-${kubexId}`}
                  />
                </div>
                <pre
                  data-testid={`kubex-config-json-${kubexId}`}
                  className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[11px] font-mono text-[var(--color-text-secondary)] leading-relaxed max-h-80"
                >
                  {configText()}
                </pre>
              </div>
            ) : (
              <div
                className="py-2 text-xs text-[var(--color-text-muted)] italic"
                data-testid={`kubex-config-empty-${kubexId}`}
              >
                No config data available.
              </div>
            )}

            {/* Key-value summary cards for common fields */}
            {config.config && (
              <ConfigSummaryCards config={config.config} kubexId={kubexId} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Config Summary Cards ──────────────────────────────────────────────

interface ConfigSummaryCardsProps {
  config: Record<string, unknown>;
  kubexId: string;
}

/**
 * Renders a compact summary of the most useful config fields:
 * agent.id, agent.capabilities, agent.skills, agent.boundary
 */
function ConfigSummaryCards({ config, kubexId }: ConfigSummaryCardsProps) {
  const agent = (config.agent ?? {}) as Record<string, unknown>;
  const capabilities = Array.isArray(agent.capabilities) ? (agent.capabilities as string[]) : [];
  const skills = Array.isArray(agent.skills) ? (agent.skills as string[]) : [];
  const providers = Array.isArray(agent.providers) ? (agent.providers as string[]) : [];
  const boundary = typeof agent.boundary === 'string' ? agent.boundary : null;
  const agentId = typeof agent.id === 'string' ? agent.id : null;

  const hasData = agentId || capabilities.length > 0 || skills.length > 0 || boundary || providers.length > 0;
  if (!hasData) return null;

  return (
    <div
      className="mt-3 grid grid-cols-2 gap-2 text-[11px]"
      data-testid={`kubex-config-summary-${kubexId}`}
    >
      {agentId && (
        <ConfigCard label="Agent ID" testId={`kubex-config-agentid-${kubexId}`}>
          <code className="text-[var(--color-text)] font-mono">{agentId}</code>
        </ConfigCard>
      )}

      {boundary && (
        <ConfigCard label="Boundary" testId={`kubex-config-boundary-${kubexId}`}>
          <code className="text-amber-400 font-mono">{boundary}</code>
        </ConfigCard>
      )}

      {capabilities.length > 0 && (
        <ConfigCard label="Capabilities" testId={`kubex-config-capabilities-${kubexId}`}>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {capabilities.map((cap) => (
              <span
                key={cap}
                className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]"
              >
                {cap}
              </span>
            ))}
          </div>
        </ConfigCard>
      )}

      {skills.length > 0 && (
        <ConfigCard label="Skills" testId={`kubex-config-skills-${kubexId}`}>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {skills.map((skill) => (
              <span
                key={skill}
                className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono text-[10px]"
              >
                {skill}
              </span>
            ))}
          </div>
        </ConfigCard>
      )}

      {providers.length > 0 && (
        <ConfigCard label="Providers" testId={`kubex-config-providers-${kubexId}`}>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {providers.map((p) => (
              <span
                key={p}
                className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono text-[10px]"
              >
                {p}
              </span>
            ))}
          </div>
        </ConfigCard>
      )}
    </div>
  );
}

function ConfigCard({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
      data-testid={testId}
    >
      <div className="text-[9px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
