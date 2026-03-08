# KubexClaw MVP — Architecture Diagrams

> Visual reference for the KubexClaw agent infrastructure. All diagrams use Mermaid syntax per project rules.
> Source of truth: `docs/` directory (architecture decisions, indexed by `KubexClaw.md`) and `MVP.md` (implementation details). The original `BRAINSTORM.md` is archived at `archive/BRAINSTORM-v1.md`.

---

## 1. System Overview — High-Level Architecture

### 1.1 System Context (C4 Level 1)

Who interacts with KubexClaw and what external systems does it depend on.

```mermaid
graph TD
    HUMAN([Human Operator<br/>Command Center / CLI])
    KUBEXCLAW["KubexClaw Platform<br/>Agent orchestration with<br/>security-first design"]

    IG["Instagram API<br/>graph.instagram.com<br/>i.instagram.com"]
    SMTP["SMTP Server<br/>Email delivery"]
    ANTHROPIC["Anthropic API<br/>api.anthropic.com<br/>Claude Haiku / Sonnet"]
    OPENAI["OpenAI API<br/>api.openai.com<br/>Codex"]

    HUMAN -->|"submit tasks<br/>approve escalations<br/>monitor agents"| KUBEXCLAW
    KUBEXCLAW -->|"scrape public profiles<br/>(GET only)"| IG
    KUBEXCLAW -->|"send email summaries<br/>(post-MVP)"| SMTP
    KUBEXCLAW -->|"worker LLM calls<br/>(proxied, key injected)"| ANTHROPIC
    KUBEXCLAW -->|"reviewer LLM calls<br/>(proxied, key injected)"| OPENAI

    style KUBEXCLAW fill:#264653,stroke:#fff,color:#fff
    style HUMAN fill:#2a9d8f,stroke:#fff,color:#fff
    style IG fill:#e76f51,stroke:#fff,color:#fff
    style SMTP fill:#e76f51,stroke:#fff,color:#fff
    style ANTHROPIC fill:#e76f51,stroke:#fff,color:#fff
    style OPENAI fill:#e76f51,stroke:#fff,color:#fff
```

### 1.2 Container Diagram (C4 Level 2)

All Docker containers, their ports, networks, and relationships.

```mermaid
graph TD
    HUMAN([Human Operator])

    subgraph compose["Docker Compose Infrastructure (always running)"]
        direction TB

        subgraph infra["Core Services"]
            GW["Gateway :8080<br/>Policy Engine + Egress Proxy<br/>+ Inbound Gate + Scheduler<br/>512MB / 0.5 CPU"]
            KM["Kubex Manager :8090<br/>FastAPI + Docker SDK<br/>256MB / 0.25 CPU"]
            KB["Kubex Broker :8060<br/>Redis Streams routing<br/>256MB / 0.25 CPU"]
            KR["Kubex Registry :8070<br/>Capability discovery<br/>128MB / 0.25 CPU"]
            REDIS[("Redis :6379<br/>db0-db4 partitioned<br/>512MB / 0.5 CPU")]
        end

        subgraph knowledge["Knowledge Layer"]
            NEO[("Neo4j :7687 / :7474<br/>Graph store<br/>1.5GB / 0.5 CPU")]
            GR["Graphiti :8100<br/>Temporal knowledge graph<br/>512MB / 0.25 CPU"]
            OS[("OpenSearch :9200<br/>Corpus + Logs<br/>~1.5GB / 0.5 CPU")]
        end

        subgraph monitoring["Monitoring (post-MVP)"]
            PROM["Prometheus :9090"]
            GRAF["Grafana :3001"]
            CADV["cAdvisor :8081"]
            FB["Fluent Bit<br/>(log shipper)"]
        end
    end

    subgraph agents["Kubex Manager — Agents (dynamic lifecycle)"]
        ORCH["Orchestrator Kubex<br/>claude-haiku-4-5 / claude-sonnet-4-6<br/>2GB / 1.0 CPU"]
        IS["Instagram Scraper Kubex<br/>claude-haiku-4-5 / claude-sonnet-4-6<br/>2GB / 1.0 CPU"]
        REV["Reviewer Kubex<br/>openai-codex<br/>2GB / 1.0 CPU"]
    end

    HUMAN -->|"tasks + approvals"| GW
    KM -->|"creates + manages<br/>(Docker SDK)"| ORCH & IS & REV
    ORCH & IS & REV -->|"ActionRequest"| GW
    GW -->|"egress proxy"| INTERNET([External APIs])

    ORCH & IS -->|"dispatch_task /<br/>report_result"| KB
    KB --> REDIS
    GW -->|"rate limits (db1)<br/>budget (db4)"| REDIS
    KR -->|"capability cache (db2)"| REDIS
    KM -->|"lifecycle events (db3)"| REDIS
    KM -->|"register agents"| KR

    GW -->|"proxy knowledge queries"| GR
    GW -->|"proxy corpus queries"| OS
    GR --> NEO

    CADV -->|"container metrics"| PROM
    PROM --> GRAF
    FB -->|"ship logs"| OS

    style compose fill:#264653,stroke:#fff,color:#fff
    style agents fill:#1a1a2e,stroke:#e94560,color:#fff
    style infra fill:#1a3a4a,stroke:#fff,color:#fff
    style knowledge fill:#2d6a4f,stroke:#fff,color:#fff
    style monitoring fill:#4a4a4a,stroke:#999,color:#ccc
```

