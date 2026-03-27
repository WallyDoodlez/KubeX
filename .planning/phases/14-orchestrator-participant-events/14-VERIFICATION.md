---
phase: 14-orchestrator-participant-events
verified: 2026-03-27T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Open the Command Center chat UI and trigger a HITL scenario (orchestrator dispatches a worker that returns need_info)"
    expected: "Participant list updates in real time: worker kubex appears when need_info fires, disappears after the user answers"
    why_human: "SSE rendering and UI participant model cannot be verified from source alone — requires live browser + running stack"
  - test: "Send a HITL answer via the UI and confirm the worker resumes processing"
    expected: "Worker picks up the hitl_answer result from the Broker and continues its task (documented known gap — orchestrator-side delivery only was verified in Phase 14)"
    why_human: "Worker-side resumption depends on Broker acceptance of hitl_answer status, which is unverified programmatically. Documented as known gap in mcp_bridge.py and both SUMMARYs."
---

# Phase 14: Orchestrator Participant Events Verification Report

**Phase Goal:** Emit agent_joined / agent_left structured events from the MCP Bridge orchestrator when workers enter and exit a HITL conversation, so the Command Center can render a live participant list.
**Verified:** 2026-03-27
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When a worker returns need_info on poll, an agent_joined structured event is emitted on the orchestrator progress channel (first time only per sub_task) | VERIFIED | `mcp_bridge.py:143-157` — `if task_id not in self._joined_sub_tasks` guard calls `_post_progress` with `{"type": "agent_joined", ...}` |
| 2 | The hitl_request event forwarded to the progress channel includes source_agent matching the worker agent_id | VERIFIED | `mcp_bridge.py:159-171` — every need_info poll emits `{"type": "hitl_request", "prompt": ..., "source_agent": worker_agent_id}` |
| 3 | Repeated polls of the same need_info sub_task do NOT emit duplicate agent_joined events | VERIFIED | `_joined_sub_tasks` set checked before emission; `test_agent_joined_not_emitted_on_second_poll` passes |
| 4 | If _post_progress fails during event emission, the poll return value is NOT blocked | VERIFIED | Both emission blocks are wrapped in independent `try/except Exception` with `logger.warning`; `test_post_progress_failure_does_not_block_poll` passes |
| 5 | When the orchestrator forwards a user HITL answer to a worker, an agent_left event is emitted on the orchestrator progress channel | VERIFIED | `mcp_bridge.py:466-481` — `_handle_forward_hitl` calls `_post_progress` with `{"type": "agent_left", ..., "status": "resolved"}` |
| 6 | agent_left includes the correct worker agent_id and sub_task_id with status resolved | VERIFIED | `mcp_bridge.py:467` reads `self._sub_task_agent.get(sub_task_id, "unknown")` (populated by Plan 01); `test_agent_left_emitted_after_hitl_forward` asserts `status == "resolved"` |
| 7 | After agent_left is emitted, the sub_task_id is removed from _joined_sub_tasks (cleanup) | VERIFIED | `mcp_bridge.py:484` — `self._joined_sub_tasks.discard(sub_task_id)`; `test_agent_left_joined_sub_tasks_cleaned_up` passes |
| 8 | The LLM can call kubex__forward_hitl_response to deliver an answer to the Broker | VERIFIED | `mcp_bridge.py:436-437` — handler defined and wired; Broker POST to `/tasks/{sub_task_id}/result` with `hitl_answer` status |
| 9 | kubex__forward_hitl_response is registered as an MCP tool accessible to the LLM | VERIFIED | `mcp_bridge.py:425-437` — `_register_hitl_tools()` called from `__init__` (line 99); `test_forward_hitl_tool_registered` inspects mock call args and passes |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `agents/_base/kubex_harness/mcp_bridge.py` | Participant tracking infrastructure and event emission in `_handle_poll_task`; `_joined_sub_tasks` set; `kubex__forward_hitl_response` tool | Yes | Yes (1111 lines, all Phase 14 patterns present) | Yes | VERIFIED |
| `tests/unit/test_mcp_bridge.py` | `class TestParticipantEvents` with full coverage | Yes | Yes (25 new tests across both plans, 87 total in file) | Yes — tests call real methods on real MCPBridgeServer instances | VERIFIED |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `mcp_bridge.py:_handle_poll_task` | `mcp_bridge.py:_post_progress` | `json.dumps({"type": "agent_joined", ...})` as chunk | WIRED | Line 147-155: `_post_progress(orch_task_id, json.dumps({...agent_joined...}))` |
| `mcp_bridge.py:_handle_poll_task` | `mcp_bridge.py:_post_progress` | `json.dumps({"type": "hitl_request", ...})` as chunk | WIRED | Line 162-169: `_post_progress(orch_task_id, json.dumps({...hitl_request...}))` |
| `mcp_bridge.py:_handle_worker_dispatch` | `mcp_bridge.py:_task_capability` | Stores capability at dispatch time for poll lookup | WIRED | Line 999: `self._task_capability[task_id] = capability` |
| `mcp_bridge.py:kubex__forward_hitl_response` | `mcp_bridge.py:_post_progress` | `json.dumps({"type": "agent_left", ...})` as chunk | WIRED | Line 471-479: `_post_progress(orch_task_id, json.dumps({...agent_left...}))` |
| `mcp_bridge.py:kubex__forward_hitl_response` | `Broker POST /tasks/{sub_task_id}/result` | HTTP POST with `hitl_answer` status via `self._http.post` | WIRED | Lines 451-460: `self._http.post(f"{self.config.broker_url}/tasks/{sub_task_id}/result", json={...hitl_answer...})` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| `FE-BE-REQ: agent_joined` | 14-01-PLAN.md | Structured SSE event emitted when worker first sends need_info (participant joins HITL conversation) | SATISFIED | `agent_joined` emitted in `_handle_poll_task` on first need_info per sub-task; payload matches `{type, agent_id, sub_task_id, capability}` from FE-BE-REQUESTS.md:899 |
| `FE-BE-REQ: hitl source_agent` | 14-01-PLAN.md | `hitl_request` SSE event includes `source_agent` field identifying which worker asked the question | SATISFIED | `hitl_request` with `source_agent` emitted on every need_info poll at `mcp_bridge.py:164-168`; matches FE-BE-REQUESTS.md:931 |
| `FE-BE-REQ: agent_left` | 14-02-PLAN.md | Structured SSE event emitted when orchestrator forwards answer to worker (participant leaves HITL conversation) | SATISFIED with noted deviation | `agent_left` emitted in `_handle_forward_hitl` with `{type, agent_id, sub_task_id, status: "resolved"}`; FE-BE-REQUESTS.md:903 uses `status: "completed"` and includes `duration_ms` — CONTEXT.md decisions D-01 to D-14 supersede; documented as follow-up spec alignment item in both SUMMARYs |

