---
phase: 05-base-image-and-skill-schema
plan: 02
subsystem: infra
tags: [pydantic, docker, skill-schema, injection-defense, yaml, skill-validator, skill-resolver, config-loader, base-image]

requires:
  - phase: 05-01
    provides: Red test suite for all Phase 5 requirements (BASE-01..04, SKIL-01..04) — 46 skip/xfail tests

provides:
  - Rewritten SkillManifest schema with extra=forbid (no legacy fields)
  - SkillDependencies, SkillTool, ValidationStamp Pydantic models
  - SkillValidator: regex blocklist + LM dual-layer injection defense with stamps
  - blocklist.yaml: 5 seed injection patterns (ignore-previous, disregard-system-prompt, you-are-now, jailbreak, exfiltrate-data)
  - SkillResolver: skill composition with tool namespacing and version conflict detection
  - create_kubex() extended with skill_mounts field and Docker bind-mount assembly (SKIL-02)
  - config_loader: reads config.yaml primary, env var override fallback, harness_mode routing
  - skill_loader: ordered skill loading wrapper
  - Unified main.py entry point routing to standalone or openclaw via harness_mode
  - entrypoint.sh extended with KUBEX_PIP_DEPS and KUBEX_SYSTEM_DEPS install step
  - 3 skill.yaml files migrated to new flat schema (web-scraping, knowledge-recall, task-management)
  - All 46 red tests from 05-01 now passing (green)

affects:
  - 05-03-base-image-and-skill-schema (regression verification — these are the production modules)
  - 06-manager-spawn-logic-and-policy-gates (consumes SkillResolver, SkillValidator, create_kubex skill_mounts)

tech-stack:
  added:
    - pydantic ConfigDict (extra=forbid on SkillManifest)
    - pyyaml (used by skill_resolver and config_loader)
    - hashlib sha256 (ValidationStamp content hashing)
  patterns:
    - SkillValidator dual-layer pattern: regex first (fast), LM second (subtle patterns) — stamp only on clean
    - Tool namespacing pattern: "{skill-name}.{tool-name}" keys in ComposedSkillSet.tools dict
    - env-var-override pattern: config.yaml base values + env var priority overrides (harness backward compat)
    - Skill bind-mount pattern: KUBEX_SKILLS_PATH/{skill-name} -> /app/skills/{skill-name} read-only in Docker

key-files:
  created:
    - libs/kubex-common/kubex_common/schemas/config.py (rewritten — SkillManifest, SkillTool, SkillDependencies, ValidationStamp)
    - services/kubex-manager/kubex_manager/skill_validator.py
    - services/kubex-manager/kubex_manager/skill_resolver.py
    - services/kubex-manager/kubex_manager/blocklist.yaml
    - agents/_base/kubex_harness/config_loader.py
    - agents/_base/kubex_harness/skill_loader.py
  modified:
    - services/kubex-manager/kubex_manager/lifecycle.py (CreateKubexRequest.skill_mounts, create_kubex skill bind mounts)
    - agents/_base/kubex_harness/main.py (unified entry point replacing openclaw-only routing)
    - agents/_base/entrypoint.sh (KUBEX_PIP_DEPS and KUBEX_SYSTEM_DEPS dep install step)
    - agents/_base/Dockerfile (CMD -> main.py, added mount point LABELs)
    - skills/data-collection/web-scraping/skill.yaml (migrated to flat schema)
    - skills/knowledge/recall/skill.yaml (migrated to flat schema)
    - skills/dispatch/task-management/skill.yaml (migrated to flat schema)

key-decisions:
  - "SkillValidator blocklist uses line-by-line text file (one pattern per line) not a complex YAML structure — simpler to extend"
  - "ValidationStamp only issued for clean skills — dirty skills have stamp=None making the clean/dirty distinction unambiguous in code"
  - "config_loader creates a harness-specific AgentConfig (with agent_id, model, harness_mode) rather than reusing kubex_common AgentConfig — avoids coupling the harness config to the kubex-common schema evolution"
  - "SkillResolver reads manifest.yaml first, then skill.yaml — manifest.yaml is the canonical new name, skill.yaml preserved for backward compat"
  - "skill_loader.py wraps _load_skill_files from standalone.py rather than copying it — preserves existing import paths for test backward compat"

patterns-established:
  - "ValidationStamp pattern: sha256 hash + ISO timestamp + validator_version; stamp=None means unvalidated or dirty"
  - "importorskip tests auto-activate: once module exists, skip becomes pass with no test file changes"
  - "config_loader env var override pattern: every KUBEX_* env var silently overrides the corresponding config.yaml field"

requirements-completed: [BASE-01, BASE-02, BASE-03, BASE-04, SKIL-01, SKIL-02, SKIL-03, SKIL-04]

duration: 12min
completed: 2026-03-13
---

# Phase 05 Plan 02: Base Image and Skill Schema — Green Implementation Summary

**SkillManifest rewritten with extra=forbid, SkillValidator regex+LM injection defense with stamps, SkillResolver composition with tool namespacing, config_loader YAML/env fallback, and Docker skill bind mounts via create_kubex() SKIL-02**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-13T21:55:38Z
- **Completed:** 2026-03-13T22:07:46Z
- **Tasks:** 3 of 3
- **Files modified:** 13

## Accomplishments

