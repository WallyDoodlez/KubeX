# KubexClaw MVP — Implementation Guide

## 1. MVP Goal

The MVP proves that the KubexClaw agent infrastructure works end-to-end: a human operator submits a task to the Orchestrator via terminal CLI, which dispatches it via the Gateway to a worker Kubex (Instagram Scraper) — the Gateway routes the task to the Broker internally — with every action gated by the unified Gateway's Policy Engine, results reported back through the chain, and the Reviewer Kubex available for ambiguous action evaluation. The MVP validates container lifecycle management (Kubex Manager), policy-enforced egress proxying, inter-agent communication, kill switch reliability, and knowledge base integration — all on a single Docker host with security-first defaults.

**User interaction model:** The Orchestrator runs as a Docker container (managed by docker-compose, not by Kubex Manager) with a CLI LLM and MCP bridge pre-packaged. The operator connects to it via `docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json`. Worker Kubexes (Scraper, Reviewer) are managed dynamically by Kubex Manager. This eliminates all UI development for MVP.

### Related Documentation

- [docs/cli.md](docs/cli.md) — `kubexclaw` CLI design (setup wizard, deploy flow, agent management, skill browsing). For first-run setup instructions, see docs/cli.md (`kubexclaw setup` wizard — handles provider configuration, credential setup, and initial stack launch).
- [docs/skill-catalog.md](docs/skill-catalog.md) — Skill manifest schema, built-in skills, composition rules, custom skill creation
- [docs/api-layer.md](docs/api-layer.md) — Management API bridging CLI and Command Center (endpoint specs, auth, state management)

---

## 2. System Architecture

```mermaid
flowchart TD
    HUMAN([Human Operator]) -->|"docker exec -it orchestrator\nclaude --mcp-server ..."| ORCH

    subgraph compose["Docker Compose — Infrastructure + Orchestrator (always running)"]
        ORCH["Orchestrator\nCLI LLM + MCP Bridge\nDocker label auth\nclaude-haiku-4-5 / claude-sonnet-4-6"]
        GW["Gateway :8080\nPolicy Engine + Egress Proxy\n+ Inbound Gate + Scheduler\n+ Broker API surface"]
        KM["Kubex Manager :8090\nFastAPI + Docker SDK"]
        KB["Kubex Broker :8060\nRedis Streams routing"]
        KR["Kubex Registry :8070\nCapability discovery"]
        REDIS[("Redis :6379\ndb0-db4 partitioned")]
        NEO["Neo4j :7687\nGraph store"]
        GR["Graphiti :8100\nTemporal knowledge graph"]
        OS["OpenSearch :9200\nCorpus + Logs"]
    end

    subgraph managed["Kubex Manager — Agents (dynamic lifecycle)"]
        IS["Instagram Scraper\nclaude-haiku-4-5 / claude-sonnet-4-6"]
        REV["Reviewer\nopenai-o3-mini"]
    end

    KM -->|"creates + manages"| IS & REV
    ORCH -->|"ALL requests\n(Docker label auth) HTTP :8080\n(internal network)"| GW
    IS & REV -->|"ActionRequest\n(Docker label auth)"| GW
    GW -->|"egress proxy"| INTERNET([External APIs])
    GW -->|"writes/reads Broker internally"| KB
    KB --> REDIS
    GW -->|"rate limits + budget"| REDIS
    KR -->|"capability cache"| REDIS
    IS -.->|"query capabilities"| KR
    GW -->|"proxy"| GR
    GR --> NEO
    GW -->|"proxy"| OS

    style compose fill:#264653,stroke:#fff,color:#fff
    style managed fill:#1a1a2e,stroke:#e94560,color:#fff
```

---

## 3. Infrastructure Services

### 3.1 Gateway

- **Purpose:** Single entry point for all Kubex traffic. Evaluates every `ActionRequest` against policy rules, proxies all external API calls (Kubexes have zero direct internet access), acts as a **transparent LLM reverse proxy** (Kubexes send LLM calls to Gateway proxy endpoints; Gateway injects API keys and forwards to providers), and handles inbound routing.
- **Port:** 8080
- **Key config:** Loads `policies/global.yaml` + per-agent policy files. Reads LLM API keys from `secrets/llm-api-keys.json` (mounted read-only). Runs boundary logic inline (single `default` boundary for MVP). Bridges all three networks (`kubex-internal`, `kubex-external`, `kubex-data`).
- **API surface (MVP):**
  - `POST /actions` — evaluate and route an ActionRequest (all agents)
  - `GET /tasks/{task_id}/result` — poll for task result (Orchestrator)
  - `GET /tasks/{task_id}/stream` — SSE stream of task progress events (Orchestrator); emits `dispatched`, `accepted`, `progress`, `complete`, `failed`, `needs_clarification`, `cancelled` events. Backed by Redis pub/sub channel `progress:{task_id}`
  - `POST /tasks/{task_id}/progress` — receive progress chunks from worker harness; publishes to Redis pub/sub channel `progress:{task_id}` for SSE fan-out. Payload: `{ action, task_id, chunk_type, content, sequence, timestamp }`
  - `POST /tasks/{task_id}/cancel` — cancel a running task; resolves task_id to agent_id, publishes cancel command to Redis channel `control:{agent_id}`. Accepts optional `reason` field. Only the originating agent can cancel.
  - `POST /v1/proxy/anthropic/*` — LLM reverse proxy: forwards to `api.anthropic.com`, injects `x-api-key`, counts tokens, enforces budget/model allowlist
  - `POST /v1/proxy/openai/*` — LLM reverse proxy: forwards to `api.openai.com`, injects `Authorization: Bearer`, counts tokens, enforces budget/model allowlist
  - `POST /v1/proxy/google/*` — LLM reverse proxy: forwards to `generativelanguage.googleapis.com`, injects API key, counts tokens
  - `GET /health` — health check
- **Dependencies:** Redis (db1 for rate limits, db4 for budget tracking), Kubex Registry (for `accepts_from` checks), Docker API (for container identity resolution via source IP lookup)
- **Resource limit:** 512MB RAM, 0.5 CPU

> See BRAINSTORM.md Section 13.9 for full unified Gateway architecture.

### 3.2 Kubex Broker

- **Purpose:** Routes `dispatch_task` and `report_result` messages between Kubexes using Redis Streams. Manages consumer groups, dead letter handling, and audit forwarding.
- **Port:** 8060
- **Key config:** Single stream `boundary:default` for MVP. `MAXLEN ~10000` per stream. Dead letter retry after 60s, max 3 retries.
- **Dependencies:** Redis (db0 for message streams, AOF persistence)
- **Resource limit:** 256MB RAM, 0.25 CPU

> See BRAINSTORM.md Section 18 for full Broker design.

### 3.3 Kubex Registry

- **Purpose:** Agent discovery service. Kubexes query it to find which agent can handle a capability. Kubex Manager registers agents on startup.
- **Port:** 8070
- **Key config:** In-memory store backed by Redis (db2, ephemeral). Exposes `agent_id`, `capabilities`, `status`, `accepts_from`, `boundary`.
- **Dependencies:** Redis (db2 for capability cache)
- **Resource limit:** 128MB RAM, 0.25 CPU

> See BRAINSTORM.md Section 6 for Registry schema.

### 3.4 Redis

- **Purpose:** Backing store for Broker message streams, Gateway rate limits, Registry cache, lifecycle events, and budget tracking. Single instance with database number partitioning.
- **Port:** 6379
- **Key config:** See Section 9 (Redis Database Assignments) below for db0-db4 partitioning. AOF enabled for db0 and db3.
- **Dependencies:** None
- **Resource limit:** 512MB RAM, 0.5 CPU

### 3.5 Kubex Manager

- **Purpose:** Docker lifecycle service. Creates, starts, stops, and kills Kubex containers. Sets Docker labels for identity resolution. Registers agents in Registry. Handles kill switch (stop container + rotate secrets). Reads agent manifests to determine required providers and sets `*_BASE_URL` env vars pointing to Gateway proxy endpoints.
- **Port:** 8090
- **Key config:** Requires Docker socket mount (`/var/run/docker.sock`). Bearer token auth (internal network only). Sets `kubex.agent_id` and `kubex.boundary` labels on every container. Does NOT read `secrets/llm-api-keys.json` — those are Gateway-only. Mounts CLI auth token files from `secrets/cli-credentials/<provider>/` for OAuth CLI LLMs.
- **Credential setup:** On container creation, reads the agent manifest's `providers` list. Sets `*_BASE_URL` env vars pointing to Gateway proxy endpoints (e.g., `ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic`). For OAuth CLI LLMs (Claude Code): bind-mounts CLI auth token files from `secrets/cli-credentials/<provider>/` read-only into the container. **No LLM API keys are injected into workers.**
- **Dependencies:** Docker Engine, Redis (db3 for lifecycle events), Kubex Registry
- **Resource limit:** 256MB RAM, 0.25 CPU

> See BRAINSTORM.md Section 19 for full REST API (61 endpoints). MVP priority: lifecycle + policy + egress endpoints.

### 3.6 Neo4j

- **Purpose:** Graph database backend for Graphiti temporal knowledge graph.
- **Port:** 7687 (Bolt), 7474 (Browser UI, dev only)
- **Key config:** Community edition. APOC plugin enabled. Auth: `neo4j/${NEO4J_PASSWORD}`.
- **Dependencies:** None
- **Resource limit:** 1.5GB RAM, 0.5 CPU

### 3.7 Graphiti

- **Purpose:** Temporal knowledge graph server. Handles entity extraction, bi-temporal edge management, contradiction resolution, and point-in-time queries.
- **Port:** 8100
- **Key config:** `OPENAI_BASE_URL=http://gateway:8080/v1` (LLM calls proxied through Gateway). Neo4j backend. Single `shared` group for MVP.
- **Dependencies:** Neo4j (healthy), Gateway (started, for LLM proxy)
- **Resource limit:** 512MB RAM, 0.25 CPU

> See BRAINSTORM.md Section 27 for full knowledge base architecture.

### 3.8 OpenSearch

- **Purpose:** Dual-purpose: operational logging (`logs-*` indices) and knowledge document corpus (`knowledge-corpus-*` indices). Full-text + vector search on stored documents.
- **Port:** 9200
- **Key config:** Single-node. Separate index patterns for logs vs knowledge corpus. `knowledge-corpus-shared-*` for MVP (single group).
- **Dependencies:** None
- **Resource limit:** 3GB RAM, 1.0 CPU (1.5GB JVM heap + OS/index overhead)

---

## 4. Agent Roster

### 4.1 Orchestrator

