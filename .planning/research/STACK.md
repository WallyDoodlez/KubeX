# Stack Research

**Domain:** MCP Bridge + CLI Runtime additions to existing Python/Docker/FastAPI agent infrastructure
**Researched:** 2026-03-21
**Confidence:** HIGH (MCP SDK verified via PyPI + official docs; PTY/file-watcher via PyPI; hooks via official Claude Code docs)

---

## Context: What Already Exists (Do Not Re-add)

This is a brownfield addition. The following stack is live and must NOT be re-researched or re-added:

| Existing | Version | Role |
|----------|---------|------|
| Python | 3.12 | Runtime |
| FastAPI + uvicorn | current | All five services |
| httpx | >=0.27 | HTTP client in harness |
| redis | >=5.0 | Task queue, pub/sub |
| docker (docker-py) | >=7.1 | Container lifecycle in Manager |
| pydantic | >=2.12 | Data validation |
| pyyaml | >=6.0 | Config loading |
| asyncio | stdlib | Concurrency throughout |
| Docker Compose | current | Container orchestration |

The harness `pyproject.toml` currently lists only `httpx>=0.27` and `redis>=5.0`. Everything below is new.

---

## New Dependencies Required

### MCP Bridge

**Requirement:** Workers expose their tools as MCP servers. Orchestrator connects to workers as an MCP client. Standard MCP protocol replaces the custom tool-use loop.

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `mcp[cli]` | `>=1.26` | MCP server + client in one package. FastMCP decorator API for workers (`@mcp.tool()`), `ClientSession` + `stdio_client` for the orchestrator bridge. | Official Anthropic SDK. FastMCP 1.0 was absorbed into this package in 2024. Version 1.26.0 is current stable (released January 2026). v2 is pre-alpha — use v1.x for production. |

Install: `pip install "mcp[cli]>=1.26"`

The `[cli]` extra pulls in `rich` for diagnostics. No alternative needed — this is the canonical SDK.

**Key API surface:**

```python
# Worker side — MCP server (stdio transport)
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(name="engineer")

@mcp.tool()
async def run_task(task: str) -> str:
    """Execute an engineering task."""
    ...

mcp.run(transport="stdio")  # launched as subprocess by orchestrator bridge

# Orchestrator side — MCP client
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(command="python", args=["-m", "kubex_harness.main"])
async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("run_task", arguments={"task": "..."})
```

**Transport decision:** Use stdio for intra-Docker-network worker connections. Workers are on `kubexclaw-internal` — there is no need for Streamable HTTP (the MCP-recommended remote transport) for v1.2. The design doc (Gap 3) notes SSE/HTTP for external access; that can be added later via a `mcp-server-http` harness mode. This is a config-driven switch: `mcp.run(transport="streamable-http")` on the worker and `streamable_http_client` on the orchestrator side.

**Tool list refresh:** The `notifications/tools/list_changed` MCP notification is already in the protocol. Pair with the existing Redis pub/sub (`PUBLISH registry:agent_changed`) from `services/registry/store.py` to trigger client-side `session.list_tools()` re-fetch. No new infrastructure needed.

**Concurrent tool calls:** Use `asyncio.gather()` for parallel dispatch across multiple workers. The `ClientSession` is async — multiple calls can be issued concurrently.

---

### CLI Runtime

**Requirement:** Run Claude Code, Codex CLI, or Gemini CLI inside a Kubex container in a PTY so the CLI behaves as if it has a real terminal. Feed it tasks, stream output, detect failures.

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `ptyprocess` | `>=0.7` | Launch CLI tools in a pseudo-terminal. Provides `PtyProcessUnicode.spawn()` which allocates a real PTY and starts the process, plus `read()` / `write()` for I/O. | Stable and minimal. ptyprocess is the exact primitive needed — allocates a PTY, spawns the process, provides fd-level I/O. No pattern-matching overhead. pexpect (4.9.0) wraps this and adds pattern matching that is not needed here. |

Install: `pip install "ptyprocess>=0.7"`

**Why not alternatives:**