**Note on spec deviation:** The implementation uses `status: "resolved"` (not `"completed"`) and omits `duration_ms` for `agent_left`. This is an intentional deviation from FE-BE-REQUESTS.md:903, authorized by CONTEXT.md locked decisions D-01 through D-14. The plans explicitly document a follow-up PR to update FE-BE-REQUESTS.md lines 884-937 to align with CONTEXT.md. This does not block the phase — it is a documentation debt item, not a code gap.

**Trigger deviation:** FE-BE-REQUESTS.md:910 specifies `agent_joined` should fire on `kubex__dispatch_task` call (at dispatch time). CONTEXT.md decision D-01 moved the trigger to first `need_info` detection (interaction-only model). This is also an intentional, authorized deviation. The implementation correctly follows CONTEXT.md D-01.

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `mcp_bridge.py:445-447` | Comment: "NOTE: Worker-side resumption is a known gap" | Info | Documented gap, not a stub. The orchestrator-side delivery path is fully implemented. Worker-side pickup is a separate concern outside Phase 14 scope. |

No stub code detected. No `TODO`/`FIXME`/placeholder comments in Phase 14 code paths. No empty handler implementations. All event emission paths are real `_post_progress` calls with real JSON payloads.

### Human Verification Required

#### 1. Live Participant List in Command Center UI

**Test:** Start the full stack, submit an orchestrator task that dispatches a worker. Trigger a HITL scenario where the worker returns `need_info`.
**Expected:** The Command Center chat UI shows a live participant list — the worker kubex appears when `agent_joined` SSE fires, disappears after the user answers and `agent_left` fires.
**Why human:** SSE rendering, UI state management, and participant list rendering cannot be verified from source inspection alone. Requires live browser and running Docker stack.

#### 2. Worker-Side Resumption After HITL Forward

**Test:** After the UI sends a HITL answer (triggering `kubex__forward_hitl_response`), confirm the worker receives the answer and continues its task to completion.
**Expected:** Worker picks up the `hitl_answer` result from the Broker and resumes processing (not stuck indefinitely).
**Why human:** Worker-side resumption depends on Broker acceptance of the custom `hitl_answer` status, which is unverified programmatically. Documented as a known gap in `mcp_bridge.py:445-447` and in both plan SUMMARYs. The Broker endpoint behavior with this status is assumed but not tested.

### Test Suite Results

```
tests/unit/test_mcp_bridge.py — 87 passed in 0.77s
Full suite — 848 passed, 4 skipped, 0 failed in 123s
```

4 skips are pre-existing pexpect-related skips in `test_cli_runtime.py` (pexpect not available on Windows). Not related to Phase 14.

### Commits Verified

| Hash | Description |
|------|-------------|
| `3d1cd6b` | feat(14-01): add participant tracking and agent_joined/hitl_request emission to MCP Bridge |
| `bc5ce67` | docs(14-01): complete participant events plan 01 |
| `946bc0c` | test(14-02): add failing tests for kubex__forward_hitl_response and agent_left emission |
| `bb281d6` | feat(14-02): add kubex__forward_hitl_response tool and agent_left emission |
| `af7656c` | feat(14-02): add tracking dict cleanup on terminal poll status |
| `c507fff` | docs(14-02): complete HITL forwarding and agent_left plan |

All 6 commits exist in git history and cover the full Plan 01 + Plan 02 TDD cycle.

### Known Gaps (Not Blockers)

1. **Worker-side resumption** — `_handle_forward_hitl` delivers the answer to the Broker via `/tasks/{sub_task_id}/result` with `status: "hitl_answer"`. Whether the Broker accepts this status and whether the worker's poll loop picks it up and resumes are unverified. Phase 14 covers orchestrator-side delivery only. Tracked as follow-up.

2. **FE-BE-REQUESTS.md spec alignment** — Lines 884-937 still show the pre-CONTEXT.md spec (`status: "completed"`, `duration_ms`, dispatch-time trigger). A follow-up PR must update the spec to match CONTEXT.md decisions D-01 through D-14. This is documentation debt, not a functional gap.

3. **CLI orchestrator participant events** — `cli_runtime.py` orchestrators (Claude Code, Gemini CLI, Codex) do not emit `agent_joined`/`agent_left`. FE-BE-REQUESTS.md:915 acknowledges this as a harder problem, deferred. Out of Phase 14 scope.

---

_Verified: 2026-03-27_
_Verifier: Claude (gsd-verifier)_
