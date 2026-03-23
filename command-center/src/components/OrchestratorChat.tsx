import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import CopyButton from './CopyButton';
import { dispatchTask, getTaskResult, getAgents, getTaskStreamUrl, provideInput } from '../api';
import type { ChatMessage, TrafficEntry, Agent } from '../types';
import { validateCapability, validateMessage } from '../utils/validation';
import { useSSE } from '../hooks/useSSE';
import type { SSEStatus } from '../hooks/useSSE';
import TerminalOutput from './TerminalOutput';
import type { OutputLine } from './TerminalOutput';
import HITLPrompt from './HITLPrompt';
import ExportMenu from './ExportMenu';
import { exportAsJSON } from '../utils/export';
import RelativeTime from './RelativeTime';

interface OrchestratorChatProps {
  onTrafficEntry: (entry: TrafficEntry) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export default function OrchestratorChat({ onTrafficEntry, messages, setMessages }: OrchestratorChatProps) {
  const [capability, setCapability] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [knownCaps, setKnownCaps] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Chat search / filter state
  const [chatSearch, setChatSearch] = useState('');
  const [chatRoleFilter, setChatRoleFilter] = useState<'all' | 'user' | 'result' | 'error' | 'system'>('all');
  const isFiltering = chatSearch.trim() !== '' || chatRoleFilter !== 'all';

  // SSE state
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<OutputLine[]>([]);
  const [hitlRequest, setHitlRequest] = useState<{ taskId: string; prompt: string } | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeCapRef = useRef<string>('');

  // Load known capabilities from registry
  const loadCaps = useCallback(async () => {
    const res = await getAgents();
    if (res.ok && Array.isArray(res.data)) {
      const caps = (res.data as Agent[]).flatMap((a) => a.capabilities);
      setKnownCaps([...new Set(caps)]);
    }
  }, []);

  useEffect(() => {
    loadCaps();
  }, [loadCaps]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function addMessage(msg: Omit<ChatMessage, 'id'>) {
    const id = crypto.randomUUID();
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }

  // Clear chat messages (keeps welcome message)
  function handleClearChat() {
    setMessages((prev) => prev.slice(0, 1));
  }

  // SSE message handler
  const handleSSEMessage = useCallback((data: { type: string; [key: string]: unknown }) => {
    const taskId = activeTaskIdRef.current;
    const cap = activeCapRef.current;

    if (data.type === 'stdout' || data.type === 'stderr') {
      setTerminalLines((prev) => [
        ...prev,
        {
          text: (data.text as string) ?? (data.data as string) ?? JSON.stringify(data),
          stream: data.type as 'stdout' | 'stderr',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      return;
    }

    if (data.type === 'hitl_request') {
      const prompt = (data.prompt as string) ?? (data.message as string) ?? 'Input required';
      if (taskId) {
        setHitlRequest({ taskId, prompt });
        setTerminalLines((prev) => [
          ...prev,
          { text: `[HITL] ${prompt}`, stream: 'system', timestamp: new Date().toLocaleTimeString() },
        ]);
      }
      return;
    }

    if (data.type === 'result' || data.type === 'completed') {
      setSending(false);
      setStreamUrl(null);
      setHitlRequest(null);

      const resultText =
        typeof data.result === 'string'
          ? data.result
          : data.result !== undefined
          ? JSON.stringify(data.result, null, 2)
          : JSON.stringify(data, null, 2);

      addMessage({
        role: 'result',
        content: resultText,
        timestamp: new Date(),
        task_id: taskId ?? undefined,
        raw: data,
      });

      onTrafficEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        agent_id: 'orchestrator',
        action: 'task_result',
        capability: cap,
        status: 'allowed',
        task_id: taskId ?? undefined,
      });
      return;
    }

    if (data.type === 'failed' || data.type === 'cancelled') {
      setSending(false);
      setStreamUrl(null);
      setHitlRequest(null);

      const reason =
        (data.error as string) ??
        (data.reason as string) ??
        (data.message as string) ??
        data.type;

      addMessage({
        role: 'error',
        content: `Task ${data.type}: ${reason}`,
        timestamp: new Date(),
        task_id: taskId ?? undefined,
      });

      onTrafficEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        agent_id: 'orchestrator',
        action: 'task_result',
        capability: cap,
        status: 'escalated',
        task_id: taskId ?? undefined,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE complete / error → fallback retry loop (3-5 attempts at 2s intervals)
  const handleSSEComplete = useCallback(async () => {
    const taskId = activeTaskIdRef.current;
    const cap = activeCapRef.current;
    if (!taskId) return;

    // Only do fallback poll if we haven't already received a terminal event
    // (sending will be false if SSE already handled it)
    setSending((prev) => {
      if (!prev) return prev; // already done
      // Kick off fallback retry loop
      (async () => {
        const MAX_ATTEMPTS = 4;
        const RETRY_INTERVAL_MS = 2000;
        let resolved = false;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (attempt > 1) {
            // Wait before retrying
            await new Promise<void>((res) => setTimeout(res, RETRY_INTERVAL_MS));
          }

          const rr = await getTaskResult(taskId);

          // If the task completed (or failed/cancelled with a result), surface it
          if (rr.ok && rr.data && (rr.data.status === 'completed' || rr.data.status === 'failed' || rr.data.status === 'cancelled')) {
            const resultText =
              typeof rr.data.result === 'string'
                ? rr.data.result
                : rr.data.result !== undefined
                ? JSON.stringify(rr.data.result, null, 2)
                : JSON.stringify(rr.data, null, 2);

            setMessages((msgs) => [
              ...msgs,
              {
                id: crypto.randomUUID(),
                role: rr.data!.status === 'completed' ? 'result' : 'error',
                content: rr.data!.status === 'completed' ? resultText : `Task ${rr.data!.status}: ${resultText}`,
                timestamp: new Date(),
                task_id: taskId,
                raw: rr.data,
              } as ChatMessage,
            ]);

            onTrafficEntry({
              id: crypto.randomUUID(),
              timestamp: new Date(),
              agent_id: 'orchestrator',
              action: 'task_result',
              capability: cap,
              status: rr.data!.status === 'completed' ? 'allowed' : 'escalated',
              task_id: taskId,
            });

            resolved = true;
            break;
          }
        }

        if (!resolved) {
          // All retries exhausted — task still pending or unreachable
          setMessages((msgs) => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              role: 'error',
              content: `Stream ended without result for task ${taskId}. The task may still be running — check Task History for its status.`,
              timestamp: new Date(),
              task_id: taskId,
            } as ChatMessage,
          ]);
        }

        setStreamUrl(null);
        setHitlRequest(null);
      })();
      return false;
    });
  }, [onTrafficEntry, setMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status: sseStatus } = useSSE({
    url: streamUrl,
    onMessage: handleSSEMessage,
    onComplete: handleSSEComplete,
  });

  // Derive spinner label from SSE status
  function sendingLabel(status: SSEStatus): string {
    if (status === 'connecting') return 'Connecting…';
    if (status === 'open') return 'Streaming…';
    if (status === 'closed' || status === 'error') return 'Waiting for result…';
    return 'Dispatching…';
  }

  async function handleSend() {
    const cap = capability.trim();
    const msg = message.trim();
    if (!cap || !msg || sending) return;

    const capValidation = validateCapability(cap);
    const msgValidation = validateMessage(msg);
    if (!capValidation.valid || !msgValidation.valid) {
      setCapError(capValidation.error ?? null);
      setMsgError(msgValidation.error ?? null);
      return;
    }
    setCapError(null);
    setMsgError(null);

    setSending(true);
    setTerminalLines([]);
    setHitlRequest(null);

    // Add user bubble
    addMessage({
      role: 'user',
      content: `[${cap}] ${msg}`,
      timestamp: new Date(),
    });

    setCapability('');
    setMessage('');

    // Dispatch
    const res = await dispatchTask(cap, msg);

    if (!res.ok || !res.data) {
      addMessage({
        role: 'error',
        content: `Dispatch failed: ${res.error ?? `HTTP ${res.status}`}`,
        timestamp: new Date(),
      });

      onTrafficEntry({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        agent_id: 'command-center',
        action: 'dispatch_task',
        capability: cap,
        status: 'denied',
        policy_rule: res.error ?? `HTTP ${res.status}`,
      });

      setSending(false);
      return;
    }

    const taskId = res.data.task_id;
    activeTaskIdRef.current = taskId;
    activeCapRef.current = cap;

    addMessage({
      role: 'system',
      content: `Task dispatched — ID: ${taskId}`,
      timestamp: new Date(),
      task_id: taskId,
    });

    onTrafficEntry({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      agent_id: 'command-center',
      action: 'dispatch_task',
      capability: cap,
      status: 'allowed',
      task_id: taskId,
    });

    // Connect SSE stream
    setStreamUrl(getTaskStreamUrl(taskId));
  }

  async function handleHITLSubmit(taskId: string, input: string) {
    setHitlRequest(null);
    setTerminalLines((prev) => [
      ...prev,
      { text: `[You] ${input}`, stream: 'system', timestamp: new Date().toLocaleTimeString() },
    ]);
    await provideInput(taskId, input);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  }

  // Filtered messages for search / role filter
  const filteredMessages = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    return messages.filter((m) => {
      const roleMatch = chatRoleFilter === 'all' || m.role === chatRoleFilter;
      const textMatch = needle === '' || m.content.toLowerCase().includes(needle) || (m.task_id ?? '').toLowerCase().includes(needle);
      return roleMatch && textMatch;
    });
  }, [messages, chatSearch, chatRoleFilter]);

  const isStreaming = streamUrl !== null && (sseStatus === 'connecting' || sseStatus === 'open');

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ maxHeight: 'calc(100vh - 48px)' }}>
      {/* Search / filter toolbar */}
      <div
        data-testid="chat-search-toolbar"
        className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-dark)]"
      >
        {/* Search input */}
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            data-testid="chat-search-input"
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            placeholder="Search messages…"
            aria-label="Search chat messages"
            className="
              w-full pl-7 pr-7 py-1.5 rounded-lg text-xs
              bg-[var(--color-surface)] border border-[var(--color-border)]
              text-[var(--color-text)] placeholder-[var(--color-text-muted)]
              focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
              transition-colors
            "
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] text-xs pointer-events-none" aria-hidden="true">
            ⌕
          </span>
          {chatSearch && (
            <button
              onClick={() => setChatSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] hover:text-[var(--color-text)] text-xs transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Role filter */}
        <select
          data-testid="chat-role-filter"
          value={chatRoleFilter}
          onChange={(e) => setChatRoleFilter(e.target.value as typeof chatRoleFilter)}
          aria-label="Filter by message type"
          className="
            text-xs px-2 py-1.5 rounded-lg
            bg-[var(--color-surface)] border border-[var(--color-border)]
            text-[var(--color-text)]
            focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
            transition-colors cursor-pointer
          "
        >
          <option value="all">All types</option>
          <option value="user">User</option>
          <option value="result">Results</option>
          <option value="error">Errors</option>
          <option value="system">System</option>
        </select>

        {/* Match count / clear filters */}
        {isFiltering && (
          <div className="flex items-center gap-2 ml-auto">
            <span
              data-testid="chat-filter-match-count"
              className="text-[10px] text-[var(--color-text-muted)] font-mono-data"
            >
              {filteredMessages.length} / {messages.length}
            </span>
            <button
              data-testid="chat-filter-clear"
              onClick={() => { setChatSearch(''); setChatRoleFilter('all'); }}
              className="text-[10px] text-[var(--color-text-dim)] hover:text-emerald-400 transition-colors"
              aria-label="Clear all filters"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-3">
        {filteredMessages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {/* Empty state when filters are active but nothing matches */}
        {isFiltering && filteredMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="chat-no-results">
            <p className="text-sm text-[var(--color-text-dim)]">No messages match your filter.</p>
            <button
              onClick={() => { setChatSearch(''); setChatRoleFilter('all'); }}
              className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Live terminal output while streaming */}
        {(isStreaming || terminalLines.length > 0) && !sending === false && (
          <div className="mt-2">
            <TerminalOutput lines={terminalLines} maxHeight="300px" title="Live Output" />
          </div>
        )}

        {/* HITL prompt */}
        {hitlRequest && (
          <div className="mt-2">
            <HITLPrompt
              prompt={hitlRequest.prompt}
              taskId={hitlRequest.taskId}
              onSubmit={handleHITLSubmit}
            />
          </div>
        )}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-dim)] pl-2">
            <span className="animate-pulse">⟳</span>
            <span data-testid="sending-label">{sendingLabel(sseStatus)}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-dark)] p-4">
        <div className="flex gap-3 items-end">
          {/* Capability input */}
          <div className="w-44 flex-shrink-0">
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
              Capability
            </label>
            <div className="relative">
              <input
                type="text"
                value={capability}
                onChange={(e) => {
                  setCapability(e.target.value);
                  const result = validateCapability(e.target.value);
                  setCapError(e.target.value.trim() ? (result.valid ? null : result.error ?? null) : null);
                }}
                onKeyDown={handleKeyDown}
                list="capabilities-list"
                placeholder="e.g. orchestrate"
                disabled={sending}
                className="
                  w-full px-3 py-2 rounded-lg text-sm font-mono-data
                  bg-[var(--color-surface)] border border-[var(--color-border)]
                  text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                  focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                  disabled:opacity-50 transition-colors
                "
              />
              <datalist id="capabilities-list">
                {knownCaps.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            {capError && <p className="text-[10px] text-red-400 mt-0.5">{capError}</p>}
          </div>

          {/* Message input */}
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                const result = validateMessage(e.target.value);
                setMsgError(e.target.value.trim() ? (result.valid ? null : result.error ?? null) : null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Task instructions… (Ctrl+Enter to send)"
              disabled={sending}
              rows={2}
              className="
                w-full px-3 py-2 rounded-lg text-sm resize-none
                bg-[var(--color-surface)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-text-muted)]
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                disabled:opacity-50 transition-colors
              "
            />
            {msgError && <p className="text-[10px] text-red-400 mt-0.5">{msgError}</p>}
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={sending || !capability.trim() || !message.trim() || !!capError || !!msgError}
            className="
              flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold
              bg-emerald-500 text-white
              hover:bg-emerald-400 active:bg-emerald-600
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {sending ? '⟳' : 'Send'}
          </button>

          {/* Clear chat button */}
          <button
            onClick={handleClearChat}
            disabled={sending}
            title="Clear chat history"
            className="
              flex-shrink-0 px-3 py-2 rounded-lg text-sm
              border border-[var(--color-border)] text-[var(--color-text-dim)]
              hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-secondary)]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            Clear
          </button>

          {/* Export chat history */}
          <ExportMenu
            testId="chat-export-menu"
            disabled={messages.length === 0}
            label="Export"
            onExportJSON={() => {
              const rows = messages.map((m) => ({
                ...m,
                timestamp: m.timestamp.toISOString(),
              }));
              exportAsJSON(rows, `chat-history-${new Date().toISOString().slice(0, 10)}`);
            }}
          />
        </div>

        {knownCaps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="text-[10px] text-[var(--color-text-muted)] self-center">Known caps:</span>
            {knownCaps.map((c) => (
              <button
                key={c}
                onClick={() => setCapability(c)}
                className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border-strong)] transition-colors border border-[var(--color-border-strong)]"
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────

// Wrapped in React.memo — OrchestratorChat re-renders whenever messages array changes
// (every new message). ChatBubble memo ensures old messages don't re-render when a new
// message is appended; only the new bubble is mounted/rendered.
const ChatBubble = memo(function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isResult = message.role === 'result';
  const isError = message.role === 'error';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full px-3 py-1">
          {message.content}
        </span>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl">
          <div className="rounded-2xl rounded-tr-sm bg-emerald-500/15 border border-emerald-500/25 px-4 py-2.5">
            <p className="text-sm text-[var(--color-text)]">{message.content}</p>
          </div>
          <RelativeTime
            date={message.timestamp}
            className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right font-mono-data block"
            data-testid="chat-bubble-timestamp"
          />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-xl">
          <div className="rounded-2xl rounded-tl-sm bg-red-500/10 border border-red-500/25 px-4 py-2.5">
            <p className="text-xs text-red-400 font-medium mb-1">Error</p>
            <p className="text-sm text-[var(--color-text)]">{message.content}</p>
          </div>
          <RelativeTime
            date={message.timestamp}
            className="text-[10px] text-[var(--color-text-muted)] mt-1 font-mono-data block"
            data-testid="chat-bubble-timestamp"
          />
        </div>
      </div>
    );
  }

  if (isResult) {
    return (
      <div className="flex justify-start">
        <div className="max-w-2xl w-full">
          <div className="rounded-2xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-widest font-semibold text-emerald-400">
                Result
              </span>
              {message.task_id && (
                <span className="flex items-center gap-1">
                  <span className="text-[10px] font-mono-data text-[var(--color-text-muted)]" data-testid="result-task-id">
                    {message.task_id}
                  </span>
                  <CopyButton
                    text={message.task_id}
                    ariaLabel="Copy task ID"
                    testId="copy-result-task-id"
                  />
                </span>
              )}
              <CopyButton
                text={message.content}
                ariaLabel="Copy result content"
                testId="copy-result-content"
                className="ml-auto"
              />
            </div>
            <pre className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words font-mono-data">
              {message.content}
            </pre>
          </div>
          <RelativeTime
            date={message.timestamp}
            className="text-[10px] text-[var(--color-text-muted)] mt-1 font-mono-data block"
            data-testid="chat-bubble-timestamp"
          />
        </div>
      </div>
    );
  }

  return null;
});
