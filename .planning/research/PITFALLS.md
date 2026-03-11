# Pitfalls Research

**Domain:** Agent container refactor — per-agent Dockerfiles to universal base image with dynamic specialization
**Researched:** 2026-03-11
**Confidence:** HIGH (findings grounded in direct codebase analysis + verified secondary sources)

---

## Critical Pitfalls

### Pitfall 1: Orchestrator Has a Fundamentally Different Runtime, Not Just a Different Config

**What goes wrong:**
The orchestrator (`agents/orchestrator/`) is not a standalone harness agent — it runs `orchestrator_loop.py` directly, not `kubex_harness.standalone`. It also depends on `mcp-bridge`, an `mcp.json` config at `~/.openclaw/mcp.json`, and imports `StandaloneAgent` from the base harness by path. Treating it as "just another kubex-base container with a different config.yaml" will silently produce a container that starts but cannot coordinate workers and has no tool-calling loop.

**Why it happens:**
The refactor goal states "remove per-agent Dockerfiles." That framing implies all agents are equivalent. They are not — the orchestrator has a different CMD, different entrypoint dependencies, and different volume requirements than worker agents. The stem cell model still needs to account for this distinction via config, not by pretending it does not exist.

**How to avoid:**
Define two harness modes in the base image: `standalone` (current worker mode, `python -m kubex_harness.standalone`) and `orchestrator` (tool-use loop, `python -m orchestrator_loop`). The Kubex Manager selects the mode via `KUBEX_HARNESS_MODE` env var injected at spawn. The orchestrator loop and mcp-bridge must be included in the base image, or the base image must support a volume-mounted extension point for the loop module.

**Warning signs:**
- Orchestrator container starts, registers with Registry, but never dispatches any subtasks
- `orchestrator_loop.py` not found as a module — container falls back to standalone harness silently
- Tests in `test_multi_agent.py` pass on the old image but fail on the refactored base image

**Phase to address:**
Phase 1 (Base Image Definition) — decide harness modes before writing any Dockerfile. Do not discover this at the "remove the orchestrator Dockerfile" step.

---

### Pitfall 2: Skill-Mounted Files Are a Prompt Injection Vector — No Validation Today

**What goes wrong:**
`_load_skill_files()` in `standalone.py` recursively reads every `.md` file from `/app/skills` and concatenates them directly into the LLM system prompt with no sanitization, no content hashing, and no integrity check. When skills are injected via volume mount at spawn time, an attacker who can influence which skill files are mounted (or their content) can inject arbitrary instructions into the agent's system prompt. This is documented as a real attack class: "Agent Skills Enable a New Class of Realistic and Trivially Simple Prompt Injections" (arXiv 2510.26328, October 2025).

**Why it happens:**
Skill injection was designed for trusted first-party files baked into agent images. Moving to volume mounts at spawn time expands the trust boundary — the Kubex Manager now controls skill assignment, which means the Manager's spawn API becomes an escalation target: compromise the Manager config, inject a malicious skill file path.

**How to avoid:**
- Policy-gated skill assignment must be enforced server-side in the Kubex Manager, not just documented. The Manager should maintain an allowlist of approved skill paths per capability — it must not blindly mount whatever skill paths arrive in the spawn request.
- Add a skills integrity layer: SHA-256 hash each skill file at build time, store hashes in a manifest, verify at container startup before loading. Reject any skill file that does not match the manifest.
- Sanitize skill content: strip lines beginning with `SYSTEM:`, `IGNORE PREVIOUS`, or other known injection patterns before injecting into the prompt.

**Warning signs:**
- Kubex Manager spawn API accepts arbitrary `skills` paths without validation
- No skill content hash or manifest file in the base image or skills directory
- Agent behavior changes unexpectedly after a skill file is updated without a rebuild

**Phase to address:**
Phase 2 (Kubex Manager Spawn Logic) — integrity checks must be built into the mount mechanism, not added as a follow-on. Do not launch v1.1 with unvalidated skill mounting.

---

### Pitfall 3: In-Memory Kubex Registry State Is Lost on Manager Restart

