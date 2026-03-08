# KubexClaw — Agent AI Pipeline Architecture

KubexClaw is the company's Agent AI Pipeline — an infrastructure for deploying AI agents as autonomous "employees" performing real work across company workflows. It is built on OpenClaw as the agent runtime, with a security-first design that treats every agent as an untrusted workload, enforces least-privilege isolation, and gates all actions through a deterministic Policy Engine before execution. The monorepo is organized around a shared contract library (`kubex-common`) that all services and agents depend on for schemas, auth primitives, and audit format.

---

## Quick Links

- [MVP.md](MVP.md) — Implementation-ready MVP outline with docker-compose skeleton and phased build checklist
- [ARCHITECTURE-DIAGRAMS.md](ARCHITECTURE-DIAGRAMS.md) — Visual reference: 16 Mermaid diagrams covering system overview, networks, data flows, security layers, user stories, and lifecycle

---

## Documentation Index

> Note: Section numbers in the "BRAINSTORM.md Sections" column reference the original BRAINSTORM.md structure (now archived at [`archive/BRAINSTORM-v1.md`](archive/BRAINSTORM-v1.md)). The content of each section has been fully extracted into the `docs/` files listed here. These section numbers are retained for cross-referencing purposes only.

### Core Architecture

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/architecture.md](docs/architecture.md) | Naming conventions, isolation model, model allowlist policy, automatic model selection skill, end-to-end system flow (flowcharts + sequence diagrams), and monorepo layout (`libs/`, `services/`, `agents/`, `policies/`, `boundaries/`). Also covers integration points and model escalation rules. | Sections 1, 3, 5, 12, 13.7 |
| [docs/schemas.md](docs/schemas.md) | Canonical `ActionRequest` schema, `GatekeeperEnvelope`, `ActionResponse`, and the full family of routing data shapes (`RoutedRequest`, `BrokeredRequest`, `TaskDelivery`). Defines the Skills → Capabilities → Actions identity model and the complete `kubex-common` module hierarchy (`schemas/`, `skills/`, `logging/`, `metrics/`, `auth/`, `audit/`). | Sections 16, 16.1, 16.2, 16.3, 16.4 |
| [docs/boundaries.md](docs/boundaries.md) | Boundary configuration YAML format, policy cascade model (global → boundary → kubex, first-deny-wins), intra-boundary vs cross-boundary communication tiers, group budgets, shared secrets, boundary networking modes, lifecycle operations (kill/pause/disable), and security implications of grouping. | Section 11 |
| [docs/tech-stack.md](docs/tech-stack.md) | Authoritative technology stack reference: Python 3.12, uv, FastAPI, Pydantic v2, core libraries (httpx, redis-py, structlog, typer), infrastructure images and ports, LLM provider/model assignments, OpenClaw version pin, deferred technologies, and monorepo package structure with action items. | — |

### Services

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/gateway.md](docs/gateway.md) | Unified Gateway design (four roles: Inbound Gate, Scheduler, Policy Engine, Egress Proxy), approval tiers and the three-stage decision flow (Policy Engine → Reviewer LLM → Human Queue), six rule categories, network topology (why the proxy model beats iptables), Redis security (AUTH + ACLs), and output validation with two-stage prompt injection detection (deterministic regex pre-filter + LLM classifier). | Sections 2, 13.2, 13.3, 13.9, 20 |
| [docs/broker.md](docs/broker.md) | Redis Streams selection rationale, per-boundary stream naming convention (`boundary:{name}`), consumer group management, message lifecycle (publish → consume → ack → dead-letter), stream trimming, audit forwarding, and the Broker's role as a thin operational service (no routing decisions). | Sections 6, 18 |
| [docs/kubex-manager.md](docs/kubex-manager.md) | Full 61-endpoint REST API across 11 categories (lifecycle, config, policy, egress, boundary management, secrets, OpenClaw instance management, approval queue, observability, registry view, broker health). Includes Kubex boot sequence, graceful shutdown drain protocol, container label-based identity enforcement, and the principle that the Command Center talks only to the Kubex Manager. | Sections 7, 19 |

### Agents & Models

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/agents.md](docs/agents.md) | MVP agent roster (Orchestrator + Instagram Scraper), full `config.yaml` examples for both, OpenClaw versioning and auto-update flow, split-provider model strategy (workers on Anthropic Claude, Reviewer on OpenAI), LLM pricing reference table (Anthropic, OpenAI, Gemini, Grok as of March 2026), per-role model assignment rationale, and OpenClaw February 2026 security audit (7 CVEs + 2 prompt injection findings, architecture validation, new features to integrate). | Sections 13.1, 13.4, 13.6, 13.6.1, 13.6.2, 17 |

