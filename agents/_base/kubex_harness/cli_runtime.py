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
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

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

# Credential file paths per CLI runtime (D-04)
CREDENTIAL_PATHS: dict[str, Path] = {
    "claude-code": Path.home() / ".claude" / ".credentials.json",
}

# Failure output patterns per reason (D-13, D-14, D-17)
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

# Maximum stdout buffer size (1MB) to prevent unbounded memory growth (Pitfall 1)
MAX_OUTPUT_BYTES = 1_048_576

# Progress chunk batch window in milliseconds (D-10)
PROGRESS_BATCH_MS = 500

# Redis URL default
_REDIS_URL = "redis://redis:6379"

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
        BOOTING -> install deps -> write CLAUDE.md -> check creds
        -> (CREDENTIAL_WAIT if missing) -> READY -> poll tasks -> BUSY per task

    State transitions are published to Redis pub/sub on ``lifecycle:{agent_id}``.
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._state: CliState = CliState.BOOTING
        self._running: bool = True
        self._child: Any | None = None  # pexpect.spawn instance or None
        self._redis: aioredis.Redis | None = None
        self._http: httpx.AsyncClient | None = None
        # Single-threaded executor for pexpect drain loop (open question 1 mitigation)
        self._executor = ThreadPoolExecutor(max_workers=1)

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
            # Write CLAUDE.md from skill files (D-08, Pattern 8)
            self._write_claude_md()

            # Gate on credentials before marking READY (D-08)
            await self._credential_gate()

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

        Sets ``_running = False``.  If a child CLI process is running,
        schedules ``_graceful_shutdown`` as an asyncio task.
        """
        self._running = False
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

    def _write_claude_md(self) -> None:
        """Write concatenated skill content to /app/CLAUDE.md (D-08, Pattern 8).

        Claude Code picks up CLAUDE.md from its working directory (/app),
        which makes skill instructions available to the LLM.
        """
        skills_dir = Path("/app/skills")
        claude_md_path = Path("/app/CLAUDE.md")
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
            claude_md_path.write_text("\n\n---\n\n".join(sections), encoding="utf-8")
            logger.info("Wrote CLAUDE.md with %d skill sections", len(sections))
        except OSError as exc:
            logger.warning("Could not write CLAUDE.md: %s", exc)

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

        hitl_message = (
            f"Agent '{self.config.agent_id}' needs CLI authentication. "
            f"Please run: docker exec -it <container> claude auth login"
        )
        await self._request_hitl(hitl_message)

        # Wait for credentials to appear
        appeared = await self._wait_for_credentials(
            self.config.runtime, timeout_s=_CREDENTIAL_TIMEOUT_S
        )
        if not appeared:
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
                    async for _ in awatch(str(watch_dir)):
                        if self._credentials_present(runtime):
                            return True
            except (TimeoutError, asyncio.TimeoutError):
                return False
            return False
        else:
            # Polling fallback
            while time.monotonic() < deadline:
                if self._credentials_present(runtime):
                    return True
                await asyncio.sleep(_POLL_INTERVAL_S)
            return False

    # ------------------------------------------------------------------
    # Registry
    # ------------------------------------------------------------------

    async def _register(self) -> None:
        """Register this agent with the Registry (retries up to 5 times)."""
        if self._http is None:
            return
        url = f"{self.config.gateway_url}/registry/agents"
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
        url = f"{self.config.gateway_url}/registry/agents/{self.config.agent_id}"
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
        """
        caps = ",".join(self.config.capabilities)
        poll_url = f"{self.config.broker_url}/tasks/next"

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
                resp = await self._http.get(poll_url, params={"capabilities": caps})
                if resp.status_code == 204:
                    await asyncio.sleep(2)
                    continue
                if resp.status_code == 200:
                    task = resp.json()
                    self._state = CliState.BUSY
                    await self._publish_state(CliState.BUSY)
                    await self._execute_task(task)
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
            logger.info("Task %s completed successfully", task_id)
            return

        # Non-zero exit — classify
        reason = self._classify_failure(exit_code, stdout)
        logger.warning("Task %s failed: exit_code=%d reason=%s", task_id, exit_code, reason)

        if reason == "auth_expired":
            # D-16: no retry — go straight to CREDENTIAL_WAIT
            await self._post_result_failed(task_id, stdout, reason)
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
            logger.info("Task %s completed on retry", task_id)
            return

        # Still failed after retry
        reason2 = self._classify_failure(exit_code2, stdout2)
        await self._post_result_failed(task_id, stdout2, reason2)
        logger.error("Task %s failed after retry: reason=%s", task_id, reason2)

    async def _post_result_success(self, task_id: str, stdout: str) -> None:
        """POST success result to Gateway."""
        url = f"{self.config.gateway_url}/tasks/{task_id}/result"
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
        """POST failure result to Gateway."""
        url = f"{self.config.gateway_url}/tasks/{task_id}/result"
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
        """Build the claude CLI command list for non-interactive task execution.

        Pattern 2 from RESEARCH.md — uses ``-p`` flag with structured JSON output.
        """
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
        except Exception:
            pass  # State publish must never block task processing

    # ------------------------------------------------------------------
    # Progress streaming
    # ------------------------------------------------------------------

    async def _post_progress(
        self,
        task_id: str,
        content: str,
        *,
        final: bool = False,
        sequence: int = 0,
    ) -> None:
        """POST a progress chunk to Gateway ``/tasks/{task_id}/progress`` (D-09).

        Wrapped in try/except — progress posting must never raise.
        """
        if self._http is None:
            return
        url = f"{self.config.gateway_url}/tasks/{task_id}/progress"
        payload = {
            "task_id": task_id,
            "action": "progress_update",
            "chunk_type": "stdout",
            "content": content,
            "sequence": sequence,
            "final": final,
            "agent_id": self.config.agent_id,
        }
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
