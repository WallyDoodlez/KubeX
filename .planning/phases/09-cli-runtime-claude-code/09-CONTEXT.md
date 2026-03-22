# Phase 9: CLI Runtime — Claude Code - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a generic CLI runtime layer in the harness so any Kubex container configured with `runtime: <cli-name>` can launch that CLI as a PTY subprocess, manage its lifecycle, stream output, handle credentials, and report results. Claude Code is the first runtime validated end-to-end. Codex and Gemini CLI runtimes are Phase 11.

</domain>

<decisions>
## Implementation Decisions

### Task Delivery & Session Model
- **D-01:** Fresh process per task — spawn CLI, feed task, collect result, kill. No state leaks between tasks. Matches stem cell philosophy.
- **D-02:** Task fed to CLI as a CLI argument (e.g. `claude --prompt "do X"`). Each runtime type defines its own argument format in config.
- **D-03:** Full stdout buffer captured and wrapped in standard JSON envelope (`{status, result, metadata}`) on process exit. Stdout is accumulated while simultaneously being streamed.

### Credential Flow & Boot Sequence
- **D-04:** Credential detection by checking known file paths per CLI type (`~/.claude/`, `~/.codex/`, `~/.config/gemini/`). Files must exist and be non-empty. No token content parsing.
- **D-05:** Credential paths MUST be in `.gitignore` — never committed to version control.
- **D-06:** On missing credentials, harness sends `request_user_input` HITL action asking user to `docker exec -it` and authenticate. File watcher (watchfiles) monitors credential directory for file appearance.
- **D-07:** Credential volumes are per-agent (named volume per agent_id: `kubex-creds-{agent_id}`). Each agent has its own isolated OAuth session.
- **D-08:** Linear gate boot sequence:
  1. BOOTING — read config.yaml
  2. Install boot-time deps (trusted)
  3. Load skills → write CLAUDE.md (or AGENTS.md / GEMINI.md per CLI type)
  4. Check credential files
     - missing? → CREDENTIAL_WAIT → HITL request + file watcher
  5. READY — register with Registry
  6. Start consuming tasks from Broker
  7. On task: BUSY → spawn CLI → collect result → READY

### Progress & Observability
- **D-09:** Phase 9 includes basic stdout streaming — chunks POSTed to `POST /tasks/{task_id}/progress` as they arrive. Command Center subscribes via existing SSE endpoint.
- **D-10:** Stdout chunks are time-batched (e.g. 500ms buffer window) to reduce network overhead while maintaining near-real-time visibility.
- **D-11:** Raw ANSI passthrough — no stripping of color codes or terminal escapes. Command Center renders with terminal emulator component (xterm.js). Orchestrator output should show colors to the user.
- **D-12:** Lifecycle state transitions (BOOTING, CREDENTIAL_WAIT, READY, BUSY) published to existing `lifecycle:{agent_id}` Redis pub/sub channel. Command Center subscribes to one channel for all agent state.

### Failure Detection
- **D-13:** Hybrid exit code + output scan — check exit code first, then scan last N lines of output against known patterns ONLY on non-zero exit. Avoids regex maintenance burden of scanning all output.
- **D-14:** Failure patterns are loose and configurable (not hardcoded regex). CLIs evolve; deterministic rules would require constant chasing of updates.
- **D-15:** Retry once on general failure (non-zero exit), then report `task_failed` with detected reason. Fresh CLI process for retry.
- **D-16:** Auth-expired failures bypass retry — go straight to HITL re-auth flow. Transition to CREDENTIAL_WAIT state. Retrying with expired creds is pointless.
- **D-17:** Failure reason types: `subscription_limit`, `auth_expired`, `cli_crash`, `runtime_not_available` — reported in `task_failed` payload.

### Claude's Discretion
- Exact time-batch window for stdout chunks (500ms suggested, tunable)
- Per-CLI argument format mapping (config-driven)
- File watcher implementation details (watchfiles vs polling fallback)
- HITL message wording for credential requests
- Exact output scan heuristics for failure classification
- Signal forwarding implementation (SIGTERM → PTY child → 5s grace → SIGKILL)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### CLI Runtime Design
- `docs/design-oauth-runtime.md` — Full architecture: CLIRuntime subprocess manager, credential flow, failure handling, security considerations, implementation scope

