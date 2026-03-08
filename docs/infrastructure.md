# Infrastructure — Prerequisites, Secrets, Logging & Deployment

> Extracted from BRAINSTORM.md. See [KubexClaw.md](../KubexClaw.md) for the full index.

---

## 0. Prerequisites

Before building the agent pipeline, the following must be in place.

### Knowledge & Skills
- [ ] Team familiarity with Docker and Docker Compose (networking, volumes, resource limits)
- [ ] Understanding of OpenClaw configuration, deployment, and plugin/skill system
- [ ] Understanding of Docker network isolation and Gateway-proxied egress control
- [ ] Understanding of LLM prompt injection attack vectors and mitigations

### Infrastructure
- [ ] Host machine or VM provisioned with Docker Engine installed
- [ ] Container registry (private) for hosting agent images
- [ ] DNS and networking — internal DNS, reverse proxy, TLS certificates
- [ ] Secret management system deployed (HashiCorp Vault or Docker secrets)
- [ ] Central log store — OpenSearch cluster (see Section 10)
- [ ] Monitoring stack (Prometheus + Grafana or equivalent)
- [ ] Log shipper — central Fluent Bit instance (see Section 9)
- [ ] CI/CD pipeline for building and deploying agent images

### Accounts & Access
- [ ] LLM API keys for Gateway LLM proxy (Anthropic, OpenAI — mounted into Gateway only, never into workers)
- [ ] Separate LLM API key for reviewer model provider (OpenAI — also Gateway-only, enforced by model allowlist)
- [ ] Service credentials for target systems agents will interact with (SMTP, Git, databases, etc.)
- [ ] SSO / identity provider integration for human approval queue

### Security Baseline
- [ ] Threat model document — enumerate what each agent can access, what damage a compromised agent could cause
- [ ] Incident response plan — what happens when an agent is compromised (runbook)
- [ ] Data classification policy — which company data each agent tier is allowed to touch
- [ ] Compliance requirements identified (GDPR, SOC2, industry-specific)

### OpenClaw Specific
- [ ] OpenClaw version / fork selected and pinned
- [ ] Evaluate OpenClaw's built-in permission model — what it covers vs what we need to build around it
- [ ] Inventory of OpenClaw skills/plugins needed per agent role
- [ ] Test environment for validating agent behavior before production deployment

```mermaid
flowchart LR
    subgraph prereq["Prerequisites"]
        direction TB
        KNOW[Knowledge & Skills]
        INFRA[Infrastructure]
        ACCESS[Accounts & Access]
        SEC[Security Baseline]
        OC[OpenClaw Setup]
    end

    subgraph build["Build Phase"]
        direction TB
        ISO[1. Isolation Architecture]
        REV[2. Approval Gateway]
        IO[3. I/O Gating]
        OPS[4. Infra & Ops]
    end

    prereq --> build
    KNOW -.-> ISO
    INFRA -.-> OPS
    ACCESS -.-> REV
    SEC -.-> IO
    OC -.-> ISO

    style prereq fill:#264653,stroke:#fff,color:#fff
    style build fill:#2d6a4f,stroke:#fff,color:#fff
```

---

## 4. Infrastructure & Operations

### Action Items
- [ ] Install and harden Docker Engine on the host (disable unnecessary capabilities, enable user namespaces)
- [ ] Write Docker Compose files per Kubex with network isolation, resource limits, and secret mounts
- [ ] Disable outbound internet by default on each Kubex network; route all egress through Gateway proxy (see Section 13.9)
- [ ] Block host Docker socket from all Kubexes (never mount `/var/run/docker.sock`)
- [ ] Implement real-time alerting on anomalous Kubex behavior
- [ ] Build per-Kubex kill switch (`docker stop <container>` + rotate its secrets)
- [ ] Pin all image versions and verify digests in Compose files
- [ ] Design KubexClaw monitoring dashboard for Kubex activity

---

## 8. Secrets Management Strategy

**Decision:** Phased approach — start with bind-mounted secret files for MVP, graduate to more sophisticated tooling as needed.

**Hard Rule:** Secrets are **never** passed as environment variables. Always mounted as read-only files at `/run/secrets/`.

### Phase Plan

| Phase | Approach | When |
|-------|----------|------|
| **MVP** | **Bind-mounted secret files** — Kubex Manager writes secrets to host paths and bind-mounts them read-only into containers at `/run/secrets/` | Now — get the agent pipeline working |
| **V1** | **Infisical** (self-hosted) — open-source secrets platform with dashboard, rotation, audit trail, syncs to Docker | When we need rotation, audit, or team management |
| **V2** | **HashiCorp Vault** — dynamic secrets, on-the-fly credential generation, lease-based expiry | If we need per-task ephemeral DB credentials, etc. |

### MVP — Bind-Mounted Secret Files

**How it works:**
- Kubex Manager writes secret files to a host directory (e.g., `/var/lib/kubexclaw/secrets/<agent_id>/`)
- Secrets are bind-mounted as read-only into Kubex containers at `/run/secrets/<secret_name>`
- The `/run/secrets/` path convention is identical to Docker Swarm secrets, ensuring a seamless migration path to Swarm or Kubernetes secrets post-MVP
- Host secret directories are created with restrictive permissions (`0700`, owned by the Kubex Manager process user)
- Individual secret files are created with `0400` permissions (read-only, owner only)
- Kubex Manager is the only process that writes to the host secret directories

**What this gives us:**
- No Docker Swarm mode required — works with plain Docker Engine and Docker Compose
- Per-Kubex scoping — each container only mounts the secrets it needs
- Secrets appear at `/run/secrets/` inside the container, identical to Swarm/Kubernetes conventions
- Compatible with future migration to Docker Swarm secrets (`docker secret create`) or Kubernetes secrets (mounted at the same path)
- Kill switch works — `docker stop` kills the container, bind-mounts are detached

**What this doesn't give us:**
- No automatic rotation — must update host file + restart container
- No audit trail of secret access (file-level access logging only via OS audit)
- No dynamic/ephemeral credentials
- No GUI for secret management (managed via Kubex Manager API — Section 19.7)
- Secrets exist on host disk (not encrypted at rest unless host filesystem is encrypted)

**Acceptable for MVP because:**
- We're proving the agent pipeline works, not operating at scale yet
- Secret rotation can be done manually with low agent count
- Kill switch still works — `docker stop` kills the container, secrets are inaccessible
- The `/run/secrets/` path convention means Kubex code never changes when we graduate to Swarm or Kubernetes secrets

### CLI LLM Credential Management

> **Cross-references:** docs/user-interaction.md Section 30.9 (full design), MVP.md Section 6.4, MVP.md Phase 0 checklist.

CLI LLMs inside Kubex containers need credentials to call LLM providers. The auth complexity comes from the **LLM provider**, not the CLI LLM framework. API key providers are trivial (paste a key). OAuth providers require a one-time browser-based consent flow on the host.

