# Pitfalls Research

**Domain:** MCP Bridge + CLI Runtime — adding MCP protocol and PTY-based CLI agents to an existing Docker-based agent platform
**Researched:** 2026-03-21
**Confidence:** HIGH (findings grounded in direct design doc analysis, confirmed CVEs, and verified community issue trackers)

---

## Critical Pitfalls

### Pitfall 1: MCP Tool Timeouts Kill the Entire Process Instead of Returning an Error

**What goes wrong:**
Worker tasks dispatched via MCP can take minutes (policy escalation waiting for human approval, long-running CLI tasks). The default MCP SDK tool call timeout is 10–30 seconds depending on the client. When the timeout fires, some MCP SDK versions throw an exception on the cancellation path that is not caught, causing the entire MCP bridge process to exit rather than returning a timeout error to the LLM. This has been documented as a production issue in the MCP Python SDK (Issue #212: "Tool timeout within 10 seconds causing MCP server disconnect").

The cascade: orchestrator LLM calls `engineer` tool → MCP bridge dispatches to Broker → engineer agent awaits human policy approval (takes 5 minutes) → MCP client times out → exception on cancellation path → MCP bridge crashes → orchestrator container enters crash-restart loop → all in-flight tasks are orphaned in the Broker with no one to collect results.

**Why it happens:**
MCP was designed for fast, synchronous tool calls (file reads, API lookups). The KubexClaw worker delegation pattern is inherently async and long-running. The MCP spec has no native concept of "I dispatched this task, come back in 10 minutes." This mismatch must be explicitly handled by the bridge implementation.

**How to avoid:**
The MCP bridge must implement an async polling pattern: `tools/call("engineer", ...)` immediately returns a task_id, and a separate `kubex__poll_task(task_id)` tool lets the LLM check status. Do not hold the tool call open waiting for the worker result. Wrap all tool handler code in `try/except Exception` so that any cancellation or timeout exception is caught and returned as a structured error content block, never as an unhandled exception that crashes the bridge. Set `MCP_TOOL_TIMEOUT` to 300s minimum to match realistic policy escalation windows. Reference: FastMCP 2.14 background task pattern.

**Warning signs:**
- MCP bridge container restarts unexpectedly during E2E tests with human-in-the-loop scenarios
- `asyncio.CancelledError` appears in bridge logs without a corresponding error response being sent
- Orphaned task IDs accumulate in Redis with no result written

**Phase to address:**
MCP Bridge Phase — the async task_id pattern must be the primary design, not added as a fix after observing timeouts in testing.

---

### Pitfall 2: PTY Buffer Deadlock When CLI Produces Large Output in Docker

**What goes wrong:**
When the harness spawns Claude Code or Codex CLI via PTY (using `ptyprocess` or `pexpect`), the PTY has a kernel buffer. If the CLI produces output faster than the harness reads it (e.g., a verbose code generation task producing thousands of lines), the buffer fills. The CLI blocks waiting to write, the harness is blocked waiting for the CLI to complete, and neither makes progress — a classic deadlock. This does not reproduce reliably in local tests (which use short outputs) but manifests in production on real coding tasks.

Additionally, `subprocess.communicate()` does not work with PTYs — it will deadlock as documented. `subprocess.Popen` without PTY allocation causes interactive CLIs (Claude Code, Codex) to fail outright because they detect the absence of a TTY and either refuse to run or fall back to a non-interactive mode that does not support hooks.

**Why it happens:**
PTY buffer management requires explicit non-blocking I/O with `select()`. Most naive PTY implementations use blocking reads. The Python stdlib `pty` module requires the caller to handle this. `ptyprocess`/`pexpect` handle it, but require the output to be consumed continuously in a separate thread or via the `pexpect.expect()` loop — not by waiting for process completion.

**How to avoid:**
Use `pexpect.spawn()` with a dedicated output-draining loop running in a thread. Never call `.wait()` or `.communicate()` on a PTY subprocess. Set a large PTY window size (e.g., 200 columns x 10000 rows) to reduce line-wrapping artifacts in output parsing. Use `pexpect.read_nonblocking()` with a timeout loop that accumulates output into a buffer. Cap total output at a configurable limit (e.g., 1MB) and truncate with a warning rather than reading unboundedly into memory.

**Warning signs:**
- CLI task hangs indefinitely with no timeout being triggered
- `select()` calls on the PTY file descriptor never return readable in the harness reader loop
- Memory usage for a CLI runtime harness process grows unboundedly during a long task

**Phase to address:**
CLI Runtime Phase — the PTY I/O model must be stress-tested with large outputs before declaring the feature ready. Include a test that runs a CLI command producing >100KB of output.

---

### Pitfall 3: Docker PID 1 Signal Blindness — CLI Subprocess Does Not Receive SIGTERM

**What goes wrong:**
When `docker stop` is issued (kill switch, graceful shutdown), Docker sends SIGTERM to PID 1 in the container. If PID 1 is the Python harness launched via `python main.py` (shell form CMD), the shell becomes PID 1 and does not forward signals. The harness never receives SIGTERM. Docker waits 10 seconds (default), then sends SIGKILL — abruptly killing everything including the CLI subprocess mid-task. In-flight work is lost, OAuth token files may be partially written, vault operations may be half-committed.

Even if the harness correctly receives SIGTERM, it must propagate it to the CLI subprocess (the PTY child process) before exiting. A naive `sys.exit()` in the SIGTERM handler kills the harness without cleaning up the child process, which becomes a zombie owned by PID 1 of the container.

**Why it happens:**
This is the well-known Docker PID 1 signal handling problem. It is not specific to PTY or MCP, but becomes critical when a long-running CLI subprocess is involved. The existing harness was never a PTY supervisor — adding that role requires explicit signal handling design.

**How to avoid:**
Use exec form CMD in the Dockerfile: `CMD ["python", "-m", "kubex_harness.main"]` (not shell form). Add `tini` or `dumb-init` as PID 1 wrapper in the base image: `ENTRYPOINT ["/usr/bin/tini", "--"]`. In the harness SIGTERM handler: (1) send SIGTERM to the PTY child process, (2) wait up to 5 seconds for it to exit cleanly, (3) if still running, send SIGKILL, (4) then exit the harness. Extend Docker's stop timeout: `stop_grace_period: 30s` in docker-compose for CLI runtime agents.

**Warning signs:**
- `docker stop` takes 10+ seconds (full timeout) before container exits — signal is not being delivered
- CLI subprocess appears in `docker top` after SIGTERM is sent to the harness
- Vault git commits are found in a corrupted state after a container kill

**Phase to address:**
CLI Runtime Phase — signal handling must be implemented before the kill switch integration test, not discovered when kill switch E2E tests fail.

---

### Pitfall 4: OAuth Tokens Exposed via Docker Inspect and Environment Variables

**What goes wrong:**
The design stores OAuth tokens in `~/.claude/` (and equivalent paths for other CLIs). In a Docker container, this path is inside the container filesystem. If a developer passes the OAuth token as an environment variable for convenience (a natural temptation to avoid the interactive auth flow), the token is immediately visible via `docker inspect <container_id>`, in Gateway logs if the harness echoes env vars on startup, and in any process listing (`/proc/<pid>/environ`). This is categorically different from API keys: OAuth tokens for subscription plans grant access to the human user's full account, not just API credits.

**Why it happens:**
Developers reaching for env vars to inject credentials is the default reflex — it's how API keys work today. The OAuth flow requires a browser interaction that does not fit neatly into automation. The temptation to capture the token once and inject it as `CLAUDE_OAUTH_TOKEN` is high. This approach is documented as a critical Docker security mistake: credentials baked into env vars are visible to anyone with Docker daemon access.

**How to avoid:**
Never accept OAuth tokens as env vars. The only supported provisioning path is the HITL flow: container starts, harness detects missing credentials, sends `request_user_input`, user `docker exec`s into container and completes browser-based OAuth. Token is written to `~/.claude/` by the CLI itself. Mount `~/.claude/` as a named Docker volume so tokens persist across container restarts without requiring re-auth. Name the volume per agent_id (e.g., `kubex-oauth-claude-orchestrator`) so tokens are isolated between agents.

**Warning signs:**
- Harness config or startup code references an env var like `CLAUDE_TOKEN`, `CODEX_TOKEN`, or similar
- `docker inspect` output for CLI runtime containers shows auth-related env vars
- Container restarts require re-authentication on every boot (token not persisted to a volume)

**Phase to address:**
OAuth Provisioning Phase — the named volume pattern must be established before the first OAuth flow is implemented. Do not implement "env var as fallback" even for development.

---

### Pitfall 5: Hook Scripts as a Prompt Injection Amplifier

**What goes wrong:**
Hooks (Claude Code's `PreToolUse`, `PostToolUse`, `Stop`, `Notification` events) execute shell commands in response to CLI lifecycle events. Hook scripts are configured in `.claude/settings.json` at the project level. CVE-2025-59536 (fixed October 2025) demonstrated that a malicious `.claude/settings.json` in a repository causes arbitrary shell commands to execute when a user opens the project in Claude Code. CVE-2026-21852 (fixed January 2026) showed hooks can exfiltrate API keys.

In KubexClaw's deployment model, hooks are the primary monitoring channel for CLI agents. If a task payload delivered to the CLI runtime contains a prompt injection that causes the CLI to write a malicious `.claude/settings.json`, that hook runs with the permissions of the container process — not sandboxed, not policy-gated. The hook script can exfiltrate the OAuth token, modify skills, or make direct HTTP calls bypassing the Gateway.

**Why it happens:**
Hooks are designed as a power-user feature where the configuration file and the hook scripts are trusted (written by the developer). In KubexClaw, the "developer" is the CLI agent itself, which may be acting on attacker-controlled task content. The trust boundary breaks down: hooks written by an LLM responding to injected content are not trusted first-party configuration.

**How to avoid:**
(1) The harness must write the hook configuration to `~/.claude/settings.json` at container startup before the CLI starts — and that file must be mounted read-only (`/root/.claude/settings.json:ro`). The CLI cannot write to it. (2) Hook scripts must be simple pipe-relay scripts that only forward structured event data to the harness's local Unix socket — no conditional logic, no shell expansion of task content. (3) The harness validates hook event payloads (JSON schema) before acting on them. (4) The hook script path must be an absolute path to a file in the container image, not a path that can be influenced by task content.

**Warning signs:**
- `~/.claude/settings.json` is not mounted read-only in the container
- Hook script commands include any string interpolation from task or tool content
- Hook events are processed without JSON schema validation

**Phase to address:**
Hooks Integration Phase — the read-only mount and hook script design must be finalized before any live hook testing. Do not iterate on hook functionality with a writable settings file.

---

### Pitfall 6: Bidirectional MCP Creates Circular Dependency at Startup

**What goes wrong:**
The design has the harness operating as both an MCP client (calling worker tools) and an MCP server (receiving reports from the CLI). If the harness starts the MCP server, then starts the CLI, and the CLI immediately tries to call an MCP tool on the harness server before the server is ready — or if the MCP bridge tries to call a worker tool that depends on the Registry being up, but the Registry is not yet reachable — the startup sequence deadlocks. This is a specific manifestation of the general "A waits for B, B waits for A" startup ordering problem.

In Docker Compose, services have `depends_on` with `condition: service_healthy` to handle this. Dynamically spawned CLI runtime containers do not benefit from Compose healthchecks — they are started by the Manager, which does not sequence startup of sub-processes within the container.

**Why it happens:**
Bidirectional communication between the harness and CLI requires both sides to be ready before the other attempts connection. The natural implementation starts the server in a background thread and then starts the CLI — but the CLI may connect to the MCP server before the server's asyncio loop has processed its first event, causing a connection refused or protocol error.

**How to avoid:**
Use a readiness gate: the harness starts the MCP server, writes a readiness file to `/tmp/mcp-server-ready` when the server accepts connections, then starts the CLI with an env var pointing to the Unix socket path. The CLI (or a wrapper script) waits for the readiness file before proceeding. For the bridge's outbound MCP connections (calling workers), use lazy connection — do not connect at bridge startup, connect on first tool call and handle reconnection transparently.

**Warning signs:**
- CLI process exits immediately on startup with a connection refused error to the MCP server
- MCP bridge logs show `ConnectionRefusedError` when calling worker tools during the first few seconds after startup
- Container health check passes but first task dispatch fails

**Phase to address:**
Bidirectional MCP Phase — the readiness gate must be part of the initial implementation, not added after observing startup races in integration tests.

---

### Pitfall 7: MCP Tool Schema Changes Break the LLM Silently, Not Loudly

**What goes wrong:**
When a worker agent's description changes in `config.yaml` (via the pub/sub live discovery mechanism), the MCP bridge invalidates its tool cache and the orchestrator LLM receives an updated tool list. If the new description changes the tool's wording significantly, the LLM may stop selecting that tool even for appropriate tasks, or start selecting it for inappropriate tasks. Unlike an API schema change (which causes a 400 error), a description change causes the LLM to hallucinate — it silently picks a different tool or invents parameters. This is documented as "silent breakage" in production MCP deployments (minherz, Google Cloud Community, January 2026).

For KubexClaw specifically, if the `engineer` tool description changes from "software engineering tasks" to "code execution and scripting," the orchestrator may stop routing natural language requests like "help me debug this" to the engineer agent — with no error, just wrong behavior.

**Why it happens:**
MCP tool definitions are treated as code (they have a schema) but act as prompt content (the LLM reads descriptions to decide which tool to call). Description changes are semantic changes. A system that works correctly after the schema is updated may break because the LLM's routing behavior changed, not because any code changed.

**How to avoid:**
(1) Treat tool descriptions as immutable for a given agent version. Change descriptions only with a version bump in the agent's `config.yaml`. (2) Add a golden prompt test suite: a fixed set of task descriptions that should route to specific worker tools. Run this test against the MCP bridge after any agent description change. If routing changes, the test fails — forcing explicit acknowledgment. (3) Monitor tool selection rates in production (log which tool the LLM calls per task). A sudden drop in `engineer` tool calls is a signal, not just noise.

**Warning signs:**
- An agent's `config.yaml` description is updated and no routing tests are re-run
- Worker tool selection rate changes without any corresponding change in incoming task types
- Integration tests pass (they test the bridge machinery) but E2E tests fail (they test LLM routing)

**Phase to address:**
MCP Bridge Phase — golden prompt routing tests must be written before the MCP bridge goes live. This is not optional testing infrastructure.

---

### Pitfall 8: OAuth Token Expiry Mid-Task Causes Half-Finished State

**What goes wrong:**
Claude Code OAuth tokens expire after 8–12 hours (documented in anthropics/claude-code Issue #12447). A long-running or overnight task will hit token expiry mid-execution. The CLI subprocess exits with a 401 error. The harness detects the auth failure and sends `request_user_input` asking the user to re-authenticate. The user re-auths. But the CLI task cannot be resumed — the CLI lost all its in-context state when it exited. The task is restarted from scratch, potentially duplicating side effects (files created, vault notes written, API calls made).

Current behavior does not "pause and resume" — it leaves branches and work in half-finished states (confirmed by anthropics/claude-code Issue #12447 reporter's experience running multi-day pipelines).

**Why it happens:**
OAuth tokens are not designed for long-running automated processes. The token TTL is calibrated for human sessions, not agent sessions. CLI tools designed for interactive use do not implement a task checkpoint/restore mechanism.

**How to avoid:**
(1) Before starting a CLI task, check token validity. If expiry is within 2 hours, trigger re-auth proactively via HITL before starting the task, not mid-task. (2) Implement idempotency guards for all side effects in worker tasks: use task_id as an idempotency key for vault writes, mark completed sub-steps in the vault so a restarted task can skip them. (3) Use a named Docker volume for OAuth token storage so re-auth from a previous session is preserved across container restarts. (4) Log a clear "token will expire at [time]" warning at task start so operators can schedule re-auth proactively.

**Warning signs:**
- CLI runtime tasks regularly fail after 8–10 hours with auth errors
- Vault contains duplicate notes from restarted tasks
- No pre-flight credential validity check before task dispatch to CLI agents

**Phase to address:**
OAuth Provisioning Phase — idempotency guards must be designed as part of the OAuth flow, not discovered after observing duplicate vault entries in production.

---

### Pitfall 9: Replacing the Working Tool Loop Without a Feature Parity Gate

**What goes wrong:**
The existing custom tool loop handles 8 tools: `dispatch_task`, `wait_for_result`, `check_task_status`, `cancel_task`, `list_agents`, `query_registry`, `query_knowledge`, `store_knowledge`. The MCP bridge replaces all of them. If the replacement is declared done when unit tests pass for the bridge mechanics but before verifying that the orchestrator can execute every workflow the old loop supported, previously working workflows break silently. The test suite tests the old behavior via the old code path — the new code path has no equivalent coverage.

**Why it happens:**
Replacements are easier to test for new functionality than for parity with what they replaced. The natural tendency is to write tests for the new MCP interface (does the tool schema match, does the bridge connect to the Registry) rather than regression tests for old orchestrator workflows (can the orchestrator still handle an ESCALATE → human approval → resume flow).

**How to avoid:**
Before removing the old custom tool loop: (1) Document every workflow the orchestrator currently handles with specific test scenarios. (2) Write parity integration tests that exercise those workflows through the MCP bridge. (3) Only remove the old code path after all parity tests pass. (4) Run the existing E2E test suite unchanged against the new MCP bridge — if any E2E test fails, that is a regression, not a test to update. The 789 tests are a regression suite; keep them green throughout the migration.

**Warning signs:**
- Old `dispatch_task` / `wait_for_result` tools are removed before MCP bridge E2E tests pass
- `harness_mode: mcp-bridge` is deployed without running the full existing E2E suite against it
- ESCALATE → human approval → resume workflow is not explicitly tested via MCP

**Phase to address:**
MCP Bridge Phase — parity test suite must be written and passing before the old tool loop is deleted. Deletion is the final step, not the first.

---

### Pitfall 10: Policy Engine Is Bypassed for In-Process Vault Operations

**What goes wrong:**
The MCP bridge design calls vault_ops functions directly in-process for knowledge vault tools (`vault_create_note`, `vault_update_note`, etc.). This is intentional for performance. However, the policy engine currently only evaluates actions that pass through the Gateway's `/actions` endpoint. Direct in-process calls to vault_ops bypass the Gateway entirely — no policy evaluation, no audit log entry, no injection scan. An orchestrator LLM that has been prompt-injected can write arbitrary content to the vault with no policy gate stopping it.

The existing Gateway ingress scanning defense model (from design-mcp-bridge.md) assumes external data enters through the Gateway. But the orchestrator itself can now write to the vault without going through the Gateway — creating an unguarded write path.

**Why it happens:**
The "direct in-process call" optimization was made because vault operations are simple CRUD that don't need worker LLM reasoning. This reasoning is correct for performance. The security implication (bypassing the policy gate) was not fully accounted for in the design.

**How to avoid:**
Vault write operations from the MCP bridge must still go through the Gateway's policy evaluation, even if they do not go through the Broker (no worker LLM needed). Implement a Gateway endpoint for vault writes that runs the policy check and injection scan, then calls vault_ops directly. Reads can remain in-process (no write side effects). Alternatively, add a lightweight injection scan directly in the MCP bridge's vault write handlers that mirrors what the Gateway would do — using the same deterministic pattern matching (not an LLM scan).

**Warning signs:**
- `vault_create_note` MCP tool handler calls `vault_ops.create_note()` without any policy or content check
- No audit log entry is created when the orchestrator writes to the vault via MCP tools
- Gateway access logs show no entries for vault writes that are visible in the vault

**Phase to address:**
MCP Bridge Phase — the in-process optimization is fine, but the security gate must be maintained. Design the write path with the policy check before implementing the vault tools.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hold MCP tool call open waiting for worker result (synchronous) | Simpler code, no task_id management | Tool call times out on any human-in-the-loop scenario; bridge crashes | Never — async task_id pattern from day one |
| Inject OAuth token as env var for development convenience | Eliminates browser auth step in CI | Token visible via `docker inspect`; sets a pattern that leaks into production | Never — even in dev; use named volumes |
| Mount `~/.claude/settings.json` read-write for hook debugging | Easier to iterate on hook scripts | Hooks become writable by the LLM; prompt injection path to RCE | Never — always read-only in container |
| Skip golden prompt routing tests and rely only on unit tests | Faster to ship MCP bridge | Tool description changes break routing silently; no detection mechanism | MVP only with explicit ticket to add routing tests before first description change |
| Keep old tool loop code alongside new MCP bridge indefinitely | Safe fallback during transition | Two code paths to maintain; tests cover both; harness complexity grows | Transition period only — delete old code within the same milestone |
| Start CLI subprocess before MCP server is ready | Simpler startup sequence | Race condition: CLI connects before server binds; intermittent startup failures | Never — always use readiness gate |
| Accept arbitrary hook payloads without JSON schema validation | Less validation code | Malicious task content can craft hook payloads that trigger unintended harness actions | Never |

---

## Integration Gotchas

Common mistakes when connecting MCP, PTY, hooks, and OAuth in this system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP Python SDK + asyncio | Mixing `anyio` tasks with `asyncio.create_task()` directly; `asyncio.create_task()` can be a footgun with cancellation | Use `anyio` throughout the MCP bridge; avoid mixing asyncio primitives directly |
| PTY + Docker | Using `subprocess.Popen` without PTY allocation; CLI falls back to non-interactive mode and disables hooks | Use `pexpect.spawn()` which allocates a PTY automatically |
| PTY output parsing | Waiting for process exit before reading output; deadlocks when buffer fills | Continuous non-blocking drain loop in separate thread using `pexpect.read_nonblocking()` |
| Docker SIGTERM + PTY child | SIGTERM to harness does not propagate to PTY child process | Explicit signal handler: SIGTERM → SIGTERM to child → wait 5s → SIGKILL child → exit harness |
| MCP transport (stdio vs SSE) | Using stdio transport requires the MCP server to share stdin/stdout with the process | For in-container use: prefer Unix domain socket transport or SSE on localhost to avoid stdin/stdout conflicts with PTY |
| Hook event relay | Writing task content directly into hook script arguments (shell injection) | Hook scripts only relay raw stdin JSON to harness Unix socket; never interpolate content |
| OAuth named volumes | Using a single shared volume for all agents' OAuth tokens | One named volume per agent_id: `kubex-oauth-claude-{agent_id}` for token isolation |
| MCP + Redis pub/sub | Redis subscription blocks the event loop; MCP server stops responding | Run pub/sub listener in a separate asyncio task with proper cancellation handling |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| MCP bridge holds connections to all workers at all times | Port exhaustion, connection refused on worker containers | Lazy connection: connect on first tool call, disconnect after use | 10+ simultaneous worker containers |
| Tool list fetched from Registry on every LLM turn | Registry API overloaded; MCP bridge latency spikes | Cache tool list in memory, invalidate only on pub/sub `registry:agent_changed` event | 5+ LLM turns/minute |
| PTY output accumulated unboundedly in memory | Harness OOM killed during verbose CLI tasks | Cap output at 1MB; stream to disk with rolling buffer; send truncation warning in result | Any task producing >1MB stdout |
| CLI subprocess spawned synchronously in asyncio event loop | Event loop blocks during spawn; MCP server stops responding to pings | Spawn CLI via `asyncio.create_subprocess_exec()` or in a thread pool | Any CLI spawn latency >100ms |
| MCP bridge polls Gateway for task result on tight loop | Gateway log spam; Redis hammered | Exponential backoff poll: 1s, 2s, 4s, 8s... up to 30s max interval | >3 concurrent long-running tasks |

---

## Security Mistakes

Domain-specific security issues for MCP + CLI Runtime in a Docker-based agent platform.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Hook script `command` includes shell expansion of task content | RCE via prompt injection — attacker crafts task content that executes arbitrary shell commands when hook fires | Hook scripts must be static executables with no string interpolation; validate all hook payloads via JSON schema |
| OAuth token stored in env var | Full account access exposed via `docker inspect`, process listings, Gateway logs | Named Docker volume only; harness reads token from filesystem path, not env var |
| Hook config file (`~/.claude/settings.json`) writable by container process | CLI agent can rewrite its own hook configuration, changing what code runs on future hook events | Mount hook config read-only: `.claude/settings.json:ro` |
| MCP bridge vault writes bypass Gateway injection scan | Prompt-injected orchestrator writes malicious content to vault without detection | Route vault writes through Gateway policy check or replicate injection scan in MCP bridge write handlers |
| CLI subprocess runs as root inside container | Any container escape gives root on host; RCE via hooks is a root RCE | Run container as non-root user (`USER kubex` in Dockerfile); drop all Linux capabilities except what CLI needs |
| MCP bridge exposes SSE endpoint without authentication on internal network | Any container on `kubex-internal` can call arbitrary MCP tools on the orchestrator | Bind MCP SSE server to localhost only (127.0.0.1), not 0.0.0.0; use Unix socket transport for in-container communication |
| Skills (Snyk ToxicSkills) — supply chain compromise via skill files | Malicious skill content injected at spawn causes worker to act against policy | Skill file SHA-256 hash verification at spawn (existing defense from v1.1); applies equally to CLI runtime skill injection |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **MCP bridge works:** Verify it handles a worker task that takes 10+ minutes (policy escalation) without timing out or crashing — not just fast happy-path tasks
- [ ] **CLI runtime works:** Verify PTY with a task that produces >100KB output does not deadlock — not just short hello-world tasks
- [ ] **Kill switch works:** Verify `docker stop` terminates the CLI subprocess cleanly within 30 seconds — not just that the harness exits
- [ ] **OAuth flow works:** Verify a named volume persists the token across container restart — not just that the initial auth flow completes once
- [ ] **Hooks work:** Verify hook events arrive at the harness from a real CLI task — not just that the hook script exists and is syntactically valid
- [ ] **MCP bridge replaces old tool loop:** Run every existing E2E test against the new `harness_mode: mcp-bridge` path — not just MCP-specific tests
- [ ] **Bidirectional MCP works:** Verify the MCP server and MCP client both function correctly within the same harness process — not just one direction in isolation
- [ ] **Vault writes are policy-gated:** Verify Gateway audit log contains an entry for every vault write made via MCP bridge tools — not just via Broker-dispatched tasks
- [ ] **Hook config is read-only:** Run `docker exec <container> ls -la /root/.claude/settings.json` and confirm permissions are `r--r--r--` — not writable

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| MCP bridge crash-loops due to timeout exception | MEDIUM | Revert `harness_mode` to `standalone` for orchestrator; old tool loop is still in repo; hotfix exception handling in bridge; redeploy |
| PTY deadlock on large output task | LOW | Kill affected container; implement output cap + drain loop; redeploy CLI runtime |
| OAuth token in env var discovered in production | HIGH | Rotate the OAuth token immediately via provider; audit all `docker inspect` outputs for credential leakage; implement named volume pattern; rebuild affected containers |
| Hook config written by malicious task content | HIGH | Kill container immediately; audit vault for injected content; implement read-only hook mount; rotate any tokens the container had access to; review Gateway logs for policy bypass |
| MCP bridge vault writes found to bypass policy | MEDIUM | Audit vault git log for writes that have no corresponding Gateway log entry; add policy check to write handlers; review all orchestrator-written vault content for injection artifacts |
| OAuth expiry causes half-finished task | MEDIUM | Check vault for duplicate notes (idempotency gap); clean up partial artifacts; implement pre-flight expiry check and idempotency keys; re-run affected task |
| Bidirectional MCP startup race causes first task failure | LOW | Add retry on first tool call; implement readiness gate; race resolves on subsequent attempts until fix is deployed |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| MCP tool timeout kills bridge process | MCP Bridge Phase | Integration test: dispatch task that waits 5 minutes; verify bridge does not crash |
| PTY buffer deadlock | CLI Runtime Phase | Stress test: CLI task producing >100KB output; verify result returns without hang |
| Docker PID 1 signal blindness | CLI Runtime Phase | Integration test: `docker stop` on CLI container; verify clean exit within 30s |
| OAuth token in env var | OAuth Provisioning Phase | CI gate: grep for `CLAUDE_TOKEN` / `CODEX_TOKEN` / `GEMINI_TOKEN` env vars in harness code |
| Hook scripts as injection amplifier | Hooks Integration Phase | Security test: task content containing shell metacharacters does not execute in hook |
| Bidirectional MCP startup race | Bidirectional MCP Phase | Integration test: cold-start container and dispatch task within first 2 seconds |
| MCP tool schema silent breakage | MCP Bridge Phase | Golden prompt routing test suite run after every agent description change |
| OAuth expiry mid-task | OAuth Provisioning Phase | Integration test: simulate token expiry mid-task; verify idempotent re-run produces no duplicates |
| Replacing tool loop without parity gate | MCP Bridge Phase | All existing E2E tests pass with `harness_mode: mcp-bridge` before old code is deleted |
| Policy bypass for in-process vault writes | MCP Bridge Phase | Audit test: every MCP vault write produces a Gateway audit log entry |

---

## Sources

- Direct design doc analysis: `docs/design-mcp-bridge.md` — identified Gap 5 (timeout cascade), Gap 3 (stdio-only transport), in-process vault call pattern
- Direct design doc analysis: `docs/design-oauth-runtime.md` — identified token storage approach, mid-task auth failure handling
- [MCP Tool timeout within 10 seconds causing MCP server disconnect](https://github.com/modelcontextprotocol/python-sdk/issues/212) — confirmed production timeout/crash issue in MCP Python SDK
- [MCP tool call timeout/cancellation causes entire process to restart](https://github.com/HKUDS/nanobot/issues/1055) — CancelledError propagation issue
- [MCP_TOOL_TIMEOUT not respected for long-running HTTP tool calls](https://github.com/anthropics/claude-code/issues/17662) — January 2026
- [OAuth token expiration disrupts autonomous workflows](https://github.com/anthropics/claude-code/issues/12447) — 8-12 hour expiry documented, no pause/resume
- [Caught in the Hook: RCE and API Token Exfiltration Through Claude Code Project Files (CVE-2025-59536, CVE-2026-21852)](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — Check Point Research, January 2026
- [Detecting Indirect Prompt Injection in Claude Code with Lasso](https://www.lasso.security/blog/the-hidden-backdoor-in-claude-coding-assistant) — hooks as injection amplifier
- [The Silent Breakage: A Versioning Strategy for Production-Ready MCP Tools](https://minherz.medium.com/the-silent-breakage-a-versioning-strategy-for-production-ready-mcp-tools-fbb998e3f71f) — description changes cause LLM hallucination
- [Evolvable MCP: A Guide to MCP Tool Versioning](https://medium.com/@kumaran.isk/evolvable-mcp-a-guide-to-mcp-tool-versioning-ae9a612f7710) — February 2026
- [PID 1 Signal Handling in Docker](https://petermalmgren.com/signal-handling-docker/) — SIGTERM propagation, tini recommendation
- [Port conflict when multiple mcp-remote instances start simultaneously](https://github.com/anthropics/claude-code/issues/15320) — bidirectional port race conditions
- [Pseudo-Terminal Pitfalls: Common Issues and Modern Alternatives to Python's pty](https://runebook.dev/en/docs/python/library/pty) — PTY buffer deadlock, pexpect recommendation
- [ToxicSkills: Malicious AI Agent Skills Supply Chain Compromise (Snyk)](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) — skill file supply chain attack pattern
- [Docker Security Best Practices 2025](https://cloudnativenow.com/editorial-calendar/best-of-2025/docker-security-in-2025-best-practices-to-protect-your-containers-from-cyberthreats-2/) — credential storage, least privilege

---
*Pitfalls research for: KubexClaw v1.2 — MCP Bridge + CLI Runtime addition to existing Docker-based agent platform*
*Researched: 2026-03-21*
