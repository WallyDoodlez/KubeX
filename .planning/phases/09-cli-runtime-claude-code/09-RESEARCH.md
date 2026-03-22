# Phase 9: CLI Runtime — Claude Code - Research

**Researched:** 2026-03-22
**Domain:** PTY subprocess management, Claude Code CLI integration, Docker volume credential persistence, harness state machines
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Fresh process per task — spawn CLI, feed task, collect result, kill. No state leaks between tasks.
- **D-02:** Task fed to CLI as a CLI argument (`claude -p "task content" --output-format json`). Each runtime type defines its own argument format in config.
- **D-03:** Full stdout buffer captured and wrapped in standard JSON envelope (`{status, result, metadata}`) on process exit. Stdout is accumulated while simultaneously being streamed.
- **D-04:** Credential detection by checking known file paths per CLI type (`~/.claude/.credentials.json`). Files must exist and be non-empty. No token content parsing.
- **D-05:** Credential paths MUST be in `.gitignore` — never committed to version control.
- **D-06:** On missing credentials, harness sends `request_user_input` HITL action asking user to `docker exec -it` and authenticate. File watcher (watchfiles) monitors credential directory for file appearance.
- **D-07:** Credential volumes are per-agent (named volume per agent_id: `kubex-creds-{agent_id}`). Each agent has its own isolated OAuth session.
- **D-08:** Linear gate boot sequence: BOOTING → install deps → load skills → write CLAUDE.md → check credentials → (CREDENTIAL_WAIT if missing) → READY → consume tasks → BUSY on task
- **D-09:** Basic stdout streaming — chunks POSTed to `POST /tasks/{task_id}/progress` as they arrive.
- **D-10:** Stdout chunks are time-batched (500ms buffer window) to reduce network overhead.
- **D-11:** Raw ANSI passthrough — no stripping of color codes. Command Center renders with xterm.js. Terminal emulator component is frontend's responsibility.
- **D-12:** Lifecycle state transitions (BOOTING, CREDENTIAL_WAIT, READY, BUSY) published to existing `lifecycle:{agent_id}` Redis pub/sub channel.
- **D-13:** Hybrid exit code + output scan — check exit code first, then scan last N lines of output against known patterns ONLY on non-zero exit.
- **D-14:** Failure patterns are loose and configurable (not hardcoded regex).
- **D-15:** Retry once on general failure (non-zero exit), then report `task_failed` with detected reason. Fresh CLI process for retry.
- **D-16:** Auth-expired failures bypass retry — go straight to HITL re-auth flow. Transition to CREDENTIAL_WAIT state.
- **D-17:** Failure reason types: `subscription_limit`, `auth_expired`, `cli_crash`, `runtime_not_available`

### Claude's Discretion

- Exact time-batch window for stdout chunks (500ms suggested, tunable)
- Per-CLI argument format mapping (config-driven)
- File watcher implementation details (watchfiles vs polling fallback)
- HITL message wording for credential requests
- Exact output scan heuristics for failure classification
- Signal forwarding implementation (SIGTERM → PTY child → 5s grace → SIGKILL)

### Deferred Ideas (OUT OF SCOPE)

- **Hooks-based monitoring** — Phase 10
- **Codex + Gemini runtimes** — Phase 11
- **OAuth web flow** — Phase 12
- **Real-time PTY output forwarding** — explicitly out of scope per REQUIREMENTS.md
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | PTY-based subprocess launch for any configured CLI agent (runtime field in config.yaml) | `pexpect.spawn()` is the right PTY abstraction; `config_loader.py` already reads `runtime` field; `harness.py` has PTY skeleton to extend |
| CLI-02 | Credential check at startup with HITL re-auth via existing `request_user_input` action | `~/.claude/.credentials.json` is the Linux credential file; `watchfiles.awatch()` handles async file watching; Gateway `POST /actions` accepts HITL actions |
| CLI-03 | Failure pattern detection per CLI type with typed reason in task_failed payload | Exit code + last-N-lines scan pattern; 4 typed reasons: `subscription_limit`, `auth_expired`, `cli_crash`, `runtime_not_available` |
| CLI-04 | SIGTERM handler: forward to PTY child → wait 5s → SIGKILL → exit harness; tini as PID 1; exec-form CMD | tini must be added to base Dockerfile; existing signal handler in `main.py` must be extended for subprocess forwarding |
| CLI-05 | Skills injected as CLAUDE.md / AGENTS.md / GEMINI.md at spawn time | `entrypoint.sh` already loads skills to `~/.openclaw/skills/`; needs extension to write `CLAUDE.md` in working directory |
| CLI-06 | Named Docker volumes for OAuth token persistence across container restarts (one volume per agent_id) | `lifecycle.py` volumes dict already handles bind mounts; named volumes need to be added and declared in docker-compose.yml |
| CLI-07 | Container lifecycle state machine: BOOTING → CREDENTIAL_WAIT → READY ↔ BUSY with Redis pub/sub events | `lifecycle:{agent_id}` Redis pub/sub channel; `LifecycleEvent` schema in `events.py` already exists |
| CLI-08 | Claude Code runtime via PTY subprocess | `claude -p "task" --output-format json --dangerously-skip-permissions` is the invocation pattern |
</phase_requirements>

