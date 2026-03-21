# Architecture Research

**Domain:** Agent infrastructure platform — MCP Bridge + CLI Runtime integration into KubexClaw
**Researched:** 2026-03-21
**Confidence:** HIGH (existing codebase fully read, design docs reviewed, official MCP SDK and Claude Agent SDK docs fetched live)

---

## System Overview

### Current State (v1.1)

```
External
  Command Center (:3001)
        │ HTTP
        ▼
  Gateway :8080
  (Policy engine + OpenAI proxy + task progress)
        │
  ┌─────┴──────┬───────────────────┐
  ▼            ▼                   ▼
Broker     Registry           Kubex Manager
:8060      :8070               :8050
Redis      Redis db2           Docker API
streams    agent registry
  │
  │ Consumer groups per capability
  ▼
Agent Containers (kubex-internal network)
  ┌──────────────────────────────────────────┐
  │ orchestrator  — standalone + custom loop │
  │ instagram-scraper  — standalone          │
  │ knowledge  — standalone                  │
  │ reviewer  — standalone                   │
  └──────────────────────────────────────────┘
```

### Target State (v1.2)

```
External
  Command Center (:3001)  [+ OAuth flow UI]
        │ HTTP
        ▼
  Gateway :8080
  (Policy engine + OpenAI proxy + task progress + OAuth token relay)
        │
  ┌─────┴──────┬───────────────────┐
  ▼            ▼                   ▼
Broker     Registry           Kubex Manager
:8060      :8070               :8050
Redis      Redis db2           Docker API
streams    + PUBLISH on        (unchanged)
           register/dereg.
  │
  │ Consumer groups per capability (unchanged)
  ▼
Agent Containers (kubex-internal network)
  ┌─────────────────────────────────────────────────────────────┐
  │ orchestrator  (harness_mode: mcp-bridge)                    │
  │                                                             │
  │  ┌─────────────────────┐     ┌─────────────────────────┐   │
  │  │ LLM Runtime         │ MCP │ MCPBridgeServer          │   │
  │  │ - openai-api        │◄───►│ - worker delegation      │   │
  │  │ - claude-code       │     │   tools (via Broker)     │   │
  │  │ - codex-cli         │     │ - vault direct tools     │   │
  │  │ - gemini-cli        │     │ - meta tools             │   │
  │  │                     │     │ - Registry pub/sub sub.  │   │
  │  └─────────────────────┘     └─────────────────────────┘   │
  └─────────────────────────────────────────────────────────────┘
  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐
  │ instagram-scraper│  │ knowledge        │  │ reviewer        │
  │ standalone       │  │ standalone       │  │ standalone      │
  └──────────────────┘  └──────────────────┘  └─────────────────┘
```

---

## Component Responsibilities

### Existing Components — v1.2 Changes

| Component | Current Responsibility | v1.2 Change |
|-----------|----------------------|-------------|
| Gateway | Policy enforcement, OpenAI proxy, task progress relay | Add OAuth token relay endpoint |
| Broker | Redis streams, task routing by capability, result storage | None |
| Registry `store.py` | Agent registration, capability resolution | Add `PUBLISH registry:agent_changed` on register/deregister |
| Kubex Manager | Docker container spawn, config/skill injection | None |
| Worker agents | Domain task execution via standalone loop | None — keep `harness_mode: standalone` |
| `standalone.py` | Poll Broker, call LLM, store result | Add `metadata.description` + `metadata.tools` to registration payload |
| `config_loader.py` | Load `AgentConfig` from `config.yaml` | Add `description`, `boundary`, `runtime` fields |
| `main.py` | Route by `harness_mode` | Add `mcp-bridge` route |

### New Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `MCPBridgeServer` | `agents/_base/kubex_harness/mcp_bridge.py` | FastMCP server exposing worker delegation tools, vault direct tools, meta-tools. Subscribes to Registry pub/sub for live tool discovery. |
| `CLIRuntime` | `agents/_base/kubex_harness/cli_runtime.py` | Subprocess supervisor for CLI agents (claude-code, codex-cli, gemini-cli). Credential gate at boot. Per-CLI spawn strategy. Failure detection. |
| `HooksConfigurator` | `agents/_base/kubex_harness/hooks_configurator.py` | Writes `.claude/settings.json` (or equivalent) inside the container before CLI spawn. Merges harness-required hooks with existing config idempotently. |
| `CredentialWatcher` | `agents/_base/kubex_harness/credential_watcher.py` | File-watches OAuth credential directories (e.g. `~/.claude/`). Signals CLIRuntime via `asyncio.Event` when credentials become valid or expire. |

