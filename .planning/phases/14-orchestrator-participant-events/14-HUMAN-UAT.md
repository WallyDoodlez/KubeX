---
status: partial
phase: 14-orchestrator-participant-events
source: [14-VERIFICATION.md]
started: 2026-03-27T03:00:00Z
updated: 2026-03-27T03:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Participant List in Command Center UI
expected: Start full stack, trigger HITL scenario — participant list updates in real time: worker kubex appears when agent_joined fires, disappears after user answers
result: [pending]

### 2. Worker-Side Resumption After HITL Forward
expected: After UI sends HITL answer, worker picks up hitl_answer result from Broker and resumes processing (documented known gap — orchestrator-side delivery only verified in Phase 14)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
