# Feature Landscape

**Domain:** MCP Bridge + CLI Runtime for Agent Infrastructure Platform (KubexClaw v1.2)
**Researched:** 2026-03-21
**Confidence:** HIGH — grounded in official MCP/hooks docs + existing KubexClaw design docs

---

## Scope Note

This document covers ONLY new features for v1.2. Features already built in v1.0/v1.1 are not re-scoped here:
- Gateway policy engine, Broker Redis queue, Registry, Kubex Manager — COMPLETE
- Universal base image with dynamic skill injection — COMPLETE
- Multi-agent orchestration with custom tool-use loop (OpenAI function calling) — COMPLETE
- Reviewer agent, HITL, kill switch, knowledge vault — COMPLETE
- 789 tests passing

---

## Feature Set: MCP Bridge

Replaces the custom OpenAI function-calling tool loop with standard MCP protocol. Workers
become MCP servers (exposed via bridge); orchestrator becomes an MCP client. Any MCP-compatible
LLM harness (Claude Code, Codex CLI, Gemini CLI, or the existing Python harness) can orchestrate
without custom dispatch code.

### Table Stakes

Features without which the MCP Bridge is not a working replacement for the custom tool loop.

| Feature | Why Expected | Complexity | Dependencies on Existing KubexClaw |
|---------|--------------|------------|-------------------------------------|
| MCP server exposing worker tools via stdio transport | Core protocol — without it no harness connects | Medium | `mcp` Python SDK (FastMCP); `harness_mode: mcp-bridge` routing in `main.py` |
| One MCP tool per registered worker agent, tool name = capability | Orchestrator delegates by capability; each worker = one natural-language `task` input | Low | Registry query at bridge init; existing `/agents` endpoint unchanged |
| Tool descriptions auto-populated from agent `description` field in config.yaml | LLM needs accurate descriptions to route intelligently; hallucinated descriptions break delegation | Low | New `description` field in `AgentConfig` + `config_loader.py` |
| `harness_mode: mcp-bridge` config field with routing in `main.py` | Stem cell specialization is config-driven; bridge mode is just another identity | Low | `AgentConfig` model update; `config_loader.py` |
| Worker delegation dispatches through existing Gateway POST /actions | Security boundary must apply to MCP-dispatched tasks too; policy engine cannot be bypassed | Low | No Gateway changes; bridge calls existing endpoint |
| Synchronous poll-until-complete for worker tasks | MCP tool calls are synchronous from the LLM's perspective; bridge must block and return result | Medium | Existing `GET /tasks/{id}/result` polling via Gateway; configurable timeout |
| Vault tools exposed as direct in-process MCP tools (vault_search_notes, vault_create_note, etc.) | Orchestrator accesses knowledge during planning — no worker LLM needed for CRUD operations | Low | Existing `vault_ops.py` called directly; no Broker dispatch |
| Tool cache invalidated on new agent registration via Redis pub/sub | Agents spawn dynamically; orchestrator must see newly registered workers without restart | Medium | Registry `PUBLISH registry:agent_changed` (new); MCP `notifications/tools/list_changed` |
| `mcp-bridge` harness mode ships as parallel mode alongside standalone — custom loop not deleted yet | Replace working code only after replacement is validated; parallel modes reduce rollback risk | Low | `main.py` routing: standalone = existing loop; mcp-bridge = new bridge |

### Differentiators

Features that go beyond basic protocol compliance and add operational value.