#### Secrets Directory Structure

```
secrets/
├── llm-api-keys.json                    # API key providers (Anthropic, OpenAI, OpenRouter)
├── llm-oauth-tokens.json                # OAuth refresh tokens (Gateway-managed, RW for Gateway)
└── cli-credentials/
    ├── claude/
    │   └── credentials.json             # Claude Code OAuth token
    ├── openclaw/
    │   └── auth-profiles.json           # OpenClaw OAuth profiles (Google Gemini, etc.)
    └── aider/
        └── credentials.json             # If needed
```

**Permissions:**
- `secrets/` directory: `0700`, owned by the host user running `kubexclaw setup`
- `secrets/llm-api-keys.json`: `0600` (read-write for setup script, read-only bind-mount into Kubex Manager)
- `secrets/llm-oauth-tokens.json`: `0600` (read-write for Gateway — it manages token refresh)
- `secrets/cli-credentials/`: `0700` per-provider subdirectory
- Individual credential files: `0600`

**IMPORTANT:** The `secrets/` directory must be in `.gitignore`. Never commit credentials.

#### Redis AUTH & ACL Setup

Redis is configured with password authentication (`requirepass`) and per-service ACL users. The ACL file is mounted into the Redis container at `/etc/redis/users.acl`.

**ACL file (`config/redis/users.acl`):**

```
user default off
user gateway-svc on >password ~* &* +@all
user broker-svc on >password ~broker:* ~task:* &* +@all
user manager-svc on >password ~lifecycle:* ~kubex:* &* +@all
user registry-svc on >password ~registry:* &* +@all
```

> **Note:** Replace `>password` with actual per-service passwords before deployment. The `default` user is disabled to prevent unauthenticated access. Each service connects with its own Redis user via the `REDIS_URL` connection string (e.g., `redis://gateway-svc:password@redis:6379`). See docs/gateway.md Section 13.9 for the full Redis ACL specification.

**Docker Compose integration:** The Redis service mounts the ACL file and requires password authentication:
- `command: redis-server --requirepass ${REDIS_PASSWORD} --aclfile /etc/redis/users.acl`
- Services connect via `REDIS_URL` with credentials (e.g., `redis://broker-svc:${REDIS_PASSWORD}@redis:6379/0`)

#### Setup CLI

Credentials are configured before `docker compose up -d` via the `kubexclaw` CLI:

```bash
./kubexclaw setup                  # Interactive walkthrough of all providers
./kubexclaw auth anthropic         # API key — just paste it
./kubexclaw auth google-gemini     # OAuth — opens browser for consent
./kubexclaw auth claude            # OAuth — device code flow
./kubexclaw reauth google-gemini   # Re-auth if token revoked/expired
```

The setup script is **provider-scoped, not CLI-scoped**. The provider determines the auth flow.

#### Credential Flow by Type

> **Decision (2026-03-08): Gateway LLM Proxy model adopted.** LLM API keys are Gateway-only secrets. Workers never hold API keys. CLI LLMs inside Kubex containers are configured with `*_BASE_URL` env vars pointing to Gateway proxy endpoints (e.g., `ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic`). The Gateway injects the real API key when proxying requests to the provider. See docs/gateway.md Section 13.9.1 for full design.

**API Key Providers (Anthropic, OpenAI, OpenRouter, Ollama):**
1. User runs `./kubexclaw auth <provider>` and pastes the API key
2. Key stored in `secrets/llm-api-keys.json`
3. `secrets/llm-api-keys.json` is mounted into the **Gateway only** (not workers)
4. Kubex Manager sets `*_BASE_URL` env vars on worker containers pointing to Gateway proxy endpoints (e.g., `ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic`)
5. CLI LLM inside the container sends requests to the Gateway; Gateway injects the real API key and forwards to the provider — zero interaction needed

**OAuth Providers (Google Gemini, GitHub Copilot, Claude Code):**
1. User runs `./kubexclaw auth <provider>` — browser consent or device code flow
2. Tokens stored in `secrets/llm-oauth-tokens.json` (refresh token) and `secrets/cli-credentials/<provider>/` (credential files)
3. `secrets/llm-oauth-tokens.json` is mounted into the **Gateway only** (not workers)
4. `secrets/cli-credentials/<provider>/` files are mounted into workers only for CLI LLM authentication purposes (e.g., Claude Code OAuth token for CLI identity — separate from the LLM API key)
5. Gateway manages token refresh centrally (check expiry every 60s, refresh 5min early)
6. Access tokens cached in Redis db4; refresh tokens in secrets files
7. If a provider rotates the refresh token, Gateway updates `secrets/llm-oauth-tokens.json` (Gateway has read-write mount)

#### Agent Manifest Provider Declaration

Each agent's manifest declares which LLM providers it needs **via Gateway proxy**. Kubex Manager reads this at container creation time and sets the appropriate `*_BASE_URL` env vars pointing to Gateway proxy endpoints. No API keys are injected into worker containers.

```yaml
# agents/instagram-scraper/manifest.yaml
agent_id: instagram-scraper
cli: openclaw
providers:
  - anthropic    # Kubex Manager sets ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic
skills:
  - web-scraping
  - data-extraction
```

```yaml
# agents/data-analyst/manifest.yaml
agent_id: data-analyst
cli: claude
providers:
  - claude       # Kubex Manager sets ANTHROPIC_BASE_URL + mounts CLI OAuth token file
skills:
  - data-analysis
```

> **Note:** The `providers` field means "which providers this agent needs access to via Gateway proxy", not "which credentials to mount". Kubex Manager translates `providers` into `*_BASE_URL` env vars. For OAuth-based CLI LLMs (e.g., Claude Code), the CLI auth token (`secrets/cli-credentials/claude/`) is still mounted — this is for CLI identity, not for LLM API access.

#### Token Refresh Architecture

```mermaid
sequenceDiagram
    participant GW as Gateway
    participant Secrets as secrets/llm-oauth-tokens.json
    participant Redis as Redis db4
    participant W1 as Worker A (RO mount)
    participant W2 as Worker B (RO mount)

    loop Every 60 seconds
        GW->>Redis: Check access_token expiry
        alt Token expires within 5min
            GW->>Secrets: Read refresh_token
            GW->>GW: Exchange refresh_token for new access_token
            GW->>Redis: Cache new access_token + expires_at
            alt Provider rotated refresh_token
                GW->>Secrets: Write new refresh_token (RW mount)
            end
        end
    end

    Note over W1,W2: Workers read mounted credential files (RO)
    W1->>W1: CLI LLM finds credentials, works normally
    W2->>W2: CLI LLM finds credentials, works normally
```

#### Credential Management Action Items

