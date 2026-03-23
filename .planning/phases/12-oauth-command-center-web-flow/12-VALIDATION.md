---
phase: 12
slug: oauth-command-center-web-flow
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-23
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.0.2 |
| **Config file** | `pytest.ini` |
| **Quick run command** | `python -m pytest tests/unit/ -x -q --timeout=30` |
| **Full suite command** | `python -m pytest tests/ -q --ignore=tests/e2e --ignore=tests/chaos --timeout=60` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/unit/ -x -q --timeout=30`
- **After every plan wave:** Run `python -m pytest tests/ -q --ignore=tests/e2e --ignore=tests/chaos --timeout=60`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-T1 | 01 | 1 | AUTH-01 | unit | `pytest tests/unit/test_gateway_endpoints.py -k "TestLifecycleSSE" -x -v` | TDD inline (created in task) | pending |
| 12-01-T2 | 01 | 1 | AUTH-02 | unit | `pytest tests/unit/test_kubex_manager_unit.py -k "TestCredentialInjectionPaths" -x -v` | TDD inline (created in task) | pending |
| 12-01-T3 | 01 | 1 | AUTH-03 | unit | `pytest tests/unit/test_cli_runtime.py -k "credential" -x -v` | Yes (existing) | pending |
| 12-02-T1 | 02 | 2 | AUTH-01, AUTH-02 | content | `python -m pytest tests/unit/ -x -q` + doc content assertions | N/A (documentation) | pending |

*Status: pending -- green -- red -- flaky*

---

## Wave 0 Requirements

Wave 0 is satisfied by TDD-inline test creation within plan tasks:

- [x] `tests/unit/test_gateway_endpoints.py::TestLifecycleSSE` — created inline by Plan 01, Task 1 (TDD: write tests first, then implement)
- [x] `tests/unit/test_kubex_manager_unit.py::TestCredentialInjectionPaths` — created inline by Plan 01, Task 2 (TDD: write tests first, then implement)
- [x] `tests/unit/test_cli_runtime.py` — existing file, already covers AUTH-03 credential pre-flight (confirmed by Plan 01, Task 3)

No separate Wave 0 plan is needed. TDD-inline creation within `tdd="true"` tasks is the chosen approach.

---

## AUTH-03 Coverage Rationale

AUTH-03 ("pre-flight expiry check before dispatching tasks to CLI agents") is satisfied by the existing agent-side pre-flight in `_execute_task_inner` (cli_runtime.py). Per decision D-09:

- Token expiry is rare (hours between re-auth cycles)
- The re-gate loop already works: agent detects missing/expired credentials and transitions to CREDENTIAL_WAIT
- One wasted task attempt per expiry event is acceptable
- No Gateway dispatch-time check is needed (avoids new Redis state keys)

Existing tests in `test_cli_runtime.py` cover `_credentials_present`, `_wait_for_credentials`, and `_credential_gate` behaviors. Plan 01 Task 3 runs these tests to provide an explicit audit trail.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE connection stays open with heartbeats | AUTH-01 | Requires real Redis pub/sub + long-lived connection | Connect EventSource, wait 30s, verify heartbeat events received |
| FE handoff doc is self-contained | AUTH-01 | Document quality is subjective | Read docs/HANDOFF-phase12-oauth-fe.md without backend source, verify all endpoints are callable |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (TDD-inline approach)
- [x] No watch-mode flags
- [x] Feedback latency < 45s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