| Feature | Value Proposition | Complexity | Dependencies on Existing KubexClaw |
|---------|-------------------|------------|-------------------------------------|
| Concurrent tool dispatch via `asyncio.gather()` | LLMs issue parallel tool calls; sequential dispatch adds unnecessary latency when orchestrator delegates to multiple workers simultaneously | Medium | Async orchestration in `mcp_bridge.py`; aligns with existing async FastAPI pattern |
| Meta-tools: `kubex__list_agents`, `kubex__agent_status`, `kubex__cancel_task` | Orchestrator inspects fleet, checks health, aborts stuck tasks — no custom skill code needed | Low | Registry GET /agents; existing cancel-via-control-channel |
| Worker "need_info" structured response protocol | Workers can request cross-Kubex collaboration without a full round-trip back to user; orchestrator detects `need_info` status and re-delegates | High | Requires new response status definition; orchestrator loop change; bridge must detect and re-dispatch |
| Configurable task timeout with orphaned-task cancellation | Prevents resource leaks when workers hang; bridge cancels via existing control channel on timeout | Low | Configurable timeout in `mcp_bridge.py`; existing cancel endpoint |
| Both stdio and SSE transports, config-driven | stdio for Docker internal use; SSE for external MCP harnesses connecting over network | Medium | FastMCP supports both transports natively — config field selects |
| Tool output schema validation (`outputSchema`) | MCP spec 06-2025 feature; validates worker result structure; catches integration errors before LLM sees malformed output | Low | FastMCP decorator support; adds type safety at protocol boundary |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| LLM calls inside the MCP bridge itself | Bridge is a protocol translator, not a reasoning layer — adding LLM calls creates collusion risk and inflates latency | Bridge is pure dispatch: receive MCP tool call → forward to Gateway → poll → return result |
| Bypassing Gateway for bridge-dispatched tasks | Policy engine applies to ALL agent actions; MCP is not a privileged dispatch path | All worker delegations route through `POST /actions` with full policy evaluation |
| Monolithic MCP server mixing vault CRUD, worker dispatch, and meta-tools in one namespace | MCP best practice is one server per clear purpose; mixing creates maintenance hazard | Vault tools are a distinct category; worker tools auto-generated from Registry; meta-tools are explicit |
| Deleting the custom tool loop before MCP bridge is production-validated | Removes working fallback before replacement is proven | Ship `harness_mode: mcp-bridge` in parallel; run full test suite against both modes; then remove standalone loop |
| Hot-swap of worker tool list mid-session | MCP tool list changes mid-session confuse most LLM harnesses; inconsistent state | Use `notifications/tools/list_changed` — harness re-fetches on next request; mid-session changes are safe because the LLM gets a fresh list on the next turn |

---

## Feature Set: CLI Runtime

