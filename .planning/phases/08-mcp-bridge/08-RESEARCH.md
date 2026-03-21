# Phase 8: MCP Bridge - Research

**Researched:** 2026-03-21
**Domain:** MCP protocol integration, Python MCP SDK (mcp[cli]>=1.26), FastMCP server, asyncio pub/sub, brownfield orchestrator replacement
**Confidence:** HIGH (all findings verified from pre-existing project research docs, official SDK, and direct codebase reads)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Vault reads (search, get, list, find_backlinks) are in-process direct calls — fast, no security concern
- **D-02:** Vault writes (create_note, update_note) route through Gateway POST /actions as vault_create / vault_update action types — same injection scan pipeline as all other actions
- **D-03:** Audit logging for writes only — reads are high-frequency and logging them adds noise
- **D-04:** Rejected vault writes trigger ESCALATE flow — human reviews flagged content and approves/denies, consistent with existing policy model
- **D-05:** Workers signal need_info via structured result status: `{status: "need_info", request: "natural language ask", data: {...}}` — uses existing result pipeline, orchestrator LLM interprets and re-delegates
- **D-06:** Need_info results include raw data — worker attaches the data it needs processed, orchestrator passes to next worker. Fewer round trips.
- **D-07:** Orchestrator tracks delegation depth with configurable max (default 3) to prevent infinite chains. Orchestrator LLM sees chain context.
- **D-08:** Workers register with description + tool metadata in registration payload — MCP bridge uses description as tool description, tool metadata for orchestrator LLM context
- **D-09:** Config switch migration — change orchestrator config.yaml `harness_mode` from "standalone" to "mcp-bridge". One restart. Rollback = change config back.
- **D-10:** Parity verification: run full E2E suite against both standalone and mcp-bridge modes. Both must pass identically.
- **D-11:** Old standalone orchestrator tool loop deleted at end of Phase 8, after parity passes. Clean cut.
- **D-12:** Workers stay on standalone mode for v1.2. All-MCP workers is a future milestone.
- **D-13:** Dual transport: in-memory for API mode (openai-api runtime — bridge and LLM client share same process), stdio for CLI mode (CLI agents connect as MCP clients)
- **D-14:** Both transports implemented in Phase 8 — stdio ready for Phase 9 CLI runtime without additional transport work

### Claude's Discretion

- MCP tool timeout values (research suggests 300s minimum)
- Exact asyncio.gather() implementation for concurrent dispatch
- Meta-tool response formats (kubex__list_agents, kubex__agent_status, kubex__cancel_task)
- Registry pub/sub message format and subscription lifecycle
- Error handling and retry behavior for failed dispatches

### Deferred Ideas (OUT OF SCOPE)

