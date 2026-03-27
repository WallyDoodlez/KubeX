---
phase: 14-orchestrator-participant-events
plan: "01"
subsystem: mcp-bridge
tags: [participant-events, hitl, agent-joined, hitl-request, mcp-bridge, phase-14]
dependency_graph:
  requires: []
  provides:
    - "_joined_sub_tasks set for agent_joined dedup (D-14)"
    - "_task_capability dict for capability lookup at poll time (Pitfall 4)"
    - "_active_task_id for progress channel routing"
    - "_sub_task_agent dict for Plan 02 agent_left lookup"
  affects:
    - "agents/_base/kubex_harness/mcp_bridge.py — _handle_poll_task, _handle_worker_dispatch, _handle_message, __init__"
tech_stack:
  added: []
  patterns:
    - "TDD: failing tests first, then implementation to pass"
    - "try/except around _post_progress calls to ensure poll return is never blocked"
    - "finally block in _handle_message to clear _active_task_id even on LLM failure"
key_files:
  created: []
  modified:
    - agents/_base/kubex_harness/mcp_bridge.py
    - tests/unit/test_mcp_bridge.py
decisions:
  - "D-14: _joined_sub_tasks set used for dedup (not dict) — simplest structure that prevents duplicate agent_joined"
  - "_active_task_id set in _handle_message try block, cleared in finally — ensures cleanup even on LLM errors"
  - "_post_progress failures in need_info block are caught per-call, logged as warnings — poll return is never blocked"
metrics:
  duration_seconds: 155
  completed_date: "2026-03-27"
  tasks_completed: 1
  files_modified: 2
---

# Phase 14 Plan 01: Participant Tracking and Event Emission Summary

**One-liner:** Participant tracking infrastructure with agent_joined/hitl_request SSE emission from MCP Bridge _handle_poll_task on worker need_info detection.

## What Was Built

Added four new instance attributes to `MCPBridgeServer.__init__` for Phase 14 participant event tracking:

- `_joined_sub_tasks: set[str]` — deduplicates agent_joined emission per sub-task (D-14)
- `_task_capability: dict[str, str]` — stores capability at dispatch time for lookup at poll time (Pitfall 4)
- `_active_task_id: str | None` — orchestrator task_id threaded into poll context for progress channel routing (D-12)
- `_sub_task_agent: dict[str, str]` — maps sub_task_id to worker agent_id inside dedup guard, available for Plan 02 agent_left

Modified `_handle_worker_dispatch` to store `self._task_capability[task_id] = capability` alongside the existing `_delegation_depth` tracking.

Modified `_handle_message` with a try/finally wrapping the task body: sets `self._active_task_id = task_id` before processing, clears it to `None` in finally regardless of LLM errors.

Modified `_handle_poll_task` `need_info` block to emit two events via `_post_progress` before returning:

1. `agent_joined` (first poll only, guarded by `task_id not in self._joined_sub_tasks`): includes `agent_id`, `sub_task_id`, `capability` (D-06)
2. `hitl_request` (every poll): includes `prompt`, `source_agent` (D-10/D-11)

Both emissions are wrapped in independent try/except blocks so `_post_progress` failures are logged as warnings and never block the poll return value.

Added `TestParticipantEvents` class (14 tests) to `tests/unit/test_mcp_bridge.py`:
- agent_joined emitted on first need_info with correct payload fields
- Second poll does NOT re-emit agent_joined (dedup)
- hitl_request emitted with source_agent on first and every subsequent poll
- capability field comes from `_task_capability` dict (not guessed at poll time)
- `_post_progress` failure does not block poll return
- Missing agent_id in result falls back to "unknown"
- `_sub_task_agent` populated after first need_info (for Plan 02 lookup)
- No events emitted when `_active_task_id` is None
- `_task_capability` stored during `_handle_worker_dispatch`
- All four tracking dicts/attrs start in correct initial state

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing TestParticipantEvents tests | ccabb8e | tests/unit/test_mcp_bridge.py |
| 1 (GREEN) | Implementation + import fix | 3d1cd6b | mcp_bridge.py, test_mcp_bridge.py |

## Test Results

```
76 passed in 0.69s
```

All 14 new TestParticipantEvents tests pass. All 62 pre-existing tests pass. No regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing json import in test file**
- **Found during:** GREEN phase test run
- **Issue:** Test file used `json.loads()` to parse _post_progress call args, but `json` was not imported
- **Fix:** Added `import json` to test file imports
- **Files modified:** tests/unit/test_mcp_bridge.py
- **Commit:** 3d1cd6b (combined with implementation commit)

**2. [Rule 1 - Bug] Indentation misalignment in _handle_message refactor**
- **Found during:** Implementation — visual review of diff
- **Issue:** When wrapping _handle_message body in try/finally, the `else` branch of `if llm_error` was dedented at the `try` level instead of staying inside the `try` block
- **Fix:** Corrected indentation so `else: await self._store_result(...)` stays inside the try block
- **Files modified:** agents/_base/kubex_harness/mcp_bridge.py
- **Commit:** 3d1cd6b

## Known Stubs

None. All participant event emission is fully wired. `_active_task_id` is set and cleared by `_handle_message`. `_task_capability` is populated at dispatch. Events emit to real `_post_progress` in production.

## Self-Check: PASSED
