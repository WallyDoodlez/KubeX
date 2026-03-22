---
phase: 08-mcp-bridge
plan: "04"
subsystem: infra
tags: [mcp, mcp-bridge, transport, openai-api, runtime, orchestrator, standalone, D-12, D-13]

# Dependency graph
requires:
  - phase: 08-mcp-bridge plan 03
    provides: MCPBridgeServer with vault tools, meta-tools, concurrent dispatch, poll tool

provides:
  - Runtime-based transport selection (in-memory for openai-api, stdio for CLI per D-13)
  - AgentConfig runtime field defaulting to openai-api
  - Orchestrator config switched to harness_mode mcp-bridge with runtime openai-api
  - Integration tests for pub/sub cache invalidation and long-running task dispatch
  - Parity gate MCP-06 cleared — full 917-test suite passes with mcp-bridge code path

affects: [09-cli-runtime, 10-claude-code, 11-codex, 12-command-center]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transport selection derived from config.runtime at MCPBridgeServer init — openai-api uses inmemory, any CLI runtime uses stdio (D-13)"
    - "Orchestrator harness_mode switch (standalone -> mcp-bridge) is config-only — no code changes required in standalone.py"
    - "E2E test assertions must be updated alongside config changes to reflect new architectural mode"

key-files:
  created:
    - tests/integration/test_mcp_bridge_integration.py
  modified:
    - agents/_base/kubex_harness/config_loader.py
    - agents/_base/kubex_harness/mcp_bridge.py
    - agents/_base/kubex_harness/main.py
    - agents/orchestrator/config.yaml
    - tests/unit/test_mcp_bridge.py
    - tests/unit/test_config_loader.py
    - tests/e2e/test_agent_migration.py

key-decisions:
  - "D-13 transport selection: openai-api runtime uses inmemory transport (bridge and LLM share same asyncio loop); any other runtime (claude-code, codex, gemini-cli) uses stdio transport for CLI MCP client connections"
  - "D-12 preserved: standalone.py tool loop methods (_call_llm_with_tools, _execute_tool, _get_tool_handler) kept intact — workers remain on standalone mode and use these for skill-based tool dispatch"
  - "kubexclaw-base image must be rebuilt after any kubex_harness code change — E2E tests run against the Docker image, not the source tree"
  - "MIGR-01 E2E test updated from asserting task-management skill to asserting harness_mode=mcp-bridge — test reflected old architecture, must evolve with config"

patterns-established:
  - "Config-driven harness mode: harness_mode field in config.yaml routes to MCPBridgeServer or StandaloneAgent in main.py — no code change needed to switch an agent's runtime mode"
  - "Runtime field for transport: config.runtime drives transport selection inside MCPBridgeServer — future CLI agents just set runtime: claude-code or runtime: codex in their config.yaml"

requirements-completed: [MCP-06, MCP-03]

# Metrics
duration: ~35min (continuation agent — Task 3 only)
completed: 2026-03-21
---

# Phase 08 Plan 04: Parity Gate and Orchestrator Migration Summary

**Runtime-based MCP transport selection (D-13) implemented, orchestrator migrated to mcp-bridge with in-memory transport, 917-test parity gate cleared**

## Performance

- **Duration:** ~35 min (continuation — Tasks 1 and 2 previously completed)
- **Started:** 2026-03-21T (continuation from checkpoint)
- **Completed:** 2026-03-21
- **Tasks:** 3 total (Task 1: feat, Task 2: human-verify checkpoint approved, Task 3: feat)
- **Files modified:** 7

## Accomplishments

- Added `runtime` field to `AgentConfig` (defaults to `openai-api`) enabling config-driven transport selection per D-13
- `MCPBridgeServer` derives transport at `__init__`: `inmemory` for `openai-api` runtime, `stdio` for all CLI runtimes — zero hardcoding in main.py
- Integration tests created for pub/sub cache invalidation, long-running task dispatch (returns task_id within 1s), and cold-boot agent fetch
- Orchestrator `config.yaml` switched from `harness_mode: standalone` to `harness_mode: mcp-bridge` with `runtime: openai-api` — `task-management` skill removed
- `standalone.py` tool loop methods preserved intact for workers (D-12) — `_call_llm_with_tools`, `_execute_tool`, `_get_tool_handler` all remain
- Full 917-test parity gate cleared — MCP bridge fully replaces custom orchestrator tool loop

## Task Commits

