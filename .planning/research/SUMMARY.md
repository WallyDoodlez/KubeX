# Project Research Summary

**Project:** KubexClaw v1.1 — Stem Cell Kubex Refactor
**Domain:** Dynamic container specialization for AI agent infrastructure
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

KubexClaw v1.1 is a brownfield refactor of a working AI agent pipeline (703+ tests passing) to replace per-agent Dockerfiles with a single universal base image (`kubexclaw-base`) that is specialized at spawn time via skill files and config injection. This is the "stem cell" model: one image, any agent identity, capabilities delivered by mounting skill markdown files at container creation rather than baking them into images. The stack requires no new production dependencies — the refactor uses docker-py's `put_archive()` and bind-mount mechanisms (already present in `lifecycle.py`), stdlib `tarfile`/`BytesIO`, and the existing pydantic/pyyaml toolchain. The primary deliverables are: a `SkillResolver` that maps skill names to file paths, a `ConfigBuilder` that merges skill manifests into a unified `config.yaml`, policy-gated skill assignment enforced at spawn, and migration of all three current agents off their per-agent Dockerfiles.

The recommended approach is a strict four-layer build order: first establish the skill catalog and schema (`skill.yaml`), then build the Manager's config generation and policy gating as pure Python logic, then wire skill mounts into the actual Docker spawn call, and only then delete per-agent Dockerfiles. This sequence keeps the highest-risk change (Dockerfile removal) behind validated infrastructure and uses the existing 703-test suite as the go/no-go gate. Bind mounts (not `put_archive()`) are the right mechanism for static skill injection — they are already used for credential files in `lifecycle.py`, the pattern is established, and the harness's `_load_skill_files` already handles the consumer side.

The dominant risk is the orchestrator agent, which runs a bespoke tool-use loop (`orchestrator_loop.py`) that is not the same runtime as worker agents. Treating it as "just another container with a different config.yaml" will produce a container that starts but cannot coordinate workers. The resolution is to define two harness modes in the base image (`standalone` and `tool_use`) and select at spawn time via `KUBEX_HARNESS_MODE`. Three additional critical risks require proactive design before code ships: skill file prompt injection (skills are concatenated directly into the LLM system prompt with no validation), Manager in-memory state loss on restart (currently a plain Python dict, catastrophic with dynamic spawning), and Docker network name hardcoding that breaks outside the local dev environment.

## Key Findings

### Recommended Stack

This refactor requires zero new production dependencies. The existing stack — docker-py 7.1.0, pydantic 2.x, pyyaml, httpx, redis, FastAPI — covers every requirement. The only mechanism additions are `container.put_archive()` (already in docker-py) for pre-start file injection (optional backup path) and the `volumes=` dict in `containers.create()` for bind mounts (already used in `lifecycle.py` for credentials). Stdlib `tarfile` and `BytesIO` handle in-memory tar construction without disk writes if `put_archive()` is needed. The only dev-dependency note: `pytest-asyncio` 1.3.0 requires `asyncio_mode = "auto"` in `pyproject.toml` to avoid per-test marker noise.

**Core technologies:**
- `docker` (docker-py) 7.1.0: bind-mount assembly at spawn, `put_archive()` for pre-start injection — already installed, pin to 7.x for Python 3.12 compat
- `pydantic` 2.12.5: typed `AgentSpawnConfig` and `SkillManifest` models replace the current `dict[str, Any]` — already installed, add models for new spawn contract
- `pyyaml` 6.0+: `safe_load()` for `skill.yaml` metadata — already installed, no change
- `tarfile` + `BytesIO` (stdlib): in-memory tar archives for `put_archive()` path — no install needed
- `pathlib` (stdlib): `Path.rglob("*.md")` for skill catalog discovery — no install needed

### Expected Features

All v1.1 features are P1 (required for a coherent stem cell refactor). No table-stakes feature can be deferred without collapsing the architecture's core promise.

