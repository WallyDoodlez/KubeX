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

- [x] MCP Bridge — orchestrator coordinates workers via MCP protocol with policy-gated vault tools and live agent discovery — Phase 8 (v1.2)
- [x] CLI Runtime — any CLI agent (Claude Code, Codex, Gemini CLI) runs in PTY inside Kubex containers — Phases 9-11 (v1.2)
- [ ] Bidirectional MCP — harness is MCP server for CLI reporting (fallback for CLIs without hooks)
- [x] Hooks-based monitoring — passive instrumentation via CLI hooks where supported — Phase 10 (v1.2)
- [ ] OAuth provisioning — web-based flow via Command Center, token injected at spawn
- [ ] Lifecycle events — container/CLI/task state tracking and reporting

### Future

- ✓ Agent descriptions in config.yaml for dynamic discovery — Phase 8 (v1.2)
- [ ] Obsidian knowledge vault with auto git commit+push
- [ ] Command Center web dashboard (service health, orchestrator chat, containers)
- [ ] Multi-user session isolation
- [ ] Git attribution on vault writes (agent author + user committer)

### Out of Scope

- Real-time SSE progress streaming — deferred, polling works
- Full `kubexclaw` CLI replacement — `kclaw.py` works for current needs
- Clarification flow (`needs_clarification` status) — not yet needed
- Hot-swap skills on running containers — prompt injection vector; restart instead
- Structural vault isolation (per-agent folders) — kills institutional knowledge sharing
- aider support — no hooks, no MCP; would need wrapper; low priority

## Context

- **Current state:** 5 core services + 4 agents running live on Docker. 1196 tests passing. Orchestrator uses MCP Bridge (`harness_mode: mcp-bridge`) for worker coordination. CLIRuntime supports Claude Code and Gemini CLI via PTY with config-driven dispatch. Full E2E pipeline verified: Command Center → Gateway → Broker → Agent → GPT-5.2 → Result.
- **Tech stack:** Python, Docker, Redis, FastAPI, GPT-5.2 (non-pro), o3-mini (reviewer)
- **Codebase:** ~30,700 LOC Python
- **Live system:** Obsidian knowledge vault replacing Neo4j/Graphiti/OpenSearch. Command Center at :3001.
- **v1.2 direction:** MCP Bridge (workers as MCP servers, full tool loop replacement) + CLI Runtime (PTY-based, any CLI, hooks/MCP monitoring, OAuth via Command Center web flow). Design docs at `docs/design-mcp-bridge.md` and `docs/design-oauth-runtime.md`.

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
| MCP Bridge for orchestration | Standard protocol, any harness works, worker tools as MCP tools | ✓ Good — v1.2 Phase 8 |
| Workers are domain specialists with own LLM | Orchestrator decides WHO/WHAT, worker decides HOW | — Pending v1.2 |
| CLI runs as-is in PTY, not wrapped | Stem cell philosophy — container doesn't care what CLI you put in it | — Pending v1.2 |
| Hooks preferred, MCP fallback for monitoring | Hooks are passive (zero prompt tokens), MCP for CLIs without hooks | — Pending v1.2 |
| Bidirectional MCP — harness is client AND server | CLI reports via MCP tools, harness calls workers via MCP | — Pending v1.2 |
| OAuth via Command Center web flow, not docker exec | More polished UX, token forwarded to container at spawn | — Pending v1.2 |

## Constraints

- **Tech stack**: Python + Docker + Redis — no changes to core stack
- **Security**: Agents remain untrusted workloads — policy engine gates all capability requests
- **Docker Compose**: Must work with existing compose topology
- **No new dependencies in base image**: Agents request extras through policy

## Current Milestone: v1.2 MCP Bridge + CLI Runtime

**Goal:** Replace custom tool loop with MCP protocol and enable any CLI agent to run inside Kubex containers via PTY with hooks-based monitoring and OAuth provisioning.

**Target features:**
- MCP Bridge — workers as MCP servers, orchestrator as MCP client, custom loop removed
- CLI Runtime — PTY-based, any CLI runs as-is, harness is process supervisor
- Bidirectional MCP — harness is MCP server for CLI reporting (fallback)
- Hooks-based monitoring — passive instrumentation (Claude Code, Gemini CLI native; MCP fallback for Codex)
- OAuth provisioning — web-based flow via Command Center
- Lifecycle events — container/CLI/task state tracking

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-23 after Phase 11 (Gemini CLI Runtime) complete*
