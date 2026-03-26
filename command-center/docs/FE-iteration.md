# Iteration 96: Conversation Participant Model — Kubex Join/Leave

> Status: **BLOCKED — awaiting BE review**
> Date: 2026-03-26

---

## Concept

The orchestrator chat is a **group conversation**. When the orchestrator dispatches work to a kubex, that kubex "joins the chat." When its task completes or fails, it "leaves." Each kubex gets its own named bubbles, so the user sees who's talking.

---

## BE Review Required — agent_id Attribution Gap

After reading the backend code, the FE **cannot reliably derive** which worker kubex was involved. Here's why:

### How the SSE pipeline works

```
User sends message
  → FE dispatches to orchestrator (POST /actions → task_orchestration)
  → FE subscribes to SSE stream: GET /tasks/{orchestrator_task_id}/stream
  → Gateway subscribes to Redis pub/sub: progress:{orchestrator_task_id}
```

The FE only sees events on the **orchestrator's** progress channel. Worker progress goes to the worker's own channel (`progress:{sub_task_id}`), which the FE is NOT subscribed to.

### What the orchestrator posts to its own channel

| Event | `agent_id` value | Source file |
|-------|-----------------|-------------|
| Progress chunk | `self.config.agent_id` = **"orchestrator"** | `mcp_bridge.py:663` |
| Result stored | `self.config.agent_id` = **"orchestrator"** | `mcp_bridge.py:680` |
| Final progress | `self.config.agent_id` = **"orchestrator"** | `mcp_bridge.py:663` |

The orchestrator always stamps **its own** `agent_id` on everything. The worker's identity is lost — it's buried inside the free-text `output` string that the orchestrator's LLM chose to write.

### What the CLI runtime posts (for CLI-based orchestrators)

Same pattern — `cli_runtime.py:904` posts `self.config.agent_id` on progress events. If the orchestrator is a Claude Code CLI instance, it writes its own agent_id on stdout progress chunks.

### The exception: cached result path

The Gateway SSE BUG-007 fix (line 755-763) constructs a result event from the cached `task:result:{task_id}` Redis key. This includes `agent_id` from the result payload — which IS the orchestrator's agent_id, not the worker's.

### What about HITL?

The HITL design doc (`design-orchestrator-chat-hitl.md` line 63) specifies that the orchestrator should forward HITL requests with `source_agent`:

```json
{"type": "hitl_request", "prompt": "Which account?", "source_agent": "instagram-scraper"}
```

But this is **not yet implemented** in `mcp_bridge.py`. The orchestrator's MCP Bridge doesn't detect HITL events from workers or forward them with attribution. This is a planned feature from the design doc, not live code.

---

## What the BE needs to provide

For the FE to know which kubex is involved, the orchestrator needs to emit **structured participant events** on its own progress channel when it dispatches/receives sub-tasks.

### Option A: New progress event types (recommended)

The orchestrator's MCP Bridge should emit these on `progress:{orchestrator_task_id}`:

```json
{"type": "agent_joined", "agent_id": "instagram-scraper", "sub_task_id": "task-xxx", "capability": "scrape_instagram"}
```

```json
{"type": "agent_left", "agent_id": "instagram-scraper", "sub_task_id": "task-xxx", "status": "completed", "duration_ms": 4200}
```

**Where to emit:**
- `agent_joined` → when `_call_tool` processes a `kubex__dispatch_task` tool call and gets a successful response
- `agent_left` → when `_call_tool` processes a `kubex__check_task_status` or `kubex__get_task_result` and the sub-task is terminal

This is a small change in `mcp_bridge.py` — the tool call handlers already know the target agent_id and sub_task_id.

### Option B: Include worker agent_id in result payload

When the orchestrator stores its final result, include the worker(s) that contributed:

```json
{
  "status": "completed",
  "agent_id": "orchestrator",
  "output": "...",
  "involved_agents": ["instagram-scraper", "knowledge"]
}
```

This is simpler but only tells the FE after the fact — no real-time join/leave.

### Option C: HITL source_agent (already designed, not implemented)

Implement the `source_agent` field on HITL forwarding as specified in `design-orchestrator-chat-hitl.md`. This gives attribution for HITL events but not for regular results.

### Recommended: Option A + C

Option A gives real-time participant tracking. Option C gives HITL attribution. Together they cover all cases.

---

## What the FE can do today (without BE changes)

1. **Extract `agent_id` from `extractResultContent()`** — already done in Iteration 95. If the worker's result was forwarded verbatim by the orchestrator, the inner JSON may contain the worker's agent_id in `result.agent_id` or `metadata.agent_id`. This works for CLI runtime results but is fragile.

2. **Show whatever agent_id we get** — if the extracted agent_id is "orchestrator", don't show a join/leave. If it's something else, show it. This degrades gracefully.

3. **Parse stdout for dispatch hints** — the orchestrator's LLM often writes things like "Dispatching to instagram-scraper..." in stdout. We could regex this, but it's unreliable.

---

## FE implementation plan (ready to build once BE confirms)

### A. Participant tracking

- `useRef<Set<string>>` for active participants
- `maybeEmitJoin(agentId)` / `maybeEmitLeave(agentId, status)` helpers
- System messages: "{agent_id} joined the chat" / "{agent_id} left the chat"
- Orchestrator is implicit — never joins/leaves

### B. SSE event handling

- New event types `agent_joined` / `agent_left` → direct join/leave
- `hitl_request` with `source_agent` → join
- `result`/`failed`/`cancelled` with non-orchestrator `agent_id` → join + leave
- Fallback: extract from `extractResultContent().agentId`

### C. Named bubbles

- Result bubbles show agent name as sender (group chat style)
- HITL prompts show source agent

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

## Action Items

- [ ] **BE team:** Review this document and confirm Option A (agent_joined/agent_left progress events) is feasible
- [ ] **BE team:** Implement `source_agent` on HITL forwarding (Option C — already in design doc)
- [ ] **FE team:** Build participant tracking once BE confirms event format
- [ ] **FE team:** Build fallback extraction from `extractResultContent().agentId` (works today, no BE dependency)

---

## Git Protocol

- **BUGS.md changes must be pushed immediately.**
- **Push after every iteration.**