- **Role:** AI supervisor that receives tasks from human operators and dispatches them to worker Kubexes. Supports task cancellation — when the user says "cancel that", the Orchestrator cancels the running task via the Gateway. Never performs work directly — only delegates.
- **Deployment (MVP):** Runs as a **Docker container** managed by docker-compose (not by Kubex Manager — it is long-running, not task-based). The container has a CLI LLM and MCP bridge pre-packaged. The operator connects via `docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json`.
- **User interaction:** The operator runs `docker exec` to attach to the container's terminal session. The CLI LLM (e.g., `claude`) runs inside the container and communicates with the KubexClaw infrastructure via the MCP bridge. The MCP bridge exposes KubexClaw infrastructure actions as MCP tools.
- **Clarification flow:** If a worker returns `needs_clarification` status on a `report_result`, the Orchestrator either resolves it autonomously (if it has enough context) or surfaces the question to the operator in the terminal and waits for a response before re-dispatching.
- **System prompt summary:** "You are the KubexClaw orchestrator. You receive tasks from human operators and dispatch them to the appropriate worker Kubexes. You monitor task progress, handle failures, cancel tasks when requested, and report results back to the operator. You NEVER perform tasks directly — you always delegate."
- **Skills:** `dispatch_task`, `check_task_status`, `cancel_task`, `report_result`, `request_user_input` (explicit); `model_selector`, `knowledge` (implicit/built-in)
- **Allowed actions:** `dispatch_task`, `check_task_status`, `cancel_task`, `report_result`, `request_user_input`, `query_registry`, `query_knowledge`, `store_knowledge`, `search_corpus`
- **Task progress (MVP — Option A, MCP tool polling):** After dispatching a task, the Orchestrator calls `subscribe_task_progress(task_id)` — the MCP bridge opens `GET /tasks/{task_id}/stream` (SSE) on the Gateway in the background. The Orchestrator LLM periodically calls `get_task_progress(task_id)` to poll buffered progress chunks and relays them conversationally to the operator. Worker Kubexes stream progress via their harness entrypoint (`kubex-harness`), which captures CLI LLM stdout/stderr and POSTs chunks to `POST /tasks/{task_id}/progress` on the Gateway. The SSE stream closes when a `complete`, `failed`, or `needs_clarification` event is received.
- **Blocked actions:** `http_get`, `http_post`, `execute_code`, `send_email`
- **Connections:** ONE connection only — HTTP to Gateway `http://gateway:8080` (internal Docker network). No direct Redis or Broker access. `dispatch_task` is an `ActionRequest POST` to the Gateway; the Gateway writes to the Broker internally. Result polling (`check_task_status`) is also a Gateway API call. The Gateway is the sole API surface for all Orchestrator operations.
- **Gateway authentication:** Docker label auth — same as all Kubexes. The container has labels `kubex.agent_id=orchestrator` and `kubex.boundary=default`. The Gateway resolves identity from source IP via Docker API. No API token needed.
- **Model assignment:** Anthropic — `claude-haiku-4-5` (light/default), `claude-sonnet-4-6` (standard, escalation). LLM calls are proxied through the Gateway (Gateway injects API key).
- **Boundary:** `default`
- **Resource limit:** 2GB RAM, 1.0 CPU

> See BRAINSTORM.md Section 13.1 for Orchestrator config. See Section 12 (MCP Bridge) in this document for the bridge architecture.

### 4.2 Instagram Scraper

- **Role:** Read-only data collection agent. Scrapes public Instagram profiles and posts, returning structured JSON output. Never interacts with accounts (no following, liking, commenting).
- **Entrypoint:** `kubex-harness` — spawns CLI LLM in a PTY, captures stdout/stderr, streams progress chunks to Gateway via `POST /tasks/{task_id}/progress`. Configured with `KUBEX_PROGRESS_BUFFER_MS=500` and `KUBEX_PROGRESS_MAX_CHUNK_KB=16`.
- **System prompt summary:** "You are an Instagram data collection agent. Your job is to scrape public Instagram profiles and posts based on task instructions. You extract structured data (captions, hashtags, engagement metrics, post timestamps, media URLs) and return clean JSON output. You NEVER interact with accounts."
- **Skills:** `scrape_profile`, `scrape_posts`, `scrape_hashtag`, `extract_metrics` (explicit); `model_selector`, `knowledge` (implicit/built-in)
- **Allowed actions:** `http_get`, `write_output`, `report_result`, `progress_update`, `query_knowledge`, `store_knowledge`, `search_corpus`
- **Blocked actions:** `http_post`, `http_put`, `http_delete`, `send_email`, `execute_code`, `dispatch_task`
- **Allowed egress:** `instagram.com`, `i.instagram.com`, `graph.instagram.com` (GET only)
- **Model assignment:** Anthropic — `claude-haiku-4-5` (light/default), `claude-sonnet-4-6` (standard, escalation)
- **Boundary:** `default`
- **Budget:** 10,000 tokens per task, $1.00/day
- **Resource limit:** 2GB RAM, 1.0 CPU

> See BRAINSTORM.md Sections 13.1, 13.3 for Scraper config and policy.

### 4.3 Reviewer

- **Role:** Evaluates ambiguous actions that the Policy Engine cannot deterministically approve or deny. Uses a different LLM provider than workers (anti-collusion). Has no tools — receives structured action payloads only.
- **System prompt summary:** "You are a security reviewer for KubexClaw. You evaluate action requests that the policy engine could not deterministically decide. You receive structured action payloads and return ALLOW, DENY, or ESCALATE. You never execute actions yourself."
- **Skills:** None (no tools — review only); `model_selector` (implicit/built-in)
- **Allowed actions:** `report_result` (to return review decisions)
- **Blocked actions:** All external actions (`http_get`, `http_post`, `send_email`, `execute_code`, `dispatch_task`)
- **Model assignment:** OpenAI — `o3-mini` (single tier, zero overlap with worker models)
- **Boundary:** `default`
- **Resource limit:** 2GB RAM, 1.0 CPU

> See BRAINSTORM.md Section 13.6 for model strategy, Section 2 for anti-collusion measures.

---

## 5. Data Flow

The canonical request pipeline uses four data shapes that progressively enrich on the way out and strip down on the way in. For MVP (single boundary, inline boundary logic), the flow is simplified.

### 5.1 MVP Request Pipeline

```
ActionRequest (Orchestrator → Gateway) → GatekeeperEnvelope (Gateway evaluates) → BrokeredRequest (Gateway writes to Broker) → TaskDelivery (target Kubex receives from Broker)
```

> Note: The Orchestrator never touches the Broker directly. The Gateway receives the `dispatch_task` ActionRequest, evaluates policy, then writes to the Broker on the Orchestrator's behalf. Results flow: Worker → Gateway (via Broker internally) → Orchestrator polls Gateway API.

### 5.2 Sequence Diagram — End-to-End MVP Flow

```mermaid
sequenceDiagram
    actor Human
    participant ORCH as Orchestrator (container)
    participant MCP as MCP Bridge (in container)
    participant GW as Gateway
    participant KM as Kubex Manager
    participant KR as Kubex Registry
    participant KB as Kubex Broker
    participant IS as Instagram Scraper

    Human->>ORCH: docker exec -it orchestrator claude --mcp-server ...
    ORCH->>MCP: Initialize (load MCP tools, connect to gateway:8080)
    KM->>KM: Start Scraper, Reviewer containers
    KM->>KR: Register agents (capabilities, status, accepts_from)

    Human->>MCP: "Scrape Nike's Instagram, last 30 days"
    MCP->>ORCH: dispatch_task tool call

    ORCH->>GW: POST /actions — ActionRequest { action: dispatch_task, capability: scrape_instagram }\n(internal Docker network — Docker label auth)
    GW->>GW: Resolve identity (Docker label lookup via source IP → orchestrator/default)
    GW->>GW: Wrap in GatekeeperEnvelope, evaluate policy
    GW->>KR: Resolve capability → instagram-scraper
    GW->>KB: Write TaskDelivery { task_id, capability, context_message, from_agent: orchestrator }
    GW-->>ORCH: ALLOW { task_id }
    ORCH->>GW: GET /tasks/{task_id}/stream (SSE — subscribe to progress)

    KB->>IS: TaskDelivery { task_id, capability, context_message, from_agent: orchestrator }

    IS->>GW: ActionRequest { action: progress_update, task_id, message: "Searching for Nike posts..." }
    GW-->>ORCH: SSE event: {type: "progress", message: "Searching for Nike posts..."}
    ORCH-->>MCP: [instagram-scraper] Searching for Nike posts...
    MCP-->>Human: [instagram-scraper] Searching for Nike posts...

    IS->>GW: ActionRequest { action: http_get, target: graph.instagram.com/nike }
    GW->>GW: Resolve identity (Docker label lookup via source IP)
    GW->>GW: Check egress allowlist: instagram.com OK
    GW->>GW: Check action allowlist: http_get OK
    GW->>GW: Check budget: OK
    GW-->>IS: ALLOW (proxied response from Instagram)

    IS->>GW: ActionRequest { action: store_knowledge, content: "Nike findings..." }
    GW->>GW: Proxy to OpenSearch (corpus) then Graphiti (graph)
    GW-->>IS: ALLOW

    IS->>GW: ActionRequest { action: progress_update, task_id, message: "Compiling results...", progress_pct: 100 }
    GW-->>ORCH: SSE event: {type: "progress", message: "Compiling results...", progress_pct: 100}
    ORCH-->>MCP: [instagram-scraper] Compiling results...
    MCP-->>Human: [instagram-scraper] Compiling results...

    IS->>GW: ActionRequest { action: report_result, task_id, status: success, result: { posts: [...] } }
    GW->>KB: Store result against task_id
    GW-->>IS: ALLOW
    GW-->>ORCH: SSE event: {type: "complete", result: { posts: [...] }} (SSE stream closes)

    ORCH->>MCP: Result summary
    MCP->>Human: "Scrape complete. 47 posts found."

    Note over IS,ORCH: Clarification flow (alternate)
    IS->>GW: ActionRequest { action: report_result, task_id, status: needs_clarification,\nquestion: "Profile is private — try public posts only?" }
    GW->>KB: Store clarification result against task_id
    GW-->>IS: ALLOW

    ORCH->>GW: GET /tasks/{task_id}/result
    GW-->>ORCH: { status: needs_clarification, question: "Profile is private..." }
    ORCH->>ORCH: Can Orchestrator resolve autonomously?
    alt Orchestrator can resolve
        ORCH->>GW: POST /actions — ActionRequest { action: dispatch_task, ..., context_message: "Use public posts only" }
        GW->>KB: Write new TaskDelivery
        GW-->>ORCH: ALLOW { task_id }
    else Needs human input
        ORCH->>MCP: request_user_input { question: "Profile is private..." }
        MCP->>Human: "Profile is private — try public posts only? [y/n]"
        Human->>MCP: "yes"
        MCP->>ORCH: User answered: yes
        ORCH->>GW: POST /actions — ActionRequest { action: dispatch_task, ..., context_message: "Use public posts only" }
        GW->>KB: Write new TaskDelivery
        GW-->>ORCH: ALLOW { task_id }
    end
```

