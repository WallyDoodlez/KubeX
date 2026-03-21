# Phase 7: Agent Migration and Dockerfile Removal - Research

**Researched:** 2026-03-16
**Domain:** Docker Compose migration, harness config refactor, skill directory creation, test suite migration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Orchestrator Migration Strategy**
- Rename skills to match skill directories — update orchestrator config.yaml to reference actual skill directory names (not action names like "dispatch_task")
- Dependencies come from skill manifests — each orchestrator skill's manifest.yaml declares pip deps; ConfigBuilder unions them; entrypoint.sh installs at boot
- Move tools to skill directories — orchestrator's 8 tools become tool implementations inside skill directories; harness discovers from config.yaml
- Prompt moves to SKILL.md — orchestrator's system prompt moves from config.yaml prompt field to skills/orchestration/task-management/SKILL.md
- Skill directory: skills/orchestration/task-management/ — new "orchestration" category; contains all 8 tools, manifest, and SKILL.md as one monolithic skill
- MCP bridge code moves to skill — httpx Gateway client moves to orchestration skill's tools/ directory; any agent with the orchestration skill gets MCP bridge
- Agent dir keeps config.yaml + policies/policy.yaml — current structure preserved, just no Dockerfile

**Reviewer Agent Scope**
- Include reviewer in Phase 7 — migrate all 4 agents (not just the 3 in MIGR-01..03); complete the stem cell vision in one phase
- Model from reviewer's config.yaml — o3-mini is set in agents/reviewer/config.yaml; consistent with Phase 6 decision
- Reviewer gets a skill directory — skills/security/review/ with SKILL.md (reviewer prompt), manifest.yaml (capabilities: security_review)
- Migration is straightforward — reviewer already FROM kubexclaw-base; just delete Dockerfile, ensure config.yaml + skill dir cover everything

**StandaloneConfig Removal**
- Require config.yaml always — harness fails fast if no /app/config.yaml; no fallback to env vars
- Remove StandaloneConfig completely — delete the class entirely; clean break, no legacy code
- Fixed path /app/config.yaml — no env var for config path; always reads from /app/config.yaml inside the container
- Minimum valid config: agent.id + model required, rest optional — capabilities, skills, tools default to empty
- No env var overrides — config.yaml is the sole source of truth; no KUBEX_AGENT_ID or GATEWAY_URL env var overrides; mount a different file for different config

**docker-compose.yml Restructure**
- Keep agents as Compose services — each agent stays as a named service with image: kubexclaw-base + volume mounts
- Mount only needed skill dirs — each agent lists specific skill mounts (e.g., `./skills/data-collection/web-scraping:/app/skills/web-scraping:ro`)
- Config bind-mounted from agent dir — `./agents/orchestrator/config.yaml:/app/config.yaml:ro`
- Tests don't use Compose — tests use mocks/fakeredis, not real containers; docker-compose.test.yml is for manual integration testing only
- Build base first via depends_on — add kubexclaw-base build service in docker-compose.yml; agent services depend on it
- Keep current directory structure — agents/orchestrator/ contains config.yaml + policies/policy.yaml; no Dockerfile

**Dockerfile Deletion Safety**
- Delete in same commit — update compose + delete Dockerfiles in one atomic commit; tests prove it works; revert if tests fail
- All-or-nothing — either all 4 agents migrate or none do; no partial migration

**New Agent Spawn Experience**
- Manager API spawns — operator creates skill dir + config.yaml, calls Manager API POST /kubexes with config; no compose changes needed for dynamic agents
- Include hello-world E2E test — E2E test creates minimal skill + config, calls Manager API, verifies agent boots; proves stem cell promise
- Commit hello-world as template — skills/examples/hello-world/ + agents/hello-world/config.yaml committed as reference

**Test Migration Strategy**
- Separate migration plan — dedicated plan just for test migration; clean separation from red/green plans
- One batch via conftest fixture — session-scoped conftest.py fixture generates default config.yaml for all tests; tests that need custom config override the fixture
- Write real file to tmp_path — fixture creates actual config.yaml in tmp_path; monkeypatches config path to point there; exercises real file-reading code path

