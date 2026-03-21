# KubexClaw — Agent AI Pipeline

## What This Is

An agent infrastructure platform that deploys AI agents as autonomous "employees" performing real work across company workflows. Built on the "Stem Cell Kubex" architecture: one universal base image (`kubexclaw-base`) specialized at spawn time via skills and config injection. New capabilities are skill files, not Docker builds.

## Core Value

Any Kubex can become any agent — new capabilities are skill files, not Docker builds.

## Requirements

### Validated

- ✓ Gateway with policy engine (approve/deny/escalate) — v1.0
- ✓ Broker with Redis-backed task queue and capability-based routing — v1.0
- ✓ Registry for agent lifecycle management — v1.0
- ✓ Kubex Manager for container spawning — v1.0
- ✓ Base agent harness with OpenAI GPT-5.2 tool-use loop — v1.0
- ✓ Skill injection (loads `/app/skills/*.md` into LLM system prompt) — v1.0
- ✓ Multi-agent orchestration (orchestrator + workers) — v1.0
- ✓ Reviewer agent with ESCALATE routing (o3-mini, anti-collusion) — v1.0
- ✓ Knowledge base wiring — v1.0
- ✓ Kill switch via control channel — v1.0
- ✓ Human-in-the-loop (`request_user_input` action) — v1.0
- ✓ 703+ tests passing (unit, integration, E2E) — v1.0
- ✓ Universal base image — single `kubexclaw-base` Docker image — v1.1
- ✓ Dynamic skill injection at spawn — Manager injects skills + config into containers — v1.1
- ✓ Per-agent Dockerfiles removed — all agents use base image — v1.1
- ✓ Runtime dependency requests through policy pipeline — v1.1
- ✓ Policy-gated skill assignment (POST /policy/skill-check) — v1.1
- ✓ Config-driven specialization — agent identity from config, not image — v1.1
- ✓ Backward compatibility — all existing tests pass against refactored agents — v1.1
- ✓ SkillValidator injection defense with blocklist at spawn time — v1.1
- ✓ SkillResolver composition with tool namespacing — v1.1
- ✓ Manager Redis persistence (survives restarts) — v1.1
- ✓ Dynamic Docker network resolution from labels — v1.1

### Active

- [ ] MCP Bridge — replace custom orchestrator tool loop with standard MCP server
- [ ] Agent descriptions in config.yaml for dynamic discovery
- [ ] Obsidian knowledge vault with auto git commit+push
- [ ] Command Center web dashboard (service health, orchestrator chat, containers)
- [ ] OAuth CLI runtime mode (Claude Code, Codex CLI, Gemini CLI inside containers)
- [ ] Multi-user session isolation
- [ ] Git attribution on vault writes (agent author + user committer)

### Out of Scope

- Real-time SSE progress streaming — deferred, polling works
- Full `kubexclaw` CLI replacement — `kclaw.py` works for current needs
- Clarification flow (`needs_clarification` status) — not yet needed
- Hot-swap skills on running containers — prompt injection vector; restart instead
- Structural vault isolation (per-agent folders) — kills institutional knowledge sharing

## Context

- **Current state:** 5 core services + 4 agents running live on Docker. 789 tests passing. Full E2E pipeline verified: Command Center → Gateway → Broker → Agent → GPT-5.2 → Result.
- **Tech stack:** Python, Docker, Redis, FastAPI, GPT-5.2 (non-pro), o3-mini (reviewer)
- **Codebase:** ~30,700 LOC Python
- **Live system:** Obsidian knowledge vault replacing Neo4j/Graphiti/OpenSearch. Command Center at :3001.
- **v1.2 direction:** MCP Bridge for orchestration (design doc at `docs/design-mcp-bridge.md`), OAuth CLI runtime (design doc at `docs/design-oauth-runtime.md`)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single base image, not multi-stage variants | Simpler to maintain, aligns with stem cell philosophy | ✓ Good |
| Skills as volume mounts, not baked into image | Enables dynamic assignment without rebuilds | ✓ Good |
| Policy gate for runtime deps (pip install, etc.) | Security-first — agents shouldn't self-modify without approval | ✓ Good |
| Keep GPT-5.2 as default model, o3-mini for reviewer | Anti-collusion requires different model for security review | ✓ Good |
| No dual harness mode — same harness for all agents | Orchestrator specialization via config/tools/skills, not separate harness | ✓ Good |
| Boot-time deps trusted, runtime deps through policy | Clean separation of trust boundaries | ✓ Good |
| config.yaml sole source of truth — no env var overrides | Prevents identity confusion, single place to look | ✓ Good |
| Obsidian vault replacing Neo4j/Graphiti/OpenSearch | Human-readable, git-versioned, wiki-link knowledge graph | ✓ Good |
| Gateway ingress scanning, not vault-layer scanning | Defense at boundary; LLM scanning LLM attacks is circular | ✓ Good — v1.2 |
| MCP Bridge for orchestration | Standard protocol, any harness works, worker tools as MCP tools | — Pending v1.2 |
| Workers are domain specialists with own LLM | Orchestrator decides WHO/WHAT, worker decides HOW | — Pending v1.2 |

## Constraints

- **Tech stack**: Python + Docker + Redis — no changes to core stack
- **Security**: Agents remain untrusted workloads — policy engine gates all capability requests
- **Docker Compose**: Must work with existing compose topology
- **No new dependencies in base image**: Agents request extras through policy

---
*Last updated: 2026-03-21 after v1.1 milestone*