- `pexpect` (4.9.0): Higher-level wrapper around ptyprocess that adds `expect()` pattern matching. Not needed — failure detection is done via string matching on output, not blocking waits for patterns. pexpect is not asyncio-native and adds weight for no benefit.
- `asyncio.create_subprocess_exec()`: Cannot allocate a PTY. CLI tools (Claude Code, Codex, Gemini CLI) detect whether stdout is a TTY and change behavior — they suppress interactive prompts or exit when piped. A real PTY is required.
- `subprocess.Popen` + `pty.openpty()`: Requires manual fd management. ptyprocess does this correctly already.

**Asyncio integration:** ptyprocess is synchronous. Wrap reads in `loop.run_in_executor(None, pty_proc.read, 4096)` to avoid blocking the event loop. This is the standard pattern — no extra library needed.

**Platform note:** ptyprocess requires Unix (`pty` stdlib module). All Kubex containers are Linux — no constraint. The harness already has `contextlib.suppress(NotImplementedError)` guards for Windows signal handlers, confirming container code is Unix-only.

---

### OAuth Credential Detection

**Requirement:** When a CLI runtime container starts, detect when OAuth credentials appear in `~/.claude/`, `~/.codex/`, or `~/.gemini/` after the user completes browser login.

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `watchfiles` | `>=1.1.1` | Async-native file watching via `awatch()` generator. Detects when credential files are created or modified in the OAuth credential directories. | Rust-backed (via the Notify crate), asyncio-native. `awatch` is an async generator — no thread bridging needed. watchdog (6.0.0) uses threaded observers requiring manual `run_in_executor()` for async code. watchfiles is the right choice for an async codebase. |

Install: `pip install "watchfiles>=1.1.1"`

```python
from watchfiles import awatch

async def wait_for_credentials(credential_dir: str, stop_event: asyncio.Event) -> None:
    async for changes in awatch(credential_dir, stop_event=stop_event):
        if any("credentials" in str(path) or "token" in str(path) for _, path in changes):
            return  # credentials appeared — proceed with boot
```

**Alternative:** Plain polling with `asyncio.sleep(2)` and `os.path.exists()`. Lower dependency, acceptable for this use case since credential appearance is a one-time infrequent event (once per container boot). Use watchfiles for event-driven zero-latency detection; polling if you want to minimize dependencies.

---

### Claude Code Hooks Integration

**Requirement:** Passive monitoring of Claude Code tool use, turn completion, and session end. Zero prompt tokens — hooks fire out-of-band.

**No new Python library required.** Claude Code hooks are configured via JSON written to `.claude/settings.json` inside the container. The harness writes this file at boot time from `config.yaml`.

Hook delivery mechanism — use **HTTP hooks** (not command hooks). FastAPI is already in the stack. Add a `POST /hooks/{event_name}` internal endpoint to the harness's local HTTP server (or a minimal bare asyncio HTTP server on `localhost:9090`).

The Claude Code hooks reference (verified 2026-03-21) documents 21 lifecycle events. The three events needed for v1.2:

| Hook Event | Purpose | `async` |
|------------|---------|---------|
| `PostToolUse` | Track which tools the CLI called — passive audit trail | `true` (fire-and-forget) |
| `Stop` | Detect when Claude Code finishes a turn — trigger result collection | `true` |
| `SessionEnd` | Detect clean CLI exit — harness reports task complete | `false` (synchronous, must ack) |

Hooks config written at container boot:

```json
{
  "hooks": {
    "PostToolUse": [{"matcher": "*", "hooks": [{"type": "http", "url": "http://localhost:9090/hooks/PostToolUse", "async": true}]}],
    "Stop":        [{"matcher": "*", "hooks": [{"type": "http", "url": "http://localhost:9090/hooks/Stop", "async": true}]}],
    "SessionEnd":  [{"matcher": "*", "hooks": [{"type": "http", "url": "http://localhost:9090/hooks/SessionEnd"}]}]
  }
}
```