### Claude's Discretion
- Exact conftest fixture implementation details
- Which env vars to remove from docker-compose.yml agent services
- Ordering of skill tool files within orchestration skill directory
- Hello-world agent skill content and manifest details
- Test migration plan ordering within the phase

### Deferred Ideas (OUT OF SCOPE)
- Dynamic agent spawning via Manager API without Compose — works today (Phase 6), but standard fleet stays in Compose for now
- Per-agent resource limits in Compose — resource limits come from agent config, not Compose; can add later
- Skill scaffolding CLI (kclaw skill create) — v2 requirement (SKIL-06)
- Health check endpoint in base image — v2 requirement (BASE-05)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MIGR-01 | Orchestrator agent migrated to `kubexclaw-base` | Orchestrator Dockerfile is FROM python:3.12-slim — needs full conversion; orchestrator_loop.py uses StandaloneConfig; tools must move to skills/orchestration/task-management/tools/ |
| MIGR-02 | Instagram-scraper agent migrated to `kubexclaw-base` | Already FROM kubexclaw-base; migration is config.yaml update + Dockerfile deletion + skill mount in Compose |
| MIGR-03 | Knowledge agent migrated to `kubexclaw-base` | Already FROM kubexclaw-base; same pattern as MIGR-02 |
| MIGR-04 | Per-agent Dockerfiles removed after migration proven | All 4 agent Dockerfiles deleted in one atomic commit after tests pass |
| MIGR-05 | All 703+ existing tests pass against refactored agents | StandaloneConfig removal will break tests that mock/use it; conftest fixture handles migration; orchestrator_loop.py tests must be updated |
</phase_requirements>

---

## Summary

Phase 7 is a refactoring migration: all four agent Dockerfiles are deleted and replaced by `kubexclaw-base` with bind-mounted config.yaml and skill directories. The core infrastructure (base image, entrypoint.sh, harness, ConfigBuilder, SkillResolver) is already complete from Phases 5 and 6. This phase completes the "stem cell" promise.

The hardest parts are:
1. **Orchestrator migration** — its Dockerfile is FROM python:3.12-slim (not kubexclaw-base), its loop runs `orchestrator_loop.py` directly (not `python -m kubex_harness.main`), and it embeds tools, system prompt, and dependencies inline rather than in skill directories.
2. **StandaloneConfig removal** — `test_config_loader.py::TestEnvVarFallback` and `test_orchestrator_loop.py` use env-var-based initialization that will break when StandaloneConfig is removed; a conftest fixture strategy is required.
3. **Creating new skill directories** — `skills/orchestration/task-management/`, `skills/security/review/`, and `skills/examples/hello-world/` do not yet exist.

The three simple agents (instagram-scraper, knowledge, reviewer) are already FROM kubexclaw-base and have thin Dockerfiles that just COPY config.yaml and skills — their migration is straightforward Compose volume-mount conversion.

**Primary recommendation:** Plan three sub-tasks within the phase: (1) red E2E tests, (2) implementation (skill dir creation + config.yaml updates + compose restructure + harness simplification + StandaloneConfig removal + test migration via conftest), (3) full regression verification at 703+ tests.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| docker SDK (Python) | 7.x (already installed) | Container management in tests | Used by existing E2E test fixtures |
| pytest | 7.x (already installed) | Test framework | Project standard; mandatory per CLAUDE.md |
| pyyaml | 6.x (already installed) | Read/write config.yaml | Used by harness config_loader and ConfigBuilder |
| httpx | 0.27+ (already installed) | HTTP client in tools | Used by orchestrator_loop.py tool handlers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest-asyncio | (already installed) | Async test support | All async test classes |
| fakeredis | (already installed) | In-memory Redis for tests | Integration tests that need Redis |

**Installation:** No new dependencies required for Phase 7.

---

## Architecture Patterns