**What goes wrong:**
`KubexLifecycle` stores all kubex records in `self._kubexes: dict[str, KubexRecord]` — a plain Python dict in memory. If the kubex-manager container restarts (crash, OOM, redeploy), all knowledge of running agent containers is lost. The actual Docker containers keep running, but the Manager cannot stop, restart, or kill them because it has no record of their `container_id`. The Registry still shows them as running. The Broker still dispatches tasks to them. The system appears healthy while being unmanageable.

**Why it happens:**
This was an acceptable MVP shortcut when agents were statically defined in `docker-compose.yml`. With the stem cell model, agents are spawned dynamically — the Manager becomes the authoritative source of truth for which containers exist. Losing that state is now operationally catastrophic.

**How to avoid:**
Persist kubex records to Redis (already available, use a dedicated DB or key prefix like `kubex:record:{kubex_id}`). On Manager startup, reconcile: query Docker for all containers with label `kubex.managed=true`, rebuild `self._kubexes` from Docker inspect data, re-register any survivors with the Registry. This is a state reconciliation loop, not optional.

**Warning signs:**
- Manager container has `restart: unless-stopped` and restarts after an OOM kill — suddenly `list_kubexes` returns empty
- `stop_kubex` or `kill_kubex` raises `KeyError` for containers that Docker still shows as running
- Agent count in Registry does not match `docker ps | grep kubex` output after a manager restart

**Phase to address:**
Phase 2 (Kubex Manager Spawn Logic) — before dynamic spawning ships, persistence must be in place. A stateless manager is only safe when agents are statically composed.

---

### Pitfall 4: Docker Network Name Hardcoded as `openclaw_kubex-internal` — Breaks in Different Environments

**What goes wrong:**
`lifecycle.py` reads `KUBEX_DOCKER_NETWORK` from env, defaulting to `NETWORK_INTERNAL` from `kubex_common.constants`. The `docker-compose.yml` creates the network as `kubex-internal` but Docker Compose prefixes it with the project name, producing `openclaw_kubex-internal`. The Manager must use this prefixed name when spawning containers. If the project name changes (different checkout directory, CI environment, staging prefix), the hardcoded or env-provided network name breaks and spawned containers cannot reach any other service. This has already burned the project once (noted in `docker-learnings.md`: "Docker Compose prefixes network names: `openclaw_kubex-internal`").

**Why it happens:**
The network name is an infrastructure detail that leaks into application code. In the per-agent-Dockerfile world, containers were defined in `docker-compose.yml` and Docker Compose handled network assignment automatically. With dynamic spawning via Docker SDK, the Manager must specify the network name explicitly — and that name is environment-dependent.

**How to avoid:**
At Manager startup, resolve the real network name dynamically: call `docker.from_env().networks.list(filters={"label": "com.docker.compose.network=kubex-internal"})` and use the returned network ID/name. Never hardcode or statically configure the prefixed network name — derive it at runtime from Docker labels.

**Warning signs:**
- Spawned container appears healthy in `docker ps` but cannot reach Gateway or Broker
- `docker inspect <container_id>` shows empty or wrong networks
- Integration tests pass locally but fail in CI with a different project directory name

**Phase to address:**
Phase 2 (Kubex Manager Spawn Logic) — network name resolution must be implemented before any dynamic spawning test runs in CI.

---

### Pitfall 5: Runtime `pip install` by Agents Creates an Unaudited, Mutable Container Surface

**What goes wrong:**
The stem cell design allows agents to request runtime dependencies (e.g., `pip install beautifulsoup4`) through the policy pipeline. If approved, the agent modifies its own running container. This breaks container immutability and creates three problems: (1) the installed package is not present on container restart — the agent re-requests and re-installs on every cold start; (2) the package is fetched from PyPI at agent runtime, exposing the system to supply-chain attacks (PyPI had multiple coordinated malicious package campaigns in 2025); (3) there is no audit trail of what was installed in which container run.

**Why it happens:**
Runtime dependency requests are a natural consequence of the stem cell philosophy — "if a Kubex needs tools, it requests them." The philosophy is sound for orchestration-level decisions, but applying it to package installation conflates capability gating with package management.

**How to avoid:**
Separate the two concerns. The base image should include a curated set of commonly needed packages (`requests`, `httpx`, `beautifulsoup4`, `lxml`, `playwright`, common data libs). Runtime pip install should only be permitted for packages on a Manager-maintained allowlist, with pinned versions and SHA-256 hashes verified before installation. Better: treat "this agent needs package X" as a signal to add X to the base image — not to install it at runtime. Reserve runtime installs for exceptional cases gated by ESCALATE + human approval.

