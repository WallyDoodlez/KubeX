# Phase 6: Manager Spawn Logic and Policy Gates - Research

**Researched:** 2026-03-15
**Domain:** Python module design, Docker SDK, Redis serialization, FastAPI routing, policy engine extension
**Confidence:** HIGH

## Summary

Phase 6 is entirely brownfield. Every component it extends already exists and is tested: SkillResolver, KubexLifecycle, PolicyEngine/PolicyLoader, KubexRecord, and the FastAPI routers on both Manager and Gateway. The work is extension and wiring — not greenfield construction.

The phase has five distinct sub-problems: (1) extend SkillResolver to accept an agent config object rather than a raw skill name list; (2) build ConfigBuilder to assemble a merged config.yaml from composed skill manifests; (3) add `POST /policy/skill-check` to Gateway following the existing PolicyResult response format; (4) serialize KubexRecord to Redis for restart persistence; and (5) replace the hardcoded `NETWORK_INTERNAL` constant in lifecycle.py with a Docker label lookup at container-create time.

The existing `PolicyLoader._load_agent_policy()` reads per-agent policy YAML files from `agents/{agent_id}/policies/policy.yaml`. Adding `allowed_skills` as a new field in that YAML is a minimal extension. The `PolicyEngine.evaluate()` already returns `PolicyResult(decision, reason, rule_matched, agent_id)` — the skill-check endpoint reuses that exact type. KubexRecord is currently an in-memory dataclass with no serialization; adding `asdict()`/`from_dict()` plus `json.dumps`/`json.loads` round-trip is the persistence path. The Docker SDK's `client.networks.list(filters={"label": "kubex.network=internal"})` call replaces `os.environ.get("KUBEX_DOCKER_NETWORK", NETWORK_INTERNAL)`.

**Primary recommendation:** Implement in plan order — red tests first, then implementation, then regression. Every new class (ConfigBuilder, KubexRecordStore) must be unit-testable with zero Docker daemon or Redis daemon dependency (use mocks/fakeredis). The spawn pipeline's atomic rollback is the highest-risk piece: test the failure paths explicitly, not just the happy path.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### ConfigBuilder Merge Rules
- Skills are model-agnostic — model choice comes exclusively from agent config, never from skill manifests
- Resource limits come from agent config — skills do not declare hardware requirements
- Skills provide: capabilities, dependencies, tools, egress domains
- Agent config provides: identity, model, resources, policy, budget, overrides — everything else
- Egress domains: union from all skills, but the build process performs conflict validation
- Conflicts fail the spawn — ConfigBuilder raises an error listing all conflicts; operator must fix agent config or skill manifests before spawning
- Output is a config.yaml file written to disk — persistent directory so configs can be reused for respawn/duplication
- ConfigBuilder merges tools into config.yaml — tools from all skills are namespaced and written into the config; harness reads tools from config, not from skill directories
- Tool existence validated — ConfigBuilder checks that each declared tool has a corresponding Python file in the skill's tools/ directory; missing tool = spawn fails
- Agent config can override skill fields — an 'overrides' section in agent config can modify skill contributions for fine-tuning without editing skill manifests

#### Skill-check API Contract
- Caller: Manager only — called as part of the spawn pipeline before container creation
- Check scope: Allowlist check only — Gateway maintains an `allowed_skills` field in agent policy YAML (`agents/{agent_id}/policies/policy.yaml`)
- Not-on-allowlist behavior: ESCALATE — consistent with policy philosophy ("not explicitly allowed = review, not hard deny"); reviewer can approve novel skill assignments
- Response format: Same as existing action-gating endpoints (PolicyResult with ALLOW/DENY/ESCALATE + reason)

#### Redis State Persistence
- Redis is source of truth — Manager persists KubexRecords to Redis on every state change; on restart, load all records from Redis
- Orphaned Docker containers are ignored — Manager only manages containers it knows about from Redis; unknown containers are not adopted
- Full config stored in Redis — each KubexRecord includes the entire agent config + composed skill set for respawn capability
- No TTL — records persist until explicitly removed via DELETE /kubexes/{id}; operator controls cleanup
- Runtime deps tracked in Redis state — each KubexRecord includes a list of runtime-installed packages for debugging and auditing

#### Runtime Dependency Request Flow
- New action type: install_dependency — agent sends ActionRequest with action=install_dependency, parameters={package, type}; Gateway evaluates through policy engine
- Manager executes via Docker exec — Gateway approves, then calls Manager API directly (POST /kubexes/{id}/install-dep); Manager runs docker exec inside the container
- Pip only for runtime installs — start with pip packages only; system packages via apt at boot only
- Pip + named CLI tools supported — support both pip packages AND a curated set of CLI tools (ffmpeg, git, curl, etc.) that Manager can install; all policy-gated
- Boot-time deps from config.yaml are trusted — no policy gate during initial setup; "it came from config.yaml" = sufficient trust
- Reviewer-approved packages auto-added to config — when reviewer approves a runtime dep, it gets added to the persistent config.yaml for future boots
- Hard package blocklist — Gateway maintains a blocklist of forbidden packages in policies/global.yaml; blocked = DENY, never ESCALATE
- Soft install limit — exceeding a configurable per-agent limit triggers ESCALATE to human, not hard deny
- Exit code verification only — Manager checks docker exec exit code; 0 = success, non-zero = report failure