- [ ] Create `secrets/` directory structure with proper permissions (`0700`/`0600`)
- [ ] Add `secrets/` to `.gitignore`
- [ ] Build `kubexclaw setup` CLI script (Python, interactive provider walkthrough)
- [ ] Build `kubexclaw auth <provider>` command (per-provider auth flow)
- [ ] Build `kubexclaw reauth <provider>` command (re-authorization)
- [ ] Implement Gateway token refresh loop (check expiry every 60s, refresh 5min early, cache in Redis db4)
- [ ] Implement Kubex Manager credential mounting (read agent manifest `providers` field, mount appropriate files)
- [ ] Document provider-specific setup instructions (GCP Console for Gemini OAuth, Anthropic Console for API keys, etc.)
- [ ] Post-MVP: Command Center UI for credential management

```mermaid
flowchart LR
    subgraph admin["Admin Layer"]
        KM[Kubex Manager\nwrites secret files to host\nbind-mounts into containers]
    end

    subgraph host["Host Filesystem"]
        HS["/var/lib/kubexclaw/secrets/\nper-agent directories\n0700 permissions"]
    end

    subgraph kubexes["Kubexes"]
        K1[Email Agent\n/run/secrets/smtp-creds]
        K2[Code Agent\n/run/secrets/git-token]
        K3[Data Agent\n/run/secrets/db-creds]
    end

    KM -->|write secret files| HS
    HS -->|bind-mount read-only| K1
    HS -->|bind-mount read-only| K2
    HS -->|bind-mount read-only| K3

    style admin fill:#264653,stroke:#fff,color:#fff
    style host fill:#2d6a4f,stroke:#fff,color:#fff
    style kubexes fill:#1a1a2e,stroke:#e94560,color:#fff
```

### Graduation Criteria — When to Move to V1 (Infisical)

Move to Infisical when any of these become true:
- [ ] More than ~10 Kubex roles with distinct secrets — manual management becomes painful
- [ ] Need to rotate secrets without redeploying Kubexes
- [ ] Need audit trail of who accessed which secret and when
- [ ] Multiple team members managing secrets — need RBAC
- [ ] Compliance requirements demand secret access logging

### Action Items
- [ ] Implement bind-mounted secret file provisioning in Kubex Manager
- [ ] Document secret file naming convention (e.g., `/run/secrets/{secret_name}`)
- [ ] Create initial secrets for the first Kubex roles (email, code, data agents)
- [ ] Test secret mount lifecycle: create → mount → Kubex reads → Kubex stops → verify secret not accessible
- [ ] Document the manual rotation procedure (for MVP)
- [ ] Migrate to Docker Swarm secrets or Kubernetes secrets post-MVP

---

## 9. Central Logging — OpenSearch

> **MVP note:** For MVP, Docker's built-in JSON log driver is used. All containers log to stdout/stderr, and logs are accessible via `docker logs <container>` and `kubexclaw agents logs <name>` (which reads container logs via the Docker API). Fluent Bit is added post-MVP for central log aggregation to OpenSearch. See MVP.md Section 13 (Deferred to Post-MVP).

**Decision:** All KubexClaw logs flow into a single **OpenSearch** cluster. A central **Fluent Bit** instance collects logs from all containers via Docker's logging driver.

**Why OpenSearch:**
- All our logs are already structured JSON (action requests, Gateway decisions, model usage, audit events) — perfect for search and aggregation
- OpenSearch Dashboards provides the monitoring UI from Section 4 out of the box
- Index lifecycle policies enforce append-only / immutable indices for tamper-evident audit trail
- Open source (Apache 2.0), self-hosted, no licensing issues
- Scales from single-node (MVP) to multi-node cluster

**Why not alternatives:**
- **Elasticsearch** — functionally similar but SSPL license since 2021, not truly open source
- **Loki + Grafana** — lighter weight but weaker full-text search; better for metrics than structured event search
- **Plain files** — not searchable, no dashboards, no alerting, doesn't scale

### Log Pipeline Architecture

```mermaid
flowchart LR
    subgraph kubexes["Kubexes & Services (stdout/stderr)"]
        K1[Email Agent]
        K2[Code Agent]
        K3[Data Agent]
        GW[Gateway]
        KM[Kubex Manager]
        KB[Kubex Broker]
    end

    kubexes -->|"Docker json-file logs<br/>/var/lib/docker/containers/"| FB

    FB[Central Fluent Bit<br/>single instance<br/>enriches + routes]

    FB --> OS

    subgraph logging["Central Log Store"]
        OS[OpenSearch Cluster]
        OSD[OpenSearch Dashboards]
        OS --> OSD
    end

    subgraph alerting["Alerting"]
        OS -->|anomaly rules| ALERT[Alert Manager\nemail · Slack · webhook]
    end

    style kubexes fill:#1a1a2e,stroke:#e94560,color:#fff
    style FB fill:#e76f51,stroke:#fff,color:#fff
    style logging fill:#264653,stroke:#fff,color:#fff
    style alerting fill:#9b2226,stroke:#fff,color:#fff
```

### Log Categories & Indices

Each log type gets its own OpenSearch index for independent retention policies and access control.

| Index | Source | Contents | Retention |
|-------|--------|----------|-----------|
| `kubex-actions` | Gateway | Every action request: who, what, tier, decision, timestamp | 1 year (compliance) |
| `kubex-model-usage` | Gateway + Kubexes | Model calls: which model, tokens used, cost, escalation reason | 6 months |
| `kubex-activations` | Gateway + Kubex Manager | Activation requests: plan, approval, duration, actual runtime | 1 year |
| `kubex-inter-agent` | Kubex Broker | Inter-agent messages: from, to, capability, workflow chain | 1 year |
| `kubex-lifecycle` | Kubex Manager | Kubex start/stop/kill events, secret mounts, resource usage | 6 months |
| `kubex-anomalies` | Gateway + all services | Anomaly events: denial spikes, rate limit hits, circuit breaker triggers | 1 year |
| `kubex-system` | All services | Application logs, errors, health checks | 30 days |

### Fluent Bit — Central Log Collector

> **Decision change:** Replaced per-Kubex Fluent Bit sidecar pattern with a **single central Fluent Bit instance**. Per-Kubex sidecars are unnecessary overhead — Docker's built-in logging driver routes all container logs to a central collector.

A single Fluent Bit container collects logs from all Kubexes and infrastructure services. No per-Kubex sidecars needed — Kubex Manager does NOT need to manage logging containers.

**How it works:**
- All containers use Docker's `json-file` logging driver (the default)
- Fluent Bit reads logs from `/var/lib/docker/containers/` via the `tail` input plugin
- Fluent Bit enriches with metadata: `agent_id`, `kubex_role`, `container_id`, timestamp (parsed from Docker container labels)
- Routes to OpenSearch `logs-*` indices
- Buffers locally if OpenSearch is temporarily unreachable (filesystem buffer, max 512 MB)