> Monitoring stack (Prometheus, Grafana, cAdvisor, Fluent Bit) is deferred to post-MVP. See BRAINSTORM.md Section 9.

---

## 2. Docker Network Topology

Three Docker networks enforce network-level isolation. Kubexes can ONLY reach the Gateway -- they cannot access data stores or the internet directly.

```mermaid
graph TD
    subgraph ext["kubex-external<br/>(internet access)"]
        INET["Internet<br/>Anthropic API, OpenAI API,<br/>Instagram API, SMTP"]
    end

    subgraph internal["kubex-internal<br/>(no external access)"]
        GW["Gateway :8080<br/>(dual-homed: internal + external + data)"]
        KM["Kubex Manager :8090<br/>(internal + data)"]
        KB["Kubex Broker :8060<br/>(internal + data)"]
        KR["Kubex Registry :8070<br/>(internal + data)"]
        K1["Orchestrator Kubex<br/>(internal ONLY)"]
        K2["Instagram Scraper Kubex<br/>(internal ONLY)"]
        K3["Reviewer Kubex<br/>(internal ONLY)"]
    end

    subgraph data["kubex-data<br/>(data stores — no Kubex access)"]
        REDIS["Redis :6379"]
        OS["OpenSearch :9200"]
        NEO["Neo4j :7687"]
        GR["Graphiti :8100"]
    end

    GW <-->|"egress proxy"| INET
    GW <--> REDIS
    GW <--> OS
    GW <--> GR
    KB <--> REDIS
    KM <--> REDIS
    KR <--> REDIS

    K1 -->|"ActionRequest"| GW
    K2 -->|"ActionRequest"| GW
    K3 -->|"ActionRequest"| GW
    K1 & K2 & K3 <-->|"dispatch_task /<br/>report_result"| KB

    GR --> NEO

    K1 -.-x|"BLOCKED"| REDIS
    K2 -.-x|"BLOCKED"| OS
    K3 -.-x|"BLOCKED"| INET

    style ext fill:#9b2226,stroke:#fff,color:#fff
    style internal fill:#264653,stroke:#fff,color:#fff
    style data fill:#2d6a4f,stroke:#fff,color:#fff
```

**Network membership summary:**

| Network | Members | Purpose |
|---------|---------|---------|
| `kubex-internal` | Gateway, Kubex Manager, Kubex Broker, Kubex Registry, ALL Kubexes | Agent communication. No external access. |
| `kubex-external` | Gateway ONLY | Internet access. Gateway is dual-homed. |
| `kubex-data` | Redis, OpenSearch, Neo4j, Graphiti, Gateway, Broker, Registry, Kubex Manager | Data stores. Kubexes cannot reach these directly. |

> See BRAINSTORM.md Section 13.8 (Docker Networking Topology).

---

## 3. Data Flow — ActionRequest Pipeline (Happy Path)

Full lifecycle of a request from human operator through Orchestrator dispatch to Instagram Scraper execution and result return.

```mermaid
sequenceDiagram
    actor Human
    participant CC as CC<br/>Command Center
    participant KM as KM<br/>Kubex Manager
    participant ORCH as ORCH<br/>Orchestrator
    participant GW as GW<br/>Gateway
    participant KR as REG<br/>Registry
    participant KB as KB<br/>Broker
    participant IS as IS<br/>Scraper
    participant IG as Instagram API

    Note over Human,IG: Phase 1 — Task Submission

    Human->>CC: "Scrape Nike's Instagram, last 30 days"
    CC->>KM: Start MVP task
    KM->>ORCH: Deliver task to Orchestrator

    Note over ORCH: Shape 1: ActionRequest<br/>{ action: dispatch_task,<br/>  capability: "scrape_instagram",<br/>  context_message: "Scrape Nike..." }

    Note over Human,IG: Phase 2 — Orchestrator Dispatches to Scraper

    ORCH->>GW: ActionRequest { action: dispatch_task, capability: scrape_instagram }
    GW->>GW: Resolve identity via Docker labels (source IP lookup)

    Note over GW: Shape 2: GatekeeperEnvelope<br/>{ request: ...ActionRequest...,<br/>  enrichment: { boundary: "default",<br/>    model: "claude-haiku-4-5" },<br/>  evaluation: { decision: "ALLOW" } }

    GW->>GW: Policy Engine: dispatch_task in allowlist? YES
    GW-->>ORCH: ALLOW

    ORCH->>KB: dispatch_task { capability: scrape_instagram, context: "Scrape Nike..." }
    KB->>KR: Resolve capability "scrape_instagram"
    KR-->>KB: instagram-scraper (status: available)

    Note over KB: Shape 3: RoutedEnvelope<br/>{ target: "instagram-scraper",<br/>  stream: "boundary:default" }

    Note over IS: Shape 4: TaskDelivery<br/>{ task_id, capability,<br/>  context_message, from: "orchestrator" }

    KB->>IS: TaskDelivery { task_id: "task-42", capability: "scrape_instagram", from: "orchestrator" }

    Note over Human,IG: Phase 3 — Scraper Executes (egress through Gateway)

    IS->>GW: ActionRequest { action: http_get, target: "graph.instagram.com/nike/media" }
    GW->>GW: Egress allowlist: instagram.com OK
    GW->>GW: Action allowlist: http_get OK
    GW->>GW: Budget check: OK
    GW->>IG: Proxied HTTP GET (Gateway injects no API key — public API)
    IG-->>GW: 200 OK (JSON: posts data)
    GW->>GW: Log: request, response size, latency
    GW-->>IS: Proxied response

    Note over Human,IG: Phase 4 — Scraper Stores Knowledge

    IS->>GW: ActionRequest { action: store_knowledge, content: "Nike findings..." }
    GW->>GW: Policy: store_knowledge in allowlist? YES
    GW->>GW: Step 1: Index document in OpenSearch corpus
    GW->>GW: Step 2: Call Graphiti POST /episodes with document_id
    GW-->>IS: ALLOW (knowledge stored)

    Note over Human,IG: Phase 5 — Result Returns Through Chain

    IS->>KB: report_result { task_id: "task-42", status: success, result: { posts: [...] } }
    KB->>ORCH: Forward result to Orchestrator
    ORCH->>Human: "Scrape complete. 47 posts found."
```

