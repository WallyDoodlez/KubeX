---
phase: 10-hooks-monitoring
plan: "01"
subsystem: kubex-harness
tags: [hooks, monitoring, fastapi, redis, audit-trail, cli-runtime]
dependency_graph:
  requires: ["09-cli-runtime-claude-code"]
  provides: ["hook-server-module", "cli-runtime-audit-trail", "lifecycle-events"]
  affects: ["agents/_base/kubex_harness"]
tech_stack:
  added: []
  patterns: ["FastAPI embedded asyncio task", "Pydantic discriminated union TypeAdapter", "Redis sorted set audit trail with TTL"]
key_files:
  created:
    - agents/_base/kubex_harness/hook_server.py
  modified:
    - agents/_base/kubex_harness/cli_runtime.py
    - tests/unit/test_hook_server.py
decisions:
  - "Annotated discriminated union validated via TypeAdapter.validate_python() not model_validate() — Annotated types are not BaseModel subclasses"
  - "_execute_task refactored into outer+inner pattern to enable try/finally for _current_task_id cleanup while preserving all early-return paths"
  - "content kwarg in _post_progress call — test updated to handle both positional and keyword content arg"
metrics:
  duration_seconds: 394
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_changed: 3
---

# Phase 10 Plan 01: Hook Server and CLIRuntime Integration Summary

**One-liner:** FastAPI hook server on 127.0.0.1:8099 with discriminated Pydantic models, wired into CLIRuntime with Redis audit trail (24h TTL) and task_progress lifecycle events on Stop hooks.

## What Was Built

### hook_server.py (new module)

Four Pydantic event models for Claude Code's hook event types:
- `PostToolUseEvent` — tool_name, tool_use_id, tool_input, tool_response
- `StopEvent` — last_assistant_message, stop_hook_active
- `SubagentStopEvent` — agent_type, agent_id, last_assistant_message
- `SessionEndEvent` — reason

`HookEvent` discriminated union via `TypeAdapter` (pydantic v2 pattern for Annotated types).

`create_hook_app(cli_runtime)` — single `POST /hooks` route that:
- Parses raw JSON without schema validation first
- Validates via TypeAdapter — unknown/malformed events return 200 (logged WARNING)
- Routes to typed CLIRuntime handler methods

`start_hook_server(cli_runtime)` — asyncio.create_task(server.serve()) on 127.0.0.1:8099, returns Server instance for graceful shutdown.

### cli_runtime.py (extended)

Added to `__init__`:
- `_current_task_id: str | None` — task correlation for hook events (D-18)
- `_hook_server: Any | None` — uvicorn.Server for lifecycle management

Hook server lifecycle:
- `run()`: starts hook server after credential gate for non-openai-api runtimes
- `stop()`: sets `should_exit = True` on hook server

Task correlation:
- `_execute_task()` refactored to set `_current_task_id` before any await, clear in `finally` block
- Inner logic extracted to `_execute_task_inner()` — all existing retry/auth logic preserved

Four handler methods:
- `_on_post_tool_use`: writes Redis audit entry + structured stdout log
- `_on_stop`: calls `_post_progress` with `turn_complete: {last_message[:200]}`
- `_on_subagent_stop`: structured stdout log only (D-17)
- `_on_session_end`: structured stdout log only (D-16)

`_write_audit_entry(task_id, tool_name, success)`:
- Redis `zadd("audit:{task_id}", {json_entry: timestamp})`
- Redis `expire("audit:{task_id}", 86400)` — 24h TTL (D-12)
- Minimal entry: `{tool_name, timestamp, success}` only — no tool_input/output (D-14)
- Best-effort: try/except wraps all Redis ops, never raises

## Test Results

All 13 tests in `tests/unit/test_hook_server.py` pass:

| Class | Tests | Status |
|-------|-------|--------|
| TestHookEndpoint | 6 | PASS |
| TestHookSecurity | 1 | PASS |
| TestHookHandlers | 2 | PASS |
| TestAuditTrail | 4 | PASS |

Full unit suite: **590 passed, 4 skipped** (pexpect Windows skip — pre-existing). Zero regressions.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| RED (Task 1+2) | f21a2c5 | test(10-01): add failing tests for all hook behaviors |
| GREEN Task 1 | aaf5d76 | feat(10-01): create hook_server.py with FastAPI endpoint and Pydantic models |
| GREEN Task 2 | 1658cbf | feat(10-01): wire hook server into CLIRuntime with handlers, audit, lifecycle |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed discriminated union validation — Annotated types have no model_validate**
- **Found during:** Task 1 GREEN — TestHookSecurity failing
- **Issue:** `HookEvent.model_validate(raw)` failed because `HookEvent` is an `Annotated` type alias, not a BaseModel subclass. Unknown events were being caught as exceptions and returning 200 without routing to handlers.
- **Fix:** Used `TypeAdapter(HookEvent).validate_python(raw)` — the correct pydantic v2 API for validating Annotated discriminated unions.
- **Files modified:** `agents/_base/kubex_harness/hook_server.py`
- **Commit:** aaf5d76

**2. [Rule 2 - Pattern] Refactored _execute_task to use try/finally for task_id cleanup**
- **Found during:** Task 2 implementation
- **Issue:** The plan's pattern of "set _current_task_id, then clear at end of all return paths" is fragile with multiple early returns in the existing method. A try/finally pattern is required for correctness.
- **Fix:** Outer `_execute_task` sets `_current_task_id`, calls `_execute_task_inner`, clears in `finally`. Inner method contains all retry/auth logic unchanged.
- **Files modified:** `agents/_base/kubex_harness/cli_runtime.py`
- **Commit:** 1658cbf

**3. [Rule 1 - Test] Updated test to handle keyword content arg in _post_progress call**
- **Found during:** Task 2 GREEN — TestHookHandlers.test_stop_calls_post_progress failing
- **Issue:** Test assumed `content` was second positional arg; `_on_stop` passes it as keyword `content=f"turn_complete: ..."`.
- **Fix:** Test now checks `call_args.kwargs.get("content", "")` fallback when positional arg is absent.
- **Files modified:** `tests/unit/test_hook_server.py`
- **Commit:** 1658cbf

## Self-Check: PASSED

- `agents/_base/kubex_harness/hook_server.py` — FOUND
- `agents/_base/kubex_harness/cli_runtime.py` — FOUND
- `.planning/phases/10-hooks-monitoring/10-01-SUMMARY.md` — FOUND
- Commit f21a2c5 — FOUND
- Commit aaf5d76 — FOUND
- Commit 1658cbf — FOUND
