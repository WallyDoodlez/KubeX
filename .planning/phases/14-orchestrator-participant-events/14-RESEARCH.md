# Phase 14: Orchestrator Participant Events - Research

**Researched:** 2026-03-26
**Domain:** MCP Bridge event emission — structured SSE progress events for agent lifecycle
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Interaction-only participant model**
- D-01: `agent_joined` fires ONLY when a worker sends a `need_info` (HITL) response — not on every dispatch. Workers that complete silently never appear as chat participants.
- D-02: `agent_left` fires when the user answers the HITL question (worker got what it needed). Not on sub-task terminal state.
- D-03: Join once per sub-task, leave on resolve. If a worker sends multiple HITL requests during one sub-task, only the first triggers `agent_joined`. Subsequent `need_info` responses are additional `hitl_request` events without another join.

**Worker identity resolution**
- D-04: Worker `agent_id` comes from the poll/result payload — no guessing at dispatch time. The orchestrator doesn't know which specific kubex picks up a task (competing consumer model via Broker streams). Identity is only known when the worker responds.
- D-05: No Registry lookup at dispatch time. Capability != agent_id.

**Event payloads**
- D-06: `agent_joined` payload: `{"type": "agent_joined", "agent_id": "<from result>", "sub_task_id": "<task-id>", "capability": "<capability>"}`
- D-07: `agent_left` payload: `{"type": "agent_left", "agent_id": "<from result>", "sub_task_id": "<task-id>", "status": "resolved"}`
- D-08: No `duration_ms` field.

**HITL source_agent attribution**
- D-09: Bundled into Phase 14 — same code path.
- D-10: `hitl_request` SSE event includes `source_agent` field: `{"type": "hitl_request", "prompt": "Which account?", "source_agent": "instagram-scraper"}`
- D-11: Event lifecycle: `agent_joined` → `hitl_request(source_agent)` → user answers → `agent_left`

**Emission location**
- D-12: Both events emitted via existing `_post_progress()` on `progress:{orchestrator_task_id}`. No new endpoints.
- D-13: `agent_joined` emitted inside `_handle_poll_task()` when first `need_info` for a sub-task is detected. `agent_left` emitted when orchestrator receives and forwards user HITL answer.
- D-14: Track "already joined" state per sub_task_id to prevent duplicate `agent_joined` on repeated polls.

**Scope boundaries**
- D-15: `mcp_bridge.py` only. CLI kubexes are workers — no changes there.
- D-16: All kubexes (CLI or API) are workers. No kubex-to-kubex direct communication.

### Claude's Discretion
- Internal data structure for tracking "already joined" sub-tasks (set, dict, etc.)
- Whether to log participant events for debugging
- Error handling if `_post_progress` fails for a participant event (should not block the poll/HITL flow)

### Deferred Ideas (OUT OF SCOPE)
- CLI orchestration via harness MCP server
- A2A protocol adoption
- CLI-side participant events
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FE-BE-REQ: agent_joined | Emit `{"type": "agent_joined", "agent_id": ..., "sub_task_id": ..., "capability": ...}` on orchestrator progress channel when worker sends need_info | `_handle_poll_task` already receives the full result payload including `agent_id`; `_post_progress` is the emission path |
| FE-BE-REQ: agent_left | Emit `{"type": "agent_left", "agent_id": ..., "sub_task_id": ..., "status": "resolved"}` when user answers the HITL question and orchestrator forwards it | The HITL forwarding path must be identified and instrumented |
| FE-BE-REQ: hitl source_agent | `hitl_request` SSE event must include `source_agent` field | The current HITL forwarding in `_handle_poll_task` returns `need_info` to the LLM; source_agent must be extracted from poll result `agent_id` field |
</phase_requirements>

---

## Summary

Phase 14 is a tightly scoped addition to `mcp_bridge.py`. All three deliverables (agent_joined, agent_left, hitl source_agent) share the same trigger point: when `_handle_poll_task` detects a `need_info` status on a worker's result. The worker identity (`agent_id`) is already present in the poll response payload — it's stored by workers in the broker result as `{"status": "need_info", "agent_id": "<self>", "output": "..."}` and returned verbatim by Gateway's `GET /tasks/{id}/result` endpoint.

