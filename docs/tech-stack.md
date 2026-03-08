# Technology Stack — Versions, Libraries & Tooling

> Finalized 2026-03-08. This is the authoritative reference for all technology choices.

---

## 1. Core Platform

| Technology | Choice | Version / Constraint | Rationale |
|---|---|---|---|
| Language | Python | 3.12 | Latest stable; best async/typing support; performance improvements over 3.11 |
| Package Manager | uv | latest | Fast, pip-compatible, good monorepo support, modern lockfile |
| Web Framework | FastAPI | latest | All backend services use FastAPI; async-native, OpenAPI generation |
| Data Validation | Pydantic | v2 (>=2.0) | FastAPI native; better performance than v1; schema validation for ActionRequest/Response |
| Test Framework | pytest | latest | Mandated by project rules (CLAUDE.md) |
| Linting | ruff | latest | Mandated by project rules (CLAUDE.md) |
| Formatting | black | latest | Mandated by project rules (CLAUDE.md) |
| CI/CD | GitHub Actions | — | Monorepo-aware change detection; GHCR image publishing |

---

## 2. Core Libraries

| Library | Package | Purpose |
|---|---|---|
| HTTP Client | `httpx` | Async-native; used for inter-service calls, LLM proxy, Graphiti calls |
| Redis Client | `redis[asyncio]` (redis-py 5+) | Built-in async support via `redis.asyncio`; no separate aioredis needed |
| Docker SDK | `docker` (official Python SDK) | Kubex Manager container lifecycle management |
| CLI Framework | `typer` | `kubexclaw` CLI; built on click; type-hint driven; auto-completions |
| Structured Logging | `structlog` | JSON output; async-friendly; fits Docker JSON log driver |
| YAML Parser | `PyYAML` | Config files, policy files, skill manifests |
| JSON Schema Validation | Pydantic v2 | Already in stack via FastAPI; no separate validator needed |
| OpenSearch Client | `opensearch-py` | Gateway writes to document corpus; queries `knowledge-corpus-*` indices |

---

## 3. Infrastructure Services

| Service | Image | Port | Purpose |
|---|---|---|---|
| Redis | `redis:7-alpine` | 6379 | Message broker (db0), rate limits (db1), Registry cache (db2), lifecycle (db3), budget (db4) |
| Neo4j | `neo4j:5-community` | 7687 / 7474 | Graphiti backend (knowledge graph storage) |
| OpenSearch | `opensearchproject/opensearch:2` (single-node) | 9200 | Document corpus + operational logging |
| Graphiti | `zepai/graphiti:latest` | 8100 | Temporal knowledge graph REST API |

> See [infrastructure.md](infrastructure.md) for the full port assignment table, Docker network topology, and resource budget.

---

## 4. LLM Providers & Models

| Provider | Models | Usage |
|---|---|---|
| Anthropic | `claude-haiku-4-5` (light/default), `claude-sonnet-4-6` (standard/escalation) | Worker Kubexes, Orchestrator, Knowledge Kubex |
| OpenAI | `o3-mini` | Reviewer agent (anti-collusion: different provider than workers) |
| Google (optional) | Gemini | Supported via Gateway proxy; not used in MVP |

> All LLM API calls are proxied through the Gateway. Kubexes never hold API keys. See [gateway.md](gateway.md) Section 13.9.1.

---

## 5. Agent Runtime

| Component | Version | Notes |
|---|---|---|
| OpenClaw | >= v2026.2.26 | Base runtime for all Kubexes; upstream (no fork); pinned per policy |

> See [agents.md](agents.md) for OpenClaw versioning, auto-update flow, and security audit results.

---

## 6. Deferred (Post-MVP)

| Technology | Purpose | Timing |
|---|---|---|
| Fluent Bit | Centralized log aggregation to OpenSearch | Post-MVP |
| Grafana + Prometheus | Monitoring dashboards and metrics | V1+ |
| OpenTelemetry / Jaeger | Distributed tracing | Post-MVP |
| Infisical / Vault | Secrets management with rotation + audit | V1+ |
| OpenSearch Dashboards | Log visualization | Post-MVP |
| Celery / APScheduler | Scheduled task execution | Post-MVP |

---

## 7. Package Structure (Monorepo)

The project uses a **uv workspace** monorepo. Services depend on `kubex-common` via local path dependencies. Each service has its own `pyproject.toml`.

```
kubexclaw/
├── pyproject.toml              # root — uv workspace config
├── uv.lock                     # single lockfile for entire workspace
├── libs/
│   └── kubex-common/
│       └── pyproject.toml      # schemas, auth, audit, logging, metrics
├── services/
│   ├── gateway/
│   │   └── pyproject.toml      # FastAPI + httpx + redis + opensearch-py
│   ├── kubex-manager/
│   │   └── pyproject.toml      # FastAPI + docker SDK + redis
│   ├── broker/
│   │   └── pyproject.toml      # FastAPI + redis
│   └── registry/
│       └── pyproject.toml      # FastAPI + redis
└── agents/
    └── _base/                  # OpenClaw base image (config-only differentiation)
```

> Details on the full repo layout are in [architecture.md](architecture.md).

### Action Items

- [ ] Create `pyproject.toml` for `kubex-common` with core dependencies
- [ ] Create `pyproject.toml` for gateway service
- [ ] Create `pyproject.toml` for kubex-manager service
- [ ] Pin exact versions in `uv.lock` after initial dependency resolution
- [ ] Set up uv workspace configuration in root `pyproject.toml`