### 5.3 Response / Return Path

The request path (5.1) covers how tasks get dispatched. The return path describes how results flow back to the Orchestrator and ultimately to the human operator.

**Return path flow:**

```
Worker completes action
  → Worker harness sends final progress_update (final: true, exit_reason: "completed")
  → Worker sends ActionResponse to Gateway via POST /actions (action: report_result)
  → Gateway logs response, updates budget counters
  → Gateway publishes result to Redis (task:{task_id}:result)
  → Orchestrator receives result via SSE stream or get_task_progress
  → Orchestrator relays result to user
```

```mermaid
sequenceDiagram
    participant IS as Worker Kubex
    participant GW as Gateway
    participant REDIS as Redis
    participant ORCH as Orchestrator
    participant MCP as MCP Bridge
    actor Human

    IS->>GW: POST /actions — ActionRequest<br/>{action: progress_update, task_id, final: true}
    GW->>REDIS: PUBLISH progress:{task_id} {type: "progress", final: true}
    GW-->>IS: ALLOW

    IS->>GW: POST /actions — ActionRequest<br/>{action: report_result, task_id, status: success, result: {...}}
    GW->>GW: Log response, update budget counters
    GW->>REDIS: SET task:{task_id}:result {status, result}
    GW->>REDIS: PUBLISH progress:{task_id} {type: "complete", result: {...}}
    GW-->>IS: ALLOW

    ORCH-->>GW: (SSE stream already open from dispatch)
    GW-->>ORCH: SSE event: {type: "complete", result: {...}}
    Note over GW,ORCH: SSE stream closes after "complete" event

    ORCH->>MCP: Result summary
    MCP->>Human: "Task complete. [result summary]"

    Note over ORCH,GW: Alternative: polling path (if SSE disconnected)
    ORCH->>GW: GET /tasks/{task_id}/result
    GW->>REDIS: GET task:{task_id}:result
    REDIS-->>GW: {status: success, result: {...}}
    GW-->>ORCH: ActionResponse {status: success, result: {...}}
```

**Error return path:** If a worker fails (crash, timeout, unrecoverable error), the Gateway detects the failure (via Kubex Manager heartbeat or task timeout) and publishes a `failed` event to the SSE stream. The Orchestrator receives the failure and can retry, escalate, or report to the human.

### 5.4 ActionRequest Schema (Kubex emits)

```json
{
  "request_id": "ar-20260301-a1b2c3d4",
  "agent_id": "instagram-scraper",
  "action": "http_get",
  "target": "https://graph.instagram.com/v18.0/nike/media",
  "parameters": { "fields": "caption,timestamp,like_count", "limit": 50 },
  "context": {
    "workflow_id": "wf-20260301-001",
    "task_id": "task-0042",
    "originating_request_id": "req-7712",
    "chain_depth": 2
  },
  "priority": "normal",
  "timestamp": "2026-03-01T12:03:45Z"
}
```

> See BRAINSTORM.md Section 16.2 for full schema definition and per-action parameter schemas.

### 5.5 GatekeeperEnvelope (Gateway wraps)

```json
{
  "envelope_id": "ge-20260301-m3n4o5p6",
  "request": { "...original ActionRequest..." },
  "enrichment": {
    "boundary": "default",
    "model_used": "claude-haiku-4-5",
    "model_tier": "light",
    "token_count_so_far": 3200,
    "cost_so_far_usd": 0.0026,
    "agent_status": "available",
    "agent_denial_rate_1h": 0.02
  },
  "evaluation": {
    "decision": "ALLOW",
    "tier": "low",
    "evaluated_by": "policy_engine",
    "rule_matched": "egress_allowlist:instagram.com",
    "latency_ms": 4,
    "timestamp": "2026-03-01T12:03:45.004Z"
  }
}
```

### 5.6 TaskDelivery (Target Kubex receives)

```json
{
  "task_id": "task-7891",
  "workflow_id": "wf-42",
  "capability": "scrape_instagram",
  "context_message": "Scrape Nike's Instagram profile. Focus on posts from the last 30 days.",
  "from_agent": "orchestrator",
  "priority": "normal"
}
```

### 5.7 report_result Schema (Worker emits via Gateway)

Workers emit `report_result` as an `ActionRequest` sent to the Gateway. The Gateway stores the result in the Broker (Redis Streams) and returns `ALLOW`. The Orchestrator retrieves the result by polling the Gateway's task result endpoint (`GET /tasks/{task_id}/result`). Workers never write directly to the Broker.

```json
{
  "task_id": "task-7891",
  "workflow_id": "wf-42",
  "from_agent": "instagram-scraper",
  "status": "success",
  "result": { "posts": [ "..." ] },
  "question": null,
  "error": null
}
```

**`status` values:**

| Status | Meaning | Orchestrator behavior |
|--------|---------|----------------------|
| `success` | Task completed normally | Forward result to operator |
| `failure` | Task failed with error | Log error, optionally retry or escalate |
| `needs_clarification` | Worker hit an ambiguous case and cannot proceed without guidance | Resolve autonomously or invoke `request_user_input` to ask the operator |

When `status` is `needs_clarification`, the `question` field contains a human-readable string describing what clarification is needed. The `result` field may contain partial results collected before the clarification point.

### 5.8 request_user_input Action

`request_user_input` is an Orchestrator-only action that blocks until the human operator provides a response. It is surfaced by the MCP Bridge as a terminal prompt.

```json
{
  "request_id": "ar-20260301-b9c1d2e3",
  "agent_id": "orchestrator",
  "action": "request_user_input",
  "target": null,
  "parameters": {
    "question": "The target Instagram profile is private. Should I scrape public posts only, or abort?",
    "context": { "task_id": "task-7891", "workflow_id": "wf-42" },
    "timeout_seconds": 300
  },
  "context": {
    "workflow_id": "wf-42",
    "task_id": "task-7891",
    "originating_request_id": "req-9901",
    "chain_depth": 1
  },
  "priority": "normal",
  "timestamp": "2026-03-01T12:05:00Z"
}
```

The Gateway evaluates this action against the Orchestrator's policy (`request_user_input` in allowed actions). The MCP Bridge receives the ALLOW response, blocks on `stdin`, and returns the operator's answer as the action result. Worker Kubexes are **not** permitted to call `request_user_input` — they must use `needs_clarification` on `report_result` instead.

> See BRAINSTORM.md Section 16.3 for the four data shapes (ActionRequest, RoutedRequest, BrokeredRequest, TaskDelivery).

---

## 6. Security Model (MVP)

### 6.1 Agent Identity Resolution

All Kubexes — including the Orchestrator — use Docker label auth. There is one authentication path for MVP.

**Docker label auth (all Kubexes)**

Every Kubex container has `kubex.agent_id` and `kubex.boundary` labels set at container creation time (by docker-compose for the Orchestrator; by Kubex Manager for worker agents). The Gateway resolves identity by looking up the source IP on the internal Docker network via the Docker API — the Kubex-supplied `agent_id` in the ActionRequest is **overwritten** with the resolved container identity. A compromised Kubex cannot forge its identity.

The Orchestrator container labels are:
```yaml
labels:
  kubex.agent_id: "orchestrator"
  kubex.boundary: "default"
```

**Post-MVP: API token auth for remote Orchestrators**