The emission mechanism is already built: `_post_progress(task_id, chunk)` posts to `{gateway_url}/tasks/{task_id}/progress`. Participant events need to pass JSON strings as the `chunk` field. The Gateway SSE stream already delivers arbitrary progress chunk strings to the frontend, so no gateway changes are required.

The only missing pieces are: (1) call `_post_progress` with the right structured JSON at the right moment in `_handle_poll_task`, (2) track which sub_task_ids have already been joined so duplicate events are prevented, (3) emit `agent_left` in the HITL forwarding path after the user's answer is delivered to the worker, and (4) add `source_agent` to the `hitl_request` event the orchestrator already forwards.

**Primary recommendation:** Add `_joined_sub_tasks: set[str]` to `MCPBridgeServer.__init__`, instrument `_handle_poll_task` for join/hitl events, and instrument the HITL answer-forwarding path for leave events.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx (async) | Already installed | HTTP calls to Gateway `_post_progress` | Already the HTTP client used throughout mcp_bridge.py |
| asyncio | stdlib | Async event emission | No new dependency |
| json | stdlib | Serialize structured event payloads to string | `_post_progress` takes `chunk: str` |

No new dependencies. This phase adds only logic inside an existing class.

---

## Architecture Patterns

### Existing Pattern: `_post_progress` for Structured Events

`_post_progress` already accepts a free-form `chunk: str`. Progress events with structured JSON are already emitted elsewhere (tool result logging uses `f"[tool:{tool_name}] {str(tool_result)[:500]}\n"`). For participant events, pass `json.dumps(payload)` as the chunk.

```python
# Source: agents/_base/kubex_harness/mcp_bridge.py:656
async def _post_progress(
    self, task_id: str, chunk: str, *, final: bool = False, exit_reason: str | None = None
) -> None:
    """POST progress chunk to Gateway."""
    assert self._http is not None
    payload: dict[str, Any] = {
        "task_id": task_id,
        "agent_id": self.config.agent_id,   # orchestrator's own agent_id (unchanged)
        "chunk": chunk,
        "final": final,
    }
    if exit_reason is not None:
        payload["exit_reason"] = exit_reason
    try:
        await self._http.post(f"{self.config.gateway_url}/tasks/{task_id}/progress", json=payload)
    except Exception as exc:
        logger.warning("Failed to post progress for task %s: %s", task_id, exc)
```

**Key note:** The `agent_id` field on the progress POST envelope is the orchestrator's own `agent_id` (unchanged — the Gateway uses this for audit/auth). The worker's identity goes inside `chunk` as part of the structured JSON event payload. The FE parses the SSE event's `chunk` field to extract worker identity.

### Existing Pattern: Per-Task Tracking Dict

`_delegation_depth: dict[str, int]` is the established pattern for per-sub-task tracking state. The same approach applies for "already joined" tracking.

```python
# Source: agents/_base/kubex_harness/mcp_bridge.py:81
# Delegation depth tracking (D-07): task_id -> current depth
self._delegation_depth: dict[str, int] = {}
```

### Pattern: need_info Detection in `_handle_poll_task`

When `_handle_poll_task` receives a 200 response with `status == "need_info"`, `data = resp.json()` already contains the full stored result. Workers store results via `_store_result` as:

```python
# Source: agents/_base/kubex_harness/standalone.py:563
{"status": "need_info", "agent_id": self.config.agent_id, "output": result_text}
```

So `data["agent_id"]` is the worker's `agent_id` — directly accessible, no secondary lookup needed.

Current `_handle_poll_task` need_info block (line 129–136):

```python
if result_status == "need_info":
    return {
        "status": "need_info",
        "task_id": task_id,
        "request": data.get("request", ""),
        "data": data.get("data", {}),
    }
```

This is where `agent_joined` and `hitl_request(source_agent)` must be emitted BEFORE returning. The return value goes to the LLM as a tool result — adding side-effect SSE emissions before the return is the correct hook point.

### Pattern: HITL Answer Forwarding Path (agent_left hook point)

The design doc (`docs/design-orchestrator-chat-hitl.md`) specifies that the orchestrator LLM forwards user answers to workers via `forward_hitl_response(sub_task_id, answer)`. This is a tool-use path within the orchestrator's LLM loop in `_call_llm_with_mcp_tools`. The `agent_left` event must fire after the forwarding call succeeds — meaning a new MCP tool (`kubex__forward_hitl` or similar) or an existing meta-tool handles the forward and also emits the event.