**Warning signs:**
- Agent startup time increases significantly because it re-installs packages on every boot
- Agent fails intermittently because PyPI is unreachable or rate-limits the request
- `pip install` appears in agent logs without a corresponding policy approval record
- A PyPI package in the allowlist is flagged in a CVE feed

**Phase to address:**
Phase 3 (Policy-Gated Runtime Dependencies) — the allowlist and pinned-version mechanism must be designed before the runtime dependency request feature is built. Do not implement the feature and add the allowlist as a follow-on.

---

### Pitfall 6: `KUBEX_CAPABILITIES` Is the Only Broker Routing Key — Skills Must Not Change It

**What goes wrong:**
The Broker routes tasks to agents using consumer groups keyed on capability names (e.g., `scrape_instagram`, `task_orchestration`). `KUBEX_CAPABILITIES` is injected as an env var at spawn time. If the skill injection process also modifies capabilities (or if a skill file declares new capabilities in a format the harness reads), a spawned agent can start consuming from capability queues it was not authorized for. Tasks intended for a different agent type get consumed by the wrong agent.

**Why it happens:**
Skills are injected into the system prompt as markdown. The harness currently reads capabilities only from env vars. But future skill files could include structured metadata (YAML front matter, capability declarations), and a developer might add a feature to "auto-register capabilities from skill files." This is a well-intentioned feature that breaks the authorization model.

**How to avoid:**
Capabilities must be set exclusively by the Kubex Manager at spawn time via env vars, derived from the agent's `config.yaml`. Skills must be prompt-only — no structured metadata that the harness parses for capability declarations. Add a linter/test that asserts skill files contain only markdown text with no YAML front matter or `KUBEX_CAPABILITIES:` directives.

**Warning signs:**
- An agent registers with unexpected capabilities in the Registry
- Tasks route to an agent type that was not designed to handle them
- `KUBEX_CAPABILITIES` in a running container differs from what the Manager injected

**Phase to address:**
Phase 1 (Base Image Definition) — the capability/skill boundary must be documented as an invariant before any skill file format is extended.

---

### Pitfall 7: The 703 Existing Tests Test Per-Agent Image Behavior — Not Base Image + Volume Behavior

**What goes wrong:**
All existing E2E and integration tests (`test_worker_agents.py`, `test_kubex_manager.py`, `test_reviewer_e2e.py`, etc.) were written against agents built from per-agent Dockerfiles. They mock the Docker SDK, not volume mounts. When the refactor ships, tests may pass against the mocked layer while the actual base image behavior (skill loading from mounted volumes, config injection via env, entrypoint differences) is untested. The suite is green but the live system is broken.

**Why it happens:**
Test infrastructure built for a specific architecture does not automatically validate a different architecture. The mocks in `test_kubex_manager.py` stub `docker.from_env()` entirely — they don't exercise real skill file loading, real entrypoint behavior, or real volume semantics.

**How to avoid:**
Add a dedicated base image integration test suite that runs against a real Docker daemon (not mocked). At minimum: (1) build `kubexclaw-base` locally; (2) spawn it with a test skill file mounted at `/app/skills/`; (3) verify the skill content appears in the system prompt sent to the LLM mock; (4) verify that missing required env vars (`KUBEX_AGENT_ID`) cause the container to exit with a non-zero code rather than silently running with defaults. These tests run against `docker-compose.test.yml`.

**Warning signs:**
- All unit tests pass but the live system behaves unexpectedly after the refactor
- No test in the suite actually builds and runs the `kubexclaw-base` image
- Skill file content does not appear in LLM prompts captured in integration logs