Hook input format (Claude Code sends JSON to stdin / POST body):

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": {"command": "ls /app"},
  "tool_response": {"output": "..."}
}
```

**Codex CLI:** No native hooks. Use the bidirectional MCP fallback — harness runs an MCP server that Codex calls to report results. `mcp[cli]` covers this.

---

### WebSocket / Command Center OAuth Flow

**For v1.2:** The design doc (`design-oauth-runtime.md`) specifies `docker exec -it` as the OAuth provisioning UX, using the existing `request_user_input` HITL mechanism. No WebSocket needed.

**If the plan shifts to a web-based OAuth flow post-v1.2:** FastAPI already includes WebSocket support (`from fastapi import WebSocket`) — no new dependency. The OAuth redirect URL becomes a Command Center endpoint (`/oauth/callback?token=...&agent_id=...`) which pushes completion to the browser via WebSocket and forwards the token to the container via the Manager API.

Do not add WebSocket infrastructure in v1.2.

---

## Complete Dependency Delta for `agents/_base/pyproject.toml`

```toml
dependencies = [
    "httpx>=0.27",          # existing
    "redis>=5.0",            # existing
    "mcp[cli]>=1.26",       # NEW — MCP server (workers) + client (orchestrator bridge)
    "ptyprocess>=0.7",      # NEW — PTY subprocess manager for CLI runtimes
    "watchfiles>=1.1.1",    # NEW — async credential file watching (can substitute with polling)
]
```

`watchfiles` is the only optional substitution — polling works if you want to avoid the Rust extension. `mcp` and `ptyprocess` are required for v1.2.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| MCP framework | `mcp` (official SDK) | `fastmcp` 2.0 (separate project) | FastMCP 2.0 adds client proxying, routing, and server composition not needed here. Official SDK covers all required use cases. FastMCP 1.0 is already inside the official SDK. |
| PTY management | `ptyprocess` | `pexpect` (4.9.0) | pexpect wraps ptyprocess and adds `expect()` pattern matching not needed for CLI output streaming. Not asyncio-native. More weight, no benefit. |
| PTY management | `ptyprocess` | `asyncio.create_subprocess_exec` | Cannot allocate a PTY. CLIs behave differently when stdout is a pipe, breaking interactive auth flows. |
| File watching | `watchfiles` | `watchdog` (6.0.0) | watchdog uses threaded observers requiring `run_in_executor` bridging for async code. watchfiles is asyncio-native via `awatch` generator. |
| File watching | `watchfiles` | polling with `os.path.exists()` | Polling works — 1-2s latency on credential detection is acceptable since auth happens once at boot. Use if Rust extension is unwanted. |
| Hook delivery | HTTP hook (FastAPI route) | Command hook (shell script) | HTTP hook integrates directly with the async harness event loop. No shell scripts, no named pipes, no fd management. |
| MCP transport | stdio | Streamable HTTP | Streamable HTTP is correct for remote/multi-host deployments. All workers are on the same Docker network — stdio subprocess is lower complexity for v1.2. Config-driven switch later. |
| OAuth flow | `docker exec` + HITL | Command Center web OAuth | Web OAuth is better UX but adds significant complexity: WebSocket push, browser redirect handler, Manager token-forwarding API. Defer to post-v1.2. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `authlib` / `python-jose` | OAuth flow is handled by the CLI itself (`claude login`, `codex login`). The CLI manages token lifecycle. Python OAuth library would be redundant. | ptyprocess + watchfiles to detect when CLI writes its own credentials |
| `anthropic` Python SDK | Workers using Claude Code CLI don't need the Anthropic SDK — the CLI handles auth. This would be a duplicate dependency with conflicting version concerns. | ptyprocess subprocess spawning the `claude` CLI binary |
| `pexpect` | Pattern-matching wrapper around ptyprocess. Adds overhead and is not asyncio-native. | `ptyprocess` directly with `run_in_executor` for async reads |
| `paramiko` / `fabric` | No SSH needed — everything is intra-container or via Docker socket | ptyprocess for local PTY |
| `docker` (python SDK additions) | Manager already controls containers via Docker socket. Adding SDK calls in the harness would bypass the existing Manager API surface. | Existing Manager API endpoints |
| SSE MCP transport (for v1.2) | Being superseded by Streamable HTTP per MCP spec. Adds infrastructure for intra-container calls that don't need it. | stdio transport for local workers |
| FastMCP 2.0 | Separate project from official SDK, adds client proxying and routing features not needed. The official `mcp` package already includes FastMCP 1.0 patterns. | `mcp[cli]>=1.26` (official SDK) |

---

## Version Compatibility

| Package | Python | Notes |
|---------|--------|-------|
| `mcp>=1.26` | >=3.10 | Project uses 3.12 — no issue. httpx is also a dependency of mcp; versions are compatible. |
| `ptyprocess>=0.7` | >=3.6, Unix only | All containers are Linux — no issue. |
| `watchfiles>=1.1.1` | >=3.8 | Rust extension — pre-built wheels on PyPI for Linux amd64/arm64. No build tools needed in base image. |
| `mcp` + `redis>=5.0` | — | No conflicts — different subsystems. |
| `mcp` + `httpx>=0.27` | — | httpx is a shared dependency; versions are compatible. |

---

## Integration Points with Existing Stack

| New Library | Integrates With | How |
|-------------|----------------|-----|
| `mcp` (server) | `agents/_base/kubex_harness/main.py` | New `harness_mode: mcp-server` routing branch. Worker starts `mcp.run(transport="stdio")` instead of `StandaloneAgent.run()`. |
| `mcp` (client) | `agents/_base/kubex_harness/mcp_bridge.py` (new file) | Bridge module reads Registry to discover agents, connects to each via `stdio_client`, exposes combined tool list to orchestrator LLM. |
| `mcp` (pub/sub notify) | `services/registry/registry/store.py` | Registry already has `HSET` calls. Add `PUBLISH registry:agent_changed` on register/deregister. Bridge subscribes and calls `session.list_tools()` to refresh. |
| `ptyprocess` | `agents/_base/kubex_harness/cli_runtime.py` (new file) | `CLIRuntime` class wraps `PtyProcessUnicode.spawn()`. Reads config `runtime` field to select `claude`/`codex`/`gemini` binary. |
| `watchfiles` | `agents/_base/kubex_harness/cli_runtime.py` | `wait_for_credentials()` uses `awatch()` before accepting tasks. |
| HTTP hooks | `agents/_base/kubex_harness/cli_runtime.py` | Writes `.claude/settings.json` at boot. Receives hook POST requests on `localhost:9090`. |

---

## Sources

- [MCP Python SDK — PyPI](https://pypi.org/project/mcp/) — version 1.26.0, current stable, verified 2026-03-21 — HIGH confidence
- [MCP Python SDK — GitHub](https://github.com/modelcontextprotocol/python-sdk) — client/server API patterns, transport options — HIGH confidence
- [MCP Transports — official spec](https://modelcontextprotocol.info/docs/concepts/transports/) — stdio vs SSE vs Streamable HTTP — HIGH confidence
- [ptyprocess — PyPI](https://pypi.org/project/ptyprocess/) — version 0.7.0, Unix PTY subprocess — HIGH confidence
- [pexpect — PyPI](https://pypi.org/project/pexpect/) — version 4.9.0, compared for decision — HIGH confidence
- [watchfiles — GitHub](https://github.com/samuelcolvin/watchfiles) — version 1.1.1, asyncio awatch, Rust-backed via Notify — HIGH confidence
- [watchdog — PyPI](https://pypi.org/project/watchdog/) — version 6.0.0, thread-based, ruled out — HIGH confidence
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — 21 hook events, HTTP hook type, JSON config format, async flag — HIGH confidence (official Anthropic docs, verified 2026-03-21)
- [FastMCP vs MCP SDK discussion](https://github.com/PrefectHQ/fastmcp/discussions/2557) — FastMCP 2.0 scope comparison — MEDIUM confidence (community source)

---

*Stack research for: KubexClaw v1.2 MCP Bridge + CLI Runtime*
*Researched: 2026-03-21*
