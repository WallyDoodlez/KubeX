---
phase: 7
slug: agent-migration-and-dockerfile-removal
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pyproject.toml` (existing) |
| **Quick run command** | `python -m pytest tests/unit/ tests/integration/ -x -q` |
| **Full suite command** | `python -m pytest tests/ -q` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/unit/ tests/integration/ -x -q`
- **After every plan wave:** Run `python -m pytest tests/ -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | MIGR-01 | e2e | `pytest tests/e2e/test_agent_migration.py::TestOrchestratorBootsFromBase -x` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | MIGR-02 | e2e | `pytest tests/e2e/test_agent_migration.py::TestInstagramScraperBootsFromBase -x` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | MIGR-03 | e2e | `pytest tests/e2e/test_agent_migration.py::TestKnowledgeAgentBootsFromBase -x` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | MIGR-04 | unit | `pytest tests/unit/test_no_agent_dockerfiles.py -x` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | MIGR-01 | e2e | `pytest tests/e2e/test_agent_migration.py::TestOrchestratorBootsFromBase -x` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | MIGR-02 | e2e | `pytest tests/e2e/test_agent_migration.py::TestInstagramScraperBootsFromBase -x` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 2 | MIGR-03 | e2e | `pytest tests/e2e/test_agent_migration.py::TestKnowledgeAgentBootsFromBase -x` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 2 | MIGR-04 | unit | `pytest tests/unit/test_no_agent_dockerfiles.py -x` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 3 | MIGR-05 | full suite | `python -m pytest tests/ -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/test_agent_migration.py` — stubs for MIGR-01, MIGR-02, MIGR-03 (Docker-based E2E, skip if no daemon)
- [ ] `tests/unit/test_no_agent_dockerfiles.py` — stubs for MIGR-04 (filesystem assertion)
- [ ] `tests/e2e/test_hello_world_spawn.py` — covers hello-world stem cell promise E2E

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator spawns new role with skill file + config.yaml only | MIGR-05 | Requires Docker daemon + interactive verification | 1. Create `skills/examples/hello-world/SKILL.md` 2. Create `agents/hello-world/config.yaml` 3. Run spawn via Manager API 4. Verify container starts and responds |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