**Must have (table stakes — v1.1):**
- Universal base image (`kubexclaw-base`) — without a single image there is no stem cell, just renamed per-agent images
- Skill file mounting at spawn — volume mounts are the identity mechanism; baked-in skills require image rebuilds
- Harness auto-load of mounted skills — already implemented in `kubex-common`; gap is Manager driving the mounts
- Skill manifest schema (`skill.yaml`) — machine-readable skill contract enables policy gating and composition
- Skill composition engine — action union, policy-most-restrictive-wins, resource stacking for multi-skill agents
- Policy-gated skill injection — boundary allowlists and global blocklists enforced before container creation
- Config-driven agent identity — `config.yaml` generated from merged skill manifests at spawn time
- Graceful shutdown with task drain — SIGTERM handler, 30s grace, `draining` health status
- Health check polling — poll `/health` every 5s, 120s timeout, already specified in `docs/kubex-manager.md`
- Remove per-agent Dockerfiles — explicit v1.1 goal; deletion gates on all 703+ tests passing against base image
- Backward compatibility — all existing E2E, integration, and unit tests must pass

**Should have (differentiators — v1.x):**
- Policy-gated runtime dependency requests — agents request `pip install` through ESCALATE path; genuinely novel vs. AWS/Azure/OpenAI platforms; defer until first real-world escalation
- Skill versioning and per-Kubex pinning — defer until skill catalog grows beyond 5 skills
- Custom skill validation at deploy time — 5-step pre-spawn validation; defer until external contributors write skills
- Skill scaffolding CLI (`kubexclaw skills create`) — defer until creation friction is measurable

**Defer (v2+):**
- SSE progress streaming — explicitly deferred in `.planning/PROJECT.md`, v1.2 scope
- Live Graphiti/OpenSearch backend — wiring live backends risks masking refactor regressions; v1.2 after refactor is stable
- Full `kubexclaw` CLI — v1.2 scope; `kclaw.py` covers current needs
- Kubernetes/Swarm deployment — deferred until scale requires it

**Anti-features (never build):**
- Per-agent Dockerfiles kept "just in case" — erodes single-image principle
- Real-time skill hot-swap on running containers — prompt injection vector, split-brain LLM behavior
- Agent self-modification of skill loadout — privilege escalation path
- Skill content fetched from the internet at spawn — supply chain attack surface

### Architecture Approach

The refactor introduces two new Python modules in `services/kubex-manager/`: `skill_resolver.py` (reads skill catalog, resolves skill names to file paths, validates against policy) and `config_builder.py` (merges capabilities and policies from all assigned skills into a `config.yaml`). These are pure computation components with no Docker dependency — they can be built and unit-tested independently. The existing `lifecycle.py` `create_kubex` method receives additions: call SkillResolver, call the Gateway policy check endpoint (`POST /policy/skill-check` — new endpoint), call ConfigBuilder, then add skill bind mounts to the `volumes` dict before `docker.containers.create()`. Agent directories shed their Dockerfiles and become config-only (`config.yaml` only). The skill catalog lives at `skills/*/` with each skill having `SKILL.md` (LLM instructions) and `skill.yaml` (metadata).

**Major components:**
1. **Kubex Manager** (`skill_resolver.py`, `config_builder.py`, updated `lifecycle.py`) — the spawn controller; resolves skills, enforces policy, generates config, assembles Docker create call
2. **Skill Catalog** (`skills/category/skill-name/SKILL.md` + `skill.yaml`) — the source of truth for agent capabilities; read by Manager at spawn, mounted read-only into containers
3. **Policy Engine** (Gateway, updated `policies/default-boundary.yaml`) — enforces boundary-level skill allowlists and global blocklists at spawn time; requires new `POST /policy/skill-check` endpoint
4. **`kubexclaw-base`** (single Dockerfile in `agents/_base/`) — universal Python 3.12-slim runtime with kubex-common and kubex-harness; supports both `standalone` and `tool_use` harness modes
5. **StandaloneAgent** (existing, in `agents/_base/kubex_harness/standalone.py`) — agent poll loop; `_load_skill_files` already handles mounted skills; `StandaloneConfig` needs to read from `/app/config.yaml`

### Critical Pitfalls

1. **Orchestrator is a different runtime, not just a different config** — `orchestrator_loop.py` is not `kubex_harness.standalone`. Define two harness modes in the base image (`KUBEX_HARNESS_MODE=standalone|tool_use`); select at spawn. Address in Phase 1 before writing any Dockerfile.

