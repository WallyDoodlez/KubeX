import { useMemo } from 'react';
import type { Agent } from '../types';

interface CapabilityMatrixProps {
  agents: Agent[];
}

/**
 * CapabilityMatrix — visual grid showing agents vs capabilities.
 *
 * Rows = agents, Columns = all unique capabilities across the fleet.
 * Cells are filled (✓ with accent) when the agent has the capability,
 * empty otherwise. A count row at the top shows coverage per capability.
 */
export default function CapabilityMatrix({ agents }: CapabilityMatrixProps) {
  // Derive the sorted unique capability list from all agents
  const capabilities = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        set.add(cap);
      }
    }
    return Array.from(set).sort();
  }, [agents]);

  // Per-capability agent count (for the coverage row)
  const countPerCap = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const cap of capabilities) {
      counts[cap] = agents.filter((a) => a.capabilities.includes(cap)).length;
    }
    return counts;
  }, [agents, capabilities]);

  if (agents.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="capability-matrix"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Capability Matrix</h2>
          <p
            className="text-xs text-[var(--color-text-dim)]"
            data-testid="capability-matrix-subtitle"
          >
            {agents.length} agent{agents.length !== 1 ? 's' : ''} · {capabilities.length} unique{' '}
            {capabilities.length !== 1 ? 'capabilities' : 'capability'}
          </p>
        </div>
      </div>

      {/* Scrollable table wrapper */}
      <div className="overflow-x-auto">
        <table
          role="grid"
          aria-label="Agent capability matrix"
          data-testid="capability-matrix-table"
          className="w-full text-xs border-collapse"
        >
          {/* Column headers — one per capability */}
          <thead>
            {/* Coverage count row */}
            <tr className="border-b border-[var(--color-border)]">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[160px] max-w-[220px] px-4 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-[var(--color-text-muted)] bg-[var(--color-surface-dark)]"
              >
                Agent
              </th>
              {capabilities.map((cap) => (
                <th
                  key={cap}
                  scope="col"
                  className="min-w-[100px] px-2 py-2 text-center align-bottom bg-[var(--color-surface-dark)]"
                >
                  {/* Rotated label */}
                  <div
                    className="flex flex-col items-center gap-1"
                    data-testid={`capability-col-${cap}`}
                  >
                    <span
                      className="font-mono-data text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] whitespace-nowrap"
                      title={cap}
                    >
                      {cap}
                    </span>
                    <span
                      className="font-mono-data text-[11px] font-bold text-emerald-400"
                      aria-label={`${countPerCap[cap]} of ${agents.length} agents`}
                      data-testid={`capability-count-${cap}`}
                    >
                      {countPerCap[cap]}/{agents.length}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Agent rows */}
          <tbody>
            {agents.map((agent, idx) => {
              const isLast = idx === agents.length - 1;
              return (
                <tr
                  key={agent.agent_id}
                  className={`${!isLast ? 'border-b border-[var(--color-border)]' : ''} hover:bg-[var(--color-surface-hover)] transition-colors`}
                  data-testid={`capability-matrix-row-${agent.agent_id}`}
                >
                  {/* Agent ID cell */}
                  <td
                    className="sticky left-0 z-10 px-4 py-2.5 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <AgentStatusDot status={agent.status} />
                      <span
                        className="font-mono-data text-xs text-[var(--color-text)] truncate"
                        title={agent.agent_id}
                      >
                        {agent.agent_id}
                      </span>
                    </div>
                  </td>

                  {/* Capability cells */}
                  {capabilities.map((cap) => {
                    const has = agent.capabilities.includes(cap);
                    return (
                      <td
                        key={cap}
                        className="px-2 py-2.5 text-center"
                        aria-label={`${agent.agent_id} ${has ? 'has' : 'does not have'} ${cap}`}
                        data-testid={`cell-${agent.agent_id}-${cap}`}
                      >
                        {has ? (
                          <span
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--color-text-muted)] text-[11px]"
                            aria-hidden="true"
                          >
                            –
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function AgentStatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    running: 'bg-emerald-400',
    idle: 'bg-blue-400',
    busy: 'bg-amber-400',
    stopped: 'bg-slate-500',
    booting: 'bg-cyan-400',
    credential_wait: 'bg-purple-400',
    ready: 'bg-emerald-400',
  };
  const color = colorMap[status] ?? 'bg-slate-400';
  return (
    <span
      className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${color}`}
      aria-hidden="true"
      title={status}
    />
  );
}