### Final Skill Directory Structure
```
skills/
├── data-collection/
│   └── web-scraping/
│       ├── SKILL.md
│       └── skill.yaml
├── dispatch/
│   └── task-management/
│       └── skill.yaml              # EXISTS — needs SKILL.md + tools/ subdir
├── knowledge/
│   └── recall/
│       ├── SKILL.md
│       └── skill.yaml
├── orchestration/                  # NEW CATEGORY
│   └── task-management/            # NEW SKILL DIR
│       ├── SKILL.md                # System prompt from orchestrator_loop.py
│       ├── manifest.yaml           # capabilities: [task_orchestration, task_management]
│       └── tools/                  # 8 tool files from orchestrator_loop.py
│           ├── dispatch_task.py
│           ├── check_task_status.py
│           ├── cancel_task.py
│           ├── list_agents.py
│           ├── query_registry.py
│           ├── wait_for_result.py
│           ├── query_knowledge.py
│           └── store_knowledge.py
├── security/                       # NEW CATEGORY
│   └── review/                     # NEW SKILL DIR
│       ├── SKILL.md                # Reviewer system prompt from reviewer config.yaml
│       └── manifest.yaml           # capabilities: [security_review]
└── examples/                       # NEW CATEGORY
    └── hello-world/                # NEW SKILL DIR (template)
        ├── SKILL.md
        └── manifest.yaml
```

### Final Agent Directory Structure
```
agents/
├── _base/               # Base image — unchanged
│   ├── Dockerfile
│   ├── entrypoint.sh
│   └── kubex_harness/
├── orchestrator/        # MIGRATED
│   ├── config.yaml      # Updated: skill refs → "task-management", no prompt field
│   └── policies/
│       └── policy.yaml
├── instagram-scraper/   # MIGRATED
│   ├── config.yaml      # Updated: skills → ["web-scraping"]
│   └── policies/
│       └── policy.yaml
├── knowledge/           # MIGRATED
│   ├── config.yaml      # Updated: skills → ["recall"]
│   └── policies/
│       └── policy.yaml
├── reviewer/            # MIGRATED
│   ├── config.yaml      # Updated: skills → ["review"]
│   └── policies/
│       └── policy.yaml
└── hello-world/         # NEW TEMPLATE
    └── config.yaml
```

### Pattern 1: config.yaml Agent Identity (No StandaloneConfig)
**What:** All config read from `/app/config.yaml`; harness fails fast if file absent.
**When to use:** Every container boot.
**Example:**
```yaml
# agents/orchestrator/config.yaml (after migration)
agent:
  id: "orchestrator"
  boundary: "default"
  model: "gpt-5.2"
  skills:
    - "task-management"          # maps to skills/orchestration/task-management/
  capabilities:
    - "task_orchestration"
    - "task_management"
```

### Pattern 2: Docker Compose Service (Build → Image + Volumes)
**What:** Agent service uses `image: kubexclaw-base:latest` (no build); mounts config + skills read-only.
**When to use:** All agent services in docker-compose.yml after migration.
**Example:**
```yaml
orchestrator:
  image: kubexclaw-base:latest
  container_name: kubexclaw-orchestrator
  depends_on:
    kubexclaw-base:
      condition: service_started
    gateway:
      condition: service_healthy
  volumes:
    - ./agents/orchestrator/config.yaml:/app/config.yaml:ro
    - ./agents/orchestrator/policies:/app/policies:ro
    - ./skills/orchestration/task-management:/app/skills/task-management:ro
  environment:
    - GATEWAY_URL=http://gateway:8080
    - BROKER_URL=http://kubex-broker:8060
    - REGISTRY_URL=http://kubex-registry:8070
    - OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai
  networks:
    - kubex-internal
  restart: unless-stopped
```

### Pattern 3: Conftest Fixture for StandaloneConfig Removal
**What:** Session-scoped conftest fixture writes a minimal config.yaml to tmp_path and monkeypatches the config path constant; tests that need custom config override the fixture.
**When to use:** Any test that currently sets KUBEX_AGENT_ID env var or imports StandaloneConfig.
**Example:**
```python
# tests/conftest.py (addition)
@pytest.fixture(scope="session")
def default_agent_config(tmp_path_factory):
    """Write a minimal config.yaml for tests that don't need custom config."""
    config_dir = tmp_path_factory.mktemp("agent_config")
    config_file = config_dir / "config.yaml"
    config_file.write_text(
        "agent:\n  id: test-agent\n  model: gpt-5.2\n  capabilities: []\n  skills: []\n",
        encoding="utf-8",
    )
    return str(config_file)
```

