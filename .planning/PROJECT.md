# KubexClaw v1.1 — Stem Cell Kubex Refactor

## What This Is

A refactor of the KubexClaw agent infrastructure to implement the "Stem Cell Kubex" architecture: one universal base image (`kubexclaw-base`) that gets specialized at spawn time via skills and config injection. This eliminates per-agent Dockerfiles and makes adding new agent capabilities as simple as writing a markdown skill file.

## Core Value

Any Kubex can become any agent — new capabilities are skill files, not Docker builds.

## Requirements

### Validated

<!-- Shipped and confirmed valuable (MVP v1.0). -->

- ✓ Gateway with policy engine (approve/deny/escalate) — v1.0
- ✓ Broker with Redis-backed task queue and capability-based routing — v1.0
- ✓ Registry for agent lifecycle management — v1.0
- ✓ Kubex Manager for container spawning — v1.0
- ✓ Base agent harness with OpenAI GPT-5.2 tool-use loop — v1.0
- ✓ Skill injection (loads `/app/skills/*.md` into LLM system prompt) — v1.0
- ✓ Multi-agent orchestration (orchestrator + workers) — v1.0
- ✓ Reviewer agent with ESCALATE routing (o3-mini, anti-collusion) — v1.0
- ✓ Knowledge base wiring (Graphiti + OpenSearch stubs) — v1.0
- ✓ Kill switch via control channel — v1.0
- ✓ Human-in-the-loop (`request_user_input` action) — v1.0
- ✓ 703+ tests passing (unit, integration, E2E) — v1.0

### Active

<!-- v1.1 scope: Stem Cell Kubex refactor -->

- [ ] Universal base image — single `kubexclaw-base` Docker image used by all agents
- [ ] Dynamic skill injection at spawn — Kubex Manager injects skill files + config into containers at creation time
- [ ] Remove per-agent Dockerfiles — orchestrator, instagram-scraper, knowledge agents all use base image
- [ ] Runtime dependency requests — agents can request tools/packages through the policy pipeline
- [ ] Policy-gated skill assignment — which skills an agent gets is controlled by policy, not hardcoded
- [ ] Config-driven specialization — agent identity (capabilities, model, tools) defined in config, not image
- [ ] Backward compatibility — all existing E2E tests pass against refactored agents

### Out of Scope

- Real-time SSE progress streaming — deferred to v1.2
- Graphiti/OpenSearch live backend integration — deferred, mocks sufficient for now
- Full `kubexclaw` CLI replacement — `kclaw.py` works for current needs
- Clarification flow (`needs_clarification` status) — deferred to v1.2
- New agent types or capabilities — v1.1 is refactor only, no new features

## Context

- **Current state:** 5 core services running (gateway, broker, registry, kubex-manager, redis) with 3 agents (orchestrator, instagram-scraper, knowledge). Each agent currently has its own Dockerfile.
- **Stem cell philosophy:** Already documented across all architecture docs (`ab12a64`). The code needs to catch up with the documented vision.
- **Skill injection works:** The standalone harness already loads `/app/skills/*.md` into the LLM system prompt. The refactor extends this so Kubex Manager controls which skills get mounted.
- **Policy engine ready:** The gateway already handles approve/deny/escalate. Runtime dependency requests will flow through the same pipeline.
- **Docker Compose:** Current setup uses `openclaw_kubex-internal` network. Refactor must preserve networking.

## Constraints

- **Tech stack**: Python + Docker + Redis — no changes to core stack
- **Backward compatibility**: All 703+ existing tests must continue to pass
- **Docker Compose**: Must work with existing `docker-compose.yml` and `docker-compose.test.yml`
- **Security**: Agents remain untrusted workloads — policy engine gates all capability requests
- **No new dependencies**: Base image includes everything; agents request extras through policy

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single base image, not multi-stage variants | Simpler to maintain, aligns with stem cell philosophy | — Pending |
| Skills as volume mounts, not baked into image | Enables dynamic assignment without rebuilds | — Pending |
| Policy gate for runtime deps (pip install, etc.) | Security-first — agents shouldn't self-modify without approval | — Pending |
| Keep GPT-5.2 as default model, o3-mini for reviewer | Anti-collusion requires different model for security review | ✓ Good |

---
*Last updated: 2026-03-11 after initialization*