Enables any CLI agent (Claude Code, Codex CLI, Gemini CLI) to run inside Kubex containers
via PTY. The harness becomes a process supervisor, not an LLM loop. The stem cell runs any
LLM runtime — API-based or subscription-based — from config.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies on Existing KubexClaw |
|---------|--------------|------------|-------------------------------------|
| PTY-based subprocess launch via `ptyprocess` | CLIs require a real terminal — plain subprocess pipes break interactive CLIs that use ANSI, curses, SIGWINCH, or prompt-detection | Low | `ptyprocess` library (boot-time trusted dep, no policy gate needed); contained in `CLIRuntime` module |
| `runtime` config field in config.yaml routing in `main.py` | Stem cell identity is config-driven; CLI runtime is just another specialization | Low | New `runtime` field in `AgentConfig`; `config_loader.py`; `main.py` routing update |
| CLI task delivery via stdin or `--prompt` argument | Each CLI has its own task injection mechanism | Low | Per-CLI launch config: `claude -p "task"`, `codex "task"`, `gemini "task"` |
| Structured result extraction from CLI stdout | Task result must flow back to Broker; raw terminal output needs ANSI stripping and pattern matching | Medium | Output parser per CLI type in `CLIRuntime`; result returned through existing Broker pipeline |
| Credential check at startup (file existence + freshness) | Prevents mid-task auth failures; fail fast before accepting any tasks | Low | File stat check on `~/.claude/`, `~/.codex/`, `~/.gemini/` depending on runtime type |
| HITL re-auth flow via existing `request_user_input` | User `docker exec`s into container and logs in; no new infrastructure needed | Low | Already built in v1.0; `CLIRuntime` calls it with per-CLI instructions |
| Failure pattern detection per CLI type | Subscription limit, auth expiry, and crashes manifest differently across CLIs — each needs its own stdout/exit-code pattern recognizer | Medium | Failure pattern library in `CLIRuntime`; maps to `task_failed` reason enum |
| `task_failed` with typed reason (subscription_limit, auth_expired, cli_crash, runtime_not_available) | Orchestrator must know WHY a task failed to decide on retry vs escalate | Low | Existing Broker result pipeline; add `reason` field to failure payload |
| Kill switch still works (stop container = stop CLI) | CLI process is a child of the harness; container SIGTERM propagates to PTY child | Low | Existing kill switch stops the container; PTY child inherits signal; no new code needed |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies on Existing KubexClaw |
|---------|-------------------|------------|-------------------------------------|
| Skills injected as CLAUDE.md / AGENTS.md / GEMINI.md at spawn | Stem cell skill injection extends to CLI runtimes — skills become project instructions read by the CLI | Low | Kubex Manager already writes skills to container at spawn; new: write to CLI-specific instruction file path |
| Hooks-based monitoring for Claude Code (PostToolUse, Stop, SessionEnd) | Zero prompt-token cost; passive instrumentation; events flow to harness without any MCP overhead; observable what tools the CLI invokes | Medium | Claude Code hooks written to `.claude/settings.json` at spawn; hook scripts POST events to harness HTTP endpoint or write to shared file |
| Hooks-based monitoring for Gemini CLI (AfterTool, AfterAgent, SessionEnd) | Same value as Claude Code hooks; Gemini CLI hook system is structurally identical (JSON stdin/stdout, exit codes) | Medium | Gemini CLI hooks written to project dir or `~/.gemini/` at spawn; same event forwarding pattern |
| Bidirectional MCP — harness runs FastMCP server exposing `report_progress` and `report_result` tools | Codex CLI lacks a hooks system but supports MCP servers; CLI calls harness tools to report status; provides monitoring parity | High | Harness runs FastMCP server concurrently with PTY subprocess; Codex CLI configured with `mcp_servers` pointing to harness at spawn; requires async server + PTY manager to run simultaneously |
| Tiered monitoring strategy: hooks preferred → bidirectional MCP → process monitoring always | Graceful degradation — harness always has at least process-level visibility regardless of CLI capability | Medium | `MonitoringStrategy` enum per runtime type; harness selects at startup; Claude Code = hooks, Gemini CLI = hooks, Codex CLI = MCP fallback |
| SIGWINCH / terminal size management | Prevents CLIs from mangling output due to narrow default terminal width; some CLIs produce different output formats based on terminal width | Low | `ptyprocess` supports `setwinsize()`; set 220x50 at spawn |
| OAuth token forwarded from Command Center web flow at spawn | Better UX than `docker exec` for initial auth; token pre-provisioned before container starts | High | New component: Command Center web OAuth flow page; Kubex Manager spawn call receives token parameter; token written to container credential directory at creation |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Wrapping CLI stdout with a secondary LLM to extract results | Adds cost, latency, and a second model to the trust chain; LLM parsing LLM output is circular | Deterministic output pattern matching + regex; accept partial results if structure is ambiguous; use hooks or MCP reporting for richer data |
| Hot-swap of OAuth tokens for running containers | Token swap mid-session can corrupt CLI auth state unpredictably | Kill container, update credentials, respawn via Kubex Manager; existing kill switch handles this |
| Storing OAuth tokens in Redis or shared storage | Token isolation per container is a security requirement; shared storage creates cross-agent credential leakage | Pass token at spawn time only; store only in container's own credential directory (`~/.claude/`, etc.) |
| aider as a supported runtime | No hooks, no MCP server support, no structured output; would require a custom wrapper; wrapper defeats "CLI runs as-is" principle | Explicitly excluded; added to PROJECT.md Out of Scope |
| Blocking harness boot indefinitely waiting for OAuth | Unprovisioned container hangs silently with no visibility | Send HITL request, move to `awaiting_auth` state, log clearly; accept tasks only after auth confirmed |
| Running CLI as root inside container | Unnecessary privilege even with Gateway policy gates; defense in depth | Container user is non-root; CLI inherits same user; no setuid needed |
| Hardcoding CLI detection logic per provider | Claude Code, Codex CLI, Gemini CLI have different launch patterns; hardcoded if/else doesn't scale to new CLIs | `CLIRuntime` uses a per-runtime config struct: launch_cmd, credential_path, auth_check_pattern, failure_patterns, monitoring_strategy |

---

## Feature Set: Lifecycle Events