---

## Architectural Patterns

### Pattern 1: Two-Axis Config Model (harness_mode + runtime)

The existing `harness_mode` controls the *task coordination model*. The new `runtime` field controls the *LLM invocation method*. These are orthogonal.

```
harness_mode: standalone   — poll Broker, call LLM directly, store result
harness_mode: mcp-bridge   — run MCPBridgeServer; LLM invoked via runtime field
harness_mode: openclaw     — existing PTY spawn of openclaw CLI (v1.0 legacy)

runtime: openai-api        — HTTP call to OpenAI-compatible endpoint (current default)
runtime: anthropic-api     — HTTP call to Anthropic API directly
runtime: claude-code       — Claude Agent SDK spawns claude CLI subprocess
runtime: codex-cli         — raw subprocess + stdout parsing
runtime: gemini-cli        — raw subprocess + stdout parsing
```

**Valid combinations for v1.2:**
- Workers: `standalone` + `openai-api` (unchanged)
- Orchestrator (v1.2a): `mcp-bridge` + `openai-api` (MCP bridge, existing LLM)
- Orchestrator (v1.2b): `mcp-bridge` + `claude-code` (MCP bridge + CLI runtime)

**Invalid combinations:** `standalone` + `claude-code` is not supported — the standalone loop calls the LLM directly; CLI runtimes require the MCP bridge to provide tools. This must be validated at boot with a clear error.

---

### Pattern 2: MCPBridgeServer — In-Process MCP Server

The `MCPBridgeServer` runs a FastMCP server (wrapping the official `mcp` Python SDK) inside the orchestrator container. It exposes three categories of tools.

**Tool category 1 — Worker Delegation (one tool per registered agent):**
Each worker becomes one MCP tool with a `task` string parameter. The tool description comes from `agent.description` in the worker's `config.yaml`. The LLM calls `tools/call("engineer", {"task": "..."})`. The bridge dispatches via `POST /actions` to Gateway → Broker → worker, polls `GET /tasks/{id}/result`, and returns the result.

**Tool category 2 — Vault Direct (no worker LLM involved):**
`vault_create_note`, `vault_update_note`, `vault_search_notes`, `vault_get_note`, `vault_list_notes`, `vault_find_backlinks`. These call `vault_ops` functions in-process. No Broker dispatch, no worker LLM.

**Tool category 3 — Meta-tools:**
`kubex__list_agents`, `kubex__agent_status`, `kubex__cancel_task`. Thin HTTP wrappers over Registry and Broker endpoints.

**Live agent discovery via Registry pub/sub:**
Registry `store.py` publishes `registry:agent_changed` to Redis when agents register or deregister. MCPBridgeServer subscribes and invalidates its tool cache. It then sends `notifications/tools/list_changed` to the connected MCP client so the LLM fetches a fresh tool list.

**MCP transport selection by runtime:**
- `openai-api` runtime: FastMCP's in-memory (in-process) transport. `StandaloneAgent`-derived class connects as a FastMCP client directly. No network hop, no subprocess.
- `claude-code` runtime: FastMCP exposes stdio transport. Claude Agent SDK injects it via `ClaudeAgentOptions(mcp_servers={"kubex": {"command": "python", "args": ["-m", "kubex_mcp_server"]}})`.
- `codex-cli` / `gemini-cli`: FastMCP exposes streamable-HTTP on localhost. CLI configured with the MCP server URL via CLI-specific config files.

**Concurrent tool calls:**
LLM may call multiple worker tools in one response. MCPBridgeServer handles this with `asyncio.gather()` for parallel dispatch-and-poll.

**Example worker tool schema:**
```python
{
    "name": "engineer",
    "description": config.description,   # from config.yaml agent.description
    "inputSchema": {
        "type": "object",
        "properties": {
            "task": {
                "type": "string",
                "description": "Natural language task for the engineer agent"
            }
        },
        "required": ["task"]
    }
}
```

---

### Pattern 3: CLIRuntime — Subprocess Supervisor with Credential Gate

The `CLIRuntime` replaces the direct LLM API call when `runtime` is a CLI type.