**Important:** The HITL forwarding path does NOT yet exist in `mcp_bridge.py` — the design doc describes it as "Backend Changes Required." This means Phase 14 must add the forwarding mechanism AND instrument it for `agent_left`. This is the most significant implementation gap.

### Recommended Project Structure (no changes to layout)

```
agents/_base/kubex_harness/
├── mcp_bridge.py          # All Phase 14 changes live here
└── (no new files)
tests/unit/
└── test_mcp_bridge.py     # New test class added here
```

### Anti-Patterns to Avoid

- **Emitting `agent_joined` at dispatch time (D-01 violation):** Workers in competing consumer model — orchestrator doesn't know which kubex picks up the task at dispatch. Only the poll result reveals worker identity.
- **Raising exceptions from event emission:** `_post_progress` already swallows exceptions with a warning log. Participant event calls must follow the same pattern — failure to emit SSE must not block the poll flow or HITL delivery.
- **Duplicate `agent_joined` events:** The LLM will poll repeatedly on the same `need_info` status until it acts. Without the `_joined_sub_tasks` guard (D-14), the join event fires on every poll iteration.
- **Modifying `_post_progress` signature for worker identity:** The envelope `agent_id` stays as the orchestrator's id (Gateway auth). Worker identity is embedded in the `chunk` JSON, not the envelope.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP POST to Gateway progress channel | Custom HTTP helper | `_post_progress()` (line 656) | Already handles exceptions, retries, auth headers |
| JSON serialization of event payloads | Custom serializer | `json.dumps(payload)` passed as `chunk` | `_post_progress` takes `chunk: str`; caller serializes |
| Per-task state tracking | External store/Redis | Instance dict (`set[str]` or `dict`) | Same pattern as `_delegation_depth`; task lifetime == instance lifetime |

**Key insight:** Every mechanism needed for Phase 14 already exists in the bridge. This is purely additive logic — no new infrastructure.

---

## Common Pitfalls

### Pitfall 1: HITL Forwarding Path Is Not Yet Implemented

**What goes wrong:** The design doc specifies a `forward_hitl_response` tool that the LLM calls when it decides to forward a user answer to a worker. This tool does not exist in `mcp_bridge.py` today. Without it, `agent_left` has no hook point.

**Why it happens:** The design doc is a proposal, not an implementation. Phase 14 context (D-13) says `agent_left` fires "when the orchestrator receives the user's HITL answer and forwards it" — but the forwarding mechanism itself is new work in this phase.

**How to avoid:** Plan 1 must add the HITL forwarding tool (e.g., `kubex__forward_hitl_response(sub_task_id, answer)`) AND emit `agent_left` inside it. The `agent_left` emission is only possible because this tool is added.

**Warning signs:** If the plan tries to emit `agent_left` at some other point without first adding the forwarding tool, the event will never fire or will fire at the wrong time.

### Pitfall 2: `_joined_sub_tasks` Not Cleared on Task Completion

**What goes wrong:** `_joined_sub_tasks` accumulates entries for every need_info sub-task across all orchestrator tasks. Over a long-running orchestrator with many tasks, this set grows unboundedly and prevents legitimate re-joins if a sub_task_id is ever reused.

**Why it happens:** Easy to forget cleanup when there's no explicit task lifecycle management in the bridge.

**How to avoid:** Clear the entry from `_joined_sub_tasks` either in the `agent_left` emit path (after emit, remove it — the worker is gone) or scope it to the parent task context. Removing on `agent_left` is simplest and correct: if a worker has left, the sub_task_id is terminal.

**Warning signs:** `_joined_sub_tasks` growing to hundreds of entries in long-running tests.

### Pitfall 3: `chunk` Field Must Be a String — Not a Dict

**What goes wrong:** `_post_progress` signature is `chunk: str`. Passing a `dict` directly causes a type mismatch and will likely fail at the HTTP layer.

**Why it happens:** Progress events with structured payloads are new — existing callers always pass plain text strings.

**How to avoid:** Always `json.dumps(event_dict)` before passing to `_post_progress`.

### Pitfall 4: `capability` Field on `agent_joined` Requires Dispatch-Time Tracking