---

## Summary

Phase 9 builds a `CLIRuntime` class in the harness that wraps PTY subprocess management, credential lifecycle, state machine transitions, and task I/O into a clean module. The existing `harness.py` is the scaffold — it already has PTY imports, `ExitReason`, and output streaming patterns. The new work is: wiring `CLIRuntime` into `main.py` as a third mode (alongside `standalone` and `mcp-bridge`), implementing the boot gate (BOOTING → CREDENTIAL_WAIT → READY), the per-task spawn loop (READY → BUSY → READY), credential detection via `watchfiles`, HITL via the existing Gateway POST /actions endpoint, and signal forwarding for clean shutdown.

Claude Code's CLI provides `claude -p "prompt" --output-format json --dangerously-skip-permissions` as the non-interactive invocation. Credentials on Linux live at `~/.claude/.credentials.json` (a JSON file with `claudeAiOauth` object). Named Docker volumes mount at `/root/.claude/` to persist credentials across restarts. The `pexpect` library is the correct PTY abstraction — `pexpect.spawn()` allocates a PTY automatically and handles continuous output draining without deadlock.

The most critical infrastructure addition is `tini` as PID 1 in the base Dockerfile — currently `entrypoint.sh` is PID 1 but does not forward signals. Without tini, `docker stop` never reaches the Python harness and the CLI subprocess is killed abruptly after Docker's 10-second timeout with no cleanup. Adding tini is a one-line Dockerfile change (`apt-get install tini`) and two-line ENTRYPOINT/CMD change, but it is load-bearing for CLI-04.

**Primary recommendation:** Implement `CLIRuntime` as a new module in `kubex_harness/cli_runtime.py` with the state machine, credential watching, PTY subprocess management, and HITL integration. Wire it into `main.py` when `config.runtime != "openai-api"`. Add tini to the base Dockerfile. Add named volume support to `lifecycle.py`. All changes are additive — no existing modes or code paths are modified.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pexpect` | 4.9+ | PTY subprocess spawn + continuous output drain | Handles PTY allocation, non-blocking reads, no deadlock risk; stdlib `pty` requires manual `select()` loops |
| `watchfiles` | 1.1.1+ | Async file watching for credential appearance | Already in project memory as planned dep; `awatch()` integrates with anyio/asyncio; Rust-backed, fast |
| `tini` | 0.19.0 (system) | PID 1 init in Docker container | Reaps zombies, forwards signals correctly to child processes; standard for Python in Docker |
| `redis.asyncio` | Already installed | Pub/sub for lifecycle state events | Existing pattern in harness — same library, same import path |
| `httpx` | Already installed | POST progress chunks + HITL actions to Gateway | Existing pattern in `harness.py` — use `httpx.AsyncClient` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `asyncio.subprocess` | stdlib | Async-safe subprocess spawn alternative | Use for running `claude auth status` checks (short-lived, no PTY needed) |
| `anyio` | Already installed via MCP bridge | Async primitives compatible with both asyncio and trio | If watchfiles' `awatch()` anyio integration needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pexpect.spawn()` | stdlib `pty` + `select()` | stdlib requires manual non-blocking drain loop; deadlock risk on large output; pexpect battle-tested for this exact use case |
| `watchfiles.awatch()` | polling loop with `asyncio.sleep(1)` | Polling is the fallback if watchfiles unavailable in image; awatch is more efficient (inotify-backed), set 5s poll interval as fallback |
| Named Docker volume | Host bind-mount of `~/.claude/` | Named volume survives container replacement; bind-mount couples to host filesystem layout; named volume is correct for agent isolation |

**Installation (additions to base image):**
```bash
# In agents/_base/Dockerfile:
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# As KUBEX_PIP_DEPS for CLI runtime agents at spawn time:
pip install pexpect watchfiles
```

---

## Architecture Patterns

### Recommended Project Structure