> See BRAINSTORM.md Section 16.2 for canonical schema definitions. See MVP.md Section 5 for data shapes.

---

## 4. Data Flow — Denied Request

What happens when the Policy Engine DENIES a request that violates the Kubex's policy.

```mermaid
sequenceDiagram
    actor Human
    participant IS as IS<br/>Scraper
    participant GW as GW<br/>Gateway
    participant LOG as Audit Log

    Note over IS: Scraper attempts a blocked action<br/>(http_post is not in its allowlist)

    IS->>GW: ActionRequest { action: http_post, target: "instagram.com/api/v1/likes" }
    GW->>GW: Resolve identity: instagram-scraper (Docker label lookup)

    GW->>GW: Policy Engine evaluates:<br/>1. Global policy: http_post not globally blocked? PASS<br/>2. Kubex policy: http_post in allowed actions? NO → DENY

    Note over GW: GatekeeperEnvelope<br/>{ evaluation: {<br/>    decision: "DENY",<br/>    rule_matched: "action_allowlist:blocked",<br/>    reason: "http_post not in allowed actions<br/>    for instagram-scraper" } }

    GW->>LOG: Log denial (agent_id, action, rule_matched, timestamp)
    GW-->>IS: ActionResponse { decision: DENY, reason: "http_post not in allowed actions" }

    Note over IS: Scraper handles denial gracefully.<br/>Continues with allowed actions only.

    Note over GW: Gateway tracks denial rate.<br/>High denial rate triggers anomaly alert.
```

**Other denial scenarios follow the same pattern:**

| Scenario | Policy Check That Fails | Example |
|----------|------------------------|---------|
| Blocked egress domain | Egress allowlist | Scraper requests `api.twitter.com` (not in allowlist) |
| Blocked HTTP method | Egress method filter | Scraper sends POST to `instagram.com` (only GET allowed) |
| Budget exceeded | Per-task token limit | Scraper exceeds 10,000 token limit |
| Rate limit hit | Per-action rate limit | Scraper exceeds 100 http_get calls per task |
| Blocked URL path | Egress blocked paths | Scraper requests `instagram.com/accounts/login` |

> See MVP.md Section 6.2 for policy cascade. See BRAINSTORM.md Section 13.3 for rule categories.

---

## 5. Data Flow — Human Escalation (HITL)

What happens when the Policy Engine escalates a high-risk action to human approval.

```mermaid
sequenceDiagram
    actor Human
    participant CC as CC<br/>Command Center
    participant ORCH as ORCH<br/>Orchestrator
    participant GW as GW<br/>Gateway
    participant LOG as Audit Log
    participant SMTP as SMTP Server

    Note over ORCH: Orchestrator wants to send email<br/>(High tier action — always escalates)

    ORCH->>GW: ActionRequest { action: send_email, target: "user@example.com",<br/>parameters: { subject: "Nike Report", body: "..." } }

    GW->>GW: Resolve identity: orchestrator
    GW->>GW: Policy Engine evaluates:<br/>1. Global: send_email not globally blocked? PASS<br/>2. Kubex policy: send_email → tier HIGH → ESCALATE

    Note over GW: GatekeeperEnvelope<br/>{ evaluation: {<br/>    decision: "ESCALATE",<br/>    tier: "high",<br/>    reason: "send_email requires human approval" } }

    GW->>LOG: Log escalation event
    GW->>CC: Escalation notification (SSE / webhook)

    Note over CC: Human sees approval request with:<br/>- Who: orchestrator<br/>- What: send_email to user@example.com<br/>- Why: workflow context<br/>- Risk: agent behavioral context,<br/>  denial history, anomaly flags

    CC->>Human: Display approval request

    alt Human Approves
        Human->>CC: APPROVE
        CC->>GW: Approval decision
        GW->>LOG: Log approval (approver, timestamp)
        GW->>SMTP: Proxied SMTP send (Gateway injects SMTP creds)
        SMTP-->>GW: 250 OK
        GW-->>ORCH: ActionResponse { decision: ALLOW, result: "email sent" }
    else Human Denies
        Human->>CC: DENY (reason: "Not ready to send yet")
        CC->>GW: Denial decision
        GW->>LOG: Log denial (denier, reason, timestamp)
        GW-->>ORCH: ActionResponse { decision: DENY, reason: "Human denied: Not ready to send yet" }
    end

    Note over ORCH: Orchestrator handles result<br/>and continues workflow.
```

**Approval tiers (from BRAINSTORM.md Section 2):**

