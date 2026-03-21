# Phase 5: Base Image and Skill Schema - Research

**Researched:** 2026-03-13
**Domain:** Docker base image, Pydantic schema design, shell scripting, prompt injection defense, Python module design
**Confidence:** HIGH

## Summary

Phase 5 refactors the existing `kubexclaw-base` image and skill system from a prototype state into a production-grade "stem cell" contract. The codebase is already partially there: the Dockerfile, entrypoint, harness, and skill loading exist but lack config-driven boot, finalized schemas, validation stamps, and injection defense. All work is brownfield — existing tests (827) must continue passing.

The central design tension is that two harness entry points currently exist (`standalone.py` used by workers and `main.py`+`harness.py` used by OpenClaw-mode agents). These must be unified into a single entry point that reads `config.yaml` and routes accordingly. The `SkillManifest` Pydantic model in `kubex-common` needs a breaking rewrite to remove `policy`/`budget`/`actions` fields and add `dependencies`, `capabilities`, and a finalized `egress_domains`.

The injection defense is the most architecturally novel piece: regex fast-pass then LM (o3-mini) structured analysis, with results cached by content hash. Validated skills get a stamp (hash + timestamp + validator version). The `kubex_manager.skill_validator` module must be importable, CLI-callable, and independently testable.

**Primary recommendation:** Implement in the order the plans dictate — red tests first. The test surface must cover: Docker build success, config-driven skill loading, skill composition (two skills → both in prompt, more-restrictive policy wins), injection detection (regex AND LM path), and boot dependency installation. All without requiring a live Docker daemon in unit tests (use mock Docker SDK patterns already established in `test_kubex_manager_unit.py`).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Skill Composition Rules
- System prompt uses **sectioned blocks** — each skill gets its own labeled section (current `_load_skill_files()` pattern preserved)
- **Skills do NOT own policy** — policy is a separate config from the skill. Skills declare what they need; policy defines what's allowed
- **LM eval at compile/spawn time** using o3-mini (same reviewer model) checks whether the agent's policy would block any skill's required capabilities
- LM eval is a **blocking gate** — spawn fails if conflict detected
- Error messages include **conflict + suggestion** (which action is blocked, which skill needs it, suggested policy fix)
- LM eval results are **cached with hash key** (hash of skill manifests + policy config). Same hash = skip eval
- LM eval **auto-suggests egress domain additions** when a skill declares domains the policy doesn't allow
- **Capabilities** = union (deduplicated) from all mounted skills
- **Dependencies** = union all deps from all skills. Version conflicts = error at spawn time
- **Tools are skill-namespaced**: `web-scraping.scrape_profile`, not `scrape_profile`. No collision possible
- **Skill ordering matters** — skills listed first in config.yaml get priority positioning in the system prompt

#### Injection Defense Strategy
- **Both layers**: fast regex blocklist pass first, then LM-based review (o3-mini structured analysis) for anything that passes regex
- LM detection can **auto-add new patterns** to the regex blocklist. Auto-added immediately for safety, queued for **human review** (human can remove false positives)
- When injection detected → **ESCALATE to human** (not hard reject). Consistent with policy philosophy
- Validation runs **on catalog add only** (not every mount). Validated skills get a **stamp** (content hash + timestamp + validator version)
- New blocklist patterns trigger a **re-scan of entire catalog**. Any matches get ESCALATED
- Only **.md prompt content** validated for injection (not .yaml manifests — those are schema-validated)
- LM detection uses a **structured analysis prompt** (checks for role hijacking, instruction override, data exfiltration, etc.) returning structured JSON verdict
- **Standalone module**: `kubex_manager.skill_validator` — importable, CLI-callable (`python -m kubex_manager.skill_validator skills/`), testable in isolation
- Regex blocklist stored as **YAML file in repo** (version-controlled)

#### Boot-time Config Loading
- **entrypoint.sh installs deps** — reads config.yaml, extracts dependency list, runs pip install / apt-get before starting harness
- **config.yaml is primary**, env vars serve as overrides (backward compatible with current agents during migration)
- Config lists tool names; **tool code lives per-skill** in skill directories (e.g., `skills/web-scraping/tools/`)
- **Fail fast** on dependency installation failure — container exits with clear error, no half-working agents
- **Structured boot summary** logged: loaded skills, active tools, model, capabilities, dependency install results
- **Unified harness entry point** — no more separate standalone.py vs main.py. Single entry point reads config.yaml and routes accordingly
- Config mount path: Claude's discretion

