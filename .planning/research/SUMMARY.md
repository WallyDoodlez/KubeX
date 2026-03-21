# Project Research Summary

**Project:** KubexClaw v1.2 — MCP Bridge + CLI Runtime
**Domain:** Agent infrastructure platform — brownfield addition to existing Python/Docker/FastAPI pipeline
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

KubexClaw v1.2 adds two orthogonal capabilities to a fully operational v1.1 system (789 tests, 5 live services, 4 agents): an MCP Bridge that replaces the orchestrator's custom 8-tool OpenAI function-calling loop with standard MCP protocol, and a CLI Runtime that lets any Kubex container run Claude Code, Codex CLI, or Gemini CLI as its LLM instead of direct API calls. Both features extend the existing stem cell architecture — specialization is config-driven via two new fields (`harness_mode: mcp-bridge`, `runtime: claude-code`) rather than new Docker images or new services. All existing workers remain unchanged on `harness_mode: standalone`. The dependency delta is exactly three new Python libraries (`mcp[cli]>=1.26`, `ptyprocess>=0.7`, `watchfiles>=1.1.1`) plus `claude-agent-sdk` for the Claude Code runtime.

The recommended build sequence is MCP Bridge first (validates MCP coordination in isolation using the existing OpenAI LLM — workers untouched), then CLI Runtime for Claude Code via the official `claude-agent-sdk` Python package (not raw PTY), then hooks-based monitoring, then Codex/Gemini runtimes, then OAuth web flow. The MCP Bridge phase carries the highest architectural risk because it replaces working orchestration code — the old custom tool loop must be kept live in parallel until full E2E parity is verified against all 789 existing tests. The CLI Runtime phases carry operational risk from OAuth token management, PTY signal handling, and hook injection security.

The three sharpest risks require design decisions before any code ships: (1) MCP tool timeouts crashing the bridge process during long-running policy escalations — requires an async task_id pattern rather than holding tool calls open, and this must be the primary design from the start, not a retrofit; (2) hook scripts becoming a prompt injection amplifier (CVE-2025-59536, CVE-2026-21852 confirmed) — requires read-only hook config mounts and static pipe-relay hook scripts; and (3) in-process vault writes bypassing the Gateway policy engine — requires either a Gateway vault write endpoint or replicated injection scanning in the MCP bridge write handlers.

## Key Findings

### Recommended Stack

The v1.2 stack is a minimal brownfield addition. Three new Python libraries are required: `mcp[cli]>=1.26` (official Anthropic MCP SDK, covers FastMCP server decorator API for workers and `ClientSession` for the orchestrator bridge), `ptyprocess>=0.7` (PTY subprocess management for non-SDK CLI runtimes), and `watchfiles>=1.1.1` (async-native credential file watching via `awatch()` generator, optional substitute with `os.path.exists` polling). For the Claude Code runtime specifically, `claude-agent-sdk` is required — using raw PTY to spawn `claude` is explicitly documented as the wrong approach because terminal output uses ANSI codes and interactive prompts that make stdout parsing fragile and version-dependent. No new services. No new Docker images. The only service-level change is adding `PUBLISH registry:agent_changed` to `services/registry/registry/store.py` on register/deregister events.

**Core new technologies:**
- `mcp[cli]>=1.26`: MCP server (FastMCP decorator API) + MCP client (`ClientSession`) — official Anthropic SDK, v1.x stable, v2 is pre-alpha, do not use
- `claude-agent-sdk`: Structured NDJSON subprocess interface to Claude Code CLI — required for `claude-code` runtime; raw PTY is the anti-pattern
- `ptyprocess>=0.7`: PTY subprocess for `codex-cli` and `gemini-cli` where no SDK exists — Unix only, all Kubex containers are Linux
- `watchfiles>=1.1.1`: Rust-backed asyncio-native `awatch()` generator for credential directory monitoring — optional if Rust extension is undesirable (polling works)
- Claude Code Hooks (HTTP type): Zero-token passive monitoring via `PostToolUse`, `Stop`, `SessionEnd` — no new library, written as JSON to `.claude/settings.json` at container boot

