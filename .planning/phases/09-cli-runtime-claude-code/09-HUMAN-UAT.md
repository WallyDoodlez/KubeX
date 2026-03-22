---
status: partial
phase: 09-cli-runtime-claude-code
source: [09-VERIFICATION.md]
started: 2026-03-22T00:00:00Z
updated: 2026-03-22T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. HITL credential prompt on missing OAuth token
expected: Container transitions to CREDENTIAL_WAIT, surfaces a request_user_input HITL prompt asking user to run `docker exec ... claude auth login`
result: [pending]

### 2. Credential watcher detects auth completion
expected: After OAuth credential via docker exec, container publishes READY on `lifecycle:{agent_id}` Redis channel, begins polling broker, executes a task via `claude -p`
result: [pending]

### 3. SIGTERM propagation to PTY child
expected: PTY child receives SIGTERM, container waits up to 5 seconds, then exits cleanly with no orphaned processes
result: [pending]

### 4. Named volume persistence across container restart
expected: Restarted container with valid `~/.claude/.credentials.json` goes directly to READY without triggering HITL re-auth (token persisted via named Docker volume)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