```
agents/_base/kubex_harness/
├── main.py                    # Add "cli-runtime" routing branch
├── cli_runtime.py             # NEW — CLIRuntime class, state machine, PTY manager
├── harness.py                 # Existing — PTY skeleton, reuse ExitReason enum
├── standalone.py              # Unchanged
├── mcp_bridge.py              # Unchanged
└── config_loader.py           # Unchanged — runtime field already present
```

### Pattern 1: CLIRuntime Class Structure

**What:** A persistent object that owns the boot sequence, credential gate, task loop, and shutdown sequence.

**When to use:** Instantiated once when `config.runtime != "openai-api"` and `config.harness_mode` indicates CLI mode. Lives for the container's lifetime.

```python
# Source: pattern derived from standalone.py + harness.py existing code
class CliState(str, Enum):
    BOOTING = "booting"
    CREDENTIAL_WAIT = "credential_wait"
    READY = "ready"
    BUSY = "busy"

class CLIRuntime:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._state = CliState.BOOTING
        self._running = True
        self._child: pexpect.spawn | None = None

    async def run(self) -> None:
        await self._publish_state(CliState.BOOTING)
        await self._boot_sequence()          # install deps, write CLAUDE.md
        await self._credential_gate()        # check creds, HITL if missing
        await self._publish_state(CliState.READY)
        await self._register_with_registry()
        await self._task_loop()              # poll Broker, READY <-> BUSY

    def stop(self) -> None:
        """Called by SIGTERM handler — sets flag, terminates child."""
        self._running = False
        if self._child and self._child.isalive():
            self._child.terminate()
```

### Pattern 2: Claude Code Invocation Format

**What:** The exact CLI command for non-interactive task execution.

**When to use:** Per task dispatch. Task content comes from Broker message.

```bash
# Source: code.claude.com/docs/en/cli-reference (official docs, HIGH confidence)
claude -p "TASK_CONTENT_HERE" \
  --output-format json \
  --dangerously-skip-permissions \
  --model claude-sonnet-4-6 \
  --no-session-persistence
```

Key flags:
- `-p` — non-interactive print mode, exits after completing task
- `--output-format json` — structured JSON output for reliable parsing
- `--dangerously-skip-permissions` — required for unattended automation; Claude Code by default prompts for tool use permissions
- `--no-session-persistence` — prevents session accumulation across tasks (fresh process per task, D-01)
- `--model` — optional, falls through to CLAUDE.md default if omitted; set from `config.model`

```python
# Source: pattern from CONTEXT.md D-02 + official CLI docs
def _build_command(self, task_message: str) -> list[str]:
    cmd = [
        "claude",
        "-p", task_message,
        "--output-format", "json",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
    ]
    if self.config.model:
        cmd += ["--model", self.config.model]
    return cmd
```

### Pattern 3: PTY Spawn with Continuous Output Drain

**What:** Spawn CLI via pexpect, drain output in async loop, accumulate buffer.

**When to use:** Every task dispatch.

```python
# Source: PITFALLS.md Pitfall 2 + pexpect docs
import pexpect
import asyncio

async def _run_task(self, task_message: str) -> tuple[int, str]:
    """Spawn CLI for one task, drain output, return (exit_code, stdout)."""
    cmd = " ".join(self._build_command(task_message))
    # pexpect.spawn allocates PTY automatically
    child = pexpect.spawn(cmd, timeout=None, encoding="utf-8",
                          dimensions=(10000, 200))  # large window reduces wrapping
    self._child = child
    buffer_parts: list[str] = []

    # Drain loop — NEVER call child.wait() or child.communicate()
    # Run blocking drain in thread pool to avoid blocking asyncio loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, self._drain_to_buffer, child, buffer_parts)

    child.close()
    exit_code = child.exitstatus or 0
    self._child = None
    return exit_code, "".join(buffer_parts)

def _drain_to_buffer(self, child: pexpect.spawn, buf: list[str]) -> None:
    """Blocking drain — runs in thread pool executor."""
    while True:
        try:
            chunk = child.read_nonblocking(size=4096, timeout=0.1)
            buf.append(chunk)
        except pexpect.TIMEOUT:
            if not child.isalive():
                break
        except pexpect.EOF:
            break
```

### Pattern 4: Credential Detection (Claude Code)

**What:** File-based credential check at boot and after re-auth.

**When to use:** At boot (D-08 step 3) and after HITL watcher fires.