**Key distinction between CLI runtimes:**

For `claude-code`: use the `claude-agent-sdk` Python package (`pip install claude-agent-sdk`). This SDK spawns the `claude` CLI as a subprocess and communicates via stdin/stdout JSON-lines (NDJSON). It provides structured message types, session management, Python-function hook callbacks, and MCP server injection. Do NOT use raw PTY for Claude Code — the SDK is the correct interface.

For `codex-cli` and `gemini-cli`: no equivalent Python SDK exists. Use `asyncio.create_subprocess_exec()` with stdout pipe. Parse output for structured results. If a PTY is required (CLI detects non-TTY and refuses to run), fall back to `ptyprocess.PtyProcess`.

**Credential gate at boot:**
```
CLIRuntime.start()
  1. check_credentials(runtime)
     - claude-code: ~/.claude/ directory, check token file freshness
     - codex-cli:   ~/.codex/ directory
     - gemini-cli:  ~/.gemini/ or ~/.config/gemini/
  2. If missing or expired:
     a. send request_user_input via Gateway HITL mechanism:
        "Authenticate Claude Code for agent {id}: docker exec -it kubexclaw-{id} claude login"
     b. CredentialWatcher.watch(credential_path)
     c. await credentials_ready_event (with configurable timeout)
  3. If valid: transition container state CREDENTIAL_WAIT → READY
     accept tasks
```

**Task execution (claude-code runtime via Agent SDK):**
```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt=task_text,
    options=ClaudeAgentOptions(
        mcp_servers={"kubex": mcp_server_spec},
        hooks={
            "PostToolUse": [HookMatcher(matcher="*", hooks=[progress_hook])],
            "Stop": [HookMatcher(matcher="*", hooks=[result_hook])],
        },
        permission_mode="acceptEdits",
    )
):
    if hasattr(message, "type") and message.type == "result":
        await store_result(message.result)
    else:
        await post_progress(str(message))
```

**Failure detection table:**

| Failure Pattern | Detection | Response |
|----------------|-----------|----------|
| Subscription / rate limit | CLI subprocess exits with specific error text | `task_failed`, `reason: subscription_limit_reached` |
| Auth expired | Subprocess exits with auth error pattern | Trigger HITL re-auth flow |
| CLI crash | Non-zero exit, unrecognized error | Retry once, then `task_failed` |
| CLI not installed | `FileNotFoundError` on subprocess start | `task_failed`, `reason: runtime_not_available` |

**Known risk — Claude Agent SDK env var inheritance bug:**
GitHub issue #573 in `anthropics/claude-agent-sdk-python`: the subprocess inherits `CLAUDECODE=1` from the parent, preventing SDK usage from within Claude Code hooks. The harness must unset this env var before spawning via `env=filtered_env` argument to `query()`.

---

### Pattern 4: Bidirectional MCP — Harness as Both Client and Server

When the orchestrator runs the `claude-code` CLI, the MCPBridgeServer serves tools in both directions:

1. **Outbound — CLI calls workers:** The CLI's LLM calls worker delegation tools via MCP → MCPBridgeServer dispatches to Broker → worker executes → result returned to LLM.

2. **Inbound via hooks — CLI reports results:** Hook scripts POST to the harness's HTTP endpoint on task completion. MCPBridgeServer also exposes `kubex__report_progress` and `kubex__report_result` as MCP tools the CLI can call directly.

**Why not hooks-only?**
Hooks are passive observation events. They fire at lifecycle points (PreToolUse, PostToolUse, Stop) and can observe or block behavior. But for the LLM to *call* workers, it needs MCP tools, not hooks. Hooks are additive observability on top of the MCP tool call mechanism.

**HooksConfigurator — writing `.claude/settings.json`:**
```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8099/hooks/stop",
        "timeout": 30
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8099/hooks/post-tool-use",
        "timeout": 10
      }]
    }]
  }
}
```

HooksConfigurator must merge (not overwrite) if `.claude/settings.json` already exists. Mark harness-managed hooks with a `_kubex_managed: true` field to identify them on future boots.

For Codex CLI (TOML config) and Gemini CLI (JSON config): HooksConfigurator writes the equivalent CLI-specific config files. Codex MCP is configured via `.codex/config.toml`; Gemini MCP via its JSON config.

---

