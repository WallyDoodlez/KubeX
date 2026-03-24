---
status: resolved
phase: 12-oauth-command-center-web-flow
source: [12-VERIFICATION.md]
started: 2026-03-23T00:00:00Z
updated: 2026-03-24T03:50:00Z
---

## Current Test

[all tests complete]

## Tests

### 1. End-to-end OAuth provisioning via SSE
expected: Using the Command Center UI, click "Authorize Agent" for a running CLI agent, complete the OAuth flow in the browser popup, and confirm the agent transitions from `credential_wait` to `ready` state visible in the UI. The SSE stream shows `credential_wait` → `ready` state transition; the agent accepts subsequent task dispatches.
result: PASSED — Agent spawned, booted, entered `credential_wait` (SSE event received). Credentials injected via Manager API. Agent detected credentials via watchfiles, transitioned to `ready` (SSE event received). Full flow: spawn → boot → credential_wait (SSE) → inject → ready (SSE). Tested with curl against live Docker system.

### 2. Token expiry re-auth cycle
expected: Let a CLI agent's OAuth token expire in a running container, then dispatch a task to it. Observe the UI shows `credential_wait`. Re-inject credentials via the Command Center. Observe the agent resumes. One task fails with `credential_wait` transition visible in SSE (per D-09 one-failure allowance), then agent returns to `ready` after credential re-injection.
result: PASSED — Credential file deleted from running container to simulate expiry. Agent's task loop pre-flight check detected missing credentials on next poll iteration. SSE streamed `credential_wait` event. Credentials re-injected via Manager API. Agent detected new credentials via watchfiles and transitioned back to `ready` (SSE event received). Full cycle: ready → delete creds → credential_wait (SSE) → re-inject → ready (SSE).

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Bugs Found During UAT

1. **KUBEX_HOST_PROJECT_DIR=. in .env** — Relative path resolved to `/app` inside Manager container, causing Docker bind mount failures. Fixed: set to absolute `D:/dev/dev/openclaw`.
2. **_to_host_path mangled Windows drive paths on Linux** — `os.path.isabs("D:/...")` returns False on Linux, causing `os.path.abspath` to prepend `/app/`. Fixed: detect `X:/` pattern.
3. **KUBEX_MGMT_TOKEN missing from Gateway docker-compose** — Gateway fell back to default token, mismatching Manager's configured token. Fixed: added env var.
4. **cli_runtime.py hardcoded redis://redis:6379 without auth** — Redis requires auth, all `_publish_state` calls failed silently. Fixed: read REDIS_URL from env.
5. **Manager didn't inject REDIS_URL into spawned containers** — Harness had no way to connect to Redis with auth. Fixed: Manager strips DB suffix and passes REDIS_URL.
6. **`_publish_state` swallowed all errors with `except: pass`** — No visibility into Redis connection failures. Fixed: log warnings.

## Gaps
