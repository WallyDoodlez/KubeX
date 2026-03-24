---
status: partial
phase: 12-oauth-command-center-web-flow
source: [12-VERIFICATION.md]
started: 2026-03-23T00:00:00Z
updated: 2026-03-23T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end OAuth provisioning via Command Center UI
expected: Using the Command Center UI, click "Authorize Agent" for a running CLI agent, complete the OAuth flow in the browser popup, and confirm the agent transitions from `credential_wait` to `ready` state visible in the UI. The SSE stream shows `credential_wait` → `ready` state transition; the agent accepts subsequent task dispatches.
result: [pending]

### 2. Token expiry re-auth cycle
expected: Let a CLI agent's OAuth token expire in a running container, then dispatch a task to it. Observe the UI shows `credential_wait`. Re-inject credentials via the Command Center. Observe the agent resumes. One task fails with `credential_wait` transition visible in SSE (per D-09 one-failure allowance), then agent returns to `ready` after credential re-injection.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