#### Dynamic Network Resolution
- Docker label lookup — Manager searches for Docker networks with label `kubex.network=internal`; works regardless of Compose project name prefix
- Fail startup if not found — Manager refuses to start without a labeled network; clear error message with setup instructions
- Look up every container create — resolve network name on each call, not cached at startup; handles dynamic network changes
- docker-compose.yml updated — add `labels: kubex.network: internal` to the network definition
- Network only for now — only network resolution by label; volumes and other resources stay as-is

#### Spawn Pipeline
- Pipeline order: (1) Validate agent config → (2) SkillResolver.resolve() → (3) ConfigBuilder.build() → (4) POST /policy/skill-check → (5) Write config.yaml to disk → (6) Create Docker container → (7) Persist to Redis → (8) Return
- Full rollback on failure — if any step fails, clean up all artifacts from earlier steps (delete config.yaml, remove Docker container, etc.)
- Atomic — all or nothing — spawn either fully succeeds or fully rolls back; no partial state, no resumable steps
- Auto-start after creation — POST /kubexes creates AND starts the container in one call; separate start_kubex call becomes optional

#### Manager API Extensions
- POST /kubexes/{id}/respawn — kills current container and creates a new one using the same persisted config
- POST /kubexes/{id}/install-dep — installs a package in a running container (called by Gateway after policy approval)
- GET /kubexes/{id}/config — returns the full merged config.yaml content for debugging/auditing
- GET /configs — lists saved config.yaml files with metadata (agent_id, skills, created_at) for browsing/respawn
- Enriched GET /kubexes responses — existing responses include new fields: skill list, config path, runtime deps, composed capabilities
- No separate /deps endpoint — boot deps visible in config endpoint, runtime deps in Redis state record

### Claude's Discretion
- Persistent config directory path on host
- Redis key naming scheme for KubexRecords
- Package blocklist seed contents
- Exact label key/value for Docker network
- install_dependency ActionType enum value
- Soft limit default value

### Deferred Ideas (OUT OF SCOPE)
- System packages (apt) for runtime install — Phase 6 does pip only at runtime; apt packages only at boot via config.yaml
- Volume resolution by Docker labels — only network uses label lookup for now
- Resumable spawn pipeline — atomic for now; resumable is more complex and not needed yet
- Config versioning / diff between saved configs — useful for auditing config drift
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KMGR-01 | SkillResolver maps agent config to skill file set + dependency list | Existing `SkillResolver.resolve(skill_names, skill_dir)` takes a flat list; needs to accept `AgentConfig` or dict with skills field; `ComposedSkillSet` already produced by `_compose()` |
| KMGR-02 | ConfigBuilder assembles full container create params from agent config | New class; consumes `AgentConfig` + `ComposedSkillSet`; outputs config.yaml dict and writes to persistent dir; tool existence check against skill `tools/` directories |
| KMGR-03 | Dynamic bind-mount injection in `create_kubex()` for skills and config | `lifecycle.py:create_kubex()` already has `volumes` dict construction; extend to mount config.yaml at `/app/config.yaml` and skill dirs via `skill_mounts` (already partially wired via SKIL-02) |
| KMGR-04 | Redis-backed state persistence (Manager survives restarts without orphaning agents) | `KubexRecord` is a plain dataclass; needs `to_dict()`/`from_dict()` methods; `KubexLifecycle._kubexes` dict needs write-through to Redis on every state mutation |
| KMGR-05 | Dynamic Docker network name resolution from labels | Replace `os.environ.get("KUBEX_DOCKER_NETWORK", NETWORK_INTERNAL)` in `lifecycle.py:217`; use `docker.networks.list(filters={"label": "kubex.network=internal"})[0].name` |
| PSEC-01 | Boot-time dependencies from config are trusted (no policy gate during initial setup) | Already the design intent; confirm config.yaml boot deps flow never touches `POST /actions`; entrypoint.sh installs directly — verify no policy call in boot path |
| PSEC-02 | Runtime dependency requests (post-boot) go through approve/deny/ESCALATE pipeline | New `install_dependency` ActionType in `kubex_common/schemas/actions.py`; Gateway routes to new handler; Manager `/install-dep` endpoint executes docker exec; blocklist in `policies/global.yaml` |
| PSEC-03 | POST /policy/skill-check Gateway endpoint for skill assignment validation | New route in `gateway/main.py`; reads `allowed_skills` from `agents/{agent_id}/policies/policy.yaml` via extended `PolicyLoader`/`AgentPolicy`; returns `PolicyResult` JSON matching existing action-gate format |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| docker SDK (Python) | already in pyproject.toml | Docker network label lookup, container exec | Already used in lifecycle.py; `client.networks.list(filters={...})` and `container.exec_run(...)` are the target calls |
| pydantic | already pinned | KubexRecord serialization via `.model_dump()` / `.model_validate()` | Used everywhere; convert KubexRecord from dataclass to Pydantic model for free JSON round-trip |
| fakeredis | already in test deps | In-memory Redis for unit tests | Established pattern in `test_redis_integration.py` |
| pytest | required (CLAUDE.md) | Test framework | Project-wide standard |
| yaml (PyYAML) | already in deps | config.yaml write/read | Used in all services |
| httpx | already in deps | Manager calling Gateway `POST /policy/skill-check` | Already used for registry and reviewer HTTP calls |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dataclasses.asdict | stdlib | Serialize KubexRecord to dict for Redis | If staying as dataclass; prefer Pydantic model_dump instead |
| pathlib.Path | stdlib | Config directory and tool existence checks | Already used throughout |
| json | stdlib | Redis value storage (json.dumps/loads) | Standard pattern for Redis string storage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pydantic model for KubexRecord | Stay as dataclass + asdict | Pydantic gives free validation and `.model_dump(mode="json")` handles datetime/enum serialization; dataclass requires manual serializers |
| Per-call network label lookup | Cache at startup | Per-call is the locked decision; simpler code, handles dynamic network changes |
| Global `allowed_skills` list | Separate skills policy file | Extending existing `policy.yaml` schema is less fragmentation |