### Pattern 5: Container Lifecycle State Machine

Each Kubex container tracks its state in Registry metadata. This enables the Gateway and Command Center to make decisions based on container state (e.g., reject tasks sent to CREDENTIAL_WAIT containers).

```
Container lifecycle:
  BOOTING → CREDENTIAL_WAIT → READY ↔ BUSY
                                        ↓
                                  FAILED | STOPPED

CLI lifecycle (within BUSY):
  CLI_STARTING → CLI_RUNNING → CLI_COMPLETING → CLI_DONE
                     ↓
               CLI_CANCELLED | CLI_FAILED
```

State transitions are published to Redis `lifecycle:{agent_id}` channel. The existing `_listen_for_cancel` Redis subscription pattern in `harness.py` can be reused.

---

## Data Flow

### API Runtime Mode (mcp-bridge + openai-api)

```
User message → Gateway → Broker → orchestrator container
                                        │
                    ┌───────────────────▼────────────────────┐
                    │ MCPBridgeServer (FastMCP in-process)    │
                    │                                         │
                    │  OpenAI LLM ◄──────── in-memory MCP ──►│
                    │  (via Gateway proxy)                    │
                    │         │ tools/call                    │
                    │  ┌──────▼────────────────────────────┐  │
                    │  │ Tool dispatch                      │  │
                    │  │  worker tool → Broker dispatch     │  │
                    │  │  vault tool  → in-process call     │  │
                    │  │  meta tool   → Registry/Broker     │  │
                    │  └───────────────────────────────────┘  │
                    └────────────────────────────────────────┘
                                    │ dispatch_task
                    Gateway → Broker → Worker container
                                    │ (standalone loop)
                    Broker ← result ┘
                       │
                    MCPBridgeServer ← poll result
                       │
                    LLM ← tool result
```

### CLI Runtime Mode (mcp-bridge + claude-code)

```
User message → Gateway → Broker → orchestrator container
                                        │
                    ┌───────────────────▼────────────────────┐
                    │ CLIRuntime (process supervisor)         │
                    │                                         │
                    │  1. CredentialWatcher confirms auth     │
                    │  2. HooksConfigurator writes settings   │
                    │  3. claude_agent_sdk.query() spawns     │
                    │     claude CLI subprocess               │
                    │     mcp_servers → MCPBridgeServer       │
                    │     hooks → progress + result callbacks │
                    │                                         │
                    │  ┌─────────────────────────────────┐   │
                    │  │ claude CLI subprocess            │   │
                    │  │ (stdin/stdout NDJSON via SDK)   │   │
                    │  │ ← MCP client → MCPBridgeServer  │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │ MCP tools/call        │
                    │  ┌──────────────▼──────────────────┐   │
                    │  │ MCPBridgeServer (stdio transport)│   │
                    │  └─────────────────────────────────┘   │
                    └────────────────────────────────────────┘
                            │ worker delegation → Broker → Worker
                            │ Stop hook → CLIRuntime.store_result()
```

### OAuth Provisioning Flow

```
Container boot (runtime: claude-code)
  1. harness reads config.yaml → runtime: "claude-code"
  2. CLIRuntime.check_credentials() → ~/.claude/ missing or expired
  3. CLIRuntime sends request_user_input via Gateway:
       "Authenticate Claude Code for agent orchestrator:
        docker exec -it kubexclaw-orchestrator claude login"
  4. CredentialWatcher watches ~/.claude/ (asyncio polling or inotify)
  5. User: docker exec -it → completes OAuth in browser
  6. CredentialWatcher detects valid token file
  7. credentials_ready_event.set()
  8. Container transitions: CREDENTIAL_WAIT → READY

Re-auth mid-session:
  1. claude CLI exits with auth error
  2. CLIRuntime matches auth failure pattern
  3. Sends request_user_input for re-auth
  4. If re-auth timeout exceeded: task_failed, reason: auth_expired
  5. If re-auth succeeds: resume task queue
```

---

## New vs Modified Files

### New Files

