# Evaluations & Identified Gaps

> Extracted from BRAINSTORM.md. See [KubexClaw.md](../KubexClaw.md) for the full index.

## Open Questions (Remaining)
- [x] ClawControl — is it open source? Does it solve enough to replace our custom Kubex Manager? **Resolved — see Section 14. MIT license, open source. Does NOT replace Kubex Manager (it's a frontend client, not a container lifecycle tool). Valuable as a partial frontend foundation for the Command Center.**

---

## 14. ClawControl Evaluation — Resolved

**Repo:** [jakeledwards/ClawControl](https://github.com/jakeledwards/ClawControl) | **MIT License** | TypeScript (Electron + React + Capacitor) | 181 stars | Active daily commits (as of 2026-03-01)

**Previous assumption was wrong.** The [clawcontrol.dev](https://clawcontrol.dev/) site (referenced in Section 7) gave the impression this was a server-side orchestration tool with kill switches and cryptographic execution envelopes. In reality, `jakeledwards/ClawControl` is a **cross-platform desktop/mobile client** for a single OpenClaw instance. No Docker management, no policy engine, no container lifecycle controls.

### What It Is

A polished Electron + Capacitor client that connects to **one** OpenClaw Gateway via WebSocket (protocol v3). Features:

- Chat UI with real-time LLM streaming (delta + cumulative modes), markdown, code blocks, image send/receive
- Agent dashboard — live grid with status indicators (online/offline/busy), model info, streaming state
- Agent management — create, rename, delete, browse workspace files and config
- Session management — concurrent sessions with per-session stream isolation, subagent spawning
- Cron job CRUD — create, toggle, run, delete scheduled tasks
- Skill management — ClawHub browser with VirusTotal security scan badges, one-click install
- Server config editor — full YAML config read/write via `config.get`/`config.patch` with hash-based conflict detection
- Usage/cost tracking — token/cost charts, activity heatmaps
- Exec approval flow — approve/deny tool execution requests, per-agent allowlist management
- Device pairing — Ed25519 identity, node listing, paired device management
- Voice dictation + wake word detection

### What It Does NOT Have

- **No Docker/container awareness** — zero knowledge of containers, images, or lifecycle
- **No policy engine / gateway** — no deterministic rule evaluation
- **No inter-agent message routing** — no broker concept
- **No agent registry / capability discovery** — just lists agents on a single Gateway
- **No audit logging infrastructure** — no OpenSearch, no append-only guarantees
- **No kill switch** — can delete agents but no container stop + secret rotation
- **No boundary / trust zone concept**
- **No multi-instance orchestration** — connects to ONE OpenClaw server, not a fleet

### Overlap with Command Center (Section 10)

| Command Center View | ClawControl Coverage | Reusable? |
|---|---|---|
| Agent Dashboard / Fleet Map | `AgentDashboard.tsx` — live agent grid with status, model, streaming | Partially — single-server, but tile pattern is reusable |
| LLM Conversation Live Streaming | `ChatArea.tsx` + per-session stream isolation — well-built | **Yes** — streaming architecture (delta/cumulative, source arbitration, tool call cards) is exactly what we need |
| Agent Detail View | `AgentDetailView.tsx` — identity, config files, skills | Partially — no policy/resource/action tabs |
| Cron / Scheduled Workflows | `CronJobDetailView.tsx` + `CreateCronJobView.tsx` — full CRUD | **Yes** — maps to our Scheduled Workflows view |
| Server Config Editor | `ServerSettingsView.tsx` — dirty tracking, minimal patch, conflict detection | **Yes** — pattern directly applicable to Kubex Configuration Manager |
| Usage / Cost Tracking | `UsageView.tsx` — token/cost charts, activity heatmaps | Partially — single-agent scope, chart patterns reusable |
| Skill Management | Full ClawHub browser with security badges, install flow | **Yes** — directly useful for managing Kubex skills |
| Exec Approval Flow | `nodes.ts` — approve/deny execution, allowlist management | Partially — maps to Approval Queue concept, scoped to exec only |
| Inter-Agent Message View | **None** | Build from scratch |
| Approval Queue (Gateway) | **None** | Build from scratch |
| Kill Switch / Control Panel | **None** | Build from scratch |
| Workflow Manager (chain viz) | **None** | Build from scratch |
| Audit & Investigation | **None** | Build from scratch |
| Boundary Management | **None** | Build from scratch |
| Infrastructure Health | **None** | Build from scratch |

### Decision: Extract, Don't Adopt

**Do NOT adopt ClawControl wholesale as our Command Center.** It's architecturally a single-server client; refactoring into a multi-fleet operator console would be as much work as building new.

**DO extract these pieces into the Command Center:**

1. **OpenClaw WebSocket client library** (`src/lib/openclaw/`) — production-quality, typed, handles streaming, reconnection, auth, concurrent sessions. This is exactly how our Command Center backend talks to each Kubex's Gateway. Fork into `services/command-center/frontend/src/lib/`.
2. **Per-session stream isolation architecture** — the `SessionStreamState` pattern with source arbitration, cumulative text merging, and subagent detection is non-trivial and directly maps to watching multiple Kubexes simultaneously.
3. **Design system** (`DESIGN_SPEC.md`) — thorough color system, typography, layout, responsive breakpoints, animations. Adopt as our Command Center's visual foundation.
4. **Cron job UI** — almost 1:1 with our Scheduled Workflows view. Port directly.
5. **Config editor patterns** — dirty tracking, minimal JSON merge patch, hash-based conflict detection, post-save reconnect handling. Apply to Kubex Configuration Manager.
6. **Skill browser / ClawHub integration** — useful for managing skills across Kubexes.

**Estimated work saved:** ~20-30% of the Command Center frontend effort. Zero impact on backend services (Gateway, Kubex Manager, Broker, Registry — which remain the bulk of the work).

### Key Technical Details (for extraction)

**Protocol:** Custom frame-based JSON-RPC over WebSocket (v3). Frames: `req` (client→server), `res` (server→client), `event` (server push). Auth via Ed25519 device identity or bearer token.

**Key RPC methods we'll use:**
- `sessions.list`, `sessions.spawn`, `chat.send`, `chat.history`, `chat.abort`
- `agents.list`, `agent.identity.get`, `agents.files.list`
- `config.get`, `config.patch`
- `skills.status`, `skills.update`, `skills.install`
- `cron.list`, `cron.get`, `cron.update`, `cron.add`
- `exec.approvals.get`, `exec.approval.resolve`

**Streaming events:**
- `chat { state: "delta" | "final" }` — message streaming
- `agent { stream: "assistant" | "tool" | "lifecycle" }` — agent activity
- `presence` — online/offline status

**State management:** Zustand store with localStorage persistence. Per-session streaming maps (`streamingSessions`, `sessionToolCalls`) enable concurrent agent conversations.

### Action Items
- [ ] Fork ClawControl's `src/lib/openclaw/` WebSocket client library into Command Center frontend
- [ ] Adapt the WebSocket client to support connecting to N Gateways simultaneously (one per Kubex)
- [ ] Port the `SessionStreamState` pattern for multi-Kubex live conversation viewing
- [ ] Adopt ClawControl's design system (`DESIGN_SPEC.md`) as Command Center visual foundation
- [ ] Port cron job UI components (`CronJobDetailView`, `CreateCronJobView`) for Scheduled Workflows
- [ ] Port config editor pattern (dirty tracking, minimal patch, conflict detection) for Kubex Configuration Manager
- [ ] Evaluate porting skill browser for Kubex skill management

---

## 15. Identified Gaps

A systematic review of Sections 0-14 revealed the following gaps. Organized by severity — Critical gaps block implementation, High gaps require design before building, Medium gaps are missing considerations.

### Critical — Blocks Implementation

#### 15.1 No Canonical Structured Action Request Schema

The most important shared interface in the system is referenced in **6 places** across the brainstorm but has no single canonical definition. Three partial, conflicting versions exist:

| Source | Key Field: Agent | Key Field: Action | Has `boundary`? | Has `context`? | Has `model_used`? | Has `plan`? |
|--------|-----------------|-------------------|-----------------|----------------|-------------------|-------------|
| Section 6 (inter-agent message) | `from` | `request_type` | No | Yes | No | No |
| Section 6 (activation request) | `from` | `request_type` | No | Yes | No | Yes |
| Section 13.3 (Gateway eval) | `agent_id` | `action` | Yes | No | Yes | No |

**Impact:** Every component depends on this schema — Kubexes emit it, Gateway evaluates it, Broker routes it, Audit Log stores it, Command Center displays it. If `kubex-common` doesn't have one canonical definition, every service will interpret requests differently.

**Resolution:** Design a unified base schema with typed extensions per request type. See **Section 16** for the canonical schema definition.

- [x] Identify schema fragmentation across sections
- [x] Design canonical base schema + extensions (Section 16)
- [ ] Implement in `kubex-common/src/schemas/`

#### 15.2 MVP Deployment Model Unclear

Section 13 defines two MVP Kubexes (Orchestrator + Instagram Scraper) + a Gateway, but **does not include the Kubex Manager**. No explanation of how containers are started:

- Manual `docker-compose up`? Then who manages lifecycle?
- Kubex Manager from day one? Then it's MVP scope creep.
- Hybrid? Start manual, add Kubex Manager later?

The gap between "MVP" and "first real deployment" isn't bridged.

- [x] Decide MVP container launch strategy — **Kubex Manager from day one (Option B)**
- [ ] Build Kubex Manager as part of MVP scope
- [ ] Write MVP `docker-compose.yml` for infrastructure services (Redis, logging)
- [ ] Write MVP Kubex Manager startup config (Orchestrator + Scraper + Reviewer Kubexes)

#### 15.3 Gateway — Relationship Between Components Undefined

Two separate services are described but their interaction is never specified:

| Service | Defined In | Purpose |
|---------|-----------|---------|
| **API Gateway** | Section 3 | External entry point — auth, rate limiting, structured logging |
| **Gatekeeper** | Section 2, 13.2, 13.3 | Internal policy enforcement — action evaluation, approval decisions |

**Unresolved questions:**
- Does the API Gateway call the Gatekeeper? Or are they on separate paths?
- Does a user request go through API Gateway → Broker → Kubex → Gatekeeper? Or API Gateway → Gatekeeper → Broker → Kubex?
- Do they share a network? A container? Are they both in the request path?
- For MVP (Section 13.2), only the Gatekeeper sidecar exists — where does the API Gateway fit?

- [x] Define the request flow — **unified into one service (Section 13.9)**
- [x] Decide if API Gateway is MVP scope — **yes, merged with Gatekeeper into single Gateway**
- [x] Specify network topology — **Kubexes only reach Gateway, zero direct internet access**

#### 15.4 Boundary Concept Not Retrofitted into Sections 1-6 — **OPEN**

> **Architecture decided in Section 16.3.** Boundary Gateway design, data shapes, and cross-boundary request flow are fully specified. Retrofit into earlier sections remains as action item. **Status: OPEN** — architectural decisions are made but the earlier sections have not been updated yet.

Boundaries (Section 11) fundamentally change how several earlier systems work, but those sections were written before boundaries existed:

| Section | Impact of Boundaries | Currently Addressed? |
|---------|---------------------|---------------------|
| Section 1 (Isolation) | Boundary-level model allowlists supplement per-Kubex allowlists | No |
| Section 2 (Approval Gateway) | Intra-boundary = Low tier, cross-boundary = High tier by default | No — tiers are per-action only |
| Section 5 (Architecture Overview) | Diagrams don't show boundary layer | No |
| Section 6 (Inter-Agent Comms) | `accepts_from` defaults to same-boundary members (stated in 11 but not in 6) | Partially — Section 11 updates Registry schema |

**Specific questions:**
- ~~Does the Reviewer LLM (Section 2) see the requesting agent's boundary in the approval request?~~ **Yes** — boundary is in `GatekeeperEnvelope.enrichment.boundary` (Section 16.2) and in `RoutedRequest.source_boundary` (Section 16.3)
- ~~Is there a "reviewer boundary" separate from worker boundaries, per the model separation strategy (Section 13.6)?~~ **Deferred** — reviewer placement is a boundary policy configuration concern (Section 16.3 action items)
- ~~How does the Policy Engine evaluation flow (Section 13.3) incorporate boundary checks?~~ **Answered** — Boundary Gateways run Policy Engine role with boundary-specific rules; Central Gateway runs full evaluation (Section 16.3)

- [x] Define boundary architecture and data shapes — **Section 16.3**
- [x] Define cross-boundary request flow with hop-by-hop data transformation — **Section 16.3**
- [x] Answer specific questions about boundary integration with existing systems — **Section 16.3**
- [ ] Retrofit Section 2 approval tier table with boundary-aware tiers
- [ ] Update Section 5 architecture diagrams to show boundary layer
- [ ] Update Section 6 `accepts_from` to reference boundary defaults
- [ ] Define Reviewer Kubex placement in boundary model

### High — Design Gaps

#### 15.5 `kubex-common` Module Hierarchy Incomplete

> **Resolved** — Complete module hierarchy defined in Section 16.4. Section 12 layout updated.

Section 12 outlines 5 submodules, but the spec references at least 3 more implicit modules:

| Module | Defined In Section 12? | Referenced In |
|--------|----------------------|---------------|
| `schemas/` | Yes | Section 2, 6, 13.3 |
| `enums.py` | Yes | Throughout |
| `auth/` | Yes | Section 6 (container identity) |
| `audit/` | Yes | Section 9 |
| `config.py` | Yes | Section 1 |
| **`skills/model_selector`** | **No** | Section 1 — "built-in model selector skill (part of kubex-common)" |
| **`logging/`** | **No** | Section 9 — "Implement structured log format in kubex-common" |
| **`metrics/`** | **No** | Section 9 — "Implement /metrics endpoint in kubex-common" |

- [x] Add `skills/`, `logging/`, and `metrics/` to the kubex-common module hierarchy in Section 12
- [x] Define module interfaces for each (what each module exposes)

#### 15.6 Kubex Broker Technology Not Selected

> **Resolved** — Redis Streams selected. Full design in Section 18.

Section 6 says "likely a lightweight queue — Redis Streams, NATS, or custom" but no decision has been made. This affects:
- Inter-agent communication latency and reliability
- Message persistence and replay capability
- The Kubex Broker service implementation
- Command Center's live message feed data source

- [x] Evaluate Redis Streams vs NATS vs custom for Kubex Broker
- [x] Document decision with rationale (latency, persistence, operational complexity)

#### 15.7 Inter-Agent Content Template System Not Designed

> **Resolved** — Template system retired. Inter-agent communication uses `dispatch_task` with NL `context_message` (Section 16.2). Security comes from Gateway policy (who can talk to whom) + receiving Kubex treating all incoming context as untrusted input. Templates would add unnecessary complexity (storage, versioning, rendering, approval) for something the LLM handles natively.

Section 6 states agents pass content via "pre-approved templates with typed variables" but no design exists:
- Where are templates stored? (repo? database? Registry?)
- How are templates created and versioned?
- Who approves new templates?
- How are templates rendered? (server-side? agent-side?)
- What prevents a compromised agent from referencing a template with malicious variables?

- [x] ~~Design template storage, versioning, and approval workflow~~ — Retired. No template system needed.
- [x] ~~Define template rendering engine location (Broker-side recommended — agents never see raw templates)~~ — Retired. No rendering engine needed.
- [x] ~~Add template schema to `kubex-common`~~ — Retired. No template schema needed.

#### 15.8 Kubex Manager REST API Schema Not Designed

> **Resolved** — Full REST API designed in Section 19. 61 endpoints across 11 categories.

Section 7 lists 7 requirements but no endpoint definitions:
- `POST /kubex` — create
- `POST /kubex/{id}/start` — start
- `POST /kubex/{id}/stop` — stop
- `POST /kubex/{id}/kill` — emergency kill + secret rotation
- `GET /kubex/{id}/status` — health/status
- `GET /kubex` — list all

Missing: request/response formats, auth model, error codes, webhook callbacks for lifecycle events.

- [x] Design full REST API schema for Kubex Manager (OpenAPI spec)
- [x] Define auth model (mTLS? Bearer token? Internal network only?)
- [x] Define webhook/event callbacks for lifecycle state changes

#### 15.9 Output Validation Schemas Undefined

> **Resolved** — Output validation is Gateway policy, not a separate system. Full design in Section 20. Includes prompt injection detection at the Gateway level.

Section 3 says "define output validation schemas per agent type" but provides no examples. What does validation look like?
- JSON Schema per action type?
- Max payload size per agent?
- PII detection rules?
- Allowed output destinations?

- [x] Define output validation approach (JSON Schema per action type recommended)
- [x] Create example schemas for MVP agents (orchestrator dispatch output, scraper data output)

### Medium — Missing Considerations

#### 15.10 Terminology Inconsistency: "Policy Engine" vs "Gatekeeper"

> **Resolved** — Bulk rename completed. "Gatekeeper" and "API Gateway" retired per Section 13.9. "Gateway" = the unified service, "Policy Engine" = the rule evaluation component within it.

The terms are used interchangeably across sections:
- Section 2: "Policy Engine" (the deterministic rules component)
- Section 13.2: "Gatekeeper sidecar" (the container running it)
- Section 13.3: "Gatekeeper" evaluates using "rule categories"
- Section 11: "Gatekeeper enforcement" of policy cascade

**Proposed convention:**
- **Gatekeeper** = the service/container (`services/gatekeeper/`)
- **Policy Engine** = the rule evaluation core within the Gatekeeper
- **Policy** = the YAML rule files loaded by the Policy Engine

- [x] Standardize terminology and update all sections for consistency

#### 15.11 No Error Handling / Failure Mode Design

> **Resolved** — Fail-closed for security components, graceful degradation for observability. Full design in Section 21.

No section addresses what happens when infrastructure components fail:

| Component Down | Impact | Designed? |
|---------------|--------|-----------|
| Gateway unreachable | All Kubex actions block — fail-closed or fail-open? | No |
| Kubex Broker unreachable | Inter-agent messages lost or queued locally? | No |
| OpenSearch unreachable | Fluent Bit buffers grow — for how long? What if disk fills? | No |
| Kubex crashes mid-task | Workflow marked failed? Who cleans up? Secrets revoked? | No |
| Redis (Broker backend) crashes | Message queue lost — are messages persisted? | No |
| Command Center down | Approvals can't be processed — do Kubexes stall? | No |

**Key decision needed:** Is the system **fail-closed** (all actions denied if Gateway is down) or **fail-open** (actions proceed without policy checks)?

- [x] Decide fail-closed vs fail-open for Gateway unavailability
- [x] Define failure behavior for each infrastructure component
- [x] Design graceful degradation strategy (which components can the system survive without?)

#### 15.12 No CI/CD Pipeline Design

> **Resolved** — GitHub Actions + GHCR + Cloudflare Tunnel deployment. Full design in Section 22.

Section 12 has a `deploy/` directory but no CI/CD strategy:
- How are agent images built and published?
- How is `kubex-common` versioned when schemas change?
- How are policy changes tested before production deployment?
- How are Dockerfiles rebuilt when the OpenClaw base version changes (Section 13.4)?

- [x] Design CI/CD pipeline (GitHub Actions or similar)
- [x] Define versioning strategy for `kubex-common` (semver? CalVer?)
- [x] Define policy testing workflow (lint + dry-run evaluation against test cases)

#### 15.13 No Testing Strategy

> **Resolved** — Full testing strategy defined in Section 23. Unit, integration, E2E, chaos, and policy fixture testing.

No section describes how to test:
- Gateway policy rules (unit tests with mock action requests?)
- Inter-agent workflows (end-to-end with real Kubexes or mock Broker?)
- Circuit breaker behavior (chaos testing?)
- Model escalation triggers (simulated task complexity?)
- Boundary policy cascade (global + boundary + kubex interaction?)

- [x] Define testing strategy per component (unit, integration, end-to-end)
- [x] Design a test harness for Gateway policy evaluation (feed it action requests, assert allow/deny)
- [x] Design end-to-end workflow test (orchestrator → scraper → output)

#### 15.14 No Data Retention / GDPR Compliance Details

> **Resolved** — MVP: don't log PII (Fluent Bit redaction filter). Post-MVP: crypto-shredding, DSAR, Gateway PII detection. Full design in Section 24.

Section 9 defines retention periods (30 days to 1 year). Section 0 lists GDPR as a prerequisite. But no design exists for:
- PII detection and redaction in agent logs
- Data subject access requests (DSAR) — how to find all data about a person across 7 indices?
- Right to deletion vs append-only audit logs (legal conflict)
- Cross-border data transfer (if agents process EU citizen data)

- [x] Define PII handling strategy for audit logs (redact at ingestion vs flag for review)
- [x] Design DSAR query capability across OpenSearch indices
- [x] Resolve append-only vs right-to-deletion conflict (crypto-shredding recommended)

#### 15.15 No Disaster Recovery Runbook

> **Resolved** — Stateless/stateful split defined, RTOs set, recovery runbooks written. Full design in Section 25.

OpenSearch snapshots to S3/MinIO mentioned in Section 9 but no full DR plan:
- Can the full swarm be rebuilt from repo + secrets alone?
- Are Kubex configs (which are in the repo) sufficient, or is there runtime state?
- What's the RTO (recovery time objective)?
- Is there a cold standby strategy?

- [x] Define what is stateless (rebuildable from repo) vs stateful (needs backup)
- [x] Write DR runbook: host failure, single-service failure, full swarm recovery
- [x] Set up automated OpenSearch snapshots

#### 15.16 No Operator CLI

> **Resolved** — No separate CLI needed. The Command Center chat interface IS the operator interface (phone operator model). Emergency operations via direct `docker`/`curl`. Full design in Section 26.

All operational actions go through the Command Center UI. No CLI equivalent for:
- Scripting and automation (e.g., nightly boundary restarts)
- Emergency kill via SSH when Command Center is down
- CI/CD integration (deploy new Kubex from pipeline)

- [x] Evaluate need for `kubexctl` CLI tool
- [x] At minimum, document direct `docker` and `curl` commands for emergency operations

#### 15.17 No Performance Targets

> **Resolved** — Performance targets defined below. Capacity model: ~20-30 concurrent Kubexes on 24GB host.

No SLAs or performance targets defined anywhere:
- Gateway evaluation latency target (< 10ms? < 50ms?)
- Broker message routing latency
- Maximum acceptable approval queue wait time
- Kubex startup time target
- Maximum concurrent Kubexes on the 24GB host budget

- [x] Define performance targets for Gateway, Broker, and Kubex Manager
- [x] Define capacity planning model (Kubexes per GB of RAM)

**Performance Targets:**

| Metric | Target (p95) | Rationale |
|---|---|---|
| Gateway policy evaluation | < 10ms | Deterministic rule evaluation, no LLM calls |
| Boundary Gateway content scan (prompt injection) | < 500ms | LLM classification call (Haiku) |
| Broker message routing (Redis Streams) | < 5ms | In-memory XADD + XREADGROUP |
| Approval queue notification | < 2 seconds | Action request → approval appears in Command Center |
| Kubex cold start | < 15 seconds | Container create + OpenClaw boot + skill loading |
| Kubex warm restart | < 5 seconds | Container restart (image cached) |
| Max concurrent Kubexes (24GB host) | ~20-30 | ~500MB-1GB per Kubex. Infrastructure ~4GB. ~20GB for agents. |
| Chat response first token | < 3 seconds | User message → first streaming token in Command Center |

#### 15.18 No Distributed Tracing

> **Resolved** — MVP uses `workflow_id` + `task_id` as correlation IDs across OpenSearch indices. No OpenTelemetry for MVP. Post-MVP: evaluate OpenTelemetry if flame graphs or external observability integration needed.

Workflow chains (Section 6) span multiple Kubexes, but there's no distributed tracing:
- No correlation IDs propagated across agent boundaries (beyond `originating_workflow`)
- No OpenTelemetry or similar instrumentation
- Workflow replay (Command Center Section 10) would need trace data to reconstruct timelines

- [x] ~~Evaluate OpenTelemetry integration for cross-Kubex workflow tracing~~ — Deferred to post-MVP. `workflow_id` + `task_id` correlation is sufficient for MVP.
- [x] ~~Define trace context propagation in Structured Action Request schema (trace_id, span_id)~~ — Already have `workflow_id` and `task_id` in every data shape (ActionRequest → RoutedRequest → BrokeredRequest → TaskDelivery). This IS the trace context.

#### 15.19 ~~No Swarm-Wide Knowledge Base~~ — CLOSED (Section 27)

> **Resolved** — Hybrid architecture: **Graphiti** (temporal knowledge graph) + **OpenSearch** (document corpus). Graphiti handles entities, relationships, and time-varying facts with bi-temporal timestamps and contradiction resolution. OpenSearch handles bulk document storage and full-text/vector search. Entities in Graphiti link to documents in OpenSearch. Kubexes access both via `query_knowledge`, `store_knowledge`, and `search_corpus` action primitives through the Gateway. `group_id` isolation maps to Boundaries. Full design in Section 27.

- [x] ~~Evaluate OpenSearch vector search vs PostgreSQL + pgvector for embedding storage~~ — OpenSearch selected for document corpus (already in architecture for logging). Graphiti uses Neo4j for graph + embedded vector indices.
- [x] ~~Evaluate LightRAG or similar for knowledge graph layer~~ — LightRAG evaluated first but lacks temporal support (no timestamps, destructive merges). **Graphiti selected** (Zep AI, bi-temporal model, contradiction resolution, Pydantic ontology, `group_id` isolation).
- [x] ~~Design knowledge ingestion pipeline (how do agent outputs become knowledge?)~~ — Two-step: OpenSearch corpus index → Graphiti `add_episode()` with entity extraction + contradiction resolution (Section 27.8)
- [x] ~~Design `query_knowledge` action type and parameter schema~~ — Section 27.7 (includes `as_of` for point-in-time queries)
- [x] ~~Define knowledge domain boundaries (can Finance knowledge be accessed by Engineering?)~~ — `group_id`-to-Boundary mapping with Gateway policy (Section 27.6)

---

## 28. Multi-User Support (Post-MVP)

Currently KubexClaw assumes a single user/admin operating the system. Multi-user support would require changes across many areas of the architecture. This is explicitly deferred to post-MVP — the MVP stays single-user with no auth required for local deployment.

### Affected Areas

**Authentication & Identity:**
- [ ] User accounts (login, registration, sessions)
- [ ] Role-based access control (admin, operator, viewer)
- [ ] Per-user API tokens for CLI and Command Center
- [ ] SSO/OIDC integration for enterprise deployments

**Agent Ownership:**
- [ ] Agents belong to a user or team
- [ ] Users can only see/manage their own agents
- [ ] Shared agents visible to multiple users

**Logging & Audit:**
- [ ] Logs tagged with user ID who initiated the action
- [ ] Audit trail per user
- [ ] User-scoped log views in Command Center

**Budget & Cost Tracking:**
- [ ] Per-user spending limits and tracking
- [ ] Team/org-level budgets
- [ ] Cost allocation reports per user

**Knowledge Base Isolation:**
- [ ] Per-user or per-team knowledge partitioning
- [ ] Graphiti `group_id` maps to user/team (currently maps to Boundary)
- [ ] Shared vs private knowledge scoping

**Approvals:**
- [ ] Approval routing to the correct user (not just "admin")
- [ ] Delegation and escalation chains
- [ ] Multi-user approval workflows

**Orchestrator:**
- [ ] Multiple users accessing Orchestrator simultaneously
- [ ] Session isolation (each user gets their own conversation context)
- [ ] Queue management for concurrent requests

**Command Center:**
- [ ] User dashboards (each user sees their agents/costs)
- [ ] Admin dashboard (sees everything)
- [ ] Team views

**CLI:**
- [ ] `kubexclaw login` / `kubexclaw logout` commands
- [ ] Token-based auth per user
- [ ] User context switching

**Infrastructure Impact:**
- [ ] Session store (Redis or JWT)
- [ ] User database (PostgreSQL or similar — new dependency)
- [ ] Auth middleware in Gateway

### Suggested Phased Approach

| Phase | Scope | Key Deliverables |
|-------|-------|-----------------|
| MVP | Single-user | No auth required for local deployment |
| Post-MVP Phase 1 | User accounts + RBAC | Add user accounts + RBAC to Command Center |
| Post-MVP Phase 2 | Ownership + budgets | Per-user agent ownership + budget isolation |
| Post-MVP Phase 3 | Knowledge isolation | Multi-tenant knowledge isolation via Graphiti `group_id` |

---

## 29. MVP Gap Analysis — End-to-End Review

A comprehensive end-to-end gap analysis of the MVP implementation plan against the full architecture. Gaps are organized by severity — Critical gaps block MVP launch, High gaps need resolution before or during build, Medium and Low gaps are tracked for cleanup.

### Critical — Blocks MVP Launch (4)

#### C1: Network Topology Mismatch — CLOSED (2026-03-08)

> **Resolution:** 3-network model adopted (`kubex-internal`, `kubex-external`, `kubex-data`). Docker-compose skeleton in MVP.md updated to use three networks. Gateway bridges all three. Kubexes are ONLY on `kubex-internal`. Data stores are ONLY on `kubex-data`. This is now the authoritative network topology. See docs/infrastructure.md "Docker Networking Topology (FINAL)" and docs/gateway.md Section 13.9.1 (Gateway LLM Proxy).

- [x] Docker-compose has single `gateway-net` but architecture specifies 3 networks (`kubex-internal`, `kubex-external`, `kubex-data`). Without proper network segmentation, Kubexes can bypass Gateway and reach each other or external services directly. Reconcile docker-compose network topology with architecture.

#### C2: Port Assignment Conflicts — CLOSED (2026-03-08)

> **Resolution:** Canonical port assignments established and applied across all documents. Gateway: 8080, Kubex Manager: 8090, Kubex Registry: 8070, Kubex Broker: 8060, Graphiti: 8100, Redis: 6379, Neo4j: 7687/7474, OpenSearch: 9200. Only the Gateway is exposed to the host; all other services are internal Docker networking only. Updated: MVP.md, ARCHITECTURE-DIAGRAMS.md, BRAINSTORM.md, docs/infrastructure.md, docs/api-layer.md, docs/cli.md, docs/gaps.md.

- [x] Ports disagree across docs — Kubex Manager: 8100 vs 8090, Registry: 8300 vs 8070, Graphiti: 8000 vs 8100. Establish a single authoritative port assignment table and update all documents.

#### C3: Credential Model Contradiction — CLOSED (2026-03-08)

> **Resolution:** Gateway LLM Proxy model adopted (Side A). Workers get `*_BASE_URL` env vars pointing to Gateway proxy endpoints (e.g., `ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic`), not API keys. Gateway reads API keys from `secrets/llm-api-keys.json` (mounted into Gateway only) and injects them when proxying LLM requests. CLI auth tokens (e.g., Claude Code OAuth) are still mounted into workers for CLI identity, separate from LLM API keys. See docs/gateway.md Section 13.9.1, MVP.md Section 6.4, and docs/user-interaction.md Section 30.9.

- [x] Architecture says Gateway holds all LLM keys and Kubexes have zero internet access. But MVP harness model injects API keys directly into worker containers. Need to decide: Gateway LLM proxy for MVP, or accept MVP compromise and document the deviation.

#### C4: Missing Action Types — CLOSED (2026-03-08)

> **Resolution:** All missing action types added to the ActionType enum, Global Action Vocabulary table, and per-action parameter schemas in docs/schemas.md. Added 18 new action types: `check_task_status`, `progress_update`, `cancel_task`, `subscribe_task_progress`, `get_task_progress`, `query_knowledge`, `store_knowledge`, `search_corpus`, `request_user_input`, `needs_clarification`, `read_file`, `write_file`, `parse_html`, `search_web`. ACTION_PARAM_SCHEMAS registry updated to map all action types. Summary diagram and module hierarchy updated with new action schema files (task_management.py, knowledge.py, hitl.py, parsing.py).

- [x] `progress_update`, `cancel_task`, `query_knowledge`, `store_knowledge`, `search_corpus` referenced in architecture — added to ActionType enum and parameter schemas.
- [x] `subscribe_task_progress`, `get_task_progress`, `request_user_input`, `needs_clarification` — additional missing action types from MVP flows added.
- [x] `read_file`, `write_file`, `parse_html`, `search_web` — action types from agent configs and skill catalog added.
- [x] `check_task_status` — was in vocabulary table but missing from ActionType enum, now added.
- [x] Per-action parameter schemas defined for all new action types.

### High — Design Resolution Required (7)

#### H1: Orchestrator Management Model — CLOSED (2026-03-08)

> **Resolution:** Orchestrator is docker-compose managed for MVP (long-lived, always running, user entry point via `docker exec -it`). Kubex Manager manages only worker Kubexes (Scraper, Reviewer) dynamically. Updated: docs/infrastructure.md (component table, Mermaid diagram, sequence diagram), docs/kubex-manager.md (scope clarification), MVP.md (already consistent). Cross-document inconsistency #1 resolved.

- [x] MVP.md docker-compose manages Orchestrator, but docs/infrastructure.md says Kubex Manager manages all agents. Clarify that docker-compose manages Orchestrator for MVP (it's infrastructure, not a dynamic worker).

#### H2: Redis Security — CLOSED (2026-03-08)

> **Resolution:** Redis AUTH and ACL configuration added to docker-compose. Redis service now requires password (`--requirepass ${REDIS_PASSWORD}`) and loads per-service ACL file (`--aclfile /etc/redis/users.acl`). ACL file defines users: `gateway-svc`, `broker-svc`, `manager-svc`, `registry-svc` with scoped key access; `default` user disabled. All services updated with authenticated `REDIS_URL` connection strings (e.g., `redis://broker-svc:${REDIS_PASSWORD}@redis:6379/0`). Updated: MVP.md (docker-compose Redis service, all service REDIS_URL env vars), docs/infrastructure.md (Redis ACL setup in secrets section). Cross-document inconsistency #8 resolved.

- [x] Redis has no AUTH/ACL configured in docker-compose despite docs/gateway.md specifying per-service ACL users. Add Redis AUTH password and per-service ACL configuration to docker-compose.

#### H3: Reviewer Model "codex" — CLOSED (2026-03-08)

> **Resolution:** All references to "codex" replaced with "o3-mini" (OpenAI reasoning model, cost-efficient for code review tasks, $1.10/MTok input). Updated: MVP.md (system architecture diagram, agent config section 4.3, anti-collusion section 6.6, reviewer policy YAML, resource budget table, Phase 1 checklist), docs/infrastructure.md (resource budget table). Cross-document inconsistency #9 resolved.

- [x] Reviewer agent config references model "codex" which is not in the pricing table. Replace with an actual model identifier (o3-mini or gpt-5.1-mini).

#### H4: Graphiti Healthcheck Missing — CLOSED (2026-03-08)

> **Resolution:** Healthcheck added to Graphiti service in docker-compose (`curl -f http://localhost:8100/healthz`, interval 10s, timeout 5s, retries 5). Graphiti added to Gateway's `depends_on` with `condition: service_healthy`. Updated: MVP.md (docker-compose Graphiti service, Gateway depends_on).

- [x] docs/knowledge-base.md specifies a healthcheck for Graphiti but docker-compose doesn't include it. Add healthcheck to Graphiti service in docker-compose.

#### H5: OpenSearch Resource Allocation — CLOSED (2026-03-08)

> **Resolution:** OpenSearch allocated 3GB RAM (1.5GB JVM heap via `-Xms1536m -Xmx1536m` + OS/index overhead) and 1.0 CPU. Resource budget table updated in MVP.md and docs/infrastructure.md. Docker-compose OpenSearch service updated with `deploy.resources.limits` and correct `OPENSEARCH_JAVA_OPTS`. Total MVP Docker budget: ~12.7GB of 24GB, leaving ~11.3GB headroom for 4-5 additional Kubexes.

- [x] OpenSearch resource allocation listed as "TBD" in resource budget. OpenSearch needs 3-4 GB minimum. Assign concrete memory limits.

#### H6: MCP Bridge Tool Schemas — CLOSED (2026-03-08)

> **Resolution:** Full JSON Schema definitions added for all 11 MCP Bridge tools: `submit_action`, `dispatch_task`, `list_agents`, `check_task_status`, `subscribe_task_progress`, `get_task_progress`, `cancel_task`, `query_knowledge`, `store_knowledge`, `report_result`, `request_user_input`. Each tool has a complete `inputSchema` with typed properties, descriptions, required fields, and defaults. Updated: MVP.md Section 12.2.1 (full per-tool schemas with descriptions), docs/schemas.md (MCP Bridge Tool Schemas section with consolidated JSON Schema reference).

- [x] MCP Bridge tools have only names and descriptions — no JSON Schema definitions for parameters or return types. Define parameter and return schemas for all MCP bridge tools.

#### H7: Gateway Startup Dependencies — CLOSED (2026-03-08)

> **Resolution:** Full startup dependency chain enforced in docker-compose with healthchecks and `depends_on: condition: service_healthy`. Dependency chain: Redis/Neo4j/OpenSearch (no deps, start first) -> Gateway (depends on redis, neo4j, opensearch healthy) -> Broker (depends on redis, gateway healthy), Registry (depends on redis, gateway healthy), Kubex Manager (depends on gateway healthy), Orchestrator (depends on gateway healthy). Graphiti depends on neo4j healthy. All services have healthchecks with appropriate retries (5 for fast services, 10 for slow-starting services like Neo4j and OpenSearch). Neo4j healthcheck standardized to `curl -f http://localhost:7474`. OpenSearch healthcheck standardized to `curl -f http://localhost:9200/_cluster/health`. Updated: MVP.md docker-compose skeleton.

- [x] docker-compose doesn't enforce the full dependency chain with healthchecks. Gateway must wait for Redis, Neo4j, and Graphiti to be healthy before starting. Add `depends_on` with `condition: service_healthy` entries.

### Medium — Needs Attention (0 remaining of 8)

- [x] M1: `kubex-common` package not included in Phase 0 checklist — **CLOSED (2026-03-08).** Added `kubex-common` as explicit Phase 0 tasks in MVP.md: package scaffold, ActionRequest/GatekeeperEnvelope/ActionResponse schemas, shared logging utilities, shared metrics utilities.
- [x] M2: Policy YAML format is inconsistent across 3 docs (docs/gateway.md, docs/schemas.md, MVP.md) — **CLOSED (2026-03-08).** MVP.md format defined as the canonical MVP format (simplified: `allowed_actions`, `allowed_egress`, `rate_limits`, `budget`, `approval_required_for`). Reconciliation notes added to docs/boundaries.md and docs/gateway.md clarifying the full post-MVP format relationship.
- [x] M3: `ActionResponse` return path not represented in MVP data flow diagrams — **CLOSED (2026-03-08).** Added Section 5.3 "Response / Return Path" to MVP.md with text flow description, Mermaid sequence diagram (worker -> Gateway -> Redis -> Orchestrator -> human), and error return path description. Existing sections renumbered 5.4-5.8.
- [x] M4: Fluent Bit missing from docker-compose — **CLOSED (2026-03-08).** Explicitly deferred to post-MVP. MVP uses Docker JSON log driver; logs accessible via `docker logs` and `kubexclaw agents logs`. Updated MVP.md deferred table (Section 13) and added MVP note to docs/infrastructure.md Section 9.
- [x] M5: Kubex Manager 61 endpoints not scoped for MVP — **CLOSED (2026-03-08).** Added "MVP Endpoint Scope" section to docs/kubex-manager.md listing the ~20 required endpoints (7 Lifecycle, 3 Skills, 4 Configuration, 3 Monitoring, 3 Approvals) and noting the remaining ~41 are post-MVP. Cross-referenced with docs/api-layer.md MVP API surface.
- [x] M6: Emergency procedures scattered across multiple docs — **CLOSED (2026-03-08).** Added consolidated "Emergency Procedures" section (Section 26) to docs/operations.md with five procedures: Kill All Workers, Kill Specific Agent, Full System Shutdown, Revoke All API Keys, Redis Emergency Flush. Includes decision tree diagram and expected system state after each procedure.
- [x] M7: Prompt caching not mentioned in agent configs — **CLOSED (2026-03-08).** Added clarification note at the top of docs/prompt-caching.md: prompt caching is entirely Gateway-managed, agents need no caching configuration. The Gateway automatically applies provider-specific caching strategies transparently.
- [x] M8: Default boundary YAML not defined — **CLOSED (2026-03-08).** Added `boundaries/default.yaml` definition to MVP.md Section 7.5 and docs/boundaries.md (as "Default Boundary (MVP)" subsection). Single permissive boundary with all three MVP agents, shared knowledge, cross-agent comms enabled. Gateway runs boundary logic inline for MVP.

### Low — Cleanup Items (5)

- [x] L1: ARCHITECTURE-DIAGRAMS.md port numbers don't match MVP port assignments — **RESOLVED** as part of C2 port standardization. All port numbers unified in ARCHITECTURE-DIAGRAMS.md, MVP.md, BRAINSTORM.md, and docs/ files (2026-03-08).
- [x] L2: No test structure or pytest setup defined in Phase 0 — **RESOLVED**: Added test infrastructure setup to MVP.md Phase 0 checklist: `tests/unit/`, `tests/integration/`, `tests/e2e/` directory setup, pytest.ini/pyproject.toml configuration, and GitHub Actions CI pipeline with ruff/black/test stages (2026-03-08).
- [x] L3: BRAINSTORM.md section references may be stale after restructuring into `docs/` — **RESOLVED**: Maintenance note added to KubexClaw.md Documentation Index. Section references are stable since BRAINSTORM.md content has been split into docs/ files and section numbers have not been renumbered (2026-03-08).
- [x] L4: Deferred items in MVP.md Section 13 not cross-referenced to full architecture docs — **RESOLVED**: Added `(see docs/<file>.md)` references to every deferred item in MVP.md Section 13 table, linking each to its detailed design doc (docs/boundaries.md, docs/command-center.md, docs/gateway.md, docs/operations.md, docs/infrastructure.md, docs/kubex-manager.md, docs/knowledge-base.md, docs/cli.md) (2026-03-08).
- [x] L5: No `.env.example` or setup guide for developer onboarding — **RESOLVED**: Covered by the `kubexclaw setup` CLI wizard design (docs/cli.md), which handles all first-run configuration interactively. Note added to MVP.md Related Documentation section referencing docs/cli.md for the setup flow (2026-03-08).

### Cross-Document Inconsistencies (10)

| # | Document A | Document B | Inconsistency |
|---|-----------|-----------|---------------|
| 1 | MVP.md docker-compose | docs/infrastructure.md | ~~Orchestrator managed by docker-compose vs Kubex Manager~~ **RESOLVED** — Orchestrator is docker-compose managed, Kubex Manager manages workers only (H1) |
| 2 | MVP.md port table | docs/infrastructure.md | ~~Kubex Manager port 8100 vs 8090~~ **RESOLVED** — canonical port 8090 applied everywhere (C2) |
| 3 | MVP.md port table | docs/infrastructure.md | ~~Registry port 8300 vs 8070~~ **RESOLVED** — canonical port 8070 applied everywhere (C2) |
| 4 | MVP.md port table | docs/knowledge-base.md | ~~Graphiti port 8000 vs 8100~~ **RESOLVED** — canonical port 8100 applied everywhere (C2) |
| 5 | MVP.md docker-compose | docs/gateway.md | ~~Single `gateway-net` vs 3-network topology~~ **RESOLVED** — 3-network model adopted, docker-compose updated (C1) |
| 6 | MVP.md agent configs | docs/gateway.md | ~~API keys in worker containers vs Gateway-only keys~~ **RESOLVED** — Gateway LLM Proxy model adopted, workers get `*_BASE_URL` env vars (C3) |
| 7 | MVP.md agent configs | docs/schemas.md | ~~Missing action types in ActionType enum~~ **RESOLVED** — all action types from MVP agent configs added to ActionType enum (C4) |
| 8 | MVP.md docker-compose | docs/gateway.md | ~~No Redis AUTH vs per-service ACL~~ **RESOLVED** — Redis AUTH + ACL file added to docker-compose, services use authenticated REDIS_URL (H2) |
| 9 | MVP.md agent configs | docs/schemas.md (pricing) | ~~Reviewer model "codex" not in pricing table~~ **RESOLVED** — "codex" replaced with "o3-mini" everywhere (H3) |
| 10 | MVP.md Phase 0 checklist | docs/schemas.md | ~~`kubex-common` not listed as Phase 0 deliverable~~ **RESOLVED** — `kubex-common` added as explicit Phase 0 tasks in MVP.md (M1) |

---
