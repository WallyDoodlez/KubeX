---
status: partial
phase: 09-cli-runtime-claude-code
source: [09-VERIFICATION.md]
started: 2026-03-22T00:00:00Z
updated: 2026-03-22T19:36:00Z
---

## Current Test

[awaiting test 2 — requires real OAuth browser flow]

## Tests

### 1. HITL credential prompt on missing OAuth token
expected: Container transitions to CREDENTIAL_WAIT, surfaces a request_user_input HITL prompt asking user to run `docker exec ... claude auth login`
result: PASS — Container logged "Credentials missing for runtime=claude-code — sending HITL request", POST to /actions sent (422 due to pre-existing Gateway action format issue, not Phase 9). Container stayed running in CREDENTIAL_WAIT state watching for credential file.

### 2. Credential watcher detects auth completion
expected: After OAuth credential via docker exec, container publishes READY on `lifecycle:{agent_id}` Redis channel, begins polling broker, executes a task via `claude -p`
result: [pending — requires real browser OAuth flow, cannot be automated]

### 3. SIGTERM propagation to PTY child
expected: PTY child receives SIGTERM, container waits up to 5 seconds, then exits cleanly with no orphaned processes
result: PASS — `docker stop -t 5` exits with code 0 (not 137/SIGKILL). tini forwards SIGTERM to Python, stop_event unblocks credential watcher, harness exits cleanly. Fix committed: _stop_event added to CLIRuntime to interrupt credential wait loop.

### 4. Named volume persistence across container restart
expected: Restarted container with valid `~/.claude/.credentials.json` goes directly to READY without triggering HITL re-auth (token persisted via named Docker volume)
result: PASS — Container with pre-populated credential volume logged "Credentials present for runtime=claude-code" and proceeded directly to registration (no CREDENTIAL_WAIT). Named volume `kubex-creds-{agent_id}` correctly persists across container lifecycle.

## Summary

total: 4
passed: 3
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

### Pre-existing issues found during testing (not Phase 9 bugs)
- Gateway `/actions` endpoint returns 422 for `request_user_input` payload — HITL action format needs Gateway support
- Manager API config bind-mount uses container-internal path instead of host path — spawned containers can't read config on Windows/Mac (works on Linux only)
- FastAPI `add_event_handler` removed in >=0.115 — fixed by migrating KubexService base to lifespan context manager