- All 46 red tests from plan 05-01 (SKIP/XFAIL) now PASS — including the SKIL-02 xfail which now XPASS
- SkillManifest with `extra="forbid"` rejects all legacy fields atomically; SkillTool, SkillDependencies, ValidationStamp models added
- SkillValidator: regex blocklist check + optional LM dual-layer with per-skill ValidationStamp on clean content
- SkillResolver: resolves skill manifests from disk, unions capabilities/deps, namespaces tools, detects pinned version conflicts
- config_loader: YAML primary config source with env var priority overrides, harness_mode routing for BASE-04
- create_kubex() extended with skill_mounts field; skill directories bind-mounted read-only at `/app/skills/{name}`
- entrypoint.sh installs KUBEX_PIP_DEPS and KUBEX_SYSTEM_DEPS before harness start; fails fast with clear error on failure
- Unified main.py routes to standalone or openclaw based on harness_mode from config or env var
- 3 skill.yaml files migrated to new flat schema without policy/budget/actions fields
- 525 tests passing (no new regressions introduced vs. pre-existing 8 failures)

## Task Commits

Each task was committed atomically:

1. **Task 1: SkillManifest schema rewrite, SkillValidator, SkillResolver, skill bind mounts** - `53f2a7e` (feat)
2. **Task 2: config_loader, skill_loader, unified main.py, entrypoint dep install** - `9407fdb` (feat)
3. **Task 3: Full green test suite verification** - `a711a29` (feat)

**Plan metadata:** (see final metadata commit)

## Files Created/Modified

- `libs/kubex-common/kubex_common/schemas/config.py` — Rewrote SkillManifest (extra=forbid), added SkillDependencies, SkillTool, ValidationStamp
- `services/kubex-manager/kubex_manager/skill_validator.py` — SkillValidator with regex + LM, stamp lifecycle, CLI entry point
- `services/kubex-manager/kubex_manager/skill_resolver.py` — SkillResolver: manifest loading, composition, tool namespacing, version conflict
- `services/kubex-manager/kubex_manager/blocklist.yaml` — 5 seed injection patterns (ignore-previous, disregard-system-prompt, you-are-now, jailbreak, exfiltrate-data)
- `services/kubex-manager/kubex_manager/lifecycle.py` — CreateKubexRequest.skill_mounts field, create_kubex() Docker skill bind-mount assembly
- `agents/_base/kubex_harness/config_loader.py` — load_agent_config(): config.yaml + env var priority overrides, harness_mode field
- `agents/_base/kubex_harness/skill_loader.py` — load_skills_from_config(): ordered skill loading wrapper
- `agents/_base/kubex_harness/main.py` — Unified entry point: load config, log boot summary, route to standalone or openclaw
- `agents/_base/entrypoint.sh` — Added KUBEX_PIP_DEPS and KUBEX_SYSTEM_DEPS install step before harness start
- `agents/_base/Dockerfile` — CMD updated to main.py, mount point LABELs added
- `skills/data-collection/web-scraping/skill.yaml` — Migrated: flat schema, removed policy/budget/actions, added dependencies + capabilities
- `skills/knowledge/recall/skill.yaml` — Migrated: flat schema, removed policy/actions/rate_limits
- `skills/dispatch/task-management/skill.yaml` — Migrated: flat schema, removed policy/actions

## Decisions Made

- config_loader creates a **harness-specific AgentConfig** (with `agent_id`, `model`, `harness_mode`) rather than reusing kubex_common's `AgentConfig` — the harness needs flat, boot-time-focused config, while kubex_common's model is richer (policy, budget, boundary). Decoupling avoids two-way schema coupling.
- `ValidationStamp` issued only for clean skills — dirty skills have `stamp=None`. Makes the clean/dirty distinction unambiguous in code.
- `SkillResolver` reads `manifest.yaml` first, then `skill.yaml` — `manifest.yaml` is the canonical new name; `skill.yaml` is preserved for backward compat with existing skill directories.

## Deviations from Plan

None — plan executed exactly as written. All test contracts matched the interface specs in the plan's `<interfaces>` block.

## Issues Encountered

8 pre-existing test failures remain unchanged (confirmed via git stash):
- `test_orchestrator_policy_deny_expected_actions` — orchestrator policy yaml missing execute_code in blocked list
- `test_task_result_returns_503_when_redis_unavailable` (x2) — Redis-dependent test without mock
- `test_create_mounts_provider_credentials_read_only` — credential path mock mismatch
- `test_dispatch_task_with_workflow_id` — orchestrator workflow_id field mismatch
- `test_orchestrator_execute_code_denied` and `test_expected_deny[orchestrator-execute_code-orch blocked]` — same policy issue
- `test_sliding_window_blocks_at_limit` — Redis integration test without daemon

All confirmed pre-existing via git stash verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 8 Phase 5 requirement IDs have green tests
- SkillValidator, SkillResolver, and config_loader are production-ready for Phase 6 to consume
- Phase 6 handoffs explicitly scoped out of Phase 5:
  - **LM eval result caching**: Phase 6 KMGR computes composite hash across skill manifests + policy config
  - **ESCALATE routing for injection detection**: Phase 6 wires ValidationVerdict(is_clean=False) to Gateway ESCALATE endpoint (PSEC-01/PSEC-02)
  - **Auto-add patterns to blocklist**: Phase 6 implements write-back flow (LM writes blocklist.pending.yaml, human reviews, merged entries trigger catalog re-scan)

## Self-Check: PASSED

- FOUND: libs/kubex-common/kubex_common/schemas/config.py (SkillManifest, SkillDependencies, SkillTool, ValidationStamp)
- FOUND: services/kubex-manager/kubex_manager/skill_validator.py
- FOUND: services/kubex-manager/kubex_manager/skill_resolver.py
- FOUND: services/kubex-manager/kubex_manager/blocklist.yaml
- FOUND: agents/_base/kubex_harness/config_loader.py
- FOUND: agents/_base/kubex_harness/skill_loader.py
- FOUND: 53f2a7e (Task 1 commit)
- FOUND: 9407fdb (Task 2 commit)
- FOUND: a711a29 (Task 3 commit)

---
*Phase: 05-base-image-and-skill-schema*
*Completed: 2026-03-13*