**Advantages over sidecar pattern:**
- One container instead of N sidecars (saves ~50MB RAM per Kubex)
- Kubex Manager lifecycle is simpler — no logging sidecars to create/destroy alongside Kubexes
- Centralized configuration — one `fluent-bit.conf` for all log routing
- Kubexes on `kubex-internal` network do not need access to OpenSearch — Fluent Bit handles it

```yaml
# docker-compose.yml — central Fluent Bit
services:
  fluent-bit:
    image: fluent/fluent-bit:3.2
    container_name: kubexclaw-fluent-bit
    volumes:
      - ./fluent-bit/fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - fluent-bit-buffer:/fluent-bit/buffer
    networks:
      - kubex-internal
      - kubex-data
    depends_on:
      - opensearch
    restart: unless-stopped
```

Fluent Bit runs on both `kubex-internal` (to read container logs) and `kubex-data` (to reach OpenSearch). It does not need `kubex-external` — it never accesses the internet.

### Append-Only / Tamper-Evident Guarantees

- OpenSearch Index State Management (ISM) policy transitions indices to **read-only** after a configurable period (e.g., 24 hours)
- Once read-only, no documents can be modified or deleted
- Snapshot to object storage (S3 / MinIO) for long-term retention and disaster recovery
- Optional: hash chain per index — each batch of logs includes a hash of the previous batch for tamper detection

### Live Swarm Overview — Grafana + Prometheus + OpenSearch

A single live dashboard requires **two data sources** working together:

| Data Source | What it provides | Tool |
|-------------|-----------------|------|
| **Prometheus** | Real-time metrics — Kubex up/down, CPU/memory, request throughput, latency | Scraped from each service's `/metrics` endpoint |
| **OpenSearch** | Event-based logs — Gateway decisions, audit events, cost data, workflow traces | Fed by central Fluent Bit instance |

**Grafana** unifies both into a single dashboard by querying Prometheus and OpenSearch side-by-side.

```mermaid
flowchart LR
    subgraph sources["Data Sources"]
        PROM[Prometheus\nmetrics: CPU, memory,\nrequest rate, latency,\nup/down state]
        OS[OpenSearch\nlogs: decisions, audit,\ncost, workflows,\nanomalies]
    end

    PROM --> GF
    OS --> GF

    GF[Grafana\nUnified Dashboards\n+ Alerting]

    subgraph exporters["Metric Exporters"]
        GW_M[Gateway\n/metrics]
        KM_M[Kubex Manager\n/metrics]
        KB_M[Kubex Broker\n/metrics]
        CA_M[cAdvisor\ncontainer metrics]
    end

    exporters -->|scrape| PROM

    style sources fill:#264653,stroke:#fff,color:#fff
    style GF fill:#e76f51,stroke:#fff,color:#fff
    style exporters fill:#2d6a4f,stroke:#fff,color:#fff
```

**Each service exposes a `/metrics` endpoint** (Prometheus format) via `kubex-common`. Prometheus scrapes them. **cAdvisor** runs on the Docker host to export container-level CPU, memory, network, and disk metrics for every Kubex without any instrumentation inside the containers.

### Swarm Overview Dashboard — Panels

The main Grafana dashboard is the **KubexClaw Swarm Overview** — the single pane of glass for the entire fleet:

```mermaid
flowchart TD
    subgraph row1["Fleet Status (Prometheus)"]
        direction LR
        TOTAL["Total Kubexes\n🟢 4 running\n🔴 3 stopped\n⚫ 1 disabled"]
        HEALTH["Health Map\nper-Kubex health tile grid\ngreen/yellow/red"]
        UPTIME["Uptime Tracker\nper-Kubex uptime bars\nlast 24h"]
    end

    subgraph row2["Live Activity (Prometheus + OpenSearch)"]
        direction LR
        RPS["Request Throughput\nactions/sec per Kubex\nstacked area chart"]
        GATE["Gateway Decisions\nallow/deny/escalate\nreal-time pie + timeline"]
        LATENCY["Action Latency\np50/p95/p99\nper Kubex"]
    end

    subgraph row3["Resources (Prometheus via cAdvisor)"]
        direction LR
        CPU["CPU Usage\nper-Kubex gauge\nwith limit line"]
        MEM["Memory Usage\nper-Kubex gauge\nwith limit line"]
        NET["Network I/O\nper-Kubex egress\nflags unexpected traffic"]
    end

    subgraph row4["Cost & Models (OpenSearch)"]
        direction LR
        COST["Token Spend\nburn rate $/hr\nper agent + total"]
        MODEL["Model Usage\nwhich models active\nescalation events"]
        BUDGET["Budget Remaining\nper-task + global\nalert thresholds"]
    end

    subgraph row5["Workflows & Approvals (OpenSearch)"]
        direction LR
        ACTIVE["Active Workflows\nin-progress chains\ndepth + participants"]
        PENDING["Pending Approvals\nhuman queue depth\nwait time"]
        ANOMALY["Anomaly Feed\nlive denial spikes\ncircuit breaker events"]
    end

    style row1 fill:#264653,stroke:#fff,color:#fff
    style row2 fill:#2d6a4f,stroke:#fff,color:#fff
    style row3 fill:#1a1a2e,stroke:#e94560,color:#fff
    style row4 fill:#e76f51,stroke:#fff,color:#fff
    style row5 fill:#9b2226,stroke:#fff,color:#fff
```

### Alerting Rules (Grafana)

Grafana fires alerts based on both metrics and logs:

| Alert | Source | Trigger | Action |
|-------|--------|---------|--------|
| Kubex down | Prometheus | Kubex health check fails for >30s | Notify admin (Slack/email) |
| CPU/Memory spike | Prometheus (cAdvisor) | Kubex exceeds 80% resource limit | Warn admin; 95% = circuit breaker |
| Gateway denial spike | OpenSearch | >10 denials/min from single agent | Flag agent, notify admin |
| Budget overrun | OpenSearch | Token spend exceeds 80% of task/global budget | Warn admin; 100% = kill task |
| Approval queue backlog | OpenSearch | >5 pending approvals waiting >10min | Escalate to admin |
| Activation duration overrun | OpenSearch | Kubex at 80% of approved duration | Warn admin; 100% = auto-stop |
| Unexpected egress | Prometheus | Network traffic to non-allowlisted destination | Kill Kubex, alert admin |

### OpenSearch Dashboards (Log Analytics)

For deeper investigation beyond the live overview, OpenSearch Dashboards provides:

| Dashboard | Purpose |
|-----------|---------|
| **Gateway Decisions** | Historical action decisions: allow/deny/escalate ratios, tier breakdown, trends |
| **Agent Activity Deep Dive** | Per-Kubex action history, model usage over time, active duration |
| **Cost Analytics** | Token spend per agent, per model, per workflow — historical trends + forecasting |
| **Anomaly Investigation** | Drill into denial spikes, rate limit events, circuit breaker triggers |
| **Workflow Trace Explorer** | End-to-end workflow traces: which agents participated, duration, outcome |
| **Activation Audit** | Activation request history: plans submitted, approved/rejected, duration compliance |

