---
phase: 14-orchestrator-participant-events
plan: "02"
subsystem: mcp-bridge
tags: [participant-events, hitl, agent-left, forward-hitl, mcp-bridge, phase-14]
dependency_graph:
  requires:
    - "14-01: _sub_task_agent dict populated in _handle_poll_task for agent_left lookup"
    - "14-01: _joined_sub_tasks, _task_capability, _active_task_id infrastructure"
  provides:
    - "kubex__forward_hitl_response MCP tool — orchestrator delivers user HITL answers to workers"
    - "agent_left SSE event emission on HITL forward completing D-11 lifecycle"
    - "Terminal status cleanup (_joined_sub_tasks, _sub_task_agent, _task_capability, _delegation_depth cleared on completed/failed/cancelled)"
  affects:
    - "agents/_base/kubex_harness/mcp_bridge.py — _register_hitl_tools, _handle_forward_hitl, _handle_poll_task"
tech_stack:
  added: []
  patterns:
    - "TDD: failing tests first (RED), then implementation to pass (GREEN)"
    - "try/except around _post_progress in _handle_forward_hitl — agent_left failure never blocks return"
    - "discard/pop are no-ops if already cleaned — cleanup is idempotent across forward and terminal paths"
key_files:
  created: []
  modified:
    - agents/_base/kubex_harness/mcp_bridge.py
    - tests/unit/test_mcp_bridge.py
decisions:
  - "test_forward_hitl_tool_registered checks mock_instance.tool.call_args_list (not real _tool_manager) because mock_fastmcp patches FastMCP with MagicMock so tool registrations are captured as mock calls"
  - "return {'status': 'completed', **data} merges data on top — when data has status='failed', the dict's final status is 'failed' (Python dict merge semantics)"
  - "Cleanup on terminal status uses discard/pop so it is idempotent — already cleaned by HITL forward is safe"
metrics:
  duration_seconds: 333
  completed_date: "2026-03-27"
  tasks_completed: 2
  files_modified: 2
---

# Phase 14 Plan 02: HITL Forwarding and agent_left Emission Summary

**One-liner:** kubex__forward_hitl_response MCP tool with agent_left SSE emission and tracking dict cleanup on terminal poll status, completing the D-11 HITL event lifecycle.

## What Was Built

Added `_register_hitl_tools()` call in `MCPBridgeServer.__init__` (after `_register_meta_tools()`), with a new `_register_hitl_tools()` method that registers `kubex__forward_hitl_response` as an MCP tool.

Implemented `_handle_forward_hitl(sub_task_id, answer)`:
1. POSTs to Broker `/tasks/{sub_task_id}/result` with `{"result": {"status": "hitl_answer", "agent_id": orchestrator_id, "output": answer}}`
2. Reads `self._sub_task_agent.get(sub_task_id, "unknown")` for worker identity (populated by Plan 01 in `_handle_poll_task`)
3. Emits `agent_left` via `_post_progress` with `{"type": "agent_left", "agent_id": worker_agent_id, "sub_task_id": sub_task_id, "status": "resolved"}`
4. Cleans up `_joined_sub_tasks`, `_sub_task_agent`, `_task_capability` (Pitfall 2)
5. Returns `{"status": "forwarded", "sub_task_id": sub_task_id}` on success, `{"status": "error", "message": ...}` on Broker failure

Modified `_handle_poll_task` to add terminal status cleanup: when `result_status in ("completed", "failed", "cancelled")`, all four tracking dicts (`_joined_sub_tasks`, `_sub_task_agent`, `_task_capability`, `_delegation_depth`) are cleared for the task_id before returning. This handles workers that complete without ever sending `need_info`.

Added 11 new tests to `TestParticipantEvents`:
- `test_forward_hitl_tool_registered`: checks `kubex__forward_hitl_response` in mock tool call args
- `test_agent_left_emitted_after_hitl_forward`: verifies agent_left payload (type, agent_id, sub_task_id, status=resolved)
- `test_agent_left_uses_sub_task_agent_dict`: worker identity comes from `_sub_task_agent`
- `test_agent_left_joined_sub_tasks_cleaned_up`: Pitfall 2 — discard after forward
- `test_agent_left_sub_task_agent_cleaned_up`: dict cleared after forward
- `test_forward_hitl_stores_answer_via_broker`: verifies Broker POST URL and payload
- `test_forward_hitl_broker_failure_returns_error_dict`: error dict on 500, never raise
- `test_forward_hitl_post_progress_failure_does_not_block_result`: resilient to progress failure
- `test_agent_left_emitted_even_when_not_in_joined_sub_tasks`: discard is no-op when not joined
- `test_tracking_cleanup_on_completed`: all 4 dicts cleared when poll returns completed
- `test_tracking_cleanup_on_failed`: all 4 dicts cleared when poll returns failed

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing tests for forward_hitl and agent_left | 946bc0c | tests/unit/test_mcp_bridge.py |
| 1 (GREEN) | kubex__forward_hitl_response + agent_left implementation | bb281d6 | mcp_bridge.py, test_mcp_bridge.py |
| 2 | Terminal status cleanup + cleanup tests | af7656c | mcp_bridge.py, test_mcp_bridge.py |

## Test Results

```
87 passed in 0.71s  (mcp_bridge tests)
848 passed, 4 skipped in 32.78s  (full suite)
```

All 11 new Plan 02 tests pass. All 76 pre-existing tests pass. Full suite green — 0 failures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] test_forward_hitl_tool_registered needed mock call inspection, not real tool manager**
- **Found during:** GREEN phase — test failed because `mock_fastmcp` patches FastMCP with MagicMock, so `_mcp._tool_manager.list_tools()` returns an empty list (no real manager)
- **Fix:** Changed test to inspect `mock_instance.tool.call_args_list` for `name="kubex__forward_hitl_response"` — this correctly verifies the tool decorator was called during `__init__`
- **Files modified:** tests/unit/test_mcp_bridge.py
- **Commit:** bb281d6

**2. [Rule 1 - Bug] test_tracking_cleanup_on_failed had wrong status assertion**
- **Found during:** Task 2 test run — test asserted `result["status"] == "completed"` but the `return {"status": "completed", **data}` merge means data's `status: "failed"` overwrites the initial key
- **Fix:** Changed assertion to `result["status"] == "failed"` to match Python dict merge semantics
- **Files modified:** tests/unit/test_mcp_bridge.py
- **Commit:** af7656c

## Known Stubs

None. All HITL forwarding logic is fully wired. The `_handle_forward_hitl` calls real Broker endpoint. `agent_left` emits to real `_post_progress`. Known gap documented in code: worker-side resumption after receiving `hitl_answer` result is outside Phase 14 scope.

## Known Gaps (documented, not stubs)

- **Worker-side resumption**: `_handle_forward_hitl` delivers the answer to the Broker via `/tasks/{sub_task_id}/result` with `status: "hitl_answer"`. The Broker's acceptance of this custom status and the worker's ability to pick it up and resume are unverified. Phase 14 covers orchestrator-side delivery only. Tracked as follow-up.
- **FE-BE-REQUESTS.md alignment**: Lines 884-937 of FE-BE-REQUESTS.md were written before CONTEXT.md locked decisions (D-01 through D-14). The spec uses `status: "completed"` but CONTEXT.md uses `status: "resolved"` for agent_left; FE-BE-REQUESTS.md mentions `duration_ms` which was rejected. A follow-up PR must update the spec to align with CONTEXT.md decisions.

## Self-Check: PASSED