| File | What It Provides |
|------|-----------------|
| `agents/_base/kubex_harness/mcp_bridge.py` | `MCPBridgeServer` class. FastMCP server. Worker tools (dynamic from Registry). Vault tools (in-process). Meta tools. Redis pub/sub subscription for tool cache invalidation. Concurrent dispatch via `asyncio.gather()`. |
| `agents/_base/kubex_harness/cli_runtime.py` | `CLIRuntime` base + per-runtime strategies. `claude-code` via `claude-agent-sdk`. `codex-cli` and `gemini-cli` via `asyncio.create_subprocess_exec()`. Credential check at boot. Failure pattern detection. |
| `agents/_base/kubex_harness/hooks_configurator.py` | `HooksConfigurator`. Reads existing settings files. Merges harness hooks idempotently. Handles Claude (JSON), Codex (TOML), Gemini (JSON) config formats. |
| `agents/_base/kubex_harness/credential_watcher.py` | `CredentialWatcher`. Polls credential path (or uses `watchfiles` if available). Signals `asyncio.Event`. Handles per-runtime credential path mapping. |
| `tests/unit/test_mcp_bridge.py` | Unit tests for MCPBridgeServer |
| `tests/unit/test_cli_runtime.py` | Unit tests for CLIRuntime (subprocess mocked) |
| `tests/unit/test_hooks_configurator.py` | Unit tests for HooksConfigurator (file merge behavior) |
| `tests/integration/test_mcp_bridge_integration.py` | Integration tests: MCPBridgeServer with real Registry pub/sub |

### Modified Files

| File | What Changes |
|------|-------------|
| `agents/_base/kubex_harness/config_loader.py` | Add `description: str`, `boundary: str`, `runtime: str` to `AgentConfig`. Parse from YAML in `load_agent_config()`. |
| `agents/_base/kubex_harness/main.py` | Add `elif config.harness_mode == "mcp-bridge"` branch. Route to `MCPBridgeServer`. |
| `agents/_base/kubex_harness/standalone.py` | Include `metadata.description` and `metadata.tools` in `_register_in_registry()` payload. |
| `services/registry/registry/store.py` | Add `await redis_client.publish("registry:agent_changed", ...)` after `hset` in `register()` and after `hdel` in `deregister()`. |
| `agents/orchestrator/config.yaml` | Change `harness_mode: standalone` → `harness_mode: mcp-bridge`. Add `description` field. Add `runtime: openai-api` (initial). Remove skill `task-management` (replaced by MCP bridge). |
| `agents/*/config.yaml` (all workers) | Add `description` field (used as MCP tool description). |
| `agents/_base/pyproject.toml` | Add `mcp` and `fastmcp` as dependencies. Add `claude-agent-sdk` (optional, for claude-code runtime). |

---

## Integration Points

### Service-Level Integration

| Service | Integration Point | Trigger |
|---------|-------------------|---------|
| Registry | `PUBLISH registry:agent_changed` to Redis after register/deregister | New agent comes online; existing agent goes down |
| Gateway | New `/oauth/token` relay endpoint | Command Center OAuth web flow forwards token to container |
| Broker | No changes — MCPBridgeServer calls existing `/actions` and `/tasks/{id}/result` | Worker delegation tool execution |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| MCPBridgeServer ↔ LLM (openai-api) | FastMCP in-memory transport (no network) | Direct Python object connection within same asyncio loop |
| MCPBridgeServer ↔ claude CLI | FastMCP stdio transport | Agent SDK injects server via `mcp_servers={}` option at spawn |
| CLIRuntime ↔ MCPBridgeServer | Shared Python object reference | Same container process; bridge passed to runtime at construction |
| HooksConfigurator ↔ CLIRuntime | File write at spawn, then passive | Configurator called once before CLI spawn; reads existing file first |
| CredentialWatcher ↔ CLIRuntime | `asyncio.Event` | Watcher sets event; runtime awaits before accepting tasks |
| MCPBridgeServer ↔ Registry | Redis pub/sub `registry:agent_changed` | Subscription-based cache invalidation; no polling |

### Worker Agents — Zero Changes

Workers keep `harness_mode: standalone` and `runtime: openai-api`. They receive tasks from Broker, execute with their own LLM + tools, and store results. MCPBridgeServer is orchestrator-only infrastructure and communicates with workers only via the Broker — the existing path unchanged.

---

## Suggested Build Order

### Phase 1: MCP Bridge with API Runtime

**Goal:** Replace the orchestrator's custom 8-tool loop with MCPBridgeServer. Orchestrator still uses OpenAI API — no CLI runtime introduced yet. Validates the MCP coordination layer in isolation.

