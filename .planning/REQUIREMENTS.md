# Requirements: KubexClaw v1.1 — Stem Cell Kubex Refactor

**Defined:** 2026-03-12
**Core Value:** Any Kubex can become any agent — new capabilities are skill files, not Docker builds.

## v1 Requirements

### Base Image

- [x] **BASE-01**: Single `kubexclaw-base` Docker image used by all agents (orchestrator, workers, any future agent)
- [x] **BASE-02**: Container reads config at boot and self-configures (skills, tools, model, dependencies)
- [x] **BASE-03**: Container downloads all config-specified dependencies at boot (pip packages, CLI tools like OpenClaw)
- [x] **BASE-04**: Harness loads tools from config (orchestrator tools, worker tools — same harness, different config)

### Skill System

- [x] **SKIL-01**: `skill.yaml` manifest schema defining capabilities, resources, and dependencies per skill
- [x] **SKIL-02**: Skills mounted into containers via Docker bind mounts at spawn
- [x] **SKIL-03**: Skill composition — multiple skills per agent, resolved by SkillResolver
- [x] **SKIL-04**: Skill content validation before injection into LLM prompt (prompt injection defense)

### Kubex Manager

- [x] **KMGR-01**: SkillResolver maps agent config to skill file set + dependency list
- [x] **KMGR-02**: ConfigBuilder assembles full container create params from agent config
- [x] **KMGR-03**: Dynamic bind-mount injection in `create_kubex()` for skills and config
- [x] **KMGR-04**: Redis-backed state persistence (Manager survives restarts without orphaning agents)
- [x] **KMGR-05**: Dynamic Docker network name resolution from labels

### Policy & Security

- [x] **PSEC-01**: Boot-time dependencies from config are trusted (no policy gate during initial setup)
- [x] **PSEC-02**: Runtime dependency requests (post-boot) go through approve/deny/ESCALATE pipeline
- [x] **PSEC-03**: `POST /policy/skill-check` Gateway endpoint for skill assignment validation

### Migration

- [ ] **MIGR-01**: Orchestrator agent migrated to `kubexclaw-base`
- [ ] **MIGR-02**: Instagram-scraper agent migrated to `kubexclaw-base`
- [ ] **MIGR-03**: Knowledge agent migrated to `kubexclaw-base`
- [ ] **MIGR-04**: Per-agent Dockerfiles removed after migration proven
- [ ] **MIGR-05**: All 703+ existing tests pass against refactored agents

## v2 Requirements

### Skill System Enhancements

- **SKIL-05**: Skill versioning with backward compatibility
- **SKIL-06**: Skill scaffolding CLI (`kclaw skill create`)

### Base Image Enhancements

- **BASE-05**: Health check endpoint baked into base image
- **BASE-06**: Resource limit profiles per agent type

### Observability

- **OBSV-01**: SSE progress streaming to operator terminal
- **OBSV-02**: Agent boot telemetry (dependency install timing, config load success/failure)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Graphiti/OpenSearch live backends | Mocks sufficient for v1.1; deferred to future milestone |
| Full `kubexclaw` CLI replacement | `kclaw.py` works for current needs |
| Clarification flow (`needs_clarification`) | Not related to deployment refactor |
| New agent types or capabilities | v1.1 is refactor only, no new features |
| Hot-swap skills on running containers | Prompt injection vector; restart with new config instead |
| Internet-sourced skill files | Skills must come from trusted local catalog only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BASE-01 | Phase 5 | Complete |
| BASE-02 | Phase 5 | Complete |
| BASE-03 | Phase 5 | Complete |
| BASE-04 | Phase 5 | Complete |
| SKIL-01 | Phase 5 | Complete |
| SKIL-02 | Phase 5 | Complete |
| SKIL-03 | Phase 5 | Complete |
| SKIL-04 | Phase 5 | Complete |
| KMGR-01 | Phase 6 | Complete |
| KMGR-02 | Phase 6 | Complete |
| KMGR-03 | Phase 6 | Complete |
| KMGR-04 | Phase 6 | Complete |
| KMGR-05 | Phase 6 | Complete |
| PSEC-01 | Phase 6 | Complete |
| PSEC-02 | Phase 6 | Complete |
| PSEC-03 | Phase 6 | Complete |
| MIGR-01 | Phase 7 | Pending |
| MIGR-02 | Phase 7 | Pending |
| MIGR-03 | Phase 7 | Pending |
| MIGR-04 | Phase 7 | Pending |
| MIGR-05 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 — traceability filled after roadmap creation*
