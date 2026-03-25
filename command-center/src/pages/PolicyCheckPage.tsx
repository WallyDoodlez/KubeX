import { useState, useRef, useEffect, useCallback } from 'react';
import { checkSkillPolicy } from '../api';
import type { PolicyDecision, SkillCheckResponse } from '../types';
import { useAppContext } from '../context/AppContext';

// ── Types ─────────────────────────────────────────────────────────────

interface CheckRecord {
  id: string;
  agent_id: string;
  skills: string[];
  result: SkillCheckResponse;
  timestamp: Date;
}

// ── Decision styling helpers ──────────────────────────────────────────

const DECISION_STYLES: Record<
  PolicyDecision,
  { color: string; bg: string; border: string; icon: string; label: string }
> = {
  ALLOW: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    icon: '✓',
    label: 'ALLOW',
  },
  ESCALATE: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    icon: '⚑',
    label: 'ESCALATE',
  },
  DENY: {
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    icon: '✗',
    label: 'DENY',
  },
};

// ── Component ─────────────────────────────────────────────────────────

export default function PolicyCheckPage() {
  const [agentId, setAgentId] = useState('');
  const [skillsRaw, setSkillsRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CheckRecord[]>([]);
  const agentInputRef = useRef<HTMLInputElement>(null);
  const { trafficLog } = useAppContext();

  // Pre-populate agent dropdown options from traffic log
  const knownAgentIds = [...new Set(trafficLog.map((e) => e.agent_id))].filter(Boolean);

  // Focus agent ID field on mount
  useEffect(() => {
    agentInputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedAgent = agentId.trim();
      const skills = skillsRaw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (!trimmedAgent) {
        setError('Agent ID is required.');
        return;
      }
      if (skills.length === 0) {
        setError('At least one skill is required.');
        return;
      }

      setError(null);
      setLoading(true);

      const res = await checkSkillPolicy({ agent_id: trimmedAgent, skills });

      setLoading(false);

      if (res.ok && res.data) {
        const record: CheckRecord = {
          id: crypto.randomUUID(),
          agent_id: trimmedAgent,
          skills,
          result: res.data,
          timestamp: new Date(),
        };
        setHistory((prev) => [record, ...prev]);
      } else {
        setError(res.error ?? `Gateway returned HTTP ${res.status}`);
      }
    },
    [agentId, skillsRaw],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  return (
    <div
      className="p-6 max-w-3xl mx-auto animate-fade-in"
      data-testid="policy-check-page"
    >
      {/* Page header */}
      <div className="mb-6">
        <h2
          className="text-lg font-semibold text-[var(--color-text)] mb-1"
          data-testid="policy-check-heading"
        >
          Policy Skill Check
        </h2>
        <p className="text-sm text-[var(--color-text-dim)]">
          Verify whether an agent is allowed to use a set of skills according
          to its Gateway policy. Uses{' '}
          <code className="font-mono text-xs bg-[var(--color-surface)] px-1 py-0.5 rounded">
            POST /policy/skill-check
          </code>
          .
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6 space-y-4"
        data-testid="policy-check-form"
        aria-label="Policy skill check form"
      >
        {/* Agent ID */}
        <div className="space-y-1.5">
          <label
            htmlFor="policy-agent-id"
            className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]"
          >
            Agent ID
          </label>
          <input
            id="policy-agent-id"
            ref={agentInputRef}
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            list="policy-agent-datalist"
            placeholder="e.g. agent-alpha-001"
            data-testid="policy-agent-id-input"
            disabled={loading}
            autoComplete="off"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-60 transition-colors font-mono"
          />
          {/* Datalist suggestions from traffic log */}
          <datalist id="policy-agent-datalist">
            {knownAgentIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </div>

        {/* Skills */}
        <div className="space-y-1.5">
          <label
            htmlFor="policy-skills"
            className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]"
          >
            Skills
            <span className="ml-1 normal-case text-[var(--color-text-dim)] tracking-normal font-normal">
              — comma or newline separated
            </span>
          </label>
          <textarea
            id="policy-skills"
            value={skillsRaw}
            onChange={(e) => setSkillsRaw(e.target.value)}
            placeholder="e.g. summarise, classify&#10;extract"
            rows={3}
            data-testid="policy-skills-input"
            disabled={loading}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-60 transition-colors font-mono resize-y"
          />
        </div>

        {/* Error */}
        {error && (
          <p
            role="alert"
            data-testid="policy-check-error"
            className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          data-testid="policy-check-submit"
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span aria-hidden="true" className="animate-spin text-base leading-none">⟳</span>
              Checking…
            </>
          ) : (
            <>
              <span aria-hidden="true">⚙</span>
              Check Policy
            </>
          )}
        </button>
      </form>

      {/* Results history */}
      {history.length > 0 && (
        <section aria-label="Policy check results" data-testid="policy-check-results">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)]">
              Results
            </h3>
            <button
              onClick={clearHistory}
              data-testid="policy-check-clear"
              className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded"
            >
              Clear
            </button>
          </div>

          <ul className="space-y-3" role="list">
            {history.map((record) => {
              const style =
                DECISION_STYLES[record.result.decision] ?? DECISION_STYLES.ESCALATE;
              return (
                <li
                  key={record.id}
                  data-testid="policy-check-result-item"
                  className={`rounded-xl border ${style.border} ${style.bg} p-4`}
                >
                  {/* Decision badge + agent */}
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      data-testid="policy-result-decision"
                      className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${style.color} ${style.bg} ${style.border}`}
                    >
                      <span aria-hidden="true">{style.icon}</span>
                      {style.label}
                    </span>
                    <span
                      className="text-xs font-mono text-[var(--color-text-secondary)]"
                      data-testid="policy-result-agent-id"
                    >
                      {record.agent_id}
                    </span>
                    <span className="ml-auto text-[10px] text-[var(--color-text-muted)] font-mono-data">
                      {record.timestamp.toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Skills checked */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {record.skills.map((skill) => (
                      <span
                        key={skill}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-dim)] font-mono"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>

                  {/* Reason */}
                  <p
                    data-testid="policy-result-reason"
                    className="text-xs text-[var(--color-text-secondary)]"
                  >
                    {record.result.reason}
                  </p>

                  {/* Rule matched */}
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)] font-mono">
                    rule: {record.result.rule_matched}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {history.length === 0 && (
        <div
          data-testid="policy-check-empty"
          className="text-center py-12 text-[var(--color-text-dim)] text-sm"
        >
          <p className="text-2xl mb-2" aria-hidden="true">⚙</p>
          <p>Fill in an agent ID and skills above, then click Check Policy.</p>
        </div>
      )}
    </div>
  );
}