**Phase to address:**
Phase 1 (Base Image Definition) — write the base image integration tests before finalizing the Dockerfile. Use them to drive the Dockerfile design (red-green cycle as per `implement-feature` skill).

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep orchestrator as its own Dockerfile during transition | Unblocks worker refactor, reduces scope | Permanent divergence — orchestrator stays as special case forever | Only if scoped as explicit technical debt with a follow-up milestone task |
| Mount skills read-write (easier to debug) | Developer can hot-edit skills without rebuild | Agent can overwrite its own skill files; breaks immutability | Never in production |
| Accept arbitrary skill paths in spawn API | Flexible for development | Prompt injection escalation path | Never — enforce allowlist from day one |
| Store `pip install` results in ephemeral container layer | Works for one run | Re-install on every start; supply chain exposure | Never — use base image layers or allowlisted pinned install |
| Use project-name-prefixed network string as a constant | Simple initial implementation | Breaks in every environment except local dev | Only during local development, must be replaced before CI integration |
| Skip skill integrity check for first-party skills | Faster to ship | Sets a precedent that all skills are trusted; no mechanism for third-party skills later | MVP only if skills are never user-provided |

---

## Integration Gotchas

Common mistakes when connecting to the Docker daemon and internal services from the Kubex Manager.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Docker SDK network assignment | Pass `KUBEX_DOCKER_NETWORK` as a static env var | Resolve network name at startup by querying Docker labels |
| Docker SDK container creation | Create + start in one call | `containers.create()` then `container.start()` — allows policy checks between create and start |
| Registry deregistration | Skip deregister on kill (container is dead anyway) | Always deregister — Registry state outlives the container |
| Skill volume mounts | Mount the entire `./skills` directory | Mount only the specific capability subdirectory the agent is authorized for |
| Config YAML at spawn | Bake config into image at build time | Mount config as a read-only volume or inject via env — config must be externalized for stem cell model |
| `KUBEX_MGMT_TOKEN` env var | Use `MANAGER_TOKEN` (wrong var name) | Use `KUBEX_MGMT_TOKEN` — the Manager auth middleware checks this key specifically |

---

## Performance Traps

Patterns that work at small scale but fail as agent count grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `docker.from_env()` called on every Manager API request | Manager API latency spikes under load | Create one `docker.DockerClient` at startup, reuse it | ~10+ simultaneous spawns |
| Skill files loaded and concatenated on every task iteration | High per-task latency when many skills are mounted | Load skills once at harness startup into `StandaloneConfig`, cache in memory | 5+ skill files, tasks < 2s LLM latency |
| `list_kubexes()` returns in-memory dict, no Docker reconciliation | Stale data after container crashes | Periodic background reconciliation task in Manager | Any container crash not caught by Manager |
| Full skills directory mounted per-agent | Docker volume mount overhead multiplied by agent count | Per-capability subdirectory mounts, not full tree | 20+ simultaneous agents |

---

## Security Mistakes