### Action Items
- [ ] Deploy single-node OpenSearch + OpenSearch Dashboards via Docker Compose
- [ ] Deploy Prometheus + Grafana + cAdvisor via Docker Compose
- [ ] Define Fluent Bit config for central log collector (input: Docker json-file logs, output: OpenSearch)
- [ ] Define index schemas for each log category (mappings + ISM policies)
- [ ] Implement structured log format in `kubex-common` (shared JSON log schema all components use)
- [ ] Implement `/metrics` endpoint in `kubex-common` (Prometheus exporter for all services)
- [ ] Build Fluent Bit metadata enrichment (parse Docker labels for `agent_id`, `kubex_role`, `container_id`)
- [ ] Set up append-only ISM policy (read-only after 24h)
- [ ] Build KubexClaw Swarm Overview Grafana dashboard (fleet status, activity, resources, cost, approvals)
- [ ] Configure Grafana alerting rules (Kubex down, CPU spike, denial spike, budget overrun, egress anomaly)
- [ ] Create OpenSearch Dashboards for deep-dive log analytics
- [ ] Add Prometheus + Grafana + cAdvisor to root `docker-compose.yml`
- [ ] Add OpenSearch + Fluent Bit to root `docker-compose.yml`

---

## 13.5 Host Machine Specs & Resource Allocation

**Question:** Host machine specs — bare metal or cloud VM?

**Decision:** Bare metal workstation, **64GB RAM total**, **24GB reserved for the Docker cluster**.

**MVP resource budget:**

| Container | RAM Allocation | CPU Shares | Notes |
|-----------|---------------|------------|-------|
| Gateway | 512MB | 0.5 CPU | Policy engine + egress proxy + LLM reverse proxy + scheduler |
| Kubex Manager | 256MB | 0.25 CPU | Docker SDK lifecycle |
| Kubex Broker | 256MB | 0.25 CPU | Redis-backed message routing |
| Kubex Registry | 128MB | 0.25 CPU | In-memory capability store |
| Orchestrator Kubex | 2GB | 1.0 CPU | OpenClaw + LLM API calls (proxied through Gateway) |
| Instagram Scraper Kubex | 2GB | 1.0 CPU | OpenClaw + HTTP scraping (proxied through Gateway) |
| Reviewer Kubex | 2GB | 1.0 CPU | OpenClaw + o3-mini API calls (proxied through Gateway) |
| Redis | 512MB | 0.5 CPU | Message queue + rate limits + budget |
| Neo4j | 1.5GB | 0.5 CPU | Graphiti knowledge graph backend |
| Graphiti | 512MB | 0.25 CPU | Temporal knowledge graph REST API |
| OpenSearch | 3GB | 1.0 CPU | Single-node: 1.5GB heap + OS overhead |
| **Total Docker MVP** | **~12.7GB** | **6.5 CPU** | All components containerized |
| **Remaining headroom** | **~11.3GB** | | Room for 4-5 more Kubexes |

> **Note:** Gateway sizing increased from 128MB to 512MB to reflect its expanded role as LLM reverse proxy (streaming passthrough, token counting, auth header injection) in addition to policy engine and egress proxy. See docs/gateway.md Section 13.9.

```yaml
# docker-compose.yml resource limits
services:
  gateway:
    deploy:
      resources:
        limits: { memory: 512M, cpus: '0.5' }
  kubex-manager:
    deploy:
      resources:
        limits: { memory: 256M, cpus: '0.25' }
  kubex-broker:
    deploy:
      resources:
        limits: { memory: 256M, cpus: '0.25' }
  kubex-registry:
    deploy:
      resources:
        limits: { memory: 128M, cpus: '0.25' }
  orchestrator:
    deploy:
      resources:
        limits: { memory: 2G, cpus: '1.0' }
  instagram-scraper:
    deploy:
      resources:
        limits: { memory: 2G, cpus: '1.0' }
  reviewer:
    deploy:
      resources:
        limits: { memory: 2G, cpus: '1.0' }
  redis:
    deploy:
      resources:
        limits: { memory: 512M, cpus: '0.5' }
  neo4j:
    deploy:
      resources:
        limits: { memory: 1536M, cpus: '0.5' }
  graphiti:
    deploy:
      resources:
        limits: { memory: 512M, cpus: '0.25' }
  opensearch:
    deploy:
      resources:
        limits:
          memory: 3G
          cpus: '1.0'
    environment:
      - OPENSEARCH_JAVA_OPTS=-Xms1536m -Xmx1536m
```

24GB is comfortable for MVP and scales to ~12 concurrent Kubexes before needing more resources.

---

## 13.8 MVP Deployment Model

**Question:** How are Kubexes started and managed in MVP?

**Decision:** **Kubex Manager from day one.** The Kubex Manager is part of MVP scope — not deferred to a later phase.

**Rationale:**
- The core value proposition of KubexClaw is the orchestration infrastructure itself. An MVP without the Kubex Manager proves that "an agent can scrape Instagram" — not that the security and lifecycle model works.
- The Kubex Manager was scoped at ~200 lines of Python (Section 7). It's not a heavy lift.
- Without it, the MVP can't test: kill switch, dynamic activation, programmatic lifecycle, or the full Gateway→Manager integration.
- Building Compose-only first would require reworking container management when the Manager is added. Build it right once.

**MVP Component Stack:**

| Component | Type | Purpose | Managed By |
|-----------|------|---------|-----------|
| **Kubex Manager** | Infrastructure service | Docker lifecycle — create, start, stop, kill Kubexes | Docker Compose (always running) |
| **Gateway** | Infrastructure service | Policy evaluation — `POST /evaluate` for every action | Docker Compose (always running) |
| **Kubex Broker** | Infrastructure service | Routes `dispatch_task` between Kubexes | Docker Compose (always running) |
| **Kubex Registry** | Infrastructure service | Agent discovery — capabilities, status, `accepts_from` | Docker Compose (always running) |
| **Redis** | Infrastructure backing store | Message queue for Broker, rate limit state for Gateway | Docker Compose (always running) |
| **Orchestrator Kubex** | Supervisor agent | Receives tasks from human, dispatches to workers | Docker Compose (always running — user entry point) |
| **Instagram Scraper Kubex** | Worker agent | Scrapes public IG data, returns structured JSON | Kubex Manager (dynamic) |
| **Reviewer Kubex** | Reviewer agent | Evaluates ambiguous actions (OpenAI o3-mini) | Kubex Manager (dynamic) |

**What Docker Compose manages vs what Kubex Manager manages:**

