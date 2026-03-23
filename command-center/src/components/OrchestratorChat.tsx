import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import CopyButton from './CopyButton';
import MermaidBlock from './MermaidBlock';
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const autoScrollRef = useRef(true); // mirror of autoScroll, readable in scroll handler without stale closure

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

  // Auto-scroll on new messages (only when locked to bottom)
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setHasNewMessages(false);
    } else {
      // User has scrolled up — show FAB to signal new messages
      setHasNewMessages(true);
    }
  }, [messages]);

  // Keep ref in sync with state (avoids stale closure in scroll listener)
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  // Scroll event: disengage auto-scroll when user scrolls up; re-engage at bottom
  const handleScrollContainer = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 40; // 40px threshold
    if (atBottom && !autoScrollRef.current) {
      setAutoScroll(true);
      autoScrollRef.current = true;
      setHasNewMessages(false);
    } else if (!atBottom && autoScrollRef.current) {
      setAutoScroll(false);
      autoScrollRef.current = false;
    }
  }, []);

  function scrollToBottomAndLock() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
    autoScrollRef.current = true;
    setHasNewMessages(false);
  }

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
    const msg = message.trim();
    if (!msg || sending) return;

    // Use explicitly chosen capability (from Advanced panel), or default to "orchestrate"
    const capRaw = capability.trim();
    const cap = capRaw || 'orchestrate';

    // Validate capability only when one was explicitly provided
    if (capRaw) {
      const capValidation = validateCapability(capRaw);
      if (!capValidation.valid) {
        setCapError(capValidation.error ?? null);
        return;
      }
    }

    const msgValidation = validateMessage(msg);
    if (!msgValidation.valid) {
      setMsgError(msgValidation.error ?? null);
      return;
    }

    setCapError(null);
    setMsgError(null);

    setSending(true);
    setTerminalLines([]);
    setHitlRequest(null);

    // Add user bubble — plain message text; capability badge only when non-default
    addMessage({
      role: 'user',
      content: msg,
      timestamp: new Date(),
      // Store the capability used so the bubble can render the badge
      capability: capRaw || undefined,
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

        {/* Auto-scroll toggle */}
        <button
          data-testid="autoscroll-toggle"
          onClick={() => {
            if (!autoScroll) {
              scrollToBottomAndLock();
            } else {
              setAutoScroll(false);
              autoScrollRef.current = false;
            }
          }}
          title={autoScroll ? 'Auto-scroll on — click to disable' : 'Auto-scroll off — click to re-enable'}
          aria-label={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          aria-pressed={autoScroll}
          className={`
            flex-shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] border transition-colors
            ${autoScroll
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }
          `}
        >
          <span aria-hidden="true">{autoScroll ? '🔒' : '🔓'}</span>
          <span className="hidden sm:inline">{autoScroll ? 'Scroll lock' : 'Scroll free'}</span>
        </button>

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

      {/* Messages — relative container so the FAB can be positioned inside it */}
      <div className="relative flex-1 overflow-hidden">
        {/* Scroll-to-bottom FAB — shown when auto-scroll is off and new messages arrived */}
        {!autoScroll && hasNewMessages && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex justify-center">
            <button
              data-testid="scroll-to-bottom-fab"
              onClick={scrollToBottomAndLock}
              aria-label="Scroll to bottom and re-enable auto-scroll"
              className="
                pointer-events-auto
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg
                bg-emerald-500 text-white hover:bg-emerald-400 active:bg-emerald-600
                border border-emerald-400/50
                transition-all animate-fade-in
              "
            >
              <span aria-hidden="true">↓</span>
              New messages
            </button>
          </div>
        )}
        <div
          ref={scrollContainerRef}
          onScroll={handleScrollContainer}
          className="h-full overflow-y-auto scrollbar-thin px-6 py-4 space-y-3"
        >
        {filteredMessages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {/* Welcome empty state — shown when only the system welcome message exists and no filters are active */}
        {messages.length <= 1 && !isFiltering && (
          <div className="flex flex-col items-center justify-center h-full py-16" data-testid="chat-welcome">
            <div className="text-center mb-8">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">What can I help you with?</h2>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">Ask the orchestrator anything — it will route to the right agent.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md" data-testid="welcome-prompts">
              {[
                { label: 'Summarize recent logs', icon: '📋' },
                { label: 'Check system health', icon: '💚' },
                { label: 'List running agents', icon: '🤖' },
                { label: 'Deploy a service', icon: '🚀' },
              ].map((prompt) => (
                <button
                  key={prompt.label}
                  data-testid="welcome-prompt-button"
                  onClick={() => setMessage(prompt.label)}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-emerald-500/50 hover:bg-[var(--color-surface-dark)] text-left text-sm text-[var(--color-text)] transition-colors"
                >
                  <span>{prompt.icon}</span>
                  <span>{prompt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

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
          <div className="flex justify-start" data-testid="typing-indicator">
            <div className="rounded-2xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5" data-testid="sending-label">{sendingLabel(sseStatus)}</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
        </div>{/* end scrollContainer */}
      </div>{/* end relative wrapper */}

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-dark)] p-4">
        {/* Main input row: textarea + Send + Clear + Export */}
        <div className="flex gap-3 items-end">
          {/* Message input */}
          <div className="flex-1">
            <textarea
              data-testid="message-input"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                const result = validateMessage(e.target.value);
                setMsgError(e.target.value.trim() ? (result.valid ? null : result.error ?? null) : null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message the orchestrator… (Ctrl+Enter to send)"
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

          {/* Send button — enabled when message is non-empty */}
          <button
            onClick={handleSend}
            disabled={sending || !message.trim() || !!msgError}
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

        {/* Advanced toggle */}
        <div className="mt-2">
          <button
            data-testid="advanced-toggle"
            onClick={() => setAdvancedOpen((o) => !o)}
            disabled={sending}
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors select-none"
            aria-expanded={advancedOpen}
            aria-controls="advanced-panel"
          >
            Advanced {advancedOpen ? '▾' : '▸'}
          </button>
        </div>

        {/* Advanced panel — capability selector + known caps chips */}
        {advancedOpen && (
          <div
            id="advanced-panel"
            data-testid="advanced-panel"
            className="mt-2 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1">
              Capability
            </label>
            <div className="relative w-48">
              <input
                type="text"
                data-testid="capability-input"
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
                  bg-[var(--color-surface-dark)] border border-[var(--color-border)]
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
        )}
      </div>
    </div>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────

/** Returns true if the text looks like raw JSON (starts with { or [) */
function isLikelyJSON(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Number of lines above which a result bubble is collapsed by default.
 * Content with fewer than this many newlines is always shown expanded.
 */
const COLLAPSE_LINE_THRESHOLD = 8;

// Wrapped in React.memo — OrchestratorChat re-renders whenever messages array changes
// (every new message). ChatBubble memo ensures old messages don't re-render when a new
// message is appended; only the new bubble is mounted/rendered.
const ChatBubble = memo(function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isResult = message.role === 'result';
  const isError = message.role === 'error';
  const isSystem = message.role === 'system';

  // Expand/collapse state for result bubbles. Long content starts collapsed.
  const isLong = isResult && message.content.split('\n').length > COLLAPSE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

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
    // Show capability badge only if a non-default capability was explicitly chosen
    const showBadge = !!message.capability;
    const capBadge = message.capability;

    return (
      <div className="flex justify-end">
        <div className="max-w-xl">
          <div className="rounded-2xl rounded-tr-sm bg-emerald-500/15 border border-emerald-500/25 px-4 py-2.5">
            <p className="text-sm text-[var(--color-text)]">{message.content}</p>
            {showBadge && (
              <span
                data-testid="capability-badge"
                className="mt-1 inline-block text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400/80 border border-emerald-500/20"
              >
                {capBadge}
              </span>
            )}
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
    const jsonContent = isLikelyJSON(message.content);
    // How many lines are hidden when collapsed
    const totalLines = message.content.split('\n').length;
    const hiddenLines = isLong ? totalLines - COLLAPSE_LINE_THRESHOLD : 0;

    return (
      <div className="flex justify-start" data-testid="result-bubble">
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

            {/* Content wrapper — clipped when collapsed */}
            <div
              data-testid="result-content-wrapper"
              data-expanded={expanded}
              style={
                !expanded
                  ? {
                      maxHeight: `${COLLAPSE_LINE_THRESHOLD * 1.6 * 14}px`, // approx lines * line-height * font-size
                      overflow: 'hidden',
                      position: 'relative',
                    }
                  : {}
              }
            >
            {jsonContent ? (
              <pre
                data-testid="json-content"
                className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words font-mono-data"
              >
                {message.content}
              </pre>
            ) : (
              <div
                data-testid="markdown-content"
                style={{
                  color: 'var(--color-text)',
                  fontSize: '0.875rem',
                  lineHeight: '1.6',
                }}
                className="markdown-result"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    h1: ({ children }) => (
                      <h1 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.25rem', marginBottom: '0.5rem', marginTop: '0.75rem' }}>{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.4rem', marginTop: '0.65rem' }}>{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '1rem', marginBottom: '0.35rem', marginTop: '0.5rem' }}>{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p style={{ marginBottom: '0.5rem' }}>{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul style={{ paddingLeft: '1.25rem', marginBottom: '0.5rem', listStyleType: 'disc' }}>{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol style={{ paddingLeft: '1.25rem', marginBottom: '0.5rem', listStyleType: 'decimal' }}>{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li style={{ marginBottom: '0.2rem' }}>{children}</li>
                    ),
                    code: ({ className, children, ...props }) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const lang = match?.[1];
                      if (lang === 'mermaid') {
                        return <MermaidBlock code={String(children).replace(/\n$/, '')} />;
                      }
                      const isBlock = className?.startsWith('language-');
                      if (isBlock) {
                        return (
                          <code
                            className={className}
                            style={{ display: 'block', overflowX: 'auto' }}
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }
                      return (
                        <code
                          style={{
                            background: 'var(--color-surface-dark)',
                            borderRadius: '0.25rem',
                            padding: '0.1em 0.35em',
                            fontSize: '0.8em',
                            color: 'var(--color-text)',
                            border: '1px solid var(--color-border)',
                          }}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                    pre: ({ children }) => (
                      <pre
                        style={{
                          background: 'var(--color-surface-dark)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '0.5rem',
                          padding: '0.75rem 1rem',
                          overflowX: 'auto',
                          marginBottom: '0.5rem',
                          fontSize: '0.8rem',
                        }}
                      >
                        {children}
                      </pre>
                    ),
                    table: ({ children }) => (
                      <div style={{ overflowX: 'auto', marginBottom: '0.5rem' }}>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.85rem',
                          }}
                        >
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th
                        style={{
                          border: '1px solid var(--color-border)',
                          padding: '0.4rem 0.75rem',
                          textAlign: 'left',
                          background: 'var(--color-surface-dark)',
                          color: 'var(--color-text)',
                          fontWeight: 600,
                        }}
                      >
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td
                        style={{
                          border: '1px solid var(--color-border)',
                          padding: '0.4rem 0.75rem',
                          color: 'var(--color-text)',
                        }}
                      >
                        {children}
                      </td>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--color-emerald, #10b981)', textDecoration: 'underline' }}
                      >
                        {children}
                      </a>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ fontWeight: 700, color: 'var(--color-text)' }}>{children}</strong>
                    ),
                    em: ({ children }) => (
                      <em style={{ fontStyle: 'italic', color: 'var(--color-text)' }}>{children}</em>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote
                        style={{
                          borderLeft: '3px solid var(--color-border-strong)',
                          paddingLeft: '0.75rem',
                          marginLeft: 0,
                          color: 'var(--color-text-muted)',
                          marginBottom: '0.5rem',
                        }}
                      >
                        {children}
                      </blockquote>
                    ),
                    hr: () => (
                      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0.75rem 0' }} />
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}

            {/* Gradient fade overlay — shown only when collapsed and content is long */}
            {!expanded && isLong && (
              <div
                data-testid="result-collapse-fade"
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '3rem',
                  background: 'linear-gradient(to bottom, transparent, var(--color-surface))',
                  pointerEvents: 'none',
                }}
              />
            )}
            </div>{/* end content wrapper */}

            {/* Show more / Show less toggle */}
            {isLong && (
              <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between">
                <button
                  data-testid={expanded ? 'result-show-less' : 'result-show-more'}
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className="
                    text-[11px] font-medium
                    text-emerald-400 hover:text-emerald-300
                    transition-colors flex items-center gap-1
                  "
                >
                  <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
                {!expanded && (
                  <span
                    data-testid="result-hidden-lines"
                    className="text-[10px] text-[var(--color-text-muted)]"
                  >
                    {hiddenLines} lines hidden
                  </span>
                )}
              </div>
            )}
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
