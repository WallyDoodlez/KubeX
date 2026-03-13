# Phase 5: Base Image and Skill Schema - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

A single `kubexclaw-base` Docker image that any agent can run, and a finalized skill file schema so downstream components (Manager, policy engine) have a stable contract. This phase delivers the base image, skill schema, skill composition, skill content validation, and config-driven boot. It does NOT deliver the Manager spawn logic (Phase 6) or agent migration (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Skill Composition Rules
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

### Injection Defense Strategy
- **Both layers**: fast regex blocklist pass first, then LM-based review (o3-mini structured analysis) for anything that passes regex
- LM detection can **auto-add new patterns** to the regex blocklist. Auto-added immediately for safety, queued for **human review** (human can remove false positives)
- When injection detected → **ESCALATE to human** (not hard reject). Consistent with policy philosophy
- Validation runs **on catalog add only** (not every mount). Validated skills get a **stamp** (content hash + timestamp + validator version)
- New blocklist patterns trigger a **re-scan of entire catalog**. Any matches get ESCALATED
- Only **.md prompt content** validated for injection (not .yaml manifests — those are schema-validated)
- LM detection uses a **structured analysis prompt** (checks for role hijacking, instruction override, data exfiltration, etc.) returning structured JSON verdict
- **Standalone module**: `kubex_manager.skill_validator` — importable, CLI-callable (`python -m kubex_manager.skill_validator skills/`), testable in isolation
- Regex blocklist stored as **YAML file in repo** (version-controlled)

### Boot-time Config Loading
- **entrypoint.sh installs deps** — reads config.yaml, extracts dependency list, runs pip install / apt-get before starting harness
- **config.yaml is primary**, env vars serve as overrides (backward compatible with current agents during migration)
- Config lists tool names; **tool code lives per-skill** in skill directories (e.g., `skills/web-scraping/tools/`)
- **Fail fast** on dependency installation failure — container exits with clear error, no half-working agents
- **Structured boot summary** logged: loaded skills, active tools, model, capabilities, dependency install results
- **Unified harness entry point** — no more separate standalone.py vs main.py. Single entry point reads config.yaml and routes accordingly
- Config mount path: Claude's discretion

### Skill Schema (skill.yaml)
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

</decisions>

<specifics>
## Specific Ideas

- LM eval at spawn is essentially a "pre-flight check" — think of it like a compiler checking types before running code
- The injection defense is self-improving: LM finds new patterns, adds to blocklist, blocklist catches them faster next time
- "Capable by default, constrained by policy" — skills describe capabilities, policy constrains them. The LM eval bridges the gap by flagging when policy would break a skill
- Validation stamp on skills is like a "signed binary" — once validated, the stamp proves it passed without re-running the full check

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `agents/_base/Dockerfile`: Already builds `kubexclaw-base` (Python 3.12-slim). Needs extension for config-driven boot
- `agents/_base/kubex_harness/standalone.py`: Has `_load_skill_files()` that loads .md from `/app/skills` with sectioned blocks. Needs config.yaml integration
- `agents/_base/entrypoint.sh`: Minimal bootstrap (config copy + skill load + start). Needs dep install + boot summary
- `libs/kubex-common/kubex_common/schemas/config.py`: Has `SkillManifest` Pydantic model (needs rewrite) and `AgentConfig` model (needs tool loading support)
- `skills/data-collection/web-scraping/skill.yaml`: Template for the finalized schema. Has fields to remove (policy, budget, actions) and add (dependencies, capabilities)

### Established Patterns
- Per-agent config.yaml files exist (orchestrator, instagram-scraper, knowledge, reviewer) with prompt, skills, capabilities, models, policy, budget
- `StandaloneConfig` reads from env vars — will become fallback behind config.yaml
- Broker routing uses capability-based consumer groups — skill capabilities feed into this

### Integration Points
- Kubex Manager (Phase 6) will call SkillValidator and use SkillManifest from this phase
- Policy engine gateway already has ESCALATE routing — injection defense connects here
- Reviewer agent (o3-mini) already exists — reused for LM eval and injection detection
- `config.py` AgentConfig model is consumed by Manager and harness — schema changes ripple

</code_context>

<deferred>
## Deferred Ideas

- Skill versioning with backward compatibility (SKIL-05, v2 requirement)
- Skill scaffolding CLI (`kclaw skill create`) (SKIL-06, v2 requirement)
- Health check endpoint in base image (BASE-05, v2 requirement)
- Resource limit profiles per agent type (BASE-06, v2 requirement)

</deferred>

---

*Phase: 05-base-image-and-skill-schema*
*Context gathered: 2026-03-13*
