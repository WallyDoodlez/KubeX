# Feature Research

**Domain:** Agent container platform with dynamic skill-based specialization (Stem Cell Kubex architecture)
**Researched:** 2026-03-11
**Confidence:** HIGH — findings grounded in existing project docs (v1.0 implementation) + ecosystem research

---

## Feature Landscape

### Table Stakes (Architecture Doesn't Work Without These)

These are the minimum features for the stem cell refactor to be coherent. Missing any one
of them collapses the core promise ("any Kubex can become any agent — new capabilities are
skill files, not Docker builds").

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Universal base image** (`kubexclaw-base`) | The entire premise. Without a single base, there is no stem cell — just renamed per-agent images. | MEDIUM | One Dockerfile, built once, used by all agents. Existing per-agent images (orchestrator, instagram-scraper, knowledge) must be retired. |
| **Skill file mounting at spawn** | Skills as volume mounts are the identity mechanism. If skills are baked into the image, you need image rebuilds for new capabilities. | MEDIUM | Kubex Manager mounts `/app/skills/*.md` as read-only bind mounts when creating the container. Already works in standalone harness; Kubex Manager must drive it. |
| **Harness auto-load of mounted skills** | The agent harness must consume whatever is in `/app/skills/` — not a hardcoded list. | LOW | Already implemented in `kubex-common`. Refactor is making Kubex Manager responsible for what gets mounted, not the harness. |
| **Config-driven agent identity** | Agent capabilities, model, and policy must come from injected `config.yaml`, not from baked-in code. | MEDIUM | Kubex Manager generates `config.yaml` from merged skill manifests at spawn time. Each skill's `skill.yaml` contributes capabilities, policies, and resource requirements. |
| **Skill manifest schema** (`skill.yaml`) | Kubex Manager needs a machine-readable definition of what each skill requires (actions, resources, policy constraints, composition rules) to safely assemble a container config. | MEDIUM | Schema defined in `docs/skill-catalog.md`. Fields: capabilities.actions (union), policy (most restrictive wins), resources (additive or max), composition (depends_on, incompatible_with). |
| **Skill composition engine** | Multi-skill agents are the primary use case. Merging capabilities (union), policies (most restrictive), and resources correctly is non-trivial. | MEDIUM | Action union, policy-most-restrictive-wins, resource stacking, conflict detection, dependency resolution. Logic lives in Kubex Manager spawn handler. |
| **Policy-gated skill injection** | Skill assignment must go through the policy engine. Boundary-level allowlists and global blocklists prevent unauthorized capability escalation. | MEDIUM | Two layers: boundary allowlists (which skills a boundary's Kubexes can receive) and global blocklists (operator emergency block). Existing Gateway policy engine is the enforcement point. |
| **Backward compatibility — all 703+ tests pass** | Refactor must not break the working v1.0 system. If existing tests break, the refactor has introduced regressions, not just restructured. | HIGH | This is the hardest constraint. Orchestrator, instagram-scraper, and knowledge agents change their packaging but must behave identically from the perspective of every existing test. |
| **Graceful shutdown with task drain** | If a container exits mid-task without draining, work is silently lost. Single base image means all agents share the same shutdown path. | MEDIUM | SIGTERM handler in `kubex-common`: stop consuming new tasks, complete current task (30s grace), emit `report_result` with `interrupted` status if grace expires, report `draining` health status. |
| **Health check polling during boot** | Kubex Manager must know when a stem cell has finished specializing and is ready to accept work. | LOW | Poll `/health` every 5s, timeout after 120s. Endpoint returns `starting` during init, `healthy` when ready, `draining` during shutdown. Already specified in `docs/kubex-manager.md`. |
| **Remove per-agent Dockerfiles** | The explicit goal of v1.1. If per-agent Dockerfiles remain alongside `kubexclaw-base`, you have the worst of both worlds: maintenance burden + conceptual confusion. | LOW | Delete `agents/orchestrator/Dockerfile`, `agents/instagram-scraper/Dockerfile`, `agents/knowledge/Dockerfile` after base image is validated. Update docker-compose to reference `kubexclaw-base` for all three. |

---

### Differentiators (Stem Cell Architecture Competitive Advantages)

These features go beyond "a container that loads some config" and realize the deeper value
of the stem cell model. Not every agent platform has them. They are what make KubexClaw
worth operating vs a simpler multi-container setup.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Policy-gated runtime dependency requests** | Agents can request capabilities (e.g., `pip install`, system tools) they weren't pre-loaded with — the policy engine decides allow/deny/escalate. Unknown actions escalate to reviewer rather than silently fail. This means the skill catalog is not a hard ceiling; agents can discover needs at runtime. | HIGH | Requires: action pipeline already exists. New work: policy rules for runtime-install class actions, reviewer routing for unknown action classes, audit logging of what was installed and when. |
| **Skill composition with conflict/dependency resolution** | Assigning multiple skills to one Kubex and having the system resolve capability unions, policy intersections, and resource stacking automatically. Operators declare intent ("this agent needs web-scraping and research"), the system resolves correctness. | MEDIUM | Conflict detection (`incompatible_with`), dependency satisfaction (`depends_on`), resource stacking (`additive` vs `max` modes). Described in `docs/skill-catalog.md` Section 3. |
| **Skill versioning and per-Kubex pinning** | Running Kubexes are pinned to the skill version deployed. Updates require explicit restart. Major version bumps require removal + redeploy. This gives operators control over rollout cadence without forcing all agents to always take latest. | MEDIUM | SemVer on `skill.yaml`. Kubex Manager stores the deployed version alongside the container. `kubexclaw agents restart` picks up latest compatible minor/patch; major upgrade requires explicit op. |
| **Anti-collusion reviewer model architecture** | The reviewer (security escalation path) uses a different model provider than workers. This is enforced at the Gateway level via model allowlists — a worker cannot impersonate the reviewer because the Gateway rejects the wrong provider on the reviewer boundary. | HIGH (design) / LOW (in code — already implemented) | Already implemented in v1.0. The stem cell refactor must preserve this: `kubexclaw-base` is neutral, the reviewer specializes at spawn with the reviewer skill + an OpenAI model config — different provider from worker Kubexes. |
| **Single security surface — one base image to patch** | When a CVE hits (e.g., the February 2026 OpenClaw cluster, CVE-2026-25253), you rebuild one image and replace all containers. With per-agent images, you rebuild N images and hope you catch all of them. | MEDIUM | Practical benefit: `docker build -t kubexclaw-base .` + rolling container replacement. Kubex Manager handles the rolling replacement logic. |
| **Capability discovery via Registry** | Workers advertise capabilities to the Registry at boot. Orchestrator queries the Registry to find who can handle a subtask. New agent types are discoverable without any Orchestrator config changes — the Orchestrator finds them automatically at next task dispatch. | MEDIUM (already implemented) | Preserve through refactor. The capability list registered must still come from the spawned skills, not a hardcoded list. |
| **Skill scaffolding CLI** | `kubexclaw skills create my-skill` generates the full directory scaffold (`skill.yaml`, `AGENTS.md`, `tools/`, `README.md`). Lowers the barrier to writing a new agent type from "write a Dockerfile + understand build pipeline" to "fill in a template". | LOW | Defined in `docs/skill-catalog.md` Section 5. Deferred from v1.0; natural v1.1 addition given the stem cell focus. |
| **Custom skill validation at deploy time** | Before spawning a Kubex with a custom skill, validate: schema compliance, action names exist in the ActionType enum, providers are configured, resources within host capacity, no composition conflicts. Fail fast with a human-readable error rather than spawning a broken container. | MEDIUM | Five validation steps. Prevents the "deployed but silently broken" failure mode. |

---

### Anti-Features (Deliberately NOT Building)

These features are commonly requested or seem logical but would undermine the stem cell
architecture, the security model, or the scope of v1.1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Per-agent Dockerfiles (keep existing ones "just in case")** | Fear of regression; familiar pattern; feels like a safety net. | Defeats the architecture. If per-agent images exist alongside `kubexclaw-base`, operators will use them for "exceptions," eroding the single-image principle over time. Maintenance overhead doubles. | Delete them after base image is validated against all existing tests. The tests are the safety net, not the Dockerfiles. |
| **Baking skill content into the base image** | Faster boot (no mount needed), simpler container creation. | Collapses the stem cell model. Any new skill or skill update requires a base image rebuild and redeploy of all running agents. The image becomes an "almost base" that still couples agents to build pipelines. | Volume mounts. Cold start from a cached image + mounted `.md` files is ~5s per the kubernetes.recipes article. |
| **Real-time skill hot-swap on running containers** | Appealing as zero-downtime specialization — change what a Kubex does without restarting it. | Unpredictable state. The LLM's system prompt is set at init. Mid-run prompt injection from new skill mounts is a prompt injection vector and creates split-brain behavior (the LLM's self-model doesn't match its current skill set). | Graceful drain + restart. SIGTERM → drain current task → restart with new skills. Takes ~35s. |
| **Agent self-modification of skill loadout** | "An agent could request new skills for itself based on what it encounters." | Privilege escalation path. If agents can modify their own skill assignments, a compromised agent can expand its own capability set without operator approval. | Runtime dependency requests flow through the policy pipeline (ESCALATE path). Operators approve capability expansion, not agents. |
| **Skill content fetched from the internet at spawn** | Dynamic skill sourcing from GitHub, npm, etc. would allow skills to be written and deployed without touching the repo. | Supply chain attack surface. A compromised skill source injects malicious instructions into the LLM system prompt at spawn. The February 2026 finding about SKILL.md prompt injection via descriptor files confirms this is an active attack vector. | Skills live in the repo. CI/CD validates and scans them. Skill updates go through the same PR/review process as code changes. |
| **Per-skill Docker images (multi-stage specialization)** | "Build a base + skill-specific layers for faster boot times." | Reintroduces N images for N skill combinations. Doesn't scale combinatorially. Breaks the single-image patch story. | One base image + file mounts. The boot-time cost is negligible (file reads, not package installs). |
| **SSE progress streaming (v1.2 scope)** | Operators want real-time task progress in the terminal. | Out of scope for v1.1. The stem cell refactor is infrastructure, not a UX feature. Adding SSE would expand scope and delay the refactor's primary goal. | Defer to v1.2. `kclaw.py logs` works for now. |
| **Live Graphiti/OpenSearch backend (v1.2 scope)** | Knowledge base mocks feel incomplete. | Same scope boundary. v1.1 is a refactor, not a feature expansion. Wiring live backends changes the knowledge agent's behavior, which could mask refactor regressions. | Keep mocks in tests. Wire live backends in v1.2 after the stem cell refactor is stable. |

---

## Feature Dependencies

```
Universal base image (kubexclaw-base)
    └──required by──> Skill file mounting at spawn
                          └──required by──> Harness auto-load of mounted skills
                                                └──required by──> Config-driven agent identity
                                                                      └──required by──> Skill manifest schema (skill.yaml)
                                                                                            └──required by──> Skill composition engine
                                                                                                                  └──required by──> Policy-gated skill injection

Skill manifest schema (skill.yaml)
    └──enables──> Skill versioning and per-Kubex pinning
    └──enables──> Custom skill validation at deploy time
    └──enables──> Skill scaffolding CLI

Graceful shutdown with task drain
    └──required by──> Backward compatibility (703+ tests)
                           └──required by──> Remove per-agent Dockerfiles

Policy-gated skill injection
    └──enhances──> Policy-gated runtime dependency requests
                       └──requires──> Anti-collusion reviewer architecture (already implemented)

Capability discovery via Registry
    └──requires──> Config-driven agent identity
                       (skills define capabilities advertised to Registry at boot)
```

### Dependency Notes

- **Base image requires skill mounts:** Without file mounts, a single image cannot differentiate agents. This is the foundational dependency of the entire feature set.
- **Backward compatibility gates removal of per-agent Dockerfiles:** The per-agent Dockerfiles must not be deleted until all 703+ tests pass against `kubexclaw-base` with the same skill injections. Tests are the go/no-go signal.
- **Skill manifest schema gates composition engine:** The composition engine (action union, policy intersection, resource stacking) reads from `skill.yaml`. Schema must be finalized before the composition logic is implemented.
- **Graceful shutdown conflicts with hot-swap:** These are mutually exclusive design choices. Graceful drain + restart is the chosen path (see anti-features). Hot-swap is explicitly not built.
- **Policy-gated injection enhances runtime dependency requests:** The same policy engine that gates skill assignment at spawn also gates runtime capability expansion. The ESCALATE path is the safety net for both.

---

## MVP Definition

This is the v1.1 milestone. "MVP" here means minimum implementation to achieve the stem cell
architecture with all existing tests passing.

### Launch With (v1.1)

- [x] Universal base image — single `kubexclaw-base` from which all agents are spawned
- [x] Skill file mounting at spawn — Kubex Manager assembles `/app/skills/` bind mounts at container creation
- [x] Harness auto-load — `kubex-common` loads all `*.md` from `/app/skills/` into LLM system prompt (already works; verify it works under Kubex Manager control)
- [x] Skill manifest schema — `skill.yaml` schema for the 3 existing agents (orchestrator, scraper, knowledge) + initial skill catalog
- [x] Skill composition engine — action union, policy-most-restrictive-wins, resource stacking, conflict/dependency detection
- [x] Policy-gated skill injection — boundary allowlists, global blocklists enforced before container creation
- [x] Config-driven agent identity — `config.yaml` generated from merged skill manifests at spawn time
- [x] Graceful shutdown with task drain — SIGTERM handler in `kubex-common`, 30s task completion grace, `draining` health status
- [x] Health check polling — Kubex Manager polls `/health` every 5s, timeout 120s
- [x] Remove per-agent Dockerfiles — after base image validated against all 703+ tests
- [x] Backward compatibility — all existing E2E, integration, and unit tests pass

### Add After Validation (v1.x)

- [ ] Skill versioning and per-Kubex pinning — add when operators need controlled skill update rollout (v1.2 candidate)
- [ ] Skill scaffolding CLI — add when the skill catalog grows beyond 5 skills and manual creation becomes friction (v1.2 candidate)
- [ ] Custom skill validation at deploy time — add when external contributors start writing skills and schema violations become common
- [ ] Policy-gated runtime dependency requests — add when an agent legitimately needs a package not in the base image (trigger: first real-world escalation for this reason)

### Future Consideration (v2+)

- [ ] SSE progress streaming — deferred explicitly in PROJECT.md, v1.2 scope
- [ ] Live Graphiti/OpenSearch backend integration — deferred, v1.2 scope
- [ ] Full `kubexclaw` CLI replacing `kclaw.py` — deferred, v1.2 scope
- [ ] Boundary management UI in Command Center — deferred until operator headcount justifies it
- [ ] Kubernetes deployment (beyond Docker Compose) — deferred until scale requires it

---

## Feature Prioritization Matrix

| Feature | Operator Value | Implementation Cost | Priority |
|---------|---------------|---------------------|----------|
| Universal base image | HIGH — eliminates image sprawl, one patch point | MEDIUM | P1 |
| Skill file mounting at spawn | HIGH — core of stem cell model | MEDIUM | P1 |
| Harness auto-load of mounted skills | HIGH — agent becomes its skills | LOW (mostly done) | P1 |
| Config-driven agent identity | HIGH — config is the agent | MEDIUM | P1 |
| Skill manifest schema | HIGH — machine-readable skill contract | MEDIUM | P1 |
| Skill composition engine | HIGH — multi-skill agents are the primary use case | MEDIUM | P1 |
| Policy-gated skill injection | HIGH — security-critical | MEDIUM | P1 |
| Backward compatibility | HIGH — existing system must not break | HIGH | P1 |
| Graceful shutdown + drain | HIGH — prevents silent work loss | MEDIUM | P1 |
| Remove per-agent Dockerfiles | HIGH — completes the refactor | LOW | P1 |
| Health check polling | MEDIUM — needed for reliable spawning | LOW | P1 |
| Skill versioning + pinning | MEDIUM — nice once catalog grows | MEDIUM | P2 |
| Skill scaffolding CLI | MEDIUM — lowers contributor friction | LOW | P2 |
| Custom skill validation | MEDIUM — fail-fast DX improvement | MEDIUM | P2 |
| Policy-gated runtime deps | HIGH (strategic) — agents requesting new capabilities | HIGH | P2 |
| Anti-collusion reviewer (preserve) | HIGH — security architecture | LOW (already built) | P1 |
| Capability Registry discovery (preserve) | HIGH — dynamic orchestration | LOW (already built) | P1 |

**Priority key:**
- P1: Required for v1.1 to be a coherent stem cell refactor
- P2: Should add in v1.1 or v1.2 when triggered
- P3: Future consideration (not listed — none in this domain qualify for v1.1 roadmap)

---

## Ecosystem Analysis

The stem cell pattern in KubexClaw is the most coherent implementation of a 2026 enterprise
pattern where agent capability is decoupled from image identity. Comparable approaches in
the ecosystem:

| Feature | AWS Bedrock AgentCore | Microsoft Agent Framework | OpenAI Agents SDK | KubexClaw v1.1 |
|---------|----------------------|--------------------------|-------------------|----------------|
| Single base runtime | Managed runtime (opaque) | Shared runtime (AutoGen + SK) | Python SDK, user-managed | `kubexclaw-base` — self-hosted, transparent |
| Skill/tool injection | Tool definition JSON at call time | Skills via MAF config | Tool list per agent | `.md` files + `skill.yaml` at spawn |
| Policy gating | IAM + guardrails | Azure RBAC | Not built-in | Gateway policy engine — custom, deterministic |
| Runtime dep requests | Not exposed | Not exposed | Not exposed | ESCALATE pipeline — novel |
| Multi-provider anti-collusion | Not a feature | Not a feature | Not a feature | Enforced at Gateway model allowlists |
| Self-hosted | No | No | Optional | Yes — Docker Compose |

KubexClaw's differentiating position: fully self-hosted, transparent base image, policy engine
as a first-class citizen, and anti-collusion as a structural property rather than a convention.
The runtime dependency ESCALATE path is not present in any surveyed platform and is genuinely
novel.

---

## Sources

- Project documentation (HIGH confidence): `docs/kubex-manager.md` Section 19.3, `docs/skill-catalog.md`, `docs/agents.md`, `.planning/PROJECT.md`
- Microsoft Agent Framework Skills: [Agent Skills | Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/skills) — MEDIUM confidence (confirms skills-as-portable-packages pattern)
- OpenClaw custom Docker image best practices (MEDIUM confidence): [kubernetes.recipes](https://kubernetes.recipes/recipes/deployments/openclaw-custom-docker-image/) — cold start ~5s with cached base image
- Agent skill injection in production (MEDIUM confidence): [Andrii Tkachuk on Medium](https://medium.com/@andrii.tkachuk7/agents-skills-in-production-how-to-bring-skills-to-docker-deployed-agents-vendor-agnostic-4282cf567930) — confirms vendor-agnostic skill injection patterns
- Skill descriptor prompt injection attack vector (HIGH confidence): [Repello AI 2026](https://repello.ai/blog/ai-agent-skill-scanner) — confirms SKILL.md injection is documented attack
- Enterprise bounded autonomy + HITL patterns (MEDIUM confidence): [onereach.ai 2026](https://onereach.ai/blog/agentic-ai-orchestration-enterprise-workflow-automation/) — confirms escalation as standard 2026 enterprise pattern
- Container image anti-patterns (HIGH confidence): [Codefresh Docker Anti-Patterns](https://codefresh.io/blog/docker-anti-patterns/) — one image per environment, not one per agent type
- Docker image sprawl concern (MEDIUM confidence): [docker-bench-security Issue #532](https://github.com/docker/docker-bench-security/issues/532)
- Agent lifecycle management stages (MEDIUM confidence): [onereach.ai lifecycle guide](https://onereach.ai/blog/agent-lifecycle-management-stages-governance-roi/)

---

*Feature research for: Agent container platform with dynamic skill-based specialization (Stem Cell Kubex — KubexClaw v1.1)*
*Researched: 2026-03-11*
