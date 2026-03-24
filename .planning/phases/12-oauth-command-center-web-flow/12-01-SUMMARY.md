---
phase: 12-oauth-command-center-web-flow
plan: 01
subsystem: auth
tags: [fastapi, sse, redis, bearer-auth, oauth, credential-injection]

# Dependency graph
requires:
  - phase: 11-gemini-cli-runtime
    provides: cli_runtime.py CREDENTIAL_PATHS and _publish_state() on lifecycle:{agent_id} channel
provides:
  - Gateway GET /agents/{agent_id}/lifecycle SSE endpoint with Bearer auth (AUTH-01)
  - verify_token Bearer auth dependency in Gateway ported from Manager (D-04)
  - Corrected gemini-cli credential path in Manager (AUTH-02, D-05)
  - AUTH-03 confirmed via existing agent-side pre-flight tests (D-09)
affects: [phase-13, command-center-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSE lifecycle stream: GET /agents/{agent_id}/lifecycle subscribes to Redis DB 0 pub/sub channel lifecycle:{agent_id}"
    - "Bearer auth pattern shared: verify_token ported from Manager to Gateway using same env var KUBEX_MGMT_TOKEN"
    - "Credential path table duplicated in Manager (not imported from harness) per D-06 dependency boundary"

key-files:
  created: []
  modified:
    - services/gateway/gateway/main.py
    - services/kubex-manager/kubex_manager/main.py
    - tests/unit/test_gateway_endpoints.py
    - tests/unit/test_kubex_manager_unit.py

key-decisions:
  - "D-04 ported: verify_token Bearer auth added to Gateway using same KUBEX_MGMT_TOKEN env var as Manager"
  - "SSE lifecycle endpoint uses redis_db0 (not redis_db1) — lifecycle channel published by cli_runtime.py on DB 0"
  - "Manager cred_paths duplicated (not imported from harness) to maintain service boundary per D-06"
  - "AUTH-03 resolved by D-09: agent-side pre-flight in _execute_task_inner is sufficient; no Gateway dispatch-time check needed"

patterns-established:
  - "Pattern 1: SSE endpoint for lifecycle events follows stream_task_progress pattern with different Redis DB and no terminal event"
  - "Pattern 2: docker.from_env() is imported locally inside inject_credentials — patch docker.from_env directly, not kubex_manager.main.docker"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03]

# Metrics
duration: 4min
completed: 2026-03-24
---

# Phase 12 Plan 01: OAuth Command Center Web Flow — Gateway Lifecycle SSE + Credential Path Fix Summary

**Gateway SSE lifecycle endpoint at GET /agents/{agent_id}/lifecycle streams Redis DB 0 pub/sub events with Bearer auth, and Manager gemini-cli credential path corrected from /root/.config/gemini to /root/.gemini/oauth_creds.json**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-24T00:38:02Z
- **Completed:** 2026-03-24T00:42:00Z
- **Tasks:** 3 completed
- **Files modified:** 4

## Accomplishments

- Added Gateway `GET /agents/{agent_id}/lifecycle` SSE endpoint that streams lifecycle state transitions from Redis DB 0 pub/sub channel `lifecycle:{agent_id}` (AUTH-01)
- Ported `verify_token` Bearer auth dependency from Manager to Gateway; SSE endpoint requires valid Bearer token (401 without token)
- Fixed Manager `cred_paths` dict: gemini-cli path was `/root/.config/gemini/credentials.json`, now corrected to `/root/.gemini/oauth_creds.json` matching cli_runtime.py CREDENTIAL_PATHS (AUTH-02)
- Confirmed AUTH-03 coverage: 22 existing credential pre-flight tests in test_cli_runtime.py all pass, confirming agent-side pre-flight in `_execute_task_inner` satisfies AUTH-03 without new Gateway dispatch-time check (D-09)

## Task Commits

1. **Task 1: Gateway lifecycle SSE endpoint with Bearer auth** - `39f814f` (feat)
2. **Task 2: Fix Manager credential injection paths** - `28aab1d` (fix)
3. **Task 3: Confirm AUTH-03 coverage** - no commit (no code written, verification only)

**Plan metadata:** *(final docs commit follows)*

## Files Created/Modified

- `services/gateway/gateway/main.py` — Added `verify_token` Bearer auth, `_BEARER_SCHEME`, `_MGMT_TOKEN`; added `stream_agent_lifecycle` SSE endpoint at GET /agents/{agent_id}/lifecycle; updated imports to include Depends, HTTPException, status, HTTPBearer
- `services/kubex-manager/kubex_manager/main.py` — Fixed gemini-cli path in `cred_paths` dict from `/root/.config/gemini/credentials.json` to `/root/.gemini/oauth_creds.json`; added comment explaining D-06 boundary
- `tests/unit/test_gateway_endpoints.py` — Added `TestLifecycleSSE` class with 5 tests: no-auth 401, wrong-token 401, valid-auth 200/event-stream, Redis unavailable error event, Redis message streams as SSE data
- `tests/unit/test_kubex_manager_unit.py` — Added `TestCredentialInjectionPaths` class with 4 tests: gemini-cli correct path, claude-code correct path, codex-cli correct path, unknown runtime 422

## Decisions Made

- Patching `docker.from_env` directly (not `kubex_manager.main.docker`) in credential injection tests because `inject_credentials` imports `docker` locally inside the function body — module-level patch doesn't reach local import
- SSE stream has no terminal event (client disconnect breaks the loop) — aligns with lifecycle events being a continuous feed, not a bounded response

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `@patch("kubex_manager.main.docker")` did not work for credential injection tests because `inject_credentials` uses a local `import docker` statement inside the function body. Fixed by patching `docker.from_env` directly, which intercepts the call regardless of where `docker` is imported.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gateway lifecycle SSE endpoint live; Command Center frontend can now subscribe to `GET /agents/{agent_id}/lifecycle` with Bearer token to observe state transitions
- Manager credential injection uses correct gemini-cli path; tokens written by Command Center OAuth flow will land at `/root/.gemini/oauth_creds.json` inside the container
- AUTH-01, AUTH-02, AUTH-03 all satisfied; phase 12 plan 02 (if any) can proceed

---
*Phase: 12-oauth-command-center-web-flow*
*Completed: 2026-03-24*

## Self-Check: PASSED

- FOUND: services/gateway/gateway/main.py
- FOUND: services/kubex-manager/kubex_manager/main.py
- FOUND: .planning/phases/12-oauth-command-center-web-flow/12-01-SUMMARY.md
- FOUND: commit 39f814f (Gateway SSE endpoint)
- FOUND: commit 28aab1d (Manager credential path fix)
- FOUND: def verify_token in gateway/main.py
- FOUND: def stream_agent_lifecycle in gateway/main.py
- FOUND: lifecycle:{agent_id} channel pattern in gateway/main.py
- FOUND: gateway.redis_db0 in lifecycle endpoint
- FOUND: /root/.gemini/oauth_creds.json in manager/main.py
- FOUND: class TestLifecycleSSE in test_gateway_endpoints.py
- FOUND: class TestCredentialInjectionPaths in test_kubex_manager_unit.py
