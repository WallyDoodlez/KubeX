# Iteration 96: Conversation Participant Model — Kubex Join/Leave

> Status: **BLOCKED — awaiting BE review of FE-BE-REQUESTS.md**
> Date: 2026-03-26
> Depends on: `agent_joined`/`agent_left` progress events + HITL `source_agent` (see FE-BE-REQUESTS.md)

---

## Concept

The orchestrator chat is a **group conversation**. When the orchestrator dispatches work to a kubex, that kubex "joins the chat." When its task completes or fails, it "leaves." Each kubex gets its own named bubbles, so the user sees who's talking.

---

## FE Implementation Plan (ready to build once BE confirms)

### A. Participant tracking

- `useRef<Set<string>>` for active participants
- `maybeEmitJoin(agentId)` / `maybeEmitLeave(agentId, status)` helpers
- System messages: "{agent_id} joined the chat" / "{agent_id} left the chat"
- Orchestrator is implicit — never joins/leaves
- Reset on `handleClearChat` or new send after idle

### B. SSE event handling

- `agent_joined` event → add to participants, inject join system message
- `agent_left` event → remove from participants, inject leave system message
- `hitl_request` with `source_agent` → join (if new)
- `result`/`failed`/`cancelled` with non-orchestrator `agent_id` → join + leave
- Fallback: extract from `extractResultContent().agentId`

### C. Named bubbles

- Result bubbles show agent name as sender (group chat style)
- HITL prompts show source agent name

### D. Tests

- E2E: mock `agent_joined`/`agent_left` SSE events, verify system messages
- E2E: mock result with worker agent_id, verify named bubble
- E2E: mock HITL with source_agent, verify attribution

---

## Files

| Action | File |
|--------|------|
| Modify | `src/components/OrchestratorChat.tsx` — participant tracking, join/leave messages |
| Modify | `src/components/HITLPrompt.tsx` — source agent display |
| Create | `tests/e2e/conversation-participants.spec.ts` |

---

## Git Protocol

- **BUGS.md changes must be pushed immediately.**
- **Push after every iteration.**
