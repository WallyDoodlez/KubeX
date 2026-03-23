---
phase: 10-hooks-monitoring
plan: 02
subsystem: infra
tags: [hook-config, audit-trail, redis, fastapi, docker, kubex-manager]

# Dependency graph
requires:
  - phase: 10-hooks-monitoring-00
    provides: test scaffolding stubs for hook_server and gateway audit tests
  - phase: 09-cli-runtime-claude-code
    provides: CLI_CREDENTIAL_MOUNTS, create_kubex volume pattern, CLIRuntime hook handler skeleton
provides:
  - "_generate_hook_settings() function generating tamper-proof settings.json with HTTP hooks for all 4 Claude Code event types"
  - "Read-only settings.json bind mount in create_kubex for claude-code runtime (shadows named volume for that path)"
  - "GET /tasks/{task_id}/audit endpoint on Gateway reading from Redis sorted set"
  - "3 passing unit tests for Gateway audit endpoint"
affects:
  - 10-hooks-monitoring-03
  - future CLI runtime plans referencing hook config or audit data

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "_generate_hook_settings: pure module-level function that writes settings.json before container spawn"
    - "Bind mount ordering: named credential volume then bind-mount settings.json on top (Pitfall 5 — bind shadows named volume)"
    - "Gateway audit endpoint uses redis_db0.zrange for sorted set retrieval; redis_db0 None check returns 503"

key-files:
  created: []
  modified:
    - services/kubex-manager/kubex_manager/lifecycle.py
    - services/gateway/gateway/main.py
    - tests/unit/test_gateway_audit.py

key-decisions:
  - "settings.json bind mount placed AFTER named credential volume in volumes dict to ensure Docker overlays bind mount on top of named volume for that specific file path (Pitfall 5)"
  - "Hook config mount conditional on runtime == 'claude-code' only; openai-api and other runtimes skip it (D-06)"
  - "audit endpoint returns 503 on redis_db0=None and 500 on query exception; empty list for unknown task_ids (not 404)"
  - "Malformed JSON entries in Redis sorted set are silently skipped to avoid poisoning the response"

patterns-established:
  - "Bind mounts shadow named volumes when added after them in the volumes dict — Docker SDK processes them in insertion order"
  - "Gateway endpoints check gateway.redis_db0 is None before any Redis call, return 503 immediately"

requirements-completed: [HOOK-02, HOOK-04]

# Metrics
duration: 9min
completed: 2026-03-23
---

# Phase 10 Plan 02: Manager Hook Config + Gateway Audit Endpoint Summary

**Manager generates tamper-proof settings.json with HTTP hooks for all 4 Claude Code event types and mounts it read-only; Gateway exposes GET /tasks/{task_id}/audit backed by Redis sorted set with 503 on Redis unavailability**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-23T04:23:03Z
- **Completed:** 2026-03-23T04:31:32Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `_generate_hook_settings(agent_id, output_dir)` module-level function to lifecycle.py that writes a JSON file with PostToolUse, Stop, SessionEnd, and SubagentStop hooks all pointing at `http://127.0.0.1:8099/hooks` with `type: http` and `timeout: 10`
- Modified `create_kubex` to add the settings.json file as a read-only bind mount at `/root/.claude/settings.json` (only for `runtime == "claude-code"`), placed after the named credential volume to ensure the bind mount shadows the volume at that path
- Added `GET /tasks/{task_id}/audit` endpoint to gateway/main.py that reads from the `audit:{task_id}` Redis sorted set in DB 0, returns sorted entries ascending, empty list for unknown tasks, and 503 when Redis is unavailable
- Replaced all 3 pytest.skip() stubs in test_gateway_audit.py with passing tests; full suite now passes (1136 passed, 4 skipped, 0 failed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Manager settings.json generation and read-only mount** - `f3df799` (feat)
2. **Task 2: Gateway GET /tasks/{task_id}/audit endpoint** - `635eac7` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `services/kubex-manager/kubex_manager/lifecycle.py` - Added `_generate_hook_settings` function and settings.json bind mount block in `create_kubex`
- `services/gateway/gateway/main.py` - Added `GET /tasks/{task_id}/audit` route near other task endpoints
- `tests/unit/test_gateway_audit.py` - Replaced pytest.skip() stubs with 3 real passing tests using TestClient + AsyncMock

## Decisions Made

- **Bind mount ordering:** settings.json bind mount is added after the named credential volume (`kubex-creds-{agent_id}`) in the volumes dict. Docker SDK processes entries in insertion order, so the bind mount overlays the named volume at `/root/.claude/settings.json` without replacing the rest of `/root/.claude`. This is the correct Docker behavior (Pitfall 5 from RESEARCH.md).
- **Conditional on runtime:** The settings.json mount is only added when `runtime == "claude-code"`. Other runtimes (openai-api, codex-cli, gemini-cli) do not receive this mount.
- **Empty list for unknown tasks:** The audit endpoint returns 200 with `entries: []` for task IDs that have no Redis key. This is preferable to 404 since a missing key is a normal state (task may not have used any tools yet).
- **Silent malformed entry skip:** Entries that fail JSON parsing are skipped silently to prevent one bad entry from poisoning the entire audit response.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — straightforward implementation following the plan's code snippets.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Hook config generation and audit endpoint are complete infrastructure for hooks monitoring
- Plan 03 can wire everything end-to-end and fill in remaining test stubs in test_hook_server.py
- The 4 pexpect-skipped tests are pre-existing skips (pexpect not installed on Windows dev machine), not failures

## Self-Check: PASSED

- services/kubex-manager/kubex_manager/lifecycle.py — FOUND
- services/gateway/gateway/main.py — FOUND
- tests/unit/test_gateway_audit.py — FOUND
- .planning/phases/10-hooks-monitoring/10-02-SUMMARY.md — FOUND
- Commit f3df799 — FOUND
- Commit 635eac7 — FOUND

---
*Phase: 10-hooks-monitoring*
*Completed: 2026-03-23*