2. **Skill files are a prompt injection vector with no validation today** — `_load_skill_files()` concatenates every `.md` in `/app/skills` directly into the LLM system prompt. Mount path allowlisting, content hash verification, and injection pattern stripping must be built into the spawn mechanism — not added after. Address in Phase 2; do not ship v1.1 with unvalidated mounts.

3. **Manager in-memory state is lost on restart** — `self._kubexes` is a Python dict. With dynamic spawning, Manager restart = orphaned containers that cannot be managed. Persist to Redis; add startup reconciliation loop querying Docker for `label=kubex.managed=true`. Address in Phase 2 before dynamic spawning ships.

4. **Docker network name is environment-dependent** — `openclaw_kubex-internal` is the Compose-prefixed name that only works in the `openclaw` project directory. Resolve the network name at startup by querying Docker labels, never hardcode. Address in Phase 2; breaks CI in every non-local environment.

5. **Existing tests test per-agent image behavior, not base image + volume behavior** — mocks stub `docker.from_env()` entirely; they do not exercise real skill loading or volume semantics. Add a base image integration test suite against a real Docker daemon before any Dockerfile is removed. Address in Phase 1 alongside Dockerfile definition.

## Implications for Roadmap

Based on research, the refactor has a clear four-phase dependency structure. Each phase produces testable artifacts that gate the next.

### Phase 1: Base Image and Skill Catalog Foundation

**Rationale:** Every downstream component depends on a finalized `skill.yaml` schema and a base image that supports both harness modes. The orchestrator's distinct runtime (Pitfall 1) and the test coverage gap for base image behavior (Pitfall 7) must be resolved here — both are "impossible to retrofit" problems if discovered later.

**Delivers:** Finalized `skill.yaml` schema; `SKILL.md` files for all 3 current agents (dispatch/task-management, knowledge/recall, web-scraping); `kubexclaw-base` Dockerfile with `KUBEX_HARNESS_MODE` support; base image integration test suite that exercises real skill loading against a real Docker daemon; skill file linter asserting no YAML front matter or capability directives in `.md` files.

**Addresses features:** Universal base image, harness auto-load, backward compatibility (integration test gate)

**Avoids pitfalls:** Orchestrator silent fallback to wrong harness mode (Pitfall 1); test suite validating mocks rather than real behavior (Pitfall 7); skills inadvertently changing capabilities via structured metadata (Pitfall 6)

**Research flag:** Standard patterns — Docker bind mounts and harness modes are well-documented. No additional research phase needed.

---

### Phase 2: Kubex Manager Spawn Logic

**Rationale:** Pure Python logic (SkillResolver, ConfigBuilder, policy gating) has no Docker runtime dependency and can be built and unit-tested before any container changes. Manager state persistence (Pitfall 3) and network name resolution (Pitfall 4) must be built here — before any dynamic spawning test runs in CI.

**Delivers:** `skill_resolver.py` with path resolution and allowlist enforcement; `config_builder.py` with action union + policy-most-restrictive-wins + resource stacking; `POST /policy/skill-check` endpoint in Gateway; skill allowlist schema in `policies/default-boundary.yaml`; Redis persistence for kubex records with startup reconciliation; dynamic Docker network name resolution; skill mount integrity checks (hash verification, injection pattern stripping).

**Uses stack:** docker-py `containers.create()` volumes dict, pydantic `AgentSpawnConfig`/`SkillManifest` models, pyyaml `safe_load()`, stdlib `tarfile`/`BytesIO`

**Implements architecture components:** SkillResolver, ConfigBuilder, Policy Engine skill-check endpoint, Manager persistence

**Avoids pitfalls:** Skill prompt injection (Pitfall 2); Manager state loss on restart (Pitfall 3); Docker network name hardcoding (Pitfall 4)

**Research flag:** Standard patterns for config builder and skill resolver. The policy-gating endpoint is a new API surface — review existing Gateway policy engine patterns before implementation to ensure consistent behavior with existing action-gating logic.

---

### Phase 3: Spawn Handler Wiring and Agent Migration

**Rationale:** With SkillResolver, ConfigBuilder, and policy gating validated as units, wire them into the actual Docker spawn call in `lifecycle.py`. Then migrate the three existing agents. This is the integration risk phase — spawn handler changes touch the most critical path in the system.