Lifecycle events surface container, CLI, and task state changes to the Registry and Command
Center. Most are low-complexity extensions of existing pub/sub patterns.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies on Existing KubexClaw |
|---------|--------------|------------|-------------------------------------|
| `container_spawned` event on Kubex registration | Registry already fires at registration; new event type surfaces this to Command Center | Low | Registry PUBLISH on register (already planned for agent discovery) |
| `task_assigned`, `task_complete`, `task_failed` events | Broker already manages these state transitions; events are derived from existing Redis stream state | Low | No new infra; events emitted at existing state transition points |
| `cli_starting`, `cli_ready` events for CLI runtime | CLIs take 3-8 seconds to initialize; harness must signal "ready to accept tasks" vs "still starting" | Low | `CLIRuntime` state machine; `cli_ready` = first non-error output received from PTY |
| `cli_stopped`, `cli_timeout` events | Distinguishes clean shutdown from hung process; critical for Command Center visibility | Low | PTY exit detection + timeout monitoring in `CLIRuntime` |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies on Existing KubexClaw |
|---------|-------------------|------------|-------------------------------------|
| `task_progress` events with status string | Enables Command Center progress display for long-running CLI tasks; especially valuable when hooks are active | Medium | Requires hooks or bidirectional MCP reporting to emit progress; otherwise only start/end events available |
| Lifecycle event fan-out via Redis pub/sub to Command Center | Real-time dashboard updates without polling; consistent with Registry pub/sub pattern already used for agent discovery | Low | Registry already publishes to Redis; extend pattern to lifecycle namespace |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time SSE streaming of CLI stdout to Command Center | Already marked Out of Scope in PROJECT.md; polling task result works; SSE adds significant infra complexity for marginal value | Final result via existing task result endpoint; lifecycle events for coarse state |

---

## Feature Dependencies

```
MCP Bridge
    requires: harness_mode: mcp-bridge config field (AgentConfig + config_loader.py)
    requires: description field in AgentConfig
    requires: Registry PUBLISH on register/deregister (agent_changed pub/sub)
    uses unchanged: Gateway POST /actions, GET /tasks/{id}/result, GET /agents

Worker delegation via MCP Bridge
    requires: MCP Bridge
    uses unchanged: Gateway policy engine, Broker Redis streams, worker harnesses

Vault tools via MCP Bridge
    requires: MCP Bridge
    uses unchanged: vault_ops.py (no modifications)

Live agent discovery (tool cache invalidation)
    requires: Registry PUBLISH on agent_changed
    requires: MCP notifications/tools/list_changed

CLI Runtime (PTY subprocess)
    requires: runtime field in AgentConfig (new)
    requires: CLIRuntime module (new)
    requires: ptyprocess/pexpect library (new dep)

Skills as CLI instruction files
    requires: CLI Runtime
    requires: Kubex Manager writes to CLI-specific path at spawn (modification)

Hooks-based monitoring (Claude Code)
    requires: CLI Runtime
    requires: Hook config written to .claude/settings.json at spawn (new in Manager or harness init)
    requires: Hook event receiver (HTTP endpoint or file) in harness (new)

Hooks-based monitoring (Gemini CLI)
    requires: CLI Runtime
    requires: Hook config written to Gemini CLI config dir at spawn

Bidirectional MCP (harness as MCP server for Codex CLI)
    requires: CLI Runtime
    requires: FastMCP server running concurrently in harness (new)
    requires: Codex CLI MCP server config written at spawn (new in Manager)

OAuth web flow provisioning
    requires: Command Center web OAuth page (new component)
    requires: Kubex Manager spawn endpoint accepts token parameter (modification)

HITL re-auth (fallback, no web flow)
    requires: CLI Runtime
    uses unchanged: request_user_input (no modifications)

Lifecycle events
    requires: CLIRuntime state machine (new)
    requires: Registry pub/sub fan-out (extends existing pattern)
    uses unchanged: Broker task state transitions
```

---

## MVP Recommendation for v1.2

**Phase 1 — MCP Bridge** (highest leverage, lowest risk)
- MCP server in harness exposing worker tools via stdio + vault tools direct
- `harness_mode: mcp-bridge` config routing
- `description` field in AgentConfig
- Registry pub/sub for tool cache invalidation
- Concurrent dispatch via `asyncio.gather()`
- Full test suite against mcp-bridge mode; then remove custom loop

**Phase 2 — CLI Runtime (PTY + HITL auth)**
- PTY launch, task delivery, result extraction, failure detection
- HITL re-auth using existing `request_user_input`
- Skills injected as CLAUDE.md / AGENTS.md
- Lifecycle events: cli_starting, cli_ready, cli_stopped, cli_timeout

**Phase 3 — Hooks Monitoring**
- Claude Code hooks (PostToolUse, Stop, SessionEnd) — highest value, lowest complexity
- Gemini CLI hooks (AfterTool, AfterAgent) — same pattern, follow-on
- task_progress events from hooks

**Phase 4 — Advanced Provisioning** (defer, not a blocker)
- Bidirectional MCP for Codex CLI — complex, low urgency (Codex is third-priority CLI)
- OAuth Command Center web flow — HITL docker exec works; web flow is UX polish