- **All-MCP workers** — Workers expose their domain tools as MCP servers, orchestrator connects to them directly instead of through Broker. Future milestone.
- **Worker "need_info" cross-Kubex collaboration** — Full protocol (response format, chain tracking, timeout behavior) may need refinement after real-world use.
- **SSE transport** — Not needed for v1.2 (in-memory + stdio covers both modes).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Orchestrator exposes one MCP tool per registered worker agent (capability = tool name, description from config.yaml) | MCPBridgeServer pattern: FastMCP `@mcp.tool()` registered dynamically from Registry; description from `agent.description` config field |
| MCP-02 | All worker delegations route through Gateway POST /actions — no policy bypass | Established pattern: all existing tools in standalone.py route via Gateway; bridge preserves this — MCP tool handler calls same POST /actions endpoint |
| MCP-03 | Async task_id dispatch pattern — tool call returns task_id immediately, kubex__poll_task checks status | Critical: prevents MCP bridge crash on long-running tasks (SDK Issue #212); tool handler dispatches to Broker and returns task_id; separate kubex__poll_task tool polls GET /tasks/{id}/result |
| MCP-04 | Vault tools exposed as in-process MCP tools with policy gate enforced (Gateway endpoint) | D-02 locked: vault writes go to Gateway POST /actions as vault_create/vault_update; reads are in-process direct calls; audit log created at Gateway for writes |
| MCP-05 | Tool cache invalidated on agent registration/deregistration via Registry pub/sub (registry:agent_changed) | store.py needs one `PUBLISH registry:agent_changed` after hset/hdel; MCPBridgeServer subscribes via asyncio Redis pub/sub; sends `notifications/tools/list_changed` to MCP client |
| MCP-06 | Old custom tool loop kept alive until MCP bridge passes full E2E parity against all existing tests | Parity gate: run existing 789-test suite with `harness_mode: mcp-bridge`; deletion is FINAL step; `harness_mode: standalone` path must remain callable during testing |
| MCP-07 | Concurrent worker dispatch via asyncio.gather() for parallel tool calls | MCPBridgeServer wraps parallel dispatch-and-poll calls in `asyncio.gather()`; each worker delegation is an independent coroutine |
| MCP-08 | Meta-tools: kubex__list_agents, kubex__agent_status, kubex__cancel_task | Thin HTTP wrappers over Registry GET /agents and Broker cancel endpoint; return structured JSON |
</phase_requirements>

---

## Summary

Phase 8 replaces the orchestrator's custom 8-tool OpenAI function-calling loop (in `standalone.py:StandaloneAgent._call_llm_with_tools()`) with a standard MCP Bridge server. The new `MCPBridgeServer` class runs in-process inside the orchestrator container, exposing three tool categories: (1) one worker delegation tool per registered agent (dispatches via Broker, returns task_id immediately), (2) vault direct tools (reads in-process, writes via Gateway), and (3) three meta-tools for agent introspection. Workers are completely untouched — they stay on `harness_mode: standalone`. The entire change is confined to the orchestrator's harness_mode config and the new `mcp_bridge.py` file plus small additions to `config_loader.py`, `main.py`, `standalone.py`, `store.py`, and four worker `config.yaml` files.

The most important design constraint is the async task_id dispatch pattern (MCP-03). The MCP Python SDK has a known production crash bug (Issue #212) where long-running tool calls trigger an uncaught `CancelledError` on timeout, killing the bridge process and orphaning all in-flight Broker tasks. The bridge must return a task_id immediately and expose a separate `kubex__poll_task` tool — no open connections waiting for worker results. This pattern must be implemented from day one, not retrofitted.

The parity gate (MCP-06 / D-10) is the second critical constraint. The old standalone tool loop code must not be deleted until the full 789-test suite passes against `harness_mode: mcp-bridge`. Both modes run in parallel during Phase 8; deletion of the old loop is the final commit, not the first.

**Primary recommendation:** Implement MCPBridgeServer in waves: (1) config changes + Registry pub/sub plumbing, (2) core bridge with worker delegation and poll tools, (3) vault tools with Gateway write routing, (4) meta-tools, (5) concurrent dispatch, (6) dual transport (in-memory + stdio), (7) parity verification + old loop deletion.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `mcp[cli]` | `>=1.26` | FastMCP server (decorator API for dynamic tool registration) + MCP ClientSession for in-memory transport | Official Anthropic SDK; v1.26.0 current stable; FastMCP 1.0 absorbed into this package; v2 pre-alpha — use v1.x |
| `redis` | `>=5.0` | Already in stack — pub/sub subscription for `registry:agent_changed` | Already installed in harness pyproject.toml |
| `httpx` | `>=0.27` | Already in stack — Gateway/Broker HTTP calls from bridge tool handlers | Already installed |
| `asyncio` | stdlib | asyncio.gather() for concurrent dispatch; async event loop for pub/sub listener | Already throughout codebase |

### New Dependencies (pyproject.toml delta)

```toml
dependencies = [
    "httpx>=0.27",      # existing
    "redis>=5.0",       # existing
    "mcp[cli]>=1.26",   # NEW — Phase 8
    "ptyprocess>=0.7",  # NEW — Phase 9 (add now per D-14 rationale, or defer to Phase 9)
]
```

Phase 8 only strictly requires `mcp[cli]>=1.26`. `ptyprocess` is Phase 9. Add both to avoid a second pyproject.toml change, or defer — planner's call.

**Installation:**
```bash
pip install "mcp[cli]>=1.26"
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `mcp[cli]>=1.26` (official SDK) | `fastmcp` 2.0 (separate project) | fastmcp 2.0 adds client proxying and routing not needed here; official SDK includes FastMCP 1.0 patterns already |
| In-memory transport | stdio or streamable-HTTP transport for openai-api mode | In-memory is zero-latency, no subprocess needed; stdio/streamable-HTTP needed for CLI runtimes (Phase 9) but not API mode |

---

## Architecture Patterns

### Recommended File Structure (new and modified)

```
agents/_base/kubex_harness/
├── mcp_bridge.py         # NEW — MCPBridgeServer class (Phase 8 primary deliverable)
├── main.py               # MODIFY — add mcp-bridge harness_mode routing branch
├── config_loader.py      # MODIFY — add description, boundary fields to AgentConfig
├── standalone.py         # MODIFY — add metadata.description + metadata.tools to registration
services/registry/registry/
└── store.py              # MODIFY — add PUBLISH registry:agent_changed on register/deregister
agents/orchestrator/
└── config.yaml           # MODIFY — harness_mode: mcp-bridge, add description, remove skills
agents/knowledge/
└── config.yaml           # MODIFY — add description field
agents/instagram-scraper/
└── config.yaml           # MODIFY — add description field
agents/reviewer/
└── config.yaml           # MODIFY — add description field
tests/unit/
└── test_mcp_bridge.py    # NEW — unit tests for MCPBridgeServer
tests/integration/
└── test_mcp_bridge_integration.py  # NEW — integration tests with real Registry pub/sub
```

### Pattern 1: MCPBridgeServer — In-Process FastMCP Server

**What:** A `FastMCP` server running inside the orchestrator container exposing three tool categories. Connects to the orchestrator LLM via in-memory transport (API mode) or stdio (CLI mode, Phase 9).

**When to use:** Always — this is the sole implementation when `harness_mode: mcp-bridge`.

**Example — dynamic tool registration from Registry:**
```python
# Source: mcp[cli]>=1.26 FastMCP API + design-mcp-bridge.md
from mcp.server.fastmcp import FastMCP

class MCPBridgeServer:
    def __init__(self, config: AgentConfig, http_client: httpx.AsyncClient) -> None:
        self.config = config
        self._http = http_client
        self._mcp = FastMCP(name="kubex-bridge")
        self._tool_cache: dict[str, AgentRegistration] = {}
        self._register_static_tools()  # vault + meta tools

    def _register_static_tools(self) -> None:
        """Register vault direct tools and meta-tools (static, always present)."""
        @self._mcp.tool()
        async def kubex__poll_task(task_id: str) -> dict:
            """Poll status of a previously dispatched worker task."""
            ...

        @self._mcp.tool()
        async def kubex__list_agents() -> list:
            """List all registered worker agents and their capabilities."""
            ...

        # vault_search_notes, vault_get_note, vault_list_notes, vault_find_backlinks
        # — in-process direct calls (D-01)

        # vault_create_note, vault_update_note
        # — route through Gateway POST /actions (D-02)

    async def refresh_worker_tools(self) -> None:
        """Fetch registered agents from Registry and update worker delegation tools."""
        resp = await self._http.get(f"{self.registry_url}/agents")
        agents = resp.json()
        for agent in agents:
            if agent["agent_id"] == self.config.agent_id:
                continue  # skip self
            self._register_worker_tool(agent)
        await self._mcp.server.request_context.session.send_tool_list_changed()
```

### Pattern 2: Async Task_id Dispatch (MCP-03 — Mandatory)

**What:** Worker delegation tool handlers return a task_id immediately. A separate `kubex__poll_task` tool checks status. Never hold a tool call open waiting for a result.

**When to use:** All worker delegation tools, always. This is the only safe design.

**Example:**
```python
# Source: design-mcp-bridge.md + PITFALLS.md (SDK Issue #212)
async def _make_worker_tool(self, agent_id: str, capability: str, description: str):
    @self._mcp.tool(name=capability, description=description)
    async def worker_delegate(task: str) -> dict:
        """Dispatch task to worker; return task_id for polling."""
        try:
            resp = await self._http.post(
                f"{self.config.gateway_url}/actions",
                json={
                    "agent_id": self.config.agent_id,
                    "action": "dispatch_task",
                    "parameters": {
                        "capability": capability,
                        "context_message": task,
                    },
                },
            )
            data = resp.json()
            return {"status": "dispatched", "task_id": data["task_id"]}
        except Exception as exc:
            # CRITICAL: never propagate exceptions — return structured error
            return {"status": "error", "message": str(exc)}

    return worker_delegate

async def _kubex__poll_task(self, task_id: str) -> dict:
    """Poll GET /tasks/{id}/result via Gateway."""
    try:
        resp = await self._http.get(
            f"{self.config.gateway_url}/tasks/{task_id}/result",
        )
        if resp.status_code == 404:
            return {"status": "pending", "task_id": task_id}
        if resp.status_code == 200:
            return {"status": "completed", **resp.json()}
        return {"status": "error", "code": resp.status_code}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}
```

### Pattern 3: Registry Pub/Sub for Live Tool Cache Invalidation (MCP-05)

**What:** Registry `store.py` publishes `registry:agent_changed` when agents register or deregister. MCPBridgeServer subscribes and rebuilds the worker tool list, then sends `notifications/tools/list_changed` to the MCP client.

**When to use:** Always running as background asyncio task from bridge startup.

**store.py addition (single line each):**
```python
# Source: services/registry/registry/store.py lines 79-91 (existing hset), 116 (existing hdel)
# In register() after hset:
await redis_client.publish("registry:agent_changed", registration.agent_id)

# In deregister() after hdel:
await redis_client.publish("registry:agent_changed", agent_id)
```

**Bridge subscription pattern:**
```python
# Source: redis>=5.0 pub/sub API
async def _listen_registry_changes(self) -> None:
    """Background task: subscribe to registry:agent_changed, refresh tool cache."""
    pubsub = self._redis_client.pubsub()
    await pubsub.subscribe("registry:agent_changed")
    async for message in pubsub.listen():
        if message["type"] == "message":
            await self.refresh_worker_tools()
            # Notify MCP client to re-fetch tool list
            # (FastMCP handles notifications/tools/list_changed internally)
```

### Pattern 4: MCP Transport Selection

**What:** In-memory transport for `openai-api` mode (bridge and OpenAI-calling loop share one process), stdio transport for CLI mode (Phase 9, `claude-code` runtime).

**Both transports implemented in Phase 8 per D-14.**

```python
# Source: design-mcp-bridge.md + ARCHITECTURE.md
# In-memory (API mode):
from mcp.server.fastmcp import FastMCP
# FastMCP in-memory: bridge and LLM client share the same asyncio loop
# No subprocess, no network hop — direct Python object connection

# stdio (CLI mode):
mcp.run(transport="stdio")
# Claude Code CLI connects as MCP client via claude_agent_sdk mcp_servers option
```

### Pattern 5: AgentConfig Extension

**What:** Add `description` and `boundary` fields to `AgentConfig`. `description` becomes the MCP tool description for this agent when registered. `boundary` is already in registration payloads but not in the Pydantic model.

```python
# Source: agents/_base/kubex_harness/config_loader.py (current model)
class AgentConfig(BaseModel):
    agent_id: str = ""
    description: str = ""        # NEW — becomes MCP worker delegation tool description
    boundary: str = "default"    # NEW — was hardcoded in standalone.py registration payload
    model: str = "gpt-5.2"
    skills: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    harness_mode: str = "standalone"
    gateway_url: str = "http://gateway:8080"
    broker_url: str = "http://kubex-broker:8060"
```

**load_agent_config() addition:**
```python
# In the return AgentConfig(...) block:
description=file_data.get("description", ""),
boundary=file_data.get("boundary", "default"),
```

### Pattern 6: main.py Routing Addition

**What:** Add `mcp-bridge` branch before the `else` error clause (currently at line 86).

```python
# Source: agents/_base/kubex_harness/main.py line 85 (existing else clause)
elif config.harness_mode == "mcp-bridge":
    from kubex_harness.mcp_bridge import MCPBridgeServer

    bridge = MCPBridgeServer(config)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, bridge.stop)

    await bridge.run()