### Pattern 4: Orchestrator Loop Migration
**What:** `orchestrator_loop.py` is deleted from `agents/orchestrator/`; the 8 tool handler implementations move to `skills/orchestration/task-management/tools/*.py`; the harness discovers tools from config.yaml's tools list.
**Key:** `OrchestratorConfig(StandaloneConfig)` inheritance disappears; the orchestrator reads from config.yaml like every other agent.
**When to use:** This is the orchestrator-specific migration path.

### Anti-Patterns to Avoid
- **Partial migration:** Do not delete only some Dockerfiles and leave others. All-or-nothing per locked decision.
- **Env var fallback in harness:** Do not keep any env var override path in config_loader after StandaloneConfig removal. The locked decision is config.yaml-only.
- **Category-less skill paths in volumes:** Use the correct path format `./skills/{category}/{name}:/app/skills/{name}:ro` — the container sees flat `/app/skills/{name}` regardless of host category hierarchy.
- **Baking config into skill dirs:** config.yaml belongs in `agents/{agent}/` and is bind-mounted; it must not be committed inside skill directories.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Writing config.yaml for containers | Custom serializer | `pyyaml.dump()` | Already used in ConfigBuilder |
| Skill content validation | Custom string matching | `SkillValidator` from `kubex_manager/skill_validator.py` | Already catches injection patterns |
| Skill manifest parsing | Ad-hoc YAML parsing | `SkillResolver._load_manifest()` | Handles manifest.yaml/skill.yaml duality |
| Container dependency ordering in Compose | Hand-wiring startup sleeps | `depends_on` + `condition: service_healthy` | Already used by all infrastructure services |
| Monkeypatching config path in tests | Individual per-test env var setup | Session-scoped conftest fixture | One fixture, shared across all tests |

---

## Common Pitfalls

### Pitfall 1: Skill Name vs. Category/Name Path Mismatch
**What goes wrong:** `config.yaml` lists `skills: ["task-management"]` but the volume mount path uses the full host path `./skills/orchestration/task-management`. The SkillResolver looks for a subdirectory named exactly what config.yaml lists as the skill name.
**Why it happens:** Skills are stored by category on the host but the container sees only the flat `/app/skills/{name}` path.
**How to avoid:** Always use the leaf directory name (e.g., `task-management`) in config.yaml skills list. Mount as `./skills/orchestration/task-management:/app/skills/task-management:ro`.
**Warning signs:** SkillResolutionError: "Skill directory not found" in harness logs.

### Pitfall 2: ConfigBuilder Fails on Missing Tool .py Files
**What goes wrong:** ConfigBuilder validates that every tool declared in a skill manifest has a corresponding `.py` file in `tools/`. If the orchestration skill's manifest lists 8 tools but only 5 `.py` files exist, `ConfigBuildError` is raised.
**Why it happens:** ConfigBuilder step 3 checks `skill_dir / skill_name / "tools" / f"{tool_name}.py"` for each namespaced tool key.
**How to avoid:** Create all 8 tool `.py` files before running ConfigBuilder or any test that exercises the Manager spawn pipeline with the orchestration skill.
**Warning signs:** `ConfigBuildError: tool files not found on disk`.

### Pitfall 3: StandaloneConfig Removal Breaks 856 Tests
**What goes wrong:** `test_orchestrator_loop.py` imports `OrchestratorConfig(StandaloneConfig)` and calls `_require_env("KUBEX_AGENT_ID")` in test setup; `test_config_loader.py::TestEnvVarFallback` tests the env-var-only path that will no longer exist.
**Why it happens:** These tests were written against the env-var-driven StandaloneConfig API.
**How to avoid:** Plan 07-02 (test migration) runs first or in parallel with the implementation. The conftest fixture patches config path before any test that touches config loading.
**Warning signs:** `ValueError: Required environment variable not set: KUBEX_AGENT_ID` or `ImportError: cannot import name 'StandaloneConfig'`.

