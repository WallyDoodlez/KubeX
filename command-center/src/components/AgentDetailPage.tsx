import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAgents } from '../api';
import type { Agent } from '../types';
import Tabs from './Tabs';
import StatusBadge from './StatusBadge';
import TerminalOutput from './TerminalOutput';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'live-output', label: 'Live Output' },
  { id: 'actions', label: 'Actions' },
  { id: 'config', label: 'Config' },
];

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const loadAgent = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getAgents();
    if (res.ok && Array.isArray(res.data)) {
      const found = res.data.find((a) => a.agent_id === agentId);
      if (found) {
        setAgent(found);
      } else {
        setError(`Agent "${agentId}" not found`);
      }
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  if (loading) {
    return (
      <div className="p-6 animate-fade-in">
        <div className="h-8 w-48 rounded bg-[#1a1d27] border border-[#2a2f45] animate-pulse mb-4" />
        <div className="h-64 rounded-xl bg-[#1a1d27] border border-[#2a2f45] animate-pulse" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="p-6 animate-fade-in">
        <button onClick={() => navigate('/agents')} className="text-xs text-emerald-400 hover:text-emerald-300 mb-4">
          ← Back to Agents
        </button>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <p className="text-sm text-red-400">{error ?? 'Agent not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      {/* Back link + header */}
      <button onClick={() => navigate('/agents')} className="text-xs text-emerald-400 hover:text-emerald-300 mb-4 inline-block">
        ← Back to Agents
      </button>

      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-lg font-semibold text-[#e2e8f0] font-mono-data">{agent.agent_id}</h2>
        <StatusBadge status={agent.status} />
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && <OverviewTab agent={agent} />}
        {activeTab === 'live-output' && <LiveOutputTab />}
        {activeTab === 'actions' && <ActionsTab agent={agent} />}
        {activeTab === 'config' && <ConfigTab agent={agent} />}
      </Tabs>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────

function OverviewTab({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-4">
      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <InfoCard label="Agent ID" value={agent.agent_id} mono />
        <InfoCard label="Status" value={agent.status} />
        <InfoCard label="Boundary" value={agent.boundary} />
        {agent.registered_at && <InfoCard label="Registered" value={agent.registered_at} mono />}
      </div>

      {/* Capabilities */}
      <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[#3a3f5a] mb-2">Capabilities</p>
        <div className="flex flex-wrap gap-1.5">
          {agent.capabilities.length === 0 ? (
            <span className="text-xs text-[#64748b]">No capabilities registered</span>
          ) : (
            agent.capabilities.map((cap) => (
              <span key={cap} className="text-xs font-mono-data px-2 py-1 rounded-lg bg-[#2a2f45] text-[#94a3b8] border border-[#3a3f5a]">
                {cap}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Metadata */}
      {agent.metadata && Object.keys(agent.metadata).length > 0 && (
        <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-4">
          <p className="text-[10px] uppercase tracking-widest text-[#3a3f5a] mb-2">Metadata</p>
          <pre className="text-xs font-mono-data text-[#94a3b8] bg-[#0f1117] rounded-lg p-3 overflow-x-auto border border-[#2a2f45]">
            {JSON.stringify(agent.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function LiveOutputTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-8 text-center">
        <p className="text-sm text-[#64748b]">
          Live task output will appear here when an agent is actively executing a task.
        </p>
        <p className="text-xs text-[#3a3f5a] mt-2">
          Dispatch a task to this agent via the Orchestrator to see real-time streaming output.
        </p>
      </div>
    </div>
  );
}

function ActionsTab({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-xl border border-dashed border-[#2a2f45] bg-[#1a1d27] p-8 text-center">
      <p className="text-sm text-[#64748b]">
        Action history for <span className="font-mono-data text-[#94a3b8]">{agent.agent_id}</span> will appear here once task tracking is enabled.
      </p>
    </div>
  );
}

function ConfigTab({ agent }: { agent: Agent }) {
  return (
    <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-4">
      <p className="text-[10px] uppercase tracking-widest text-[#3a3f5a] mb-2">Agent Configuration</p>
      <pre className="text-xs font-mono-data text-[#94a3b8] bg-[#0f1117] rounded-lg p-3 overflow-x-auto border border-[#2a2f45]">
        {JSON.stringify({
          agent_id: agent.agent_id,
          status: agent.status,
          boundary: agent.boundary,
          capabilities: agent.capabilities,
          registered_at: agent.registered_at,
          metadata: agent.metadata,
        }, null, 2)}
      </pre>
    </div>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[#2a2f45] bg-[#1a1d27] p-3">
      <p className="text-[10px] uppercase tracking-widest text-[#3a3f5a] mb-1">{label}</p>
      <p className={`text-sm text-[#e2e8f0] ${mono ? 'font-mono-data' : ''} break-all`}>{value}</p>
    </div>
  );
}