**Installation:** No new packages required. All dependencies are already present in pyproject.toml files.

---

## Architecture Patterns

### Recommended Project Structure (new files)

```
services/kubex-manager/kubex_manager/
├── config_builder.py      # NEW: ConfigBuilder class
├── redis_store.py         # NEW: KubexRecordStore (Redis persistence)
├── lifecycle.py           # EXTEND: spawn pipeline, network label lookup, install_dep
├── skill_resolver.py      # EXTEND: accept AgentConfig dict, not just skill_names list
└── main.py                # EXTEND: new endpoints (respawn, install-dep, config, configs)

services/gateway/gateway/
└── main.py                # EXTEND: POST /policy/skill-check endpoint

libs/kubex-common/kubex_common/schemas/
├── actions.py             # EXTEND: add INSTALL_DEPENDENCY to ActionType enum
└── config.py              # EXTEND: add allowed_skills to AgentPolicy schema

policies/global.yaml       # EXTEND: add package_blocklist section
agents/{id}/policies/policy.yaml  # EXTEND: add allowed_skills field per agent
docker-compose.yml         # EXTEND: add kubex.network=internal label to network
```

### Pattern 1: ConfigBuilder

**What:** A pure-Python class that takes an `AgentConfig` dict and a `ComposedSkillSet`, validates constraints (tool existence, no conflicts), then produces a merged config.yaml dict and writes it to a persistent host directory.

**When to use:** Step 3 in the spawn pipeline — after SkillResolver resolves skills and before the Gateway skill-check call.

**Key design:**
```python
# Source: design from 06-CONTEXT.md
class ConfigBuilder:
    def build(
        self,
        agent_config: dict,
        composed: ComposedSkillSet,
        skill_dir: Path,
        output_dir: Path,
    ) -> Path:
        """Merge and write config.yaml. Returns path to written file.
        Raises ConfigBuildError on conflict or missing tool file."""
        ...

class ConfigBuildError(Exception):
    """Raised when config assembly fails (conflict, missing tool, etc.)"""
```

The output config.yaml must include:
- Agent identity fields from agent_config (id, boundary, model, budget, policy, providers)
- Capabilities: union from composed.capabilities
- Tools: all composed.tools, namespaced as `{skill}.{tool}`
- Dependencies: composed.pip_deps + composed.system_deps (boot-time trusted list)
- Egress domains: union from composed.egress_domains (after conflict check)
- Skills list: ordered skill names
- Agent config overrides applied last

### Pattern 2: KubexRecord Redis Persistence

**What:** Write-through store — every time `_kubexes[id]` is mutated, serialize and push to Redis. On startup, load all keys matching prefix and hydrate in-memory dict.

