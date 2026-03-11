# Architecture Research

**Domain:** Dynamic container specialization for AI agent infrastructure
**Researched:** 2026-03-11
**Confidence:** HIGH — derived from existing codebase, architecture docs, and running implementation

---

## Standard Architecture for Dynamic Container Specialization

### System Overview

Dynamic container specialization systems share a common pattern: a universal runtime image, an
orchestrating controller that resolves what specialization each instance needs, a catalog of
specializations, and a policy gate that controls who gets what. Below is how this pattern maps
onto the KubexClaw stem cell architecture.

```
┌──────────────────────────────────────────────────────────────────┐
│                     Control Plane                                 │
│  ┌──────────────────┐   ┌──────────────────┐                     │
│  │  Kubex Manager   │   │  Skill Catalog   │                     │
│  │  (spawn/stop/    │   │  skills/*/*/     │                     │
│  │   skill resolve) │   │  SKILL.md +      │                     │
│  └────────┬─────────┘   │  skill.yaml      │                     │
│           │             └────────┬─────────┘                     │
│           │  resolves skills     │                               │
│  ┌────────▼─────────────────────▼─────────┐                     │
│  │         Policy Engine (Gateway)        │                     │
│  │   skill allowlists per boundary        │                     │
│  │   global blocklists                    │                     │
│  └────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
           │ mount /app/skills/*.md (read-only)
           │ inject config.yaml
           │ set Docker labels
           │ attach kubex-internal network
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Data Plane — Kubex Containers                  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │            kubexclaw-base (universal image)                  │ │
│  │  python:3.12-slim + kubex-common + kubex-harness            │ │
│  ├──────────────┬───────────────────────────────────────────── ┤ │
│  │  /app/skills/│ ← bind-mounted at spawn time                 │ │
│  │  SKILL.md A  │   (read-only, different per Kubex)            │ │
│  │  SKILL.md B  │                                              │ │
│  ├──────────────┘                                              │ │
│  │  StandaloneAgent: poll Broker → LLM via Gateway proxy →     │ │
│  │  store result → ack                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  (Same image — different skills/config = different agent identity)│
└──────────────────────────────────────────────────────────────────┘
           │ task messages (Redis Streams)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Gateway  │  │  Broker  │  │ Registry │  │      Redis       │ │
│  │ (policy, │  │ (Redis   │  │ (capabil-│  │ db0: tasks       │ │
│  │  proxy,  │  │ Streams, │  │  ity     │  │ db1: registry    │ │
│  │  audit)  │  │  routing)│  │  lookup) │  │ db3: lifecycle   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Kubex Manager** | Container lifecycle (create/start/stop/kill/restart). Skill resolution. Config.yaml generation. Docker label injection. | Docker Engine, Policy Engine (skill gating), Registry, Redis (lifecycle events) |
| **Skill Catalog** (`skills/*/`) | Stores `SKILL.md` (LLM instructions) + `skill.yaml` (metadata: actions, resource hints, policy constraints). Read by Kubex Manager at spawn. | Kubex Manager reads; Kubex containers mount via bind volume |
| **Policy Engine** (inside Gateway) | Determines which skills a given boundary/agent may receive. Enforces global blocklists. Approves/denies/escalates all agent actions. | Kubex Manager (spawn gating), all Kubex containers (action gating) |
| **kubexclaw-base** (Docker image) | Universal runtime: python:3.12-slim + kubex-common + kubex-harness. No agent-specific code. Built once, used for all agents. | Spawned by Kubex Manager; runs StandaloneAgent loop |
| **StandaloneAgent** (in harness) | Poll Broker for tasks → load system prompt from `/app/skills/*.md` → call LLM via Gateway proxy → post result → ack. This is the actual agent runtime. | Broker (task consumption/ack), Gateway (LLM proxy + progress), Registry (capability registration) |
| **Kubex Broker** | Redis Streams-backed task queue. Routes tasks by capability (consumer groups). Stores task results. | All Kubex containers, Gateway, Registry |
| **Kubex Registry** | Agent capability directory. Maps capability names to available agent_ids. Used by Orchestrator for worker discovery. | Registry service (HTTP), all agents on startup |
| **Gateway** | Single entry point for all inbound requests. Auth, rate limiting, audit logging. LLM API proxy (injects keys, enforces model allowlists). Policy enforcement for every agent action. | All Kubex containers (inbound), external LLM providers (outbound), Redis (audit) |

---

## Recommended Project Structure — v1.1 Target

The v1.0 layout has per-agent Dockerfiles and agent-specific Python code mixed into agent
directories. v1.1 targets the config-only agents layout described in `docs/architecture.md`.

```
kubexclaw/
├── agents/
│   ├── _base/
│   │   ├── Dockerfile          # ← THE ONLY agent Dockerfile
│   │   ├── kubex_harness/      # StandaloneAgent + HarnessConfig
│   │   │   ├── standalone.py   # agent poll loop (skill loading already works)
│   │   │   ├── harness.py      # OpenClaw subprocess wrapper (PTY path)
│   │   │   └── main.py
│   │   └── entrypoint.sh
│   ├── orchestrator/
│   │   ├── config.yaml         # ← agent identity (skills, model, policy)
│   │   └── [NO Dockerfile]     # ← DELETED in v1.1
│   ├── instagram-scraper/
│   │   ├── config.yaml
│   │   └── [NO Dockerfile]
│   ├── knowledge/
│   │   ├── config.yaml
│   │   └── [NO Dockerfile]
│   └── reviewer/
│       ├── config.yaml
│       └── [NO Dockerfile]
│
├── skills/                     # Skill catalog — agents reference by name
│   ├── data-collection/
│   │   └── web-scraping/
│   │       ├── SKILL.md        # LLM instructions injected into system prompt
│   │       └── skill.yaml      # Metadata: actions, constraints, resource hints
│   ├── knowledge/
│   │   └── recall/
│   │       ├── SKILL.md
│   │       └── skill.yaml
│   ├── dispatch/
│   │   └── task-management/
│   │       ├── SKILL.md
│   │       └── skill.yaml
│   └── development/
│       └── implement-feature/
│           └── SKILL.md
│
├── services/
│   ├── kubex-manager/
│   │   └── kubex_manager/
│   │       ├── lifecycle.py    # ← ADD: skill resolution + bind mount assembly
│   │       ├── skill_resolver.py  # ← NEW: reads skill catalog, validates skills
│   │       ├── config_builder.py  # ← NEW: generates config.yaml from merged skills
│   │       └── main.py
│   └── gateway/                # policy.py needs skill allowlist enforcement
│
└── docker-compose.yml          # All agents use kubexclaw-base image
```

### Structure Rationale

- **`agents/*/config.yaml` only:** Agent identity is pure config. Removing per-agent Dockerfiles
  is the primary v1.1 goal.
- **`skills/` as flat catalog:** Skills are referenced by path (e.g., `data-collection/web-scraping`).
  The catalog is separate from agent definitions — skills are shared across agent types.
- **`kubex_manager/skill_resolver.py`:** New component in v1.1. Reads skill catalog, resolves skill
  names from spawn requests to actual `SKILL.md` file paths, validates against policy.
- **`kubex_manager/config_builder.py`:** New component in v1.1. Merges capabilities and policies
  from all skills in a spawn request, generates the final `config.yaml` that gets injected.

---

## Architectural Patterns

### Pattern 1: Specialization Via Volume Mount (not image layer)

**What:** Agent identity is delivered via bind-mounted files at container startup, not baked into
the image. The universal base image contains only the runtime. Skills are read-only files mounted
at `/app/skills/` by the container orchestrator before the agent process starts.

**When to use:** Any system where the set of behaviors needs to change without rebuilding the
runtime image. Correct when the runtime itself is stable but behavioral configuration changes
frequently.

**Trade-offs:**
- Pro: One image to build, patch, and pull. Skill updates are instant (remount on restart).
- Pro: Policy can enforce what behavior a given container class is allowed to have.
- Con: Skill files must be present on the host at mount time — Kubex Manager must manage the
  skill catalog directory accessible to Docker.
- Con: Running containers do not pick up skill changes without restart.

**Current state in codebase:** The harness already does this — `_load_skill_files` in
`standalone.py` reads `/app/skills/*.md` recursively into the LLM system prompt. The gap is
that Kubex Manager's `create_kubex` in `lifecycle.py` does not yet assemble these mounts.
The `volumes` dict in `KubexLifecycle.create_kubex` only handles credential mounts today.

```python
# lifecycle.py create_kubex — MISSING today, needed in v1.1:
for skill_name in agent_cfg.get("skills", []):
    skill_path = skill_catalog.resolve(skill_name)  # skill_resolver
    volumes[skill_path] = {"bind": f"/app/skills/{skill_name}.md", "mode": "ro"}
```

### Pattern 2: Config-as-Identity Injection

**What:** Each container receives a `config.yaml` at spawn time that defines its complete
identity: capabilities, model allowlist, policy constraints, resource budget. The harness reads
this file on startup to configure its behavior. The same base image becomes any agent type
purely by swapping the config.

**When to use:** When many containers from the same image need distinct identities known only at
spawn time (not at build time).

**Trade-offs:**
- Pro: Config changes don't require image rebuilds. Rollout = stop old + start new with updated config.
- Pro: Config can be validated before spawn (policy check before creating container).
- Con: Config format must be stable. Breaking changes to config schema require coordinated
  update of all running agents.

**Current state in codebase:** `agents/orchestrator/config.yaml` exists and contains the
agent's full identity spec. The standalone harness reads env vars injected by Kubex Manager
(agent_id, capabilities, system prompt). v1.1 needs Kubex Manager to parse the config.yaml for
a given agent name and fully materialize all env vars + mounts from it.

### Pattern 3: Policy-Gated Capability Assignment

**What:** The specialization controller (Kubex Manager) does not blindly fulfill spawn requests.
Before creating a container with a given skill set, it asks the Policy Engine whether the
requesting boundary is allowed to hold those skills. This prevents an agent in boundary A from
requesting skills that belong to boundary B.

**When to use:** Multi-tenant or multi-boundary systems where different agent classes have
different trust levels and capability scopes.

**Trade-offs:**
- Pro: Policy is the single source of truth for "what can run where." No hardcoded per-agent
  restrictions scattered across Dockerfiles.
- Pro: A global skill blocklist can instantly prevent any new container from receiving a
  compromised skill.
- Con: Policy must be consulted at spawn time (synchronous, adds latency to container creation).
- Con: Policy schema must cover the skill dimension (boundary-level allowlists). This is
  documented in `docs/kubex-manager.md` section 19.3 but not yet implemented in the Policy Engine.

---

## Data Flow

### Spawn Flow — How a Stem Cell Becomes a Specialized Agent

```
Operator / Command Center
    │
    │  POST /api/v1/agents
    │  { name: "research-agent-03",
    │    boundary: "data-collection",
    │    skills: ["web-scraping", "research"] }
    ▼
Kubex Manager (spawn handler)
    │
    ├─► Skill Catalog  →  resolve "web-scraping" to /skills/data-collection/web-scraping/SKILL.md
    │                      resolve "research" to /skills/knowledge/recall/SKILL.md
    │
    ├─► Policy Engine  →  can boundary "data-collection" receive these skills?
    │                     → approved: [web-scraping, research]
    │
    ├─► Config Builder →  merge capabilities (union of actions from all skill.yaml files)
    │                     merge policies (most restrictive constraint wins)
    │                     generate config.yaml
    │
    ├─► Docker Engine  →  docker create kubexclaw-base:latest
    │                       --label kubex.agent_id=research-agent-03
    │                       --label kubex.boundary=data-collection
    │                       --env KUBEX_AGENT_ID=research-agent-03
    │                       --env KUBEX_CAPABILITIES=http_get,write_output
    │                       --volume /skills/web-scraping/SKILL.md:/app/skills/web-scraping.md:ro
    │                       --volume /skills/recall/SKILL.md:/app/skills/recall.md:ro
    │                       --volume /configs/research-agent-03/config.yaml:/app/config.yaml:ro
    │
    ├─► Docker Engine  →  docker start
    │
    ├─► Registry       →  POST /agents (agent_id, boundary, capabilities)
    │
    └─► Redis db3      →  XADD kubex:lifecycle {event: "started", agent_id: ...}

Container boots:
    entrypoint.sh
    → StandaloneConfig.__init__
        → _load_skill_files("/app/skills")   ← reads mounted SKILL.md files
        → builds system_prompt = base_prompt + skill content
    → StandaloneAgent.run()
        → polls Broker by capability
        → sends skill-enriched system prompt to LLM via Gateway proxy
        → generic stem cell is now a specialized agent
```

### Task Execution Flow — Runtime Data Path

```
Human Operator
    │  POST /tasks  { capability: "scrape_instagram", ... }
    ▼
Gateway
    │  auth + rate limit + audit log
    ▼
Broker (Redis Streams)
    │  XADD to stream for capability "scrape_instagram"
    ▼
StandaloneAgent (inside container)
    │  XREADGROUP by capability
    │  builds messages: [system_prompt_with_skills, user_message]
    │  POST /v1/proxy/openai/chat/completions
    ▼
Gateway (LLM proxy)
    │  validates model allowlist
    │  injects API key
    │  forwards to LLM provider
    ▼
LLM Provider (Anthropic/OpenAI)
    │  response
    ▼
Gateway → StandaloneAgent
    │  result text
    │  POST /tasks/{task_id}/result to Broker
    │  POST /tasks/{task_id}/progress to Gateway
    │  XACK message
    ▼
Broker stores result → Gateway retrieves on poll
```

### Key Data Flows

1. **Skill resolution (spawn time):** Spawn request → Kubex Manager reads skill catalog on
   host filesystem → Policy Engine validates boundary allowlists → bind mount paths assembled →
   Docker create called. Skills never enter the image; they are always host-resident and mounted.

2. **Skill loading (boot time):** Container starts → `_load_skill_files("/app/skills")` scans
   `*.md` files recursively → content concatenated into system prompt → LLM receives identity
   via system prompt. No network call needed for skill loading.

3. **Capability registration (boot time):** Kubex Manager registers capabilities with Registry
   after start (currently in `_register_with_registry`). In v1.1, capabilities come from merged
   `skill.yaml` manifests, not hardcoded env vars.

4. **Runtime dependency request (escalation path):** If a running agent needs a pip package,
   it submits an action request through Gateway → Policy Engine evaluates → unknown actions
   ESCALATE to reviewer → human approval queued. This is the safety net for unanticipated needs.

---

## Component Boundaries — What Talks to What

| Boundary | Communication Pattern | Notes |
|----------|-----------------------|-------|
| Kubex Manager ↔ Docker Engine | Docker SDK (Python `docker` library) | Direct socket access. Manager is the only component that talks to Docker. |
| Kubex Manager ↔ Policy Engine | HTTP call to Gateway `/policy/skill-check` (new endpoint needed in v1.1) | Currently missing — Manager does not call policy at spawn time. |
| Kubex Manager ↔ Registry | HTTP REST (`POST /agents`, `DELETE /agents/{id}`) | Already implemented in `_register_with_registry`. |
| Kubex Manager ↔ Redis | async Redis client, XADD to `kubex:lifecycle` stream on db3 | Already implemented in `_publish_lifecycle_event`. |
| Kubex container ↔ Broker | HTTP REST polling (`GET /messages/consume/{capability}`) | `StandaloneAgent._consume`. Uses capability as consumer group name. |
| Kubex container ↔ Gateway (LLM) | HTTP POST to `$OPENAI_BASE_URL/chat/completions` | Gateway injects API key. Container never holds a real key. |
| Kubex container ↔ Gateway (progress) | HTTP POST to `/tasks/{task_id}/progress` | `StandaloneAgent._post_progress`. |
| Skill Catalog ↔ Kubex Manager | Filesystem read (host OS) | Manager reads `skills/*/SKILL.md` + `skill.yaml`. Must be on Docker host, accessible to Manager container via bind mount. |
| All Kubex containers ↔ Internet | BLOCKED — all outbound traffic through Gateway egress proxy | Containers have no direct internet access. |

---

## Build Order — Phase Dependencies

The v1.1 refactor has clear dependency layers. Each layer must be stable before the next.

### Layer 1 — Skill Catalog Infrastructure (no code changes to agents)

Before any agent can use dynamically injected skills, the catalog structure must be finalized
and Kubex Manager must be able to read it.

- Finalize `skill.yaml` schema (fields: `name`, `actions`, `resource_hints`, `policy_constraints`)
- Add `SKILL.md` files for all current agent skills (dispatch/task-management, knowledge/recall,
  web-scraping)
- Expose catalog directory as a volume mount into the Kubex Manager container
- Implement `SkillResolver` in `services/kubex-manager/kubex_manager/skill_resolver.py`

**Why first:** Everything downstream depends on a parseable, well-structured skill catalog.
Without this, config generation and policy gating have no data to work with.

### Layer 2 — Config Builder + Policy Gating

Config generation and policy checks are pure Python logic with no Docker involvement.
They can be built and unit-tested before any container changes.

- Implement `ConfigBuilder` in `services/kubex-manager/kubex_manager/config_builder.py`
  - Input: list of resolved skills (from SkillResolver) + spawn request overrides
  - Output: merged `config.yaml` dict (capabilities = union of actions, policy = most restrictive)
- Add skill allowlist schema to Gateway policy files (`policies/default-boundary.yaml`)
- Implement skill authorization check in Gateway policy engine
- Add `POST /policy/skill-check` endpoint to Gateway (called by Kubex Manager at spawn)

**Why second:** These are the logical core of the stem cell model. They have no runtime
dependencies — pure computation over config data.

### Layer 3 — Kubex Manager Spawn Handler Wiring

Wire the skill resolution + policy gating + config generation into the actual Docker container
creation call.

- Update `KubexLifecycle.create_kubex` to:
  1. Call `SkillResolver.resolve_all(skills)` to get SKILL.md paths
  2. Call Gateway policy check endpoint for skill authorization
  3. Call `ConfigBuilder.build(skills, spawn_request)` to generate `config.yaml`
  4. Add skill bind mounts to `volumes` dict in `docker.containers.create` call
  5. Write generated `config.yaml` to a temp path and bind-mount it
- Update `StandaloneConfig.__init__` to read from `/app/config.yaml` if present (fallback to env vars)
- Update `KUBEX_CAPABILITIES` env var injection to come from merged skill capabilities

**Why third:** Depends on Layer 1 (SkillResolver) and Layer 2 (ConfigBuilder + Policy). This is
the actual integration point.

### Layer 4 — Per-Agent Dockerfile Removal

With Layer 3 working, agents can run from the base image. Remove per-agent Dockerfiles and
reduce agent directories to config-only.

- Migrate `orchestrator_loop.py` logic into `kubex-harness` (or verify the base harness covers it)
- Remove `agents/orchestrator/Dockerfile`, `agents/instagram-scraper/Dockerfile`,
  `agents/knowledge/Dockerfile`, `agents/reviewer/Dockerfile`
- Update `docker-compose.yml` to build all agent services from `agents/_base/`
- Verify all existing E2E tests pass

**Why last:** Dockerfile removal is the riskiest change. Doing it last means the new
infrastructure is proven before the old safety net is removed. Backward compatibility is
validated by existing test suite.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (1 host, 3-5 agents) | Single Docker host. Kubex Manager manages containers directly via Docker SDK. Skill catalog is a directory on the host. No changes needed. |
| Expanded (1 host, 10-20 agents) | Redis Streams consumer groups handle concurrent task routing. Only bottleneck is Docker host resources (CPU/memory per container). Add resource limits per agent type. |
| Multi-host (Docker Swarm) | Kubex Manager needs Docker Swarm API instead of local Docker SDK. Skill catalog must be on shared volume (NFS, etc.) accessible to all hosts. Service configs replace bind mounts. Post-MVP scope per PROJECT.md. |

### Scaling Priorities

1. **First bottleneck:** Skill catalog read on every spawn. At low spawn rates (< 1/minute)
   this is irrelevant. At high rates, add in-memory caching in `SkillResolver` with TTL.

2. **Second bottleneck:** Redis Streams consumer lag if many agents share one capability.
   Redis Streams already handles this via consumer groups. Add monitoring via
   `GET /broker/status` dead-letter and lag metrics.

---

## Anti-Patterns

### Anti-Pattern 1: Per-Agent Dockerfiles (the current state)

**What people do:** Create a separate Dockerfile for each agent type, baking in agent-specific
dependencies, configs, and code.

**Why it's wrong:** N images to maintain, patch, and build. A security update to the base
Python image requires rebuilding every agent image independently. Adding a new agent type is an
engineering task (write code, build image, update CI) rather than an operations task
(write config, assign skills).

**Do this instead:** One `kubexclaw-base` image. Agent identity via skill mounts + config.yaml.
New agent type = new `config.yaml` entry + skill file.

**Current gap:** The orchestrator agent has its own Dockerfile with `orchestrator_loop.py`
baked in. This code must be migrated into the base harness or refactored so the orchestrator's
identity comes entirely from its `config.yaml` and injected skills.

### Anti-Pattern 2: Capabilities Hardcoded in Container Environment

**What people do:** Set `KUBEX_CAPABILITIES=task_orchestration,task_management` as a static
env var in a Dockerfile or docker-compose service definition.

**Why it's wrong:** Capabilities become a build-time or deployment-time decision rather than a
spawn-time decision. Adding a capability requires a config change in a non-canonical location.
The canonical source of capabilities should be the skill manifests (`skill.yaml`).

**Do this instead:** Derive capabilities from the merged set of `skill.yaml` action lists
assembled by `ConfigBuilder`. Kubex Manager injects `KUBEX_CAPABILITIES` dynamically at spawn
time based on which skills are assigned.

**Current gap:** `lifecycle.py` line 172 reads capabilities from `agent_cfg.get("capabilities",
[])` (hardcoded in config). In v1.1, this should come from `ConfigBuilder` output.

### Anti-Pattern 3: Skills Baked into the System Prompt at Build Time

**What people do:** Write the agent's instructions (tool definitions, behavioral rules) directly
into a `KUBEX_AGENT_PROMPT` env var set in a Dockerfile or compose file.

**Why it's wrong:** Updating instructions requires a redeploy. Skills cannot be reused across
agent types without copy-paste. There is no policy layer controlling which instructions a given
agent type is allowed to receive.

**Do this instead:** Keep `KUBEX_AGENT_PROMPT` as the base identity (role statement only).
Skills are mounted `.md` files loaded at boot by `_load_skill_files`. This is already how the
harness works — the gap is that Kubex Manager is not yet injecting the right files.

### Anti-Pattern 4: Skills Without Manifests

**What people do:** Create `SKILL.md` files with LLM instructions but no machine-readable
`skill.yaml` metadata.

**Why it's wrong:** Kubex Manager cannot programmatically determine what actions a skill
enables, what resource constraints it needs, or which boundaries it belongs to. Policy gating
cannot work without structured metadata.

**Do this instead:** Every skill has both `SKILL.md` (LLM instructions) and `skill.yaml`
(machine-readable metadata). The `dispatch/task-management/skill.yaml` exists today as a model
to extend to all skills.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Kubex Manager ↔ Skill Catalog | Filesystem read on Docker host | Manager container needs `/app/skills` from host bind-mounted as read-only. |
| Kubex Manager ↔ Gateway Policy | HTTP REST (new endpoint needed) | `POST /policy/skill-check` with boundary + skills list. Gateway returns approved/denied lists. |
| Agent containers ↔ Skill files | Docker bind mount `/app/skills/*.md` (read-only) | Already works at harness level. Manager just needs to assemble the mounts. |
| Orchestrator loop ↔ Base harness | Code merge needed | `orchestrator_loop.py` in per-agent Dockerfile must become either a skill injection or a harness capability. This is the hardest migration. |

### The Orchestrator Migration Challenge

The orchestrator is the most complex agent to migrate because it currently has its own
Python module (`orchestrator_loop.py`) baked into its Dockerfile. This module implements the
multi-turn tool-use loop with 8 OpenAI function-calling tools.

Three options, in order of implementation complexity:

1. **Move loop into base harness (recommended):** Extract the tool-use loop as a `HarnessMode`
   selectable via config. Base harness supports both "simple poll" and "tool-use loop" modes.
   Mode is specified in `config.yaml` and injected as `KUBEX_HARNESS_MODE=tool_use`.
   This keeps the orchestrator config-only.

2. **Inject loop as a skill:** Package `orchestrator_loop.py` as a skill module loaded by
   the base harness. Complex — harness would need a plugin loader, not just markdown injection.

3. **Keep separate (not recommended for v1.1):** Leave orchestrator with its own Dockerfile for
   now, migrate in v1.2 after base harness supports multi-turn tool use. Simpler short-term but
   delays true stem cell for the most important agent.

Recommendation: Option 1. The tool-use loop is not orchestrator-specific behavior — any future
agent might need multi-turn tool use. Making it a harness mode serves the general case.

---

## Sources

- `docs/architecture.md` — Core system design, stem cell architecture diagram, repo layout spec
- `docs/kubex-manager.md` — Section 19.3: Dynamic Skill Injection specification
- `docs/agents.md` — Stem cell design philosophy, spawn flow, per-agent config examples
- `services/kubex-manager/kubex_manager/lifecycle.py` — Current `create_kubex` implementation
- `agents/_base/kubex_harness/standalone.py` — `_load_skill_files`, `StandaloneConfig`
- `agents/_base/Dockerfile` — Universal base image (already exists)
- `agents/orchestrator/Dockerfile` — Example of per-agent Dockerfile to be removed
- `agents/orchestrator/config.yaml` — Example agent config format
- `skills/` — Existing skill catalog structure (SKILL.md + skill.yaml pattern)
- `.planning/PROJECT.md` — v1.1 scope and constraints

---

*Architecture research for: Dynamic container specialization — KubexClaw Stem Cell Kubex v1.1*
*Researched: 2026-03-11*