```mermaid
flowchart TD
    subgraph compose["Docker Compose — Infrastructure + Orchestrator (always running)"]
        KM[Kubex Manager\nFastAPI + Docker SDK]
        GW[Gateway\nFastAPI · deterministic rules]
        KB[Kubex Broker\nMessage routing]
        KR[Kubex Registry\nCapability discovery]
        REDIS[(Redis)]
        ORCH[Orchestrator Kubex\nlong-lived · user entry point]
    end

    subgraph managed["Kubex Manager — Worker Agents (dynamic lifecycle)"]
        IS[Instagram Scraper Kubex\nstart · stop · kill]
        REV[Reviewer Kubex\nstart · stop · kill]
    end

    KM -->|"creates + manages"| IS & REV
    ORCH & IS -->|"action requests"| GW
    GW -->|"dispatch_task\n(writes to Broker internally)"| KB
    KB -->|"route to scraper"| IS
    IS -.->|"query capabilities"| KR
    KB --> REDIS
    GW -->|"rate limits"| REDIS

    style compose fill:#264653,stroke:#fff,color:#fff
    style managed fill:#1a1a2e,stroke:#e94560,color:#fff
```

> Note: The Orchestrator connects only to the Gateway — not to the Broker directly. `dispatch_task` is an ActionRequest to the Gateway; the Gateway writes to the Broker. Results are returned to the Orchestrator via the Gateway's task result API. (See Section 30 for MVP host-resident Orchestrator model.)

**MVP proves the full loop:**

```mermaid
sequenceDiagram
    actor Human
    participant KM as Kubex Manager
    participant ORCH as Orchestrator
    participant KB as Kubex Broker
    participant IS as Instagram Scraper
    participant GW as Gateway

    Human->>KM: Start MVP stack (docker compose up)
    Note over ORCH: Orchestrator started by docker-compose (always running)
    KM->>KM: Start Scraper, Reviewer (dynamic workers)
    KM->>KM: Register all agents in Kubex Registry

    Human->>ORCH: "Scrape Nike's Instagram, last 30 days"

    ORCH->>GW: ActionRequest { action: "dispatch_task", capability: "scrape_instagram" }
    GW->>GW: Evaluate policy → ALLOW
    GW->>KB: Write TaskDelivery { capability, context_message, from_agent: orchestrator }
    GW-->>ORCH: ALLOW { task_id }

    KB->>IS: TaskDelivery { task_id, capability, context_message }

    IS->>GW: ActionRequest { action: "http_get", target: "graph.instagram.com/nike" }
    GW->>GW: Check egress allowlist: instagram.com ✓
    GW-->>IS: ALLOW

    IS->>GW: ActionRequest { action: "write_output", target: "result.json" }
    GW-->>IS: ALLOW

    IS->>GW: ActionRequest { action: "report_result", task_id, status: "success", result: {...} }
    GW->>KB: Store result against task_id
    GW-->>IS: ALLOW

    ORCH->>GW: GET /tasks/{task_id}/result
    GW->>KB: Fetch result for task_id
    GW-->>ORCH: { status: "success", result: { posts: [...] } }

    ORCH->>Human: "Scrape complete. 47 posts found. Results in result.json."

    Note over Human,GW: Kill switch test
    Human->>KM: Kill instagram-scraper
    KM->>KM: docker stop + rotate secrets
    KM->>KM: Update Registry: status → stopped
```

**What MVP validates:**
- [x] Kubex Manager can start/stop/kill agents programmatically
- [x] Gateway gates every action at runtime (egress, action allowlist, budget)
- [x] Inter-agent dispatch works via Gateway → Broker with NL context (Orchestrator never touches Broker directly)
- [x] Kill switch works (container stop + secret rotation)
- [x] Agents are config-only (same OpenClaw runtime, different skills/prompt/policy)
- [x] End-to-end workflow: human → orchestrator → scraper → result

**What MVP defers:**
- Activation requests (no stopped Kubexes to activate in MVP — all 3 are always running)
- Reviewer LLM for ambiguous actions (Policy Engine handles all decisions deterministically for MVP)
- Human approval queue UI (approvals via CLI or direct API call)
- OpenSearch logging stack (stdout logs only for MVP)
- Grafana/Prometheus monitoring (manual `docker stats` for MVP)
- Command Center UI (CLI + API only for MVP)
- Kubex Boundaries — **deferred as separate containers**, but boundary logic runs inline (see below)

#### MVP Boundary-less Operation (Inline Boundary Logic)

The single MVP Gateway performs **both** central gateway and boundary gateway functions inline. There are no separate Boundary Gateway containers in MVP. The full request pipeline runs within the unified Gateway:

1. **Policy evaluation** — action permissions, rate limits, tier checks
2. **Content scanning** — prompt injection detection on outbound `dispatch_task` / `report_result`
3. **Output validation** — schema validation, payload size limits
4. **Egress proxy** — external API calls proxied with API key injection
5. **Metadata stripping** — infrastructure fields stripped before delivery to target Kubex

All Kubexes are assigned to a single **`default` boundary**. Boundary-specific policy rules still work — they are just all configured under the `default` boundary. This means the policy engine code paths are exercised from day one, even without multi-boundary deployment.

**Boundary Gateway logic runs as an in-process module** within the Gateway, not a separate container. The module interface is designed for extraction: post-MVP, the boundary module is extracted into per-boundary Gateway Kubexes (Section 16.3) with zero changes to the policy evaluation logic — only the deployment model changes.

#### MVP Boundary-less Action Items

- [ ] Implement boundary logic as an in-process Gateway module (not separate container)
- [ ] Configure `default` boundary for all MVP Kubexes
- [ ] Post-MVP: extract boundary module into per-boundary Gateway Kubexes

#### Docker Networking Topology (FINAL — 3-Network Model)

> **Finalized (2026-03-08):** The 3-network model is the authoritative network topology for KubexClaw. This resolves Critical Gap C1 (Network Topology Mismatch) — the docker-compose skeleton has been updated to use these three networks instead of the previous single `gateway-net`. See docs/gaps.md.

Three Docker networks enforce network-level isolation. Kubexes can only reach infrastructure services through the Gateway — they cannot directly access Redis, Neo4j, OpenSearch, or the internet. This topology is essential for the Gateway LLM Proxy model (Section 13.9.1 in docs/gateway.md): since Kubexes are ONLY on `kubex-internal` and have no internet access, all LLM API calls MUST go through the Gateway's proxy endpoints.

| Network | Purpose | Services |
|---|---|---|
| **`kubex-internal`** | Agent communication. All Kubexes and infrastructure services. No external access. | Gateway, Kubex Broker, Kubex Registry, Kubex Manager, all Kubexes |
| **`kubex-external`** | Internet access. Gateway only (dual-homed). | Gateway only |
| **`kubex-data`** | Data stores. Infrastructure services only — Kubexes cannot reach these directly. | Redis, OpenSearch, Neo4j, Graphiti, Gateway, Kubex Broker, Kubex Registry, Kubex Manager |