### Infrastructure

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/infrastructure.md](docs/infrastructure.md) | Prerequisites checklist, Docker host ops (networking, kill switches, image pinning), secrets management strategy (bind-mounted files for MVP → Infisical → Vault progression), central logging architecture (OpenSearch + Fluent Bit), index categories and retention policies, Grafana + Prometheus + cAdvisor monitoring stack, Swarm Overview dashboard panels, alerting rules, host specs (64 GB host, 24 GB cluster allocation), MVP resource budget table, port assignment table, Docker network topology (kubex-internal / kubex-external / kubex-data), and the MVP deployment model. | Sections 0, 4, 8, 9, 13.5, 13.8 |
| [docs/knowledge-base.md](docs/knowledge-base.md) | Hybrid Graphiti + OpenSearch knowledge architecture, why LightRAG was rejected (no temporal support), Graphiti core concepts (Entity Nodes, Episodic Nodes, Entity Edges with bi-temporal timestamps), OpenSearch dual-purpose index design (`logs-*` vs `knowledge-corpus-*`), `group_id`-to-Boundary isolation mapping, three new action types (`query_knowledge`, `store_knowledge`, `search_corpus`), two-step ingestion pipeline (OpenSearch corpus → Graphiti entity extraction), Docker Compose additions (Graphiti + Neo4j), fixed ontology (10 entity types, 12 relationship types), built-in `knowledge` skill (`recall` + `memorize` tools), and knowledge quality gate. | Section 27 |

### Operations

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/operations.md](docs/operations.md) | Error handling and failure mode design (fail-closed for security components, graceful degradation for observability), CI/CD pipeline design (GitHub Actions + GHCR + Cloudflare Tunnel), full testing strategy (unit, integration, E2E, chaos, policy fixture), data retention and GDPR compliance (PII redaction, crypto-shredding, DSAR), disaster recovery runbook (stateless vs stateful split, RTOs, recovery sequences), performance targets (p95 latency for Gateway, Broker, Kubex start), and distributed tracing approach (workflow_id + task_id correlation, no OpenTelemetry for MVP). | Sections 21–25, 15.11–15.18 |
| [docs/prompt-caching.md](docs/prompt-caching.md) | Gateway-managed prompt caching for both Anthropic (explicit `cache_control` annotation) and OpenAI (automatic prefix caching), cache state tracking, cost savings estimates (~73% reduction at 85% hit rate on Anthropic Sonnet), prompt assembly ordering (tool defs → system prompt → injected context → history → current message), provider-specific implementation tactics, multi-instance cache sharing via API key namespace, cache invalidation cascade rules, and cold-start staggering strategy. | Sections 28, 29 |

### User Experience

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/user-interaction.md](docs/user-interaction.md) | Phone-operator chat model (General channel → Orchestrator, boundary-specific channels → lead Kubexes), real-time WebSocket streaming with markdown/Mermaid/code rendering, inline approval flow within chat, conversation persistence, clarification chain (worker → Orchestrator → user), HITL policy escalation vs. task clarification distinction, live task progress via SSE, MVP host-resident Orchestrator model, MCP bridge pattern for framework-agnostic agent replacement, timeout/fallback policy, and emergency docker/curl commands. | Sections 26, 30 |
| [docs/command-center.md](docs/command-center.md) | ClawControl evaluation (extracted patterns only — WebSocket client, session stream state, design system, cron UI, config editor), custom Command Center design with 11 views (Swarm Overview, Agent Detail with live LLM conversation streaming, Inter-Agent Message view, Approval Queue, Control Panel, Config Manager, Workflow Manager, Audit & Investigation, Cost & Budget, Infrastructure Health, Agent Analytics), tech stack (Next.js + FastAPI + WebSocket/SSE), security requirements (MFA for destructive ops, 15-min idle timeout, IP allowlisting), and relationship to Mission Control/Grafana/OpenSearch Dashboards. | Sections 7, 10, 14 |