else:
    logger.error(
        "Unknown harness_mode: %r — expected 'standalone', 'openclaw', or 'mcp-bridge'",
        config.harness_mode,
    )
    sys.exit(1)
```

### Pattern 7: standalone.py Registration Metadata Addition

**What:** Include `description` and `tools` in the registration payload so MCPBridgeServer can use them when building worker tool descriptions.

```python
# Source: agents/_base/kubex_harness/standalone.py _register_in_registry() line ~196
# Modify the json= payload:
json={
    "agent_id": self.config.agent_id,
    "capabilities": self.config.capabilities,
    "status": "running",
    "boundary": self.config.boundary,        # uses new config field
    "metadata": {
        "description": self.config.description,   # NEW
        "tools": self.tool_definitions,           # NEW — OpenAI format tool defs
    },
}
```

### Anti-Patterns to Avoid

- **Hold tool call open for result:** Do not `await broker_result()` inside a tool handler. MCP timeout fires in 10-30s, killing the bridge (SDK Issue #212). Always return task_id immediately.
- **MCPBridgeServer as a sidecar service:** The bridge is per-orchestrator state. Running it outside the container adds network latency and creates a policy bypass risk. Always in-process.
- **Making workers MCP servers:** Workers are Broker consumers. Making them MCP servers creates a new path that bypasses Gateway policy. Workers stay on standalone; bridge translates MCP tool calls to Broker dispatch.
- **Overwriting hook config without merge:** Not relevant to Phase 8 but documented here since it's Phase 9 territory.
- **Deleting standalone tool loop before parity verification:** The old `_call_llm_with_tools` loop must survive until all 789 tests pass against mcp-bridge. Deletion is the final Phase 8 commit.
- **Propagating exceptions from tool handlers:** Any unhandled exception in a FastMCP tool handler can terminate the server. Wrap all tool handlers in `try/except Exception` and return structured error dicts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server protocol | Custom JSON-RPC server | `mcp[cli]>=1.26` FastMCP | Tool registration, transport, notification protocol, error serialization all handled |
| Tool timeout defense | Custom alarm/signal timeout | Async task_id pattern (return ID immediately, poll separately) | MCP SDK timeouts cannot be prevented at protocol level; the only safe design is not holding tool calls open |
| Redis pub/sub async bridge | Threaded subscriber + asyncio queue | `redis>=5.0` asyncio pub/sub (`pubsub.listen()`) | redis-py>=5.0 provides native asyncio pub/sub; no threading needed |
| Tool list notification | Polling Registry for changes | `notifications/tools/list_changed` via FastMCP + `registry:agent_changed` pub/sub | MCP protocol has native tool list invalidation; pairing with pub/sub gives event-driven refresh |

**Key insight:** The MCP SDK handles all protocol complexity. The implementation is almost entirely about the bridge's tool handler logic — dispatch to Broker, poll from Gateway, route vault writes through Gateway — not about MCP mechanics.

---

## Common Pitfalls

### Pitfall 1: MCP Tool Timeout Crashes the Bridge (SDK Issue #212)
**What goes wrong:** Worker tasks take minutes (policy escalation). MCP client timeout fires (10-30s default), triggering an uncaught `CancelledError` on the cancellation path. Bridge process crashes. All in-flight Broker tasks orphaned.
**Why it happens:** MCP was designed for fast synchronous tool calls. KubexClaw worker delegation is async and long-running.
**How to avoid:** Async task_id pattern (MCP-03) must be implemented from day one. Wrap all handlers in `try/except Exception`. Set `MCP_TOOL_TIMEOUT=300` environment variable (300s minimum).
**Warning signs:** Bridge container restarts during HITL E2E tests; `asyncio.CancelledError` in bridge logs; orphaned task IDs accumulate in Redis.

### Pitfall 2: In-Process Vault Writes Bypass Policy Gate
**What goes wrong:** Calling `vault_ops.create_note()` directly in a tool handler skips the Gateway injection scan. A prompt-injected orchestrator can write arbitrary content to the vault.
**Why it happens:** Direct call optimization skips the Gateway.
**How to avoid:** D-02 is locked — vault writes route through Gateway POST /actions as `vault_create` / `vault_update` action types. Never call vault_ops directly from a write handler.
**Warning signs:** No Gateway audit log entry for vault writes; `create_note` calls bypass the Gateway access log.

### Pitfall 3: Replacing Tool Loop Without Parity Gate
**What goes wrong:** MCPBridgeServer passes all new unit tests but silently breaks ESCALATE → human approval → resume flow, concurrent worker dispatch, and vault CRUD workflows.
**Why it happens:** New tests test new interfaces; existing 789 tests cover existing behavior through the old code path.
**How to avoid:** Run the full existing test suite against `harness_mode: mcp-bridge` before deleting the old loop. Write golden prompt routing tests before any description changes.
**Warning signs:** Old `_call_llm_with_tools` loop is deleted before full E2E suite passes with mcp-bridge.

### Pitfall 4: Tool Description Changes Break LLM Routing Silently
**What goes wrong:** Changing a worker's `config.yaml` description changes the MCP tool wording. LLM stops routing appropriate tasks to that worker with no error — just wrong behavior.
**Why it happens:** Tool descriptions act as LLM prompt content, not code. Semantic changes cause routing changes.
**How to avoid:** Write golden prompt routing tests (fixed task descriptions → expected tool calls). Run after every description change. Treat descriptions as versioned.
**Warning signs:** Worker tool call rate drops without a corresponding drop in incoming task types.

### Pitfall 5: Redis Pub/Sub Subscription Blocks the Event Loop
**What goes wrong:** Running `pubsub.listen()` synchronously in the asyncio event loop blocks MCP server from processing tool calls.
**Why it happens:** Naive pub/sub listener is a blocking loop.
**How to avoid:** Run the pub/sub listener as a separate `asyncio.create_task()`. Use `asyncio.CancelledError` handling for clean shutdown. redis-py>=5.0 provides async pub/sub natively.

### Pitfall 6: MCP Bridge Startup Race With Registry Subscription
**What goes wrong:** Bridge starts, begins serving tool calls, but the pub/sub subscription to `registry:agent_changed` is not yet established. First registration event missed.
**Why it happens:** Async startup sequencing — MCP server accepts connections before background task is started.
**How to avoid:** Start pub/sub subscription task before marking the bridge as ready. Do an initial Registry fetch at startup (cold boot) independent of pub/sub.

---

## Code Examples

Verified patterns from official sources and project design docs:

### Worker Config YAML with Description Field
```yaml
# agents/instagram-scraper/config.yaml (ADD description field)
agent:
  id: "instagram-scraper"
  description: >
    Social media data collection specialist. Scrapes Instagram profiles,
    posts, metrics, and trending content. Use for any task requiring
    social media data collection or analysis.
  model: "gpt-5.2"
  boundary: "default"
  harness_mode: "standalone"
  # ... rest unchanged
