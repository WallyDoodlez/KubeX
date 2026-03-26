"""CLIRuntime — core module for PTY-based CLI agent lifecycle management.

Manages the full lifecycle of a CLI-based agent (e.g. Claude Code):
  - PTY subprocess spawning via pexpect
  - Credential detection and HITL flow (D-04, D-06)
  - State machine: BOOTING -> CREDENTIAL_WAIT -> READY -> BUSY (D-08, D-12)
  - Failure classification with typed reasons (D-13, D-14, D-17)
  - Stdout streaming with time-batched progress chunks (D-09, D-10)
  - Retry logic: once on general failure, no retry on auth_expired (D-15, D-16)
  - Graceful signal forwarding: SIGTERM -> 5s grace -> SIGKILL (CLI-04)
  - Redis pub/sub lifecycle state events on lifecycle:{agent_id} channel

This module is self-contained. It is wired into main.py in Plan 03.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, TYPE_CHECKING

import httpx
import redis.asyncio as aioredis

# pexpect is Unix-only; provide a fallback for Windows test environments
try:
    import pexpect
except ImportError:
    pexpect = None  # type: ignore[assignment]

# watchfiles provides efficient async file watching; fall back to polling if unavailable
try:
    from watchfiles import awatch
except ImportError:
    awatch = None  # type: ignore[assignment]

from kubex_harness.config_loader import AgentConfig

logger = logging.getLogger("kubex_harness.cli_runtime")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Credential file paths per CLI runtime (D-04, D-07)
CREDENTIAL_PATHS: dict[str, Path] = {
    "claude-code": Path.home() / ".claude" / ".credentials.json",
    "gemini-cli": Path.home() / ".gemini" / "oauth_creds.json",
}

# Failure output patterns per reason (D-10, D-13, D-14, D-17)
FAILURE_PATTERNS: dict[str, list[str]] = {
    "auth_expired": [
        "authentication failed",
        "oauth token expired",
        "please run claude auth login",
        "session expired",
        # Gemini CLI auth failure patterns (D-10)
        "gemini_api_key environment variable not found",
        "waiting for auth",
        "unauthenticated",
        "failed to sign in",
        "invalid_grant",
    ],
    "subscription_limit": [
        "rate limit",
        "usage limit",
        "subscription limit",
        "quota exceeded",
        # Gemini CLI quota/rate limit patterns (D-10)
        "resource has been exhausted",
        "resource_exhausted",
        "you have exhausted your daily quota",
        "you exceeded your current quota",
        "ratelimitexceeded",
        "you must be a named user",
    ],
    "runtime_not_available": [
        "command not found",
        "no such file or directory",
    ],
}

# Skill file names per CLI runtime (D-04)
CLI_SKILL_FILES: dict[str, str] = {
    "claude-code": "CLAUDE.md",
    "gemini-cli": "GEMINI.md",
}

# Runtime-specific HITL auth instructions (D-08)
_HITL_AUTH_MESSAGES: dict[str, str] = {
    "claude-code": "docker exec -it <container> claude auth login",
    "gemini-cli": "docker exec -it <container> gemini   (select 'Login with Google')",
}


# ---------------------------------------------------------------------------
# CLI command builder functions (D-02)
# ---------------------------------------------------------------------------


def _build_claude_command(task_message: str, model: str | None) -> list[str]:
    """Build claude CLI command for non-interactive task execution."""
    cmd = [
        "claude",
        "-p", task_message,
        "--output-format", "json",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
    ]
    if model:
        cmd += ["--model", model]
    return cmd


def _build_gemini_command(task_message: str, model: str | None) -> list[str]:
    """Build gemini CLI command for non-interactive task execution."""
    cmd = [
        "gemini",
        "-p", task_message,
        "--output-format", "json",
    ]
    if model:
        cmd += ["--model", model]
    return cmd


# Dispatch table mapping runtime type to command builder function (D-02)
CLI_COMMAND_BUILDERS: dict[str, Callable[[str, str | None], list[str]]] = {
    "claude-code": _build_claude_command,
    "gemini-cli": _build_gemini_command,
}

# Maximum stdout buffer size (1MB) to prevent unbounded memory growth (Pitfall 1)
MAX_OUTPUT_BYTES = 1_048_576

# Progress chunk batch window in milliseconds (D-10)
PROGRESS_BATCH_MS = 500

# Redis URL — prefer REDIS_URL env var (includes auth) over hardcoded default
_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")

# Credential wait timeout in seconds (1 hour)
_CREDENTIAL_TIMEOUT_S = 3600.0

# Polling fallback interval when watchfiles is not available
_POLL_INTERVAL_S = 5.0

# Grace period for SIGTERM -> SIGKILL escalation
_SHUTDOWN_GRACE_S = 5.0


# ---------------------------------------------------------------------------
# CliState enum
# ---------------------------------------------------------------------------


class CliState(str, Enum):
    """Container lifecycle state for CLI-based agents (D-08, D-12)."""

    BOOTING = "booting"
    CREDENTIAL_WAIT = "credential_wait"
    READY = "ready"
    BUSY = "busy"


# ---------------------------------------------------------------------------
# CLIRuntime
# ---------------------------------------------------------------------------


class CLIRuntime:
    """Manages the full lifecycle of a CLI-based agent inside a Kubex container.

    Boot sequence (D-08):
        BOOTING -> install deps -> write skill file (CLAUDE.md or GEMINI.md) -> check creds
        -> (CREDENTIAL_WAIT if missing) -> READY -> poll tasks -> BUSY per task

    State transitions are published to Redis pub/sub on ``lifecycle:{agent_id}``.
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._state: CliState = CliState.BOOTING
        self._running: bool = True
        self._stop_event: asyncio.Event = asyncio.Event()
        self._child: Any | None = None  # pexpect.spawn instance or None
        self._redis: aioredis.Redis | None = None
        self._http: httpx.AsyncClient | None = None
        # Single-threaded executor for pexpect drain loop (open question 1 mitigation)
        self._executor = ThreadPoolExecutor(max_workers=1)
        # Hook server state (Phase 10)
        self._current_task_id: str | None = None
        self._hook_server: Any | None = None  # uvicorn.Server

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Main entry point — full boot sequence then task loop.

        Publishes BOOTING, initialises Redis/HTTP, runs credential gate,
        registers with Registry, enters task poll loop, deregisters on exit.
        """
        await self._publish_state(CliState.BOOTING)

        # Initialise shared connections
        self._redis = aioredis.from_url(_REDIS_URL, decode_responses=True)
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(60.0))

        try:
            # Write runtime-specific skill file (CLAUDE.md or GEMINI.md) (D-04, D-08)
            self._write_skill_file()

            # Gate on credentials before marking READY (D-08)
            await self._credential_gate()

            # Start hook server for Claude Code runtimes only (D-13)
            if self.config.runtime == "claude-code":
                from kubex_harness.hook_server import start_hook_server
                self._hook_server = await start_hook_server(self)

            self._state = CliState.READY
            await self._publish_state(CliState.READY)

            # Register with Registry
            await self._register()

            # Main task loop
            await self._task_loop()

        finally:
            # Deregister and close connections
            await self._deregister()
            if self._http:
                await self._http.aclose()
            if self._redis:
                await self._redis.aclose()
            self._executor.shutdown(wait=False)

    def stop(self) -> None:
        """Signal the runtime to stop. Called by SIGTERM signal handler.

        Sets ``_running = False`` and fires the stop event to unblock any
        waiting loops (credential wait, task poll).  If a child CLI process
        is running, schedules ``_graceful_shutdown`` as an asyncio task.
        """
        self._running = False
        self._stop_event.set()
        if self._hook_server is not None:
            self._hook_server.should_exit = True
        if self._child is not None:
            try:
                asyncio.ensure_future(self._graceful_shutdown())
            except RuntimeError:
                # No running event loop — best-effort synchronous terminate
                try:
                    if self._child.isalive():
                        self._child.terminate(force=False)
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # Boot sequence helpers
    # ------------------------------------------------------------------

    def _write_skill_file(self) -> None:
        """Write concatenated skill content to runtime-specific file (D-04).

        Writes CLAUDE.md for claude-code, GEMINI.md for gemini-cli.
        The CLI picks up instructions from its working directory (/app).
        """
        skill_filename = CLI_SKILL_FILES.get(self.config.runtime)
        if skill_filename is None:
            logger.warning("No skill file mapping for runtime=%s", self.config.runtime)
            return

        skills_dir = Path("/app/skills")
        skill_md_path = Path("/app") / skill_filename
        sections: list[str] = []

        if skills_dir.is_dir():
            for skill_entry in sorted(skills_dir.iterdir()):
                skill_md = skill_entry / "SKILL.md"
                if skill_md.exists():
                    try:
                        sections.append(skill_md.read_text(encoding="utf-8"))
                    except OSError:
                        logger.warning("Failed to read skill file: %s", skill_md)

        try:
            skill_md_path.write_text("\n\n---\n\n".join(sections), encoding="utf-8")
            logger.info("Wrote %s with %d skill sections", skill_filename, len(sections))
        except OSError as exc:
            logger.warning("Could not write %s: %s", skill_filename, exc)

    async def _credential_gate(self) -> None:
        """Check credentials; block in CREDENTIAL_WAIT if missing (D-06, D-08).

        Sends HITL ``request_user_input`` action asking the operator to run
        ``docker exec -it <container> claude auth login``, then watches for the
        credential file to appear via watchfiles or polling fallback.

        Raises SystemExit on 1-hour timeout (agent cannot proceed without auth).
        """
        if self._credentials_present(self.config.runtime):
            logger.info("Credentials present for runtime=%s", self.config.runtime)
            return

        # Credentials missing — transition to CREDENTIAL_WAIT
        self._state = CliState.CREDENTIAL_WAIT
        await self._publish_state(CliState.CREDENTIAL_WAIT)
        logger.warning(
            "Credentials missing for runtime=%s — sending HITL request", self.config.runtime
        )

        auth_instruction = _HITL_AUTH_MESSAGES.get(
            self.config.runtime,
            f"docker exec -it <container> {self.config.runtime}",
        )
        hitl_message = (
            f"Agent '{self.config.agent_id}' needs CLI authentication. "
            f"Please run: {auth_instruction}"
        )
        await self._request_hitl(hitl_message)

        # Wait for credentials to appear
        appeared = await self._wait_for_credentials(
            self.config.runtime, timeout_s=_CREDENTIAL_TIMEOUT_S
        )
        if not appeared:
            if not self._running:
                logger.info("Shutdown requested during credential wait — exiting cleanly")
                raise SystemExit(0)
            logger.error(
                "Credential timeout after %.0fs for runtime=%s — shutting down",
                _CREDENTIAL_TIMEOUT_S,
                self.config.runtime,
            )
            raise SystemExit(1)

        logger.info("Credentials appeared for runtime=%s", self.config.runtime)

    def _credentials_present(self, runtime: str) -> bool:
        """Check whether the CLI credential file exists and is non-empty (D-04).

        Returns False for unknown runtimes (no credential path registered).
        Does NOT parse or validate the credential content.
        """
        cred_path = CREDENTIAL_PATHS.get(runtime)
        if cred_path is None:
            return False
        try:
            return cred_path.exists() and cred_path.stat().st_size > 0
        except OSError:
            return False

    async def _wait_for_credentials(
        self, runtime: str, timeout_s: float = _CREDENTIAL_TIMEOUT_S
    ) -> bool:
        """Wait for credential file to appear using watchfiles or polling fallback.

        Uses ``watchfiles.awatch()`` when available (inotify-backed, efficient).
        Falls back to a 5-second polling loop if watchfiles is not installed.

        Args:
            runtime: Runtime key to check (e.g. ``"claude-code"``).
            timeout_s: Maximum wait time in seconds before returning False.

        Returns:
            True when credentials appear, False on timeout.
        """
        cred_path = CREDENTIAL_PATHS.get(runtime)
        if cred_path is None:
            return False

        watch_dir = cred_path.parent
        watch_dir.mkdir(parents=True, exist_ok=True)

        deadline = time.monotonic() + timeout_s

        if awatch is not None:
            # Use watchfiles async watcher (inotify-backed)
            try:
                async with asyncio.timeout(timeout_s):
                    async for _ in awatch(str(watch_dir), stop_event=self._stop_event):
                        if not self._running:
                            return False
                        if self._credentials_present(runtime):
                            return True
            except (TimeoutError, asyncio.TimeoutError):
                return False
            return False
        else:
            # Polling fallback
            while time.monotonic() < deadline and self._running:
                if self._credentials_present(runtime):
                    return True
                # Use stop_event.wait with short timeout instead of asyncio.sleep
                # so we can be interrupted by stop()
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(), timeout=_POLL_INTERVAL_S
                    )
                    return False  # stop_event was set
                except (TimeoutError, asyncio.TimeoutError):
                    pass  # Normal timeout — continue polling
            return False

    # ------------------------------------------------------------------
    # Registry
    # ------------------------------------------------------------------

    async def _register(self) -> None:
        """Register this agent with the Registry (retries up to 5 times)."""
        if self._http is None:
            return
        url = f"{self.config.registry_url}/agents"
        payload = {
            "agent_id": self.config.agent_id,
            "capabilities": self.config.capabilities,
            "status": "running",
            "boundary": self.config.boundary,
        }
        for attempt in range(5):
            try:
                resp = await self._http.post(url, json=payload)
                if resp.status_code in (200, 201, 422):
                    logger.info("Registered agent %s in registry", self.config.agent_id)
                    return
            except Exception:
                logger.info("Registry not ready (attempt %d/5)", attempt + 1)
            await asyncio.sleep(3)
        logger.warning("Could not register agent %s after 5 attempts", self.config.agent_id)

    async def _deregister(self) -> None:
        """Deregister this agent from the Registry on shutdown."""
        if self._http is None:
            return
        url = f"{self.config.registry_url}/agents/{self.config.agent_id}"
        try:
            await self._http.delete(url)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Task loop
    # ------------------------------------------------------------------

    async def _task_loop(self) -> None:
        """Poll the Broker for tasks, dispatching each via _execute_task.

        READY -> BUSY -> READY cycle per task. Stops when ``_running`` is False.
        Uses /messages/consume/{capability} endpoint with capability-based
        consumer groups (same pattern as MCP Bridge orchestrator).
        """
        # CLI agents poll one capability at a time; use the first capability
        # as the consumer group name (matches Broker's filter_by_capability logic)
        primary_cap = self.config.capabilities[0] if self.config.capabilities else "default"
        poll_url = f"{self.config.broker_url}/messages/consume/{primary_cap}"

        while self._running:
            # Pre-flight credential check (Pitfall 3 — token may expire mid-session)
            if not self._credentials_present(self.config.runtime):
                logger.warning("Credentials expired mid-session — re-gating")
                self._state = CliState.CREDENTIAL_WAIT
                await self._publish_state(CliState.CREDENTIAL_WAIT)
                await self._credential_gate()
                self._state = CliState.READY
                await self._publish_state(CliState.READY)

            try:
                if self._http is None:
                    await asyncio.sleep(2)
                    continue
                resp = await self._http.get(poll_url, params={"count": 1, "block_ms": 0})
                if resp.status_code == 200:
                    messages = resp.json()
                    if not messages:
                        await asyncio.sleep(2)
                        continue
                    # Extract task from first message
                    msg = messages[0]
                    task = {
                        "task_id": msg.get("task_id", ""),
                        "message": msg.get("context_message", ""),
                        "capability": msg.get("capability", primary_cap),
                        "_message_id": msg.get("message_id", ""),
                    }
                    self._state = CliState.BUSY
                    await self._publish_state(CliState.BUSY)
                    await self._execute_task(task)
                    # ACK the message after task completion
                    message_id = task.get("_message_id", "")
                    if message_id and self._http:
                        try:
                            await self._http.post(
                                f"{self.config.broker_url}/messages/{message_id}/ack",
                                json={"group": primary_cap, "message_id": message_id},
                            )
                        except Exception:
                            logger.warning("Failed to ACK message %s", message_id)
                    if self._state != CliState.CREDENTIAL_WAIT:
                        self._state = CliState.READY
                        await self._publish_state(CliState.READY)
                else:
                    logger.warning("Broker returned %d", resp.status_code)
                    await asyncio.sleep(2)
            except Exception:
                logger.exception("Error in task loop iteration")
                await asyncio.sleep(2)

    # ------------------------------------------------------------------
    # Task execution
    # ------------------------------------------------------------------

    async def _execute_task(self, task: dict[str, Any]) -> None:
        """Execute a single task: spawn CLI, classify result, post result/failure.

        Retry logic (D-15, D-16):
          - auth_expired: no retry — transition to CREDENTIAL_WAIT
          - other failures: retry once with a fresh process, then task_failed
        """
        task_id = task.get("task_id", "unknown")
        message = task.get("message", "")

        logger.info("Starting task %s", task_id)

        # Set task correlation ID BEFORE any await so hook events arriving early
        # are correctly correlated (Pitfall 6 — D-18)
        self._current_task_id = task_id

        try:
            await self._execute_task_inner(task_id, message)
        finally:
            self._current_task_id = None

    async def _execute_task_inner(self, task_id: str, message: str) -> None:
        """Inner task execution — called from _execute_task with _current_task_id set."""
        # Pre-flight credential check per task (Pitfall 3)
        if not self._credentials_present(self.config.runtime):
            logger.warning("Credentials missing before task %s — credential gate", task_id)
            self._state = CliState.CREDENTIAL_WAIT
            await self._publish_state(CliState.CREDENTIAL_WAIT)
            await self._credential_gate()
            self._state = CliState.BUSY
            await self._publish_state(CliState.BUSY)

        # Attempt 1
        exit_code, stdout = await self._run_cli_process(message)

        if exit_code == 0:
            await self._post_result_success(task_id, stdout)
            await self._post_progress(task_id, "", final=True, exit_reason="completed")
            logger.info("Task %s completed successfully", task_id)
            return

        # Non-zero exit — classify
        reason = self._classify_failure(exit_code, stdout)
        logger.warning("Task %s failed: exit_code=%d reason=%s", task_id, exit_code, reason)

        if reason == "auth_expired":
            # D-16: no retry — go straight to CREDENTIAL_WAIT
            await self._post_result_failed(task_id, stdout, reason)
            await self._post_progress(task_id, "", final=True, exit_reason=reason)
            self._state = CliState.CREDENTIAL_WAIT
            await self._publish_state(CliState.CREDENTIAL_WAIT)
            await self._credential_gate()
            # Do not transition back to BUSY here; task_loop will do READY
            return

        # D-15: retry once for non-auth failures
        logger.info("Retrying task %s (reason=%s)", task_id, reason)
        exit_code2, stdout2 = await self._run_cli_process(message)

        if exit_code2 == 0:
            await self._post_result_success(task_id, stdout2)
            await self._post_progress(task_id, "", final=True, exit_reason="completed")
            logger.info("Task %s completed on retry", task_id)
            return

        # Still failed after retry
        reason2 = self._classify_failure(exit_code2, stdout2)
        await self._post_result_failed(task_id, stdout2, reason2)
        await self._post_progress(task_id, "", final=True, exit_reason=reason2)
        logger.error("Task %s failed after retry: reason=%s", task_id, reason2)

    async def _post_result_success(self, task_id: str, stdout: str) -> None:
        """POST success result to Broker."""
        url = f"{self.config.broker_url}/tasks/{task_id}/result"
        payload = {
            "task_id": task_id,
            "agent_id": self.config.agent_id,
            "result": {
                "status": "completed",
                "output": stdout,
            },
        }
        try:
            if self._http:
                await self._http.post(url, json=payload)
        except Exception:
            logger.debug("Failed to post success result for task %s", task_id)

    async def _post_result_failed(self, task_id: str, stdout: str, reason: str) -> None:
        """POST failure result to Broker."""
        url = f"{self.config.broker_url}/tasks/{task_id}/result"
        payload = {
            "task_id": task_id,
            "agent_id": self.config.agent_id,
            "result": {
                "status": "failed",
                "reason": reason,
                "output": stdout,
            },
        }
        try:
            if self._http:
                await self._http.post(url, json=payload)
        except Exception:
            logger.debug("Failed to post failure result for task %s", task_id)

    # ------------------------------------------------------------------
    # Hook event handlers (Phase 10 — called by hook_server.py)
    # ------------------------------------------------------------------

    async def _on_post_tool_use(self, event: Any) -> None:
        """Handle PostToolUse hook — write audit entry (D-14, D-18)."""
        task_id = self._current_task_id
        if task_id is None:
            logger.warning("hook_post_tool_use_no_task_id tool=%s", event.tool_name)
            return
        success = event.tool_response.get("success", True)
        await self._write_audit_entry(task_id, event.tool_name, success)
        # D-11: structured stdout log for future Fluent Bit pipeline
        logger.info(
            "audit_entry task_id=%s tool=%s success=%s",
            task_id, event.tool_name, success,
        )

    async def _on_stop(self, event: Any) -> None:
        """Handle Stop hook — emit task_progress lifecycle event (D-15)."""
        task_id = self._current_task_id
        if task_id is None:
            return
        await self._post_progress(
            task_id,
            chunk=f"turn_complete: {event.last_assistant_message[:200]}",
            final=False,
        )

    async def _on_subagent_stop(self, event: Any) -> None:
        """Handle SubagentStop hook — audit log only, no pub/sub (D-17)."""
        logger.info(
            "subagent_stop session=%s agent_type=%s",
            event.session_id, event.agent_type,
        )

    async def _on_session_end(self, event: Any) -> None:
        """Handle SessionEnd hook — metadata enrichment only (D-16)."""
        logger.info(
            "session_end session=%s reason=%s",
            event.session_id, event.reason,
        )

    async def _write_audit_entry(
        self, task_id: str, tool_name: str, success: bool
    ) -> None:
        """Write audit entry to Redis sorted set audit:{task_id} (D-11, D-12, D-14).

        Best-effort: never raises. Audit must not block task processing.
        """
        if self._redis is None:
            return
        ts = time.time()
        entry = json.dumps({"tool_name": tool_name, "timestamp": ts, "success": success})
        key = f"audit:{task_id}"
        try:
            await self._redis.zadd(key, {entry: ts})
            await self._redis.expire(key, 86400)  # 24h TTL (D-12)
        except Exception:
            logger.warning("audit_write_failed task_id=%s tool=%s", task_id, tool_name)

    # ------------------------------------------------------------------
    # CLI process management
    # ------------------------------------------------------------------

    async def _run_cli_process(self, task_message: str) -> tuple[int, str]:
        """Spawn CLI via PTY, drain output, return (exit_code, stdout).

        Uses ``pexpect.spawn()`` which allocates a PTY automatically.
        The drain loop runs in a single-threaded executor to avoid blocking
        the asyncio event loop (Pitfall 1, open question 1).

        Args:
            task_message: The task prompt to pass to the CLI via ``-p``.

        Returns:
            Tuple of (exit_code, accumulated_stdout).
        """
        if pexpect is None:
            raise RuntimeError("pexpect is not installed — cannot spawn CLI process")

        cmd_list = self._build_command(task_message)
        cmd_str = cmd_list[0]
        cmd_args = cmd_list[1:]

        # Spawn with large terminal window to minimise line-wrapping artefacts
        # cwd="/app" ensures CLAUDE.md is picked up (open question 3)
        child = pexpect.spawn(
            cmd_str,
            args=cmd_args,
            timeout=None,
            encoding="utf-8",
            dimensions=(10000, 200),
            cwd="/app",
        )
        self._child = child

        buf: list[str] = []
        loop = asyncio.get_event_loop()

        try:
            await loop.run_in_executor(
                self._executor,
                self._drain_to_buffer,
                child,
                buf,
                "running",  # task_id not available here; progress handled separately
            )
        finally:
            try:
                child.close()
            except Exception:
                pass
            exit_code = child.exitstatus if child.exitstatus is not None else 0
            self._child = None

        return exit_code, "".join(buf)

    def _build_command(self, task_message: str) -> list[str]:
        """Build CLI command for non-interactive task execution (D-02).

        Dispatches to the correct builder function per runtime type via
        CLI_COMMAND_BUILDERS. Falls back to using the runtime name as command
        with -p flag if no builder is registered.
        """
        builder = CLI_COMMAND_BUILDERS.get(self.config.runtime)
        if builder:
            return builder(task_message, self.config.model or None)
        # Fallback: use runtime name as command with -p flag
        cmd = [self.config.runtime, "-p", task_message]
        if self.config.model:
            cmd += ["--model", self.config.model]
        return cmd

    def _drain_to_buffer(self, child: Any, buf: list[str], task_id: str) -> None:
        """Blocking drain loop — runs in thread pool executor (Pitfall 1).

        Reads from pexpect child in non-blocking mode with 0.1s timeout.
        Accumulates chunks into ``buf``. Stops on EOF or when child exits.
        Truncates at MAX_OUTPUT_BYTES with a warning.

        Args:
            child: pexpect.spawn instance.
            buf: List to accumulate output chunks.
            task_id: Task identifier for logging.
        """
        if pexpect is None:
            return

        total_bytes = 0

        while True:
            try:
                chunk = child.read_nonblocking(size=4096, timeout=0.1)
                chunk_bytes = len(chunk.encode("utf-8", errors="replace"))

                if total_bytes + chunk_bytes > MAX_OUTPUT_BYTES:
                    # Accept up to the limit, then stop accepting more
                    remaining = MAX_OUTPUT_BYTES - total_bytes
                    if remaining > 0:
                        buf.append(chunk[:remaining])
                    logger.warning(
                        "Task %s: stdout truncated at %d bytes (MAX_OUTPUT_BYTES)",
                        task_id,
                        MAX_OUTPUT_BYTES,
                    )
                    break

                buf.append(chunk)
                total_bytes += chunk_bytes

            except pexpect.TIMEOUT:
                # No data in this 0.1s window — check if process is still alive
                if not child.isalive():
                    break
                # Still alive — continue draining

            except pexpect.EOF:
                # Process has closed its output
                break

            except Exception as exc:
                logger.debug("Drain loop exception: %s", exc)
                break

    # ------------------------------------------------------------------
    # Failure classification
    # ------------------------------------------------------------------

    def _classify_failure(self, exit_code: int, output: str) -> str:
        """Classify failure reason from exit code and output patterns (D-13, D-14).

        Scans the last 50 lines of output (lowercased) against FAILURE_PATTERNS.
        Returns the first matching reason key, or ``"cli_crash"`` as default.

        Args:
            exit_code: Process exit code.
            output: Accumulated stdout from the CLI process.

        Returns:
            Empty string if exit_code == 0 (not a failure).
            One of: ``"auth_expired"``, ``"subscription_limit"``,
            ``"runtime_not_available"``, ``"cli_crash"``.
        """
        if exit_code == 0:
            return ""

        last_lines = "\n".join(output.splitlines()[-50:]).lower()
        for reason, patterns in FAILURE_PATTERNS.items():
            if any(p in last_lines for p in patterns):
                return reason

        return "cli_crash"

    # ------------------------------------------------------------------
    # State publishing
    # ------------------------------------------------------------------

    async def _publish_state(self, state: CliState) -> None:
        """Publish state transition event to Redis lifecycle pub/sub channel (D-12).

        Publishes JSON ``{"agent_id": ..., "state": ..., "timestamp": ...}``
        to ``lifecycle:{agent_id}``. Wrapped in try/except — state publish
        must never block or raise.
        """
        if self._redis is None:
            # Pre-boot or connection not yet established — silently skip
            return

        payload = {
            "agent_id": self.config.agent_id,
            "state": state.value,
            "timestamp": datetime.utcnow().isoformat(),
        }
        channel = f"lifecycle:{self.config.agent_id}"
        try:
            await self._redis.publish(channel, json.dumps(payload))
        except Exception as exc:
            logger.warning("Failed to publish state %s: %s", state.value, exc)

    # ------------------------------------------------------------------
    # Progress streaming
    # ------------------------------------------------------------------

    async def _post_progress(
        self,
        task_id: str,
        chunk: str,
        *,
        final: bool = False,
        exit_reason: str | None = None,
    ) -> None:
        """POST a progress chunk to Gateway ``/tasks/{task_id}/progress`` (D-09).

        Uses the standard progress schema: {"chunk": ..., "final": ..., "exit_reason": ...}
        matching MCP Bridge and Standalone harness format.

        Wrapped in try/except — progress posting must never raise.
        """
        if self._http is None:
            return
        url = f"{self.config.gateway_url}/tasks/{task_id}/progress"
        payload: dict[str, Any] = {
            "task_id": task_id,
            "agent_id": self.config.agent_id,
            "chunk": chunk,
            "final": final,
        }
        if exit_reason is not None:
            payload["exit_reason"] = exit_reason
        try:
            await self._http.post(url, json=payload)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # HITL
    # ------------------------------------------------------------------

    async def _request_hitl(self, message: str) -> None:
        """Send a ``request_user_input`` HITL action to Gateway (D-06).

        Asks the operator to authenticate the CLI inside the container.
        Wrapped in try/except — HITL failure must not crash the harness.
        """
        if self._http is None:
            return
        url = f"{self.config.gateway_url}/actions"
        payload = {
            "action": "request_user_input",
            "agent_id": self.config.agent_id,
            "payload": {"message": message},
        }
        try:
            await self._http.post(url, json=payload)
        except Exception:
            logger.debug("Failed to send HITL request_user_input")

    # ------------------------------------------------------------------
    # Graceful shutdown
    # ------------------------------------------------------------------

    async def _graceful_shutdown(self) -> None:
        """Forward SIGTERM to PTY child, wait 5s, escalate to SIGKILL (CLI-04).

        Step 1: ``child.terminate(force=False)`` — sends SIGTERM.
        Step 2: Wait up to 5s in 0.1s increments.
        Step 3: ``child.terminate(force=True)`` — sends SIGKILL if still alive.
        """
        child = self._child
        if child is None:
            return

        # Step 1: SIGTERM — always attempt, even if we think it's dead
        try:
            child.terminate(force=False)
        except Exception:
            pass

        # Step 2: Wait up to 5s checking if the child exited
        elapsed = 0.0
        while elapsed < _SHUTDOWN_GRACE_S:
            try:
                if not child.isalive():
                    return
            except Exception:
                return
            await asyncio.sleep(0.1)
            elapsed += 0.1

        # Step 3: SIGKILL — child is still alive after grace period
        try:
            child.terminate(force=True)
        except Exception:
            pass