### Pitfall 4: Orchestrator CMD After Migration
**What goes wrong:** The orchestrator currently runs `CMD ["python", "-m", "orchestrator_loop"]` (set in its Dockerfile). After the Dockerfile is deleted, it must run `CMD ["python", "-m", "kubex_harness.main"]` (inherited from kubexclaw-base). The tool-use loop must be invoked differently.
**Why it happens:** The current orchestrator has a bespoke entry point. The base image's CMD routes to standalone or openclaw based on harness_mode in config.yaml.
**How to avoid:** The orchestrator's tools move to a skill directory and the harness discovers them via config.yaml. The orchestrator uses `harness_mode: standalone` (or a new `harness_mode: orchestrator` if the tool-use loop needs special routing) — verify which approach aligns with Phase 6 decisions.
**Warning signs:** Container exits immediately after migration because `orchestrator_loop` module is not found.

### Pitfall 5: docker-compose.yml kubexclaw-base Build Service
**What goes wrong:** Agent services reference `image: kubexclaw-base:latest` but Compose has no build rule for this image; `docker compose up` fails with "pull access denied" or "image not found".
**Why it happens:** The base image must be built before agent services start.
**How to avoid:** Add a `kubexclaw-base` build service in docker-compose.yml that agent services `depends_on`. Compose builds the base first automatically.
**Example:**
```yaml
kubexclaw-base:
  build:
    context: .
    dockerfile: agents/_base/Dockerfile
  image: kubexclaw-base:latest
```

### Pitfall 6: test_orchestrator_loop.py Imports After Removal
**What goes wrong:** `test_orchestrator_loop.py` adds `agents/orchestrator` to sys.path and imports from `orchestrator_loop`. After migration, `orchestrator_loop.py` is deleted and the file moves to the skill directory.
**Why it happens:** The sys.path trick in the test file references the old location.
**How to avoid:** In the test migration plan, update `test_orchestrator_loop.py` to import from the new skill tool location, or keep `orchestrator_loop.py` as a thin compatibility shim until tests are fully updated.

---

## Code Examples

Verified patterns from existing codebase:

### Skill Manifest (manifest.yaml format)
```yaml
# skills/orchestration/task-management/manifest.yaml
name: "task-management"
version: "0.1.0"
description: "Multi-turn tool-use orchestration for task coordination"
category: "orchestration"
capabilities:
  - "task_orchestration"
  - "task_management"
tools:
  - name: "dispatch_task"
    description: "Dispatch a subtask to a worker Kubex by capability"
    parameters:
      capability: {type: string, required: true}
      context_message: {type: string, required: true}
  # ... remaining 7 tools
dependencies:
  pip:
    - "httpx>=0.27.0"
  system: []
egress_domains: []
```

### Harness config_loader.py After StandaloneConfig Removal
```python
def load_agent_config(config_path: str = "/app/config.yaml") -> AgentConfig:
    """Load agent configuration from config.yaml. Fails fast if file absent."""
    try:
        with open(config_path, encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
    except FileNotFoundError:
        raise ValueError(f"Required config file not found: {config_path}")

    if not isinstance(raw, dict):
        raise ValueError(f"Config file is not a YAML mapping: {config_path}")

    agent_section = raw.get("agent", {})
    agent_id = agent_section.get("id")
    if not agent_id:
        raise ValueError("Config missing required field: agent.id")

    return AgentConfig(
        agent_id=agent_id,
        model=agent_section.get("model", "gpt-5.2"),
        skills=agent_section.get("skills", []) or [],
        capabilities=agent_section.get("capabilities", []) or [],
        harness_mode=agent_section.get("harness_mode", "standalone"),
        gateway_url=raw.get("gateway_url", "http://gateway:8080"),
        broker_url=raw.get("broker_url", "http://broker:8060"),
    )
```

### main.py: StandaloneAgent Boot After Migration
```python
# main.py creates StandaloneAgent using AgentConfig from config_loader
# NOT from StandaloneConfig (which is deleted)
async def _run() -> None:
    from kubex_harness.config_loader import load_agent_config
    agent_cfg = load_agent_config()          # reads /app/config.yaml
    # Build StandaloneConfig-equivalent from AgentConfig
    standalone_config = _build_standalone_config(agent_cfg)
    agent = StandaloneAgent(standalone_config)
    await agent.run()
```