Domain-specific security issues beyond general container hardening.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Skills mounted read-write | Agent can modify its own system prompt for future tasks | Always mount skill directories `:ro` (read-only) |
| Runtime pip install from PyPI without hash verification | Supply chain attack — malicious package installs credential-harvesting code | Pin versions + SHA-256 hashes in allowlist; consider private mirror |
| Skill content not validated before prompt injection | Attacker-controlled skill content can override system-level instructions | Content hash check at startup; strip known injection patterns |
| Spawned containers placed on `kubex-external` network | Worker agents can reach the internet directly, bypassing egress policy | Workers must only be on `kubex-internal`; egress goes through Gateway policy engine |
| Agent ID set by the agent itself via env var override | Agent can impersonate another agent_id to bypass capability-based policy | `KUBEX_AGENT_ID` must only be set by the Manager at spawn — not overridable from within the container |
| Skills directory outside the Manager-controlled path mounted | Developer convenience mount exposes arbitrary file paths as skill content | Kubex Manager must enforce that all skill mounts originate from `./skills/` in the project root |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Base image built:** Verify the CMD is `python -m kubex_harness.standalone` and that running it without `KUBEX_AGENT_ID` exits non-zero rather than hanging
- [ ] **Skill injection works:** Verify skill content appears in the `system` message sent to the LLM — not just that the file was loaded without errors
- [ ] **Orchestrator refactored:** Verify `orchestrator_loop.py` runs inside the base image, not just that a container starts (it may fall through to standalone harness silently)
- [ ] **Network connectivity:** Verify a dynamically spawned agent container can reach `http://gateway:8080/health` after spawn — not just that Docker created the container
- [ ] **Backward compatibility:** Run the full 703-test suite against the refactored images, not against mocks — at least the integration and E2E tiers
- [ ] **Config externalization:** Verify that `config.yaml` is not baked into the base image — spawned containers must get their config from a volume mount or env var, not a stale baked version
- [ ] **Registry reconciliation:** Verify that after a Manager restart, running agent containers are re-discovered and re-registered in the Registry
- [ ] **Policy enforcement on spawn:** Verify that spawning an agent with unauthorized skill paths is rejected by the Manager, not just by the file system

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orchestrator silently runs as standalone harness | HIGH | Stop orchestrator container; add `KUBEX_HARNESS_MODE` env var; rebuild base image with orchestrator loop; restart |
| Manager state lost after restart | MEDIUM | Query `docker ps --filter label=kubex.managed=true`; manually re-register surviving agents via Registry API; restart Manager with persistence enabled |
| Skill injection prompt injection discovered in production | HIGH | Emergency kill all agent containers; audit all skill files; rebuild base image with content validation; redeploy with skill integrity check enabled |
| Network name mismatch breaks all dynamic spawns | MEDIUM | Set `KUBEX_DOCKER_NETWORK` env var to correct prefixed name in kubex-manager service; restart Manager (no rebuild required) |
| Runtime pip install installs compromised package | HIGH | Kill affected container immediately; block package in policy allowlist; rotate any credentials the container had access to; audit Gateway proxy logs for anomalous requests |
| Wrong capability consumed by wrong agent type | MEDIUM | Purge affected Redis consumer group; restart affected agent with correct capabilities; audit task results for any incorrectly processed tasks |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Orchestrator has a different runtime | Phase 1 — Base Image Definition | E2E test: orchestrator container dispatches subtasks end-to-end |
| Skill files are a prompt injection vector | Phase 2 — Kubex Manager Spawn Logic | Security test: malicious content in skill file does not propagate to LLM system prompt |
| Manager state lost on restart | Phase 2 — Kubex Manager Spawn Logic | Integration test: restart manager, verify running containers are re-discovered |
| Docker network name hardcoded | Phase 2 — Kubex Manager Spawn Logic | Integration test: spawned container reaches Gateway health endpoint |
| Runtime pip install supply chain | Phase 3 — Policy-Gated Runtime Dependencies | Policy test: unapproved package install returns DENY; approved but unverified hash returns ESCALATE |
| Skills change capabilities | Phase 1 — Base Image Definition | Unit test: skill files containing YAML front matter fail a CI linter |
| Existing tests do not cover base image behavior | Phase 1 — Base Image Definition | CI gate: base image integration test suite added before Dockerfiles are removed |

---

## Sources

- Direct codebase analysis: `agents/_base/Dockerfile`, `agents/orchestrator/Dockerfile`, `agents/instagram-scraper/Dockerfile`, `agents/reviewer/Dockerfile`, `agents/knowledge/Dockerfile`
- Direct codebase analysis: `agents/_base/kubex_harness/standalone.py` — `_load_skill_files()` implementation, no content validation
- Direct codebase analysis: `services/kubex-manager/kubex_manager/lifecycle.py` — in-memory `_kubexes` dict, hardcoded network constant
- Direct codebase analysis: `agents/orchestrator/config.yaml`, `agents/instagram-scraper/config.yaml` — capability/skill structure
- Direct codebase analysis: `docker-compose.yml` — network naming, `KUBEX_DOCKER_NETWORK` env var
- [Agent Skills Enable a New Class of Realistic and Trivially Simple Prompt Injections](https://arxiv.org/html/2510.26328v1) — skill-file prompt injection attack class (October 2025)
- [Secure AI Agents at Runtime with Docker](https://www.docker.com/blog/secure-ai-agents-runtime-security/) — container runtime security for AI agents
- [The PyPI Supply Chain Attacks of 2025](https://medium.com/@joyichiro/the-pypi-supply-chain-attacks-of-2025-what-every-python-backend-engineer-should-learn-from-the-875ba4568d10) — runtime pip install risk
- [OWASP Top 10 for LLMs 2025: LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — prompt injection as primary LLM attack vector
- Project memory: `docker-learnings.md` reference — "Docker Compose prefixes network names: `openclaw_kubex-internal`" (known prior incident)

---
*Pitfalls research for: KubexClaw v1.1 Stem Cell Kubex refactor — per-agent Dockerfiles to universal base image*
*Researched: 2026-03-11*
