/**
 * SpawnWizard — multi-step wizard to configure and spawn a new Kubex worker.
 *
 * Step 1: Identity (agent ID + boundary)
 * Step 2: Capabilities (from registry + custom)
 * Step 3: Resources (presets + custom)
 * Step 4: Review & Spawn
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAgents, createKubex } from '../api';
import type { CreateKubexBody } from '../types';
import { useToast } from '../context/ToastContext';

// ── Types ────────────────────────────────────────────────────────────

type ResourcePreset = 'light' | 'medium' | 'heavy' | 'custom';

interface ResourceLimits {
  cpu: string;
  memory: string;
}

const PRESETS: Record<Exclude<ResourcePreset, 'custom'>, ResourceLimits> = {
  light:  { cpu: '0.25', memory: '256m' },
  medium: { cpu: '0.5',  memory: '512m' },
  heavy:  { cpu: '1.0',  memory: '1g'   },
};

const PRESET_LABELS: Record<Exclude<ResourcePreset, 'custom'>, { label: string; desc: string }> = {
  light:  { label: 'Light',  desc: '0.25 CPU · 256 MB' },
  medium: { label: 'Medium', desc: '0.5 CPU · 512 MB'  },
  heavy:  { label: 'Heavy',  desc: '1.0 CPU · 1 GB'    },
};

const STEP_LABELS = ['Identity', 'Capabilities', 'Resources', 'Review'];

// ── Validation helpers ───────────────────────────────────────────────

const AGENT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

function validateAgentId(id: string): string | null {
  if (!id.trim()) return 'Agent ID is required.';
  if (!AGENT_ID_RE.test(id.trim())) return 'Only alphanumeric characters and hyphens allowed; must not start with a hyphen.';
  if (id.trim().length < 2) return 'Agent ID must be at least 2 characters.';
  return null;
}

// ── Stepper ──────────────────────────────────────────────────────────

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div data-testid="spawn-stepper" className="flex items-center gap-0 mb-8" role="list" aria-label="Wizard steps">
      {STEP_LABELS.map((label, idx) => {
        const step = idx + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex items-center flex-1" role="listitem">
            {/* Circle */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                data-testid={`step-indicator-${step}`}
                aria-current={active ? 'step' : undefined}
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                  done   ? 'bg-emerald-500 border-emerald-500 text-white'
                  : active ? 'border-emerald-400 text-emerald-400 bg-emerald-500/10'
                           : 'border-[var(--color-border)] text-[var(--color-text-muted)] bg-transparent',
                ].join(' ')}
              >
                {done ? '✓' : step}
              </div>
              <span
                className={[
                  'mt-1 text-[10px] font-medium whitespace-nowrap',
                  active ? 'text-emerald-400' : done ? 'text-emerald-500' : 'text-[var(--color-text-muted)]',
                ].join(' ')}
              >
                {label}
              </span>
            </div>
            {/* Connector — not on last item */}
            {idx < total - 1 && (
              <div
                className={[
                  'flex-1 h-0.5 mx-2 mb-5 rounded transition-all',
                  done ? 'bg-emerald-500' : 'bg-[var(--color-border)]',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Identity ─────────────────────────────────────────────────

interface Step1Props {
  agentId: string;
  boundary: string;
  onAgentId: (v: string) => void;
  onBoundary: (v: string) => void;
  error: string | null;
}

function StepIdentity({ agentId, boundary, onAgentId, onBoundary, error }: Step1Props) {
  return (
    <div data-testid="step-identity" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-0.5">Agent Identity</h2>
        <p className="text-xs text-[var(--color-text-dim)]">Define a unique ID and the namespace boundary for this Kubex worker.</p>
      </div>

      <div className="space-y-4">
        {/* Agent ID */}
        <div>
          <label
            htmlFor="spawn-agent-id"
            className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5"
          >
            Agent ID <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <input
            id="spawn-agent-id"
            data-testid="agent-id-input"
            type="text"
            value={agentId}
            onChange={(e) => onAgentId(e.target.value)}
            placeholder="e.g. data-extractor-01"
            aria-required="true"
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'agent-id-error' : undefined}
            className={[
              'w-full px-3 py-2 rounded-lg text-sm font-mono',
              'bg-[var(--color-surface)] border',
              'text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
              'focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:border-emerald-500/60 transition-all',
              error ? 'border-red-500/60' : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]',
            ].join(' ')}
          />
          {error && (
            <p id="agent-id-error" role="alert" data-testid="agent-id-error" className="mt-1 text-xs text-red-400">
              {error}
            </p>
          )}
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Alphanumeric and hyphens only. Used as the container name.</p>
        </div>

        {/* Boundary */}
        <div>
          <label
            htmlFor="spawn-boundary"
            className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5"
          >
            Boundary / Namespace
          </label>
          <input
            id="spawn-boundary"
            data-testid="boundary-input"
            type="text"
            value={boundary}
            onChange={(e) => onBoundary(e.target.value)}
            placeholder="default"
            className={[
              'w-full px-3 py-2 rounded-lg text-sm font-mono',
              'bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)]',
              'text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
              'focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:border-emerald-500/60 transition-all',
            ].join(' ')}
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Logical grouping / isolation boundary. Leave empty for "default".</p>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Capabilities ─────────────────────────────────────────────

interface Step2Props {
  selected: string[];
  onToggle: (cap: string) => void;
  knownCaps: string[];
  loading: boolean;
  customInput: string;
  onCustomInput: (v: string) => void;
  onAddCustom: () => void;
  error: string | null;
}

function StepCapabilities({ selected, onToggle, knownCaps, loading, customInput, onCustomInput, onAddCustom, error }: Step2Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAddCustom();
    }
  }

  return (
    <div data-testid="step-capabilities" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-0.5">Capabilities</h2>
        <p className="text-xs text-[var(--color-text-dim)]">Select the capabilities this Kubex can handle. At least one is required.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] py-4">
          <span className="animate-spin">⟳</span>
          <span>Loading known capabilities from registry…</span>
        </div>
      ) : (
        <div>
          {knownCaps.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Known capabilities</p>
              <div
                data-testid="capability-chips"
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Known capabilities"
              >
                {knownCaps.map((cap) => {
                  const active = selected.includes(cap);
                  return (
                    <button
                      key={cap}
                      data-testid={`cap-chip-${cap}`}
                      onClick={() => onToggle(cap)}
                      aria-pressed={active}
                      className={[
                        'px-2.5 py-1 rounded-full text-xs font-medium border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
                        active
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)]',
                      ].join(' ')}
                    >
                      {active && <span aria-hidden="true" className="mr-1">✓</span>}
                      {cap}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom capability input */}
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Add custom capability</p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                data-testid="custom-capability-input"
                type="text"
                value={customInput}
                onChange={(e) => onCustomInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. file-analysis"
                className={[
                  'flex-1 px-3 py-2 rounded-lg text-sm font-mono',
                  'bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)]',
                  'text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
                  'focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:border-emerald-500/60 transition-all',
                ].join(' ')}
              />
              <button
                data-testid="add-capability-btn"
                onClick={onAddCustom}
                disabled={!customInput.trim()}
                className={[
                  'px-3 py-2 rounded-lg text-xs font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
                  customInput.trim()
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
                    : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed opacity-50',
                ].join(' ')}
              >
                Add
              </button>
            </div>
          </div>

          {/* Selected summary */}
          {selected.length > 0 && (
            <div className="mt-4 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
              <p className="text-[11px] font-semibold text-emerald-400 mb-1.5">Selected ({selected.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {selected.map((cap) => (
                  <span
                    key={cap}
                    data-testid={`selected-cap-${cap}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  >
                    {cap}
                    <button
                      onClick={() => onToggle(cap)}
                      aria-label={`Remove ${cap}`}
                      className="text-emerald-500 hover:text-red-400 transition-colors leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" data-testid="capabilities-error" className="mt-2 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 3: Resources ────────────────────────────────────────────────

interface Step3Props {
  preset: ResourcePreset;
  onPreset: (p: ResourcePreset) => void;
  customCpu: string;
  customMemory: string;
  onCustomCpu: (v: string) => void;
  onCustomMemory: (v: string) => void;
}

function StepResources({ preset, onPreset, customCpu, customMemory, onCustomCpu, onCustomMemory }: Step3Props) {
  const presetKeys: Exclude<ResourcePreset, 'custom'>[] = ['light', 'medium', 'heavy'];

  return (
    <div data-testid="step-resources" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-0.5">Resource Limits</h2>
        <p className="text-xs text-[var(--color-text-dim)]">Choose a resource profile for this Kubex worker.</p>
      </div>

      <div
        data-testid="resource-presets"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        role="radiogroup"
        aria-label="Resource presets"
      >
        {presetKeys.map((p) => {
          const active = preset === p;
          const info = PRESET_LABELS[p];
          return (
            <button
              key={p}
              data-testid={`preset-${p}`}
              role="radio"
              aria-checked={active}
              onClick={() => onPreset(p)}
              className={[
                'flex flex-col items-start gap-1 p-4 rounded-lg border-2 text-left transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
                active
                  ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
                  : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              <span className="text-sm font-semibold">{info.label}</span>
              <span className="text-[11px] font-mono">{info.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Custom option */}
      <button
        data-testid="preset-custom"
        role="radio"
        aria-checked={preset === 'custom'}
        onClick={() => onPreset('custom')}
        className={[
          'w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-left transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
          preset === 'custom'
            ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
            : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-border-hover)]',
        ].join(' ')}
      >
        <span className="text-sm font-semibold">Custom</span>
        <span className="text-[11px] font-mono text-[var(--color-text-muted)]">Define your own limits</span>
      </button>

      {/* Custom inputs */}
      {preset === 'custom' && (
        <div
          data-testid="custom-resource-inputs"
          className="grid grid-cols-2 gap-4 mt-1 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)]"
        >
          <div>
            <label htmlFor="spawn-cpu" className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5">
              CPU (cores)
            </label>
            <input
              id="spawn-cpu"
              data-testid="custom-cpu-input"
              type="text"
              value={customCpu}
              onChange={(e) => onCustomCpu(e.target.value)}
              placeholder="0.5"
              className={[
                'w-full px-3 py-2 rounded-lg text-sm font-mono',
                'bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)]',
                'text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
                'focus:outline-none focus:ring-2 focus:ring-emerald-500/60 transition-all',
              ].join(' ')}
            />
          </div>
          <div>
            <label htmlFor="spawn-memory" className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5">
              Memory
            </label>
            <input
              id="spawn-memory"
              data-testid="custom-memory-input"
              type="text"
              value={customMemory}
              onChange={(e) => onCustomMemory(e.target.value)}
              placeholder="512m"
              className={[
                'w-full px-3 py-2 rounded-lg text-sm font-mono',
                'bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)]',
                'text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
                'focus:outline-none focus:ring-2 focus:ring-emerald-500/60 transition-all',
              ].join(' ')}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Review & Spawn ───────────────────────────────────────────

interface Step4Props {
  config: CreateKubexBody;
  onSpawn: () => void;
  spawning: boolean;
  spawnResult: { ok: boolean; kubexId?: string; error?: string } | null;
  onSpawnAnother: () => void;
}

function StepReview({ config, onSpawn, spawning, spawnResult, onSpawnAnother }: Step4Props) {
  const navigate = useNavigate();
  const jsonPreview = JSON.stringify(config, null, 2);

  if (spawnResult?.ok && spawnResult.kubexId) {
    return (
      <div data-testid="spawn-success" className="flex flex-col items-center gap-5 py-6 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center text-2xl">
          ✓
        </div>
        <div>
          <p className="text-base font-semibold text-emerald-400">Kubex spawned successfully!</p>
          <p className="mt-1 text-xs text-[var(--color-text-dim)]">
            Kubex ID:{' '}
            <code data-testid="spawned-kubex-id" className="font-mono text-emerald-300">
              {spawnResult.kubexId}
            </code>
          </p>
        </div>
        <div className="flex gap-3">
          <button
            data-testid="view-containers-btn"
            onClick={() => navigate('/containers')}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          >
            View in Containers
          </button>
          <button
            data-testid="spawn-another-btn"
            onClick={onSpawnAnother}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
          >
            Spawn Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="step-review" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-0.5">Review & Spawn</h2>
        <p className="text-xs text-[var(--color-text-dim)]">Review the configuration below, then click Spawn Kubex to create the worker.</p>
      </div>

      {/* JSON preview */}
      <div className="relative">
        <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Configuration</p>
        <pre
          data-testid="config-json-preview"
          className={[
            'p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-dark)]',
            'text-xs font-mono-data text-[var(--color-text-secondary)] overflow-x-auto',
            'max-h-64 overflow-y-auto scrollbar-thin',
          ].join(' ')}
        >
          {jsonPreview}
        </pre>
      </div>

      {/* Error state */}
      {spawnResult && !spawnResult.ok && (
        <div
          role="alert"
          data-testid="spawn-error"
          className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-400"
        >
          <p className="font-semibold">Spawn failed</p>
          <p className="mt-0.5 font-mono">{spawnResult.error}</p>
        </div>
      )}

      {/* Spawn button */}
      <button
        data-testid="spawn-button"
        onClick={onSpawn}
        disabled={spawning}
        className={[
          'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold border-2 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
          spawning
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500/50 cursor-not-allowed'
            : 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-500',
        ].join(' ')}
        aria-busy={spawning}
      >
        {spawning ? (
          <>
            <span className="animate-spin text-base" aria-hidden="true">⟳</span>
            <span>Spawning…</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">+</span>
            <span>Spawn Kubex</span>
          </>
        )}
      </button>
    </div>
  );
}

// ── Main wizard ──────────────────────────────────────────────────────

function buildConfig(
  agentId: string,
  boundary: string,
  capabilities: string[],
  preset: ResourcePreset,
  customCpu: string,
  customMemory: string,
): CreateKubexBody {
  const limits = preset === 'custom'
    ? { cpu: customCpu || '0.5', memory: customMemory || '512m' }
    : PRESETS[preset];

  return {
    config: {
      agent: {
        id: agentId.trim(),
        boundary: boundary.trim() || 'default',
        capabilities,
        providers: ['claude-code'],
      },
    },
    resource_limits: { cpu: limits.cpu, memory: limits.memory },
    image: 'kubexclaw-base:latest',
    skill_mounts: [],
  };
}

export default function SpawnWizard() {
  const { addToast } = useToast();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [agentId, setAgentId] = useState('');
  const [boundary, setBoundary] = useState('default');
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2 state
  const [knownCaps, setKnownCaps] = useState<string[]>([]);
  const [capsLoading, setCapsLoading] = useState(false);
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [customCapInput, setCustomCapInput] = useState('');
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3 state
  const [preset, setPreset] = useState<ResourcePreset>('medium');
  const [customCpu, setCustomCpu] = useState('0.5');
  const [customMemory, setCustomMemory] = useState('512m');

  // Step 4 state
  const [spawning, setSpawning] = useState(false);
  const [spawnResult, setSpawnResult] = useState<{ ok: boolean; kubexId?: string; error?: string } | null>(null);

  // Fetch known capabilities when entering step 2
  useEffect(() => {
    if (step === 2 && knownCaps.length === 0 && !capsLoading) {
      setCapsLoading(true);
      getAgents()
        .then((res) => {
          if (res.ok && res.data) {
            const caps = Array.from(
              new Set(res.data.flatMap((a) => a.capabilities ?? []))
            ).sort();
            setKnownCaps(caps);
          }
        })
        .finally(() => setCapsLoading(false));
    }
  }, [step, knownCaps.length, capsLoading]);

  const toggleCap = useCallback((cap: string) => {
    setSelectedCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  }, []);

  const addCustomCap = useCallback(() => {
    const trimmed = customCapInput.trim();
    if (!trimmed) return;
    if (!selectedCaps.includes(trimmed)) {
      setSelectedCaps((prev) => [...prev, trimmed]);
      if (!knownCaps.includes(trimmed)) {
        setKnownCaps((prev) => [...prev, trimmed].sort());
      }
    }
    setCustomCapInput('');
  }, [customCapInput, selectedCaps, knownCaps]);

  function handleNext() {
    if (step === 1) {
      const err = validateAgentId(agentId);
      setStep1Error(err);
      if (err) return;
    }
    if (step === 2) {
      if (selectedCaps.length === 0) {
        setStep2Error('Select or add at least one capability.');
        return;
      }
      setStep2Error(null);
    }
    setStep((s) => s + 1);
  }

  function handleBack() {
    setStep((s) => s - 1);
  }

  async function handleSpawn() {
    setSpawning(true);
    setSpawnResult(null);
    const body = buildConfig(agentId, boundary, selectedCaps, preset, customCpu, customMemory);
    const res = await createKubex(body);
    setSpawning(false);
    if (res.ok && res.data) {
      setSpawnResult({ ok: true, kubexId: res.data.kubex_id });
      addToast(`Kubex spawned — ${res.data.kubex_id}`, 'success');
    } else {
      const errMsg = res.error ?? 'Unknown error from Manager.';
      setSpawnResult({ ok: false, error: errMsg });
      addToast(`Spawn failed: ${errMsg}`, 'error');
    }
  }

  function handleSpawnAnother() {
    setStep(1);
    setAgentId('');
    setBoundary('default');
    setStep1Error(null);
    setSelectedCaps([]);
    setCustomCapInput('');
    setStep2Error(null);
    setPreset('medium');
    setCustomCpu('0.5');
    setCustomMemory('512m');
    setSpawnResult(null);
    setSpawning(false);
  }

  const currentConfig = buildConfig(agentId, boundary, selectedCaps, preset, customCpu, customMemory);
  const isLastStep = step === 4;
  const isFirstStep = step === 1;

  return (
    <div
      data-testid="spawn-wizard"
      className="flex-1 p-4 md:p-8 overflow-y-auto"
    >
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[var(--color-text)]">Spawn Kubex Wizard</h1>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">Configure and deploy a new Kubex worker agent.</p>
        </div>

        {/* Stepper */}
        <Stepper current={step} total={STEP_LABELS.length} />

        {/* Step panel */}
        <div
          className="p-5 md:p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-dark)]"
        >
          {step === 1 && (
            <StepIdentity
              agentId={agentId}
              boundary={boundary}
              onAgentId={(v) => { setAgentId(v); setStep1Error(null); }}
              onBoundary={setBoundary}
              error={step1Error}
            />
          )}
          {step === 2 && (
            <StepCapabilities
              selected={selectedCaps}
              onToggle={toggleCap}
              knownCaps={knownCaps}
              loading={capsLoading}
              customInput={customCapInput}
              onCustomInput={setCustomCapInput}
              onAddCustom={addCustomCap}
              error={step2Error}
            />
          )}
          {step === 3 && (
            <StepResources
              preset={preset}
              onPreset={setPreset}
              customCpu={customCpu}
              customMemory={customMemory}
              onCustomCpu={setCustomCpu}
              onCustomMemory={setCustomMemory}
            />
          )}
          {step === 4 && (
            <StepReview
              config={currentConfig}
              onSpawn={handleSpawn}
              spawning={spawning}
              spawnResult={spawnResult}
              onSpawnAnother={handleSpawnAnother}
            />
          )}
        </div>

        {/* Navigation buttons */}
        {!(step === 4 && spawnResult?.ok) && (
          <div className="flex items-center justify-between mt-5">
            <button
              data-testid="wizard-back-btn"
              onClick={handleBack}
              disabled={isFirstStep}
              className={[
                'px-4 py-2 rounded-lg text-sm font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60',
                isFirstStep
                  ? 'border-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed opacity-40'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text)]',
              ].join(' ')}
            >
              ← Back
            </button>

            {!isLastStep && (
              <button
                data-testid="wizard-next-btn"
                onClick={handleNext}
                className="px-5 py-2 rounded-lg text-sm font-semibold border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 hover:border-emerald-500/60 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
              >
                Next →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