**Deliverables:**
1. Add `description`, `boundary`, `runtime` to `AgentConfig` + config_loader
2. Add `PUBLISH registry:agent_changed` to Registry `store.py`
3. Implement `MCPBridgeServer` (`mcp_bridge.py`)
4. Add `mcp-bridge` route in `main.py`
5. Update orchestrator `config.yaml`: `harness_mode: mcp-bridge`, add `description`
6. Update all worker `config.yaml` files: add `description`
7. Update `standalone.py`: include `metadata.description` + `metadata.tools` in registration
8. Unit tests + integration tests for MCPBridgeServer
9. All 789+ existing tests still pass

**Risk:** Medium. Replaces orchestrator's custom loop. Workers are completely unchanged. If MCPBridgeServer breaks, only the orchestrator is affected.

---

### Phase 2: CLI Runtime — Claude Code via Agent SDK

**Goal:** Orchestrator can run Claude Code as its LLM. The Agent SDK handles subprocess management.

**Deliverables:**
1. Add `claude-agent-sdk` to `pyproject.toml`
2. Implement `CLIRuntime` for `claude-code` using `claude_agent_sdk.query()`
3. Implement `CredentialWatcher` (file-watch `~/.claude/`)
4. Implement `HooksConfigurator` (writes `.claude/settings.json` with merge behavior)
5. Wire CLIRuntime into `MCPBridgeServer.run()` when `config.runtime == "claude-code"`
6. HITL credential gate using existing `request_user_input` action
7. Unit + integration tests
8. Test with `runtime: claude-code` in orchestrator `config.yaml`

**Risk:** Medium. Claude Agent SDK is stable and well-documented. The primary risk is the `CLAUDECODE=1` env var inheritance bug — must unset this in the subprocess environment.

---

### Phase 3: Bidirectional MCP

**Goal:** When Claude Code CLI runs, it can call worker delegation tools through MCPBridgeServer. This is the full integration: CLI as LLM, MCP bridge for orchestration.

**Deliverables:**
1. MCPBridgeServer exposes stdio transport (addition to in-memory)
2. CLIRuntime passes `mcp_servers={"kubex": {...}}` to Agent SDK options
3. MCPBridgeServer adds `kubex__report_result` tool (CLI can call to report final output as alternative to Stop hook)
4. HTTP hook listener on `localhost:8099` for hooks that call back
5. Integration test: `claude-code` runtime orchestrator delegates to worker via MCP

**Risk:** Low-Medium. MCPBridgeServer already exists from Phase 1. This phase wires the CLI to it.

---

### Phase 4: Codex CLI and Gemini CLI Runtimes

**Goal:** Extend CLIRuntime to support `codex-cli` and `gemini-cli` via raw subprocess.

**Deliverables:**
1. CLIRuntime strategy classes for codex and gemini (different credential paths, different config formats)
2. HooksConfigurator extended for Codex `.toml` and Gemini JSON
3. MCP injection for Codex (via `.codex/config.toml`) and Gemini (via JSON config)
4. Stdout parsers per CLI type

**Risk:** High. Codex and Gemini CLI hook and MCP specifications change frequently. Gemini CLI MCP support confirmed as of 2026 sources. Codex MCP confirmed via STDIO and HTTP transports. But both are less stable than Claude Code's integration surface. Treat Phase 4 as additive — failure here does not break Phase 1-3.

---

### Phase 5: OAuth Web Flow via Command Center

**Goal:** Replace `docker exec` OAuth flow with web-based flow in Command Center.

**Deliverables:**
1. Command Center OAuth UI (triggers auth, shows status)
2. Gateway `/oauth/token` relay endpoint
3. Kubex Manager passes token into container via env/secret at spawn
4. CredentialWatcher checks both file-based and environment-injected tokens

**Risk:** Low for infrastructure. Medium for Command Center frontend (new web UI work).

---

## Anti-Patterns

### Anti-Pattern 1: MCPBridgeServer as a Separate Service

**What people do:** Deploy the MCP bridge as its own container (sidecar or standalone service).

**Why it's wrong:** The bridge is not shared infrastructure — it is the orchestrator's LLM coordination layer. It holds per-orchestrator tool cache, Registry subscription, and in-flight task state. Running it separately adds network latency on every tool call, creates a new failure domain, and breaks security (tool calls would route outside the Gateway).