```

### Vault Write Tool Handler (D-02 Pattern)
```python
# Source: design-mcp-bridge.md + D-02 locked decision
@self._mcp.tool()
async def vault_create_note(title: str, content: str, folder: str = "") -> dict:
    """Create a new note in the knowledge vault."""
    try:
        resp = await self._http.post(
            f"{self.config.gateway_url}/actions",
            json={
                "agent_id": self.config.agent_id,
                "action": "vault_create",
                "parameters": {"title": title, "content": content, "folder": folder},
            },
        )
        if resp.status_code in (200, 202):
            return {"status": "created", **resp.json()}
        return {"status": "error", "code": resp.status_code, "message": resp.text[:200]}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}
```

### Vault Read Tool Handler (D-01 Pattern — In-Process)
```python
# Source: design-mcp-bridge.md + D-01 locked decision
@self._mcp.tool()
async def vault_search_notes(query: str, folder: str = "") -> list:
    """Search notes in the knowledge vault."""
    try:
        # D-01: reads are in-process, no Gateway routing
        from kubex_harness.vault_ops import search_notes  # noqa: PLC0415
        return search_notes(query=query, folder=folder)
    except Exception as exc:
        return [{"error": str(exc)}]
```

### asyncio.gather() for Concurrent Dispatch (MCP-07)
```python
# Source: ARCHITECTURE.md concurrent tool call pattern
async def _dispatch_concurrent(self, tool_calls: list[dict]) -> list[dict]:
    """Dispatch multiple worker tool calls concurrently."""
    tasks = [
        self._dispatch_one(call["capability"], call["task"])
        for call in tool_calls
    ]
    return await asyncio.gather(*tasks, return_exceptions=True)