**Key design points:**
- Redis key: `kubex:record:{kubex_id}` (recommended — Claude's discretion per CONTEXT.md)
- Value: `json.dumps(record.to_dict())` — must be JSON-safe (no Python objects)
- KubexRecord must grow: `skills`, `config_path`, `runtime_deps`, `composed_capabilities` fields
- On startup: `redis.scan_iter("kubex:record:*")` to load all existing records
- No TTL — records persist until explicit DELETE

```python
# Pattern for Redis round-trip (no external deps needed)
class KubexRecord:
    ...
    def to_dict(self) -> dict:
        return {
            "kubex_id": self.kubex_id,
            "agent_id": self.agent_id,
            "container_id": self.container_id,
            "status": self.status,
            "config": self.config,
            "image": self.image,
            "boundary": self.boundary,
            "skills": self.skills,
            "config_path": str(self.config_path) if self.config_path else None,
            "runtime_deps": self.runtime_deps,
            "composed_capabilities": self.composed_capabilities,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "KubexRecord":
        return cls(**data)
```

### Pattern 3: Docker Network Label Lookup

**What:** Replace the hardcoded `KUBEX_DOCKER_NETWORK` env var with a live Docker SDK label query on every container create call.

**Key design:**
```python
# Source: Docker SDK docs — client.networks.list(filters=...)
def _resolve_internal_network(self, docker_client) -> str:
    """Find the kubex internal network by label.

    Raises RuntimeError if no labeled network found.
    """
    networks = docker_client.networks.list(
        filters={"label": "kubex.network=internal"}
    )
    if not networks:
        raise RuntimeError(
            "No Docker network with label 'kubex.network=internal' found. "
            "Add 'labels: kubex.network: internal' to your network definition "
            "in docker-compose.yml and restart."
        )
    return networks[0].name
```

This call replaces line 222 in `lifecycle.py`:
```python
# Before:
network=os.environ.get("KUBEX_DOCKER_NETWORK", NETWORK_INTERNAL),
# After:
network=self._resolve_internal_network(docker_client),
```

### Pattern 4: POST /policy/skill-check Gateway Endpoint

**What:** New FastAPI route on Gateway. Accepts `{agent_id, skills: [str]}`. Checks each skill against `allowed_skills` in the agent's policy YAML. Returns PolicyResult JSON identical to existing action-gate responses.

**Key integration points:**
- `PolicyLoader.get_agent_policy(agent_id)` already loads the per-agent YAML
- `AgentPolicy` dataclass (in `gateway/policy.py`) needs `allowed_skills: list[str]` field added
- The YAML key goes in `agents/{agent_id}/policies/policy.yaml` under `agent_policy:` → `allowed_skills:`
- Response format already established: `{"decision": "ALLOW"|"DENY"|"ESCALATE", "reason": "...", "rule_matched": "..."}`

```python
# New route in gateway/main.py
class SkillCheckRequest(BaseModel):
    agent_id: str
    skills: list[str]

@router.post("/policy/skill-check")
async def check_skill_assignment(body: SkillCheckRequest, request: Request) -> JSONResponse:
    gateway: GatewayService = request.app.state.gateway_service
    agent_policy = gateway.policy_loader.get_agent_policy(body.agent_id)

    for skill in body.skills:
        if agent_policy is None or not agent_policy.allowed_skills:
            # No allowlist defined — ESCALATE (not explicitly allowed)
            return PolicyResult(decision=ESCALATE, reason=f"No skill allowlist for agent '{body.agent_id}'", ...)
        if skill not in agent_policy.allowed_skills:
            return PolicyResult(decision=ESCALATE, reason=f"Skill '{skill}' not in allowlist", ...)

    return PolicyResult(decision=ALLOW, reason="All skills on allowlist", ...)
```

### Pattern 5: install_dependency Action Flow

**What:** Agent sends `ActionRequest(action="install_dependency", parameters={"package": "pandas", "type": "pip"})`. Gateway policy-gates it (blocklist DENY, soft limit ESCALATE, otherwise ALLOW/reviewer). On approval, Gateway calls `POST /kubexes/{id}/install-dep` on Manager. Manager runs `container.exec_run(["pip", "install", package])` and checks exit code.

**New enum value:**
```python
# In kubex_common/schemas/actions.py ActionType enum
INSTALL_DEPENDENCY = "install_dependency"
```

**Package blocklist in global.yaml:**
```yaml
global:
  package_blocklist:
    pip:
      - "paramiko"        # SSH — high-risk lateral movement
      - "pwntools"        # Exploit framework
      - "scapy"           # Packet crafting
      - "cryptography"    # Only pre-approved crypto
```

**Soft limit (Claude's discretion):** Default 10 runtime pip installs per kubex lifetime. Configurable per-agent.

### Pattern 6: Atomic Spawn Pipeline with Rollback

**What:** The full `create_kubex()` pipeline is wrapped in a try/except that tracks which steps completed and rolls them back on failure.

```python
# Rollback state tracking pattern
config_path: Path | None = None
container_id: str | None = None

try:
    # Step 1: validate config
    # Step 2: SkillResolver.resolve()
    # Step 3: ConfigBuilder.build() → config_path set here
    # Step 4: POST /policy/skill-check
    # Step 5: write config.yaml (done by step 3)
    # Step 6: docker create → container_id set here
    # Step 7: persist to Redis
    return record
except Exception:
    # Rollback in reverse order
    if container_id:
        _cleanup_container(docker_client, container_id)
    if config_path and config_path.exists():
        config_path.unlink(missing_ok=True)
    raise
```

### Anti-Patterns to Avoid

- **Caching network name at startup:** Must resolve per container-create call (locked decision). Do not store it in `__init__`.
- **Blocking async code in lifecycle methods:** `create_kubex()` is currently sync (Docker SDK is sync). Maintain this — do not make it async without considering thread pool implications.
- **Partial state on failure:** If Docker create succeeds but Redis persist fails, the container must be killed before raising. No partial records.
- **Fetching allowed_skills from policy at spawn time only:** The PolicyLoader is already initialized at Gateway startup and reloaded in `on_startup`. The skill-check endpoint reads from the already-loaded policy — no disk I/O per request.
- **Putting `allowed_skills` in global.yaml instead of per-agent policy:** The check scope is per-agent (locked decision). Global policy is for global blocks only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis JSON serialization | Custom serializer | `json.dumps` + `json.loads` on dataclass `to_dict()` | Simpler; Redis stores strings; no schema overhead |
| Docker network discovery | Parse compose file or use env var | `docker.networks.list(filters={"label": ...})` | SDK provides this; works across all Compose project names |
| YAML config file writing | String templates | `yaml.dump(config_dict)` | Already used everywhere; handles escaping correctly |
| Policy result type | New response dataclass | Reuse existing `PolicyResult` and `PolicyDecision` from `gateway/policy.py` | Identical response format required; don't duplicate |
| Container exec | Custom subprocess wrapper | `container.exec_run(cmd, demux=False)` | Docker SDK provides this; returns (exit_code, output) |
| Fakeredis for tests | Mock every Redis call | `fakeredis.aioredis.FakeRedis()` | Project already uses this pattern in integration tests |

**Key insight:** The entire codebase is brownfield. Before writing any new abstraction, verify whether an existing one in lifecycle.py, policy.py, or skill_resolver.py already solves 80% of the problem.

---

## Common Pitfalls

### Pitfall 1: KubexRecord Serialization — datetime and enum fields
**What goes wrong:** `json.dumps(dataclasses.asdict(record))` raises `TypeError` when `record` contains `datetime` objects or StrEnum values because `asdict()` recurses into nested dataclasses but doesn't handle non-JSON types.
**Why it happens:** `KubexState` is a `StrEnum` (already JSON-safe as string), but if any timestamp field is added to `KubexRecord` it will fail. Additionally, `config: dict[str, Any]` may contain non-JSON-serializable objects.
**How to avoid:** Use `json.dumps(record.to_dict())` with an explicit `to_dict()` that stringifies any edge cases, or convert `KubexRecord` to a Pydantic model and use `model.model_dump(mode="json")`.
**Warning signs:** `TypeError: Object of type X is not JSON serializable` in Redis write path during tests.

### Pitfall 2: Docker SDK `networks.list()` Returns Empty on Startup
**What goes wrong:** Manager starts, calls `_resolve_internal_network()`, gets empty list because the Docker network exists but the label hasn't been added to `docker-compose.yml` yet, or Compose hasn't been restarted after adding the label.
**Why it happens:** Docker label changes in `docker-compose.yml` require `docker compose down && docker compose up` — existing networks don't get labels added retroactively.
**How to avoid:** The startup check (fail fast if no labeled network) catches this. Document the label requirement in the error message. Unit tests must mock `docker_client.networks.list()` to return a mock network — don't let the test fail due to Docker not being available.
**Warning signs:** `RuntimeError: No Docker network with label 'kubex.network=internal' found` in integration environment.

### Pitfall 3: Spawn Pipeline Rollback — Container Created But Not Removed
**What goes wrong:** Redis persist step fails after Docker container is created. If rollback code doesn't call `container.remove(force=True)`, the container is orphaned.
**Why it happens:** Docker SDK `containers.create()` returns before the container starts — it's in "created" state. Calling `container.remove(force=True)` on a "created" container works fine.
**How to avoid:** Track `container_id` before committing to Redis. In the except block, always attempt container removal if `container_id` is set. Wrap the remove call in its own try/except to prevent rollback failure masking the original error.
**Warning signs:** Zombie containers visible in `docker ps -a` with "created" status after failed spawns.

### Pitfall 4: skill-check Endpoint — Agent Without a Policy File
**What goes wrong:** A new agent is being spawned for the first time. No `agents/{agent_id}/policies/policy.yaml` exists yet. `PolicyLoader.get_agent_policy(agent_id)` returns `None`. The skill-check endpoint must decide: ALLOW (no policy = no restriction) or ESCALATE (no policy = unreviewed).
**Why it happens:** The locked decision is "not explicitly allowed = ESCALATE" (consistent with policy philosophy). An agent with no policy file has no allowlist, so every skill assignment should ESCALATE.
**How to avoid:** In the skill-check endpoint, explicitly handle `agent_policy is None` as an ESCALATE case with a clear reason: "No policy file found for agent — skill assignment requires reviewer approval."
**Warning signs:** New agents silently get ALLOW decisions before any policy file exists.

### Pitfall 5: ConfigBuilder Tool Existence Check — Nested Skill Dir Structure
**What goes wrong:** Skills are in `skills/{category}/{skill-name}/` on disk (e.g., `skills/data-collection/web-scraping/`). But SkillResolver currently takes a flat skill name list and looks up `skill_dir / skill_name`. The category subdirectory means the tool existence check path needs to be aware of the category prefix.
**Why it happens:** Current skill directory structure uses category subdirs (confirmed in codebase: `skills/data-collection/web-scraping/`, `skills/dispatch/task-management/`). SkillResolver currently receives `skill_dir=/app/skills` and skill names like `"web-scraping"` — but `web-scraping` is not a direct child of `/app/skills`, it's `data-collection/web-scraping`.
**How to avoid:** When extending SkillResolver to accept AgentConfig, resolve skill paths by searching for the skill name in category subdirectories, or require fully-qualified skill names (`category/skill-name`) in agent config. The current `skill_dir / skill_name` pattern works if `KUBEX_SKILLS_PATH` points directly to a flat skill directory or if skill names include the category prefix. Verify against the existing working tests in `test_skill_resolver.py`.
**Warning signs:** `SkillResolutionError: Skill directory not found` despite the skill existing under a category subdir.

### Pitfall 6: Redis Write-Through — Async Manager with Sync Docker SDK
**What goes wrong:** `KubexLifecycle.create_kubex()` is a sync method (Docker SDK is sync). Redis write is async (`await redis.set(...)`). Mixing sync and async in `create_kubex()` requires careful handling.
**Why it happens:** The existing lifecycle methods are split: `create_kubex()` is sync, `start_kubex()` / `stop_kubex()` are async. Redis persistence on create needs to be triggered from the sync `create_kubex()` — but `await` can't be called from sync context.
**How to avoid:** Make `create_kubex()` async (it's only called from the async FastAPI handler anyway), or persist to Redis in the async HTTP handler after `create_kubex()` returns (same pattern as current lifecycle event publishing in `main.py:144-147`). The latter is cleaner: keep Docker SDK calls sync in a sync method, do Redis I/O in the async handler.
**Warning signs:** `RuntimeError: no running event loop` or `SyntaxError: 'await' outside function` when running the sync lifecycle method.

---

## Code Examples

Verified patterns from existing code:

### Existing Redis connection in Manager
```python
# Source: services/kubex-manager/kubex_manager/main.py:328-329
async def on_startup(self) -> None:
    if self.redis:
        self.app.state.lifecycle._redis = self.redis.client
```
The Redis client is attached to `KubexLifecycle` on startup. The same pattern applies for the KubexRecordStore.

### Existing Docker SDK containers.create() call
```python
# Source: services/kubex-manager/kubex_manager/lifecycle.py:218-226
container = docker_client.containers.create(
    image=request.image,
    labels=labels,
    environment=env,
    network=os.environ.get("KUBEX_DOCKER_NETWORK", NETWORK_INTERNAL),  # ← replace this
    mem_limit=mem_limit,
    nano_cpus=nano_cpus,
    volumes=volumes,
    detach=True,
)
```

### Existing Docker SDK network filter pattern
```python
# Docker SDK — networks.list with filters (HIGH confidence from Docker SDK docs)
networks = docker_client.networks.list(filters={"label": "kubex.network=internal"})
if networks:
    network_name = networks[0].name  # e.g., "openclaw_kubex-internal"
```

### Existing PolicyResult format used in action-gate responses
```python
# Source: services/gateway/gateway/policy.py:46-53
@dataclass
class PolicyResult:
    decision: PolicyDecision   # "allow" | "deny" | "escalate"
    reason: str
    rule_matched: str | None = None
    agent_id: str | None = None
```
The skill-check endpoint returns this exact type serialized as JSON.

### Existing ESCALATE pattern in action policy check
```python
# Source: services/gateway/gateway/policy.py:282-291
if agent_policy.allowed_actions and action_str not in agent_policy.allowed_actions:
    if action_str not in agent_policy.blocked_actions:
        return PolicyResult(
            decision=PolicyDecision.ESCALATE,
            reason=f"Action '{action_str}' is not in agent's allowed actions list...",
            rule_matched="agent.actions.escalate",
            agent_id=request.agent_id,
        )
```
The `allowed_skills` check follows the same structure: not on list → ESCALATE with `rule_matched="agent.skills.escalate"`.

### Existing mock Docker pattern in tests
```python
# Source: tests/unit/test_kubex_manager_unit.py:57-65
def make_mock_docker() -> tuple[MagicMock, MagicMock]:
    mock_container = MagicMock()
    mock_container.id = "deadbeef001"
    mock_container.status = "created"
    mock_docker = MagicMock()
    mock_docker.containers.create.return_value = mock_container
    mock_docker.containers.get.return_value = mock_container
    return mock_docker, mock_container
```
Extend this to also mock `mock_docker.networks.list.return_value = [mock_network]` for KMGR-05 tests.

### AgentPolicy YAML structure (current)
```yaml
# Source: agents/orchestrator/policies/policy.yaml
agent_policy:
  actions:
    allowed:
      - "dispatch_task"
      - ...
    blocked:
      - "http_get"
      - ...
  egress:
    mode: "deny_all"
  budget:
    per_task_token_limit: 50000
```
The `allowed_skills` field will go at the `agent_policy:` level:
```yaml
agent_policy:
  allowed_skills:
    - "task-management"
    - "recall"
  actions:
    allowed: [...]
```

### ConfigBuilder output config.yaml structure
```yaml
# ConfigBuilder output (to be written to persistent dir, e.g., /app/configs/{agent_id}.yaml)
agent:
  id: "my-agent"
  boundary: "default"
  model: "gpt-5.2"           # from agent_config, not skills
  capabilities:              # union from ComposedSkillSet
    - "scrape_web"
    - "recall"
  tools:                     # namespaced from all skills
    web-scraping.scrape_profile:
      description: "..."
      parameters: {...}
  dependencies:              # trusted boot-time deps
    pip:
      - "requests>=2.31"
      - "beautifulsoup4"
    system: []
  egress_domains:            # union from all skills
    - "instagram.com"
  skills:                    # ordered skill names
    - "web-scraping"
    - "recall"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `KUBEX_DOCKER_NETWORK` env var | Docker label lookup per container create | Phase 6 | Manager works with any Compose project prefix |
| In-memory only `_kubexes` dict | Redis write-through | Phase 6 | Manager restart doesn't orphan running agents |
| `POST /kubexes` with `skill_mounts` list | Full spawn pipeline with ConfigBuilder + policy gate | Phase 6 | Spawn is validated, composed, policy-approved before Docker create |
| `SkillResolver.resolve(skill_names, skill_dir)` | `SkillResolver.resolve(agent_config)` | Phase 6 | Agent config is the source of truth; skills extracted from config |

**Deprecated/outdated:**
- `KUBEX_DOCKER_NETWORK` env var: Will be removed from `docker-compose.yml` env block for kubex-manager; the label on the network replaces it
- `NETWORK_INTERNAL` constant usage in `lifecycle.py`: Will be removed at line 222; the constant itself stays in `kubex_common/constants.py` for reference/documentation purposes

---

## Open Questions

1. **Skill directory path — flat vs. category-nested**
   - What we know: Skills on disk are at `skills/{category}/{skill-name}/` (e.g., `skills/data-collection/web-scraping/`). SkillResolver currently uses `skill_dir / skill_name` which would resolve to `skills/data-collection` not `skills/data-collection/web-scraping`.
   - What's unclear: Whether agent configs reference skills by flat name (`"web-scraping"`) or category-qualified name (`"data-collection/web-scraping"`). The existing orchestrator `config.yaml` uses flat names like `"dispatch_task"`, `"recall"` — but those aren't actual disk directories.
   - Recommendation: In the red-test plan, write a test with the actual skill directory structure and assert SkillResolver finds it. If the current lookup fails, the fix is either: (a) search category subdirs for matching skill name, or (b) require `category/skill-name` format. Either is valid; choose based on what makes agent configs most readable.

2. **Redis DB number for KubexRecords**
   - What we know: DB3 is `REDIS_DB_LIFECYCLE` (lifecycle events stream). KubexRecords are manager state, not lifecycle events.
   - What's unclear: Whether KubexRecords should go in DB3 (alongside lifecycle events, since Manager already has that connection) or a new DB.
   - Recommendation: Store KubexRecords in DB3 (same connection Manager already uses). They're manager-owned data. Add a comment distinguishing the stream key prefix (`kubex:lifecycle`) from the record key prefix (`kubex:record:`).

3. **Persistent config directory — host path and container path**
   - What we know: ConfigBuilder writes config.yaml to a persistent host directory; the path is Claude's discretion.
   - Recommendation: Host path `/app/configs/` (bind-mounted into kubex-manager container). Container agents receive their config at `/app/config.yaml` (single file, not the configs dir). The Manager volume mount would be `./configs:/app/configs` in docker-compose.yml, and each agent's config is written to `/app/configs/{kubex_id}.yaml` on the host. When spawning, the specific config file is bind-mounted into the agent container at `/app/config.yaml`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (required by CLAUDE.md) |
| Config file | `pyproject.toml` (root-level, existing) |
| Quick run command | `python -m pytest tests/unit/ -x --tb=short -q` |
| Full suite command | `python -m pytest tests/ --tb=short -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KMGR-01 | SkillResolver.resolve(agent_config) returns ComposedSkillSet | unit | `python -m pytest tests/unit/test_skill_resolver.py -x -q` | ✅ (extend existing) |
| KMGR-02 | ConfigBuilder.build() produces valid config.yaml, validates tool existence, raises on conflicts | unit | `python -m pytest tests/unit/test_config_builder.py -x -q` | ❌ Wave 0 |
| KMGR-03 | create_kubex() mounts config.yaml at /app/config.yaml in volumes dict | unit | `python -m pytest tests/unit/test_kubex_manager_unit.py -x -q` | ✅ (extend existing) |
| KMGR-04 | KubexRecord persists to Redis on create/state-change; recovered on Manager restart | unit + integration | `python -m pytest tests/unit/test_kubex_manager_unit.py tests/integration/test_redis_integration.py -x -q` | ✅ (extend existing) |
| KMGR-05 | _resolve_internal_network() uses docker.networks.list(filters={"label": "kubex.network=internal"}) | unit | `python -m pytest tests/unit/test_kubex_manager_unit.py -x -q` | ✅ (extend existing) |
| PSEC-01 | Boot deps (config.yaml) install without policy gate; no /actions call in boot path | unit | `python -m pytest tests/unit/test_harness_unit.py -x -q` | ✅ (extend existing) |
| PSEC-02 | install_dependency action → Gateway policy gate → Manager exec; blocklist DENY; soft limit ESCALATE | unit + integration | `python -m pytest tests/unit/test_gateway_policy.py tests/integration/ -x -q` | ✅ (extend existing) |
| PSEC-03 | POST /policy/skill-check returns ALLOW for allowlisted skills, ESCALATE otherwise | unit | `python -m pytest tests/unit/test_gateway_endpoints.py -x -q` | ✅ (extend existing) |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/unit/ -x --tb=short -q`
- **Per wave merge:** `python -m pytest tests/ --tb=short -q`
- **Phase gate:** Full suite green (currently 819 collected) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test_config_builder.py` — covers KMGR-02 (ConfigBuilder unit tests with tmp_path fixtures)

*(All other test files exist and need extension, not creation from scratch)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `services/kubex-manager/kubex_manager/lifecycle.py` — KubexLifecycle, CreateKubexRequest, KubexRecord
- Direct code inspection: `services/kubex-manager/kubex_manager/skill_resolver.py` — SkillResolver, ComposedSkillSet
- Direct code inspection: `services/gateway/gateway/policy.py` — PolicyEngine, PolicyLoader, PolicyResult, AgentPolicy
- Direct code inspection: `services/gateway/gateway/main.py` — existing endpoint patterns, GatewayService
- Direct code inspection: `libs/kubex-common/kubex_common/schemas/actions.py` — ActionType enum
- Direct code inspection: `libs/kubex-common/kubex_common/schemas/config.py` — AgentConfig, SkillManifest, AgentPolicy
- Direct code inspection: `libs/kubex-common/kubex_common/constants.py` — NETWORK_INTERNAL, Redis DB assignments
- Direct code inspection: `docker-compose.yml` — current network definitions (no labels yet)
- Direct code inspection: `tests/unit/test_kubex_manager_unit.py` — mock Docker patterns
- Direct code inspection: `agents/orchestrator/policies/policy.yaml` — current policy YAML structure
- Direct code inspection: `skills/data-collection/web-scraping/skill.yaml` — skill on-disk structure
- `.planning/phases/06-manager-spawn-policy-gates/06-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- Docker SDK Python docs: `docker.DockerClient.networks.list(filters={"label": "..."})` — standard Docker SDK filtering pattern
- fakeredis library: Used in `tests/integration/test_redis_integration.py` — established project test pattern

### Tertiary (LOW confidence)
- None — all critical claims verified against project source code

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, versions confirmed via pyproject.toml
- Architecture: HIGH — all patterns derived from existing code in the same codebase
- Pitfalls: HIGH — derived from direct inspection of the code that will be modified
- Test map: HIGH — existing test file paths confirmed via directory listing

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable brownfield codebase; no fast-moving external dependencies introduced)
