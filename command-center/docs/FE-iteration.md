# Iteration 96: Conversation Participant Model — Kubex Join/Leave

> Status: **READY** — BE delivered Phase 14
> Date: 2026-03-26
> BE Phase: 14-orchestrator-participant-events (landed 2026-03-27)

---

## Concept

The orchestrator chat is a **group conversation**. When a worker kubex starts interacting (HITL), it "joins the chat." When the orchestrator forwards the user's answer, it "leaves." Each kubex gets its own named bubbles.

---

## Critical: SSE Event Parsing

Participant events arrive as **progress chunks**, not top-level SSE event types. The raw SSE data looks like:

```json
{"task_id": "...", "agent_id": "orchestrator", "chunk": "{\"type\":\"agent_joined\",...}", "final": false}
```

The `chunk` field contains a JSON string with the actual event. The FE must:

1. Check if `data.chunk` exists and is a string
2. Try `JSON.parse(data.chunk)`
3. Check the parsed object's `type` field for `agent_joined`, `agent_left`, `hitl_request`
4. If parse fails or `type` is not recognized, treat as plain stdout text (existing behavior)

This check should happen **before** the existing `data.type === 'stdout'` branch in `handleSSEMessage`.

---

## Event Shapes (from Phase 14)

### agent_joined (parsed from chunk)

```json
{"type": "agent_joined", "agent_id": "knowledge", "sub_task_id": "task-xxx", "capability": "knowledge_management"}
```

Triggers: first `need_info` from a worker (not at dispatch time).

### agent_left (parsed from chunk)

```json
{"type": "agent_left", "agent_id": "knowledge", "sub_task_id": "task-xxx", "status": "resolved"}
```

Triggers: orchestrator forwards HITL answer via `kubex__forward_hitl_response`.

### hitl_request (parsed from chunk)

```json
{"type": "hitl_request", "prompt": "Which account?", "source_agent": "instagram-scraper"}
```

Triggers: every `need_info` poll from the worker.

---

## FE Implementation Plan

### A. Chunk parsing in handleSSEMessage

Add a new branch at the **top** of `handleSSEMessage`, before the `stdout`/`stderr` check:

```ts
// Try parsing chunk as structured event
if (typeof data.chunk === 'string' && data.chunk.startsWith('{')) {
  try {
    const event = JSON.parse(data.chunk);
    if (event.type === 'agent_joined') { /* handle join */ return; }
    if (event.type === 'agent_left') { /* handle leave */ return; }
    if (event.type === 'hitl_request') { /* handle HITL with source_agent */ return; }
  } catch { /* not JSON — fall through to stdout */ }
}
```

### B. Participant tracking

- `useRef<Set<string>>` for `activeParticipantsRef`
- `maybeEmitJoin(agentId, capability?)` — if agent_id is truthy, not "orchestrator", and not in set: inject system message, add to set
- `maybeEmitLeave(agentId, status)` — if agent_id is in set: inject system message, remove from set
- Reset on `handleClearChat`

### C. System messages

- Join: `"{agent_id} joined the chat"` (role: 'system')
- Leave: `"{agent_id} left the chat"` (role: 'system')
- Leave failed: `"{agent_id} left the chat — task failed"` (role: 'system')

### D. HITL attribution

When `hitl_request` has `source_agent`, use it instead of the current generic prompt. Pass `source_agent` to `setHitlRequest` so `HITLPrompt` can show who's asking.

### E. Named bubbles

Result bubbles with a non-orchestrator `agent_id` show the agent name as the sender.

### F. Fallback for non-chunk events

For `result`/`failed`/`cancelled` events that arrive as top-level SSE types (cached result path, BUG-007 fix), continue using `extractResultContent().agentId` for join/leave emission.

### G. Tests

- E2E: mock SSE with chunk-encoded `agent_joined`/`agent_left` events, verify system messages
- E2E: mock SSE with chunk-encoded `hitl_request` with `source_agent`, verify attribution
- E2E: verify result bubbles show agent name as sender

---

## Files

| Action | File |
|--------|------|
| Modify | `src/components/OrchestratorChat.tsx` — chunk parsing, participant tracking, join/leave messages |
| Modify | `src/components/HITLPrompt.tsx` — source agent display |
| Create | `tests/e2e/conversation-participants.spec.ts` |

---

## Git Protocol

- **BUGS.md changes must be pushed immediately.**
- **Push after every iteration.**
