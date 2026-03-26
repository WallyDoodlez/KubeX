import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import type { Plugin } from 'unified';
import type { Root, Text, Element, ElementContent } from 'hast';
import { visit, SKIP } from 'unist-util-visit';
import CopyButton from './CopyButton';
import MermaidBlock from './MermaidBlock';
import TaskTimeline from './TaskTimeline';
import { dispatchTask, getTaskResult, getTaskAudit, getAgents, getTaskStreamUrl, provideInput, cancelTask } from '../api';
import type { AuditEntry, ChatMessage, TrafficEntry, Agent, TaskPhaseEntry } from '../types';
import { useToast } from '../context/ToastContext';
import { validateCapability, validateMessage } from '../utils/validation';
import { useSSE } from '../hooks/useSSE';
import type { SSEStatus } from '../hooks/useSSE';
import TerminalOutput from './TerminalOutput';
import type { OutputLine } from './TerminalOutput';
import HITLPrompt from './HITLPrompt';
import ExportMenu from './ExportMenu';
import { exportAsJSON, exportAsMarkdown } from '../utils/export';
import RelativeTime from './RelativeTime';

interface OrchestratorChatProps {
  onTrafficEntry: (entry: TrafficEntry) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export default function OrchestratorChat({ onTrafficEntry, messages, setMessages }: OrchestratorChatProps) {
  const { addToast } = useToast();
  const [capability, setCapability] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [knownCaps, setKnownCaps] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Favorite capabilities — persisted to localStorage
  const [favoriteCaps, setFavoriteCaps] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('kubex-favorite-caps');
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  const toggleFavoriteCap = useCallback((cap: string) => {
    setFavoriteCaps((prev) => {
      const next = prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap];
      try {
        localStorage.setItem('kubex-favorite-caps', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Approximate pixel heights for min/max row counts (1.5rem line-height + 0.5rem padding each side)
  const LINE_HEIGHT_PX = 24; // 1.5rem at 16px base
  const TEXTAREA_PADDING_PX = 16; // 0.5rem top + 0.5rem bottom → total 8px; add border rounding ≈ 16px
  const MIN_HEIGHT_PX = LINE_HEIGHT_PX * 2 + TEXTAREA_PADDING_PX; // ~64px — 2 rows
  const MAX_HEIGHT_PX = LINE_HEIGHT_PX * 8 + TEXTAREA_PADDING_PX; // ~208px — 8 rows

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto'; // collapse to measure scrollHeight
    const clamped = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
    el.style.height = `${clamped}px`;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset textarea height to min when message is cleared (after send or explicit clear)
  useEffect(() => {
    if (message === '') {
      const el = textareaRef.current;
      if (el) {
        el.style.height = `${MIN_HEIGHT_PX}px`;
      }
    }
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const autoScrollRef = useRef(true); // mirror of autoScroll, readable in scroll handler without stale closure

  // Chat search / filter state
  const [chatSearch, setChatSearch] = useState('');
  const [chatRoleFilter, setChatRoleFilter] = useState<'all' | 'user' | 'result' | 'error' | 'system'>('all');
  const isFiltering = chatSearch.trim() !== '' || chatRoleFilter !== 'all';

  // System message visibility toggle
  const [showSystemMessages, setShowSystemMessages] = useState(false);

  // Keyboard shortcut: Ctrl+Shift+C flash feedback state
  const [copyResultFlash, setCopyResultFlash] = useState(false);

  // SSE state
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<OutputLine[]>([]);
  const [hitlRequest, setHitlRequest] = useState<{ taskId: string; prompt: string } | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeCapRef = useRef<string>('');

  // Task recovery state — true while we are reconnecting to a persisted in-flight task
  const [recovering, setRecovering] = useState(false);

  // Task progress timeline — tracks live phases while a task is running
  const PHASE_LABELS = ['Dispatched', 'Connecting', 'Streaming', 'Completed'] as const;
  type PhaseLabel = (typeof PHASE_LABELS)[number];

  /** Build a fresh phases array with the given phase set to 'active' and earlier ones 'done' */
  function buildPhases(activeLabel: PhaseLabel, failed = false): TaskPhaseEntry[] {
    const activeIdx = PHASE_LABELS.indexOf(activeLabel);
    const now = new Date().toLocaleTimeString();
    return PHASE_LABELS.map((label, i) => {
      if (i < activeIdx) return { label, status: 'done', timestamp: now };
      if (i === activeIdx) {
        if (failed) return { label: 'Failed', status: 'failed', timestamp: now };
        return { label, status: 'active', timestamp: now };
      }
      return { label, status: 'pending' };
    });
  }

  /** Mark all phases done (terminal success) */
  function buildPhasesCompleted(): TaskPhaseEntry[] {
    const now = new Date().toLocaleTimeString();
    return PHASE_LABELS.map((label) => ({ label, status: 'done' as const, timestamp: now }));
  }

  /** Mark the last phase as failed */
  function buildPhasesFailed(): TaskPhaseEntry[] {
    const now = new Date().toLocaleTimeString();
    return [
      { label: 'Dispatched', status: 'done', timestamp: now },
      { label: 'Connecting', status: 'done', timestamp: now },
      { label: 'Streaming', status: 'done', timestamp: now },
      { label: 'Failed', status: 'failed', timestamp: now },
    ] as TaskPhaseEntry[];
  }

  // Live phases state — drives the live timeline shown during active streaming
  const [livePhases, setLivePhases] = useState<TaskPhaseEntry[]>([]);

  // Keyboard shortcut: message history for Up-arrow recall
  // Each entry stores { content, capability } from a sent user message
  const sentHistoryRef = useRef<Array<{ content: string; capability: string }>>([]);
  // Current position in history while navigating (−1 = not navigating)
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Buffer to restore when user navigates away from history back to present
  const inputBufferRef = useRef<string>('');

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
      // Any output means we're actively streaming
      setLivePhases(buildPhases('Streaming'));
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
      const completedPhases = buildPhasesCompleted();
      localStorage.removeItem('kubex-active-task');
      setSending(false);
      setStreamUrl(null);
      setHitlRequest(null);
      setLivePhases([]);

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
        phases: completedPhases,
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
      const failedPhases = buildPhasesFailed();
      localStorage.removeItem('kubex-active-task');
      setSending(false);
      setStreamUrl(null);
      setHitlRequest(null);
      setLivePhases([]);

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
        retryCapability: cap !== 'task_orchestration' ? cap : undefined,
        phases: failedPhases,
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

            const isSuccess = rr.data!.status === 'completed';
            const fallbackPhases = isSuccess ? buildPhasesCompleted() : buildPhasesFailed();
            setLivePhases([]);

            setMessages((msgs) => [
              ...msgs,
              {
                id: crypto.randomUUID(),
                role: isSuccess ? 'result' : 'error',
                content: isSuccess ? resultText : `Task ${rr.data!.status}: ${resultText}`,
                timestamp: new Date(),
                task_id: taskId,
                raw: rr.data,
                phases: fallbackPhases,
              } as ChatMessage,
            ]);

            onTrafficEntry({
              id: crypto.randomUUID(),
              timestamp: new Date(),
              agent_id: 'orchestrator',
              action: 'task_result',
              capability: cap,
              status: isSuccess ? 'allowed' : 'escalated',
              task_id: taskId,
            });

            localStorage.removeItem('kubex-active-task');
            resolved = true;
            break;
          }
        }

        if (!resolved) {
          // All retries exhausted — task still pending or unreachable
          localStorage.removeItem('kubex-active-task');
          setLivePhases([]);
          setMessages((msgs) => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              role: 'error',
              content: `Stream ended without result for task ${taskId}. The task may still be running — check Task History for its status.`,
              timestamp: new Date(),
              task_id: taskId,
              retryCapability: cap !== 'task_orchestration' ? cap : undefined,
              phases: buildPhasesFailed(),
            } as ChatMessage,
          ]);
        }

        setStreamUrl(null);
        setHitlRequest(null);
      })();
      return false;
    });
  }, [onTrafficEntry, setMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status: sseStatus, close: closeSSE } = useSSE({
    url: streamUrl,
    onMessage: handleSSEMessage,
    onComplete: handleSSEComplete,
  });

  // Advance timeline phase when SSE connection opens.
  // Also check for the SSE race condition (BUG-007): if the task completed before the
  // stream opened, no events will ever arrive. Poll once immediately on open — if the
  // task is already terminal, render the result and close the stream.
  useEffect(() => {
    if (sseStatus === 'open' && sending) {
      setLivePhases(buildPhases('Streaming'));

      const taskId = activeTaskIdRef.current;
      const cap = activeCapRef.current;
      if (!taskId) return;

      (async () => {
        const rr = await getTaskResult(taskId);
        // Only act if we are still in the sending state for this task
        if (!activeTaskIdRef.current) return; // cancelled/completed in the meantime
        if (
          rr.ok &&
          rr.data &&
          (rr.data.status === 'completed' || rr.data.status === 'failed' || rr.data.status === 'cancelled')
        ) {
          const resultText =
            typeof rr.data.result === 'string'
              ? rr.data.result
              : rr.data.result !== undefined
              ? JSON.stringify(rr.data.result, null, 2)
              : JSON.stringify(rr.data, null, 2);

          const isSuccess = rr.data.status === 'completed';
          localStorage.removeItem('kubex-active-task');
          closeSSE();
          setSending(false);
          setStreamUrl(null);
          setHitlRequest(null);
          setLivePhases([]);
          activeTaskIdRef.current = null;

          setMessages((msgs) => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              role: isSuccess ? 'result' : 'error',
              content: isSuccess ? resultText : `Task ${rr.data!.status}: ${resultText}`,
              timestamp: new Date(),
              task_id: taskId,
              raw: rr.data,
              phases: isSuccess ? buildPhasesCompleted() : buildPhasesFailed(),
            } as ChatMessage,
          ]);

          onTrafficEntry({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            agent_id: 'orchestrator',
            action: 'task_result',
            capability: cap,
            status: isSuccess ? 'allowed' : 'escalated',
            task_id: taskId,
          });
        }
        // If task is still running, do nothing — SSE events will arrive normally
      })();
    }
  }, [sseStatus, sending]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: detect and recover any in-flight task that was persisted before navigation
  useEffect(() => {
    const stored = localStorage.getItem('kubex-active-task');
    if (!stored) return;

    try {
      const { taskId, capability: cap, startedAt } = JSON.parse(stored) as {
        taskId: string;
        capability: string;
        message: string;
        startedAt: string;
      };

      const age = Date.now() - new Date(startedAt).getTime();
      const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

      activeTaskIdRef.current = taskId;
      activeCapRef.current = cap;
      setRecovering(true);

      if (age < STALE_THRESHOLD) {
        // Recent enough — try reconnecting the SSE stream
        setSending(true);
        setLivePhases(buildPhases('Connecting'));
        setStreamUrl(getTaskStreamUrl(taskId));
        setRecovering(false);
      } else {
        // Task is old — poll for a result rather than reconnecting SSE
        setSending(true);
        setLivePhases(buildPhases('Connecting'));
        (async () => {
          const rr = await getTaskResult(taskId);

          if (!rr.ok) {
            // Task ID not found or backend error (e.g. 404) — clear everything
            localStorage.removeItem('kubex-active-task');
            setSending(false);
            setLivePhases([]);
            setRecovering(false);
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'error',
                content: 'Could not reconnect to previous task. It may have completed or timed out.',
                timestamp: new Date(),
              } as ChatMessage,
            ]);
            return;
          }

          if (
            rr.ok &&
            rr.data &&
            (rr.data.status === 'completed' || rr.data.status === 'failed' || rr.data.status === 'cancelled')
          ) {
            const resultText =
              typeof rr.data.result === 'string'
                ? rr.data.result
                : rr.data.result !== undefined
                ? JSON.stringify(rr.data.result, null, 2)
                : JSON.stringify(rr.data, null, 2);

            const isSuccess = rr.data.status === 'completed';
            setLivePhases([]);
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: isSuccess ? 'result' : 'error',
                content: isSuccess ? resultText : `Task ${rr.data!.status}: ${resultText}`,
                timestamp: new Date(),
                task_id: taskId,
                raw: rr.data,
                phases: isSuccess ? buildPhasesCompleted() : buildPhasesFailed(),
              } as ChatMessage,
            ]);
            localStorage.removeItem('kubex-active-task');
            setSending(false);
          } else {
            // Still running — reconnect SSE and let it drive the result
            setStreamUrl(getTaskStreamUrl(taskId));
          }
          setRecovering(false);
        })();
      }

      // Recovery timeout: if sending is still true after 30s, force-clear everything
      const recoveryTimeout = setTimeout(() => {
        setSending((prev) => {
          if (prev) {
            localStorage.removeItem('kubex-active-task');
            setStreamUrl(null);
            setLivePhases([]);
            setRecovering(false);
            setTerminalLines([]);
            setMessages((msgs) => [
              ...msgs,
              {
                id: crypto.randomUUID(),
                role: 'error',
                content: 'Could not reconnect to previous task. It may have completed or timed out.',
                timestamp: new Date(),
              } as ChatMessage,
            ]);
          }
          return false; // always clear sending
        });
      }, 30000);

      return () => clearTimeout(recoveryTimeout);
    } catch {
      localStorage.removeItem('kubex-active-task');
      setRecovering(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Use explicitly chosen capability (from Advanced panel), or default to "task_orchestration"
    const capRaw = capability.trim();
    const cap = capRaw || 'task_orchestration';

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
    setLivePhases(buildPhases('Dispatched'));

    // Push to sent history (most recent at index 0 after we prepend)
    sentHistoryRef.current = [{ content: msg, capability: capRaw }, ...sentHistoryRef.current].slice(0, 50);
    setHistoryIndex(-1);
    inputBufferRef.current = '';

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
      setLivePhases([]);
      addMessage({
        role: 'error',
        content: `Dispatch failed: ${res.error ?? `HTTP ${res.status}`}`,
        timestamp: new Date(),
        retryCapability: capRaw || undefined,
        retryMessage: msg,
        phases: [{ label: 'Dispatched', status: 'failed', timestamp: new Date().toLocaleTimeString() }],
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

    // Persist active task so we can recover after navigation
    localStorage.setItem(
      'kubex-active-task',
      JSON.stringify({ taskId, capability: cap, message: msg, startedAt: new Date().toISOString() }),
    );

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
    setLivePhases(buildPhases('Connecting'));

    // BUG-007 fix: fast-task race-condition guard.
    // If the task completes in < ~2s (before the SSE stream can connect and receive events),
    // the SSE stream sits idle with no events forever. Poll once after a short delay — if the
    // result is already there, render it immediately and close the stream.
    const capturedTaskId = taskId;
    const capturedCap = cap;
    setTimeout(async () => {
      // Only act if this task is still the active one and we are still sending
      if (activeTaskIdRef.current !== capturedTaskId) return;

      const rr = await getTaskResult(capturedTaskId);
      // Check again after the async call
      if (activeTaskIdRef.current !== capturedTaskId) return;

      if (
        rr.ok &&
        rr.data &&
        (rr.data.status === 'completed' || rr.data.status === 'failed' || rr.data.status === 'cancelled')
      ) {
        const resultText =
          typeof rr.data.result === 'string'
            ? rr.data.result
            : rr.data.result !== undefined
            ? JSON.stringify(rr.data.result, null, 2)
            : JSON.stringify(rr.data, null, 2);

        const isSuccess = rr.data.status === 'completed';
        localStorage.removeItem('kubex-active-task');
        closeSSE();
        setSending(false);
        setStreamUrl(null);
        setHitlRequest(null);
        setLivePhases([]);
        activeTaskIdRef.current = null;

        setMessages((msgs) => [
          ...msgs,
          {
            id: crypto.randomUUID(),
            role: isSuccess ? 'result' : 'error',
            content: isSuccess ? resultText : `Task ${rr.data!.status}: ${resultText}`,
            timestamp: new Date(),
            task_id: capturedTaskId,
            raw: rr.data,
            phases: isSuccess ? buildPhasesCompleted() : buildPhasesFailed(),
          } as ChatMessage,
        ]);

        onTrafficEntry({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          agent_id: 'orchestrator',
          action: 'task_result',
          capability: capturedCap,
          status: isSuccess ? 'allowed' : 'escalated',
          task_id: capturedTaskId,
        });
      }
      // If task is still running, SSE events will arrive normally (or handleSSEComplete will fire)
    }, 2000);
  }

  async function handleHITLSubmit(taskId: string, input: string) {
    setHitlRequest(null);
    setTerminalLines((prev) => [
      ...prev,
      { text: `[You] ${input}`, stream: 'system', timestamp: new Date().toLocaleTimeString() },
    ]);
    await provideInput(taskId, input);
  }

  // Cancel the active in-flight task
  async function handleCancel() {
    const taskId = activeTaskIdRef.current;
    if (!taskId || cancelling) return;
    setCancelling(true);
    // Null out activeTaskIdRef first so the SSE complete handler ignores any close event
    activeTaskIdRef.current = null;
    // Close the SSE stream immediately so the UI stops waiting for events
    closeSSE();
    // Eagerly clear sending state — do not wait for the network call
    setStreamUrl(null);
    setSending(false);
    setLivePhases([]);
    setTerminalLines([]);
    setHitlRequest(null);
    localStorage.removeItem('kubex-active-task');
    const res = await cancelTask(taskId);
    setCancelling(false);
    if (res.ok) {
      addToast('Task cancelled', 'success');
      addMessage({
        role: 'error',
        content: `Task ${taskId} cancelled by user.`,
        timestamp: new Date(),
        task_id: taskId,
      });
    } else {
      addToast('Cancel failed', 'error');
      addMessage({
        role: 'error',
        content: `Cancel failed: ${res.error ?? `HTTP ${res.status}`}`,
        timestamp: new Date(),
        task_id: taskId,
      });
    }
  }

  // Retry a failed task: pre-fill the capability + message and re-dispatch
  function handleRetry(retryCapability: string | undefined, retryMessage: string | undefined) {
    if (!retryMessage || sending) return;
    setCapability(retryCapability ?? '');
    setMessage(retryMessage);
    if (retryCapability) {
      setAdvancedOpen(true);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
      return;
    }

    // Escape — clear the input (only when not sending)
    if (e.key === 'Escape' && !sending) {
      e.preventDefault();
      setMessage('');
      setMsgError(null);
      setHistoryIndex(-1);
      inputBufferRef.current = '';
      return;
    }

    // Up arrow — recall previous sent message.
    // Only intercept when: already in history-navigation mode (historyIndex >= 0)
    // OR the message textarea cursor is at position 0 (top of input).
    if (e.key === 'ArrowUp' && !sending) {
      const history = sentHistoryRef.current;
      if (history.length === 0) return;

      const target = e.currentTarget as HTMLTextAreaElement;
      const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
      if (!atStart && historyIndex === -1) return; // let textarea handle normal cursor movement

      // Save the current draft before starting history navigation
      if (historyIndex === -1) {
        inputBufferRef.current = message;
      }

      const nextIndex = Math.min(historyIndex + 1, history.length - 1);
      if (nextIndex !== historyIndex) {
        e.preventDefault();
        setHistoryIndex(nextIndex);
        const entry = history[nextIndex];
        setMessage(entry.content);
        if (entry.capability) {
          setCapability(entry.capability);
          setAdvancedOpen(true);
        }
      }
      return;
    }

    // Down arrow — navigate forward in history (back toward the draft)
    if (e.key === 'ArrowDown' && !sending && historyIndex >= 0) {
      e.preventDefault();
      const nextIndex = historyIndex - 1;
      if (nextIndex < 0) {
        // Restore the buffered draft
        setHistoryIndex(-1);
        setMessage(inputBufferRef.current);
        inputBufferRef.current = '';
      } else {
        const entry = sentHistoryRef.current[nextIndex];
        setHistoryIndex(nextIndex);
        setMessage(entry.content);
        if (entry.capability) {
          setCapability(entry.capability);
          setAdvancedOpen(true);
        }
      }
      return;
    }
  }

  // Ctrl+Shift+C — copy last result to clipboard (global keydown listener)
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const lastResult = [...messages].reverse().find((m) => m.role === 'result');
        if (lastResult) {
          navigator.clipboard.writeText(lastResult.content).catch(() => {/* ignore */});
          setCopyResultFlash(true);
          setTimeout(() => setCopyResultFlash(false), 1500);
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [messages]);

  // Filtered messages for search / role filter
  // Count of toggleable system messages (excludes the pinned welcome message with id='welcome')
  const systemMessageCount = useMemo(
    () => messages.filter((m) => m.role === 'system' && m.id !== 'welcome').length,
    [messages],
  );

  const filteredMessages = useMemo(() => {
    const needle = chatSearch.trim().toLowerCase();
    return messages.filter((m) => {
      // The welcome message (id='welcome') is always shown regardless of the system toggle —
      // it is a permanent orientation marker, not a task-lifecycle event.
      // Only suppress transient system messages (e.g. "Task dispatched — ID: ...") when toggle is off.
      const isWelcome = m.id === 'welcome';
      if (m.role === 'system' && !isWelcome && !showSystemMessages && chatRoleFilter !== 'system') return false;
      const roleMatch = chatRoleFilter === 'all' || m.role === chatRoleFilter;
      const textMatch = needle === '' || m.content.toLowerCase().includes(needle) || (m.task_id ?? '').toLowerCase().includes(needle);
      return roleMatch && textMatch;
    });
  }, [messages, chatSearch, chatRoleFilter, showSystemMessages]);

  const isStreaming = streamUrl !== null && (sseStatus === 'connecting' || sseStatus === 'open');

  /**
   * Group filteredMessages into conversation groups for visual dividers.
   *
   * Algorithm:
   *  - A "conversation group" is anchored to a non-null task_id.
   *  - When we encounter a message with a new task_id we open a new group and
   *    look backwards to capture any immediately preceding user messages (which
   *    don't carry a task_id yet) into the same group — this keeps the user
   *    prompt visually paired with its response.
   *  - Messages that have no task_id and do not sit immediately before a task
   *    group (e.g. the welcome message) remain as singleton ungrouped entries.
   *
   * Each group entry:
   *   { taskId: string | null, messages: ChatMessage[], isFirstTaskGroup: boolean }
   *
   * `isFirstTaskGroup` is true for the very first group that has a non-null
   * taskId — used to suppress the top divider on that group.
   */
  const groupedMessages = useMemo(() => {
    type Group = { taskId: string | null; messages: typeof filteredMessages };
    const groups: Group[] = [];

    // Build a mutable working copy so we can reassign user messages to task groups
    const remaining = [...filteredMessages];

    // First pass: collect which indices are "absorbed" into a task group
    // by pairing them with the immediately following task-id messages.
    // We process from back-to-front to identify user messages just before a task group.

    // Simple forward pass: assign each message a "group key"
    // The group key is the task_id of the nearest following grouped message, if the
    // current message is a no-task_id user message immediately before that group.
    const groupKeys: Array<string | null> = remaining.map((m) => m.task_id ?? null);

    // Look-ahead: if a null-key message is immediately followed by a non-null key,
    // and the null-key message has role === 'user', absorb it into the next task group.
    for (let i = 0; i < groupKeys.length - 1; i++) {
      if (groupKeys[i] === null && remaining[i].role === 'user' && groupKeys[i + 1] !== null) {
        groupKeys[i] = groupKeys[i + 1];
      }
    }

    // Second pass: collect into groups preserving order
    for (let i = 0; i < remaining.length; i++) {
      const key = groupKeys[i];
      const msg = remaining[i];

      if (key === null) {
        // Ungrouped singleton
        groups.push({ taskId: null, messages: [msg] });
      } else {
        // Append to last group if same key, else start new group
        const last = groups[groups.length - 1];
        if (last && last.taskId === key) {
          last.messages.push(msg);
        } else {
          groups.push({ taskId: key, messages: [msg] });
        }
      }
    }

    return groups;
  }, [filteredMessages]);

  /**
   * The index of the first task group (non-null taskId) in groupedMessages.
   * Dividers are only shown on task groups that come AFTER this first one.
   */
  const firstTaskGroupIndex = useMemo(
    () => groupedMessages.findIndex((g) => g.taskId !== null),
    [groupedMessages],
  );

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

        {/* System messages toggle */}
        <button
          data-testid="system-messages-toggle"
          onClick={() => setShowSystemMessages((v) => !v)}
          title={showSystemMessages ? 'Hide system messages' : 'Show system messages'}
          aria-label={showSystemMessages ? 'Hide system messages' : 'Show system messages'}
          aria-pressed={showSystemMessages}
          className={`
            flex-shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] border transition-colors
            ${showSystemMessages
              ? 'border-slate-500/40 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }
          `}
        >
          <span aria-hidden="true">⚙</span>
          <span className="hidden sm:inline">System</span>
          {!showSystemMessages && systemMessageCount > 0 && (
            <span
              data-testid="system-messages-hidden-count"
              className="ml-0.5 px-1 rounded-full text-[10px] bg-slate-500/20 text-slate-400 font-mono-data"
            >
              {systemMessageCount}
            </span>
          )}
        </button>

        {/* Ctrl+Shift+C copy-result flash indicator */}
        {copyResultFlash && (
          <span
            data-testid="copy-result-flash"
            aria-live="polite"
            className="text-[10px] text-emerald-400 font-mono-data animate-fade-in"
          >
            Copied!
          </span>
        )}

        {/* Keyboard shortcuts hint */}
        <button
          data-testid="keyboard-shortcuts-hint"
          title={"Keyboard shortcuts:\nEsc — clear input\n↑ / ↓ — recall sent messages\nCtrl+Shift+C — copy last result\nCtrl+Enter — send"}
          aria-label="Keyboard shortcuts"
          className="flex-shrink-0 px-2 py-1.5 rounded-lg text-[11px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <span aria-hidden="true">⌨</span>
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
        {groupedMessages.map((group, groupIdx) =>
          group.taskId === null ? (
            // Ungrouped messages (e.g. welcome message) — no divider, no wrapper
            group.messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} onRetry={handleRetry} disabled={sending} searchQuery={chatSearch} />
            ))
          ) : (
            // Task conversation group — wrapped with optional divider header
            <div
              key={group.taskId}
              data-testid="task-group"
              data-task-id={group.taskId}
              className="space-y-3"
            >
              {/* Divider — only render between task groups (not before the first one) */}
              {groupIdx > firstTaskGroupIndex && (
                <div
                  data-testid="task-group-divider"
                  className="flex items-center gap-2 my-1"
                  role="separator"
                  aria-label={`Task group ${group.taskId}`}
                >
                  <div className="flex-1 h-px bg-[var(--color-border)]" />
                  <span className="text-[10px] font-mono-data text-[var(--color-text-dim)] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] select-none whitespace-nowrap">
                    {group.taskId}
                  </span>
                  <div className="flex-1 h-px bg-[var(--color-border)]" />
                </div>
              )}
              {group.messages.map((msg) => (
                <ChatBubble key={msg.id} message={msg} onRetry={handleRetry} disabled={sending} searchQuery={chatSearch} />
              ))}
            </div>
          )
        )}

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

        {recovering && (
          <div className="flex justify-start" data-testid="task-recovery-indicator">
            <div className="rounded-2xl rounded-tl-sm bg-[var(--color-surface)] border border-amber-500/40 px-4 py-3">
              <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Reconnecting to task…
              </p>
            </div>
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
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[10px] text-[var(--color-text-muted)]" data-testid="sending-label">{sendingLabel(sseStatus)}</p>
                <button
                  data-testid="cancel-task-button"
                  onClick={handleCancel}
                  disabled={cancelling}
                  aria-label="Cancel active task"
                  className="
                    ml-3 px-2 py-0.5 rounded text-[10px] font-medium
                    border border-red-500/50 text-red-400
                    hover:bg-red-500/10 hover:border-red-400
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              </div>
              {livePhases.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <TaskTimeline
                    phases={livePhases}
                    data-testid="live-task-timeline"
                  />
                </div>
              )}
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
              ref={textareaRef}
              data-testid="message-input"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                const result = validateMessage(e.target.value);
                setMsgError(e.target.value.trim() ? (result.valid ? null : result.error ?? null) : null);
                adjustTextareaHeight();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message the orchestrator… (Ctrl+Enter to send)"
              disabled={sending}
              style={{ minHeight: `${MIN_HEIGHT_PX}px`, maxHeight: `${MAX_HEIGHT_PX}px`, height: `${MIN_HEIGHT_PX}px`, overflowY: 'auto' }}
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
            onExportMarkdown={() => {
              exportAsMarkdown(messages, `chat-history-${new Date().toISOString().slice(0, 10)}`);
            }}
          />
        </div>

        {/* Advanced toggle + keyboard shortcut hints row */}
        <div className="mt-2 flex items-center justify-between gap-2">
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
          {/* Keyboard shortcut hints — shown below input for discoverability */}
          <div
            data-testid="input-keyboard-hints"
            className="flex items-center gap-3 text-[9px] text-[var(--color-text-muted)]"
            aria-label="Keyboard shortcuts"
          >
            <span><kbd className="font-mono-data bg-[var(--color-border)] px-1 rounded">Esc</kbd> clear</span>
            <span><kbd className="font-mono-data bg-[var(--color-border)] px-1 rounded">↑</kbd><kbd className="font-mono-data bg-[var(--color-border)] px-1 rounded">↓</kbd> history</span>
            <span><kbd className="font-mono-data bg-[var(--color-border)] px-1 rounded">⌃⇧C</kbd> copy result</span>
            <span><kbd className="font-mono-data bg-[var(--color-border)] px-1 rounded">⌃↵</kbd> send</span>
          </div>
        </div>

        {/* Quick-access favorite capability pills — shown when Advanced panel is collapsed and favorites exist */}
        {!advancedOpen && favoriteCaps.length > 0 && (
          <div
            data-testid="quick-caps-bar"
            className="mt-2 flex flex-wrap gap-1.5 items-center"
          >
            <span className="text-[9px] text-[var(--color-text-muted)] self-center">Quick:</span>
            {favoriteCaps.map((cap) => (
              <button
                key={cap}
                data-testid={`quick-cap-pill-${cap}`}
                onClick={() => setCapability(cap)}
                disabled={sending}
                className="
                  text-xs font-mono-data px-3 py-1 rounded-full
                  bg-gray-700 hover:bg-gray-600 text-gray-200
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors border border-gray-600
                "
              >
                {cap}
              </button>
            ))}
          </div>
        )}

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
                placeholder="e.g. task_orchestration"
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
              <div className="mt-2 space-y-2">
                {/* Favorites section — only shown when at least one cap is starred */}
                {favoriteCaps.length > 0 && (
                  <div data-testid="favorite-caps-section" className="flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] text-amber-400/80 self-center">★ Favorites:</span>
                    {favoriteCaps.filter((c) => knownCaps.includes(c)).map((c) => (
                      <button
                        key={c}
                        onClick={() => setCapability(c)}
                        className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 hover:text-amber-200 hover:bg-amber-500/20 transition-colors border border-amber-500/30"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* All known caps with star toggles */}
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-[var(--color-text-muted)] self-center">Known caps:</span>
                  {knownCaps.map((c) => (
                    <div key={c} className="flex items-center gap-0">
                      <button
                        onClick={() => setCapability(c)}
                        className="text-[10px] font-mono-data px-1.5 py-0.5 rounded-l bg-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border-strong)] transition-colors border border-[var(--color-border-strong)]"
                      >
                        {c}
                      </button>
                      <button
                        data-testid={`cap-star-${c}`}
                        onClick={() => toggleFavoriteCap(c)}
                        aria-label={favoriteCaps.includes(c) ? `Unstar ${c}` : `Star ${c}`}
                        className={`text-[10px] px-1 py-0.5 rounded-r transition-colors border border-l-0 border-[var(--color-border-strong)] ${
                          favoriteCaps.includes(c)
                            ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                            : 'bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-amber-400 hover:bg-[var(--color-border-strong)]'
                        }`}
                      >
                        {favoriteCaps.includes(c) ? '★' : '☆'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Audit Trail ──────────────────────────────────────────────────────

/** Map an audit event_type to a color family and icon */
function auditEventStyle(eventType: string): { color: string; icon: string } {
  const lower = eventType.toLowerCase();
  if (lower.includes('fail') || lower.includes('error') || lower.includes('denied')) {
    return { color: 'red', icon: '✕' };
  }
  if (lower.includes('warn') || lower.includes('escalat') || lower.includes('timeout')) {
    return { color: 'amber', icon: '⚠' };
  }
  if (lower.includes('complet') || lower.includes('success') || lower.includes('done') || lower.includes('allow')) {
    return { color: 'emerald', icon: '✓' };
  }
  return { color: 'gray', icon: '•' };
}

const COLOR_MAP: Record<string, { dot: React.CSSProperties; badge: React.CSSProperties }> = {
  emerald: {
    dot: { background: 'var(--color-emerald, #10b981)' },
    badge: { background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' },
  },
  amber: {
    dot: { background: '#f59e0b' },
    badge: { background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' },
  },
  red: {
    dot: { background: '#ef4444' },
    badge: { background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' },
  },
  gray: {
    dot: { background: 'var(--color-text-muted, #6b7280)' },
    badge: { background: 'var(--color-border)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-strong)' },
  },
};

/**
 * AuditTrail — collapsible audit log panel for result/error bubbles.
 * Lazy-fetches on first expand, caches result in state.
 */
const AuditTrail = memo(function AuditTrail({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  function handleToggle() {
    setOpen((v) => !v);
    // Lazy-fetch on first expand
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      setLoading(true);
      setFetchError(null);
      getTaskAudit(taskId)
        .then((res) => {
          if (res.ok && res.data) {
            setEntries(res.data.entries);
          } else {
            setFetchError(res.error ?? `HTTP ${res.status}`);
            fetchedRef.current = false; // allow retry
          }
        })
        .catch((err: unknown) => {
          setFetchError(err instanceof Error ? err.message : 'Unknown error');
          fetchedRef.current = false;
        })
        .finally(() => setLoading(false));
    }
  }

  return (
    <div
      style={{
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {/* Toggle button */}
      <button
        data-testid="audit-trail-toggle"
        onClick={handleToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: '11px',
          color: 'var(--color-text-muted)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '10px' }}>{open ? '▾' : '▸'}</span>
        <span>📋 Audit trail</span>
      </button>

      {/* Expanded panel */}
      {open && (
        <div
          data-testid="audit-trail-entries"
          style={{
            marginTop: '0.5rem',
            paddingLeft: '0.25rem',
          }}
        >
          {loading && (
            <p
              data-testid="audit-trail-loading"
              style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}
            >
              Loading audit trail…
            </p>
          )}

          {fetchError && !loading && (
            <p
              data-testid="audit-trail-error"
              style={{ fontSize: '11px', color: '#ef4444' }}
            >
              Failed to load audit trail: {fetchError}
            </p>
          )}

          {!loading && !fetchError && entries !== null && entries.length === 0 && (
            <p
              data-testid="audit-trail-empty"
              style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}
            >
              No audit events recorded for this task.
            </p>
          )}

          {!loading && !fetchError && entries && entries.length > 0 && (
            <ol
              role="list"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.375rem',
              }}
            >
              {entries.map((entry, idx) => {
                const { color, icon } = auditEventStyle(entry.event_type);
                const styles = COLOR_MAP[color] ?? COLOR_MAP.gray;

                const detailsText =
                  entry.details !== undefined
                    ? typeof entry.details === 'string'
                      ? entry.details
                      : JSON.stringify(entry.details)
                    : null;

                return (
                  <li
                    key={idx}
                    data-testid="audit-entry"
                    role="listitem"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      fontSize: '11px',
                    }}
                  >
                    {/* Color dot */}
                    <span
                      aria-hidden="true"
                      style={{
                        flexShrink: 0,
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        fontWeight: 700,
                        color: '#fff',
                        marginTop: '1px',
                        ...styles.dot,
                      }}
                    >
                      {icon}
                    </span>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Event type badge + timestamp */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span
                          data-testid="audit-entry-type"
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono, monospace)',
                            padding: '0.1em 0.4em',
                            borderRadius: '4px',
                            ...styles.badge,
                          }}
                        >
                          {entry.event_type}
                        </span>
                        <span
                          data-testid="audit-entry-timestamp"
                          style={{
                            fontSize: '10px',
                            color: 'var(--color-text-muted)',
                            fontFamily: 'var(--font-mono, monospace)',
                          }}
                        >
                          {entry.timestamp}
                        </span>
                        {entry.hook_name && (
                          <span style={{ fontSize: '10px', color: 'var(--color-text-dim)' }}>
                            {entry.hook_name}
                          </span>
                        )}
                        {entry.status !== undefined && (
                          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                            exit:{entry.status}
                          </span>
                        )}
                      </div>
                      {/* Details */}
                      {detailsText && (
                        <p
                          data-testid="audit-entry-details"
                          style={{
                            marginTop: '0.2rem',
                            fontSize: '10px',
                            color: 'var(--color-text-muted)',
                            wordBreak: 'break-word',
                          }}
                        >
                          {detailsText}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
});

// ── Message feedback ─────────────────────────────────────────────────

const FEEDBACK_STORAGE_KEY = 'kubex-chat-feedback';

/** Load feedback map from localStorage. Returns { [messageId]: 'up' | 'down' } */
function loadFeedbackMap(): Record<string, 'up' | 'down'> {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, 'up' | 'down'>;
  } catch {
    return {};
  }
}

/** Save feedback map to localStorage */
function saveFeedbackMap(map: Record<string, 'up' | 'down'>) {
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota exceeded or private browsing — ignore
  }
}

/**
 * MessageFeedback — thumbs up / down reaction buttons for result bubbles.
 * Feedback is persisted to localStorage keyed by message id.
 * Clicking the same button again removes the vote (toggle).
 */
const MessageFeedback = memo(function MessageFeedback({ messageId }: { messageId: string }) {
  const [vote, setVote] = useState<'up' | 'down' | null>(() => {
    const map = loadFeedbackMap();
    return map[messageId] ?? null;
  });
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  function handleVote(direction: 'up' | 'down') {
    setVote((prev) => {
      const next = prev === direction ? null : direction;
      // Persist
      const map = loadFeedbackMap();
      if (next === null) {
        delete map[messageId];
      } else {
        map[messageId] = next;
      }
      saveFeedbackMap(map);

      // Flash animation feedback
      if (next !== null) {
        setFlash(next);
        setTimeout(() => setFlash(null), 600);
      }

      return next;
    });
  }

  return (
    <div
      data-testid="message-feedback"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <span
        style={{
          fontSize: '10px',
          color: 'var(--color-text-muted)',
          marginRight: '0.25rem',
          userSelect: 'none',
        }}
      >
        Helpful?
      </span>

      {/* Thumbs up */}
      <button
        data-testid="feedback-up"
        onClick={() => handleVote('up')}
        aria-label="Mark as helpful"
        aria-pressed={vote === 'up'}
        title={vote === 'up' ? 'Remove helpful vote' : 'Mark as helpful'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          borderRadius: '6px',
          border: vote === 'up'
            ? '1px solid rgba(16,185,129,0.6)'
            : '1px solid var(--color-border)',
          background: vote === 'up'
            ? 'rgba(16,185,129,0.15)'
            : flash === 'up'
            ? 'rgba(16,185,129,0.08)'
            : 'var(--color-surface-dark)',
          color: vote === 'up' ? '#10b981' : 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: '12px',
          transition: 'all 0.15s ease',
          transform: flash === 'up' ? 'scale(1.25)' : 'scale(1)',
        }}
      >
        👍
      </button>

      {/* Thumbs down */}
      <button
        data-testid="feedback-down"
        onClick={() => handleVote('down')}
        aria-label="Mark as not helpful"
        aria-pressed={vote === 'down'}
        title={vote === 'down' ? 'Remove not-helpful vote' : 'Mark as not helpful'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          borderRadius: '6px',
          border: vote === 'down'
            ? '1px solid rgba(239,68,68,0.6)'
            : '1px solid var(--color-border)',
          background: vote === 'down'
            ? 'rgba(239,68,68,0.15)'
            : flash === 'down'
            ? 'rgba(239,68,68,0.08)'
            : 'var(--color-surface-dark)',
          color: vote === 'down' ? '#ef4444' : 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: '12px',
          transition: 'all 0.15s ease',
          transform: flash === 'down' ? 'scale(1.25)' : 'scale(1)',
        }}
      >
        👎
      </button>

      {/* Confirmation label shown after voting */}
      {vote !== null && (
        <span
          data-testid="feedback-label"
          style={{
            fontSize: '10px',
            color: vote === 'up' ? '#10b981' : '#ef4444',
            marginLeft: '0.25rem',
          }}
        >
          {vote === 'up' ? 'Marked helpful' : 'Marked not helpful'}
        </span>
      )}
    </div>
  );
});

// ── Search highlighting ────────────────────────────────────────────────

/**
 * Splits `text` into alternating plain and highlighted segments for a
 * case-insensitive search query. Returns React nodes with `<mark>` wrapping
 * each matched occurrence. Returns a plain string when query is empty.
 */
function highlightText(text: string, query: string): ReactNode {
  if (!query.trim()) return text;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            data-testid="search-highlight"
            style={{
              background: 'rgba(251, 191, 36, 0.35)',
              color: 'inherit',
              borderRadius: '2px',
              padding: '0 1px',
            }}
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * A rehype plugin that walks text nodes in the HAST tree and wraps occurrences
 * of `query` in `<mark>` elements. Used to highlight search matches inside
 * ReactMarkdown-rendered result bubbles.
 *
 * Uses unist-util-visit (already a transitive dependency) to traverse the tree.
 * Replaces matched text nodes with arrays of text + mark element nodes so the
 * DOM receives real <mark> elements — no rehype-raw required.
 */
function createRehypeHighlightSearch(query: string): Plugin<[], Root> {
  return () => (tree: Root) => {
    if (!query.trim()) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');

    visit(tree, 'text', (node: Text, index: number | undefined, parent) => {
      // Skip code blocks — don't highlight inside syntax-highlighted code
      if (
        parent &&
        'tagName' in parent &&
        (parent as Element).tagName === 'code'
      ) {
        return;
      }

      const parts = node.value.split(regex);
      if (parts.length === 1 || index === undefined || !parent || !('children' in parent)) return;

      const newNodes: ElementContent[] = [];
      for (const part of parts) {
        regex.lastIndex = 0;
        if (regex.test(part)) {
          newNodes.push({
            type: 'element',
            tagName: 'mark',
            properties: { 'data-testid': 'search-highlight' },
            children: [{ type: 'text', value: part }],
          } as Element);
        } else if (part) {
          newNodes.push({ type: 'text', value: part } as Text);
        }
      }

      // Splice the replacement nodes into parent.children at index
      (parent.children as ElementContent[]).splice(index, 1, ...newNodes);

      // Skip the newly inserted nodes to avoid reprocessing
      return [SKIP, index + newNodes.length];
    });
  };
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
const ChatBubble = memo(function ChatBubble({
  message,
  onRetry,
  disabled,
  searchQuery = '',
}: {
  message: ChatMessage;
  onRetry?: (retryCapability: string | undefined, retryMessage: string | undefined) => void;
  disabled?: boolean;
  searchQuery?: string;
}) {
  const isUser = message.role === 'user';
  const isResult = message.role === 'result';
  const isError = message.role === 'error';
  const isSystem = message.role === 'system';

  // Expand/collapse state for result bubbles. Long content starts collapsed.
  const isLong = isResult && message.content.split('\n').length > COLLAPSE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

  if (isSystem) {
    return (
      <div className="flex flex-col items-center gap-0.5" data-testid="system-message">
        <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full px-3 py-1">
          {highlightText(message.content, searchQuery)}
        </span>
        <RelativeTime
          date={message.timestamp}
          className="text-[10px] text-[var(--color-text-muted)] font-mono-data"
          data-testid="chat-bubble-timestamp"
        />
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
            <p className="text-sm text-[var(--color-text)]">{highlightText(message.content, searchQuery)}</p>
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
    const canRetry = !!onRetry && !!message.retryMessage;

    return (
      <div className="flex justify-start" data-testid="error-bubble">
        <div className="max-w-xl">
          <div className="rounded-2xl rounded-tl-sm bg-red-500/10 border border-red-500/25 px-4 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-xs text-red-400 font-medium">Error</p>
              {canRetry && (
                <button
                  data-testid="retry-button"
                  onClick={() => onRetry!(message.retryCapability, message.retryMessage)}
                  disabled={disabled}
                  aria-label="Retry this task"
                  title="Retry — re-fills the input with the original message so you can send it again"
                  className="
                    flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium
                    border border-red-500/30 bg-red-500/10 text-red-400
                    hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-300
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  <span aria-hidden="true">↺</span>
                  Retry
                </button>
              )}
            </div>
            <p className="text-sm text-[var(--color-text)]">{highlightText(message.content, searchQuery)}</p>
            {message.phases && message.phases.length > 0 && (
              <div className="mt-2 pt-2 border-t border-red-500/15">
                <TaskTimeline phases={message.phases} data-testid="error-bubble-timeline" />
              </div>
            )}
            {/* Audit trail — lazy-loaded on expand, only when task_id is present */}
            {message.task_id && (
              <AuditTrail taskId={message.task_id} />
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
                {highlightText(message.content, searchQuery)}
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
                  rehypePlugins={[rehypeHighlight, createRehypeHighlightSearch(searchQuery)]}
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

            {/* Task lifecycle timeline — shown at the bottom of result bubbles */}
            {message.phases && message.phases.length > 0 && (
              <div className={`mt-2 pt-2 border-t border-[var(--color-border)]`}>
                <TaskTimeline phases={message.phases} data-testid="result-bubble-timeline" />
              </div>
            )}

            {/* Audit trail — lazy-loaded on expand, only when task_id is present */}
            {message.task_id && (
              <AuditTrail taskId={message.task_id} />
            )}

            {/* DISABLED: awaiting POST /tasks/{id}/feedback backend endpoint */}
            {/* <MessageFeedback messageId={message.id} /> */}
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