**Network bridging rules:**
- **Gateway** bridges `kubex-internal` and `kubex-external` (egress proxy for all Kubex internet traffic)
- **Gateway, Broker, Registry, Kubex Manager** bridge `kubex-internal` and `kubex-data` (infrastructure can reach data stores)
- **Kubexes are ONLY on `kubex-internal`** — they cannot reach Redis, Neo4j, OpenSearch, or the internet directly. All access is mediated by the Gateway or Broker.

```mermaid
graph TD
    subgraph ext["kubex-external (internet access)"]
        INET["Internet<br/>LLM APIs, Instagram, SMTP"]
    end

    subgraph internal["kubex-internal (no external access)"]
        GW["Gateway<br/>(dual-homed)"]
        KM["Kubex Manager"]
        KB["Kubex Broker"]
        KR["Kubex Registry"]
        K1["Orchestrator Kubex"]
        K2["Scraper Kubex"]
        K3["Reviewer Kubex"]
    end

    subgraph data["kubex-data (data stores)"]
        REDIS["Redis :6379"]
        OS["OpenSearch :9200"]
        NEO["Neo4j :7687"]
        GR["Graphiti :8100"]
    end

    GW <--> INET
    GW <--> REDIS
    GW <--> OS
    GW <--> GR
    KB <--> REDIS
    KM <--> REDIS

    K1 -->|"ALL requests via Gateway"| GW
    K2 -->|"action requests only"| GW
    K3 -->|"action requests only"| GW
    K2 & K3 <-->|"dispatch_task\n(worker-direct)"| KB
    GW <-->|"dispatch/result routing\n(Orchestrator's Broker interface)"| KB

    GR --> NEO

    K1 -.-x|"BLOCKED"| REDIS
    K1 -.-x|"BLOCKED"| INET

    style ext fill:#9b2226,stroke:#fff,color:#fff
    style internal fill:#264653,stroke:#fff,color:#fff
    style data fill:#2d6a4f,stroke:#fff,color:#fff
```

- [ ] Create three Docker networks (`kubex-internal`, `kubex-external`, `kubex-data`) in `docker-compose.yml`
- [ ] Attach Gateway to all three networks (dual-homed for egress proxy)
- [ ] Attach infrastructure services (Broker, Registry, Kubex Manager) to `kubex-internal` and `kubex-data`
- [ ] Attach Kubexes ONLY to `kubex-internal` — verify no direct data store or internet access
- [ ] Test network isolation: Kubex container cannot ping Redis, Neo4j, or external hosts

#### Port Assignment Table

All service ports in one place to prevent conflicts. Kubexes do not expose ports — they communicate exclusively through the Gateway.

| Service | Port | Protocol | Notes |
|---------|------|----------|-------|
| **Gateway** | 8080 | HTTP | Unified Gateway — policy engine, egress proxy, scheduler, inbound gate |
| **Kubex Manager** | 8090 | HTTP | Docker lifecycle API |
| **Kubex Registry** | 8070 | HTTP | Capability discovery API |
| **Kubex Broker** | 8060 | HTTP | Redis Streams message routing API |
| **Redis** | 6379 | Redis | Message queue, rate limits, budget, lifecycle events |
| **OpenSearch** | 9200 | HTTP | Logs (`logs-*`) and knowledge corpus (`knowledge-corpus-*`) |
| **OpenSearch Dashboards** | 5601 | HTTP | Log analytics UI |
| **Neo4j Browser** | 7474 | HTTP | Dev-only graph browser UI |
| **Neo4j Bolt** | 7687 | Bolt | Graph database protocol (Graphiti → Neo4j) |
| **Graphiti** | 8100 | HTTP | Temporal knowledge graph REST API |
| **Command Center Backend** | 3000 | HTTP | Operator UI backend (FastAPI) |
| **Prometheus** | 9090 | HTTP | Metrics collection and query |
| **Grafana** | 3001 | HTTP | Metrics dashboards and alerting |
| **cAdvisor** | 8081 | HTTP | Container resource metrics exporter |

