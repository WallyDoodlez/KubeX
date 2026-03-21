---
phase: 07-agent-migration-and-dockerfile-removal
plan: "01"
subsystem: tests
tags: [tdd, red-tests, agent-migration, stem-cell, xfail]
dependency_graph:
  requires: []
  provides: [07-02, 07-03]
  affects: [tests/e2e/test_agent_migration.py, tests/unit/test_no_agent_dockerfiles.py, tests/e2e/test_hello_world_spawn.py]
tech_stack:
  added: []
  patterns: [xfail(strict=True), importorskip, production-config-assertion]
key_files:
  created:
    - tests/e2e/test_agent_migration.py
    - tests/unit/test_no_agent_dockerfiles.py
    - tests/e2e/test_hello_world_spawn.py
  modified: []
decisions:
  - "E2E migration tests assert production config.yaml uses migrated skill directory names (task-management, web-scraping, recall), not old action names — ensures tests go red pre-migration and green post-migration"
  - "Reviewer test asserts model==o3-mini; currently xfails because harness defaults to gpt-5.2 when agent.model key absent (old models.default format)"
  - "Hello-world spawn tests require REPO template skill directory (skills/examples/hello-world/) — not tmp_path — so tests stay red until template is committed"
  - "MIGR-05 test verifies ValueError on missing config file; xfails because StandaloneConfig fallback still present"
metrics:
  duration: "6 minutes"
  completed: "2026-03-17"
  tasks_completed: 2
  files_created: 3
---

# Phase 7 Plan 01: Red Tests for Agent Migration Summary

Write failing (red) xfail tests for all Phase 7 migration requirements covering MIGR-01 through MIGR-05, reviewer migration, and the hello-world stem cell promise.

## What Was Built

Three test files establishing the TDD contract for Phase 7 migration:

**`tests/e2e/test_agent_migration.py`** — 6 E2E/unit tests:
- `TestOrchestratorBootsFromBase` (MIGR-01): asserts production orchestrator config has `skills: [task-management]` — xfails because config still uses action names
- `TestInstagramScraperBootsFromBase` (MIGR-02): asserts `skills: [web-scraping]` — xfails because config has old action-name skills
- `TestKnowledgeAgentBootsFromBase` (MIGR-03): asserts `skills: [recall]` — xfails because config has old action-name skills
- `TestReviewerBootsFromBase`: asserts `model == o3-mini` — xfails because harness reads `agent.model` (absent in current config), defaults to `gpt-5.2`
- `TestFullSuiteRegression.test_load_agent_config_raises_without_config_file` (MIGR-05): asserts `ValueError` on missing config — xfails because StandaloneConfig fallback still present

**`tests/unit/test_no_agent_dockerfiles.py`** — 1 unit test:
- `TestNoAgentDockerfiles.test_no_agent_dockerfiles` (MIGR-04): scans `agents/` subdirectories excluding `_base/`, asserts no Dockerfile found — xfails because orchestrator and reviewer Dockerfiles still exist

**`tests/e2e/test_hello_world_spawn.py`** — 2 E2E tests:
- `TestHelloWorldSpawn.test_hello_world_agent_boots`: mounts repo template skill + tmp config into kubexclaw-base, verifies boot — xfails because `skills/examples/hello-world/` doesn't exist yet
- `TestHelloWorldSpawn.test_hello_world_skill_template_exists_in_repo`: checks template skill directory is committed with SKILL.md + manifest.yaml — xfails for same reason

## Test Results

All 8 new tests: `8 xfailed` (correct red state)

Existing suite: `511 passed, 1 xfailed` (the new unit test collected here too), zero regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial E2E tests XPASS because harness already handles all config formats**

- **Found during:** Task 1 execution (first run attempt)
- **Issue:** Initial E2E tests wrote fresh config.yaml in tmp_path with the new format — these passed because the harness already works correctly, making them XPASS(strict) failures
- **Fix:** Redesigned MIGR-01/02/03 tests to mount PRODUCTION config.yaml files and assert migrated schema features (skill directory names) that don't exist yet in those files
- **Files modified:** `tests/e2e/test_agent_migration.py`
- **Commit:** 04a7a5c (overwrite before commit)

**2. [Rule 1 - Bug] Hello-world boot test XPASS because tmp_path skill creation succeeded**

- **Found during:** Task 2 execution (first run attempt)
- **Issue:** Original test created skill directory in tmp_path — Docker mounted it successfully, making the test pass
- **Fix:** Changed test to require the REPO template skill directory (`skills/examples/hello-world/`); raises AssertionError when not found, triggering proper xfail
- **Files modified:** `tests/e2e/test_hello_world_spawn.py`
- **Commit:** a445a8c (overwrite before commit)

## Commits

| Hash | Description |
|------|-------------|
| `04a7a5c` | test(07-01): add red E2E and unit tests for agent migration (MIGR-01..05) |
| `a445a8c` | test(07-01): add red E2E test for hello-world stem cell spawn (MIGR-05) |

## Self-Check: PASSED