```python
# Source: CONTEXT.md D-04 + GitHub issue #1414 (Linux: ~/.claude/.credentials.json)
from pathlib import Path

CREDENTIAL_PATHS: dict[str, Path] = {
    "claude-code": Path.home() / ".claude" / ".credentials.json",
    # Phase 11 will add codex-cli and gemini-cli
}

def _credentials_present(self, runtime: str) -> bool:
    """Check credential file exists and is non-empty. No content parsing (D-04)."""
    cred_path = CREDENTIAL_PATHS.get(runtime)
    if cred_path is None:
        return False  # Unknown runtime — treat as missing
    return cred_path.exists() and cred_path.stat().st_size > 0
```

### Pattern 5: watchfiles Async Credential Watch

**What:** Non-blocking wait for credential file to appear after HITL.

**When to use:** After sending `request_user_input` HITL action (D-06).

```python
# Source: watchfiles PyPI docs + CONTEXT.md D-06
from watchfiles import awatch
from pathlib import Path

async def _wait_for_credentials(self, runtime: str, timeout_s: float = 3600.0) -> bool:
    """Watch credential directory until credentials appear or timeout."""
    cred_path = CREDENTIAL_PATHS[runtime]
    watch_dir = cred_path.parent
    watch_dir.mkdir(parents=True, exist_ok=True)

    try:
        async with asyncio.timeout(timeout_s):
            async for changes in awatch(str(watch_dir)):
                if self._credentials_present(runtime):
                    return True
    except TimeoutError:
        return False
    return False
```

### Pattern 6: Lifecycle State Publishing

**What:** Redis pub/sub state event on `lifecycle:{agent_id}` channel.

**When to use:** Every state transition.

```python
# Source: CONTEXT.md D-12 + events.py LifecycleEvent schema
async def _publish_state(self, state: CliState) -> None:
    """Publish state transition to lifecycle:{agent_id} Redis pub/sub channel."""
    payload = {
        "agent_id": self.config.agent_id,
        "state": state.value,
        "timestamp": datetime.utcnow().isoformat(),
    }
    channel = f"lifecycle:{self.config.agent_id}"
    try:
        await self._redis.publish(channel, json.dumps(payload))
    except Exception:
        pass  # State publish must never block task processing
```

### Pattern 7: SIGTERM Signal Forwarding

**What:** Harness SIGTERM handler that propagates to PTY child before exiting.

**When to use:** Container stop (`docker stop`) or kill switch.

```python
# Source: PITFALLS.md Pitfall 3 + CONTEXT.md D-04 signal discretion
import asyncio, signal, os

def _setup_signal_handlers(self, loop: asyncio.AbstractEventLoop) -> None:
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, self._handle_shutdown_signal)

def _handle_shutdown_signal(self) -> None:
    """Schedule graceful shutdown as asyncio task."""
    asyncio.ensure_future(self._graceful_shutdown())

async def _graceful_shutdown(self) -> None:
    self._running = False
    if self._child and self._child.isalive():
        # Step 1: SIGTERM to child
        try:
            self._child.terminate(force=False)  # sends SIGTERM
        except Exception:
            pass
        # Step 2: Wait 5s
        for _ in range(50):
            await asyncio.sleep(0.1)
            if not self._child.isalive():
                return
        # Step 3: SIGKILL
        try:
            self._child.terminate(force=True)   # sends SIGKILL
        except Exception:
            pass
```

### Pattern 8: CLAUDE.md Skill Injection

**What:** Write concatenated skill content as CLAUDE.md in working directory.

**When to use:** Boot sequence step 3 (D-08), before credential check.

```python
# Source: CONTEXT.md D-08 + entrypoint.sh skill loading pattern
async def _write_claude_md(self) -> None:
    """Concatenate loaded skill .md files into CLAUDE.md in /app/."""
    skills_dir = Path("/app/skills")
    claude_md_path = Path("/app/CLAUDE.md")
    sections: list[str] = []
    if skills_dir.is_dir():
        for skill_dir in sorted(skills_dir.iterdir()):
            skill_md = skill_dir / "SKILL.md"
            if skill_md.exists():
                sections.append(skill_md.read_text(encoding="utf-8"))
    claude_md_path.write_text("\n\n---\n\n".join(sections), encoding="utf-8")
```

### Anti-Patterns to Avoid