### MCP Bridge Integration
- `agents/_base/kubex_harness/mcp_bridge.py` lines 66-72 — Transport selection logic (runtime != "openai-api" → stdio). Phase 9 builds the subprocess that connects to this.
- `agents/_base/kubex_harness/mcp_bridge.py` line 948 — `run_stdio_async()` ready for CLI agents
- `.planning/phases/08-mcp-bridge/08-CONTEXT.md` — Phase 8 decisions: D-13 (dual transport), D-12 (workers stay standalone)

### Harness & Config
- `agents/_base/kubex_harness/main.py` — Entry point, harness_mode routing, signal handlers
- `agents/_base/kubex_harness/harness.py` — Existing PTY harness skeleton (incomplete, extend this)
- `libs/kubex-common/kubex_common/schemas/config.py` — AgentConfig with `runtime` field (line 88)
- `agents/_base/kubex_harness/config_loader.py` — Config loading, already reads `runtime` field

### Container Lifecycle
- `services/kubex-manager/kubex_manager/lifecycle.py` — Container spawning, volume mounts, credential path support
- `docker-compose.yml` — Network topology, service definitions (needs named volumes for OAuth)

### Existing Patterns
- `libs/kubex-common/kubex_common/schemas/events.py` — ProgressUpdate and LifecycleEvent schemas
- `services/gateway/gateway/main.py` lines 678-723 — SSE stream endpoint and progress reception

### Security & Pitfalls
- `.planning/research/PITFALLS.md` — PID 1 signal blindness, hook RCE prevention
- `agents/_base/kubex_harness/standalone.py` lines 604-611 — Existing signal handling pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcp_bridge.py` transport selection: Already routes `runtime != "openai-api"` to stdio mode — Phase 9 builds the subprocess that connects here
- `main.py` signal handlers: SIGTERM/SIGINT handling with graceful shutdown — extend for subprocess forwarding
- `harness.py` skeleton: HarnessConfig dataclass, ExitReason enum, PTY import with Windows fallback — incomplete but foundational
- `lifecycle.py` volume mounting: Per-provider credential path support exists — add named Docker volumes
- `events.py` schemas: ProgressUpdate (chunk_type, content, sequence) and LifecycleEvent already defined

### Established Patterns
- `harness_mode` routing in main.py (import-and-instantiate per mode)
- Config.yaml sole source of truth (runtime field already in schema)
- Gateway as sole ingress for all actions (POST /actions for HITL)
- Broker dispatch by capability name
- Lifecycle events on `lifecycle:{agent_id}` Redis pub/sub channel

### Integration Points
- `main.py`: Add CLI runtime routing when `runtime` is not `openai-api`
- `mcp_bridge.py`: Subprocess spawning before `run_stdio_async()` for CLI runtimes
- `docker-compose.yml`: Add named volumes for credential persistence
- `config_loader.py`: No changes needed — `runtime` field already supported
- `.gitignore`: Add credential directory patterns

</code_context>

<specifics>
## Specific Ideas

- The PTY runtime is generic — Claude Code is the test case, but the same infrastructure handles any CLI. Phase 11 just adds Codex/Gemini-specific argument formats and credential paths.
- PTY input must simulate human typing (backspaces, typos, variable delays) per project memory — this prevents CLIs from detecting automated input.
- Raw ANSI passthrough is intentional — the Command Center should render terminal output with colors, not sanitized plain text. Plan must include this as a requirement.
- Command Center UI work is handled by a separate agent in a different repo. Phase 9 only builds the backend streaming pipeline (harness → Gateway → Redis pub/sub → SSE). The frontend subscription is out of scope here.

</specifics>

<deferred>
## Deferred Ideas

- **Hooks-based monitoring** — Phase 10. Rich tool-level events (PostToolUse, Stop, SessionEnd) from Claude Code hooks. Phase 9 provides basic stdout streaming only.
- **Codex + Gemini runtimes** — Phase 11. Phase 9 builds the generic CLIRuntime; Phase 11 adds per-CLI configs.
- **OAuth web flow** — Phase 12. Phase 9 uses docker-exec for auth; Phase 12 adds Command Center web UI provisioning.
- **Real-time PTY output forwarding** — Explicitly out of scope per REQUIREMENTS.md. Phase 9 does time-batched chunks, not raw byte streaming.

</deferred>

---

*Phase: 09-cli-runtime-claude-code*
*Context gathered: 2026-03-22*
