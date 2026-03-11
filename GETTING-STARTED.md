# KubexClaw Getting Started Guide

## 1. What is KubexClaw?

KubexClaw is an Agent AI Pipeline -- infrastructure for deploying AI agents as autonomous "employees" that perform real work across company workflows. It is built on OpenClaw as the agent runtime with a **security-first design**: every agent is treated as an untrusted workload, runs inside its own Docker container (called a "Kubex"), and has every action gated through a deterministic Policy Engine before execution.

The system coordinates agents through a gateway/broker/registry architecture. An **Orchestrator** agent receives tasks from human operators and delegates subtasks to **Worker** agents (scrapers, analyzers, reviewers) via function calling. All inter-agent communication flows through the Gateway, which enforces policy, proxies LLM API calls (agents never hold API keys), and controls egress.

Key principles:
- **Least privilege** -- no agent gets more access than its task requires
- **Fail closed** -- if a security check cannot complete, the action is denied
- **Human-in-the-loop** -- high-risk or ambiguous actions escalate to a reviewer agent or human operator
- **Zero direct internet** -- all external traffic (including LLM calls) goes through the Gateway proxy

---

## 2. Architecture Overview

```mermaid
flowchart TD
    HUMAN([Human Operator]) -->|"kclaw.py ask / docker exec"| GW

    subgraph infra["Docker Compose -- Core Infrastructure"]
        GW["Gateway :8080\nPolicy Engine + LLM Proxy\n+ Egress Proxy"]
        BROKER["Broker :8060\nRedis Streams routing"]
        REG["Registry :8070\nCapability discovery"]
        KM["Kubex Manager :8090\nAgent lifecycle"]
        REDIS[("Redis :6379\ndb0 streams, db1 rate limits\ndb2 registry, db4 budget")]
    end

    subgraph knowledge["Knowledge Base"]
        NEO4J["Neo4j :7687\nGraph store"]
        GRAPHITI["Graphiti :8100\nTemporal knowledge graph"]
        OSEARCH["OpenSearch :9200\nCorpus + full-text search"]
    end

    subgraph agents["Agents (Docker containers)"]
        ORCH["Orchestrator\nFunction-calling tool loop\nCoordinates workers"]
        WORKER1["Instagram Scraper\nDomain-specific worker"]
        WORKER2["Knowledge Agent\nKnowledge read/write"]
        REVIEWER["Reviewer\nSecurity evaluation\no3-mini model"]
    end

    ORCH -->|"ActionRequest"| GW
    WORKER1 -->|"ActionRequest"| GW
    WORKER2 -->|"ActionRequest"| GW
    REVIEWER -->|"ActionRequest"| GW

    GW -->|"policy check"| GW
    GW -->|"dispatch"| BROKER
    GW -->|"LLM proxy\n(injects API keys)"| INTERNET([LLM Providers])
    GW -->|"egress proxy"| EXT([External APIs])
    GW -->|"knowledge queries"| GRAPHITI
    GW -->|"corpus search"| OSEARCH

    BROKER --> REDIS
    REG --> REDIS
    GRAPHITI --> NEO4J
    KM -->|"creates/manages"| agents

    style infra fill:#264653,stroke:#fff,color:#fff
    style knowledge fill:#2a4858,stroke:#fff,color:#fff
    style agents fill:#1a1a2e,stroke:#e94560,color:#fff
```

**Request flow:**
1. Operator submits a task via `kclaw.py ask` or the Gateway API
2. Gateway evaluates the action against the policy cascade (global -> boundary -> agent)
3. If ALLOW: task is dispatched to the Broker, which writes it to a Redis Stream
4. The Orchestrator polls the Broker, picks up the task, and uses function calling to coordinate workers
5. Workers consume their capability streams, call the LLM via the Gateway proxy, and store results
6. Results flow back through the Broker to the Orchestrator, then to the operator

---

## 3. Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| Docker | 24+ | With Docker Compose v2 (`docker compose`) |
| Python | 3.12+ | For running tests and the `kclaw.py` CLI |
| Git | 2.x | To clone the repository |
| LLM API Key | -- | OpenAI key required (GPT-5.2 default); Anthropic optional |

**Hardware recommendations:**
- 8 GB RAM minimum (the full stack with knowledge base uses ~6 GB)
- 4 CPU cores recommended

---

## 4. Quick Start

### 4.1 Clone the Repository