```

### Meta-Tool: kubex__list_agents (MCP-08)
```python
# Source: design-mcp-bridge.md meta-tools section
@self._mcp.tool()
async def kubex__list_agents() -> list:
    """List all registered worker agents with capabilities and status."""
    try:
        resp = await self._http.get(f"{self.registry_url}/agents")
        agents = resp.json()
        return [
            {
                "agent_id": a["agent_id"],
                "capabilities": a.get("capabilities", []),
                "status": a.get("status", "unknown"),
                "description": a.get("metadata", {}).get("description", ""),
            }
            for a in agents
            if a["agent_id"] != self.config.agent_id
        ]
    except Exception as exc:
        return [{"error": str(exc)}]
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom 8-tool OpenAI function-calling loop in `standalone.py` | MCP protocol via `MCPBridgeServer` (FastMCP) | Phase 8 (this phase) | Any MCP-compatible LLM harness works; no custom dispatch code per LLM type |
| Static tool list hardcoded in skill manifest | Dynamic tool list from Registry (live pub/sub) | Phase 8 (this phase) | New agents appear as tools without orchestrator restart |
| Workers discovered by querying Registry on each task | Tool cache updated via `registry:agent_changed` pub/sub + `notifications/tools/list_changed` | Phase 8 (this phase) | LLM always sees current agent roster |
| `harness_mode: standalone` as sole orchestrator mode | `harness_mode: mcp-bridge` added alongside standalone | Phase 8 (this phase) | Config-switch migration; rollback is one line change |

