---
phase: 14
slug: orchestrator-participant-events
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pyproject.toml` |
| **Quick run command** | `pytest tests/unit/ -x -q --timeout=10` |
| **Full suite command** | `pytest tests/ --timeout=30` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/unit/ -x -q --timeout=10`
- **After every plan wave:** Run `pytest tests/ --timeout=30`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | agent_joined/agent_left | unit | `pytest tests/unit/test_participant_events.py -x -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_participant_events.py` — stubs for agent_joined/agent_left event emission
- [ ] `tests/unit/test_mcp_bridge_events.py` — stubs for MCP Bridge progress event hooks
- [ ] Shared fixtures for mock broker/progress responses

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end event flow via Docker | agent_joined/agent_left | Requires live Docker services + Gateway SSE stream | Run `docker compose up`, dispatch task, observe SSE stream for participant events |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