| Tier | Example | Approved By |
|------|---------|-------------|
| Low | Read a file the agent has access to | Auto-approved by Policy Engine |
| Medium | Send email to known contact | Reviewer LLM (post-MVP) |
| High | Send email to new external address | Human approval |
| Critical | Access credentials, bulk operations | Human + 2nd human |

> Note: For MVP, the Reviewer LLM escalation path is simplified. The Policy Engine handles all decisions deterministically. Human escalation is via CLI/API, not a full UI. See MVP.md Section 13 (deferred items).

---

## 6. Kubex Lifecycle

Full lifecycle of a Kubex container from creation to shutdown.

```mermaid
sequenceDiagram
    participant KM as KM<br/>Kubex Manager
    participant DOCKER as Docker Engine
    participant KUBEX as Kubex Container
    participant KR as REG<br/>Registry
    participant KB as KB<br/>Broker
    participant GW as GW<br/>Gateway
    participant REDIS as Redis (db3)

    Note over KM,REDIS: Phase 1 — Creation

    KM->>DOCKER: docker create<br/>image: kubex-base<br/>labels: kubex.agent_id=instagram-scraper,<br/>  kubex.boundary=default<br/>networks: [kubex-internal]<br/>limits: 2GB RAM, 1.0 CPU
    DOCKER-->>KM: Container created (id: abc123)

    KM->>DOCKER: Bind-mount secrets at /run/secrets/ (read-only)
    KM->>REDIS: Publish lifecycle event: CREATED

    Note over KM,REDIS: Phase 2 — Startup

    KM->>DOCKER: docker start abc123
    DOCKER->>KUBEX: Start container

    Note over KUBEX: entrypoint.sh executes:<br/>1. OpenClaw init<br/>2. Load skills from config.yaml<br/>3. Load implicit skills<br/>   (model_selector, knowledge)<br/>4. Start health check endpoint

    KUBEX->>KUBEX: Health check: /health returns 200

    KM->>KR: Register agent:<br/>{ agent_id: "instagram-scraper",<br/>  capabilities: ["scrape_instagram"],<br/>  status: "available",<br/>  accepts_from: ["orchestrator"],<br/>  boundary: "default" }
    KM->>REDIS: Publish lifecycle event: STARTED

    Note over KM,REDIS: Phase 3 — Normal Operation

    KB->>KUBEX: TaskDelivery (from Broker queue)
    KUBEX->>GW: ActionRequest { action: http_get, ... }
    GW-->>KUBEX: Proxied response
    KUBEX->>KB: report_result { status: success, ... }

    Note over KM,REDIS: Phase 4 — Shutdown (graceful)

    KM->>DOCKER: docker stop abc123 (SIGTERM)
    DOCKER->>KUBEX: SIGTERM signal

    KUBEX->>KUBEX: Stop consuming new tasks from Broker
    KUBEX->>KUBEX: Complete current task (if any)
    KUBEX->>KB: report_result (final result)
    KUBEX->>KUBEX: Cleanup and exit(0)

    KM->>KR: Update status: "stopped"
    KM->>REDIS: Publish lifecycle event: STOPPED
    KM->>KM: Cleanup bind-mounted secret files
```

**Kubex status transitions:**

```mermaid
stateDiagram-v2
    [*] --> Created: KM creates container
    Created --> Starting: docker start
    Starting --> Available: health check passes
    Available --> Busy: queue full
    Busy --> Available: queue drains
    Available --> Stopping: SIGTERM
    Busy --> Stopping: SIGTERM
    Stopping --> Stopped: exit(0)
    Available --> Disabled: admin action
    Stopped --> [*]
    Disabled --> Stopped: admin re-enable

    note right of Available: Registered in Registry\nConsuming tasks
    note right of Stopping: Completing current task\nNo new tasks accepted
    note right of Disabled: Maintenance or compromised\nCannot be activated
```

> See BRAINSTORM.md Section 6 (Kubex Registry status definitions), Section 13.8 (MVP deployment).

---

## 7. Knowledge Base Flow

### 7.1 Store Knowledge (Two-Step Ingestion)

```mermaid
sequenceDiagram
    participant IS as IS<br/>Scraper
    participant GW as GW<br/>Gateway
    participant OS as OpenSearch<br/>Corpus
    participant GR as Graphiti<br/>Knowledge Graph
    participant NEO as Neo4j
    participant LLM as LLM API<br/>(via Gateway)

    Note over IS: Agent calls memorize("Nike carousel posts<br/>outperform reels by 23%")

    IS->>GW: ActionRequest { action: store_knowledge,<br/>parameters: { content: "Nike carousel posts...",<br/>summary: "Nike engagement comparison",<br/>group: "shared" } }

    GW->>GW: Policy Engine: store_knowledge allowed? YES

    Note over GW,OS: Step 1 — Index document in corpus

    GW->>OS: POST /knowledge-corpus-shared-*/_doc<br/>{ content, summary, agent_id, timestamp, workflow_id }
    OS-->>GW: { document_id: "doc-789" }

    Note over GW,GR: Step 2 — Extract entities via Graphiti

    GW->>GR: POST /episodes<br/>{ content, group_id: "shared",<br/>  metadata: { source_id: "doc-789" } }

    GR->>LLM: Extract entities and relations<br/>(LLM call proxied through Gateway)
    LLM-->>GR: Entities: [Nike:Organization, Carousel:Concept, Reels:Concept]<br/>Relations: [Nike USES Carousel, Nike USES Reels]

    GR->>GR: Contradiction resolution<br/>(check existing facts, invalidate contradictions)
    GR->>NEO: Create/update nodes and temporal edges<br/>(valid_at, invalid_at, created_at, expired_at)
    NEO-->>GR: Stored

    GR-->>GW: Episode created (entities linked to doc-789)
    GW-->>IS: ActionResponse { decision: ALLOW, result: { document_id: "doc-789" } }
```