### Expected Features

**Must have (table stakes) — MCP Bridge:**
- MCP server in harness exposing one tool per registered worker agent (capability = tool name, description from `config.yaml`)
- `harness_mode: mcp-bridge` config routing in `main.py`; `description` field added to all worker `config.yaml` files
- All worker delegations still route through Gateway `POST /actions` — no policy bypass whatsoever
- Async task_id dispatch pattern (tool call returns task_id immediately; separate `kubex__poll_task` tool checks status) — required to prevent bridge crash on long-running tasks
- Vault tools exposed as in-process MCP tools with policy check enforced (Gateway endpoint or inline injection scan)
- Tool cache invalidated on new agent registration via Registry pub/sub (`registry:agent_changed`)
- Old custom tool loop kept alive in parallel until MCP bridge passes full E2E parity against all 789 tests

**Must have (table stakes) — CLI Runtime:**
- PTY-based subprocess launch via `ptyprocess` for codex-cli and gemini-cli; `claude-agent-sdk.query()` for claude-code
- `runtime` config field in `config.yaml` with routing in `main.py`
- Credential check at startup with HITL re-auth via existing `request_user_input`
- Failure pattern detection per CLI type with typed `reason` in `task_failed` payload (`subscription_limit`, `auth_expired`, `cli_crash`, `runtime_not_available`)
- Explicit SIGTERM handler: forward to PTY child → wait 5s → SIGKILL → exit harness; exec-form CMD + `tini` as PID 1

**Should have (differentiators):**
- Concurrent tool dispatch via `asyncio.gather()` for parallel worker delegation
- Meta-tools: `kubex__list_agents`, `kubex__agent_status`, `kubex__cancel_task`
- Hooks-based monitoring for Claude Code (`PostToolUse`, `Stop`, `SessionEnd`) — zero prompt tokens, read-only hook config mount
- Skills injected as `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` at spawn — extends existing stem cell skill injection
- Named Docker volumes for OAuth token persistence across container restarts (one volume per agent_id)
- Lifecycle events: `cli_starting`, `cli_ready`, `cli_stopped`, `cli_timeout` via Redis pub/sub
- Container lifecycle state machine: `BOOTING → CREDENTIAL_WAIT → READY ↔ BUSY`

**Defer (v2+):**
- Worker "need_info" cross-Kubex collaboration protocol — not yet designed
- OAuth Command Center web flow — `docker exec` + HITL works; web flow is UX polish
- Bidirectional MCP for Codex CLI — complex, Codex is third-priority CLI
- Tool output `outputSchema` validation — add after core bridge is stable
- Gemini CLI hooks — same pattern as Claude Code hooks but lower priority
- SSE streaming of CLI stdout — explicitly Out of Scope per PROJECT.md

### Architecture Approach

The architecture introduces two new orthogonal config axes: `harness_mode` controls the task coordination model (standalone = existing poll-LLM-store loop; mcp-bridge = `MCPBridgeServer` runs in-process) and `runtime` controls the LLM invocation method (openai-api = existing HTTP path; claude-code = Agent SDK subprocess; codex-cli / gemini-cli = raw PTY subprocess). These axes are orthogonal by design — the valid v1.2 combinations are `mcp-bridge` + `openai-api` (Phase 1) and `mcp-bridge` + `claude-code` (Phase 2 onward). The invalid combination `standalone` + `claude-code` must be caught at boot with a clear error. `MCPBridgeServer` runs in-process inside the orchestrator container — not as a sidecar service — and exposes three tool categories: worker delegation tools (one per registered agent, dispatches via Broker), vault direct tools (in-process `vault_ops` calls with policy gate), and meta-tools (thin Registry/Broker HTTP wrappers). Workers receive zero changes.

