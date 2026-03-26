# Iteration 96: Conversation Participant Model — Kubex Join/Leave

> Status: **PLANNED**
> Date: 2026-03-26

---

## Concept

The orchestrator chat is a **group conversation**. When the orchestrator dispatches work to a kubex, that kubex "joins the chat." When its task completes or fails, it "leaves." Each kubex gets its own named bubbles, so the user sees who's talking.

This is derived entirely from existing SSE events — no backend changes required.

---

## Architecture

### Join/Leave detection

The FE maintains a `Set<string>` of active participant agent_ids for the current conversation.

**Join trigger:** Any SSE event with an `agent_id` (or `source_agent` for HITL) that we haven't seen before → inject a system message "**{agent_id}** joined the chat" and add to participants set.

**Leave trigger:** A terminal event (`result`, `failed`, `cancelled`) with an `agent_id` → inject a system message "**{agent_id}** left the chat" (or "left the chat — failed" for errors) and remove from participants set.

**Orchestrator exception:** The orchestrator is always implicit — it doesn't "join" or "leave." Only worker kubexes get join/leave messages.

### Event-to-agent mapping

| SSE event type | agent_id source | Triggers join? | Triggers leave? |
|---|---|---|---|
| `result` / `completed` | `data.agent_id` or extracted via `extractResultContent` | Yes (if new) | Yes |
| `failed` / `cancelled` | `data.agent_id` | Yes (if new) | Yes |
| `hitl_request` | `data.source_agent` or `data.agent_id` | Yes (if new) | No |
| `stdout` / `stderr` | None (orchestrator implicit) | No | No |

### Message attribution

Result and error bubbles already carry `agent_id` in the ChatMessage type. The bubble renders this as the sender name — like a group chat participant.

HITL requests should also carry the `source_agent` so the prompt shows who's asking.

---

## Plan

### A. Participant tracking in OrchestratorChat

1. Add a `useRef<Set<string>>` for `activeParticipantsRef` — tracks agent_ids that have joined but not left.
2. Add a helper `maybeEmitJoin(agentId)` — if agent_id is truthy, not "orchestrator", and not in the set, inject a system message and add to set.
3. Add a helper `maybeEmitLeave(agentId, status)` — if agent_id is in the set, inject a system message and remove from set.
4. Reset the set when a new conversation starts (on `handleClearChat` or new send after idle).

### B. Wire into handleSSEMessage

1. **`result`/`completed`:** After extracting agent_id, call `maybeEmitJoin(agentId)` then `maybeEmitLeave(agentId, 'completed')`.
2. **`failed`/`cancelled`:** Call `maybeEmitJoin(agentId)` then `maybeEmitLeave(agentId, data.type)`.
3. **`hitl_request`:** Extract `source_agent` or `agent_id`, call `maybeEmitJoin(agentId)`. Store agent_id on the HITL request so the prompt shows who's asking.

### C. Wire into poll fallback paths

The 4 poll fallback paths that call `extractResultContent(rr.data)` should also emit join/leave for the extracted `agentId`.

### D. System message format for join/leave

Use the existing `role: 'system'` message type:

- Join: `"{agent_id} joined the chat"`
- Leave (completed): `"{agent_id} left the chat"`
- Leave (failed): `"{agent_id} left the chat — task failed"`
- Leave (cancelled): `"{agent_id} left the chat — task cancelled"`

### E. Named bubbles for worker results

The result bubble already shows `agent_id` as a badge (Iteration 95). Change: render it as the **sender name** above the bubble content, not as a pill inside. Same data, different position — like how chat apps show the sender name in a group chat.

### F. HITL attribution

When `hitl_request` carries `source_agent`, show it in the HITL prompt UI so the user knows which kubex is asking the question.

### G. Tests

- E2E: Mock SSE events with different agent_ids, verify join/leave system messages appear
- E2E: Verify result bubbles show agent name as sender
- E2E: Verify HITL prompt shows source agent name

---

## Files

| Action | File |
|--------|------|
| Modify | `src/components/OrchestratorChat.tsx` — participant tracking, join/leave messages, bubble attribution |
| Modify | `src/components/HITLPrompt.tsx` — show source agent (if needed) |
| Create | `tests/e2e/conversation-participants.spec.ts` |

---

## Git Protocol

- **BUGS.md changes must be pushed immediately.**
- **Push after every iteration.**
