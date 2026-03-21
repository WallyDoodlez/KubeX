---
phase: 08-mcp-bridge
plan: 02
subsystem: agent-harness
tags: [mcp-bridge, orchestration, worker-delegation, need-info, pub-sub]
dependency_graph:
  requires: ["08-01"]
  provides: ["MCPBridgeServer", "mcp-bridge harness mode", "need_info protocol", "delegation depth"]
  affects: ["agents/_base/kubex_harness/main.py", "agents/_base/kubex_harness/mcp_bridge.py"]
tech_stack:
  added: ["mcp[cli]>=1.26 (FastMCP)", "redis.asyncio pub/sub"]
  patterns: ["async task_id dispatch", "pub/sub tool cache invalidation", "delegation depth tracking"]
key_files:
  created:
    - agents/_base/kubex_harness/mcp_bridge.py
    - tests/unit/test_mcp_bridge.py
  modified:
    - agents/_base/kubex_harness/main.py
decisions:
  - "Extracted _handle_poll_task and _handle_worker_dispatch as testable methods (closures delegate to them) -- enables unit testing without touching MCP protocol"
  - "MagicMock (not AsyncMock) for redis pubsub fixture -- redis client.pubsub() is a synchronous call"
  - "Task 3 need_info/delegation tests written alongside Task 1 implementation -- plan explicitly designed this pattern"
metrics:
  duration_seconds: 260
  completed_date: "2026-03-21"
  tasks_completed: 3
  files_created: 2
  files_modified: 1
---

# Phase 08 Plan 02: MCPBridgeServer Core Implementation Summary

**One-liner:** MCPBridgeServer with FastMCP worker delegation tools, async task_id pattern (MCP-03), need_info protocol (D-05/D-06/D-07), Registry pub/sub tool cache invalidation (MCP-05), and main.py mcp-bridge routing.

## What Was Built

### agents/_base/kubex_harness/mcp_bridge.py (created)

`MCPBridgeServer` class replacing the custom 8-tool OpenAI function-calling loop with a standard MCP Bridge. Key behaviors:

- `FastMCP(name="kubex-bridge")` instance registered at init
- `kubex__poll_task` static tool (always available) delegates to `_handle_poll_task()`
- `_handle_poll_task()`: polls `GET /tasks/{id}/result` via Gateway, returns `pending` (404), `completed` (200), `need_info` (D-05/D-06), or `error`
- `refresh_worker_tools()`: fetches Registry `/agents`, skips self, registers one tool per capability via `_register_worker_tool()`
- `_handle_worker_dispatch()`: POSTs to Gateway `/actions` with `action="dispatch_task"`, returns `{status: dispatched, task_id: ...}` immediately (MCP-03 -- never holds open)
- Delegation depth enforcement (D-07): rejects dispatch if `delegation_depth >= max_delegation_depth` (default 3, env-configurable)
- `_delegation_depth` dict tracks `task_id -> depth` per dispatch
- `_listen_registry_changes()`: asyncio background task subscribing to `registry:agent_changed`, calls `refresh_worker_tools()` on each event (MCP-05)
- `run()`: opens httpx client, starts pub/sub task, cold-boots worker tools, then runs MCP server
- All tool handlers wrapped in `try/except Exception` -- never propagate exceptions

### agents/_base/kubex_harness/main.py (modified)

Added `elif config.harness_mode == "mcp-bridge":` branch before the `else` error clause:
- Imports `MCPBridgeServer` from `kubex_harness.mcp_bridge`
- Creates bridge, wires `bridge.stop` to SIGTERM/SIGINT signal handlers
- Calls `await bridge.run()`
- Updated docstring and error message to include `mcp-bridge` as valid option

### tests/unit/test_mcp_bridge.py (created)

27 unit tests across 7 test classes:
- `TestInit`: FastMCP named correctly, defaults, delegation dict empty, poll tool registered
- `TestRefreshWorkerTools`: one tool per agent excluding self, tool cache populated, non-200 Registry handled
- `TestWorkerDelegation`: Gateway POST used, task_id returned immediately, no result polling, dispatch_task action, exception handling, non-2xx error
- `TestPollTask`: pending (404), completed (200), exception handling, non-200/404 error
- `TestPubSubRegistryChanges`: subscribe called with correct channel, refresh called on message
- `TestNeedInfoProtocol`: need_info status surfaced with request+data fields (D-05/D-06)
- `TestDelegationDepth`: max depth rejection, below-max success, depth in Gateway payload, env var override, per-task tracking (D-07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pubsub test using AsyncMock for sync redis client**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test used `AsyncMock()` for `fake_client` but `client.pubsub()` is a synchronous call in redis-py. This caused the mock to return a coroutine instead of the fake pubsub object, breaking subscribe assertions.
- **Fix:** Changed `fake_client = AsyncMock()` to `fake_client = MagicMock()` and `fake_pubsub = AsyncMock()` to `fake_pubsub = MagicMock()` in both pubsub tests. Kept `fake_pubsub.subscribe = AsyncMock()` since subscribe itself is async.
- **Files modified:** tests/unit/test_mcp_bridge.py
- **Commit:** 368c216

## Test Results

```
87 passed in 3.16s
tests/unit/test_mcp_bridge.py: 27 passed
tests/unit/test_harness_unit.py: 41 passed
tests/unit/test_config_loader.py: 19 passed
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 368c216 | feat(08-02): create MCPBridgeServer with worker delegation and poll tools |
| Task 2 | d556b52 | feat(08-02): wire MCPBridgeServer into main.py as mcp-bridge harness mode |

## Self-Check: PASSED

- FOUND: agents/_base/kubex_harness/mcp_bridge.py
- FOUND: tests/unit/test_mcp_bridge.py
- FOUND: commit 368c216
- FOUND: commit d556b52