### 7.2 Query Knowledge (Graph Search + Corpus Follow-up)

```mermaid
sequenceDiagram
    participant ORCH as ORCH<br/>Orchestrator
    participant GW as GW<br/>Gateway
    participant GR as Graphiti<br/>Knowledge Graph
    participant NEO as Neo4j
    participant OS as OpenSearch<br/>Corpus

    Note over ORCH: Agent calls recall("What do we know about Nike's Instagram?")

    ORCH->>GW: ActionRequest { action: query_knowledge,<br/>parameters: { query: "Nike Instagram engagement",<br/>group: "shared" } }
    GW->>GW: Policy Engine: query_knowledge allowed? YES

    GW->>GR: POST /search<br/>{ query: "Nike Instagram engagement",<br/>  group_ids: ["shared"] }
    GR->>NEO: Graph search (entity + relation traversal)
    NEO-->>GR: Matching entities and edges

    GR-->>GW: Results: [<br/>  { entity: "Nike", type: "Organization",<br/>    relations: [...], source_id: "doc-789" },<br/>  { entity: "Carousel", type: "Concept",<br/>    relations: [...], source_id: "doc-789" }<br/>]

    GW-->>ORCH: ActionResponse { result: { entities: [...], source_ids: ["doc-789"] } }

    Note over ORCH: Agent wants full document context

    ORCH->>GW: ActionRequest { action: search_corpus,<br/>parameters: { document_id: "doc-789" } }
    GW->>GW: Policy Engine: search_corpus allowed? YES

    GW->>OS: GET /knowledge-corpus-shared-*/_doc/doc-789
    OS-->>GW: Full document content

    GW-->>ORCH: ActionResponse { result: { content: "Nike carousel posts outperform..." } }
```

**Knowledge base ontology (10 entity types, 12 relationship types):**

| Entity Types | Relationship Types |
|--------------|--------------------|
| Person, Organization, Product | OWNS, WORKS_FOR, USES |
| Platform, Concept, Event | PRODUCES, REFERENCES, RELATES_TO |
| Location, Document, Metric, Workflow | PART_OF, OCCURRED_AT, MEASURED_BY, PRECEDED_BY, COMPETES_WITH, DEPENDS_ON |

> See BRAINSTORM.md Section 27 for full knowledge base architecture. See MVP.md Section 8 for MVP scope.

---

## 8. Inter-Agent Communication — MVP User Story

**Scenario:** "Human asks: Scrape Nike's Instagram, analyze the content, and email me a summary."

> Note: `send_email` is blocked for the Orchestrator in MVP policy. For this diagram, we show it as an ESCALATE/HITL flow to demonstrate the full pipeline. In practice, email is a post-MVP capability.