#### Skill Schema (skill.yaml)
- **Minimal schema**: identity (name, version, description, category) + tools + dependencies + egress_domains + capabilities
- **Remove** policy, budget, and actions fields from skill.yaml — those belong to agent policy config
- **Both files required** per skill: skill.yaml (machine-readable manifest) AND SKILL.md (LLM prompt instructions)
- **Directory structure**: `skills/{category}/{skill-name}/` with skill.yaml + SKILL.md + tools/ inside (current pattern)
- **Rewrite SkillManifest** Pydantic model in kubex-common — breaking change, clean contract matching finalized schema
- **Dependencies section**: separate `pip` and `system` (apt) lists: `dependencies: { pip: [...], system: [...] }`
- **Capabilities field** in skill.yaml — each skill declares what capabilities it provides for broker routing
- **Internet-sourced skills** are allowed but must go through ESCALATE pipeline (not strictly local-only)

### Claude's Discretion
- Config mount path inside container (/app/config.yaml vs /run/secrets/)
- Exact regex patterns for initial injection blocklist seed
- Boot summary log format details
- Internal implementation of the harness unification

### Deferred Ideas (OUT OF SCOPE)
- Skill versioning with backward compatibility (SKIL-05, v2 requirement)
- Skill scaffolding CLI (`kclaw skill create`) (SKIL-06, v2 requirement)
- Health check endpoint in base image (BASE-05, v2 requirement)
- Resource limit profiles per agent type (BASE-06, v2 requirement)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BASE-01 | Single `kubexclaw-base` Docker image used by all agents | Dockerfile exists at `agents/_base/Dockerfile`; needs unified CMD entry point and config-driven boot |
| BASE-02 | Container reads config at boot and self-configures (skills, tools, model, dependencies) | `entrypoint.sh` needs extension; `StandaloneConfig` reads env vars today, must fall back to config.yaml |
| BASE-03 | Container downloads all config-specified dependencies at boot (pip packages, CLI tools) | `entrypoint.sh` step 1/2 pattern already established; needs `pip install` + `apt-get` insertion |
| BASE-04 | Harness loads tools from config (orchestrator tools, worker tools — same harness, different config) | `standalone.py` + `harness.py` split must collapse to one entry point reading config.yaml tool list |
| SKIL-01 | `skill.yaml` manifest schema defining capabilities, resources, and dependencies per skill | `SkillManifest` in `kubex-common/schemas/config.py` needs rewrite; 3 existing skill.yaml files need migration |
| SKIL-02 | Skills mounted into containers via Docker bind mounts at spawn | `KubexLifecycle.create_kubex()` must add bind-mount logic; `entrypoint.sh` reads `/app/skills` already |
| SKIL-03 | Skill composition — multiple skills per agent, resolved by SkillResolver | New `SkillResolver` class needed; union of capabilities/deps; tool namespacing; ordering from config |
| SKIL-04 | Skill content validation before injection into LLM prompt (prompt injection defense) | New `SkillValidator` module; regex blocklist YAML + LM structured analysis; stamp on clean skills |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pydantic | >=2.0 (already in kubex-common) | SkillManifest schema, AgentConfig | Already the schema standard in this project |
| pyyaml | >=6.0 (already in kubex-common) | Parse skill.yaml, blocklist YAML | Already a dependency |
| hashlib | stdlib | Content hash for validation stamps | No external dep needed; sha256 is sufficient |
| re | stdlib | Regex injection blocklist fast-pass | No external dep needed |
| httpx | >=0.27 (already in harness) | LM eval call to o3-mini via Gateway proxy | Already used for all HTTP calls |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest | >=8.0 | All tests | Required by CLAUDE.md; no other runners allowed |
| pytest-asyncio | >=0.24 | Async test coroutines | Standalone harness is async |
| fakeredis | >=2.25 | Unit tests that touch Redis | Already in kubex-common dev deps |
| unittest.mock | stdlib | Mock Docker SDK, httpx, subprocess | Established pattern in existing test suite |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pyyaml | ruamel.yaml | ruamel preserves YAML comments; overkill for this use case — pyyaml already present |
| hashlib.sha256 | blake3 | blake3 is faster but not in stdlib; sha256 is sufficient for stamp hashing |
| regex blocklist YAML | sqlite | YAML is version-controlled and human-readable; sqlite adds deployment complexity for no gain |

**Installation:** No new packages required. All dependencies already in `kubex-common` or `kubex-harness` `pyproject.toml`.

---

## Architecture Patterns

### Recommended Project Structure

Changes and additions relative to today:

```
agents/_base/
├── Dockerfile                    # extend: unified CMD, /app/config.yaml mount point
├── entrypoint.sh                 # extend: dep install step, boot summary, config.yaml read
├── kubex_harness/
│   ├── __init__.py
│   ├── config_loader.py          # NEW: reads /app/config.yaml, falls back to env vars
│   ├── skill_loader.py           # NEW: wraps _load_skill_files + composition logic
│   ├── harness.py                # existing OpenClaw PTY harness (unchanged)
│   ├── standalone.py             # existing LLM loop (simplified — no config logic here)
│   └── main.py                   # REWRITE: reads config.yaml, routes to harness or standalone

libs/kubex-common/kubex_common/schemas/
└── config.py                     # REWRITE SkillManifest; AgentConfig gets tools field

services/kubex-manager/kubex_manager/
├── lifecycle.py                  # extend: bind-mount injection in create_kubex()
├── skill_validator.py            # NEW: SkillValidator (regex + LM), stamp logic
├── skill_resolver.py             # NEW: SkillResolver (union caps/deps, namespace tools)
└── blocklist.yaml                # NEW: version-controlled regex injection patterns

skills/
├── data-collection/web-scraping/
│   ├── SKILL.md                  # keep as-is
│   └── skill.yaml                # MIGRATE: remove policy/budget/actions, add deps/caps
├── knowledge/recall/
│   ├── SKILL.md                  # keep or create
│   └── skill.yaml                # MIGRATE
└── dispatch/task-management/
    ├── SKILL.md                  # keep or create
    └── skill.yaml                # MIGRATE

tests/
├── unit/
│   ├── test_skill_validator.py   # NEW: SkillValidator unit tests
│   ├── test_skill_resolver.py    # NEW: SkillResolver unit tests
│   └── test_config_loader.py     # NEW: config.yaml loading unit tests
└── e2e/
    └── test_base_image_e2e.py    # NEW: Docker build, skill mount, composition, injection E2E
```

### Pattern 1: Config-Driven Entry Point

**What:** `main.py` reads `/app/config.yaml` at boot, builds a unified runtime config, then delegates to the appropriate loop (standalone poll loop or OpenClaw PTY harness).
**When to use:** Every container boot.

```python
# agents/_base/kubex_harness/main.py (new pattern)
from kubex_harness.config_loader import load_agent_config

async def _run() -> None:
    cfg = load_agent_config()  # reads /app/config.yaml, falls back to env vars
    if cfg.use_openclaw_harness:
        harness = KubexHarness(HarnessConfig.from_config(cfg))
        await harness.run()
    else:
        agent = StandaloneAgent(StandaloneConfig.from_config(cfg))
        await agent.run()
```

The `load_agent_config()` function must:
1. Try `/app/config.yaml` first (config.yaml `agent:` stanza)
2. Fall back to env vars (current `StandaloneConfig` behavior) if no file found
3. Merge skill deps, capabilities, and tools from loaded `SkillManifest` objects

### Pattern 2: Finalized SkillManifest Schema

**What:** Pydantic model that matches the decided minimal schema — no policy/budget/actions.

```python
# libs/kubex-common/kubex_common/schemas/config.py

class SkillDependencies(BaseModel):
    pip: list[str] = Field(default_factory=list)
    system: list[str] = Field(default_factory=list)

class SkillTool(BaseModel):
    name: str                          # tool function name (unnamespaced in YAML)
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)

class SkillManifest(BaseModel):
    name: str
    version: str = "0.1.0"
    description: str = ""
    category: str = ""
    capabilities: list[str] = Field(default_factory=list)
    tools: list[SkillTool] = Field(default_factory=list)
    dependencies: SkillDependencies = Field(default_factory=SkillDependencies)
    egress_domains: list[str] = Field(default_factory=list)
    # Validation stamp — set by SkillValidator, not by skill author
    validation_stamp: ValidationStamp | None = None

class ValidationStamp(BaseModel):
    content_hash: str          # sha256 of SKILL.md content
    validated_at: str          # ISO 8601 timestamp
    validator_version: str     # e.g. "1.0.0"
    verdict: str               # "clean"
```

**Breaking change note:** `actions_required`, `resource_requirements`, `system_prompt_section` fields must be REMOVED. Any existing code referencing them must be updated (check `lifecycle.py`, agent configs, tests).

### Pattern 3: SkillResolver — Composition

**What:** Takes a list of skill names + their loaded `SkillManifest` objects; returns a resolved `ComposedSkillSet`.