**Deprecated/outdated after Phase 8:**
- `StandaloneAgent._call_llm_with_tools()` orchestrator-specific tool loop — deleted at end of Phase 8 after parity verified
- `task-management` skill in orchestrator — removed from skills list (tool management replaced by MCP bridge)
- 8 custom tool handlers (`dispatch_task.py`, `wait_for_result.py`, etc.) in orchestrator skills — deleted post-parity

---

## Open Questions

1. **asyncio.gather() error handling for concurrent dispatch**
   - What we know: `asyncio.gather(return_exceptions=True)` returns exceptions as values rather than raising
   - What's unclear: How should the bridge report partial failures to the LLM when some concurrent dispatches fail and others succeed?
   - Recommendation: Return all results including errors in a list; LLM decides how to handle partial failures

2. **kubex__poll_task polling strategy**
   - What we know: Exponential backoff recommended in PITFALLS.md (1s, 2s, 4s... up to 30s)
   - What's unclear: Should poll_task do the backoff internally (LLM calls it once and waits), or return immediately and let LLM call multiple times?
   - Recommendation: Return immediately with `{status: "pending"}` on each call; let the LLM decide polling frequency — simpler implementation, LLM has context on urgency

3. **need_info result handling depth tracking (D-07)**
   - What we know: Configurable max delegation depth of 3; orchestrator LLM sees chain context
   - What's unclear: Where is the depth counter stored — in the MCP bridge state, or passed through the task payload?
   - Recommendation: Pass `delegation_depth` in the task payload; increment in bridge before dispatch; return error tool result if depth exceeded