> **Conflict resolution:** Graphiti uses 8100 (not 8000, which conflicts with Mission Control's default). Grafana uses 3001 (not 3000, which is Command Center Backend). cAdvisor uses 8081 (not 8080, which is the Gateway).

- [x] Verify all port assignments in `docker-compose.yml` match this table — verified and unified across all docs (C2 closed, 2026-03-08)

### Service Hardening — MVP Checklist

Infrastructure services (Gateway, Broker, Registry, Kubex Manager, Graphiti, Neo4j, OpenSearch, Redis) are trusted components, but defense-in-depth requires hardening them against misconfiguration, container escape, and lateral movement.

#### Network Isolation

Already implemented via the 3-network model (Section 13.8, C1 closure):

| Network | Services | External Access |
|---|---|---|
| `kubex-internal` | Gateway, Broker, Registry, Kubex Manager, all Kubexes | None — internal only |
| `kubex-data` | Gateway, Redis, Neo4j, OpenSearch, Graphiti | None — internal only |
| `kubex-external` | Gateway only | Yes — LLM providers, external APIs |

The Gateway is the **only** service with external network access. All other services are on internal-only Docker networks. Kubexes cannot reach data stores directly — all traffic flows through the Gateway.

#### Container Security

All infrastructure containers run with hardened security settings:

```yaml
# Applied to ALL infrastructure services in docker-compose.yml
services:
  example-service:
    security_opt:
      - no-new-privileges:true
    read_only: true           # Read-only root filesystem
    tmpfs:
      - /tmp:size=100M        # Writable /tmp via tmpfs (not persistent)
    cap_drop:
      - ALL                   # Drop all Linux capabilities
```

**Exception — Gateway:** The Gateway needs `NET_BIND_SERVICE` to bind to privileged ports (if configured on port 80/443 for external access). All other capabilities are dropped.

```yaml
# Gateway-specific override
services:
  gateway:
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE      # Only capability granted
```

**Exception — data stores:** Redis, Neo4j, and OpenSearch need writable data directories (volumes). Their root filesystem is still read-only; data writes go to mounted volumes only.

```yaml
services:
  redis:
    read_only: true
    volumes:
      - redis-data:/data       # Writable volume for persistence
    tmpfs:
      - /tmp:size=50M
```

#### Inter-Service Authentication

All service-to-service communication is authenticated:

| Connection | Auth Method | Configuration |
|---|---|---|
| Gateway -> Redis | Redis ACL (per-service users) | `--aclfile /etc/redis/users.acl` (already implemented, H2) |
| Gateway -> Graphiti | Shared secret header (`X-Internal-Auth`) | Secret mounted from `/run/secrets/graphiti-internal-auth` |
| Gateway -> OpenSearch | HTTP Basic Auth | Credentials from `/run/secrets/opensearch-credentials` |
| Gateway -> Neo4j | Bolt auth (username/password) | `NEO4J_AUTH` env var from secrets |
| Broker -> Redis | Redis ACL (`broker-svc` user) | Scoped to db0 keys only (already implemented, H2) |
| Registry -> Redis | Redis ACL (`registry-svc` user) | Scoped to db2 keys only (already implemented, H2) |
| Kubex Manager -> Redis | Redis ACL (`manager-svc` user) | Scoped to db3 keys only (already implemented, H2) |
| Graphiti -> Neo4j | Bolt auth | `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` env vars |
| Graphiti -> Gateway (LLM proxy) | Internal network trust | Same Docker network, no external exposure |

All credentials are loaded from secret files (`/run/secrets/`), never hardcoded in environment variables or docker-compose.

#### Input Validation

Each service validates incoming payloads at its boundary:

| Service | Validation | Schema Source |
|---|---|---|
| **Gateway** | All `ActionRequest` payloads validated against JSON Schema before forwarding to any backend | `kubex-common/src/schemas/` (canonical action schemas) |
| **Kubex Broker** | Message envelope validated (required fields: `source_agent_id`, `target_agent_id`, `action`, `payload`) | Broker envelope schema |
| **Kubex Registry** | Capability registration payloads validated (required: `agent_id`, `boundary`, `capabilities` array) | Registry schema |
| **Kubex Manager** | REST API request bodies validated via FastAPI/Pydantic models | Manager API schemas (Section 19) |

Malformed payloads are rejected with HTTP 400 and logged at WARN level. No service blindly forwards unvalidated input.

#### Rate Limiting

The Gateway rate-limits all agent-initiated traffic at the policy engine level (per-agent counters in Redis db1). Infrastructure services sit behind the Gateway and inherit this protection — no agent can directly flood an infrastructure service.

For knowledge-specific rate limits, see Section 27.12.1 in [docs/knowledge-base.md](knowledge-base.md).

#### TLS — Internal Traffic

**MVP:** Internal traffic between services uses plaintext HTTP over Docker networks. This is acceptable because:
- All Docker networks are internal-only (no external exposure)
- Traffic never leaves the host machine
- Docker network isolation prevents sniffing from Kubex containers

**Post-MVP:** Enable TLS for internal service-to-service traffic if:
- Services are distributed across multiple hosts
- Compliance requirements mandate encryption in transit for all traffic
- Use mTLS with certificates managed by a lightweight CA (e.g., step-ca or cfssl)

**Gateway to external:** Always HTTPS. The Gateway terminates TLS for inbound traffic and initiates TLS for all outbound connections (LLM providers, external APIs).

#### Logging

All infrastructure services follow the same logging convention:

| Requirement | Implementation |
|---|---|
| Log destination | `stdout` (Docker JSON log driver collects) |
| Log format | Structured JSON (timestamp, level, service, message, context) |
| Security events | Logged at WARN level minimum |
| Security event examples | Auth failures, policy denials, rate limit hits, invalid payloads, secret rotation events |
| Log retention | Docker log driver rotation (max-size: 50MB, max-file: 3 per container) |

Post-MVP, Fluent Bit ships logs to OpenSearch for centralized search and alerting (Section 9).

#### Health Checks

All services expose a health endpoint, monitored by Docker and Kubex Manager:

| Service | Health Endpoint | Check Method | Interval |
|---|---|---|---|
| Gateway | `/health` on port 8080 | HTTP GET | 10s |
| Kubex Manager | `/health` on port 8090 | HTTP GET | 10s |
| Kubex Registry | `/health` on port 8070 | HTTP GET | 10s |
| Kubex Broker | `/health` on port 8060 | HTTP GET | 10s |
| Graphiti | `/health` on port 8100 | HTTP GET | 10s |
| Redis | — | `redis-cli PING` | 10s |
| Neo4j | — | `curl http://localhost:7474` | 10s |
| OpenSearch | — | `curl http://localhost:9200/_cluster/health` | 15s |

Docker `healthcheck` directives in docker-compose handle automatic restart of unhealthy containers (`restart: unless-stopped`). Kubex Manager monitors infrastructure service health and surfaces alerts in the Command Center if any service remains unhealthy for more than 3 consecutive checks.

```mermaid
flowchart TD
    subgraph hardening["Service Hardening Layers"]
        direction TB
        NET["Network Isolation<br/>3-network model, Gateway-only external"]
        CTR["Container Security<br/>read_only, no-new-privileges, cap_drop ALL"]
        AUTH["Inter-Service Auth<br/>Redis ACL, shared secrets, basic auth"]
        VAL["Input Validation<br/>JSON Schema at every service boundary"]
        RL["Rate Limiting<br/>Gateway Policy Engine, per-agent counters"]
        LOG["Logging & Health<br/>Structured JSON, WARN-level security events, /health"]
    end

    NET --> CTR --> AUTH --> VAL --> RL --> LOG

    style NET fill:#264653,stroke:#fff,color:#fff
    style CTR fill:#264653,stroke:#fff,color:#fff
    style AUTH fill:#264653,stroke:#fff,color:#fff
    style VAL fill:#264653,stroke:#fff,color:#fff
    style RL fill:#264653,stroke:#fff,color:#fff
    style LOG fill:#264653,stroke:#fff,color:#fff
```

**Service Hardening Action Items:**
- [ ] Add `read_only: true`, `no-new-privileges: true`, `cap_drop: ALL`, and `tmpfs: /tmp` to all infrastructure containers in docker-compose
- [ ] Add `NET_BIND_SERVICE` capability to Gateway container only
- [ ] Configure Gateway -> Graphiti shared secret header authentication
- [ ] Configure Gateway -> OpenSearch basic auth credentials via secrets
- [ ] Add JSON Schema validation for Broker message envelopes and Registry capability payloads
- [ ] Configure Docker log driver rotation (max-size: 50MB, max-file: 3) for all containers
- [ ] Post-MVP: Evaluate mTLS for internal service traffic

### Action Items
- [ ] Build Kubex Manager MVP (FastAPI + Docker SDK, ~200 lines)
- [ ] Build Gateway MVP (FastAPI, `POST /evaluate`, YAML policy loader, ~50 lines core)
- [ ] Build Kubex Broker MVP (Redis-backed message routing for `dispatch_task` + `report_result`)
- [ ] Build Kubex Registry MVP (in-memory store, REST API for capability queries)
- [ ] Write MVP `docker-compose.yml` for infrastructure services
- [ ] Write Kubex Manager startup config defining the 3 MVP agents
- [ ] Build Instagram Scraper skills (`scrape_profile`, `scrape_posts`)
- [ ] Build Orchestrator skills (`dispatch_task`, `report_result`)
- [ ] Write MVP policy files for all 3 agents
- [ ] Test full loop: human → orchestrator → gateway → broker → scraper → gateway → orchestrator polls result
- [ ] Test kill switch: stop scraper mid-task, verify cleanup