```mermaid
sequenceDiagram
    actor Human
    participant CC as CC<br/>Command Center
    participant KM as KM<br/>Kubex Manager
    participant ORCH as ORCH<br/>Orchestrator
    participant GW as GW<br/>Gateway
    participant KR as REG<br/>Registry
    participant KB as KB<br/>Broker
    participant IS as IS<br/>Scraper
    participant REV as REV<br/>Reviewer
    participant IG as Instagram API
    participant GR as Graphiti
    participant OS as OpenSearch

    Note over Human,OS: Phase 1 — Task Submission
    Human->>CC: "Scrape Nike's IG, analyze content, email me summary"
    CC->>KM: Submit task
    KM->>ORCH: Deliver task

    Note over ORCH: Orchestrator plans:<br/>1. Dispatch scraping to web_scraping capability<br/>2. Dispatch analysis to content_review capability<br/>3. Send email summary

    Note over Human,OS: Phase 2 — Dispatch to Scraper
    ORCH->>GW: ActionRequest { action: dispatch_task, capability: "scrape_instagram" }
    GW->>GW: Identity: orchestrator. Policy: ALLOW
    GW-->>ORCH: ALLOW

    ORCH->>KB: dispatch_task { capability: "scrape_instagram", context: "Scrape Nike, last 30 days" }
    KB->>KR: Resolve "scrape_instagram" → instagram-scraper
    KB->>IS: TaskDelivery { task_id: "task-100", from: "orchestrator" }

    Note over Human,OS: Phase 3 — Scraper Executes
    IS->>GW: ActionRequest { action: http_get, target: "graph.instagram.com/nike" }
    GW->>GW: Egress: instagram.com OK. Action: http_get OK. Budget: OK
    GW->>IG: Proxied GET
    IG-->>GW: 200 OK (profile data)
    GW-->>IS: Proxied response

    IS->>GW: ActionRequest { action: http_get, target: "graph.instagram.com/nike/media?limit=50" }
    GW->>IG: Proxied GET
    IG-->>GW: 200 OK (posts JSON)
    GW-->>IS: Proxied response

    IS->>GW: ActionRequest { action: http_get, target: "graph.instagram.com/nike/media?after=cursor1" }
    GW->>IG: Proxied GET (pagination)
    IG-->>GW: 200 OK (more posts)
    GW-->>IS: Proxied response

    Note over Human,OS: Phase 4 — Scraper Stores Knowledge
    IS->>GW: ActionRequest { action: store_knowledge, content: "Nike 47 posts, carousel 23% higher..." }
    GW->>OS: Index document in corpus
    GW->>GR: POST /episodes (extract entities)
    GW-->>IS: ALLOW (document_id: doc-200)

    IS->>KB: report_result { task_id: "task-100", status: success, result: { posts_count: 47 } }
    KB->>ORCH: Forward result

    Note over Human,OS: Phase 5 — Dispatch to Reviewer
    ORCH->>GW: ActionRequest { action: dispatch_task, capability: "content_review" }
    GW->>GW: Policy: ALLOW
    GW-->>ORCH: ALLOW

    ORCH->>KB: dispatch_task { capability: "content_review", context: "Analyze Nike scrape data" }
    KB->>KR: Resolve "content_review" → reviewer
    KB->>REV: TaskDelivery { task_id: "task-101", from: "orchestrator" }

    Note over Human,OS: Phase 6 — Reviewer Queries Knowledge and Analyzes
    REV->>GW: ActionRequest { action: query_knowledge, query: "Nike Instagram" }
    GW->>GR: Search graph
    GR-->>GW: Entities + source_ids
    GW-->>REV: Knowledge results

    REV->>REV: Analyze content using OpenAI Codex (proxied through Gateway)
    REV->>KB: report_result { task_id: "task-101", status: success, result: { analysis: "..." } }
    KB->>ORCH: Forward analysis result

    Note over Human,OS: Phase 7 — Orchestrator Sends Email (ESCALATED)
    ORCH->>GW: ActionRequest { action: send_email, to: "human@company.com", subject: "Nike Report" }
    GW->>GW: Policy: send_email → tier HIGH → ESCALATE

    GW->>CC: Escalation notification
    CC->>Human: "Approve send_email to human@company.com?"
    Human->>CC: APPROVE
    CC->>GW: Approved

    GW->>GW: Proxy SMTP (inject credentials)
    GW-->>ORCH: ALLOW (email sent)

    Note over Human,OS: Phase 8 — Final Result
    ORCH->>Human: "Task complete. 47 posts scraped, analysis attached, email sent."
```

> See MVP.md Section 5.2 for the canonical MVP sequence. The email step above shows the HITL escalation path. In MVP, send_email is in the Orchestrator's blocked actions list, so this step would actually be denied unless policy is updated.

---

## 9. Security Architecture

### 9.1 Defense-in-Depth Layers

```mermaid
graph TD
    subgraph L1["Layer 1: Docker Network Isolation"]
        NET["3 networks: kubex-internal, kubex-external, kubex-data<br/>Kubexes ONLY on kubex-internal<br/>Zero direct internet or data store access"]
    end

    subgraph L2["Layer 2: Container Identity"]
        ID["Docker labels set by Kubex Manager at creation<br/>kubex.agent_id + kubex.boundary<br/>Gateway resolves via source IP → Docker API lookup<br/>Kubex-supplied agent_id is OVERWRITTEN"]
    end

    subgraph L3["Layer 3: Policy Engine"]
        POL["Deterministic rules — no AI, no LLM<br/>Global → Boundary → Per-Kubex (first-deny-wins)<br/>Action allowlist, egress allowlist, rate limits, budget"]
    end

    subgraph L4["Layer 4: Content Scanning (post-MVP)"]
        SCAN["Deterministic regex for known patterns<br/>LLM classifier for prompt injection detection<br/>Structured payloads only — no free-text between agents"]
    end

    subgraph L5["Layer 5: LLM API Key Isolation"]
        KEYS["Kubexes NEVER hold API keys<br/>Gateway injects keys per model allowlist<br/>Compromised Kubex cannot exfiltrate keys"]
    end

    subgraph L6["Layer 6: Anti-Collusion"]
        ANTI["Workers: Anthropic (Claude Haiku/Sonnet)<br/>Reviewer: OpenAI (Codex)<br/>Zero model overlap by design<br/>Workers receive only ALLOW/DENY — never reasoning"]
    end

    subgraph L7["Layer 7: Human-in-the-Loop"]
        HITL["High-risk actions always escalate to human<br/>Critical actions require 2 human approvals<br/>Approval queue with agent behavioral context"]
    end

    L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7

    style L1 fill:#264653,stroke:#fff,color:#fff
    style L2 fill:#2a4a5f,stroke:#fff,color:#fff
    style L3 fill:#2d6a4f,stroke:#fff,color:#fff
    style L4 fill:#4a7a5f,stroke:#fff,color:#fff
    style L5 fill:#e76f51,stroke:#fff,color:#fff
    style L6 fill:#c45a3c,stroke:#fff,color:#fff
    style L7 fill:#9b2226,stroke:#fff,color:#fff
```

### 9.2 Policy Cascade (First-Deny-Wins)