### E2E Test Pattern for Agent Boot Assertion
```python
# Source: tests/e2e/test_base_image_e2e.py existing pattern
@pytest.mark.e2e
@pytest.mark.skipif(not _DOCKER_AVAILABLE, reason="Docker not available")
class TestOrchestratorBootsFromBase:
    def test_orchestrator_boots_kubexclaw_base(self, docker_client, tmp_path):
        config_data = {"agent": {"id": "orchestrator", "model": "gpt-5.2",
                                  "skills": ["task-management"], ...}}
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data))
        exit_code, logs = run_container(
            docker_client, "kubexclaw-base:latest",
            volumes={str(config_file): {"bind": "/app/config.yaml", "mode": "ro"}},
            command='python -c "from kubex_harness.config_loader import load_agent_config; c = load_agent_config(); print(c.agent_id)"',
        )
        assert "orchestrator" in logs
        assert exit_code == 0
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-agent Dockerfile baking config + skills | Base image + bind-mounts | Phase 7 | No Docker rebuild for skill/config changes |
| StandaloneConfig env-var fallback | config.yaml-only, fail-fast | Phase 7 | Cleaner contract, no implicit env var magic |
| orchestrator_loop.py as standalone entrypoint | harness.main routing via config.yaml | Phase 7 | Orchestrator uses same entry path as all agents |
| Skills copied via Dockerfile COPY | Skills bind-mounted read-only at spawn | Phase 7 | Skills are cattle not pets; swap without rebuild |

**Deprecated after Phase 7:**
- `agents/orchestrator/Dockerfile` — deleted
- `agents/instagram-scraper/Dockerfile` — deleted
- `agents/knowledge/Dockerfile` — deleted
- `agents/reviewer/Dockerfile` — deleted
- `StandaloneConfig` class in `standalone.py` — deleted
- `agents/orchestrator/orchestrator_loop.py` — moved to skill tools
- `agents/orchestrator/mcp_bridge/` — moved to skill tools directory

---

## Open Questions

1. **How does the orchestrator's tool-use loop wire up after orchestrator_loop.py moves?**
   - What we know: `main.py` currently routes to `StandaloneAgent` (single-shot) or `KubexHarness` (openclaw); the orchestrator needs a multi-turn tool loop.
   - What's unclear: Does `harness_mode: orchestrator` become a third routing option, or do the tool files in the skill directory integrate with the existing `StandaloneAgent._call_llm` override pattern?
   - Recommendation: The simplest path is to keep `orchestrator_loop.py` as the entry in the harness main routing table, invoked when `harness_mode: orchestrator` is set in config.yaml. The "move tools to skill" decision refers to the httpx tool handler code, not the entire multi-turn loop class. Verify in the plan.

2. **Which env vars remain in docker-compose.yml agent services after StandaloneConfig removal?**
   - What we know: config.yaml now owns GATEWAY_URL, BROKER_URL, model. But containers still need OPENAI_BASE_URL and ANTHROPIC_BASE_URL set dynamically by Compose (these are injected by Kubex Manager at spawn, but for the static Compose fleet they come from Compose env).
   - What's unclear: Do OPENAI_BASE_URL and ANTHROPIC_BASE_URL stay in Compose environment stanza (they're not in config.yaml by convention) or do they move to config.yaml?
   - Recommendation: Keep OPENAI_BASE_URL/ANTHROPIC_BASE_URL in Compose environment stanza; add gateway_url and broker_url to the config.yaml agent section instead. KUBEX_AGENT_ID env var is removed (config.yaml owns id).

3. **Does `test_config_loader.py::TestEnvVarFallback` get deleted or updated?**
   - What we know: The locked decision removes env var fallback entirely. TestEnvVarFallback tests the fallback path that will not exist.
   - What's unclear: Whether to delete these tests entirely or convert them to assert the new "fail fast on missing config" behavior.
   - Recommendation: Convert `test_missing_config_and_no_env_raises_or_defaults` to assert a `ValueError` is raised. Delete `test_fallback_to_env_vars_when_no_config` as the behavior it tests is explicitly removed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (existing, version ~7.x) |
| Config file | `pytest.ini` or `pyproject.toml` (existing) |
| Quick run command | `python -m pytest tests/unit/ tests/integration/ -x -q` |
| Full suite command | `python -m pytest tests/ -q` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIGR-01 | Orchestrator boots from kubexclaw-base without Dockerfile | e2e | `pytest tests/e2e/test_agent_migration.py::TestOrchestratorBootsFromBase -x` | ❌ Wave 0 |
| MIGR-02 | Instagram-scraper boots from kubexclaw-base without Dockerfile | e2e | `pytest tests/e2e/test_agent_migration.py::TestInstagramScraperBootsFromBase -x` | ❌ Wave 0 |
| MIGR-03 | Knowledge agent boots from kubexclaw-base without Dockerfile | e2e | `pytest tests/e2e/test_agent_migration.py::TestKnowledgeAgentBootsFromBase -x` | ❌ Wave 0 |
| MIGR-04 | No per-agent Dockerfiles present in agents/ directories | unit | `pytest tests/unit/test_no_agent_dockerfiles.py -x` | ❌ Wave 0 |
| MIGR-05 | Full test suite passes: 703+ tests with no regressions | full suite | `python -m pytest tests/ -q` | ✅ (existing suite) |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/unit/ tests/integration/ -x -q`
- **Per wave merge:** `python -m pytest tests/ -q`
- **Phase gate:** Full suite green (703+ tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/e2e/test_agent_migration.py` — covers MIGR-01, MIGR-02, MIGR-03 (Docker-based E2E, skip if no daemon)
- [ ] `tests/unit/test_no_agent_dockerfiles.py` — covers MIGR-04 (filesystem assertion, fast unit test)
- [ ] `tests/e2e/test_hello_world_spawn.py` — covers hello-world stem cell promise E2E

---

## Sources

### Primary (HIGH confidence)
- `agents/_base/kubex_harness/standalone.py` — StandaloneConfig class (to be deleted), StandaloneAgent, _load_skill_files
- `agents/_base/kubex_harness/config_loader.py` — load_agent_config, AgentConfig (current env-var override logic to be removed)
- `agents/_base/kubex_harness/main.py` — boot routing (standalone / openclaw)
- `agents/_base/Dockerfile` — base image structure
- `agents/_base/entrypoint.sh` — boot sequence, KUBEX_PIP_DEPS dep install
- `agents/orchestrator/Dockerfile` — FROM python:3.12-slim (the outlier; must be fully converted)
- `agents/orchestrator/orchestrator_loop.py` — 8 tools + OrchestratorConfig + ORCHESTRATOR_SYSTEM_PROMPT
- `agents/orchestrator/config.yaml` — current skills list uses action names, not directory names
- `agents/instagram-scraper/Dockerfile` + `agents/knowledge/Dockerfile` + `agents/reviewer/Dockerfile` — already FROM kubexclaw-base
- `docker-compose.yml` — orchestrator service uses `build:` not `image:` (must be converted)
- `services/kubex-manager/kubex_manager/config_builder.py` — validates tool .py files exist on disk
- `services/kubex-manager/kubex_manager/lifecycle.py` — create_kubex() 8-step pipeline; skill mounts
- `services/kubex-manager/kubex_manager/skill_resolver.py` — _load_manifest tries manifest.yaml then skill.yaml
- `skills/dispatch/task-management/skill.yaml` — existing skill manifest format reference
- `tests/e2e/test_base_image_e2e.py` — run_container() helper pattern for E2E tests
- `tests/unit/test_config_loader.py` — tests that must be updated for StandaloneConfig removal

### Secondary (MEDIUM confidence)
- CONTEXT.md locked decisions — verified against codebase structure

### Tertiary (LOW confidence)
- None — all research findings are grounded in direct codebase inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed, no new dependencies
- Architecture: HIGH — directly inspected all agent Dockerfiles, config.yamls, and skill directories
- Pitfalls: HIGH — pitfalls derived from actual code paths (ConfigBuilder tool validation, StandaloneConfig import chain, orchestrator CMD mismatch)

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable internal codebase, no external dependencies changing)