**What goes wrong:** D-06 specifies `agent_joined` includes `"capability": "<capability>"`. But at the time `_handle_poll_task` fires, only the `task_id` is known — not the capability that was dispatched for it.

**Why it happens:** `_handle_poll_task` only receives `task_id`. The capability was set at dispatch time in `_handle_worker_dispatch`.

**How to avoid:** At dispatch time in `_handle_worker_dispatch`, store `capability` in a dict keyed by `task_id` (same as `_delegation_depth`). `_handle_poll_task` looks up the capability from this dict when emitting `agent_joined`. Add `self._task_capability: dict[str, str] = {}` in `__init__` and populate it in `_handle_worker_dispatch`.

### Pitfall 5: Worker `agent_id` May Be Missing from Poll Response

**What goes wrong:** Not all workers follow the output contract. Some might not include `agent_id` in their result. `data.get("agent_id")` returns `None`, and the event is emitted with `agent_id: null`.

**Why it happens:** Workers are expected to follow PREAMBLE.md output contract, but errors or malformed responses may omit the field.

**How to avoid:** Use a fallback: `agent_id = data.get("agent_id") or data.get("output", {})` — but actually, the broker result stores `agent_id` at the top level (not nested in output), so `data.get("agent_id", "unknown")` is the right call. Emit the event with `"unknown"` as fallback rather than blocking the flow.

---

## Code Examples

Verified patterns from official sources:

### Worker Result Payload Shape (need_info)

```python
# Source: agents/_base/kubex_harness/standalone.py:562
# Worker _store_result always includes agent_id at top level
payload = {
    "result": {
        "status": "need_info",           # or "completed", "failed"
        "agent_id": self.config.agent_id, # worker's own agent_id — DIRECTLY accessible
        "output": result_text,
    }
}
```

### agent_joined Emission (new code)

```python
# Emit inside _handle_poll_task when need_info detected for first time
worker_agent_id = data.get("agent_id", "unknown")
capability = self._task_capability.get(task_id, "unknown")

if task_id not in self._joined_sub_tasks:
    self._joined_sub_tasks.add(task_id)
    await self._post_progress(
        self._current_orch_task_id,
        json.dumps({
            "type": "agent_joined",
            "agent_id": worker_agent_id,
            "sub_task_id": task_id,
            "capability": capability,
        }),
    )

# Emit hitl_request with source_agent attribution (D-10)
await self._post_progress(
    self._current_orch_task_id,
    json.dumps({
        "type": "hitl_request",
        "prompt": data.get("request", ""),
        "source_agent": worker_agent_id,
    }),
)
```

### agent_left Emission (new code, inside kubex__forward_hitl_response tool)

```python
# After forwarding user answer to worker, emit agent_left
await self._post_progress(
    self._current_orch_task_id,
    json.dumps({
        "type": "agent_left",
        "agent_id": agent_id,
        "sub_task_id": sub_task_id,
        "status": "resolved",
    }),
)
# Clean up joined tracking
self._joined_sub_tasks.discard(sub_task_id)
```

### `_current_orch_task_id` Tracking

`_handle_poll_task` does not receive the parent orchestrator task ID — it only knows the sub-task ID. The bridge needs a way to associate a sub-task with its parent orchestrator task for posting to the right progress channel.

**Solution:** At dispatch time, `_handle_worker_dispatch` already receives the task_id of the sub-task. The orchestrator task_id is held in `_handle_message(msg, consumer_group)` as local variable `task_id`. Add `self._sub_task_to_parent: dict[str, str] = {}` and populate at dispatch: `self._sub_task_to_parent[sub_task_id] = current_orch_task_id`. The current orchestrator task_id must be threaded through from `_handle_message` to `_handle_worker_dispatch`.

**Alternative (simpler):** Store `self._active_task_id: str | None = None` on the bridge instance, set it when `_handle_message` starts processing a task, clear it when done. Since the bridge processes one task at a time in API mode (sequential poll loop), this is safe for v1.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FE infers worker from free-text output | Structured `agent_joined`/`agent_left` events | Phase 14 | FE can build conversation participant model with reliable identity |
| `hitl_request` has no `source_agent` | `hitl_request` includes `source_agent` | Phase 14 | FE shows which worker is asking the question |

---

## Open Questions