**Explicitly defer:**
- Worker "need_info" cross-Kubex protocol — protocol design not yet finalized
- Tool output schema validation — add after core bridge is stable
- SSE streaming — Out of Scope per PROJECT.md
- Hooks monitoring for Gemini CLI / Codex CLI — no subscriptions available; stubs exist in e2e tests

---

## Feature Set: OAuth Paste-Code Web Flow (Backend Endpoints)

Added 2026-03-26. These backend endpoints support the Command Center UI's OAuth credential provisioning flow. The UX is: user authenticates via their CLI locally, copies the resulting credential file, pastes it into the Command Center UI, and the backend injects it into the running container.

### Current State (what already works)

| Endpoint | Status |
|----------|--------|
| `POST /kubexes/{kubex_id}/credentials` (Manager :8090) | COMPLETE — writes credential JSON to container file |
| `GET /agents/{agent_id}/lifecycle` SSE (Gateway :8080) | COMPLETE — streams state transitions including `credential_wait` |
| Agent-side credential gate (`cli_runtime.py`) | COMPLETE — blocks tasks until credentials present, enters `credential_wait` state |
| FE handoff doc (`docs/HANDOFF-phase12-oauth-fe.md`) | COMPLETE — 452 lines, full API contracts |

### Backend Gaps (to build)

#### 1. `GET /agents/{agent_id}/state` — Current Lifecycle State (REST)

**Service:** Gateway :8080
**Why needed:** SSE lifecycle stream doesn't replay history. If the UI loads after the agent already entered `credential_wait`, there's no way to know. The handoff doc acknowledges this gap: "For the current state, call `GET /kubexes/{kubex_id}` to check Docker container status" — but Docker status (`running`) is not the same as lifecycle state (`credential_wait`).

**Request:**
```
GET /agents/{agent_id}/state
Authorization: Bearer <KUBEX_MGMT_TOKEN>
```

**Response 200:**
```json
{
  "agent_id": "my-agent",
  "state": "credential_wait",
  "last_updated": "2026-03-26T12:00:00Z"
}
```

