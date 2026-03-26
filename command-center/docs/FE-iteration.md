# Iteration 95: Smart Agent Result Rendering + Auto-Scroll Fix

> Status: **PLANNED**
> Date: 2026-03-26

---

## Problem Statement

### P1: Raw JSON result dumps

When the orchestrator returns a result, the chat renders it as a raw JSON blob:

```json
{
  "type": "result",
  "final": true,
  "task_id": "task-f459f1e6533d",
  "status": "completed",
  "output": "{\n  \"status\": \"completed\",\n  \"result\": {\n    \"agent_id\": \"knowledge\",\n    \"capabilities\": [\n      \"knowledge_management\",\n      \"knowledge_query\",\n      \"knowledge_storage\"\n    ],\n    \"role_summary\": \"I'm the KubexClaw swarm's knowledge management specialist...\"\n  },\n  \"metadata\": {\n    \"agent_id\": \"knowledge\",\n    \"task_id\": \"unknown\",\n    \"duration_ms\": 0\n  }\n}",
  "agent_id": "knowledge"
}
```

Two bugs stacked:

1. **Extraction bug** — `handleSSEMessage` checks `data.result` but the actual payload lives in `data.output`. The code falls through to `JSON.stringify(data, null, 2)` and dumps the entire SSE envelope.
2. **Rendering bug** — Even when results arrive via the poll fallback (`rr.data.result`), the content is often a JSON string. `isLikelyJSON()` catches it and renders it in a `<pre>` block, bypassing the markdown renderer entirely.

### P2: Chat doesn't scroll to progress on send

When the user sends a message, the chat window doesn't auto-scroll to show the typing indicator and progress box. The user has to manually scroll down.

Root cause: Auto-scroll `useEffect` only watches `messages`. The typing indicator depends on `sending` state, and the progress timeline depends on `livePhases` — neither triggers a scroll.

---

## Expected Outcome

### Result rendering (P1)

Instead of raw JSON, the user should see:

> **knowledge** agent
>
> I'm the KubexClaw swarm's knowledge management specialist. I search, retrieve, create, and update notes in an Obsidian-style markdown vault (a linked knowledge base). I can organize information into facts/entities/events/decisions/logs and maintain bidirectional wiki-links between notes.
>
> **Capabilities:** knowledge_management, knowledge_query, knowledge_storage
>
> *completed in <1s*

- Agent name badge on result bubbles
- Duration footer when available
- Structured results converted to readable markdown
- Unknown/unstructured results fall back to pretty JSON in a code block (still better than dumping the SSE envelope)

### Auto-scroll (P2)

- Sending a message snaps the view to the bottom, even if the user had scrolled up
- Typing indicator and progress box are immediately visible after send
- Terminal output expansion and live phase updates also trigger scroll

---

## Plan

### A. Smart Agent Result Rendering

#### A1. New utility: `src/utils/formatAgentResult.ts`

```ts
extractResultContent(data) → { text: string; agentId?: string; durationMs?: number }
```

- **Priority chain:** `data.output` → `data.result` → `data` (fallback)
- **Double-decode:** If the extracted value is a JSON string, parse it. If the inner object has `.result`, unwrap that too.
- **Markdown conversion:** Known fields (`role_summary`, `capabilities`, `error`) → readable markdown. Unknown object shapes → `json` code block.
- **Metadata extraction:** Pull `agent_id` and `duration_ms` from metadata or top-level fields.

#### A2. Refactor `OrchestratorChat.tsx` — DRY extraction

Replace all 5 identical copies of:

```ts
const resultText =
  typeof data.result === 'string'
    ? data.result
    : data.result !== undefined
    ? JSON.stringify(data.result, null, 2)
    : JSON.stringify(data, null, 2);
```

With a single call to `extractResultContent()`.

Locations (all in `OrchestratorChat.tsx`):
1. `handleSSEMessage` — SSE result event (line ~267)
2. `handleSSEComplete` recovery poll (line ~357)
3. Post-dispatch 2s poll (line ~449)
4. Stale task recovery poll (line ~549)
5. Task recovery SSE complete fallback (line ~744)

#### A3. Add `agent_id` + `duration_ms` to `ChatMessage` type

In `src/types.ts`, add two optional fields to the `ChatMessage` interface:

```ts
agent_id?: string;      // Which agent produced this result
duration_ms?: number;    // How long the task took
```

#### A4. Agent badge + duration in ChatBubble

In the result rendering path of `ChatBubble`:

- Show a small pill badge with the agent name (e.g. `knowledge`) in the bubble header when `message.agent_id` is set
- Show "completed in 1.2s" as a subtle footer line when `message.duration_ms` is set

#### A5. Smarter JSON rendering

`extractResultContent` converts structured results to markdown before they reach the `isLikelyJSON` check, so fewer results hit the `<pre>` path. The `isLikelyJSON` fallback stays for genuinely raw JSON responses.

### B. Auto-Scroll on Send + Progress Visibility

#### B1. Scroll on sending state change

Add `sending` and `terminalLines.length` to the auto-scroll `useEffect` dependencies:

```ts
useEffect(() => {
  if (autoScrollRef.current) {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasNewMessages(false);
  } else {
    setHasNewMessages(true);
  }
}, [messages, sending, terminalLines.length]);
```

#### B2. Force auto-scroll on send

In `handleSend`, after `addMessage`, explicitly re-engage auto-scroll:

```ts
setAutoScroll(true);
autoScrollRef.current = true;
```

This snaps the user back to bottom even if they had scrolled up mid-conversation.

#### B3. Scroll on live phase updates

Add `livePhases` to the effect deps so progress timeline expansion also triggers scroll.

### C. Tests

- **Unit:** `tests/unit/formatAgentResult.test.ts` — extraction paths, double-decode, markdown conversion, unknown shapes, missing fields
- **E2E:** `tests/e2e/agent-result-rendering.spec.ts` — mock SSE result with the exact payload shape above, verify readable text (not raw JSON), agent badge visible, duration visible
- **E2E:** Add scroll-on-send assertion to existing chat E2E — after send, typing indicator should be visible in viewport

---

## Files

| Action | File |
|--------|------|
| Create | `src/utils/formatAgentResult.ts` |
| Modify | `src/types.ts` — add `agent_id`, `duration_ms` to ChatMessage |
| Modify | `src/components/OrchestratorChat.tsx` — DRY extraction, scroll fix |
| Create | `tests/e2e/agent-result-rendering.spec.ts` |