1. **How does `_handle_poll_task` know the parent orchestrator task ID?**
   - What we know: `_handle_poll_task(task_id)` only receives the sub-task ID. Progress must post to `progress:{orch_task_id}`.
   - What's unclear: The orchestrator task ID is not threaded into the poll tool handler.
   - Recommendation: Add `self._active_task_id: str | None = None` to MCPBridgeServer. Set it at the start of `_handle_message`, clear in finally. Since the task loop is sequential (one task processed at a time), this is race-free for v1. Document the caveat that concurrent task processing would require per-coroutine context (asyncio.contextvars).

2. **What is the existing HITL answer delivery mechanism in mcp_bridge.py?**
   - What we know: The design doc specifies `POST /tasks/{orch_task}/input` → Redis `hitl:{orch_task}` → orchestrator LLM receives answer. The LLM then decides to forward via `forward_hitl_response`.
   - What's unclear: Whether Gateway already has `POST /tasks/{id}/input` implemented, and whether the bridge has the Redis listener for `hitl:{orch_task_id}`.
   - Recommendation: Investigate in Phase planning. The `agent_left` event and HITL forwarding tool depend on this. If not implemented, Phase 14 scope must include it or Phase 14 must narrow scope to only `agent_joined` + `hitl_request(source_agent)`.

3. **Does `_handle_poll_task` need the `capability` at join time?**
   - What we know: D-06 requires `capability` in `agent_joined`. Capability is known at dispatch, not at poll.
   - Recommendation: Add `self._task_capability: dict[str, str] = {}` dict. Populate in `_handle_worker_dispatch` after successful dispatch. Clean up on terminal status (completed/failed).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio |
| Config file | `pytest.ini` (root) |
| Quick run command | `python -m pytest tests/unit/test_mcp_bridge.py -x -q` |
| Full suite command | `python -m pytest tests/ -x -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| agent_joined | Emitted once when first need_info detected for a sub-task | unit | `pytest tests/unit/test_mcp_bridge.py::TestParticipantEvents -x` | Wave 0 |
| agent_joined dedup | Second need_info poll for same sub_task does NOT emit another agent_joined | unit | `pytest tests/unit/test_mcp_bridge.py::TestParticipantEvents -x` | Wave 0 |
| agent_left | Emitted when HITL answer forwarded to worker | unit | `pytest tests/unit/test_mcp_bridge.py::TestParticipantEvents -x` | Wave 0 |
| hitl source_agent | hitl_request event includes source_agent field matching worker agent_id | unit | `pytest tests/unit/test_mcp_bridge.py::TestParticipantEvents -x` | Wave 0 |
| capability in agent_joined | agent_joined includes correct capability for the dispatched sub-task | unit | `pytest tests/unit/test_mcp_bridge.py::TestParticipantEvents -x` | Wave 0 |
| _post_progress failure | agent_joined/hitl emission failure does not block poll return value | unit | `pytest tests/unit/test_mcp_bridge.py::TestParticipantEvents -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/unit/test_mcp_bridge.py -x -q`
- **Per wave merge:** `python -m pytest tests/ -x -q`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test_mcp_bridge.py` — add `TestParticipantEvents` class (file exists, class does not)
- [ ] No new files needed — test class added to existing file

---

## Sources

### Primary (HIGH confidence)
- `agents/_base/kubex_harness/mcp_bridge.py` — full source inspection, line numbers verified
- `agents/_base/kubex_harness/standalone.py` — result storage pattern confirmed (`agent_id` at top level)
- `command-center/docs/FE-BE-REQUESTS.md` (line 884+, 925+) — canonical event shapes
- `docs/design-orchestrator-chat-hitl.md` — HITL forwarding design and data flow
- `.planning/phases/14-orchestrator-participant-events/14-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- `services/broker/broker/streams.py` — confirmed result storage schema
- `services/gateway/gateway/main.py` — confirmed `GET /tasks/{id}/result` returns stored payload verbatim
- `agents/_base/kubex_harness/PREAMBLE.md` — confirmed worker output contract includes `metadata.agent_id`

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps, all tools already in use
- Architecture: HIGH — full source inspection of all relevant methods
- Pitfalls: HIGH — identified through code reading, not speculation
- Open questions: MEDIUM — HITL delivery mechanism not fully traced (may require Phase 13 gateway work)

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable codebase, no fast-moving deps)