**Implementation:** Read the last published message on `lifecycle:{agent_id}` from Redis. Could use a Redis key (`agent:state:{agent_id}`) written alongside each pub/sub publish, or `GET` the latest from the pub/sub channel history (Redis doesn't store pub/sub history, so a side-write is needed). The agent's `_publish_state()` in `cli_runtime.py` already publishes to `lifecycle:{agent_id}` — add a `SET agent:state:{agent_id}` alongside the `PUBLISH`.

**Complexity:** Low
**Dependencies:** Modify `cli_runtime.py` `_publish_state()` to write state to Redis key; add Gateway endpoint to read it.

#### 2. `GET /auth/runtimes` — List Supported Runtimes with Auth Info

**Service:** Gateway :8080 (or Manager :8090 — TBD)
**Why needed:** UI should not hardcode per-runtime auth instructions. Backend knows the supported runtimes, credential paths, and auth commands.

**Request:**
```
GET /auth/runtimes
Authorization: Bearer <KUBEX_MGMT_TOKEN>
```

**Response 200:**
```json
[
  {
    "runtime": "claude-code",
    "display_name": "Claude Code",
    "auth_command": "claude auth login",
    "credential_source": "~/.claude/.credentials.json",
    "container_path": "/root/.claude/.credentials.json",
    "instructions": [
      "Open a terminal on your machine",
      "Run: claude auth login",
      "Complete the authentication in your browser",
      "Copy the contents of ~/.claude/.credentials.json",
      "Paste the JSON below"
    ],
    "credential_example": {
      "accessToken": "sk-ant-...",
      "refreshToken": "...",
      "expiresAt": "2026-04-26T00:00:00Z"
    }
  },
  {
    "runtime": "gemini-cli",
    "display_name": "Gemini CLI",
    "auth_command": "gemini auth login",
    "credential_source": "~/.gemini/oauth_creds.json",
    "container_path": "/root/.gemini/oauth_creds.json",
    "instructions": [
      "Open a terminal on your machine",
      "Run: gemini auth login",
      "Complete the Google OAuth in your browser",
      "Copy the contents of ~/.gemini/oauth_creds.json",
      "Paste the JSON below"
    ],
    "credential_example": {
      "access_token": "ya29...",
      "refresh_token": "...",
      "token_uri": "https://oauth2.googleapis.com/token"
    }
  },
  {
    "runtime": "codex-cli",
    "display_name": "Codex CLI",
    "auth_command": "codex auth login",
    "credential_source": "~/.codex/.credentials.json",
    "container_path": "/root/.codex/.credentials.json",
    "instructions": [
      "Open a terminal on your machine",
      "Run: codex auth login",
      "Complete the authentication in your browser",
      "Copy the contents of ~/.codex/.credentials.json",
      "Paste the JSON below"
    ],
    "credential_example": {
      "api_key": "sk-...",
      "organization": "org-..."
    }
  }
]
```

**Complexity:** Low — static data, no external calls
**Dependencies:** None

#### 3. `GET /auth/runtimes/{runtime}` — Single Runtime Auth Info

Same as above, filtered to one runtime. Returns 404 if runtime not recognized.

**Complexity:** Low

#### 4. Fix: `codex-cli` Missing from Agent-Side CREDENTIAL_PATHS

**File:** `agents/_base/kubex_harness/cli_runtime.py` line 53
**Issue:** Manager supports `codex-cli` credential injection (writes to `/root/.codex/.credentials.json`), but the agent's `CREDENTIAL_PATHS` dict only has `claude-code` and `gemini-cli`. The agent will never enter `CREDENTIAL_WAIT` for codex-cli — it just skips the credential gate entirely.
**Fix:** Add `"codex-cli": Path.home() / ".codex" / ".credentials.json"` to `CREDENTIAL_PATHS` and add a HITL auth message for codex-cli.
**Complexity:** Trivial

#### 5. Update Handoff Doc

Update `docs/HANDOFF-phase12-oauth-fe.md` with the new endpoints (state query, auth info) so the UI team can consume them.

### Implementation Order

1. Fix codex-cli CREDENTIAL_PATHS (trivial, unblocks agent-side)
2. Add `SET agent:state:{agent_id}` to `_publish_state()` (enables state query)
3. Add `GET /agents/{agent_id}/state` to Gateway
4. Add `GET /auth/runtimes` and `GET /auth/runtimes/{runtime}` to Gateway (or Manager)
5. Update handoff doc
6. Tests for all new endpoints

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| MCP Bridge features | HIGH | Official MCP spec + FastMCP docs + existing project design doc (design-mcp-bridge.md) |
| CLI Runtime features | HIGH | Official Claude Code hooks docs + Gemini CLI hooks docs + existing design doc (design-oauth-runtime.md) |
| Hooks monitoring (Claude Code) | HIGH | Official Anthropic hooks reference; full event schema verified |
| Hooks monitoring (Gemini CLI) | HIGH | Official Google hooks reference; BeforeTool/AfterTool confirmed |
| Codex CLI hooks | MEDIUM | Codex hooks system described as "experimental" in OpenAI docs; bidirectional MCP fallback is the safer bet |
| OAuth web flow | MEDIUM | Pattern is well-understood (Docker OAuth flows documented); specific Command Center implementation is project-specific |
| Lifecycle events | HIGH | Extends existing Redis pub/sub pattern already proven in Registry |

---

## Sources

- [MCP Python SDK (official)](https://github.com/modelcontextprotocol/python-sdk) — MEDIUM confidence
- [FastMCP production framework](https://gofastmcp.com/servers/tools) — MEDIUM confidence
- [MCP server build guide](https://modelcontextprotocol.io/docs/develop/build-server) — HIGH confidence (official spec)
- [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide) — HIGH confidence (official Anthropic docs, current)
- [Gemini CLI hooks reference](https://geminicli.com/docs/hooks/reference/) — HIGH confidence (official Google docs, current)
- [Codex CLI features](https://developers.openai.com/codex/cli/features) — MEDIUM confidence (experimental hooks)
- [ptyprocess library](https://ptyprocess.readthedocs.io/) — HIGH confidence (stable, widely used)
- [design-mcp-bridge.md](../docs/design-mcp-bridge.md) — HIGH confidence (primary project design source)
- [design-oauth-runtime.md](../docs/design-oauth-runtime.md) — HIGH confidence (primary project design source)
- [PROJECT.md](PROJECT.md) — HIGH confidence (current state snapshot, 2026-03-21)

---

*Feature research for: KubexClaw v1.2 MCP Bridge + CLI Runtime*
*Researched: 2026-03-21*