```bash
git clone <repo-url> kubexclaw
cd kubexclaw
```

### 4.2 Configure Environment Variables

Copy the example `.env` file and edit the values:

```bash
cp .env.example .env
```

Edit `.env` with your own passwords:

```ini
# Redis
REDIS_PASSWORD=your-strong-redis-password

# Neo4j
NEO4J_PASSWORD=your-strong-neo4j-password

# Kubex Manager API token (used by kclaw.py to manage agents)
MANAGER_TOKEN=your-manager-token

# Default LLM model for Graphiti knowledge graph
DEFAULT_LLM_MODEL=gpt-4o-mini
```

### 4.3 Create the LLM API Keys File

The Gateway proxies all LLM calls and injects API keys. Create the secrets file:

```bash
mkdir -p secrets
```

Create `secrets/llm-api-keys.json`:

```json
{
  "openai": {
    "api_key": "sk-your-openai-api-key"
  },
  "anthropic": {
    "api_key": "sk-ant-your-anthropic-api-key"
  }
}
```

At minimum, the OpenAI key is required (the default model is GPT-5.2). The Anthropic key is optional.

### 4.4 Build and Start

Start the full stack:

```bash
docker compose up -d --build
```

Or start only core infrastructure services (without knowledge base or agents):

```bash
python scripts/kclaw.py up
```

This starts: Redis, Gateway, Broker, Registry, and Kubex Manager.

### 4.5 Verify Health

Check that all services are running:

```bash
python scripts/kclaw.py status
```

You should see `[OK]` for Gateway, Registry, Kubex Manager, Broker, and Redis.

You can also check individual service health endpoints:

```bash
curl http://localhost:8080/health   # Gateway
curl http://localhost:8070/health   # Registry
curl http://localhost:8090/health   # Kubex Manager
```

### 4.6 Interact with the System

List registered agents:

```bash
python scripts/kclaw.py agents
```

Dispatch a task to the orchestrator:

```bash
python scripts/kclaw.py ask task_orchestration "Summarize the latest posts from @openai on Instagram"
```

The CLI will poll for the result and display it when complete (timeout: 60s).

---

## 5. Services Reference

| Service | Container Name | Port | Purpose | Health Endpoint |
|---|---|---|---|---|
| Gateway | kubexclaw-gateway | 8080 | Policy engine, LLM proxy, egress proxy, action routing | `GET /health` |
| Broker | kubexclaw-broker | 8060 (internal) | Redis Streams message routing between agents | `GET /health` |
| Registry | kubexclaw-registry | 8070 | Agent capability discovery | `GET /health` |
| Kubex Manager | kubexclaw-manager | 8090 | Agent container lifecycle management | `GET /health` |
| Redis | kubexclaw-redis | 6379 | State store (streams, rate limits, registry cache, budget) | `redis-cli ping` |
| Neo4j | kubexclaw-neo4j | 7474, 7687 | Graph database for knowledge base | `GET :7474` |
| Graphiti | kubexclaw-graphiti | 8100 | Temporal knowledge graph API | `GET /healthz` |
| OpenSearch | kubexclaw-opensearch | 9200 | Full-text search corpus | `GET /_cluster/health` |
| Orchestrator | kubexclaw-orchestrator | -- | Coordinates worker agents via function calling | -- |

**Network topology:**
- `kubex-internal` -- agents and core services communicate here
- `kubex-external` -- Gateway egress to the internet
- `kubex-data` -- data stores (Redis, Neo4j, OpenSearch)

---

## 6. Agent System

### How Agents Work

Agents are Docker containers running the **standalone harness** (`agents/_base/kubex_harness/standalone.py`). Each agent:

1. **Polls the Broker** for messages matching its capabilities (e.g., `scrape_instagram`)
2. **Calls the LLM** via the Gateway's OpenAI-compatible proxy (`/v1/proxy/openai/...`)
3. **Posts progress** updates back to the Gateway
4. **Stores results** in the Broker (Redis key `task:result:{task_id}`)
5. **Acknowledges** the message so it is not redelivered

Agents never hold API keys -- the Gateway injects them transparently.

### Agent Configuration

Each agent has a `config.yaml` defining its identity, capabilities, model, and policy:

```yaml
agent:
  id: "instagram-scraper"
  boundary: "default"

  prompt: |
    You are an Instagram data collection agent...

  capabilities:
    - "scrape_instagram"
    - "extract_metrics"

  models:
    allowed:
      - id: "gpt-5.2"
        provider: "openai"
    default: "gpt-5.2"

  policy:
    allowed_actions:
      - "http_get"
      - "report_result"
    blocked_actions:
      - "http_post"
      - "execute_code"
    allowed_egress:
      - "instagram.com"

  budget:
    per_task_token_limit: 10000
    daily_cost_limit_usd: 1.00
```

### The Orchestrator

The Orchestrator is a special agent that uses **OpenAI function calling** to coordinate workers. It has 8 tools:

| Tool | Purpose |
|---|---|
| `dispatch_task` | Send a subtask to a worker by capability |
| `check_task_status` | Poll a task's status |
| `wait_for_result` | Block until a task completes |
| `cancel_task` | Cancel a running task |
| `list_agents` | List all registered agents |
| `query_registry` | Find agents with a specific capability |
| `query_knowledge` | Search the knowledge graph |
| `store_knowledge` | Persist findings to the knowledge graph |

### Skill Injection

Skills are `.md` files placed in `/app/skills/` inside an agent's container. The harness loads all `*.md` files from the skills directory and appends their content to the agent's system prompt. This allows adding capabilities without changing code.

---

## 7. Policy Engine

The Gateway's Policy Engine enforces security through a deterministic **first-deny-wins** cascade:

```mermaid
flowchart LR
    REQ["ActionRequest"] --> G["Global Policy\npolicies/global.yaml"]
    G -->|pass| B["Boundary Policy\nboundaries/*.yaml"]
    B -->|pass| A["Agent Policy\nagents/*/policies/policy.yaml"]
    A -->|pass| EGRESS["Egress Check\ndomain allowlist"]
    EGRESS -->|pass| BUDGET["Budget Check\ntoken + cost limits"]
    BUDGET -->|pass| ALLOW["ALLOW"]

    G -->|blocked| DENY["DENY"]
    B -->|blocked| DENY
    A -->|blocked| DENY
    EGRESS -->|blocked| DENY
    BUDGET -->|exceeded| DENY
    A -->|unknown action| ESCALATE["ESCALATE\nto Reviewer"]
```

### Policy Decisions

| Decision | Meaning |
|---|---|
| **ALLOW** | Action proceeds normally |
| **DENY** | Action is blocked with a 403 response |
| **ESCALATE** | Action is not explicitly allowed or blocked -- routed to the Reviewer agent for security evaluation |

### ESCALATE Flow

When an action is escalated:
1. Gateway dispatches a `security_review` task to the Reviewer agent via the Broker
2. Reviewer (running on a different model -- o3-mini -- for anti-collusion) evaluates the action
3. Reviewer returns ALLOW, DENY, or ESCALATE (to human)
4. If the reviewer does not respond within 30 seconds, the action is **denied** (fail closed)

### Policy File Locations

| Level | File | Scope |
|---|---|---|
| Global | `policies/global.yaml` | All agents -- blocked actions, chain depth limit, rate limits, budget defaults |
| Agent | `agents/<id>/policies/policy.yaml` | Per-agent -- allowed/blocked actions, egress rules, budget overrides |

---

## 8. Adding a New Agent

To add a new agent to the system:

### Step 1: Create the Agent Directory

```
agents/
  my-agent/
    config.yaml        # Agent configuration
    Dockerfile          # Container build instructions
    policies/
      policy.yaml      # Agent-specific policy rules
```

### Step 2: Write `config.yaml`

```yaml
agent:
  id: "my-agent"
  boundary: "default"

  prompt: |
    You are a specialized agent that does X. You receive task
    instructions and produce structured results.

  capabilities:
    - "my_capability"

  models:
    allowed:
      - id: "gpt-5.2"
        provider: "openai"
    default: "gpt-5.2"

  policy:
    allowed_actions:
      - "report_result"
      - "progress_update"
    blocked_actions:
      - "http_post"
      - "execute_code"

  budget:
    per_task_token_limit: 10000
    daily_cost_limit_usd: 1.00
```

### Step 3: Write the Dockerfile

Most agents use the base harness and need minimal Dockerfiles:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install the base harness
COPY agents/_base/ /app/
COPY libs/kubex-common/ /app/libs/kubex-common/
RUN pip install --no-cache-dir httpx

# Copy agent config
COPY agents/my-agent/config.yaml /app/config.yaml

# Optional: copy skills
COPY skills/ /app/skills/