For scenarios where the Orchestrator runs outside the Docker network (e.g., a user's laptop connecting to a remote stack), a pre-shared API token path can be added post-MVP. The Gateway would validate the token against a static `host_agents` config mapping. This is not needed for the MVP containerized model.

> See BRAINSTORM.md Section 16.2 (authentication), Section 16.3 Key Principle #7.

### 6.2 Gateway Policy Evaluation (First-Deny-Wins)

The Policy Engine evaluates every ActionRequest against three levels: **global → boundary → kubex**. First deny wins. All three must allow for the action to proceed. For MVP, boundary = `default` (single flat namespace).

```mermaid
flowchart TD
    REQ["Incoming ActionRequest"] --> G1{"Global policy\nblocked?"}
    G1 -->|yes| DENY1["DENY"]
    G1 -->|no| K1{"Kubex policy\nblocked?"}
    K1 -->|yes| DENY2["DENY"]
    K1 -->|no| E1{"Egress allowed?"}
    E1 -->|no| DENY3["DENY"]
    E1 -->|yes| R1{"Rate limit OK?"}
    R1 -->|no| DENY4["DENY"]
    R1 -->|yes| BUD{"Budget OK?"}
    BUD -->|no| DENY5["DENY"]
    BUD -->|yes| ALLOW["ALLOW"]

    DENY1 & DENY2 & DENY3 & DENY4 & DENY5 --> LOG[(Audit Log)]
    ALLOW --> LOG
```

MVP rule categories (1-3 of 6):

| # | Category | What It Checks |
|---|----------|---------------|
| 1 | Egress / Network | Allowed domains, HTTP methods, blocked URL patterns |
| 2 | Action Type | Allowed/blocked actions, rate limits per action |
| 3 | Budget / Model | Model allowlist, per-task token limit, daily cost cap |

> See BRAINSTORM.md Section 13.3 for all 6 rule categories and evaluation flow.

### 6.3 Zero Direct Internet Access (3-Network Model)

Kubex containers are ONLY on the `kubex-internal` network. They cannot reach the internet, Redis, Neo4j, or OpenSearch directly. All external API calls (Instagram, LLM providers) are proxied through the Gateway's Egress Proxy and LLM Reverse Proxy. The Gateway bridges all three networks (`kubex-internal`, `kubex-external`, `kubex-data`) and can inspect request content, enforce per-Kubex domain allowlists, inject API keys, and log every external call. This resolves Critical Gap C1 (Network Topology Mismatch).

> See BRAINSTORM.md Section 13.9 for why this is more secure than iptables. See docs/infrastructure.md for the full 3-network topology.

### 6.4 LLM API Keys & OAuth Credentials — Gateway LLM Proxy Model

> **Decision (2026-03-08):** All LLM API calls are proxied through the Gateway. This resolves Critical Gap C3 (Credential Model Contradiction). Workers never hold LLM API keys. CLI LLMs are configured with `*_BASE_URL` env vars pointing to Gateway proxy endpoints.

**API key providers (Anthropic, OpenAI, OpenRouter):** Kubexes never hold LLM API keys. The Gateway reads API keys from `secrets/llm-api-keys.json` (mounted into Gateway only) and injects the appropriate key when proxying LLM calls, matched against the Kubex's model allowlist. A compromised Kubex cannot exfiltrate API keys because it never has them.

- Workers: `ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic` (Gateway injects `x-api-key` for `api.anthropic.com`)
- Reviewer: `OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai` (Gateway injects `Authorization: Bearer` for `api.openai.com`)
- Graphiti: `OPENAI_BASE_URL=http://gateway:8080/v1` (Gateway proxies LLM calls for entity extraction)

**CLI LLM auth tokens (separate from API keys):** Some CLI LLMs need their own auth tokens for CLI identity (e.g., Claude Code's OAuth token authenticates the CLI itself, separate from the LLM API key). These are mounted from `secrets/cli-credentials/<provider>/` (read-only) into the worker container. The Gateway manages LLM-level OAuth token refresh centrally to avoid race conditions. See docs/user-interaction.md Section 30.9 for the full credential management design.

**Credentials are configured once** via `./kubexclaw setup` before the stack starts. Agent manifests declare which providers each Kubex needs (`providers` field). Kubex Manager reads the manifest and sets `*_BASE_URL` env vars pointing to Gateway proxy endpoints — no API keys are injected into worker containers.

### 6.5 Bind-Mounted Secrets

Secrets (per-Kubex credentials like SMTP, Git tokens) are written to host paths by Kubex Manager and bind-mounted read-only into containers at `/run/secrets/<secret_name>`. Never passed as environment variables. Kill switch = `docker stop` detaches bind-mounts immediately.

The `/run/secrets/` path convention is identical to Docker Swarm and Kubernetes secrets, ensuring seamless migration to either post-MVP.

> See BRAINSTORM.md Section 8 for full secrets strategy and graduation criteria.

### 6.6 Anti-Collusion (Separate Models)

Workers use Anthropic Claude models. Reviewer uses OpenAI o3-mini. Zero model overlap guaranteed by design — different providers, different model families. Workers receive only approve/deny decisions, never the reviewer's reasoning.

> See BRAINSTORM.md Section 13.6 for model strategy.

---

## 7. Policy Configuration

### 7.1 Global Policy (all Kubexes)

```yaml
# policies/global.yaml
global:
  blocked_actions:
    - "activate_kubex"    # Deferred to post-MVP
  max_chain_depth: 5
  openclaw:
    version: "latest"     # Pin to >= v2026.2.26 per security audit
```

### 7.2 Orchestrator Policy

```yaml
# agents/orchestrator/policies/policy.yaml
agent_policy:
  actions:
    allowed: ["dispatch_task", "check_task_status", "cancel_task", "report_result", "request_user_input",
              "query_registry", "query_knowledge", "store_knowledge", "search_corpus"]
    blocked: ["http_get", "http_post", "http_put", "http_delete",
              "execute_code", "send_email"]
  egress:
    mode: "deny_all"    # Orchestrator has no external egress
  budget:
    per_task_token_limit: 50000
    daily_cost_limit_usd: 5.00
```

### 7.3 Instagram Scraper Policy

```yaml
# agents/instagram-scraper/policies/policy.yaml
agent_policy:
  egress:
    mode: "allowlist"
    allowed:
      - domain: "graph.instagram.com"
        methods: ["GET"]
      - domain: "i.instagram.com"
        methods: ["GET"]
      - domain: "instagram.com"
        methods: ["GET"]
        blocked_paths:
          - "*/accounts/*"
          - "*/api/v1/friendships/*"
  actions:
    allowed: ["http_get", "write_output", "report_result", "progress_update",
              "query_knowledge", "store_knowledge", "search_corpus"]
    blocked: ["http_post", "http_put", "http_delete",
              "execute_code", "send_email", "dispatch_task"]
    rate_limits:
      http_get: 100/task
      write_output: 50/task
  budget:
    per_task_token_limit: 10000
    daily_cost_limit_usd: 1.00
```

### 7.4 Reviewer Policy

```yaml
# agents/reviewer/policies/policy.yaml
agent_policy:
  actions:
    allowed: ["report_result"]
    blocked: ["http_get", "http_post", "http_put", "http_delete",
              "execute_code", "send_email", "dispatch_task",
              "write_output", "read_input"]
  egress:
    mode: "deny_all"     # Reviewer has no external egress
  models:
    allowed:
      - id: "o3-mini"
        provider: "openai"
    # Zero overlap with worker models enforced
  budget:
    per_task_token_limit: 20000
    daily_cost_limit_usd: 2.00
```

> See BRAINSTORM.md Section 13.3 for full rule category definitions.

### 7.5 Default Boundary (MVP)

> **Closes gap:** M8 (Section 29) — Default boundary YAML not defined

MVP uses a single `default` boundary containing all agents. This boundary is permissive — all agents share the same trust zone, knowledge graph, and can communicate freely.

```yaml
# boundaries/default.yaml
boundary:
  id: "default"
  display_name: "Default Boundary"
  description: "Single trust zone for all MVP agents"

agents:
  - orchestrator
  - instagram-scraper
  - reviewer

policy:
  # Inherits from agent-level policies
  # Boundary-level overrides (none for MVP):
  max_agents: 10
  shared_knowledge: true    # All agents in this boundary share knowledge graph
  cross_agent_comms: true   # Agents can dispatch tasks to each other

# Post-MVP: Per-boundary secrets, cross-boundary rules, nested boundaries
```

The Gateway loads this file at startup and runs boundary logic inline (no separate Boundary Gateway container for MVP). All `dispatch_task` actions between MVP agents are intra-boundary (Tier: Low, auto-approved by policy engine). Cross-boundary communication is a post-MVP feature requiring separate Boundary Gateway containers (see BRAINSTORM.md Section 16.3).

---

## 8. Knowledge Base (MVP)

### 8.1 Architecture

Hybrid approach: **Graphiti** (temporal knowledge graph on Neo4j) + **OpenSearch** (document corpus). Entities in Graphiti reference documents in OpenSearch via `source_id`.

### 8.2 MVP Scope

- Single `shared` group (all MVP agents use one knowledge partition)
- `query_knowledge` action: search Graphiti graph via Gateway proxy
- `store_knowledge` action: two-step ingestion (OpenSearch corpus + Graphiti episode)
- `search_corpus` action: full-text search on OpenSearch `knowledge-corpus-shared-*` indices
- Built-in `knowledge` skill (`recall` + `memorize` tools) — implicit, always loaded
- Manual ingestion only (agents explicitly call `memorize`)

### 8.3 Knowledge Ingestion Flow

1. Agent calls `memorize("Nike carousel posts outperform reels by 23%", summary="...")`
2. Knowledge skill emits `ActionRequest { action: store_knowledge, ... }`
3. Gateway evaluates policy, then executes two-step:
   - Step 1: Index document in OpenSearch `knowledge-corpus-shared-*` → get `document_id`
   - Step 2: Call Graphiti `POST /episodes` with content + `document_id` as metadata
4. Graphiti extracts entities/relations, runs contradiction resolution, creates temporal edges

### 8.4 Ontology

Fixed entity types (10): `Person`, `Organization`, `Product`, `Platform`, `Concept`, `Event`, `Location`, `Document`, `Metric`, `Workflow`

Fixed relationship types (12): `OWNS`, `WORKS_FOR`, `USES`, `PRODUCES`, `REFERENCES`, `RELATES_TO`, `PART_OF`, `OCCURRED_AT`, `MEASURED_BY`, `PRECEDED_BY`, `COMPETES_WITH`, `DEPENDS_ON`

> See BRAINSTORM.md Section 27 for full knowledge base design including ontology Pydantic models, LLM routing, security considerations, and built-in skill implementation.

---

## 9. Redis Database Assignments

Single Redis instance, partitioned by database number.

| DB  | Purpose                       | Persistence | Notes                                            |
|-----|-------------------------------|-------------|--------------------------------------------------|
| db0 | Broker message streams        | AOF         | Critical — message loss = dropped tasks          |
| db1 | Gateway rate limit counters   | None        | Ephemeral — rebuilds on restart                  |
| db2 | Registry capability cache     | None        | Ephemeral — rebuilds from Registry               |
| db3 | Kubex Manager lifecycle events| AOF         | Important for audit trail                        |
| db4 | Gateway budget tracking       | RDB         | Periodic snapshots sufficient                    |

**Post-MVP consideration:** If Redis memory pressure becomes an issue, split into two Redis instances: one for critical persistent data (db0, db3, db4) and one for ephemeral caches (db1, db2).

> See BRAINSTORM.md Section 13.9 for persistence strategy rationale.

---

## 10. Resource Budget

Host machine: **64GB RAM total**, **24GB reserved for Docker cluster**.

| Component                | RAM    | CPU    | Notes                                        |
|--------------------------|--------|--------|----------------------------------------------|
| Unified Gateway          | 512MB  | 0.5    | Policy engine + egress proxy + scheduler     |
| Kubex Manager            | 256MB  | 0.25   | Docker SDK lifecycle                         |
| Kubex Broker             | 256MB  | 0.25   | Redis-backed message routing                 |
| Kubex Registry           | 128MB  | 0.25   | In-memory capability store                   |
| Orchestrator Kubex       | 2GB    | 1.0    | CLI LLM + MCP bridge + all skills            |
| Instagram Scraper Kubex  | 2GB    | 1.0    | OpenClaw + HTTP scraping (proxied)           |
| Reviewer Kubex           | 2GB    | 1.0    | OpenClaw + o3-mini API calls (proxied)       |
| Redis                    | 512MB  | 0.5    | Message queue + rate limits + budget         |
| Neo4j                    | 1.5GB  | 0.5    | Graphiti knowledge graph backend             |
| Graphiti                 | 512MB  | 0.25   | Temporal knowledge graph REST API            |
| OpenSearch               | 3GB    | 1.0    | Single-node: 1.5GB heap + OS overhead        |
| **Total Docker MVP**     | **~12.7GB** | **6.5** | All components containerized |
| **Remaining headroom**   | **~11.3GB** | | Room for 4-5 more Kubexes                    |

---

## 11. Docker Compose Skeleton

```yaml
# docker-compose.yml — KubexClaw MVP
version: "3.8"

networks:
  kubex-internal:
    driver: bridge
    # All Kubexes + infrastructure services. No external access.
  kubex-external:
    driver: bridge
    # Gateway ONLY — outbound internet for LLM API calls and egress proxy.
  kubex-data:
    driver: bridge
    # Gateway + data stores (Redis, Neo4j, OpenSearch, Graphiti).
    # Kubexes CANNOT reach this network — all data access mediated by Gateway/Broker.

volumes:
  redis-data:
  neo4j-data:
  opensearch-data:
  secrets-host:   # Host path for bind-mounted secrets

# ── Prerequisites ────────────────────────────────────────────────
# Run './kubexclaw setup' before 'docker compose up -d' to configure
# LLM provider credentials. This creates:
#   secrets/llm-api-keys.json         — API keys (Gateway-only — never mounted into workers)
#   secrets/llm-oauth-tokens.json     — OAuth refresh tokens (Gateway-only)
#   secrets/cli-credentials/<provider>/  — CLI auth tokens (mounted into workers for CLI identity)

services:
  # ── Infrastructure (always running) ─────────────────────────────

  gateway:
    build: ./services/gateway
    container_name: kubexclaw-gateway
    ports:
      - "8080:8080"
    volumes:
      - ./policies:/app/policies:ro
      - ./agents:/app/agents:ro           # Read agent-level policies
      - ./secrets/llm-api-keys.json:/app/secrets/llm-api-keys.json:ro  # LLM API keys — Gateway only
      - ./secrets/llm-oauth-tokens.json:/app/secrets/llm-oauth-tokens.json:rw  # Gateway manages token refresh (RW)
      - ./secrets/cli-credentials:/app/cli-credentials:rw  # Gateway updates rotated refresh tokens (RW)
    environment:
      - REDIS_URL=redis://gateway-svc:${REDIS_PASSWORD}@redis:6379
      - REGISTRY_URL=http://kubex-registry:8070
      # NO API keys as env vars — Gateway reads from mounted secrets/llm-api-keys.json
    networks:
      - kubex-internal
      - kubex-external
      - kubex-data
    depends_on:
      redis:
        condition: service_healthy
      neo4j:
        condition: service_healthy
      opensearch:
        condition: service_healthy
    deploy:
      resources:
        limits: { memory: 512M, cpus: '0.5' }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  kubex-manager:
    build: ./services/kubex-manager
    container_name: kubexclaw-manager
    ports:
      - "8090:8090"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock    # Required for Docker SDK
      - ./secrets/cli-credentials:/app/cli-credentials:ro  # CLI LLM auth tokens (NOT API keys) for mounting into Kubexes
      - ./agents:/app/agents:ro                       # Agent configs + manifests
      - ./skills:/app/skills:ro                       # Skill catalog (manifests + tools)
    environment:
      - REDIS_URL=redis://manager-svc:${REDIS_PASSWORD}@redis:6379/3
      - REGISTRY_URL=http://kubex-registry:8070
      - GATEWAY_URL=http://gateway:8080
      - MANAGER_TOKEN=${MANAGER_TOKEN}
      # Kubex Manager does NOT read llm-api-keys.json — those are Gateway-only.
      # It sets *_BASE_URL env vars on workers pointing to Gateway proxy endpoints.
    networks:
      - kubex-internal
      - kubex-data
    depends_on:
      gateway:
        condition: service_healthy
    deploy:
      resources:
        limits: { memory: 256M, cpus: '0.25' }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8090/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  kubex-broker:
    build: ./services/kubex-broker
    container_name: kubexclaw-broker
    # No external port mapping — Broker is internal-only.
    # The Orchestrator never connects to the Broker directly; it uses the Gateway API.
    # Worker Kubexes (internal Docker network) connect to Broker directly.
    # Gateway connects to Broker internally for dispatch/result routing.
    # expose:
    #   - "8060"   # Uncomment if internal service-discovery requires it
    environment:
      - REDIS_URL=redis://broker-svc:${REDIS_PASSWORD}@redis:6379/0
      - REGISTRY_URL=http://kubex-registry:8070
    networks:
      - kubex-internal
      - kubex-data
    depends_on:
      redis:
        condition: service_healthy
      gateway:
        condition: service_healthy
    deploy:
      resources:
        limits: { memory: 256M, cpus: '0.25' }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8060/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  kubex-registry:
    build: ./services/kubex-registry
    container_name: kubexclaw-registry
    ports:
      - "8070:8070"
    environment:
      - REDIS_URL=redis://registry-svc:${REDIS_PASSWORD}@redis:6379/2
    networks:
      - kubex-internal
      - kubex-data
    depends_on:
      redis:
        condition: service_healthy
      gateway:
        condition: service_healthy
    deploy:
      resources:
        limits: { memory: 128M, cpus: '0.25' }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8070/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: kubexclaw-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
      - ./config/redis/users.acl:/etc/redis/users.acl:ro
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --aclfile /etc/redis/users.acl
      --appendonly yes
      --appendfsync everysec
      --maxmemory 512mb
    networks:
      - kubex-data
    deploy:
      resources:
        limits: { memory: 512M, cpus: '0.5' }
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  # ── Knowledge Base ──────────────────────────────────────────────

  neo4j:
    image: neo4j:5-community
    container_name: kubexclaw-neo4j
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - neo4j-data:/data
    environment:
      - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}
      - NEO4J_PLUGINS=["apoc"]
    networks:
      - kubex-data
    deploy:
      resources:
        limits: { memory: 1536M, cpus: '0.5' }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7474"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  graphiti:
    image: zepai/graphiti:latest
    container_name: kubexclaw-graphiti
    ports:
      - "8100:8100"
    environment:
      - OPENAI_API_KEY=placeholder        # Graphiti calls Gateway's LLM proxy
      - OPENAI_BASE_URL=http://gateway:8080/v1
      - MODEL_NAME=${DEFAULT_LLM_MODEL}
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=${NEO4J_PASSWORD}
    networks:
      - kubex-data
    depends_on:
      neo4j:
        condition: service_healthy
    deploy:
      resources:
        limits: { memory: 512M, cpus: '0.25' }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8100/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  opensearch:
    image: opensearchproject/opensearch:2
    container_name: kubexclaw-opensearch
    ports:
      - "9200:9200"
    volumes:
      - opensearch-data:/usr/share/opensearch/data
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true       # MVP — internal network only
      - OPENSEARCH_JAVA_OPTS=-Xms1536m -Xmx1536m
    networks:
      - kubex-data
    deploy:
      resources:
        limits:
          memory: 3G
          cpus: '1.0'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9200/_cluster/health"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  # ── Orchestrator Kubex ───────────────────────────────────────────
  orchestrator:
    build: ./agents/orchestrator
    container_name: kubexclaw-orchestrator
    labels:
      kubex.agent_id: "orchestrator"
      kubex.boundary: "default"
    volumes:
      - ./agents/orchestrator/config.yaml:/app/config.yaml:ro
      - ./agents/orchestrator/policies:/app/policies:ro
    environment:
      - ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic
      - OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai
      - GATEWAY_URL=http://gateway:8080
      # NO API keys — all LLM calls proxied through Gateway
    networks:
      - kubex-internal
    depends_on:
      gateway:
        condition: service_healthy
    deploy:
      resources:
        limits: { memory: 2048M, cpus: '1.0' }
    # No ports exposed — user interacts via: docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json
    # CMD keeps container alive waiting for docker exec sessions
    command: ["tail", "-f", "/dev/null"]
    restart: unless-stopped

  # ── Worker agents managed dynamically by Kubex Manager ──────────
  # Scraper, Reviewer: created dynamically by Kubex Manager (Docker SDK).
  # See agents/ directory for their configs.
  #
  # Worker containers use kubex-harness as entrypoint (not the CLI LLM directly).
  # The harness spawns the CLI LLM in a PTY, captures stdout/stderr, and streams
  # progress chunks to the Gateway via POST /tasks/{task_id}/progress.
  #
  # Kubex Manager sets these environment variables on worker containers:
  #   KUBEX_PROGRESS_BUFFER_MS=500     # Buffer window (min: 100, max: 5000, default: 500)
  #   KUBEX_PROGRESS_MAX_CHUNK_KB=16   # Flush early if buffer hits size limit (default: 16KB)
  #   GATEWAY_URL=http://gateway:8080  # Harness POSTs progress chunks here
  #   KUBEX_ABORT_KEYSTROKE="\x03"     # Keystroke sent to PTY on cancel (default: Ctrl+C)
  #   KUBEX_ABORT_GRACE_PERIOD_S=5     # Seconds between escalation steps (default: 5)
  #
  # Example equivalent docker run (for reference only — Kubex Manager handles this):
  #   docker run --label kubex.agent_id=instagram-scraper \
  #     --label kubex.boundary=default \
  #     -e KUBEX_PROGRESS_BUFFER_MS=500 \
  #     -e KUBEX_PROGRESS_MAX_CHUNK_KB=16 \
  #     -e KUBEX_ABORT_KEYSTROKE="\x03" \
  #     -e KUBEX_ABORT_GRACE_PERIOD_S=5 \
  #     -e GATEWAY_URL=http://gateway:8080 \
  #     --entrypoint kubex-harness \
  #     kubexclaw/instagram-scraper:latest
```

> Note: The Orchestrator is declared in this Compose file as a long-running container — it is NOT managed by Kubex Manager. The operator connects via `docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json`. The Scraper and Reviewer are managed dynamically by Kubex Manager via the Docker SDK.

> **No external port exposure for Orchestrator:** The Orchestrator connects to the Gateway over the internal Docker network (`kubex-internal`). No port needs to be exposed externally for Orchestrator ↔ Gateway communication. The Gateway port (`8080`) is exposed for dev/debug access only; for production restrict it to `127.0.0.1:8080`.

---

## 12. Implementation Checklist

### Phase 0: kubex-common + CLI LLM Credential Setup

This phase builds the `kubex-common` shared library (the foundation every service depends on) and the `kubexclaw` CLI tool that configures LLM provider credentials before the stack starts. Must be completed before Phase 1 — all services import `kubex-common`, and `docker compose up -d` expects secrets to exist.

**Test infrastructure setup:**

- [ ] Set up pytest and test directory structure (`tests/unit/`, `tests/integration/`, `tests/e2e/`)
- [ ] Create `pytest.ini` / `pyproject.toml` test configuration (markers for unit/integration/e2e/chaos, test paths, coverage settings)
- [ ] Set up CI pipeline (GitHub Actions) with linting (ruff), formatting (black), and test stages

**kubex-common package:**

- [ ] Implement `kubex-common` Python package (`libs/kubex-common/`, `pyproject.toml`, package structure)
- [ ] Implement `ActionRequest` schema and validation (`schemas/action_request.py`)
- [ ] Implement `GatekeeperEnvelope` schema (`schemas/gatekeeper_envelope.py`)
- [ ] Implement `ActionResponse` schema with per-action typed responses (`schemas/action_response.py`)
- [ ] Implement shared logging utilities (`logging/` — structured JSON log format, correlation ID propagation)
- [ ] Implement shared metrics utilities (`metrics/` — Prometheus metric helpers, `/metrics` endpoint scaffold)

**CLI LLM credential setup:**

- [ ] Create `secrets/` directory structure with `.gitignore` (never commit credentials)
- [ ] Build `kubexclaw setup` CLI script (Python, interactive provider walkthrough)
- [ ] Build `kubexclaw auth <provider>` command — API key providers: prompt for key, write to `secrets/llm-api-keys.json` (Gateway-only secret)
- [ ] Build `kubexclaw auth <provider>` command — OAuth providers: browser consent or device code flow, exchange tokens, write to `secrets/llm-oauth-tokens.json` and `secrets/cli-credentials/<provider>/`
- [ ] Build `kubexclaw reauth <provider>` command — re-authorization for expired/revoked tokens
- [ ] Add agent manifest schema with `cli` and `providers` fields (e.g., `agents/instagram-scraper/manifest.yaml`)
- [ ] Create OpenClaw headless config templates (`openclaw.json`, `AGENTS.md`, `SOUL.md`, `TOOLS.md`)

### Phase 0.5: kubexclaw CLI + Skill Catalog + Management API

This phase builds the full `kubexclaw` CLI (beyond credential setup), the skill catalog structure, and the Management API endpoints in Kubex Manager. Must be completed before Phase 1 — the deploy command and skill catalog are needed before agents can be deployed interactively.

> See [docs/cli.md](docs/cli.md) for full CLI design, [docs/skill-catalog.md](docs/skill-catalog.md) for skill manifest schema, and [docs/api-layer.md](docs/api-layer.md) for API endpoint specifications.

- [ ] Build kubexclaw CLI framework (Python, click or typer) with global flags (`--json`, `--quiet`, `--verbose`, `--no-color`, `--yes`)
- [ ] Implement full setup wizard (4-step: provider → defaults → safety → launch infrastructure)
- [ ] Implement deploy wizard (interactive skill picker, naming, model selection, review confirmation)
- [ ] Implement `kubexclaw skills list` — browse catalog grouped by category
- [ ] Implement `kubexclaw skills info <name>` — detailed skill card with capabilities, resources, cost estimate
- [ ] Implement `kubexclaw skills search <query>` — fuzzy search across names, descriptions, tags
- [ ] Implement `kubexclaw agents list` — table with name, skill, status, model, uptime, cost MTD
- [ ] Implement `kubexclaw agents info <name>` — detailed view with recent activity, pending approvals
- [ ] Implement `kubexclaw agents stop/start/restart` — lifecycle commands with in-progress task warnings
- [ ] Implement `kubexclaw agents remove <name>` — destructive with typed name confirmation
- [ ] Implement `kubexclaw agents logs <name>` — streaming with `--tail N` and `--since` support
- [ ] Implement `kubexclaw config show/set/reset` — plain English keys (spending-limit, default-model, approval-mode)
- [ ] Implement `kubexclaw config providers list/add/remove` — provider credential management
- [ ] Implement `kubexclaw status` — system health dashboard (infra, agents, budget, approvals)
- [ ] Create `skills/` directory structure with built-in skill categories
- [ ] Create skill manifest schema definition (`skill.yaml` format)
- [ ] Build 5 initial skill packages: web-scraping, data-analysis, content-writing, code-review, research
- [ ] Write AGENTS.md templates for each built-in skill
- [ ] Implement skill composition engine in Kubex Manager (union actions, restrictive policies, resource stacking)
- [ ] Implement custom skill scaffolding: `kubexclaw skills create <name>`
- [ ] Implement Kubex Manager Management API: lifecycle endpoints (`POST/GET/DELETE /api/v1/agents`, stop/start/restart)
- [ ] Implement Kubex Manager Management API: skills catalog endpoints (`GET /api/v1/skills`, search, detail)
- [ ] Implement Kubex Manager Management API: configuration endpoints (`GET/PATCH /api/v1/config`, providers CRUD)
- [ ] Implement Kubex Manager Management API: monitoring endpoints (`GET /api/v1/health`, logs, budget)
- [ ] Implement Kubex Manager Management API: approval queue endpoints (`GET/POST /api/v1/approvals`)
- [ ] Add bearer token authentication to Management API
- [ ] Add `--json` output mode for all CLI commands
- [ ] Error handling with plain English messages and actionable next steps

### Phase 1: Orchestrator Container + Gateway + Proof-of-Concept End-to-End

This phase is the proof-of-concept that validates the entire pipeline. The goal is a working `docker exec -it orchestrator claude --mcp-server ...` session that can dispatch a task through the Gateway to a stub worker and receive a result back.

- [ ] Build `agents/orchestrator/Dockerfile` — CLI LLM + MCP bridge pre-packaged
- [ ] Add `orchestrator` service to `docker-compose.yml` with Docker labels (`kubex.agent_id=orchestrator`, `kubex.boundary=default`)
- [ ] Build MCP Bridge server (`agents/orchestrator/mcp-bridge/`) — expose `dispatch_task`, `check_task_status`, `request_user_input` as MCP tools
- [ ] MCP Bridge: connect to Gateway only via `http://gateway:8080` (internal network — no API token needed)
- [ ] MCP Bridge: implement `subscribe_task_progress(task_id)` tool — opens `GET /tasks/{task_id}/stream` SSE in background, buffers chunks
- [ ] MCP Bridge: implement `get_task_progress(task_id)` tool — returns buffered progress chunks since last call
- [ ] MCP Bridge: after `dispatch_task`, auto-subscribe to SSE and surface progress events to the CLI LLM
- [ ] MCP Bridge: implement `cancel_task(task_id, reason?)` tool — sends `POST /tasks/{task_id}/cancel` to Gateway
- [ ] Scaffold `libs/kubex-common` package structure with `pyproject.toml`
- [ ] Implement `actions.py` — `ActionType` enum and `ACTION_PARAM_SCHEMAS` registry
- [ ] Implement `enums.py` — tiers, decisions, agent status, priorities
- [ ] Implement `schemas/action_request.py` — canonical `ActionRequest` schema
- [ ] Implement `schemas/gatekeeper_envelope.py` — `GatekeeperEnvelope` schema
- [ ] Implement `schemas/routing.py` — `RoutedRequest`, `BrokeredRequest`, `TaskDelivery`
- [ ] Implement `schemas/actions/` — per-action typed parameter schemas (http, dispatch, result, registry, storage, knowledge)
- [ ] Implement `schemas/ontology.py` — entity types and relationship types for knowledge base
- [ ] Implement `schemas/agent_capability.py` — capability advertisement schema
- [ ] Implement `auth/` — container identity verification primitives (Docker label lookup only — no API token path needed for MVP)
- [ ] Implement `config.py` — shared configuration patterns
- [ ] Set up Redis container with db0-db4 configuration
- [ ] Set up root `docker-compose.yml` with all infrastructure services
- [ ] Verify end-to-end: `docker compose up -d` → `docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json` → dispatch stub task → receive result

### Phase 2: Gateway + Registry + Broker

- [ ] Build Gateway MVP — FastAPI, `POST /evaluate`, YAML policy loader
- [ ] Implement Gateway `GET /tasks/{task_id}/stream` SSE endpoint — fan out `progress_update` events and terminal `report_result` events to Orchestrator
- [ ] Implement Gateway `POST /tasks/{task_id}/progress` endpoint — receive harness progress chunks, publish to Redis pub/sub channel `progress:{task_id}`
- [ ] Implement Redis pub/sub fan-out for progress streaming — Gateway subscribes to `progress:{task_id}` channels and forwards to SSE connections
- [ ] Implement `progress_update` action handler in Gateway — always ALLOW, fan out to task SSE stream
- [ ] Implement Gateway `POST /tasks/{task_id}/cancel` endpoint — resolve task_id to agent_id, publish cancel command to Redis `control:{agent_id}` channel, verify caller is task originator
- [ ] Add `cancelled` event type to Gateway SSE stream — emitted when harness confirms cancellation via final progress update with `exit_reason: "cancelled"`
- [ ] Implement Gateway egress proxy — HTTP client that proxies Kubex external requests
- [ ] Implement Gateway identity resolution — Docker label lookup via source IP
- [ ] Implement Gateway `agent_id` overwrite from resolved container identity
- [ ] Implement Gateway LLM API key injection per model allowlist
- [ ] Implement Gateway OAuth token refresh loop — check expiry every 60s, refresh 5min early, cache access tokens in Redis db4, update `secrets/llm-oauth-tokens.json` if refresh token rotated
- [ ] Implement Gateway WebSocket origin validation (Section 17)
- [ ] Implement Gateway request path canonicalization (Section 17)
- [ ] Write MVP global policy file (`policies/global.yaml`)
- [ ] Build Kubex Registry MVP — in-memory store, REST API for capability queries
- [ ] Build Kubex Broker MVP — Redis Streams transport, consumer groups, dead letter handling
- [ ] Write integration tests: Gateway policy evaluation with mock ActionRequests

### Phase 3: Kubex Manager + Base Agent Image

- [ ] Build Kubex Manager MVP — FastAPI + Docker SDK (~200 lines core)
- [ ] Implement lifecycle endpoints: create, start, stop, kill, restart, list, get
- [ ] Implement Docker label setting: `kubex.agent_id`, `kubex.boundary` on container creation
- [ ] Implement bind-mounted secret file provisioning at `/run/secrets/`
- [ ] Implement credential setup from agent manifest — read `providers` list, set `*_BASE_URL` env vars pointing to Gateway proxy endpoints (no API keys)
- [ ] Implement Kubex Manager setting of `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` env vars on worker containers
- [ ] Implement Kubex Manager mounting of `secrets/cli-credentials/<provider>/` into worker containers (read-only, CLI auth tokens only)
- [ ] Implement agent registration in Kubex Registry on startup
- [ ] Implement kill switch: `docker stop` + secret file cleanup
- [ ] Implement lifecycle event publishing to Redis Stream (db3)
- [ ] Create `agents/_base/Dockerfile.base` — OpenClaw runtime + kubex-common + kubex-harness installed
- [ ] Pin OpenClaw base image to >= v2026.2.26 (Section 17 security audit)
- [ ] Build `kubex-harness` entrypoint — PTY spawn, stdout/stderr capture, chunk buffering, `POST /tasks/{task_id}/progress` to Gateway
- [ ] Implement harness chunking config: `KUBEX_PROGRESS_BUFFER_MS` (default 500ms) and `KUBEX_PROGRESS_MAX_CHUNK_KB` (default 16KB) env vars
- [ ] Implement harness Redis `control:{agent_id}` channel subscription — subscribe on startup, listen for cancel commands
- [ ] Implement harness graceful cancellation escalation — 3-step: send `KUBEX_ABORT_KEYSTROKE` to PTY → SIGTERM → SIGKILL, with `KUBEX_ABORT_GRACE_PERIOD_S` between steps
- [ ] Implement harness cancel env vars: `KUBEX_ABORT_KEYSTROKE` (default `\x03`) and `KUBEX_ABORT_GRACE_PERIOD_S` (default 5)
- [ ] Implement harness cancel response — send final progress update with `final: true` and `exit_reason: "cancelled"`
- [ ] Implement harness MCP proxy — forward MCP tool calls between CLI LLM and MCP bridge
- [ ] Create `agents/_base/entrypoint.sh` — agent bootstrap with skill loading (invokes kubex-harness for workers)
- [ ] Remove or lock down `WORKFLOW_AUTO.md` in base agent config
- [ ] Configure `commands.ownerAllowFrom` to restrict admin commands to Gateway

### Phase 4: MVP Agents (Worker Kubexes)

- [ ] Create `agents/orchestrator/config.yaml` — system prompt, skills, policy
- [ ] Build Orchestrator skills: `dispatch_task`, `check_task_status`, `report_result`, `request_user_input`
- [ ] Write Orchestrator policy file (includes `request_user_input` in allowed actions)
- [ ] MCP Bridge: implement `progress_update` as MCP tool (worker-side — used by worker Kubex MCP bridges)
- [ ] Create `agents/instagram-scraper/config.yaml` — system prompt, skills, policy, egress rules
- [ ] Build Scraper skills: `scrape_profile`, `scrape_posts`, `scrape_hashtag`, `extract_metrics`
- [ ] Write Scraper policy file
- [ ] Create `agents/reviewer/config.yaml` — system prompt, model allowlist (o3-mini only)
- [ ] Write Reviewer policy file
- [ ] Write Kubex Manager startup config defining the 2 managed MVP agents (Scraper, Reviewer)
- [ ] Configure Kubex Manager to set harness env vars on worker containers: `KUBEX_PROGRESS_BUFFER_MS`, `KUBEX_PROGRESS_MAX_CHUNK_KB`, `KUBEX_ABORT_KEYSTROKE`, `KUBEX_ABORT_GRACE_PERIOD_S`, `GATEWAY_URL`
- [ ] Configure Kubex Manager to set `kubex-harness` as entrypoint for worker containers
- [ ] Implement built-in `model_selector` skill in `kubex-common/src/skills/model_selector.py`
- [ ] Implement action interception layer in `agents/_base` (wraps skill outbound ops as ActionRequests)

### Phase 5: Knowledge Base

- [ ] Deploy Neo4j + Graphiti via Docker Compose
- [ ] Create OpenSearch knowledge corpus index templates (`knowledge-corpus-shared-*`)
- [ ] Configure Graphiti LLM binding to use Gateway proxy (`OPENAI_BASE_URL=http://gateway:8080/v1`)
- [ ] Implement `query_knowledge` action type and parameter schema in kubex-common
- [ ] Implement `store_knowledge` action type and parameter schema in kubex-common
- [ ] Implement `search_corpus` action type and parameter schema in kubex-common
- [ ] Add Gateway proxy routes for Graphiti and OpenSearch knowledge queries
- [ ] Implement two-step ingestion handler in Gateway (OpenSearch index + Graphiti episode)
- [ ] Implement built-in `knowledge` skill in `kubex-common/src/skills/knowledge.py`
- [ ] Implement `RecallTool` (recall) — Graphiti search wrapper with automatic group resolution
- [ ] Implement `MemorizeTool` (memorize) — two-step store wrapper with provenance injection
- [ ] Add implicit skill loading for `knowledge` in agent base
- [ ] Write standard knowledge base system prompt section for auto-injection
- [ ] Test entity extraction and contradiction resolution quality

### Phase 6: Integration Testing + E2E

- [ ] Test full loop: human (`docker exec`) -> orchestrator (container) -> gateway -> broker -> scraper -> gateway -> orchestrator polls result
- [ ] Test kill switch: stop scraper mid-task, verify cleanup
- [ ] Test policy enforcement: scraper attempts blocked action (http_post), verify DENY
- [ ] Test egress enforcement: scraper attempts non-allowlisted domain, verify DENY
- [ ] Test budget enforcement: exceed per-task token limit, verify DENY
- [ ] Test inter-agent dispatch: orchestrator dispatches to scraper via Gateway (Gateway routes to Broker internally)
- [ ] Test identity resolution: verify Gateway overwrites agent_id from Docker labels for all Kubexes (Orchestrator + workers)
- [ ] Test identity spoofing: reject request where ActionRequest body `agent_id` doesn't match resolved container identity
- [ ] Test task cancellation: user cancels running task, verify harness escalation (Ctrl+C → SIGTERM → SIGKILL), verify SSE `cancelled` event, verify Orchestrator receives confirmation
- [ ] Test cancel authorization: verify only the originating agent (Orchestrator) can cancel a task, verify DENY for other agents
- [ ] Test cancel with graceful exit: worker responds to Ctrl+C within grace period, verify no SIGTERM sent
- [ ] Test clarification flow: scraper returns `needs_clarification`, orchestrator resolves autonomously
- [ ] Test clarification flow (human): scraper returns `needs_clarification`, MCP bridge surfaces question, user responds, task re-dispatched
- [ ] Test `request_user_input` action: Gateway allows for Orchestrator, verify DENY for worker Kubexes
- [ ] Test knowledge base: scraper stores knowledge, orchestrator recalls it
- [ ] Test model separation: verify workers use Anthropic, reviewer uses OpenAI, zero overlap
- [ ] Test credential setup: Kubex Manager reads agent manifest, sets correct `*_BASE_URL` env vars pointing to Gateway proxy endpoints and mounts correct CLI auth token files
- [ ] Test `kubexclaw setup` end-to-end: configure API key provider, configure OAuth provider, verify secrets files written correctly
- [ ] Test Gateway token refresh: verify access token cached in Redis db4, verify refresh before expiry, verify rotated refresh token written to secrets file
- [ ] Test Reviewer flow: submit ambiguous action, verify reviewer evaluation
- [ ] Write pytest fixtures for all policy files (expected approve/deny/escalate outcomes)

---

## 12. MCP Bridge

The MCP Bridge is the adapter layer that lets any MCP-compatible CLI LLM (e.g., Claude Code, Continue, Cursor) act as the Orchestrator's reasoning engine. It runs **inside the Orchestrator container** (pre-packaged in the image) and exposes KubexClaw infrastructure operations as MCP tools.

### 12.1 Concept

```mermaid
flowchart LR
    HUMAN([Operator]) -->|"docker exec -it\norchestrator"| subgraph1

    subgraph subgraph1["Orchestrator Container"]
        CLI["CLI LLM Tool\ne.g. claude"]
        BRIDGE["MCP Bridge\n/app/mcp-bridge/server.py"]
        CLI <-->|"MCP protocol"| BRIDGE
    end

    BRIDGE <-->|"HTTP — internal Docker network\nALL requests\nhttp://gateway:8080"| GW["Gateway\n(single connection)"]
```

The MCP Bridge is **not** a Kubex — it has no agent identity of its own. It is a thin translation layer that converts MCP tool calls into `ActionRequest` objects sent to the Gateway. The Gateway resolves the identity from the Orchestrator container's Docker labels (same as all Kubexes — no API token needed). The Gateway is the sole connection: it handles policy evaluation, Broker writes (for `dispatch_task`), and result retrieval (for `check_task_status`). The MCP Bridge has no direct Broker or Registry connections.

### 12.2 Exposed MCP Tools

| MCP Tool | Maps to Action | Description |
|----------|---------------|-------------|
| `submit_action` | Any `ActionRequest` | Submit an action request to the Gateway for execution |
| `dispatch_task` | `dispatch_task` | Send a task to a worker Kubex by capability name (Gateway routes to Broker internally); immediately opens `GET /tasks/{task_id}/stream` SSE after dispatch |
| `list_agents` | `query_registry` | List available agents and their capabilities from the Registry |
| `check_task_status` | `check_task_status` | Poll the Gateway for a task's current status (Gateway reads from Broker internally) |
| `subscribe_task_progress` | Opens `GET /tasks/{task_id}/stream` SSE | Subscribe to a worker task's progress stream; MCP bridge holds SSE connection in background and buffers incoming chunks |
| `get_task_progress` | Reads buffered SSE events | Poll latest progress chunks received since last `get_task_progress` call; returns accumulated `content` and `chunk_type` entries |
| `cancel_task` | `POST /tasks/{task_id}/cancel` | Cancel a running task; accepts `task_id` (required) and `reason` (optional). Cancellation confirmed asynchronously via SSE `cancelled` event |
| `query_knowledge` | `query_knowledge` | Query the Graphiti knowledge graph |
| `store_knowledge` | `store_knowledge` | Store knowledge into Graphiti graph and OpenSearch corpus |
| `report_result` | `report_result` | Report a completed task result back to the user |
| `request_user_input` | `request_user_input` | Surface a question to the operator (blocks until answered) |

### 12.2.1 MCP Tool JSON Schemas

Full MCP tool definitions following the [Model Context Protocol tool specification](https://spec.modelcontextprotocol.io/). Each tool is exposed by the MCP Bridge server and translates into `ActionRequest` objects sent to the Gateway.

**`submit_action`:**
```json
{
  "name": "submit_action",
  "description": "Submit an action request to the Gateway for execution",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "description": "Action type from the action vocabulary (e.g., http_get, write_output)"},
      "parameters": {"type": "object", "description": "Action-specific parameters (schema varies by action type)"},
      "target_agent": {"type": "string", "description": "Target agent ID (optional — Gateway routes if omitted)"}
    },
    "required": ["action", "parameters"]
  }
}
```

**`dispatch_task`:**
```json
{
  "name": "dispatch_task",
  "description": "Dispatch a task to a worker Kubex via the Gateway. The Gateway writes to the Broker internally. Returns a task_id for status tracking.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "target_agent": {"type": "string", "description": "Agent ID to dispatch to (resolved via Registry if capability-based routing)"},
      "action": {"type": "string", "description": "Action for the worker to perform"},
      "parameters": {"type": "object", "description": "Action-specific parameters"},
      "context_message": {"type": "string", "description": "Natural language context for the worker (treated as untrusted input by the receiving Kubex)"},
      "priority": {"type": "string", "enum": ["low", "normal", "high"], "default": "normal"}
    },
    "required": ["target_agent", "action", "parameters"]
  }
}
```

**`list_agents`:**
```json
{
  "name": "list_agents",
  "description": "List available agents and their capabilities from the Registry",
  "inputSchema": {
    "type": "object",
    "properties": {
      "skill_filter": {"type": "string", "description": "Filter agents by skill name"},
      "status_filter": {"type": "string", "enum": ["running", "stopped", "all"], "default": "running"}
    }
  }
}
```

**`check_task_status`:**
```json
{
  "name": "check_task_status",
  "description": "Check the current status of a dispatched task",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "description": "Task ID returned from dispatch_task"}
    },
    "required": ["task_id"]
  }
}
```

**`subscribe_task_progress`:**
```json
{
  "name": "subscribe_task_progress",
  "description": "Subscribe to SSE progress stream for a task. The MCP bridge opens GET /tasks/{task_id}/stream in the background and buffers incoming chunks. Progress is retrievable via get_task_progress.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "description": "Task ID to subscribe to"}
    },
    "required": ["task_id"]
  }
}
```

**`get_task_progress`:**
```json
{
  "name": "get_task_progress",
  "description": "Get buffered progress updates since last check for a subscribed task. Returns accumulated content and chunk_type entries.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "description": "Task ID to get progress for"},
      "since_sequence": {"type": "integer", "description": "Return chunks after this sequence number (for catch-up after reconnection)"}
    },
    "required": ["task_id"]
  }
}
```

**`cancel_task`:**
```json
{
  "name": "cancel_task",
  "description": "Cancel a running task. The Gateway resolves task_id to agent_id and publishes a cancel command via Redis. The worker receives a graceful shutdown signal. Cancellation is confirmed asynchronously via SSE cancelled event.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "description": "Task ID to cancel"},
      "reason": {"type": "string", "description": "Reason for cancellation (logged in audit trail)"}
    },
    "required": ["task_id"]
  }
}
```

**`query_knowledge`:**
```json
{
  "name": "query_knowledge",
  "description": "Query the Graphiti knowledge graph for entities and relationships. Proxied through the Gateway to Graphiti.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Natural language query for the knowledge graph"},
      "max_results": {"type": "integer", "default": 10, "description": "Maximum number of results to return"}
    },
    "required": ["query"]
  }
}
```

**`store_knowledge`:**
```json
{
  "name": "store_knowledge",
  "description": "Store knowledge into the Graphiti graph and OpenSearch corpus. Triggers two-step ingestion: OpenSearch indexes the document, then Graphiti extracts entities and relationships.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "content": {"type": "string", "description": "Knowledge content to store"},
      "source_description": {"type": "string", "description": "Where this knowledge came from (becomes metadata linking Graphiti entities to OpenSearch document)"}
    },
    "required": ["content", "source_description"]
  }
}
```

**`report_result`:**
```json
{
  "name": "report_result",
  "description": "Report the result of a completed task back to the user. The Gateway stores the result against the task_id for retrieval by the Orchestrator.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "description": "Original task ID (from dispatch_task)"},
      "result": {"type": "string", "description": "Task result summary (human-readable)"},
      "data": {"type": "object", "description": "Structured result data (JSON payload)"},
      "status": {"type": "string", "enum": ["success", "partial", "failed"], "description": "Task completion status"}
    },
    "required": ["result", "status"]
  }
}
```

**`request_user_input`:**
```json
{
  "name": "request_user_input",
  "description": "Ask the user a question and wait for their response. The MCP bridge blocks on stdin until the operator answers or the timeout expires. Only the Orchestrator may use this tool.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": {"type": "string", "description": "Question to ask the user"},
      "context": {"type": "string", "description": "Additional context to help the user answer"},
      "options": {"type": "array", "items": {"type": "string"}, "description": "Predefined choices (optional — free-text if omitted)"},
      "timeout_seconds": {"type": "integer", "default": 300, "description": "How long to wait for a response before timing out"}
    },
    "required": ["prompt"]
  }
}
```

### 12.3 Authentication

The MCP Bridge uses Docker label auth — the same path as all Kubexes. The Orchestrator container has labels `kubex.agent_id=orchestrator` and `kubex.boundary=default`. The Gateway resolves identity from the source IP via the Docker API. No API token is needed. The MCP Bridge simply sends `ActionRequest` objects to the Gateway over the internal Docker network (`http://gateway:8080`).

### 12.4 Clarification Routing

When the MCP Bridge receives a `report_result` with `status: needs_clarification` from the Gateway (via `GET /tasks/{task_id}/result`):

1. It first forwards the clarification to the CLI LLM (as a tool return value or message).
2. The CLI LLM attempts to resolve autonomously using available context.
3. If the CLI LLM cannot resolve, it calls the `request_user_input` MCP tool.
4. The MCP Bridge blocks on user terminal input, then returns the answer to the CLI LLM.
5. The CLI LLM re-dispatches the task with updated context.

### 12.5 File Layout

```
agents/orchestrator/
  Dockerfile                  # CLI LLM + MCP bridge + all skills pre-packaged
  mcp-bridge/
    server.py                 # MCP server entry point (FastMCP or mcp-python)
    tools/
      dispatch.py             # dispatch_task, check_task_status tools
      cancel.py               # cancel_task tool (POST /tasks/{task_id}/cancel)
      progress.py             # subscribe_task_progress, get_task_progress tools (SSE consumer)
      input.py                # request_user_input tool (stdin blocking)
      registry.py             # query_registry tool
      knowledge.py            # query_knowledge, search_corpus tools
    client/
      gateway.py              # Gateway HTTP client — sole connection point (no token)
    config.py                 # Reads GATEWAY_URL from env (default: http://gateway:8080)
    requirements.txt
  config.yaml                 # Agent config: system prompt, skills, policy
  policies/
    policy.yaml               # Orchestrator action + egress policy
```

### 12.6 Startup

```bash
# 0. Configure LLM provider credentials (first time only)
./kubexclaw setup                  # Interactive walkthrough — API keys + OAuth flows
# Or configure individual providers:
# ./kubexclaw auth anthropic       # API key — just paste it
# ./kubexclaw auth google-gemini   # OAuth — opens browser for consent
# ./kubexclaw auth claude          # OAuth — device code flow

# 1. Start entire stack (includes Orchestrator container)
docker compose up -d

# 2. Connect to the Orchestrator — no secrets needed on the host
docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json
```

> The MCP Bridge connects only to `http://gateway:8080` (internal Docker network). No API token is required — the Gateway identifies the Orchestrator via Docker label lookup. No direct Redis, Broker, or Registry connections. The Gateway exposes `POST /actions` for submitting ActionRequests and `GET /tasks/{task_id}/result` for polling results.

The MCP Bridge config is pre-baked into the Orchestrator image at `/app/mcp-bridge/config.json`. No host-side configuration needed beyond `docker compose up -d`.

---

## 13. Deferred to Post-MVP

The following items are explicitly **out of scope** for MVP. Each is recorded here to prevent scope creep and to provide a reference for what comes next.

| Item | Where Designed | Why Deferred |
|------|---------------|-------------|
| Remote/external Orchestrator (API token auth) | docs/user-interaction.md Section 30.1 | MVP Orchestrator is containerized (Docker label auth). API token path needed only for Orchestrators running outside the Docker network — post-MVP |
| Kubex Activation Requests | BRAINSTORM.md Section 6 (see docs/kubex-manager.md) | All MVP worker agents are always running — no stopped Kubexes to activate |
| Multi-Boundary support | BRAINSTORM.md Section 11, 16.3 (see docs/boundaries.md) | MVP uses single `default` boundary. Boundary Gateways as separate containers are post-MVP |
| Per-Boundary Gateway Kubexes | BRAINSTORM.md Section 16.3 (see docs/boundaries.md) | Boundary logic runs inline within unified Gateway for MVP |
| Command Center UI | BRAINSTORM.md Section 10 (see docs/command-center.md) | CLI + API only for MVP. Full web UI is a major frontend build |
| Grafana + Prometheus monitoring | BRAINSTORM.md Section 9 (see docs/operations.md) | Manual `docker stats` for MVP. Monitoring stack adds infra complexity |
| OpenSearch Dashboards | BRAINSTORM.md Section 9 (see docs/operations.md) | Stdout logs only for MVP. Dashboards deferred |
| Fluent Bit / central logging pipeline | BRAINSTORM.md Section 9 (see docs/infrastructure.md) | MVP uses Docker JSON log driver. Kubex Manager reads container logs via Docker API for `kubexclaw agents logs`. Fluent Bit central log collector is added post-MVP for log aggregation to OpenSearch |
| Human approval queue UI | BRAINSTORM.md Section 19.9 (see docs/kubex-manager.md) | Approvals via CLI or direct API call for MVP |
| Reviewer LLM for ambiguous actions | BRAINSTORM.md Section 2 (see docs/gateway.md) | Policy Engine handles all decisions deterministically for MVP. Reviewer Kubex is deployed but the full escalation flow is simplified |
| Mission Control integration | BRAINSTORM.md Section 7 (see docs/command-center.md) | Command Center replaces MC as primary UI — both deferred |
| CI/CD pipeline | BRAINSTORM.md Section 22 (see docs/operations.md) | Manual builds for MVP |
| PII detection in output validation | BRAINSTORM.md Section 20 (see docs/operations.md) | Post-MVP content analysis |
| Automatic knowledge ingestion triggers | BRAINSTORM.md Section 27.13 (see docs/knowledge-base.md) | Manual `memorize` only for MVP |
| Point-in-time queries (`as_of`) | BRAINSTORM.md Section 27.13 (see docs/knowledge-base.md) | Post-MVP temporal query feature |
| Boundary-scoped knowledge groups | BRAINSTORM.md Section 27.13 (see docs/knowledge-base.md) | Single `shared` group for MVP |
| Knowledge graph visualization | BRAINSTORM.md Section 27.13 (see docs/command-center.md) | Requires Command Center UI |
| `manage_knowledge` admin action | BRAINSTORM.md Section 27.7 (see docs/knowledge-base.md) | Graph CRUD reserved for post-MVP |
| Inter-agent communication rules (category 4) | BRAINSTORM.md Section 13.3 (see docs/gateway.md) | `accepts_from`, cross-boundary tier — deferred with boundaries |
| Output/data validation rules (category 5) | BRAINSTORM.md Section 13.3 (see docs/gateway.md) | Schema validation + payload size in MVP; PII filter deferred |
| Behavioral rules (category 6) | BRAINSTORM.md Section 13.3 (see docs/gateway.md) | Actions/min, chain depth, time-of-day — post-MVP |
| Distributed tracing (OpenTelemetry) | BRAINSTORM.md Section 15.18 (see docs/operations.md) | `workflow_id` + `task_id` correlation is sufficient for MVP |
| GDPR / data retention policies | BRAINSTORM.md Section 24 (see docs/operations.md) | Don't log PII for MVP. Crypto-shredding and DSAR are post-MVP |
| Disaster recovery runbooks | BRAINSTORM.md Section 25 (see docs/operations.md) | MVP is dev/test — full DR planning is post-MVP |
| Operator CLI (`kubexctl`) | BRAINSTORM.md Section 26 (see docs/cli.md) | Direct `docker`/`curl` commands for MVP |
| Scheduled/cron workflows | BRAINSTORM.md Section 13.9 (see docs/gateway.md) | Gateway scheduler component deferred |
| Secret rotation automation | BRAINSTORM.md Section 8 (see docs/infrastructure.md) | Manual rotation for MVP. Infisical/Vault graduation post-MVP |
| Orchestrator terminal streaming (Option B) | docs/user-interaction.md Section 30.5 | MVP uses MCP tool polling (Option A). Direct SSE-to-terminal with multiplexing is post-MVP |
| Multi-user support | docs/gaps.md Section 28 | MVP is single-user (no auth). Multi-user requires user accounts, RBAC, per-user agent ownership, budget isolation, knowledge partitioning, session isolation, auth middleware in Gateway, and a user database (new dependency). Phased post-MVP: Phase 1 (accounts + RBAC), Phase 2 (ownership + budgets), Phase 3 (knowledge isolation) |