**Do this instead:** Run MCPBridgeServer in-process inside the orchestrator container. Use FastMCP's in-memory transport for API runtimes; expose stdio/HTTP only for CLI runtimes.

---

### Anti-Pattern 2: Making Workers MCP Servers

**What people do:** Give each worker container a FastMCP server so the orchestrator can call them directly via MCP.

**Why it's wrong:** Workers are already reachable via Broker. Making them MCP servers adds a new communication path that bypasses the Gateway policy engine. The Broker's capability-based routing provides load balancing, consumer group management, and policy gating — all lost if bypassed.

**Do this instead:** Workers remain Broker consumers. MCPBridgeServer translates MCP tool calls into Broker dispatch. Gateway + Broker remain the only path from orchestrator to workers.

---

### Anti-Pattern 3: Using Raw PTY to Spawn Claude Code CLI

**What people do:** Spawn `claude` as a PTY subprocess (like `harness.py` does for `openclaw`), parsing stdout for results.

**Why it's wrong:** Claude Code's terminal output uses color codes, progress indicators, and interactive prompts. Parsing raw PTY stdout is fragile and breaks with any CLI version update. The `claude-agent-sdk` Python package provides a stable, structured JSON-lines stream designed for programmatic use.

**Do this instead:** Use `claude_agent_sdk.query()` for the `claude-code` runtime. Only fall back to raw subprocess / PTY when no SDK exists (Codex, Gemini).

---

### Anti-Pattern 4: Adding harness_mode: claude-code

**What people do:** Add `harness_mode: claude-code` as a new harness mode variant.

**Why it's wrong:** `harness_mode` controls the task coordination model (how the agent consumes tasks and manages its loop). The CLI is a LLM invocation method. These are orthogonal. An `mcp-bridge` orchestrator could use OpenAI API today and switch to Claude Code tomorrow — only the `runtime` field should change.

**Do this instead:** Keep `harness_mode` as the coordination model selector. Add `runtime` as the LLM invocation selector.

---

### Anti-Pattern 5: Overwriting Hook Config Without Merge

**What people do:** `HooksConfigurator` blindly writes `.claude/settings.json` on every boot, overwriting any operator-customized hooks.

**Why it's wrong:** Harness-managed hooks (for progress reporting) are mandatory infrastructure. Operator-added hooks (for project-specific behavior) should not be overwritten.

**Do this instead:** Read existing settings, deep-merge harness hooks into the existing structure, write the merged result. Mark harness-managed hooks with `_kubex_managed: true` so future boots can identify and update only managed entries.

---

## Scaling Considerations

This is internal agent infrastructure. Scaling is measured in simultaneous orchestrator containers.

| Scale | Architecture Consideration |
|-------|---------------------------|
| 1-5 orchestrators | Single MCPBridgeServer per container, current topology sufficient |
| 5-20 orchestrators | Redis pub/sub subscription noise increases — each bridge subscribes independently. Consider batched Registry notifications or a single notification fanout. |
| 20+ orchestrators | Per-bridge tool cache becomes stale independently. Consider a shared Registry event bus or short TTL with active polling as fallback. |

The more immediate bottleneck is Broker consumer group contention: multiple orchestrators dispatching to the same worker capability creates queue depth. This is a Broker concern, not an MCP Bridge concern.

---

## Sources

- [MCP Python SDK — official](https://github.com/modelcontextprotocol/python-sdk) — HIGH confidence
- [FastMCP client docs — in-process transport](https://gofastmcp.com/clients/client) — HIGH confidence
- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) — HIGH confidence, official Anthropic docs
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — HIGH confidence, 25 hook events, HTTP hook type confirmed
- [Claude Agent SDK hooks](https://platform.claude.com/docs/en/agent-sdk/hooks) — HIGH confidence, Python callback API confirmed
- [Claude Agent SDK bug #573 — CLAUDECODE=1 env inheritance](https://github.com/anthropics/claude-agent-sdk-python/issues/573) — MEDIUM confidence (open GitHub issue)
- Existing KubexClaw codebase read directly: `agents/_base/kubex_harness/`, `services/registry/registry/store.py`, `docs/design-mcp-bridge.md`, `docs/design-oauth-runtime.md` — HIGH confidence

---

*Architecture research for: KubexClaw v1.2 MCP Bridge + CLI Runtime*
*Researched: 2026-03-21*