- **`subprocess.communicate()` with PTY:** Deadlocks when CLI produces large output. Use `pexpect.read_nonblocking()` drain loop exclusively.
- **`child.wait()` in async context:** Blocks the event loop. Run drain loop in `loop.run_in_executor()`.
- **Passing OAuth token as env var:** Visible via `docker inspect`. Named volume is the only supported credential path.
- **Single named volume for all agents:** Volume must be `kubex-creds-{agent_id}` — one per agent for isolation (PITFALLS.md Pitfall 4).
- **`~~/.claude/settings.json` writable in container:** Hook injection attack vector (Phase 10 concern, but mount read-only now if the file exists).
- **Shell form CMD in Dockerfile:** `CMD python -m ...` creates a shell as PID 1 that doesn't forward signals. Must use exec form: `CMD ["python", "-m", "kubex_harness.main"]`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PTY allocation + output draining | Custom `pty.openpty()` + `select()` loop | `pexpect.spawn()` | Deadlock on large output; SIGWINCH handling; process cleanup edge cases |
| File watching for credential appearance | `asyncio.sleep()` polling loop | `watchfiles.awatch()` | inotify-backed (efficient), anyio-compatible, handles directory creation edge cases |
| Container init / signal forwarding | Custom signal handler in entrypoint.sh | `tini` as PID 1 | Zombie reaping; correct SIGTERM delivery even from shell-form entrypoints; 1-line install |
| OAuth credential storage | Env var injection, `/run/secrets/` bind-mount | Named Docker volume per agent_id | Survives container restarts; isolated per agent; Docker manages lifecycle |

**Key insight:** PTY management and file watching are both deceptively complex — 90% of implementations work in happy-path testing and fail in production on large outputs or edge-case file system events.

---

## Common Pitfalls

### Pitfall 1: PTY Buffer Deadlock on Large Output (HIGH severity)
**What goes wrong:** CLI produces output faster than drain loop reads; PTY kernel buffer fills; CLI blocks; harness waits for CLI to exit; deadlock.
**Why it happens:** Any blocking read on a PTY (including `.wait()`, `.communicate()`) causes this. Reproduces reliably on tasks generating >100KB stdout.
**How to avoid:** Use `pexpect.read_nonblocking(size=4096, timeout=0.1)` in a loop. Run drain loop in thread pool executor so asyncio event loop stays responsive. Cap total accumulated output at 1MB and truncate with warning.
**Warning signs:** CLI task hangs indefinitely; no timeout fires; memory grows unboundedly.

### Pitfall 2: Docker PID 1 Blindness — SIGTERM Not Received (HIGH severity)
**What goes wrong:** `docker stop` sends SIGTERM to PID 1. Current entrypoint.sh is PID 1 but doesn't forward signals. Harness never gets SIGTERM. Docker times out (10s), sends SIGKILL. CLI process killed mid-task, OAuth token may be partially written.
**Why it happens:** Shell form entrypoints (`CMD python ...` without exec) spawn a shell as PID 1 which doesn't forward signals. Current Dockerfile uses `ENTRYPOINT ["/app/entrypoint.sh"]` correctly (exec form), but entrypoint.sh uses `exec "$@"` which makes Python PID 1 directly — this is actually fine. However, if tini is not in place, zombie CLI child processes accumulate.
**How to avoid:** Add `tini` to Dockerfile. Change `ENTRYPOINT` to `["/usr/bin/tini", "--", "/app/entrypoint.sh"]`. Implement SIGTERM handler in CLIRuntime that forwards to pexpect child with 5s grace then SIGKILL. Set `stop_grace_period: 30s` in docker-compose for CLI agents.
**Warning signs:** `docker stop` takes full 10s timeout; CLI subprocess visible in `docker top` after stop.

### Pitfall 3: OAuth Token Expiry Mid-Task (MEDIUM severity)
**What goes wrong:** Claude Code tokens expire after ~8-12 hours. Long-running or overnight tasks hit expiry mid-execution. CLI exits with auth error. Task is restarted from scratch — cannot resume.
**Why it happens:** OAuth TTL calibrated for human sessions, not agent sessions.
**How to avoid:** D-16 handles this: detect auth-expired failure pattern from exit code + output scan, skip retry, go straight to HITL CREDENTIAL_WAIT. Implement pre-flight credential check before each task dispatch (not just at boot).
**Warning signs:** CLI tasks fail regularly after 8-10 hours with auth errors; no pre-flight check.

### Pitfall 4: `--dangerously-skip-permissions` Missing From Command
**What goes wrong:** Claude Code prompts for tool use permissions interactively. In PTY subprocess, it awaits keyboard input that never comes. Task hangs indefinitely.
**Why it happens:** Claude Code is designed for interactive use; permission prompts require human confirmation by default.
**How to avoid:** Always include `--dangerously-skip-permissions` in automated invocations. This is the documented flag for CI/CD automation per official Claude Code docs.
**Warning signs:** PTY drain loop never exits; task appears to start but never produces result.