**Major new components:**
1. `agents/_base/kubex_harness/mcp_bridge.py` — `MCPBridgeServer` class; FastMCP server; Registry pub/sub subscription for live tool cache invalidation; concurrent dispatch via `asyncio.gather()`
2. `agents/_base/kubex_harness/cli_runtime.py` — `CLIRuntime` base + per-runtime strategies; `claude-agent-sdk.query()` for claude-code; `asyncio.create_subprocess_exec()` for codex/gemini; credential gate at boot; failure pattern detection
3. `agents/_base/kubex_harness/hooks_configurator.py` — writes and deep-merges `.claude/settings.json` idempotently; marks harness hooks with `_kubex_managed: true`; mounts config read-only
4. `agents/_base/kubex_harness/credential_watcher.py` — watches OAuth credential directories via `watchfiles.awatch()`; signals `asyncio.Event` to `CLIRuntime`

### Critical Pitfalls

1. **MCP tool timeouts crash the bridge process** — Worker tasks can take minutes (human policy escalation). MCP default timeouts (10-30s) fire, triggering uncaught `CancelledError` on the cancellation path, crashing the bridge and orphaning all in-flight tasks (SDK Issue #212 confirmed production). Prevention: async task_id pattern (tool call returns ID immediately; `kubex__poll_task` checks status); wrap all handlers in `try/except Exception`; set `MCP_TOOL_TIMEOUT` to 300s minimum. Must be the primary design from day one, not a retrofit.

2. **Hook scripts as prompt injection amplifier (CVE-2025-59536, CVE-2026-21852)** — Malicious task content can cause the CLI to rewrite `.claude/settings.json`, injecting hook commands that execute as arbitrary shell code with container-process permissions. Prevention: mount hook config read-only (`.claude/settings.json:ro`); hook scripts must be static pipe-relay executables with no string interpolation of task content; validate all hook event payloads against JSON schema before processing.

3. **Gateway policy bypass for in-process vault writes** — MCP bridge calling `vault_ops` directly skips the Gateway injection scan and audit log, creating an unguarded write path for a prompt-injected orchestrator. Prevention: route vault writes through a Gateway endpoint that runs policy evaluation, or replicate the injection scan inline in MCP bridge vault write handlers. Reads can remain in-process.

4. **Docker PID 1 signal blindness kills CLI subprocess without cleanup** — Shell-form CMD makes the shell PID 1, which does not forward SIGTERM to the Python harness. Prevention: exec-form CMD; add `tini` as PID 1 wrapper in base image; implement explicit SIGTERM handler in harness that forwards to PTY child, waits 5s, then SIGKILL; set `stop_grace_period: 30s` for CLI runtime agents.

5. **Replacing the working tool loop without a feature parity gate** — MCP bridge can pass all new MCP-specific unit tests while silently breaking existing orchestration workflows (ESCALATE → human approval → resume, concurrent worker dispatch, vault CRUD). Prevention: write parity integration tests for every current orchestrator workflow; run the full 789-test E2E suite against `harness_mode: mcp-bridge` before deleting the custom tool loop. Deletion is the final step, not the first.

## Implications for Roadmap

Based on combined research, the suggested phase structure follows the dependency chain documented in FEATURES.md and ARCHITECTURE.md:

### Phase 1: MCP Bridge (API Runtime)

**Rationale:** Replaces the orchestrator's custom tool loop with MCP protocol while keeping the existing OpenAI LLM. Validates the entire MCP coordination layer — tool discovery, worker delegation via Broker, vault direct tools, Registry pub/sub cache invalidation — in isolation with no CLI runtime complexity. Workers are completely unchanged. If the bridge breaks, only the orchestrator is affected and the old `standalone` mode is immediate fallback.

**Delivers:** Orchestrator running `harness_mode: mcp-bridge` + `runtime: openai-api`; `MCPBridgeServer` with all three tool categories; async task_id dispatch pattern; live agent discovery via Registry pub/sub; full 789-test suite passing against new code path; old custom tool loop deleted after parity verified.

**Features addressed:** All MCP Bridge table stakes + concurrent dispatch + meta-tools. Vault tool policy gate is a security requirement, not optional.

**Pitfalls to pre-empt (all must be resolved before any code ships):** MCP tool timeout crash (async task_id pattern); policy bypass for vault writes (Gateway routing or inline scan decided explicitly); replacing tool loop without parity gate (golden prompt routing tests + full E2E suite before deletion).

**Research flag:** Standard patterns — MCP SDK is well-documented via official spec and official Anthropic docs (HIGH confidence). No phase-research needed.

---

### Phase 2: CLI Runtime — Claude Code via Agent SDK

**Rationale:** Adds Claude Code as an LLM runtime using the official `claude-agent-sdk`, which provides structured NDJSON output and avoids PTY parsing fragility. `MCPBridgeServer` from Phase 1 is reused — the Claude Code CLI connects to it as an MCP client. Phase 2 only adds `CLIRuntime`, `CredentialWatcher`, and `HooksConfigurator`. Depends on Phase 1.

**Delivers:** Orchestrator running `mcp-bridge` + `claude-code`; credential gate at boot with HITL re-auth; named Docker volumes for OAuth token persistence; container lifecycle state machine; lifecycle events (`cli_starting`, `cli_ready`, `cli_stopped`) via Redis pub/sub; skills injected as `CLAUDE.md` at spawn.

**Stack required:** `claude-agent-sdk` + `watchfiles>=1.1.1` added to `pyproject.toml`.

**Pitfalls to pre-empt:** Docker PID 1 signal blindness (exec-form CMD + tini + explicit SIGTERM handler must be implemented before kill switch integration test); OAuth token never as env var (named volume pattern established before first auth flow); bidirectional MCP startup race (MCP server readiness gate before CLI spawn).

**Research flag:** Standard patterns for credential watching. Known gotcha: `CLAUDECODE=1` env var inheritance bug (SDK Issue #573) — must unset env var via `env=filtered_env` in `query()` call. HIGH confidence overall, one known bug with known fix.

---

### Phase 3: Hooks Monitoring

**Rationale:** Once Claude Code CLI runtime is working (Phase 2), hooks provide zero-token passive observability into tool invocations, turn completion, and session end. The security constraints (read-only mount, no string interpolation in hook scripts, JSON schema validation of hook payloads) are cleaner as a focused phase rather than mixed into Phase 2.

**Delivers:** `PostToolUse`, `Stop`, `SessionEnd` hook events received at harness HTTP endpoint (`localhost:8099`); `task_progress` lifecycle events from `Stop` hook; audit trail of CLI tool invocations; hook config mounted read-only enforced.

**Pitfalls to pre-empt:** Hook scripts as injection amplifier — read-only hook config mount and static pipe-relay hook scripts must be the initial implementation, not added after observing injection attempts.

**Research flag:** Standard patterns — official Claude Code hooks reference is HIGH confidence. No phase-research needed.

---

### Phase 4: Codex CLI and Gemini CLI Runtimes

**Rationale:** Extends `CLIRuntime` to the two remaining CLI types via raw `asyncio.create_subprocess_exec()` (no equivalent Python SDK). Different credential paths, config file formats (Codex TOML, Gemini JSON), and output parsers per CLI. Additive — failure here does not affect Phases 1-3.

**Delivers:** `runtime: codex-cli` and `runtime: gemini-cli` support; per-CLI failure pattern libraries; hooks monitoring for Gemini CLI; bidirectional MCP fallback for Codex CLI (harness as FastMCP server); PTY fallback via `ptyprocess` if CLI detects non-TTY.

**Pitfalls to pre-empt:** PTY buffer deadlock for large CLI output (stress test with >100KB output before declaring done); Codex hooks experimental (bidirectional MCP fallback is the reliable path — treat hooks as bonus).

**Research flag:** Needs phase-research. Codex CLI hook spec is marked "experimental" in OpenAI docs (MEDIUM confidence). Gemini CLI MCP support is confirmed but less stable than Claude Code. Run `/gsd:research-phase` before planning Phase 4 to verify current hook/MCP spec status for both CLIs.

---

### Phase 5: OAuth Command Center Web Flow

**Rationale:** Replaces `docker exec` HITL OAuth with a web-based flow through Command Center UI. Lowest urgency — the HITL docker exec flow from Phase 2 works. This is a UX improvement requiring a new Command Center component, a Gateway token relay endpoint, and Kubex Manager spawn parameter changes.

**Delivers:** Command Center OAuth UI; Gateway `/oauth/token` relay endpoint; Kubex Manager spawn endpoint accepts token parameter; pre-provisioned containers start in READY state without CREDENTIAL_WAIT. Also: pre-flight expiry check before task dispatch to CLI agents; `task_id` idempotency keys for vault writes to handle mid-task token expiry cleanly.

**Pitfalls to pre-empt:** OAuth token mid-task expiry and idempotency gaps — pre-flight expiry check and idempotency key design must be resolved at Phase 5 planning, not discovered from duplicate vault entries in production.

**Research flag:** Needs phase-research for Command Center web OAuth UI — project-specific frontend component. Run `/gsd:research-phase` before planning Phase 5.

---

### Phase Ordering Rationale

- Phase 1 before Phase 2: `MCPBridgeServer` must exist before any CLI runtime can connect to it as an MCP client. `mcp-bridge` + `openai-api` validates the bridge machinery without CLI complexity.
- Phases 2-4 sequential by CLI priority: Claude Code has the most stable integration surface (official SDK, HTTP hooks, HIGH-confidence official docs) and highest strategic value. Codex and Gemini are additive.
- Phase 3 (hooks) after Phase 2 (CLI runtime): hooks require a running Claude Code runtime to test meaningfully. Separating them keeps Phase 2 focused on the subprocess supervision problem.
- Phase 5 last: replaces HITL `docker exec` with web OAuth — a UX improvement with no functional gap. Never blocks other phases.
- All three design-level decisions (async task_id pattern, vault write policy gate, hook config read-only mount) must be resolved at the start of their respective phases — not mid-implementation.

### Research Flags

Phases needing deeper research during planning:
- **Phase 4 (Codex/Gemini runtimes):** Codex CLI hooks are experimental (MEDIUM confidence). Gemini CLI MCP config format and hook system confirmed but integration surface changes frequently. Run `/gsd:research-phase` before planning Phase 4 tasks.
- **Phase 5 (OAuth web flow):** Command Center frontend is project-specific. No standard off-the-shelf reference for web OAuth flow into Docker containers. Run `/gsd:research-phase` before planning Phase 5.

Phases with standard patterns (skip research-phase):
- **Phase 1 (MCP Bridge):** Official MCP SDK, official spec, HIGH confidence across all sources.
- **Phase 2 (Claude Code CLI):** Official `claude-agent-sdk`, official hooks docs, HIGH confidence. Known gotcha (env var bug #573) already identified and fix is known.
- **Phase 3 (Hooks monitoring):** Official Claude Code hooks reference, HIGH confidence. Direct HTTP hook type confirmed with exact JSON schema.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All libraries verified on PyPI; versions confirmed; official SDKs. `watchfiles` Rust extension pre-built wheels confirmed for Linux amd64/arm64. One optional substitution (polling vs watchfiles). |
| Features | HIGH | Grounded in official MCP spec, official Claude Code hooks docs, and existing project design docs (`design-mcp-bridge.md`, `design-oauth-runtime.md`). Codex CLI hooks are the only MEDIUM item. |
| Architecture | HIGH | Existing codebase read directly. Component boundaries are precise (file paths, class names, exact changes identified). `CLAUDECODE=1` env var bug (#573) is a live open issue — confirmed. |
| Pitfalls | HIGH | 10 pitfalls, all grounded in confirmed CVEs (CVE-2025-59536, CVE-2026-21852), confirmed GitHub issues (MCP SDK #212, claude-code #12447, #17662), and direct design doc analysis. |

**Overall confidence:** HIGH

### Gaps to Address

- **Async task_id pattern design:** Pitfall research strongly recommends async task_id (tool returns ID immediately; separate poll tool checks status) but the existing design docs do not fully specify how the orchestrator LLM manages this two-step flow. Must be resolved during Phase 1 planning before any implementation — this is a protocol design decision, not an implementation detail.
- **Vault write policy gate implementation choice:** Two options identified (Gateway endpoint route vs inline injection scan in MCP bridge). Design docs flag this as an open gap. The implementation team must make an explicit choice at the start of Phase 1 — it affects how all vault tool handlers are written.
- **`CLAUDECODE=1` env var inheritance (SDK bug #573):** Open GitHub issue. Fix (`env=filtered_env` on `query()`) is straightforward but must be applied and verified in Phase 2 integration tests. Track as a known issue on Phase 2.
- **Codex CLI hooks stability:** Marked "experimental" in OpenAI docs. Phase 4 plan should include a decision gate: if hooks remain experimental at Phase 4 planning time, skip to bidirectional MCP fallback as primary strategy.

## Sources

### Primary (HIGH confidence)
- [MCP Python SDK — PyPI](https://pypi.org/project/mcp/) — version 1.26.0, FastMCP API patterns, transport options
- [MCP Python SDK — GitHub](https://github.com/modelcontextprotocol/python-sdk) — client/server API, concurrent tool call patterns
- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) — `claude_agent_sdk.query()` API, hooks callbacks, MCP server injection
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — 21 hook events, HTTP hook type, JSON config format, async flag
- [Gemini CLI hooks reference](https://geminicli.com/docs/hooks/reference/) — BeforeTool/AfterTool confirmed
- [ptyprocess — PyPI](https://pypi.org/project/ptyprocess/) — version 0.7.0, Unix PTY subprocess
- [watchfiles — GitHub](https://github.com/samuelcolvin/watchfiles) — version 1.1.1, asyncio awatch, Rust-backed
- [Caught in the Hook: RCE via Claude Code Project Files (CVE-2025-59536, CVE-2026-21852)](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — hook injection attack surface, Check Point Research January 2026
- Existing KubexClaw codebase: `agents/_base/kubex_harness/`, `services/registry/`, `docs/design-mcp-bridge.md`, `docs/design-oauth-runtime.md`

### Secondary (MEDIUM confidence)
- [MCP Tool timeout causing MCP server disconnect — SDK Issue #212](https://github.com/modelcontextprotocol/python-sdk/issues/212) — timeout/crash confirmed production issue
- [OAuth token expiration disrupts autonomous workflows — claude-code Issue #12447](https://github.com/anthropics/claude-code/issues/12447) — 8-12 hour expiry, no pause/resume
- [Claude Agent SDK bug #573 — CLAUDECODE=1 env inheritance](https://github.com/anthropics/claude-agent-sdk-python/issues/573) — open issue, fix identified
- [The Silent Breakage: MCP Tool Versioning](https://minherz.medium.com/the-silent-breakage-a-versioning-strategy-for-production-ready-mcp-tools-fbb998e3f71f) — description changes cause silent LLM routing breakage
- [Codex CLI features](https://developers.openai.com/codex/cli/features) — hooks marked experimental
- [FastMCP vs MCP SDK discussion](https://github.com/PrefectHQ/fastmcp/discussions/2557) — FastMCP 2.0 scope comparison

### Tertiary (LOW confidence)
- None — all findings have at least MEDIUM confidence backing.

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
