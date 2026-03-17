# Roadmap: KubexClaw

## Milestones

- **v1.0 MVP** — Phases 1-4 (shipped 2026-03-09)
- **v1.1 Stem Cell Kubex** — Phases 5-7 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-4) — SHIPPED 2026-03-09</summary>

Phases 1-4 delivered the full KubexClaw MVP: gateway with policy engine, broker with Redis task queue, registry, kubex-manager, base agent harness, skill injection, multi-agent orchestration, reviewer escalation routing, knowledge base wiring, kill switch, and human-in-the-loop. 703+ tests passing across unit, integration, and E2E suites.

</details>

---

### v1.1 Stem Cell Kubex (In Progress)

**Milestone Goal:** Any Kubex can become any agent. One universal base image. New capabilities are skill files, not Docker builds.

#### Phase 5: Base Image and Skill Schema

**Goal**: A single `kubexclaw-base` image exists that any agent can run, and the skill file schema is finalized so downstream components have a stable contract to build against.
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: BASE-01, BASE-02, BASE-03, BASE-04, SKIL-01, SKIL-02, SKIL-03, SKIL-04
**Success Criteria** (what must be TRUE):
  1. `docker build agents/_base/` succeeds and produces a single `kubexclaw-base` image that can run any agent role.
  2. A `skill.yaml` schema exists and is validated — running `python -m kubex_manager.skill_validator skills/` exits 0 with no errors against all shipped skill files.
  3. Skill files can be bind-mounted into a container at spawn and the harness loads them into the LLM system prompt without modification to harness source.
  4. Multiple skill files compose correctly — a container with two skills mounted shows both skills' instructions in the system prompt, with the more restrictive policy winning on any conflicts.
  5. Skill content is validated before injection — a skill file containing an injection pattern (e.g., `ignore previous instructions`) is rejected at spawn time, not silently passed to the LLM.
**Plans**: 4 plans (includes gap closure)

Plans:
- [x] 05-01-PLAN.md — Write failing tests (red): SkillValidator, SkillResolver, ConfigLoader unit tests + base image E2E tests
- [x] 05-02-PLAN.md — Implement SkillManifest rewrite, SkillValidator, SkillResolver, config_loader, unified harness, entrypoint dep install (green)
- [x] 05-03-PLAN.md — Verify no regressions: full pytest suite, linting, formatting, skill validator CLI
- [x] 05-04-PLAN.md — Gap closure: wire skill_mounts through HTTP API (SKIL-02) and SkillValidator into spawn pipeline (SKIL-04)

#### Phase 6: Manager Spawn Logic and Policy Gates

**Goal**: The Kubex Manager can resolve skills for an agent, validate them through the policy engine, and assemble all container create parameters from config — as independently testable Python units, before any Docker integration.
**Depends on**: Phase 5
**Requirements**: KMGR-01, KMGR-02, KMGR-03, KMGR-04, KMGR-05, PSEC-01, PSEC-02, PSEC-03
**Success Criteria** (what must be TRUE):
  1. `SkillResolver.resolve(agent_config)` returns the correct skill file paths and merged dependency list for any agent config — verified by unit tests with no Docker dependency.
  2. `ConfigBuilder.build(skill_manifests)` assembles a valid `config.yaml` from merged skill manifests, with action union and most-restrictive-wins policy applied — verified by unit tests.
  3. `POST /policy/skill-check` on the Gateway returns approved/denied/escalated for a given skill assignment, following the same response format as existing action-gating endpoints.
  4. The Manager persists agent state to Redis and recovers it on restart — killing and restarting the kubex-manager service does not orphan running containers.
  5. The Manager resolves Docker network names from labels at startup — no hardcoded `openclaw_kubex-internal` string exists in manager source code.
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — Write failing tests (red): ConfigBuilder, SkillResolver agent-config input, network label lookup, Redis state persistence, spawn pipeline rollback, skill-check endpoint, install_dependency policy, boot-time dep trust
- [x] 06-02-PLAN.md — Implement ConfigBuilder, KubexRecordStore, extend SkillResolver, atomic spawn pipeline, POST /policy/skill-check, install_dependency flow, dynamic network label lookup, Manager API extensions (green)
- [x] 06-03-PLAN.md — Verify no regressions: full pytest suite, ruff/black on Phase 6 files, module imports, deprecated pattern removal (completed 2026-03-16)

#### Phase 7: Agent Migration and Dockerfile Removal

**Goal**: All four existing agents (orchestrator, instagram-scraper, knowledge, reviewer) run on `kubexclaw-base` with skill mounts, per-agent Dockerfiles are deleted, StandaloneConfig is removed, and the full 856+ test suite passes against the refactored stack.
**Depends on**: Phase 6
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05
**Success Criteria** (what must be TRUE):
  1. `docker-compose up` starts all services with no per-agent Dockerfiles present — orchestrator, instagram-scraper, knowledge, and reviewer agents all launch from `kubexclaw-base`.
  2. `pytest tests/` exits 0 with 856+ tests passing — no regressions from the refactor.
  3. Agent directories (`agents/orchestrator/`, `agents/instagram-scraper/`, `agents/knowledge/`, `agents/reviewer/`) contain only `config.yaml` and `policies/` — no Dockerfile present.
  4. An operator can spawn a new agent role by adding a skill file and a `config.yaml` with no Docker build step required (proven by hello-world template).
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md — Write failing E2E tests (red): all 4 agents boot from kubexclaw-base, no per-agent Dockerfiles, hello-world stem cell spawn
- [ ] 07-02-PLAN.md — Create skill directories, migrate all 4 agents to kubexclaw-base, remove StandaloneConfig, restructure docker-compose.yml, delete per-agent Dockerfiles (green)
- [ ] 07-03-PLAN.md — Test migration (conftest fixture, update tests for StandaloneConfig removal) + full regression verification (856+ tests green)

---

## Progress

**Execution Order:** 5 → 6 → 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4. MVP | v1.0 | — | Complete | 2026-03-09 |
| 5. Base Image and Skill Schema | v1.1 | 4/4 | Complete | 2026-03-14 |
| 6. Manager Spawn Logic and Policy Gates | v1.1 | 3/3 | Complete | 2026-03-16 |
| 7. Agent Migration and Dockerfile Removal | 1/3 | In Progress|  | - |