CMD ["python", "-m", "kubex_harness.standalone"]
```

### Step 4: Add to `docker-compose.yml`

```yaml
  my-agent:
    build:
      context: .
      dockerfile: agents/my-agent/Dockerfile
    container_name: kubexclaw-my-agent
    labels:
      kubex.agent_id: "my-agent"
      kubex.boundary: "default"
    volumes:
      - ./agents/my-agent/config.yaml:/app/config.yaml:ro
    environment:
      - OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai
      - GATEWAY_URL=http://gateway:8080
      - BROKER_URL=http://kubex-broker:8060
      - REGISTRY_URL=http://kubex-registry:8070
      - KUBEX_AGENT_ID=my-agent
      - KUBEX_CAPABILITIES=my_capability
    networks:
      - kubex-internal
    depends_on:
      gateway:
        condition: service_healthy
```

### Step 5: Build and Register

```bash
docker compose up -d --build my-agent
python scripts/kclaw.py spawn my-agent
```

Or if the agent is in docker-compose, it will auto-start with `docker compose up -d`.

---

## 9. Development Workflow

All feature development follows the **red-green testing workflow** defined in the `implement-feature` skill (`skills/development/implement-feature/SKILL.md`):

```mermaid
flowchart LR
    A["Phase 1\nWrite Failing Tests"] --> B["Phase 2\nImplement Feature"]
    B --> C["Phase 3\nAll Tests Green"]
    C --> D["Phase 4\nCommit + Record"]
```

### The Cycle

1. **Red tests** -- Write tests for the expected behavior before any implementation. Tests should skip or xfail. Commit them separately.
2. **Implement** -- Write the minimum code to make the tests pass. Follow existing patterns.
3. **Green tests** -- Run the full test suite. All new tests must pass, all existing tests must still pass.
4. **Commit** -- Separate commits for tests and implementation.

### Running Tests

```bash
# Run all tests
python -m pytest tests/ -v

# Run specific test layer
python -m pytest tests/unit/ -v
python -m pytest tests/integration/ -v
python -m pytest tests/e2e/ -v

# Run with coverage
python -m pytest tests/ --cov=services --cov-report=term-missing
```

### Test Directory Structure

```
tests/
  unit/          # Isolated logic tests, mocked dependencies
  integration/   # Tests with real or faked services (fakeredis, TestClient)
  e2e/           # Full service flow tests
  chaos/         # Failure injection tests (nightly)
```

### Coverage Thresholds

| Module | Minimum |
|---|---|
| `kubex-common` | 90% |
| Gateway Policy Engine | 95% |
| Kubex Manager / Broker | 80% |

### Code Quality

- Python linting: `ruff`
- Formatting: `black`
- Type hints required on all public functions in `kubex-common`

---

## 10. CLI Reference (`kclaw.py`)

The `kclaw.py` script manages the KubexClaw stack from the command line. No external dependencies required (stdlib only).

| Command | Description |
|---|---|
| `python scripts/kclaw.py up` | Start core services (Redis, Gateway, Broker, Registry, Manager) |
| `python scripts/kclaw.py down` | Stop all services |
| `python scripts/kclaw.py status` | Health check all services and list running Kubexes |
| `python scripts/kclaw.py agents` | List all registered agents with capabilities and status |
| `python scripts/kclaw.py spawn <agent>` | Register agent in Registry, create Kubex via Manager, start it |
| `python scripts/kclaw.py kill <agent>` | Stop Kubex and deregister agent |
| `python scripts/kclaw.py ask <capability> "<message>"` | Dispatch a task by capability and poll for the result |
| `python scripts/kclaw.py result <task_id>` | Fetch a previously dispatched task's result |
| `python scripts/kclaw.py logs <agent>` | Tail logs for an agent's container |

### Examples

```bash
# Check system health
python scripts/kclaw.py status

# Register and start the Instagram scraper
python scripts/kclaw.py spawn instagram-scraper

# Send a task to any agent with the scrape_instagram capability
python scripts/kclaw.py ask scrape_instagram "Get the latest 10 posts from @openai"

# Check a task result later
python scripts/kclaw.py result task-a1b2c3d4e5f6

# View scraper logs
python scripts/kclaw.py logs instagram-scraper

# Stop the scraper
python scripts/kclaw.py kill instagram-scraper