### Pitfall 5: Named Volume Mount Order in lifecycle.py
**What goes wrong:** `lifecycle.py` builds the `volumes` dict with host-path bind mounts for credentials. Named volumes for OAuth require a different Docker SDK syntax — the key must be the volume name, not a host path.
**Why it happens:** Docker Python SDK has two volume syntaxes: `{host_path: {bind, mode}}` for bind mounts, `{volume_name: {bind, mode}}` for named volumes. The existing code uses bind mounts exclusively.
**How to avoid:** Add named volume handling as a separate code path. Named volume syntax: `{"kubex-creds-{agent_id}": {"bind": "/root/.claude", "mode": "rw"}}`. Declare the volume name in docker-compose.yml `volumes:` section too.

### Pitfall 6: CLAUDE.md Picked Up vs. Existing Project CLAUDE.md
**What goes wrong:** Claude Code reads CLAUDE.md from the current working directory and parent directories. If `/app/CLAUDE.md` exists from a previous task (stale content), Claude Code combines it with the skill content — or the wrong CLAUDE.md is picked up.
**Why it happens:** Fresh process per task (D-01), but CLAUDE.md is written once at boot and persists. Skill content is boot-time static — this is correct behavior. The risk is if the container's working directory changes between tasks.
**How to avoid:** Always `cd /app` before spawning Claude Code. Write CLAUDE.md at boot to `/app/CLAUDE.md`. Verify working directory is `/app` in entrypoint before exec.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Claude Code Auth Status Check (boot-time credential detection)
```bash
# Source: code.claude.com/docs/en/cli-reference — claude auth status
# Exits 0 if logged in, 1 if not — use as pre-flight check
claude auth status --json
# Returns JSON: {"status": "logged_in", "email": "...", "type": "claude_ai"}
```

```python
# Async credential check without PTY (short-lived, no interactive I/O)
import asyncio

async def _check_auth_status(self) -> bool:
    """Run 'claude auth status' and return True if logged in."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "auth", "status",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, _ = await asyncio.wait_for(proc.communicate(), timeout=10.0)
        return proc.returncode == 0
    except Exception:
        return False
```

### Failure Pattern Classification
```python
# Source: CONTEXT.md D-13, D-17 — hybrid exit code + output scan
FAILURE_PATTERNS: dict[str, list[str]] = {
    "auth_expired": [
        "authentication failed",
        "oauth token expired",
        "please run claude auth login",
        "session expired",
    ],
    "subscription_limit": [
        "rate limit",
        "usage limit",
        "subscription limit",
        "quota exceeded",
    ],
    "runtime_not_available": [
        "command not found",
        "no such file or directory",
    ],
}

def _classify_failure(self, exit_code: int, output: str) -> str:
    """Classify failure from exit code + last 50 lines of output (D-13, D-14)."""
    if exit_code == 0:
        return ""  # Not a failure
    last_lines = "\n".join(output.splitlines()[-50:]).lower()
    for reason, patterns in FAILURE_PATTERNS.items():
        if any(p in last_lines for p in patterns):
            return reason
    return "cli_crash"
```

### Named Volume in lifecycle.py
```python
# Source: Docker SDK docs + CONTEXT.md D-07
# Add to create_kubex() after existing volumes dict construction:
agent_id = agent_cfg.get("id", "")
runtime = agent_cfg.get("runtime", "openai-api")
if runtime != "openai-api":
    # Named volume for OAuth credential persistence (CLI-06)
    cred_mount = self._get_credential_mount(runtime)
    volume_name = f"kubex-creds-{agent_id}"
    volumes[volume_name] = {"bind": cred_mount, "mode": "rw"}

def _get_credential_mount(self, runtime: str) -> str:
    mounts = {
        "claude-code": "/root/.claude",
        "codex-cli": "/root/.codex",
        "gemini-cli": "/root/.config/gemini",
    }
    return mounts.get(runtime, "/root/.cli-creds")
```

### tini in Base Dockerfile
```dockerfile
# Source: krallin/tini GitHub + PITFALLS.md Pitfall 3
# Add to agents/_base/Dockerfile after apt-get install line:
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Change ENTRYPOINT:
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
# CMD stays the same (exec form already):
CMD ["python", "-m", "kubex_harness.main"]
```

