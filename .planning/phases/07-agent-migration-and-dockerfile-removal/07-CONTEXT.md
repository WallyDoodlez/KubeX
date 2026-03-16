# Phase 7: Agent Migration and Dockerfile Removal - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

All four existing agents (orchestrator, instagram-scraper, knowledge, reviewer) run on `kubexclaw-base` with skill mounts, per-agent Dockerfiles are deleted, StandaloneConfig is removed, and the full test suite passes against the refactored stack. A hello-world template agent proves the stem cell promise end-to-end. This phase does NOT add new agent types or capabilities.

</domain>

<decisions>
## Implementation Decisions

### Orchestrator Migration Strategy
- **Rename skills to match skill directories** — update orchestrator config.yaml to reference actual skill directory names (not action names like "dispatch_task")
- **Dependencies come from skill manifests** — each orchestrator skill's manifest.yaml declares pip deps; ConfigBuilder unions them; entrypoint.sh installs at boot
- **Move tools to skill directories** — orchestrator's 8 tools (dispatch_task, cancel_task, etc.) become tool implementations inside skill directories; harness discovers from config.yaml
- **Prompt moves to SKILL.md** — orchestrator's system prompt moves from config.yaml prompt field to skills/orchestration/task-management/SKILL.md
- **Skill directory: skills/orchestration/task-management/** — new "orchestration" category; contains all 8 tools, manifest, and SKILL.md as one monolithic skill
- **MCP bridge code moves to skill** — httpx Gateway client moves to orchestration skill's tools/ directory; any agent with the orchestration skill gets MCP bridge
- **Agent dir keeps config.yaml + policies/policy.yaml** — current structure preserved, just no Dockerfile

### Reviewer Agent Scope
- **Include reviewer in Phase 7** — migrate all 4 agents (not just the 3 in MIGR-01..03); complete the stem cell vision in one phase
- **Model from reviewer's config.yaml** — o3-mini is set in agents/reviewer/config.yaml; consistent with Phase 6 decision that agent config owns model choice
- **Reviewer gets a skill directory** — skills/security/review/ with SKILL.md (reviewer prompt), manifest.yaml (capabilities: security_review); consistent with all other agents
- **Migration is straightforward** — reviewer already FROM kubexclaw-base; just delete Dockerfile, ensure config.yaml + skill dir cover everything

### StandaloneConfig Removal
- **Require config.yaml always** — harness fails fast if no /app/config.yaml; no fallback to env vars
- **Remove StandaloneConfig completely** — delete the class entirely; clean break, no legacy code
- **Fixed path /app/config.yaml** — no env var for config path; always reads from /app/config.yaml inside the container
- **Minimum valid config: agent.id + model required, rest optional** — capabilities, skills, tools default to empty; good for simple test cases
- **No env var overrides** — config.yaml is the sole source of truth; no KUBEX_AGENT_ID or GATEWAY_URL env var overrides; mount a different file for different config

### docker-compose.yml Restructure
- **Keep agents as Compose services** — each agent stays as a named service with image: kubexclaw-base + volume mounts; operator controls which agents run via Compose
- **Mount only needed skill dirs** — each agent lists specific skill mounts (e.g., `./skills/data-collection/web-scraping:/app/skills/web-scraping:ro`); agent only sees its skills
- **Config bind-mounted from agent dir** — `./agents/orchestrator/config.yaml:/app/config.yaml:ro`; config stays in agent directory on host
- **Tests don't use Compose** — tests use mocks/fakeredis, not real containers; docker-compose.test.yml is for manual integration testing only
- **Build base first via depends_on** — add kubexclaw-base build service in docker-compose.yml; agent services depend on it; Compose builds base first
- **Keep current directory structure** — agents/orchestrator/ contains config.yaml + policies/policy.yaml; no Dockerfile; clean and minimal

### Dockerfile Deletion Safety
- **Delete in same commit** — update compose + delete Dockerfiles in one atomic commit; tests prove it works; revert if tests fail
- **All-or-nothing** — either all 4 agents migrate or none do; no partial migration

### New Agent Spawn Experience
- **Manager API spawns** — operator creates skill dir + config.yaml, calls Manager API `POST /kubexes` with config; no compose changes needed for dynamic agents
- **Include hello-world E2E test** — E2E test creates minimal skill + config, calls Manager API, verifies agent boots; proves stem cell promise
- **Commit hello-world as template** — skills/examples/hello-world/ + agents/hello-world/config.yaml committed as reference; operators copy and modify for new agents

### Test Migration Strategy
- **Separate migration plan** — dedicated plan just for test migration; clean separation from red/green plans
- **One batch via conftest fixture** — session-scoped conftest.py fixture generates default config.yaml for all tests; tests that need custom config override the fixture
- **Write real file to tmp_path** — fixture creates actual config.yaml in tmp_path; monkeypatches config path to point there; exercises real file-reading code path

### Claude's Discretion
- Exact conftest fixture implementation details
- Which env vars to remove from docker-compose.yml agent services
- Ordering of skill tool files within orchestration skill directory
- Hello-world agent skill content and manifest details
- Test migration plan ordering within the phase

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `agents/_base/Dockerfile`: Builds kubexclaw-base image; all agents will reference this
- `agents/_base/entrypoint.sh`: Reads config.yaml, installs deps, starts harness; already handles the boot flow
- `agents/_base/kubex_harness/standalone.py`: Has `_load_skill_files()` and config_loader; needs StandaloneConfig removal
- `services/kubex-manager/kubex_manager/config_builder.py`: ConfigBuilder from Phase 6; assembles container create params
- `services/kubex-manager/kubex_manager/lifecycle.py`: 8-step atomic spawn pipeline from Phase 6; already wires skill mounts + config

### Established Patterns
- Per-agent config.yaml files already exist for all 4 agents (orchestrator, instagram-scraper, knowledge, reviewer)
- instagram-scraper and knowledge Dockerfiles already FROM kubexclaw-base — migration is minimal
- Orchestrator Dockerfile is FROM python:3.12-slim — needs full conversion
- Skills use category/name directory structure (skills/{category}/{name}/)
- Skill manifests declare capabilities, tools, dependencies, egress_domains

### Integration Points
- docker-compose.yml: 4 agent services need build → image + volumes conversion
- `StandaloneConfig` in harness: referenced by config_loader and standalone.py; removal ripples through tests
- `conftest.py` files: root and per-directory; session fixture goes in root conftest
- Manager spawn pipeline (Phase 6): already handles skill resolution, config build, policy check; used for dynamic spawning

</code_context>

<specifics>
## Specific Ideas

- "If we decide to respawn or duplicate a kubex, we can simply reuse the saved config" — Phase 6 persistent configs enable this
- Hello-world template agent should be minimal enough that an operator can read the whole thing in 2 minutes and understand how to make a new agent
- Orchestrator migration is the hardest part — it has a custom Dockerfile, inline prompt, action-name skills, and 8 baked-in tools
- The all-or-nothing approach means the migration commit is large but the system is never in a half-migrated state

</specifics>

<deferred>
## Deferred Ideas

- Dynamic agent spawning via Manager API without Compose — works today (Phase 6), but standard fleet stays in Compose for now
- Per-agent resource limits in Compose — resource limits come from agent config, not Compose; can add later
- Skill scaffolding CLI (`kclaw skill create`) — v2 requirement (SKIL-06)
- Health check endpoint in base image — v2 requirement (BASE-05)

</deferred>

---

*Phase: 07-agent-migration-and-dockerfile-removal*
*Context gathered: 2026-03-16*
