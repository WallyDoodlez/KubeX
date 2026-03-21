---
phase: 5
slug: base-image-and-skill-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8.0 with pytest-asyncio >=0.24 |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` (root) |
| **Quick run command** | `pytest tests/unit/ -x -q` |
| **Full suite command** | `pytest tests/ libs/ services/ -x -q` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/unit/ -x -q`
- **After every plan wave:** Run `pytest tests/ libs/ services/ -x -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | BASE-01 | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_docker_build_succeeds -x` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | BASE-02 | unit | `pytest tests/unit/test_config_loader.py -x` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | BASE-03 | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_dep_install_on_boot -x` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | BASE-04 | unit | `pytest tests/unit/test_config_loader.py::test_routes_to_standalone_mode -x` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 1 | SKIL-01 | unit | `pytest tests/unit/test_skill_resolver.py::test_skill_manifest_schema -x` | ❌ W0 | ⬜ pending |
| 05-01-06 | 01 | 1 | SKIL-02 | unit | `pytest tests/unit/test_kubex_manager_unit.py::test_bind_mounts_skills -x` | ❌ W0 | ⬜ pending |
| 05-01-07 | 01 | 1 | SKIL-03 | unit | `pytest tests/unit/test_skill_resolver.py::test_two_skills_both_in_prompt -x` | ❌ W0 | ⬜ pending |
| 05-01-08 | 01 | 1 | SKIL-04 | unit | `pytest tests/unit/test_skill_validator.py::test_regex_detects_injection -x` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | BASE-01 | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_docker_build_succeeds -x` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | BASE-02 | unit | `pytest tests/unit/test_config_loader.py -x` | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 2 | BASE-03 | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_dep_install_failure_exits -x` | ❌ W0 | ⬜ pending |
| 05-02-04 | 02 | 2 | BASE-04 | unit | `pytest tests/unit/test_config_loader.py::test_routes_to_openclaw_mode -x` | ❌ W0 | ⬜ pending |
| 05-02-05 | 02 | 2 | SKIL-01 | e2e | `pytest tests/e2e/test_base_image_e2e.py::test_skill_validator_cli_clean_catalog -x` | ❌ W0 | ⬜ pending |
| 05-02-06 | 02 | 2 | SKIL-03 | unit | `pytest tests/unit/test_skill_resolver.py::test_tool_namespacing -x` | ❌ W0 | ⬜ pending |
| 05-02-07 | 02 | 2 | SKIL-04 | unit | `pytest tests/unit/test_skill_validator.py::test_lm_detects_injection -x` | ❌ W0 | ⬜ pending |
| 05-02-08 | 02 | 2 | SKIL-04 | unit | `pytest tests/unit/test_skill_validator.py::test_stamp_invalidated_on_change -x` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 3 | ALL | regression | `pytest tests/ libs/ services/ -x -q` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_skill_validator.py` — stubs for SKIL-04 (regex, LM mock, stamp logic)
- [ ] `tests/unit/test_skill_resolver.py` — stubs for SKIL-01, SKIL-03 (composition, namespacing, version conflict)
- [ ] `tests/unit/test_config_loader.py` — stubs for BASE-02, BASE-04 (config.yaml loading, env fallback, routing)
- [ ] `tests/e2e/test_base_image_e2e.py` — stubs for BASE-01, BASE-03, SKIL-01 CLI (Docker-dependent)

*Existing infrastructure: `tests/unit/test_harness_unit.py::TestSkillInjection` (9 tests) covers SKIL-02 loading path.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker build produces runnable image | BASE-01 | Requires Docker daemon | Run `docker build agents/_base/ -t kubexclaw-base` and verify exit 0 |
| Boot-time dep install from config.yaml | BASE-03 | Requires Docker daemon | Run container with `KUBEX_PIP_DEPS=requests` and verify `pip list` includes it |

*Note: These have automated e2e tests that run in CI with Docker. Manual verification only needed if CI unavailable.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