4. **FastMCP dynamic tool registration API**
   - What we know: FastMCP uses `@mcp.tool()` decorator; dynamic registration at init is standard
   - What's unclear: Whether FastMCP supports removing and re-adding tools by name (needed for agent deregistration updating tool list)
   - Recommendation: Rebuild the entire tool list on each `registry:agent_changed` event — simpler than incremental add/remove

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (project-wide, per CLAUDE.md) |
| Config file | `pytest.ini` or `pyproject.toml` (check root) |
| Quick run command | `pytest tests/unit/test_mcp_bridge.py -x` |
| Full suite command | `pytest tests/ -x` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | MCPBridgeServer registers one tool per worker from Registry | unit | `pytest tests/unit/test_mcp_bridge.py::test_worker_tool_per_agent -x` | Wave 0 |
| MCP-02 | Worker delegation routes through Gateway POST /actions, not direct | unit | `pytest tests/unit/test_mcp_bridge.py::test_delegation_uses_gateway -x` | Wave 0 |
| MCP-03 | Dispatch tool returns task_id immediately; poll tool checks status | unit | `pytest tests/unit/test_mcp_bridge.py::test_async_dispatch_returns_task_id -x` | Wave 0 |
| MCP-03 | Bridge survives 5-minute task without crashing | integration | `pytest tests/integration/test_mcp_bridge_integration.py::test_long_running_task -x` | Wave 0 |
| MCP-04 | vault_create_note routes through Gateway, not in-process | unit | `pytest tests/unit/test_mcp_bridge.py::test_vault_write_uses_gateway -x` | Wave 0 |
| MCP-04 | vault_search_notes calls in-process, no Gateway request made | unit | `pytest tests/unit/test_mcp_bridge.py::test_vault_read_in_process -x` | Wave 0 |
| MCP-05 | Tool cache refreshes when registry:agent_changed published | integration | `pytest tests/integration/test_mcp_bridge_integration.py::test_pubsub_cache_invalidation -x` | Wave 0 |
| MCP-06 | Full E2E suite passes with harness_mode: mcp-bridge | e2e | `pytest tests/e2e/ -x` | Existing (parity gate) |
| MCP-07 | Concurrent tool calls dispatch in parallel via asyncio.gather | unit | `pytest tests/unit/test_mcp_bridge.py::test_concurrent_dispatch -x` | Wave 0 |
| MCP-08 | kubex__list_agents returns agent roster from Registry | unit | `pytest tests/unit/test_mcp_bridge.py::test_meta_tool_list_agents -x` | Wave 0 |
| MCP-08 | kubex__cancel_task calls cancel endpoint | unit | `pytest tests/unit/test_mcp_bridge.py::test_meta_tool_cancel_task -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/unit/test_mcp_bridge.py tests/unit/test_config_loader.py -x`
- **Per wave merge:** `pytest tests/unit/ tests/integration/ -x`
- **Phase gate:** Full `pytest tests/ -x` green before Phase 8 complete (parity requirement MCP-06)