```mermaid
flowchart TD
    REQ["Incoming ActionRequest<br/>(identity resolved from Docker labels)"] --> G1

    G1{"Global Policy<br/>blocked_actions?<br/>max_chain_depth?"}
    G1 -->|"action in blocked list"| DENY1["DENY<br/>reason: globally blocked"]
    G1 -->|"pass"| B1

    B1{"Boundary Policy<br/>(default boundary for MVP)"}
    B1 -->|"boundary rule blocks"| DENY2["DENY<br/>reason: boundary policy"]
    B1 -->|"pass"| K1

    K1{"Kubex Policy<br/>action in allowed list?"}
    K1 -->|"action not in allowed_actions"| DENY3["DENY<br/>reason: action not allowed"]
    K1 -->|"pass"| E1

    E1{"Egress Check<br/>domain in allowlist?<br/>method allowed?<br/>path not blocked?"}
    E1 -->|"domain/method/path blocked"| DENY4["DENY<br/>reason: egress violation"]
    E1 -->|"pass or N/A"| R1

    R1{"Rate Limit Check<br/>(Redis db1)"}
    R1 -->|"rate exceeded"| DENY5["DENY<br/>reason: rate limit"]
    R1 -->|"pass"| BUD

    BUD{"Budget Check<br/>(Redis db4)<br/>per-task tokens?<br/>daily cost limit?"}
    BUD -->|"budget exceeded"| DENY6["DENY<br/>reason: budget exceeded"]
    BUD -->|"pass"| TIER

    TIER{"Tier Classification"}
    TIER -->|"low"| ALLOW["ALLOW<br/>Execute action"]
    TIER -->|"high / critical"| ESCALATE["ESCALATE<br/>Human approval required"]

    DENY1 & DENY2 & DENY3 & DENY4 & DENY5 & DENY6 --> LOG1["Audit Log<br/>(denial logged)"]
    ALLOW --> LOG2["Audit Log<br/>(approval logged)"]
    ESCALATE --> LOG3["Audit Log<br/>(escalation logged)"]

    style DENY1 fill:#9b2226,stroke:#fff,color:#fff
    style DENY2 fill:#9b2226,stroke:#fff,color:#fff
    style DENY3 fill:#9b2226,stroke:#fff,color:#fff
    style DENY4 fill:#9b2226,stroke:#fff,color:#fff
    style DENY5 fill:#9b2226,stroke:#fff,color:#fff
    style DENY6 fill:#9b2226,stroke:#fff,color:#fff
    style ALLOW fill:#2a9d8f,stroke:#fff,color:#fff
    style ESCALATE fill:#e76f51,stroke:#fff,color:#fff
```

> See BRAINSTORM.md Section 2 (approval tiers), Section 13.3 (rule categories), Section 13.9 (unified Gateway). See MVP.md Section 6.2 for MVP policy cascade.

---

## 10. Redis Database Layout

Single Redis instance with 5 logical databases, partitioned by purpose.

```mermaid
graph LR
    subgraph REDIS["Redis :6379 — Single Instance (512MB)"]
        direction TB
        DB0["db0: Broker Message Streams<br/>Persistence: AOF<br/>Critical — message loss = dropped tasks"]
        DB1["db1: Gateway Rate Limit Counters<br/>Persistence: None (ephemeral)<br/>Rebuilds on restart"]
        DB2["db2: Registry Capability Cache<br/>Persistence: None (ephemeral)<br/>Rebuilds from Registry"]
        DB3["db3: Kubex Manager Lifecycle Events<br/>Persistence: AOF<br/>Important for audit trail"]
        DB4["db4: Gateway Budget Tracking<br/>Persistence: RDB (periodic snapshots)<br/>Per-task token counts, daily cost"]
    end

    KB["Kubex Broker"] -->|"XADD / XREADGROUP"| DB0
    GW_RL["Gateway<br/>(rate limiter)"] -->|"INCR / EXPIRE"| DB1
    KR["Kubex Registry"] -->|"GET / SET"| DB2
    KM["Kubex Manager"] -->|"XADD"| DB3
    GW_BUD["Gateway<br/>(budget tracker)"] -->|"INCRBY / GET"| DB4

    style REDIS fill:#264653,stroke:#fff,color:#fff
    style DB0 fill:#9b2226,stroke:#fff,color:#fff
    style DB1 fill:#4a7a5f,stroke:#fff,color:#fff
    style DB2 fill:#4a7a5f,stroke:#fff,color:#fff
    style DB3 fill:#e76f51,stroke:#fff,color:#fff
    style DB4 fill:#2d6a4f,stroke:#fff,color:#fff
```

> See MVP.md Section 9 for full Redis database assignments. Post-MVP consideration: split into two Redis instances if memory pressure arises (persistent: db0/db3/db4, ephemeral: db1/db2).

---

## 11. Startup Sequence

Docker Compose startup order with health check dependencies.