### main.py Routing Addition
```python
# Source: existing main.py pattern — extend elif chain
elif config.harness_mode in ("standalone",) and config.runtime != "openai-api":
    # CLI runtime mode — runtime field selects which CLI to use
    from kubex_harness.cli_runtime import CLIRuntime

    runtime = CLIRuntime(config)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, runtime.stop)
    await runtime.run()
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-coded agent Dockerfiles | Universal `kubexclaw-base` + skill injection | v1.1 | CLI runtime is additive — no new Dockerfiles needed |
| `subprocess.Popen` for PTY | `pexpect.spawn()` | Best practice established 2022-2025 | No deadlock on large output; automatic TTY allocation |
| Shell form CMD in Docker | Exec form CMD + tini PID 1 | Docker best practice since 2016 | Correct SIGTERM delivery; zombie reaping |
| Polling for file changes | `watchfiles.awatch()` | 2021+ (watchfiles 0.x) | inotify-backed; no CPU wasted on polling |
| `claude --prompt` (old syntax) | `claude -p "..."` with `--output-format json` | Claude Code 2025 | Structured JSON output; exit code 0/1 for success/failure |

**Deprecated/outdated:**
- `subprocess.communicate()` with PTY subprocess: known deadlock, never use
- Env vars for OAuth token injection: security anti-pattern, never implement even in dev

---

## Open Questions

1. **pexpect thread-safety in asyncio context**
   - What we know: `pexpect.spawn()` is not safe in multithreaded applications (ptyprocess Issue #43). Running drain in `loop.run_in_executor()` creates a thread.
   - What's unclear: Whether single-threaded executor use (one thread per task, never concurrent) is safe in practice.
   - Recommendation: Use a `ThreadPoolExecutor(max_workers=1)` as the executor for drain loops. This ensures only one pexpect instance runs at a time (matches D-01 fresh process per task anyway).

2. **claude auth status vs. file existence check**
   - What we know: `claude auth status` exits 0 if authenticated (official docs). File check (`~/.claude/.credentials.json` non-empty) is D-04's approach.
   - What's unclear: Whether `claude auth status` is reliable enough to use instead of file check, or if the combination is better.
   - Recommendation: Use file existence check (D-04, locked decision) as primary. Run `claude auth status` as secondary verification if file exists but first task fails with auth error.

3. **CLAUDE.md location for Claude Code to pick it up**
   - What we know: Claude Code reads `CLAUDE.md` from current working directory and parent directories.
   - What's unclear: Whether `/app/CLAUDE.md` is picked up when `claude` is spawned with working dir `/app`.
   - Recommendation: Spawn `claude` with `cwd="/app"` in pexpect. Write `CLAUDE.md` to `/app/CLAUDE.md`. Verify in Wave 0 integration test.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (existing, configured in root `pyproject.toml`) |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `pytest tests/unit/test_cli_runtime.py -x -q` |
| Full suite command | `pytest tests/ -x -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | PTY subprocess launches and returns output | unit | `pytest tests/unit/test_cli_runtime.py::test_pty_spawn_success -x` | Wave 0 |
| CLI-01 | Large output (>100KB) does not deadlock | unit | `pytest tests/unit/test_cli_runtime.py::test_large_output_no_deadlock -x` | Wave 0 |
| CLI-02 | Credential check returns False when file missing | unit | `pytest tests/unit/test_cli_runtime.py::test_credentials_missing -x` | Wave 0 |
| CLI-02 | HITL action sent when credentials missing at boot | unit | `pytest tests/unit/test_cli_runtime.py::test_hitl_triggered_on_missing_creds -x` | Wave 0 |
| CLI-02 | watchfiles watcher detects credential file appearance | unit | `pytest tests/unit/test_cli_runtime.py::test_credential_watcher_detects_file -x` | Wave 0 |
| CLI-03 | Auth-expired exit classified as `auth_expired` | unit | `pytest tests/unit/test_cli_runtime.py::test_failure_classification_auth_expired -x` | Wave 0 |
| CLI-03 | Non-zero exit + unknown pattern classified as `cli_crash` | unit | `pytest tests/unit/test_cli_runtime.py::test_failure_classification_cli_crash -x` | Wave 0 |
| CLI-03 | Auth-expired failure bypasses retry (D-16) | unit | `pytest tests/unit/test_cli_runtime.py::test_auth_expired_bypasses_retry -x` | Wave 0 |
| CLI-04 | SIGTERM handler forwards to child, exits within 5s | unit | `pytest tests/unit/test_cli_runtime.py::test_sigterm_forwarding -x` | Wave 0 |
| CLI-04 | SIGKILL sent if child still alive after 5s grace | unit | `pytest tests/unit/test_cli_runtime.py::test_sigkill_escalation -x` | Wave 0 |
| CLI-05 | CLAUDE.md written from skill files at boot | unit | `pytest tests/unit/test_cli_runtime.py::test_claude_md_written -x` | Wave 0 |
| CLI-06 | Named volume added to container for CLI runtimes | unit | `pytest tests/unit/test_kubex_manager_unit.py::test_named_volume_for_cli_runtime -x` | Wave 0 |
| CLI-07 | State transitions publish to lifecycle Redis channel | unit | `pytest tests/unit/test_cli_runtime.py::test_lifecycle_state_published -x` | Wave 0 |
| CLI-07 | Full boot sequence: BOOTING → CREDENTIAL_WAIT → READY | unit | `pytest tests/unit/test_cli_runtime.py::test_boot_sequence_credential_wait -x` | Wave 0 |
| CLI-07 | READY → BUSY → READY on task dispatch | unit | `pytest tests/unit/test_cli_runtime.py::test_task_loop_state_transitions -x` | Wave 0 |
| CLI-08 | Claude Code invocation includes required flags | unit | `pytest tests/unit/test_cli_runtime.py::test_command_includes_required_flags -x` | Wave 0 |
| CLI-08 | End-to-end: CLI agent picks up task, returns result | integration | `pytest tests/integration/test_cli_runtime_integration.py -x -m integration` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pytest tests/unit/test_cli_runtime.py -x -q`
- **Per wave merge:** `pytest tests/ -x -q`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/test_cli_runtime.py` — covers CLI-01 through CLI-08 unit behaviors
- [ ] `tests/integration/test_cli_runtime_integration.py` — covers CLI-08 E2E with mocked `claude` binary
- [ ] `tests/unit/test_cli_runtime.py` fixtures: `mock_pexpect_spawn`, `mock_redis`, `mock_httpx_client`, `mock_watchfiles_awatch`
- [ ] `agents/_base/kubex_harness/cli_runtime.py` — the new module itself
- [ ] Framework: no install needed — pytest already in root pyproject.toml
- [ ] Named volume test additions to existing `test_kubex_manager_unit.py`