**Delivers:** Updated `lifecycle.py` `create_kubex` calling SkillResolver → policy check → ConfigBuilder → volumes assembly → Docker create; `StandaloneConfig` reading from `/app/config.yaml` (falling back to env vars); `KUBEX_CAPABILITIES` derived from merged skill manifests; `config.yaml` for orchestrator, instagram-scraper, knowledge, reviewer agents; all 703+ tests passing against updated spawn handler.

**Implements architecture component:** Updated `KubexLifecycle.create_kubex` integration point

**Avoids pitfalls:** Capabilities hardcoded outside skill manifests (anti-pattern 2 from ARCHITECTURE.md); config baked into image rather than externalized

**Research flag:** Standard integration work. The orchestrator `orchestrator_loop.py`-to-harness-mode migration is the highest-complexity item; if it stalls, have a documented fallback (keep orchestrator Dockerfile as explicit technical debt with a follow-up task) rather than blocking Phase 4.

---

### Phase 4: Per-Agent Dockerfile Removal and Validation

**Rationale:** Dockerfile removal is the riskiest single change and must come last. The new infrastructure must be proven before the old safety net is removed. The test suite — not the Dockerfiles — is the safety net.

**Delivers:** Deleted `agents/orchestrator/Dockerfile`, `agents/instagram-scraper/Dockerfile`, `agents/knowledge/Dockerfile`, `agents/reviewer/Dockerfile`; updated `docker-compose.yml` building all agent services from `agents/_base/`; all 703+ tests (unit, integration, E2E) passing against `kubexclaw-base` with skill mounts; agent directories reduced to `config.yaml` only.

**Avoids pitfalls:** Per-agent Dockerfiles retained as "exceptions" that erode the single-image principle over time

**Research flag:** No additional research needed. This phase is pure migration validation — gate on green test suite.

---

### Phase Ordering Rationale

- **Skill catalog first** because SkillResolver and ConfigBuilder have no inputs without a finalized `skill.yaml` schema. Nothing downstream can be implemented against moving schema.
- **Manager logic before spawn wiring** because pure Python units are independently testable and faster to iterate on than Docker integration tests. Errors surface as unit test failures, not as "container started but behaves wrong."
- **Spawn wiring before Dockerfile removal** because the old Dockerfiles are the rollback path. Removing them before the new path is validated leaves no recovery option except rebuilding from git history.
- **Orchestrator harness mode decision in Phase 1** (not Phase 3) because discovering the orchestrator needs special handling during Dockerfile removal would require backtracking through all four phases.
- **All security measures (Pitfalls 1-4) built into Phase 1 and Phase 2** — not deferred. Pitfall research was explicit that prompt injection and state loss cannot be retrofitted.

### Research Flags

Phases needing additional research attention:
- **Phase 2 (Kubex Manager Spawn Logic):** Review the existing Gateway policy engine implementation before adding `POST /policy/skill-check`. The new endpoint must follow the same authorization, logging, and error-response patterns as existing action-gating endpoints to avoid inconsistent behavior.
- **Phase 3 (Spawn Handler Wiring):** The `orchestrator_loop.py` migration path needs a decision checkpoint before implementation begins. Option 1 (harness mode via config) is recommended; have the fallback (explicit technical debt) documented and accepted before starting.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Base Image):** Docker bind mounts and Python harness modes are well-documented. ARCHITECTURE.md provides the exact code patterns.
- **Phase 4 (Dockerfile Removal):** Pure deletion + test validation. No research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are existing dependencies with official docs. No new packages. Version compatibility verified against PyPI. |
| Features | HIGH | Grounded in existing project docs (`docs/skill-catalog.md`, `docs/kubex-manager.md`, `.planning/PROJECT.md`) plus ecosystem comparison. Feature boundaries are clear. |
| Architecture | HIGH | Derived from direct codebase analysis. Component boundaries, data flows, and build order are grounded in the running v1.0 system. |
| Pitfalls | HIGH | All critical pitfalls grounded in direct codebase analysis (specific files and line numbers cited) plus external sources (arXiv 2510.26328, OWASP LLM Top 10, PyPI supply chain). One prior incident (network naming) confirmed in project history. |

