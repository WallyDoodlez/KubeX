---
phase: 05-base-image-and-skill-schema
plan: 01
subsystem: testing
tags: [pytest, skill-validator, skill-resolver, config-loader, tdd, red-tests, importorskip, xfail]

requires: []
provides:
  - Red test suite for all Phase 5 requirements (BASE-01..04, SKIL-01..04)
  - 46 new tests: all SKIP/XFAIL until plan 05-02 implements feature code
  - SkillValidator test contract: regex injection detection, LM detection, stamp lifecycle
  - SkillResolver test contract: schema validation, composition, namespacing, conflict detection
  - ConfigLoader test contract: YAML loading, env override, fallback, harness_mode routing
  - SKIL-02 test contract: Docker bind-mount structure for skill directories
  - E2E test contract: Docker build, dep install, skill mount, config-driven boot, validator CLI
affects:
  - 05-02-base-image-and-skill-schema (green implementation — these tests define the contract)
  - 05-03-base-image-and-skill-schema (regression verification)

tech-stack:
  added: [yaml (used in test fixtures), pytest.importorskip, pytest.mark.xfail, pytest.mark.e2e]
  patterns:
    - importorskip-guard pattern for red tests that skip when module doesn't exist
    - xfail pattern for tests on existing modules where new parameter not yet accepted
    - Docker availability detection for E2E tests (skip when daemon unavailable)
    - Session-scoped Docker fixture for image build once per test session

key-files:
  created:
    - tests/unit/test_skill_validator.py
    - tests/unit/test_skill_resolver.py
    - tests/unit/test_config_loader.py
    - tests/e2e/test_base_image_e2e.py
  modified:
    - tests/unit/test_kubex_manager_unit.py

key-decisions:
  - "importorskip at module level (not per-test) so all tests in the file skip as one unit when the module is absent"
  - "SKIL-02 (skill bind mounts) uses xfail rather than skipif because create_kubex() exists but doesn't yet accept skill_mounts"
  - "E2E tests skip on Docker daemon absence rather than xfail, to clearly distinguish environment vs implementation gaps"
  - "Pre-existing failing tests (test_create_mounts_provider_credentials_read_only, test_orchestrator_policy_deny_expected_actions, 3 others) left out of scope — confirmed pre-existing via git stash verify"

patterns-established:
  - "Red tests use importorskip guard at module top so all tests in file skip atomically"
  - "xfail used for tests on modules that exist but miss one specific parameter/feature"
  - "E2E tests marked @pytest.mark.e2e for selective exclusion from unit-only runs"
  - "MockLMClient test double pattern for LM-assisted content analysis"

requirements-completed: [BASE-01, BASE-02, BASE-03, BASE-04, SKIL-01, SKIL-02, SKIL-03, SKIL-04]

duration: 9min
completed: 2026-03-13
---

# Phase 05 Plan 01: Base Image and Skill Schema — Red Tests Summary

**46 failing (skip/xfail) tests defining the full Phase 5 contract: SkillValidator injection detection with stamps, SkillResolver manifest schema and composition, ConfigLoader YAML/env fallback, skill bind mounts, and Docker E2E for base image build and dep install**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-03-13T21:43:38Z
- **Completed:** 2026-03-13T21:52:12Z
- **Tasks:** 3 of 3
- **Files modified:** 5

## Accomplishments

- 3 new unit test files covering all 8 Phase 5 requirement IDs (BASE-01..04, SKIL-01..04)
- 1 new E2E test file for Docker-dependent requirements (BASE-01, BASE-03, SKIL-01 CLI, SKIL-02)
- 1 xfail test added to existing `test_kubex_manager_unit.py` covering SKIL-02 (skill bind mounts)
- All 46 new tests SKIP or XFAIL — zero unexpected PASS — zero new FAIL
- All pre-existing passing tests (294 unit tests) still pass — zero regressions introduced

## Task Commits

Each task was committed atomically:

1. **Task 1: Unit tests for SkillValidator, SkillResolver, ConfigLoader, skill bind mounts** - `eb964a8` (test)
2. **Task 2: E2E tests for base image, dep install, skill validator CLI** - `b6eba8d` (test)
3. **Task 3: Verification run** — no separate commit (Tasks 1 & 2 commits carry the verified state

**Plan metadata:** (see final metadata commit)

## Files Created/Modified

- `tests/unit/test_skill_validator.py` — 13 tests covering SKIL-04: regex injection detection (ignore previous, role hijacking, exfiltration), clean pass, stamp creation, stamp invalidation, LM-assisted detection, catalog validation
- `tests/unit/test_skill_resolver.py` — 14 tests covering SKIL-01/03: SkillManifest schema (new fields, rejected legacy fields), single/multi-skill resolution, tool namespacing, capability dedup, dep union, version conflict, ordering preservation, unknown skill raises
- `tests/unit/test_config_loader.py` — 10 tests covering BASE-02/04: YAML load, agent_id, skills list, env var override, env var fallback, missing config + no env, harness_mode standalone/openclaw, default mode
- `tests/e2e/test_base_image_e2e.py` — 8 tests covering BASE-01/03, SKIL-01 CLI, SKIL-02: Docker build, dep install success/fail, skill mount boot, two-skill composition, config-driven boot, validator CLI clean, validator CLI rejects injection
- `tests/unit/test_kubex_manager_unit.py` — added `TestSkillBindMounts.test_bind_mounts_skills` (XFAIL, SKIL-02)

## Decisions Made

- Used `importorskip` at module level rather than per-test `skipif` so the entire file skips atomically when the target module is absent — cleaner output, consistent with project existing patterns in `test_pipeline_e2e.py`
- SKIL-02 test in `test_kubex_manager_unit.py` uses `@pytest.mark.xfail` (not `importorskip`) because `create_kubex()` already exists but does not yet accept `skill_mounts` — xfail is semantically correct here
- E2E tests skip on Docker daemon absence (not xfail) to clearly distinguish "env not set up" from "feature not implemented"
- Pre-existing failing tests confirmed out-of-scope via `git stash` verification before and after my changes

## Deviations from Plan

None — plan executed exactly as written. All test contracts match the interface specs in the plan's `<interfaces>` block. The `importorskip` pattern for all module-level guards matches the plan's requirement exactly.

## Issues Encountered

5 pre-existing test failures were discovered during verification (`test_create_mounts_provider_credentials_read_only`, `test_orchestrator_policy_deny_expected_actions`, `test_task_result_returns_503_when_redis_unavailable` x2, `test_dispatch_task_with_workflow_id`). All confirmed pre-existing via git stash + re-run before/after. Out of scope — logged here for awareness, not fixed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 8 Phase 5 requirements have at least one test defining expected behavior
- Tests use importorskip so they will auto-activate when plan 05-02 creates the modules
- 05-02 (green implementation) can proceed immediately — implement modules to make these tests pass
- Blockers from STATE.md (skill content validation hash manifest design, skill hash location) should be resolved during 05-02 implementation

## Self-Check: PASSED

- FOUND: tests/unit/test_skill_validator.py
- FOUND: tests/unit/test_skill_resolver.py
- FOUND: tests/unit/test_config_loader.py
- FOUND: tests/e2e/test_base_image_e2e.py
- FOUND: tests/unit/test_kubex_manager_unit.py (modified)
- FOUND: .planning/phases/05-base-image-and-skill-schema/05-01-SUMMARY.md
- FOUND: eb964a8 (Task 1 commit)
- FOUND: b6eba8d (Task 2 commit)

---
*Phase: 05-base-image-and-skill-schema*
*Completed: 2026-03-13*
