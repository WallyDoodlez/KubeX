---
phase: 12
slug: oauth-command-center-web-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pytest.ini` |
| **Quick run command** | `pytest tests/ -x -q --timeout=30` |
| **Full suite command** | `pytest tests/ --timeout=60` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/ -x -q --timeout=30`
- **After every plan wave:** Run `pytest tests/ --timeout=60`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | AUTH-01 | integration | `pytest tests/integration/test_lifecycle_sse.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AUTH-02 | integration | `pytest tests/integration/test_credential_injection.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AUTH-03 | unit | `pytest tests/unit/test_token_preflight.py` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/test_lifecycle_sse.py` — stubs for AUTH-01 lifecycle SSE
- [ ] `tests/integration/test_credential_injection.py` — stubs for AUTH-02 credential path fix
- [ ] `tests/unit/test_token_preflight.py` — stubs for AUTH-03 expiry preflight

*Existing pytest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE connection stays open with heartbeats | AUTH-01 | Requires real Redis pub/sub + long-lived connection | Connect EventSource, wait 30s, verify heartbeat events received |
| FE handoff doc is self-contained | AUTH-01 | Document quality is subjective | Read docs/HANDOFF-phase12-oauth-fe.md without backend source, verify all endpoints are callable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