### CLI & API

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/cli.md](docs/cli.md) | Full `kubexclaw` CLI design: command tree (setup, deploy, skills, agents, config, status), first-run setup wizard (4-step: provider, defaults, safety, launch), interactive deploy flow with skill picker, skill catalog browsing (list/info/search), agent lifecycle management (list/info/stop/start/restart/remove/logs), configuration management (show/set/reset/providers), system health dashboard, error handling with plain English messages, and design principles (wizard-first, REST-backed, non-technical language). | — |
| [docs/skill-catalog.md](docs/skill-catalog.md) | Skill manifest schema (`skill.yaml`), directory structure (`skills/` by category), composition rules (union actions, restrictive policies, resource stacking), five complete example manifests (web-scraping, data-analysis, content-writing, code-review, research), custom skill creation scaffolding, SemVer versioning, and runtime skill loading flow. | — |
| [docs/api-layer.md](docs/api-layer.md) | Management API bridging CLI and Command Center: 25 REST endpoints across 5 domains (lifecycle, skills, configuration, monitoring, approvals), CLI-to-API command mapping table, request/response examples, Command Center WebSocket compatibility, state management architecture (Redis, Docker, filesystem, OpenSearch), relationship to full 61-endpoint Kubex Manager API, and consistent error response format. | — |

### Planning

| File | Summary | BRAINSTORM.md Sections |
|------|---------|----------------------|
| [docs/gaps.md](docs/gaps.md) | Systematic gap analysis of BRAINSTORM.md Sections 0-14. Records resolution status for all 19 identified gaps (Critical, High, Medium). Most gaps are closed with pointers to the resolving section. Lists open sub-tasks for Gap 15.4 (boundary retrofit into earlier sections). Includes ClawControl evaluation (Section 14) and performance target definitions (Section 15.17). | Section 15, Section 14 |

---

## Key Architecture Decisions

- **One base image, config-only differentiation** — all Kubexes run the same OpenClaw runtime from `agents/_base/`; a new Kubex is a `config.yaml` + system prompt + skills, not a new codebase. ([docs/architecture.md](docs/architecture.md))
- **Unified Gateway** — API Gateway, Gatekeeper, Scheduler, and Egress Proxy are one service; terms "Gatekeeper" and "API Gateway" are retired. ([docs/gateway.md](docs/gateway.md))
- **Zero direct internet access** — Kubexes only reach the Gateway; all external traffic (including LLM API calls) is proxied through the Gateway, which holds all API keys. ([docs/gateway.md](docs/gateway.md))
- **Gateway LLM Proxy** — all LLM API calls are proxied through the Gateway as a transparent reverse proxy. Kubexes never hold API keys; CLI LLMs are configured with `*_BASE_URL` env vars pointing to Gateway proxy endpoints (e.g., `ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic`). The Gateway injects real API keys, enforces model allowlists, counts tokens for budget, and streams responses back transparently. This resolves the credential model contradiction (C3) and ensures prompt caching works across all Kubexes. ([docs/gateway.md](docs/gateway.md) Section 13.9.1)
- **Canonical `ActionRequest` schema** — one flat schema with a per-action typed `parameters` field; infrastructure populates `GatekeeperEnvelope` enrichment fields (boundary, model_used) that Kubexes cannot forge. ([docs/schemas.md](docs/schemas.md))
- **Container identity via Docker labels** — Gateway resolves `agent_id` and `boundary` from source IP + Docker API; Kubexes cannot self-report identity. ([docs/schemas.md](docs/schemas.md))
- **Policy cascade: global → boundary → kubex** — each level can only restrict, never relax; first deny wins across all three. ([docs/boundaries.md](docs/boundaries.md))
- **Redis Streams for Broker** — per-boundary streams (`boundary:{name}`), AOF persistence for durability, thin Broker service with no routing logic. ([docs/broker.md](docs/broker.md))
- **Split-provider model strategy** — workers use Anthropic Claude, Reviewer uses OpenAI; anti-collusion enforced by Gateway model allowlists. ([docs/agents.md](docs/agents.md))
- **Kubex Manager from day one** — Docker lifecycle managed programmatically from MVP; not deferred. ([docs/infrastructure.md](docs/infrastructure.md))
- **Hybrid knowledge base: Graphiti + OpenSearch** — Graphiti (bi-temporal graph) for entities and facts, OpenSearch (existing) for document corpus; LightRAG rejected for lack of temporal support. ([docs/knowledge-base.md](docs/knowledge-base.md))
- **Skill-based agent deployment** — agents are defined by composable skills (manifest + instructions + tools), not custom code; the CLI `deploy` command picks skills interactively and Kubex Manager assembles the container. ([docs/skill-catalog.md](docs/skill-catalog.md))
- **Single Management API for CLI and web UI** — the `kubexclaw` CLI and the Command Center share the same 25-endpoint REST API on Kubex Manager; the web UI adds WebSocket subscriptions but all mutations use the same endpoints. ([docs/api-layer.md](docs/api-layer.md))
- **Secrets via bind-mounted files** — never environment variables; mounted read-only at `/run/secrets/`; path-compatible with Docker Swarm and Kubernetes conventions. ([docs/infrastructure.md](docs/infrastructure.md))
- **Fail-closed for security, degrade gracefully for observability** — Gateway down = all Kubex actions queue; OpenSearch down = agents continue and logs buffer. ([docs/operations.md](docs/operations.md))
- **Orchestrator as the sole human interface** — workers never interact with users directly; MVP Orchestrator runs host-resident with terminal as the chat interface. ([docs/user-interaction.md](docs/user-interaction.md))
- **Command Center as the single ops screen** — replaces fragmented Grafana/OpenSearch Dashboards/Mission Control for daily operations; MFA required for all destructive actions. ([docs/command-center.md](docs/command-center.md))