---

## Sources

### Primary (HIGH confidence)
- `agents/_base/kubex_harness/harness.py` — Existing PTY patterns, ExitReason enum, streaming, signal escalation
- `agents/_base/kubex_harness/config_loader.py` — `runtime` field already defined and loaded (line 88, 150)
- `agents/_base/kubex_harness/main.py` — harness_mode routing pattern to extend
- `agents/_base/kubex_harness/standalone.py` lines 604-611 — Signal handler pattern to follow
- `services/kubex-manager/kubex_manager/lifecycle.py` — Volume mount dict pattern for named volumes
- `libs/kubex-common/kubex_common/schemas/events.py` — LifecycleEvent and ProgressUpdate schemas
- `services/gateway/gateway/main.py` lines 712-724 — `POST /tasks/{task_id}/progress` endpoint
- [code.claude.com/docs/en/cli-reference](https://code.claude.com/docs/en/cli-reference) — Full Claude Code CLI flags, `-p`, `--output-format`, `--dangerously-skip-permissions`, `--no-session-persistence`, `claude auth status`
- `.planning/research/PITFALLS.md` — PTY buffer deadlock, Docker PID 1 blindness, OAuth token exposure
- `.planning/phases/09-cli-runtime-claude-code/09-CONTEXT.md` — All locked decisions

### Secondary (MEDIUM confidence)
- [PyPI watchfiles](https://pypi.org/project/watchfiles/) — `awatch()` asyncio API, version 1.1.1
- [pexpect docs](https://pexpect.readthedocs.io/en/stable/api/pexpect.html) — `spawn`, `read_nonblocking`, `dimensions`, asyncio integration
- [GitHub anthropics/claude-code Issue #1414](https://github.com/anthropics/claude-code/issues/1414) — Linux credential file at `~/.claude/.credentials.json` confirmed
- [GitHub tini](https://github.com/krallin/tini) — `ENTRYPOINT ["/usr/bin/tini", "--"]` pattern
- [petermalmgren.com/signal-handling-docker](https://petermalmgren.com/signal-handling-docker/) — PID 1 signal forwarding problem and tini solution

### Tertiary (LOW confidence)
- [GitHub pexpect/ptyprocess Issue #43](https://github.com/pexpect/ptyprocess/issues/43) — Thread-safety concern; recommendation to use single-threaded executor is a mitigation strategy, not officially documented as safe
- Claude Code `--output-format json` structure details — documented to return structured JSON but exact schema of the JSON envelope not found in official docs; should be verified in Wave 0 integration test

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — libraries confirmed via PyPI, official docs, and existing codebase usage
- Architecture: HIGH — patterns derived from official CLI docs + existing harness code; CLIRuntime design follows locked decisions verbatim
- Pitfalls: HIGH — grounded in PITFALLS.md (existing verified research) + official GitHub issues

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain — Claude Code CLI flags, pexpect API, tini usage are stable; OAuth credential file path could change on Claude Code version updates)
