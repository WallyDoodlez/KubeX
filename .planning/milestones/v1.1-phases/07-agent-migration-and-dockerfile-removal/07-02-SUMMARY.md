---
phase: 07-agent-migration-and-dockerfile-removal
plan: 02
subsystem: agent-harness
tags: [migration, stem-cell, skill-directories, harness, docker-compose]
dependency_graph:
  requires: [07-01]
  provides: [MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05]
  affects: [agents/_base/kubex_harness, agents/*/config.yaml, docker-compose.yml, skills/]
tech_stack:
  added:
    - skills/orchestration/task-management/ (8 tool .py files + SKILL.md + manifest.yaml)
    - skills/security/review/ (SKILL.md + manifest.yaml)
    - skills/examples/hello-world/ (SKILL.md + manifest.yaml)
    - agents/hello-world/config.yaml
  patterns:
    - Skill manifests declare tools; StandaloneAgent loads tool definitions at runtime
    - Multi-turn tool-use loop in StandaloneAgent._call_llm_with_tools (not per-agent module)
    - config.yaml as sole source of truth — no env var overrides
    - kubexclaw-base image for all agents; skill mount distinguishes each agent role
key_files:
  created:
    - skills/orchestration/task-management/SKILL.md
    - skills/orchestration/task-management/manifest.yaml
    - skills/orchestration/task-management/tools/dispatch_task.py
    - skills/orchestration/task-management/tools/check_task_status.py
    - skills/orchestration/task-management/tools/cancel_task.py
    - skills/orchestration/task-management/tools/list_agents.py
    - skills/orchestration/task-management/tools/query_registry.py
    - skills/orchestration/task-management/tools/wait_for_result.py
    - skills/orchestration/task-management/tools/query_knowledge.py
    - skills/orchestration/task-management/tools/store_knowledge.py
    - skills/security/review/SKILL.md
    - skills/security/review/manifest.yaml
    - skills/examples/hello-world/SKILL.md
    - skills/examples/hello-world/manifest.yaml
    - agents/hello-world/config.yaml
  modified:
    - agents/_base/kubex_harness/config_loader.py
    - agents/_base/kubex_harness/standalone.py
    - agents/_base/kubex_harness/main.py
    - agents/orchestrator/config.yaml
    - agents/instagram-scraper/config.yaml
    - agents/knowledge/config.yaml
    - agents/reviewer/config.yaml
    - docker-compose.yml
    - tests/unit/test_config_loader.py
    - tests/unit/test_harness_unit.py
    - tests/unit/test_orchestrator_loop.py
    - tests/unit/test_no_agent_dockerfiles.py
    - tests/e2e/test_agent_migration.py
    - tests/e2e/test_hello_world_spawn.py
    - tests/e2e/test_reviewer_e2e.py
  deleted:
    - agents/orchestrator/Dockerfile
    - agents/instagram-scraper/Dockerfile
    - agents/knowledge/Dockerfile
    - agents/reviewer/Dockerfile
    - agents/orchestrator/orchestrator_loop.py
    - agents/orchestrator/mcp_bridge/ (entire directory)
    - agents/orchestrator/mcp-bridge/ (entire directory)
decisions:
  - "StandaloneAgent._call_llm_with_tools contains the multi-turn loop (not a separate OrchestratorAgent)"
  - "Tool definitions loaded dynamically from skill manifest.yaml at StandaloneAgent init"
  - "Tool handlers discovered dynamically by scanning skills_dir for tools/{name}.py"
  - "config.yaml is sole source of truth: no KUBEX_AGENT_ID, KUBEX_MODEL, GATEWAY_URL, BROKER_URL env reads"
  - "test_orchestrator_loop.py rewritten to test StandaloneAgent._call_llm_with_tools (not deleted OrchestratorAgent)"
  - "test_reviewer_e2e.py updated to use agent.model (flat schema) instead of agent.models.default"
metrics:
  duration_minutes: 14
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_changed: 30
---

# Phase 07 Plan 02: Agent Migration and Dockerfile Removal Summary

**One-liner:** Full stem cell migration — skill directories created, agents migrated to kubexclaw-base with flat config.yaml, StandaloneConfig deleted, multi-turn loop preserved in harness, all 4 Dockerfiles removed.

## Objective

Turn the Plan 01 red tests green by completing the full stem cell Kubex migration: create skill directories, update agent configs, simplify the harness to load config.yaml only (no env var fallback), restructure docker-compose.yml to use the base image with volume mounts, and delete per-agent Dockerfiles.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create skill directories and hello-world template | 9a63fc1 | 15 new files in skills/ and agents/hello-world/ |
| 2 | Migrate agents, remove StandaloneConfig, update Compose, delete Dockerfiles | 503193f | 28 files modified/deleted |

## What Was Built

### Task 1: Skill Directories

Three new skill directories created following the existing skill manifest format:

- **skills/orchestration/task-management/**: SKILL.md (orchestrator system prompt), manifest.yaml (8 tools declared), tools/ with 8 .py handler files extracted from the deleted orchestrator_loop.py
- **skills/security/review/**: SKILL.md (reviewer prompt from old config.yaml), manifest.yaml
- **skills/examples/hello-world/**: SKILL.md, manifest.yaml — template for new agents
- **agents/hello-world/config.yaml** — reference config for new agents

### Task 2: Agent Migration

**config_loader.py** rewritten to fail fast:
- Raises `ValueError("Required config file not found: {path}")` if file missing
- No env var reads at all (removed KUBEX_AGENT_ID, KUBEX_MODEL, KUBEX_CAPABILITIES, GATEWAY_URL, BROKER_URL overrides)
- gateway_url and broker_url read from config.yaml only (defaults in AgentConfig model)

**standalone.py** refactored:
- `StandaloneConfig` class deleted entirely (with `_require_env` helper)
- `StandaloneAgent` now accepts `AgentConfig` (from config_loader)
- `_call_llm_with_tools()`: multi-turn function-calling loop ported from deleted orchestrator_loop.py
- `_load_tool_definitions()`: reads manifest.yaml files, builds OpenAI tool schema at runtime
- `_get_tool_handler()`: dynamically imports tools/{name}.py from skill directories
- All agents use the same harness — orchestrator is no longer special

**Agent config.yaml files** migrated to flat schema:
- `model: gpt-5.2` (not `models.default: gpt-5.2`)
- `skills: ["task-management"]` (not action names like `dispatch_task`)
- `gateway_url` and `broker_url` explicit in config
- `harness_mode: standalone` explicit

**docker-compose.yml** restructured:
- New `kubexclaw-base` build service at top
- All 4 agents: `image: kubexclaw-base:latest` + volume mounts for config.yaml, policies/, and skill directory
- Removed GATEWAY_URL, BROKER_URL, KUBEX_AGENT_ID, KUBEX_CAPABILITIES env vars from agent services
- Added instagram-scraper, knowledge, reviewer services (only orchestrator was previously in Compose)

**Deleted**: 4 per-agent Dockerfiles, orchestrator_loop.py, mcp_bridge/, mcp-bridge/

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] test_harness_unit.py imported StandaloneConfig after deletion**
- **Found during:** Task 2 verification
- **Issue:** `from kubex_harness.standalone import _load_skill_files, StandaloneConfig` — ImportError after StandaloneConfig was deleted
- **Fix:** Updated import to use `StandaloneAgent` + `AgentConfig`; rewrote 3 test methods to create `StandaloneAgent(AgentConfig(...))` directly
- **Files modified:** tests/unit/test_harness_unit.py
- **Commit:** 503193f

**2. [Rule 1 - Bug] test_orchestrator_loop.py imported deleted orchestrator_loop module**
- **Found during:** Task 2 verification
- **Issue:** `from orchestrator_loop import ORCHESTRATOR_TOOLS, OrchestratorAgent, OrchestratorConfig` — ModuleNotFoundError
- **Fix:** Rewrote entire test file to test `StandaloneAgent._call_llm_with_tools` (the new location of the multi-turn loop). Tool definitions now loaded from skill manifests via `_load_tool_definitions`. Tests for `OrchestratorConfig` removed (class deleted); tests for loop behavior and error handling preserved.
- **Files modified:** tests/unit/test_orchestrator_loop.py
- **Commit:** 503193f

**3. [Rule 1 - Bug] test_config_loader.py tested old env var override behavior**
- **Found during:** Task 2 verification
- **Issue:** `TestEnvVarOverride` expected KUBEX_MODEL to override; `TestEnvVarFallback` expected env var fallback on missing config — both behaviors intentionally removed
- **Fix:** Updated `TestEnvVarOverride` to assert env vars are IGNORED; updated `TestEnvVarFallback` to assert `ValueError` is raised on missing file
- **Files modified:** tests/unit/test_config_loader.py
- **Commit:** 503193f

**4. [Rule 1 - Bug] test_reviewer_e2e.py used old config schema**
- **Found during:** Full test suite run
- **Issue:** `reviewer_config["agent"]["models"]["default"]` — KeyError after config migrated to flat `agent.model`
- **Fix:** Updated test to use `reviewer_config["agent"]["model"]` and `worker_config["agent"]["model"]`
- **Files modified:** tests/e2e/test_reviewer_e2e.py
- **Commit:** 503193f

**5. [Phase 05-03 pattern] xfail markers removed from migration tests**
- **Found during:** Task 2 — tests now pass (XPASS strict)
- **Fix:** Removed xfail from `test_no_agent_dockerfiles.py`, all MIGR test classes in `test_agent_migration.py`, `test_hello_world_spawn.py`
- **Files modified:** tests/unit/test_no_agent_dockerfiles.py, tests/e2e/test_agent_migration.py, tests/e2e/test_hello_world_spawn.py
- **Commit:** 503193f

## Test Results

```
770 passed, 64 skipped, 305 warnings
```

64 skipped = pre-existing Docker/Wave-5B condition skips (unaffected by this plan).

## Self-Check: PASSED

- skills/orchestration/task-management/manifest.yaml: EXISTS
- skills/security/review/manifest.yaml: EXISTS
- skills/examples/hello-world/manifest.yaml: EXISTS
- agents/hello-world/config.yaml: EXISTS
- 8 tool .py files in orchestration skill tools/: CONFIRMED
- config_loader fails fast on missing file: CONFIRMED
- No env var overrides in config_loader: CONFIRMED
- StandaloneConfig deleted: CONFIRMED
- docker-compose.yml has kubexclaw-base build service: CONFIRMED
- No per-agent Dockerfiles: CONFIRMED
- Commits 9a63fc1, 503193f: CONFIRMED