# Shut down everything
python scripts/kclaw.py down
```

---

## 11. Troubleshooting

### Redis ACL / Authentication Errors

**Symptom:** Services fail to start with `NOAUTH Authentication required` or `ERR invalid password`.

**Fix:** Ensure `REDIS_PASSWORD` in `.env` matches what services expect. All services connect via `redis://default:${REDIS_PASSWORD}@redis:6379`.

### Broker is Internal-Only

**Symptom:** `kclaw.py status` shows Broker as unreachable.

**Explanation:** The Broker does not expose a host port -- it is only accessible on the `kubex-internal` Docker network. The status command checks it via `docker exec`. If the container is running, it is healthy.

### Agent Not Receiving Tasks

**Symptom:** `kclaw.py ask` dispatches a task but it times out.

**Checks:**
1. Is the agent registered? Run `python scripts/kclaw.py agents` and verify the agent appears with `running` status.
2. Does the agent's capability match? The `ask` command routes by capability name. Check the agent's `config.yaml` for its `capabilities` list.
3. Is the agent's consumer group matching? The Broker uses the capability name as the consumer group. The agent must be polling with `KUBEX_CAPABILITIES` set to include the target capability.
4. Check agent logs: `python scripts/kclaw.py logs <agent-name>`

### Docker Network Issues

**Symptom:** Agents cannot reach the Gateway or Broker.

**Fix:** Docker Compose prefixes network names with the project directory name. The default is `openclaw_kubex-internal`. If you renamed the project directory, update `KUBEX_DOCKER_NETWORK` in the Kubex Manager environment.

### Capability Registration

**Symptom:** `query_registry` returns no agents for a capability.

**Fix:** Agents must be registered in the Registry before they can receive tasks. Use `python scripts/kclaw.py spawn <agent>` to register, or register manually:

```bash
curl -X POST http://localhost:8070/agents \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent", "capabilities": ["my_capability"], "status": "running", "boundary": "default"}'
```

### LLM Proxy Errors

**Symptom:** Agents fail with `LLM returned 4xx` or `ProxyError`.

**Checks:**
1. Verify `secrets/llm-api-keys.json` exists and contains valid API keys.
2. Check the Gateway logs: `docker logs kubexclaw-gateway --tail 50`
3. Ensure the agent's model is in its policy allowlist.

### Knowledge Base Not Available

**Symptom:** `query_knowledge` or `store_knowledge` return 502 errors.

**Explanation:** The knowledge base services (Neo4j, Graphiti, OpenSearch) are optional for basic operation. If they are not running, knowledge actions will fail but task dispatch and LLM calls still work. Start them with:

```bash
docker compose up -d neo4j graphiti opensearch
```

---

## 12. Project Structure

```
kubexclaw/
  agents/
    _base/                    # Shared agent harness (standalone.py)
    orchestrator/             # Orchestrator agent (function-calling loop)
    instagram-scraper/        # Instagram scraper worker
    knowledge/                # Knowledge base agent
    reviewer/                 # Security reviewer agent
  libs/
    kubex-common/             # Shared library (schemas, errors, logging)
  services/
    gateway/                  # Gateway service (policy, proxy, routing)
    broker/                   # Broker service (Redis Streams)
    registry/                 # Registry service (capability discovery)
    kubex-manager/            # Kubex Manager (container lifecycle)
  policies/
    global.yaml               # Global policy rules
  skills/                     # Skill .md files injected into agent prompts
  secrets/
    llm-api-keys.json         # LLM provider API keys (not committed)
  scripts/
    kclaw.py                  # CLI management tool
  tests/
    unit/                     # Unit tests
    integration/              # Integration tests
    e2e/                      # End-to-end tests
    chaos/                    # Chaos/failure tests
  docker-compose.yml          # Full stack definition
  .env.example                # Environment variable template
```

---

## 13. Further Reading

- `KubexClaw.md` -- Project index with links to all architecture documentation
- `MVP.md` -- Full MVP specification with service details and API surface
- `docs/gateway.md` -- Detailed Gateway design (policy engine, LLM proxy, egress)
- `docs/broker.md` -- Broker design (Redis Streams, consumer groups, dead letter)
- `docs/knowledge-base.md` -- Knowledge base architecture (Graphiti + OpenSearch)
- `docs/agents.md` -- Agent roster, model strategy, config examples
- `docs/operations.md` -- Error handling, CI/CD, testing strategy, disaster recovery
- `skills/development/implement-feature/SKILL.md` -- Development workflow specification