```python
# services/kubex-manager/kubex_manager/skill_resolver.py

@dataclass
class ComposedSkillSet:
    capabilities: list[str]           # union, deduplicated
    pip_deps: list[str]               # union, deduplicated
    system_deps: list[str]            # union, deduplicated
    egress_domains: list[str]         # union, deduplicated
    tools: dict[str, SkillTool]       # namespaced: "skill-name.tool-name"
    ordered_skill_names: list[str]    # preserves config.yaml order for prompt priority
    version_conflicts: list[str]      # populated if pip version pins conflict

class SkillResolver:
    def resolve(
        self,
        skill_names: list[str],          # from agent config.yaml, in order
        skill_dir: Path,                 # root of skill catalog
    ) -> ComposedSkillSet: ...
```

Version conflict detection: if two skills declare `requests==2.31` and `requests==2.28`, populate `version_conflicts` and raise `SkillResolutionError` at spawn time.

Tool namespacing: `web-scraping.scrape_profile` — the skill directory name (not `skill.yaml` name field) prefixes the tool name. This prevents collisions when two skills expose a tool with the same function name.

### Pattern 4: SkillValidator — Injection Defense

**What:** Standalone module that validates `.md` content for prompt injection patterns.

```python
# services/kubex-manager/kubex_manager/skill_validator.py

class ValidationVerdict(BaseModel):
    is_clean: bool
    detected_patterns: list[str]
    lm_analysis: LMVerdict | None = None
    stamp: ValidationStamp | None = None

class SkillValidator:
    def __init__(self, blocklist_path: Path, lm_client: LMClient | None = None): ...

    def validate_skill_md(self, skill_name: str, content: str) -> ValidationVerdict:
        """Two-phase: regex fast-pass, then LM if needed."""
        # Phase 1: regex
        matches = self._regex_check(content)
        if matches:
            return ValidationVerdict(is_clean=False, detected_patterns=matches)
        # Phase 2: LM
        if self._lm_client:
            verdict = self._lm_check(content)
            if not verdict.is_clean:
                return ValidationVerdict(is_clean=False, lm_analysis=verdict)
        # Clean — stamp it
        stamp = self._create_stamp(content)
        return ValidationVerdict(is_clean=True, stamp=stamp)

    def validate_catalog(self, skills_dir: Path) -> list[ValidationVerdict]: ...
```

**CLI entry point** (required by success criteria):
```python
# python -m kubex_manager.skill_validator skills/
if __name__ == "__main__":
    import sys
    results = SkillValidator(...).validate_catalog(Path(sys.argv[1]))
    failures = [r for r in results if not r.is_clean]
    sys.exit(0 if not failures else 1)
```

### Pattern 5: entrypoint.sh Dep Install Step

**What:** Before starting the harness, read `config.yaml` dependency lists and install them.

```bash
# entrypoint.sh — new Step 3 (dep install, before current Step 3 skill load)

CONFIG_FILE="/app/config.yaml"
if [ -f "${CONFIG_FILE}" ]; then
    # Extract pip deps using python -c (pyyaml already installed in image)
    PIP_DEPS=$(python3 -c "
import yaml, sys
cfg = yaml.safe_load(open('${CONFIG_FILE}'))
deps = []
for skill in cfg.get('agent', {}).get('skills', []):
    # deps resolved by SkillResolver; injected as env var by Manager
    pass
print(' '.join(deps))
")
    # Simpler: Manager injects KUBEX_PIP_DEPS and KUBEX_SYSTEM_DEPS
    if [ -n "${KUBEX_PIP_DEPS:-}" ]; then
        pip install --no-cache-dir ${KUBEX_PIP_DEPS} || { echo "[entrypoint] FATAL: pip install failed"; exit 1; }
    fi
    if [ -n "${KUBEX_SYSTEM_DEPS:-}" ]; then
        apt-get install -y --no-install-recommends ${KUBEX_SYSTEM_DEPS} || { echo "[entrypoint] FATAL: apt install failed"; exit 1; }
    fi
fi
```