```mermaid
sequenceDiagram
    participant REDIS as Redis :6379
    participant OS as OpenSearch :9200
    participant NEO as Neo4j :7687
    participant KR as REG<br/>Registry :8070
    participant GW as GW<br/>Gateway :8080
    participant GR as Graphiti :8100
    participant KB as KB<br/>Broker
    participant KM as KM<br/>Manager :8090
    participant AGENTS as Agents<br/>(ORCH, IS, REV)

    Note over REDIS,AGENTS: Tier 1 — No dependencies

    REDIS->>REDIS: Start (redis-cli ping)
    OS->>OS: Start (curl /_cluster/health)
    NEO->>NEO: Start (cypher-shell RETURN 1)

    Note over REDIS,AGENTS: Tier 2 — Depends on Redis (healthy)

    REDIS-->>KR: healthy
    KR->>KR: Start (curl /health)

    Note over REDIS,AGENTS: Tier 3 — Depends on Redis (healthy) + Registry (started)

    REDIS-->>GW: healthy
    KR-->>GW: started
    GW->>GW: Start, load policies (curl /health)

    Note over REDIS,AGENTS: Tier 4 — Depends on Neo4j (healthy) + Gateway (started)

    NEO-->>GR: healthy
    GW-->>GR: started
    GR->>GR: Start (LLM calls via Gateway proxy)

    Note over REDIS,AGENTS: Tier 5 — Depends on Redis (healthy)

    REDIS-->>KB: healthy
    KB->>KB: Start (curl /health)

    Note over REDIS,AGENTS: Tier 6 — Depends on Redis + Registry + Gateway (all healthy/started)

    REDIS-->>KM: healthy
    KR-->>KM: started
    GW-->>KM: healthy
    KM->>KM: Start (curl /health)

    Note over REDIS,AGENTS: Tier 7 — Kubex Manager creates agents dynamically

    KM->>AGENTS: Create + start Orchestrator container
    KM->>AGENTS: Create + start Instagram Scraper container
    KM->>AGENTS: Create + start Reviewer container
    KM->>KR: Register all 3 agents in Registry

    Note over REDIS,AGENTS: System ready for tasks
```

**Startup dependency graph:**

```mermaid
graph LR
    REDIS["Redis"] --> KR["Registry"]
    REDIS --> GW["Gateway"]
    REDIS --> KB["Broker"]
    REDIS --> KM["Kubex Manager"]

    KR --> GW
    KR --> KM

    GW --> KM
    GW --> GR["Graphiti"]

    OS["OpenSearch"] -.->|"no startup dep<br/>(used at runtime)"| GW
    NEO["Neo4j"] --> GR

    KM -->|"dynamic creation"| ORCH["Orchestrator"]
    KM -->|"dynamic creation"| IS["Scraper"]
    KM -->|"dynamic creation"| REV["Reviewer"]

    style REDIS fill:#9b2226,stroke:#fff,color:#fff
    style GW fill:#264653,stroke:#fff,color:#fff
    style KM fill:#2d6a4f,stroke:#fff,color:#fff
```

> See MVP.md Section 11 for Docker Compose service definitions with `depends_on` and `condition` settings.

---

## 12. MVP Component Summary Table

| Component | Type | Port | Network(s) | Depends On | Managed By | RAM | CPU |
|-----------|------|------|------------|------------|------------|-----|-----|
| **Gateway** | Infrastructure | 8080 | internal, external, data | Redis (healthy), Registry (started) | Docker Compose | 512MB | 0.5 |
| **Kubex Manager** | Infrastructure | 8090 | internal, data | Redis (healthy), Registry (started), Gateway (healthy) | Docker Compose | 256MB | 0.25 |
| **Kubex Broker** | Infrastructure | 8060 | internal, data | Redis (healthy) | Docker Compose | 256MB | 0.25 |
| **Kubex Registry** | Infrastructure | 8070 | internal, data | Redis (healthy) | Docker Compose | 128MB | 0.25 |
| **Redis** | Data Store | 6379 | data | None | Docker Compose | 512MB | 0.5 |
| **Neo4j** | Knowledge | 7687, 7474 | data | None | Docker Compose | 1.5GB | 0.5 |
| **Graphiti** | Knowledge | 8100 | data | Neo4j (healthy), Gateway (started) | Docker Compose | 512MB | 0.25 |
| **OpenSearch** | Knowledge + Logs | 9200 | data | None | Docker Compose | ~1.5GB | 0.5 |
| **Prometheus** | Monitoring (post-MVP) | 9090 | internal | None | Docker Compose | TBD | TBD |
| **Grafana** | Monitoring (post-MVP) | 3001 | internal | Prometheus | Docker Compose | TBD | TBD |
| **cAdvisor** | Monitoring (post-MVP) | 8081 | internal | None | Docker Compose | TBD | TBD |
| **Fluent Bit** | Monitoring (post-MVP) | -- | internal, data | OpenSearch | Docker Compose | TBD | TBD |
| **Orchestrator** | Agent (Kubex) | -- | internal ONLY | Gateway, Broker, Registry | Kubex Manager | 2GB | 1.0 |
| **Instagram Scraper** | Agent (Kubex) | -- | internal ONLY | Gateway, Broker, Registry | Kubex Manager | 2GB | 1.0 |
| **Reviewer** | Agent (Kubex) | -- | internal ONLY | Gateway, Broker, Registry | Kubex Manager | 2GB | 1.0 |

**Total MVP footprint:** ~9.7GB RAM + ~1.5GB OpenSearch = ~11.2GB of 24GB Docker budget. Remaining headroom: ~12.8GB (room for 4-6 additional Kubexes).

**Agent model assignments (zero overlap enforced):**

| Agent | Provider | Models | Purpose |
|-------|----------|--------|---------|
| Orchestrator | Anthropic | claude-haiku-4-5 (default), claude-sonnet-4-6 (escalation) | Task planning and delegation |
| Instagram Scraper | Anthropic | claude-haiku-4-5 (default), claude-sonnet-4-6 (escalation) | Data extraction and structuring |
| Reviewer | OpenAI | codex (single tier) | Security review of ambiguous actions |

> See BRAINSTORM.md Section 13.8 for port assignment table. See MVP.md Section 10 for resource budget.