1. **Task 1: Add Runtime Field and Transport Selection** - `e6c8e73` (feat)
1a. **Deviation: Fix Redis key format bug** - `1bac8a7` (fix)
2. **Task 2: Parity Verification Checkpoint** - human-approved (no commit)
3. **Task 3: Switch Orchestrator to MCP Bridge** - `cb927af` (feat)

## Files Created/Modified

- `agents/_base/kubex_harness/config_loader.py` - Added `runtime: str = "openai-api"` field to AgentConfig
- `agents/_base/kubex_harness/mcp_bridge.py` - Transport selection from config.runtime in __init__, run() uses self._transport
- `agents/_base/kubex_harness/main.py` - Removed hardcoded transport from mcp-bridge routing
- `agents/orchestrator/config.yaml` - harness_mode: mcp-bridge, runtime: openai-api, skills: []
- `tests/unit/test_mcp_bridge.py` - Added transport selection unit tests (inmemory/stdio variants)
- `tests/unit/test_config_loader.py` - Added runtime field config tests
- `tests/integration/test_mcp_bridge_integration.py` - Created: pub/sub invalidation, long-running task, cold-boot tests
- `tests/e2e/test_agent_migration.py` - Updated MIGR-01 assertion from task-management skill to mcp-bridge mode check

## Decisions Made

- Transport selection is config-driven via `config.runtime` (D-13): `openai-api` → `inmemory`, anything else → `stdio`. This means Phase 9 CLI agents only need `runtime: claude-code` in their config — no code changes to harness.
- Standalone tool loop methods preserved in `standalone.py` (D-12): The orchestrator *stops using* them (config switch), but workers still call `_call_llm_with_tools`. D-11's "delete old tool loop" is satisfied architecturally — orchestrator no longer uses it; deletion of dead code deferred until workers also migrate.
- `kubexclaw-base` image rebuilt as part of Task 3 to include runtime field in the Docker image (required for E2E tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Redis key format mismatch in broker result retrieval tests**
- **Found during:** Task 1 (TDD red phase revealed pre-existing test failure)
- **Issue:** Broker stored results under `task:result:{task_id}` (DB 0) but retrieval tests expected different key format, causing test failures
- **Fix:** Corrected key format and DB selector in test fixtures to match production broker behavior
- **Files modified:** tests/integration/ result retrieval test files
- **Verification:** All affected tests pass after fix
- **Committed in:** `1bac8a7`

**2. [Rule 1 - Outdated Test] Updated MIGR-01 E2E test assertion after config change**
- **Found during:** Task 3 (full test suite run after config switch)
- **Issue:** `test_orchestrator_boots_from_base` asserted `task-management` in skills — now empty since orchestrator migrated to mcp-bridge
- **Fix:** Updated assertion to check `harness_mode == mcp-bridge` and `runtime == openai-api` instead
- **Files modified:** `tests/e2e/test_agent_migration.py`
- **Verification:** Test passes with rebuilt Docker image
- **Committed in:** `cb927af` (part of Task 3 commit)

**3. [Rule 3 - Blocking] Rebuilt kubexclaw-base Docker image**
- **Found during:** Task 3 (E2E test ran against stale image without runtime field)
- **Issue:** `AgentConfig` had no `runtime` attribute in the Docker image — Task 1 code changes weren't in the image
- **Fix:** `docker build -t kubexclaw-base:latest -f agents/_base/Dockerfile .`
- **Verification:** Container can access `c.runtime` and returns correct value; 917 tests pass
- **Committed in:** Image rebuild (not git-committed; Docker artifact)

---

**Total deviations:** 3 auto-fixed (1 bug fix, 1 outdated test, 1 blocking image rebuild)
**Impact on plan:** All auto-fixes necessary for test correctness and infrastructure parity. No scope creep.

## Issues Encountered

- Docker image for E2E tests was stale (built before Task 1 code changes). E2E tests that inspect `AgentConfig` attributes inside the container use the installed package, not the source tree. Any change to `kubex_harness` code requires `docker build` before E2E tests can pass. This is now documented in `docker-learnings.md` (existing pattern).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 8 parity gate (MCP-06) cleared — MCP bridge is production-ready
- Orchestrator running on mcp-bridge with in-memory transport (D-13)
- Phase 9 (CLI Runtime) can proceed: CLI agents set `runtime: claude-code` or `runtime: codex` in config.yaml → MCP bridge automatically uses stdio transport
- Workers remain on standalone mode — no worker changes needed until Phase 9/10 migration

---
*Phase: 08-mcp-bridge*
*Completed: 2026-03-21*