**Design decision (Claude's discretion):** The Manager's `SkillResolver` computes the full dep union and injects `KUBEX_PIP_DEPS` and `KUBEX_SYSTEM_DEPS` as space-separated env vars. The entrypoint reads these and installs. This avoids parsing YAML in bash and keeps dep resolution in Python where it's testable.

**Config mount path (Claude's discretion):** Use `/app/config.yaml`. This is consistent with the existing `KUBEX_SKILLS_DIR=/app/skills` default. Avoid `/run/secrets/` for config (that path is for credentials like `openclaw.json`).

### Anti-Patterns to Avoid

- **Dual harness mode:** Do not keep `standalone.py` and `harness.py` as parallel entry points. The unified `main.py` routes between them based on config. Same container, different config.
- **Policy in skill.yaml:** Skills declare capabilities and egress needs. Policy (what's allowed/blocked) stays in agent `config.yaml`. Never move policy back into skill.yaml.
- **Injection validation on every mount:** Validate at catalog-add time only. Stamps allow the harness to skip re-validation on skills it has already seen (hash match).
- **Hard rejecting injection attempts:** The system escalates to human (ESCALATE path), consistent with the policy engine philosophy. Never silently drop a skill or hard-fail without an ESCALATE notification.
- **Parsing YAML in entrypoint.sh:** Keep all logic in Python. The entrypoint just reads pre-computed env vars set by the Manager.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing in bash | `grep`/`sed`/`awk` to extract deps from config.yaml | Python + pyyaml (already installed in image) called from entrypoint.sh | YAML edge cases (multi-line strings, anchors) break naive shell parsing |
| Schema validation | Manual field checks with `if/elif` | Pydantic `BaseModel` + `model_validate()` | Pydantic already the project standard; gives free error messages, type coercion, and `model_dump()` |
| Content hashing | Custom hash function | `hashlib.sha256(content.encode()).hexdigest()` | Stdlib; no deps; collision-resistant |
| LM structured output parsing | Manual JSON extraction from LM response | Pydantic model + `model_validate_json()` on the LM's JSON response | Same pattern as reviewer agent (o3-mini already returns structured JSON) |
| Docker bind mount generation | String concatenation | Docker SDK `volumes` dict: `{host_path: {"bind": container_path, "mode": "ro"}}` | Already the pattern in `KubexLifecycle.create_kubex()` |

**Key insight:** All the hard problems (YAML, schemas, Docker, LM calls) already have solutions in the codebase. Phase 5 is about wiring them together correctly, not building new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Breaking Existing Tests on SkillManifest Rewrite
**What goes wrong:** `SkillManifest` is imported across `kubex-common` tests, manager unit tests, and the harness. Removing `actions_required` / `resource_requirements` / `system_prompt_section` causes import errors or AttributeError in existing tests.
**Why it happens:** Breaking schema change in a shared library.
**How to avoid:** Before rewriting `SkillManifest`, grep every import and usage site. Update all call sites in the same PR. The red-test plan (05-01) should write tests that expect the NEW schema; implementation plan (05-02) makes them pass by migrating all usages atomically.
**Warning signs:** `AttributeError: 'SkillManifest' object has no attribute 'actions_required'` in existing tests.

### Pitfall 2: Harness Unification Breaks 827-Test Suite
**What goes wrong:** Merging `standalone.py` and `main.py` paths changes the import structure. `TestSkillInjection` (in `test_harness_unit.py`) imports `from kubex_harness.standalone import _load_skill_files, StandaloneConfig`. If these move, tests break.
**Why it happens:** Test imports are coupled to module names.
**How to avoid:** Keep `_load_skill_files` accessible at its current import path (re-export from `standalone.py` even if the implementation moves). Alternatively, move tests to match new structure in the same commit.
**Warning signs:** `ImportError: cannot import name '_load_skill_files' from 'kubex_harness.standalone'`.

### Pitfall 3: Injection Blocklist False Positives on Legitimate Skill Content
**What goes wrong:** A skill like `web-scraping/SKILL.md` contains phrases like "ignore rate limits" or "override the default" which trigger naive regex patterns.
**Why it happens:** Injection patterns (e.g., `/ignore\s+\w+/`) can match normal instruction text.
**How to avoid:** Seed the initial blocklist with specific, well-anchored patterns (multi-word phrases, not single words). The LM layer exists precisely to catch what regex over-accepts. The regex layer only blocks the most unambiguous patterns. Prefer false negatives (let LM handle) over false positives (block legitimate skills).
**Warning signs:** `validate_catalog()` returns failures on existing shipped skill files.

### Pitfall 4: LM Eval Is a Network Call — Tests Must Not Require Live Gateway
**What goes wrong:** `SkillValidator` unit tests call the real o3-mini endpoint via Gateway.
**Why it happens:** LM client not properly injected / mockable.
**How to avoid:** `SkillValidator.__init__` accepts `lm_client: LMClient | None = None`. When `None`, LM phase is skipped (regex-only mode). Tests pass `lm_client=MockLMClient(verdict=...)`. The pattern is already established in reviewer agent tests.
**Warning signs:** Tests hang or fail with `ConnectionRefusedError` to gateway.

### Pitfall 5: config.yaml Backward Compatibility
**What goes wrong:** Existing agent `config.yaml` files (orchestrator, instagram-scraper, knowledge, reviewer) use the old `skills:` list format (tool names, not skill directory names). The new system expects skill directory names matching `skills/{category}/{name}/`.
**Why it happens:** Schema mismatch between old and new config formats.
**How to avoid:** The `config_loader.py` must handle both formats OR the existing `config.yaml` files must be migrated in plan 05-02. Migration is cleaner. Document the new format clearly.
**Warning signs:** `SkillResolver` raises `FileNotFoundError` when resolving skills from existing agent configs.

### Pitfall 6: entrypoint.sh set -euo pipefail and Dep Install
**What goes wrong:** `pip install` exits non-zero if a package is already installed at a conflicting version. With `set -euo pipefail` the container exits instead of continuing.
**Why it happens:** `pip install` returns exit code 1 on version conflicts.
**How to avoid:** Use `pip install --no-cache-dir --upgrade` or explicitly handle the exit code. The fail-fast behavior is desired for missing packages, but version conflict handling needs care. Consider `pip install --quiet --no-warn-script-location` to reduce noise. Test the dep install step with conflicting version pins before shipping.

---

## Code Examples

### Current `_load_skill_files()` (preserve this interface)
```python
# agents/_base/kubex_harness/standalone.py (lines 91-120)
def _load_skill_files(skills_dir: str = "/app/skills") -> str:
    # Scans recursively for *.md, returns sectioned content
    # Each section: "\n--- Skill: {rel_path} ---\n{content}"
    # Header: "\n\n## Loaded Skills\n"
```
This interface is tested by 9 tests in `TestSkillInjection`. Preserve the output format.

### Current `SkillManifest` (before rewrite)
```python
# libs/kubex-common/kubex_common/schemas/config.py (lines 73-86)
class SkillManifest(BaseModel):
    name: str
    version: str = "0.1.0"
    description: str = ""
    category: str = ""
    capabilities: list[str] = Field(default_factory=list)
    actions_required: list[str]       # REMOVE
    tools: list[str]                  # CHANGE: was file names, now SkillTool objects
    system_prompt_section: str        # REMOVE
    egress_domains: list[str]
    resource_requirements: dict       # REMOVE
```

### Existing Docker mock pattern (reuse for new tests)
```python
# tests/unit/test_kubex_manager_unit.py (lines 57-65)
def make_mock_docker() -> tuple[MagicMock, MagicMock]:
    mock_container = MagicMock()
    mock_container.id = "deadbeef001"
    mock_container.status = "created"
    mock_docker = MagicMock()
    mock_docker.containers.create.return_value = mock_container
    mock_docker.containers.get.return_value = mock_container
    return mock_docker, mock_container
```

### Existing skill.yaml structure (to migrate, not start from scratch)
```yaml
# skills/data-collection/web-scraping/skill.yaml — CURRENT (has fields to remove)
skill:
  name: "web-scraping"
  version: "0.1.0"
  tools: [...]         # current: tool objects with parameters
  actions:             # REMOVE: required/optional lists
    required: [...]
  policy:              # REMOVE: this belongs in agent config
    egress: ...
    budget: ...
```

Target format after migration:
```yaml
skill:
  name: "web-scraping"
  version: "0.1.0"
  description: "..."
  category: "data-collection"
  capabilities:
    - "scrape_instagram"
    - "extract_metrics"
  tools:
    - name: "scrape_profile"
      description: "..."
  dependencies:
    pip: []
    system: []
  egress_domains:
    - "instagram.com"
    - "i.instagram.com"
    - "graph.instagram.com"
```

### Injection blocklist YAML seed (initial patterns)
```yaml
# services/kubex-manager/kubex_manager/blocklist.yaml
version: "1.0.0"
patterns:
  - id: "ignore-previous-instructions"
    pattern: "ignore (all |previous |prior )?instructions"
    flags: "IGNORECASE"
    description: "Classic instruction override attempt"
  - id: "disregard-system-prompt"
    pattern: "disregard (your |the )?(system |previous |original )?prompt"
    flags: "IGNORECASE"
    description: "System prompt override attempt"
  - id: "you-are-now"
    pattern: "you are now (a |an )?(different|new|another|unrestricted)"
    flags: "IGNORECASE"
    description: "Role hijacking attempt"
  - id: "jailbreak-do-anything"
    pattern: "do anything now|DAN|jailbreak"
    flags: "IGNORECASE"
    description: "Known jailbreak keywords"
  - id: "exfiltrate-data"
    pattern: "send (all |the )?(data|content|prompt|instructions) to"
    flags: "IGNORECASE"
    description: "Data exfiltration attempt"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-agent Dockerfiles | Single `kubexclaw-base` image | Phase 5 (this phase) | Agent diversity through config, not builds |
| Env-var-only config | config.yaml primary + env var fallback | Phase 5 (this phase) | Human-readable agent definitions, Manager-injectible |
| Skills as flat .md files (no schema) | skill.yaml manifest + SKILL.md pair | Phase 5 (this phase) | Machine-readable capabilities enable Manager automation |
| No injection defense | Regex + LM dual-layer with stamp | Phase 5 (this phase) | Prompt injection as a first-class security concern |
| `standalone.py` vs `main.py` split | Unified `main.py` routes on config | Phase 5 (this phase) | One harness image, any agent role |

**Note on existing skill.yaml files:** Three skill.yaml files exist today (`web-scraping`, `recall`, `task-management`) but use an inconsistent format (some have `skill:` root key, some don't; all have fields to remove). These are the migration targets in plan 05-02.

**Current test count:** 827 tests. Phase 5 adds tests; regression plan (05-03) verifies the count doesn't decrease.

---

## Open Questions

1. **Harness unification routing logic**
   - What we know: `harness.py` spawns the OpenClaw PTY subprocess; `standalone.py` runs a direct LLM poll loop
   - What's unclear: Should the config.yaml distinguish mode via a `harness_mode: openclaw | standalone` field, or should it be inferred from whether `openclaw` is in dependencies?
   - Recommendation: Add explicit `harness_mode: standalone` (default) to config.yaml's agent stanza. `openclaw` mode only when the agent explicitly needs PTY subprocess behavior. This makes the routing deterministic and testable.

2. **Validation stamp storage location**
   - What we know: Stamps go on the `SkillManifest` object; the decision says "validated skills get a stamp"
   - What's unclear: Is the stamp written back to `skill.yaml` on disk, or stored in a separate stamp file, or only in-memory?
   - Recommendation: Write a companion `skill.stamp.yaml` file alongside `skill.yaml` in the catalog. This keeps skill.yaml clean (not modified by the validator) while providing persistence. The validator checks `skill.stamp.yaml` for cached results before running.

3. **Blocklist auto-update human review queue**
   - What we know: LM-detected new patterns are auto-added to the regex blocklist and queued for human review
   - What's unclear: Where is the "human review queue" — a file, a Redis stream, a Gateway endpoint?
   - Recommendation: For Phase 5, write auto-detected patterns to `blocklist.pending.yaml` alongside `blocklist.yaml`. Humans review and merge into `blocklist.yaml`. The escalation notification goes to the existing ESCALATE routing in the Gateway. Full queue infrastructure is Phase 6+ concern.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest >=8.0 with pytest-asyncio >=0.24 |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` (root) |
| Quick run command | `pytest tests/unit/ -x -q` |
| Full suite command | `pytest tests/ libs/ services/ -x -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BASE-01 | `docker build agents/_base/` succeeds, image tagged `kubexclaw-base` | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_docker_build_succeeds -x` | ❌ Wave 0 |
| BASE-02 | Container reads `/app/config.yaml` at boot, applies skills/model/capabilities | unit | `pytest tests/unit/test_config_loader.py -x` | ❌ Wave 0 |
| BASE-02 | Env vars override config.yaml values | unit | `pytest tests/unit/test_config_loader.py::test_env_vars_override_config -x` | ❌ Wave 0 |
| BASE-03 | `KUBEX_PIP_DEPS` causes pip install in entrypoint | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_dep_install_on_boot -x` | ❌ Wave 0 |
| BASE-03 | Dep install failure exits container with error | e2e (Docker) | `pytest tests/e2e/test_base_image_e2e.py::test_dep_install_failure_exits -x` | ❌ Wave 0 |
| BASE-04 | Harness routes to standalone mode via config | unit | `pytest tests/unit/test_config_loader.py::test_routes_to_standalone_mode -x` | ❌ Wave 0 |
| BASE-04 | Harness routes to openclaw mode via config | unit | `pytest tests/unit/test_config_loader.py::test_routes_to_openclaw_mode -x` | ❌ Wave 0 |
| SKIL-01 | `SkillManifest` validates correct schema | unit | `pytest tests/unit/test_skill_resolver.py::test_skill_manifest_schema -x` | ❌ Wave 0 |
| SKIL-01 | `python -m kubex_manager.skill_validator skills/` exits 0 on clean catalog | e2e | `pytest tests/e2e/test_base_image_e2e.py::test_skill_validator_cli_clean_catalog -x` | ❌ Wave 0 |
| SKIL-02 | Manager bind-mounts skills into container | unit | `pytest tests/unit/test_kubex_manager_unit.py::test_bind_mounts_skills -x` | ❌ Wave 0 |
| SKIL-02 | Harness loads skills from `/app/skills` bind mount | unit | `pytest tests/unit/test_harness_unit.py::TestSkillInjection` | ✅ (existing 9 tests) |
| SKIL-03 | Two skills → both appear in system prompt | unit | `pytest tests/unit/test_skill_resolver.py::test_two_skills_both_in_prompt -x` | ❌ Wave 0 |
| SKIL-03 | Tool namespaced as `skill-name.tool-name` | unit | `pytest tests/unit/test_skill_resolver.py::test_tool_namespacing -x` | ❌ Wave 0 |
| SKIL-03 | Version conflict in deps raises error at spawn | unit | `pytest tests/unit/test_skill_resolver.py::test_version_conflict_raises -x` | ❌ Wave 0 |
| SKIL-04 | Regex blocklist detects `ignore previous instructions` | unit | `pytest tests/unit/test_skill_validator.py::test_regex_detects_injection -x` | ❌ Wave 0 |
| SKIL-04 | Clean skill passes validation and gets stamp | unit | `pytest tests/unit/test_skill_validator.py::test_clean_skill_gets_stamp -x` | ❌ Wave 0 |
| SKIL-04 | Stamp hash matches content — changed content invalidates stamp | unit | `pytest tests/unit/test_skill_validator.py::test_stamp_invalidated_on_change -x` | ❌ Wave 0 |
| SKIL-04 | LM layer detects injection that regex misses (mocked LM) | unit | `pytest tests/unit/test_skill_validator.py::test_lm_detects_injection -x` | ❌ Wave 0 |

**Note on Docker-dependent tests:** BASE-01 and BASE-03 require a running Docker daemon. These tests should use `@pytest.mark.e2e` and will only run in CI with Docker available. They can be skipped in local unit runs with `pytest tests/unit/ -x`.

### Sampling Rate
- **Per task commit:** `pytest tests/unit/ -x -q`
- **Per wave merge:** `pytest tests/ libs/ services/ -x -q`
- **Phase gate:** Full suite green (827+ tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test_skill_validator.py` — covers SKIL-04 (regex, LM mock, stamp logic)
- [ ] `tests/unit/test_skill_resolver.py` — covers SKIL-01, SKIL-03 (composition, namespacing, version conflict)
- [ ] `tests/unit/test_config_loader.py` — covers BASE-02, BASE-04 (config.yaml loading, env fallback, routing)
- [ ] `tests/e2e/test_base_image_e2e.py` — covers BASE-01, BASE-03, SKIL-01 CLI (Docker-dependent; needs Docker fixture)
- [ ] `agents/_base/kubex_harness/config_loader.py` — referenced by tests but doesn't exist yet (Wave 0 creates the test; Wave 1/implementation creates the file)
- [ ] `services/kubex-manager/kubex_manager/skill_validator.py` — new module
- [ ] `services/kubex-manager/kubex_manager/skill_resolver.py` — new module
- [ ] `services/kubex-manager/kubex_manager/blocklist.yaml` — seed injection patterns

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `agents/_base/Dockerfile`, `entrypoint.sh`, `standalone.py`, `harness.py`, `main.py`
- Direct code inspection: `libs/kubex-common/kubex_common/schemas/config.py` — current `SkillManifest` definition
- Direct code inspection: `services/kubex-manager/kubex_manager/lifecycle.py` — current `create_kubex()` and Docker SDK pattern
- Direct code inspection: `tests/unit/test_harness_unit.py` — established test patterns (mock Docker, mock httpx, mock subprocess)
- Direct code inspection: `skills/{web-scraping,recall,task-management}/skill.yaml` — current skill file format
- Direct code inspection: `agents/{orchestrator,instagram-scraper}/config.yaml` — current agent config format
- `.planning/phases/05-base-image-and-skill-schema/05-CONTEXT.md` — all locked decisions
- `pyproject.toml` root — pytest config, test markers, ruff/black settings

### Secondary (MEDIUM confidence)
- `CLAUDE.md` project rules — testing standards, coverage requirements, linting rules
- `.planning/REQUIREMENTS.md` — requirement IDs and descriptions

### Tertiary (LOW confidence)
- None — all findings are from direct code inspection or locked decisions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all verified in pyproject.toml files
- Architecture patterns: HIGH — all derived from existing code structure and locked CONTEXT.md decisions
- Pitfalls: HIGH — all derived from actual code inspection (import paths, existing test structure, known edge cases in entrypoint.sh)
- Validation architecture: HIGH — test framework verified in pyproject.toml; Wave 0 gaps derived from non-existent files

**Research date:** 2026-03-13
**Valid until:** 2026-04-12 (stable codebase; 30-day window appropriate)