---

## Status — Open Gaps

See [docs/gaps.md](docs/gaps.md) for full details and resolution notes on all 19 gaps.

**Closed (resolved):** 15.1 (canonical schema), 15.2 (MVP deployment), 15.3 (Gateway architecture), 15.5 (kubex-common hierarchy), 15.6 (Broker technology), 15.7 (template system — retired), 15.8 (Kubex Manager API), 15.9 (output validation), 15.10 (terminology), 15.11 (error handling), 15.12 (CI/CD), 15.13 (testing), 15.14 (GDPR), 15.15 (DR), 15.16 (CLI), 15.17 (performance targets), 15.18 (distributed tracing), 15.19 (knowledge base)

**Open:**

- **Gap 15.4 — Boundary retrofit** (OPEN): Architectural decisions are made (Section 16.3), but Sections 2, 5, and 6 have not been updated to reflect boundary-aware tiers and diagrams. Four sub-tasks remain: retrofit Section 2 approval tier table, update Section 5 architecture diagrams, update Section 6 `accepts_from` defaults, and define Reviewer Kubex placement in the boundary model. See [docs/gaps.md](docs/gaps.md).

**MVP gap analysis closures (2026-03-08):**
- **C1 (Network Topology Mismatch)** — CLOSED: 3-network model adopted (`kubex-internal`, `kubex-external`, `kubex-data`), docker-compose updated
- **C3 (Credential Model Contradiction)** — CLOSED: Gateway LLM Proxy model adopted; workers get `*_BASE_URL` env vars, not API keys

**Post-architecture-review gaps** (identified March 2026):
- ~~Orchestrator task decomposition strategy not fully specified~~ — **CLOSED** (Section 13.3 in docs/agents.md: completion loop, decomposition strategy, Knowledge Kubex as third MVP agent)
- ~~Knowledge recall rate limiting not designed~~ — **CLOSED (2026-03-08):** All knowledge actions rate-limited at Gateway (query_knowledge: 30/min, store_knowledge: 10/min, search_corpus: 20/min per agent). Per-agent overrides via config.yaml. See [docs/knowledge-base.md](docs/knowledge-base.md) Section 27.12.1.
- ~~`valid_at` window enforcement for temporal query manipulation not implemented~~ — **CLOSED (2026-03-08):** Gateway enforces `valid_at` within +/- 24 hours (configurable per-boundary). Out-of-window requests rejected with structured error. See [docs/knowledge-base.md](docs/knowledge-base.md) Section 27.12.2.
- ~~Shared boundary secret scoping edge cases not resolved~~ — **CLOSED (2026-03-08):** Edge cases documented: boundary move revocation, secret name collision, rotation cascade with partial failure handling, cross-boundary secrets deferred to post-MVP. See [docs/boundaries.md](docs/boundaries.md) "Group Secrets — Edge Cases".
- ~~Infrastructure service hardening (Gateway, Broker, Registry) not fully specified~~ — **CLOSED (2026-03-08):** MVP hardening checklist added: container security (read_only, no-new-privileges, cap_drop ALL), inter-service auth, input validation at every boundary, logging conventions, health checks. See [docs/infrastructure.md](docs/infrastructure.md) "Service Hardening — MVP Checklist".

These are tracked in [docs/gaps.md](docs/gaps.md).
