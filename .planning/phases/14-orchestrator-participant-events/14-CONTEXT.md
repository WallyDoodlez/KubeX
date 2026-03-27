# Phase 14: Orchestrator Participant Events - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Emit `agent_joined` / `agent_left` structured progress events from MCP Bridge when workers interact with the user (HITL). Add `source_agent` field to `hitl_request` SSE events. All changes are in `mcp_bridge.py` — the orchestrator is the only hub for inter-kubex communication. Workers (CLI or API) are not affected.

Unblocks FE Iteration 96 conversation participant model.

</domain>

<decisions>
## Implementation Decisions

### Interaction-only participant model
- **D-01:** `agent_joined` fires ONLY when a worker sends a `need_info` (HITL) response — not on every dispatch. Workers that complete silently never appear as chat participants.
- **D-02:** `agent_left` fires when the user answers the HITL question (worker got what it needed). Not on sub-task terminal state.
- **D-03:** Join once per sub-task, leave on resolve. If a worker sends multiple HITL requests during one sub-task, only the first triggers `agent_joined`. Subsequent `need_info` responses are additional `hitl_request` events without another join.

### Worker identity resolution
- **D-04:** Worker `agent_id` comes from the poll/result payload — no guessing at dispatch time. The orchestrator doesn't know which specific kubex picks up a task (competing consumer model via Broker streams). Identity is only known when the worker responds.
- **D-05:** No Registry lookup at dispatch time. Capability ≠ agent_id (multiple kubexes could serve the same capability).

### Event payloads
- **D-06:** `agent_joined` payload: `{"type": "agent_joined", "agent_id": "<from result>", "sub_task_id": "<task-id>", "capability": "<capability>"}`
- **D-07:** `agent_left` payload: `{"type": "agent_left", "agent_id": "<from result>", "sub_task_id": "<task-id>", "status": "resolved"}`
- **D-08:** No `duration_ms` field — not meaningful in the interaction-only model (duration is just how long the user took to answer).

### HITL source_agent attribution
- **D-09:** Bundled into Phase 14 — same code path as participant events (both trigger on worker `need_info`).
- **D-10:** `hitl_request` SSE event includes `source_agent` field identifying which worker asked the question. Example: `{"type": "hitl_request", "prompt": "Which account?", "source_agent": "instagram-scraper"}`
- **D-11:** Event lifecycle for a HITL interaction: `agent_joined` → `hitl_request(source_agent)` → user answers → `agent_left`

### Emission location
- **D-12:** Both events emitted via existing `_post_progress()` method on the orchestrator's own progress channel (`progress:{orchestrator_task_id}`). No new endpoints needed.
- **D-13:** `agent_joined` emitted inside `_handle_poll_task()` when it first detects `need_info` status for a sub-task. `agent_left` emitted when the orchestrator receives the user's HITL answer and forwards it.
- **D-14:** Track "already joined" state per sub_task_id to prevent duplicate `agent_joined` events on repeated polls.

### Scope boundaries
- **D-15:** MCP Bridge orchestrator only (`mcp_bridge.py`). CLI kubexes are workers — they don't orchestrate or emit participant events.
- **D-16:** All kubexes (CLI or API) are workers. CLI vs API is just how the LLM is invoked. Workers communicate only with the orchestrator via Gateway/Broker. No kubex-to-kubex direct communication.

### Claude's Discretion
- Internal data structure for tracking "already joined" sub-tasks (set, dict, etc.)
- Whether to log participant events for debugging
- Error handling if `_post_progress` fails for a participant event (should not block the poll/HITL flow)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### FE-BE requests (source of truth for event shapes)
- `command-center/docs/FE-BE-REQUESTS.md` — agent_joined/agent_left section (line 884+) and HITL source_agent section (line 925+)

### MCP Bridge implementation
- `agents/_base/kubex_harness/mcp_bridge.py` — `_handle_poll_task()` (line 109), `_handle_worker_dispatch()` (line 827), `_post_progress()` (line 656), `dispatch_concurrent()` (line 729)

### Design docs
- `docs/design-orchestrator-chat-hitl.md` — HITL forwarding design including `source_agent` field spec

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_post_progress(task_id, chunk, final, exit_reason)` at `mcp_bridge.py:656` — existing method for posting progress events. Currently takes `chunk` as a string; participant events will need structured JSON payloads passed as the chunk.
- `_handle_poll_task(task_id)` at `mcp_bridge.py:109` — already returns `need_info` status with worker identity in the response data. This is the hook point for detecting HITL and emitting `agent_joined`.
- `_delegation_depth` dict at `mcp_bridge.py:873` — existing per-task tracking pattern. Same approach can track "joined" sub-tasks.

### Established Patterns
- Progress events use `_post_progress()` → HTTP POST to `{gateway_url}/tasks/{task_id}/progress` with `agent_id`, `chunk`, `final` fields.
- The orchestrator stamps `self.config.agent_id` on all progress events (line 663). Participant events need to include the **worker's** agent_id, not the orchestrator's — this is a new field, not a replacement.

### Integration Points
- `_handle_poll_task()` — where `need_info` is detected and `agent_joined` + `hitl_request(source_agent)` should be emitted
- HITL answer forwarding path — where `agent_left` should be emitted (after user responds)
- `dispatch_concurrent()` — no changes needed (dispatch doesn't trigger events in the interaction-only model)

</code_context>

<deferred>
## Deferred Ideas

- **CLI orchestration via harness MCP server** — discussed and determined unnecessary. All kubexes are workers; only the API-mode orchestrator dispatches. If CLI orchestration is ever needed, expose harness as MCP server to CLI subprocess with kubex tools. Captured here, not in Phase 14 scope.
- **A2A protocol adoption** — explored as potential kubex-to-kubex protocol. Not needed because workers don't talk to each other; all communication goes through orchestrator via Gateway/Broker. Could revisit if cross-orchestrator federation becomes a requirement.
- **CLI-side participant events** — not needed. CLI kubexes are workers that return results. The orchestrator emits participant events based on what it observes in poll results.

</deferred>

---

*Phase: 14-orchestrator-participant-events*
*Context gathered: 2026-03-26*