### Wave 0 Gaps
- [ ] `tests/unit/test_mcp_bridge.py` — primary unit tests for MCPBridgeServer (all MCP-01 through MCP-08 unit coverage)
- [ ] `tests/integration/test_mcp_bridge_integration.py` — integration tests requiring real fakeredis pub/sub (MCP-03 long-running, MCP-05 cache invalidation)

*(Existing test infrastructure — pytest, fakeredis, httpx mocks — covers all other needs. No new framework required.)*

---

## Sources

### Primary (HIGH confidence)
- `D:/dev/dev/openclaw/docs/design-mcp-bridge.md` — Full architecture, Mermaid data flows, tool schemas, file change list, security model
- `D:/dev/dev/openclaw/.planning/research/SUMMARY.md` — Stack choices, pitfall catalogue, phase ordering rationale
- `D:/dev/dev/openclaw/.planning/research/ARCHITECTURE.md` — Component breakdown, integration points, build order, data flow diagrams
- `D:/dev/dev/openclaw/.planning/research/PITFALLS.md` — 10 critical pitfalls with confirmed CVEs and SDK issue numbers
- `D:/dev/dev/openclaw/.planning/research/STACK.md` — Library versions, alternatives, version compatibility table
- Direct codebase reads: `main.py`, `standalone.py`, `config_loader.py`, `store.py`, `orchestrator/config.yaml`, all worker configs, `pyproject.toml`, `test_orchestrator_loop.py`
- `mcp[cli]>=1.26` — Official Anthropic MCP Python SDK, PyPI verified, FastMCP decorator API confirmed

### Secondary (MEDIUM confidence)
- [MCP Tool timeout within 10 seconds causing MCP server disconnect — SDK Issue #212](https://github.com/modelcontextprotocol/python-sdk/issues/212) — confirmed production crash, async task_id pattern is the fix
- [The Silent Breakage: MCP Tool Versioning](https://minherz.medium.com/the-silent-breakage-a-versioning-strategy-for-production-ready-mcp-tools-fbb998e3f71f) — description changes causing silent LLM routing breakage
- [Caught in the Hook: CVE-2025-59536, CVE-2026-21852](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — hook injection (Phase 10 concern; context for Phase 8 read-only mount design)

### Tertiary (LOW confidence)
- None — all findings have at least MEDIUM confidence backing.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `mcp[cli]>=1.26` verified on PyPI; existing stack (redis, httpx, asyncio) already in use
- Architecture: HIGH — existing codebase read directly; design docs reviewed; exact file paths, class names, and line numbers identified
- Pitfalls: HIGH — all grounded in confirmed SDK issues (Issue #212), confirmed CVEs, and locked decisions (D-02 policy gate)
- Test map: HIGH — existing test infrastructure (pytest, fakeredis) confirmed; new test files identified with specific test names

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (mcp[cli] is stable; validate version before planning if > 30 days elapsed)
