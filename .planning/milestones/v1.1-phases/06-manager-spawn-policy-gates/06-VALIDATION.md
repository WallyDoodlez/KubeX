---
phase: 6
slug: manager-spawn-policy-gates
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pyproject.toml` (root-level, existing) |
| **Quick run command** | `python -m pytest tests/unit/ -x --tb=short -q` |
| **Full suite command** | `python -m pytest tests/ --tb=short -q` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/unit/ -x --tb=short -q`
- **After every plan wave:** Run `python -m pytest tests/ --tb=short -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | KMGR-01 | unit | `python -m pytest tests/unit/test_skill_resolver.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-01-02 | 01 | 1 | KMGR-02 | unit | `python -m pytest tests/unit/test_config_builder.py -x -q` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | KMGR-03 | unit | `python -m pytest tests/unit/test_kubex_manager_unit.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-01-04 | 01 | 1 | KMGR-04 | unit+int | `python -m pytest tests/unit/test_kubex_manager_unit.py tests/integration/test_redis_integration.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-01-05 | 01 | 1 | KMGR-05 | unit | `python -m pytest tests/unit/test_kubex_manager_unit.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-01-06 | 01 | 1 | PSEC-01 | unit | `python -m pytest tests/unit/test_harness_unit.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-01-07 | 01 | 1 | PSEC-02 | unit+int | `python -m pytest tests/unit/test_gateway_policy.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-01-08 | 01 | 1 | PSEC-03 | unit | `python -m pytest tests/unit/test_gateway_endpoints.py -x -q` | ✅ (extend) | ⬜ pending |
| 06-02-* | 02 | 2 | ALL | impl | `python -m pytest tests/unit/ -x --tb=short -q` | — | ⬜ pending |
| 06-03-01 | 03 | 3 | ALL | regression | `python -m pytest tests/ --tb=short -q` | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_config_builder.py` — stubs for KMGR-02 (ConfigBuilder unit tests)

*All other test files exist and need extension, not creation from scratch.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