**Overall confidence:** HIGH

### Gaps to Address

- **Orchestrator loop migration path:** Three options exist (harness mode, skill plugin, keep Dockerfile). Option 1 is recommended but the exact implementation of `HarnessMode` in `standalone.py` is not designed yet. Needs a design decision at the start of Phase 3, not mid-implementation.
- **Skill integrity mechanism:** SHA-256 hash manifest and injection pattern stripping are specified in PITFALLS.md but the exact implementation (where manifest lives, when it is generated, how harness reads it at startup) is not detailed. Needs design in Phase 2 before implementation.
- **`POST /policy/skill-check` API contract:** The endpoint is identified as needed but the request/response schema, how boundary allowlists are stored in `policies/default-boundary.yaml`, and what "approved vs denied" returns is not specified. Needs design in Phase 2 before touching Gateway.
- **Config.yaml externalization:** `StandaloneConfig` must fall back to env vars if no `/app/config.yaml` is present (for backward compat with existing tests). The fallback logic needs to be specified to avoid breaking the 703-test suite during migration.

## Sources

### Primary (HIGH confidence)
- `docs/architecture.md` — Core system design, stem cell architecture diagram, repo layout spec
- `docs/kubex-manager.md` Section 19.3 — Dynamic Skill Injection specification
- `docs/skill-catalog.md` — Skill manifest schema, composition rules, scaffolding CLI spec
- `docs/agents.md` — Stem cell design philosophy, spawn flow, per-agent config examples
- `services/kubex-manager/kubex_manager/lifecycle.py` — Current `create_kubex` implementation (in-memory state, network constant, credential mounts)
- `agents/_base/kubex_harness/standalone.py` — `_load_skill_files`, `StandaloneConfig` (no validation confirmed)
- `docker-compose.yml` — Network naming, service definitions, volume mounts
- [Docker SDK for Python 7.1.0](https://docker-py.readthedocs.io/en/stable/containers.html) — `containers.create()` volumes parameter, `put_archive()` method
- [Docker Docs — Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) — bind mount vs named volume tradeoffs
- [Pydantic PyPI](https://pypi.org/project/pydantic/) — v2.12.5 API
- [pytest-asyncio PyPI](https://pypi.org/project/pytest-asyncio/) — v1.3.0 `asyncio_mode` requirement

### Secondary (MEDIUM confidence)
- [kubernetes.recipes — OpenClaw custom Docker image](https://kubernetes.recipes/recipes/deployments/openclaw-custom-docker-image/) — cold start ~5s with cached base image
- [Andrii Tkachuk on Medium — Agent skills in production](https://medium.com/@andrii.tkachuk7/agents-skills-in-production-how-to-bring-skills-to-docker-deployed-agents-vendor-agnostic-4282cf567930) — vendor-agnostic skill injection patterns
- [Codefresh — Docker Anti-Patterns](https://codefresh.io/blog/docker-anti-patterns/) — one image per environment, not per agent type
- [onereach.ai — Agentic AI Orchestration](https://onereach.ai/blog/agentic-ai-orchestration-enterprise-workflow-automation/) — escalation as standard 2026 enterprise pattern
- [Docker — Secure AI Agents at Runtime](https://www.docker.com/blog/secure-ai-agents-runtime-security/) — container runtime security for AI agents
- Project memory: `docker-learnings.md` — "Docker Compose prefixes network names: `openclaw_kubex-internal`" (confirmed prior incident)

### Tertiary (HIGH confidence — security sources)
- [arXiv 2510.26328 — Agent Skills Enable Prompt Injections](https://arxiv.org/html/2510.26328v1) — skill-file prompt injection attack class (October 2025)
- [OWASP Top 10 for LLMs 2025: LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — primary LLM attack vector
- [Repello AI 2026 — AI Agent Skill Scanner](https://repello.ai/blog/ai-agent-skill-scanner) — SKILL.md injection as documented attack vector
- [PyPI Supply Chain Attacks of 2025](https://medium.com/@joyichiro/the-pypi-supply-chain-attacks-of-2025-what-every-python-backend-engineer-should-learn-from-the-875ba4568d10) — runtime pip install risk

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
