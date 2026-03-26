"""kubex-harness — Manages the OpenClaw subprocess lifecycle inside agent containers.

Implements Stream 4B:
  - PTY spawn of 'openclaw agent --local --message "<task>"'
  - stdout/stderr capture with chunk buffering
  - POST /tasks/{task_id}/progress to Gateway
  - Redis control:{agent_id} subscription for cancel commands
  - Graceful cancellation escalation: keystroke -> SIGTERM -> SIGKILL
  - Final progress update with exit_reason
  - Task result storage via Broker POST /tasks/{task_id}/result

All external dependencies (pty, subprocess, httpx, redis, os) are module-level
imports so they can be patched by tests via unittest.mock.patch.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Any

import httpx
import redis.asyncio  # type: ignore[import]

# SIGKILL is not available on Windows; fall back to SIGTERM for portability.
_SIGKILL: int = getattr(signal, "SIGKILL", signal.SIGTERM)

# pty is a Unix-only module.  Provide a lightweight stub on Windows so that
# the module is importable and tests can patch kubex_harness.harness.pty.openpty.
try:
    import pty  # Unix only
except ImportError:
    # Minimal stub that makes the module importable on Windows.
    # All real usage of pty.openpty will be patched in tests.
    import types as _types

    pty = _types.ModuleType("pty")  # type: ignore[assignment]

    def _openpty_stub() -> tuple[int, int]:  # pragma: no cover
        raise NotImplementedError("pty.openpty is not available on this platform")

    pty.openpty = _openpty_stub  # type: ignore[attr-defined]
    sys.modules["pty"] = pty


# ---------------------------------------------------------------------------
# ExitReason enum
# ---------------------------------------------------------------------------


class ExitReason(str, Enum):
    """Reason why the openclaw subprocess exited."""

    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


# ---------------------------------------------------------------------------
# HarnessConfig
# ---------------------------------------------------------------------------


@dataclass
class HarnessConfig:
    """Configuration for the KubexHarness, driven entirely by environment variables.

    Set by Kubex Manager when creating agent containers.
    """

    agent_id: str
    task_id: str
    gateway_url: str
    task_message: str = ""
    progress_buffer_ms: int = 500
    progress_max_chunk_kb: int = 16
    abort_keystroke: str = "\x03"  # Ctrl+C
    abort_grace_period_s: int = 30
    redis_url: str = ""
    broker_url: str = ""

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> HarnessConfig:
        """Load HarnessConfig from a dict of environment variables.

        Args:
            env: Dict of env vars.  Defaults to os.environ if None.

        Returns:
            Populated HarnessConfig.

        Raises:
            ValueError: If a required field is missing or empty.
        """
        if env is None:
            env = dict(os.environ)

        # Required fields
        agent_id = _require_env(env, "KUBEX_AGENT_ID")
        task_id = _require_env(env, "KUBEX_TASK_ID")
        gateway_url = _require_env(env, "GATEWAY_URL")

        task_message = env.get("KUBEX_TASK_MESSAGE", "")

        # Optional fields with defaults
        progress_buffer_ms = int(env.get("KUBEX_PROGRESS_BUFFER_MS", "500"))
        progress_max_chunk_kb = int(env.get("KUBEX_PROGRESS_MAX_CHUNK_KB", "16"))
        abort_grace_period_s = int(env.get("KUBEX_ABORT_GRACE_PERIOD_S", "30"))
        abort_keystroke = env.get("KUBEX_ABORT_KEYSTROKE", "\x03")
        redis_url = env.get("REDIS_URL", "")
        broker_url = env.get("BROKER_URL", gateway_url)

        return cls(
            agent_id=agent_id,
            task_id=task_id,
            task_message=task_message,
            gateway_url=gateway_url,
            progress_buffer_ms=progress_buffer_ms,
            progress_max_chunk_kb=progress_max_chunk_kb,
            abort_keystroke=abort_keystroke,
            abort_grace_period_s=abort_grace_period_s,
            redis_url=redis_url,
            broker_url=broker_url,
        )


def _require_env(env: dict[str, str], key: str) -> str:
    """Get a required env var, raising ValueError if absent or empty."""
    value = env.get(key)
    if not value:
        raise ValueError(f"Required environment variable not set: {key}")
    return value


# ---------------------------------------------------------------------------
# KubexHarness
# ---------------------------------------------------------------------------


class KubexHarness:
    """Manages the OpenClaw subprocess lifecycle for a single task.

    Usage::

        config = HarnessConfig.from_env()
        harness = KubexHarness(config)
        await harness.run()
    """

    def __init__(self, config: HarnessConfig, redis_client: Any = None) -> None:
        self.config = config
        self._redis_client = redis_client
        self._proc: subprocess.Popen | None = None  # type: ignore[type-arg]
        self._pty_master: int | None = None
        self._cancelled = False
        self._exit_reason: ExitReason | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(self) -> ExitReason:
        """Run openclaw, stream progress, handle cancellation, store result.

        Returns:
            ExitReason describing why the subprocess exited.
        """
        # Open a PTY for openclaw (it detects TTY for interactive mode)
        master_fd, slave_fd = pty.openpty()
        self._pty_master = master_fd

        # Build the command
        cmd = ["openclaw", "agent", "--local", "--message", self.config.task_message]

        # Spawn subprocess
        proc = subprocess.Popen(
            cmd,
            stdin=slave_fd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        self._proc = proc

        # Use asyncio tasks so the cancel listener can run even after output streaming ends
        async with httpx.AsyncClient() as http_client:
            stream_task = asyncio.ensure_future(self._stream_output(proc, http_client))
            cancel_task = asyncio.ensure_future(self._listen_for_cancel(proc))

            # Wait for both tasks, collecting exceptions
            done, pending = await asyncio.wait(
                [stream_task, cancel_task],
                return_when=asyncio.ALL_COMPLETED,
            )

            # Cancel any remaining tasks (safety)
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

        # Determine exit reason
        returncode = proc.returncode
        if self._cancelled:
            exit_reason = ExitReason.CANCELLED
        elif returncode == 0:
            exit_reason = ExitReason.COMPLETED
        else:
            exit_reason = ExitReason.FAILED

        self._exit_reason = exit_reason

        # Post final progress + store result
        async with httpx.AsyncClient() as http_client:
            await self._post_final_progress(http_client, exit_reason, returncode)
            await self._store_result(http_client, exit_reason, returncode)

        return exit_reason

    def get_openclaw_version(self) -> str:
        """Query the openclaw binary version.

        Returns:
            Version string from 'openclaw --version'.
        """
        result = subprocess.run(
            ["openclaw", "--version"],
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _stream_output(
        self,
        proc: subprocess.Popen[bytes],
        http_client: httpx.AsyncClient,
    ) -> None:
        """Read stdout lines from the process and POST progress chunks to Gateway."""
        buffer: list[str] = []
        buffer_ms = self.config.progress_buffer_ms
        max_chunk_bytes = self.config.progress_max_chunk_kb * 1024

        last_flush_time = asyncio.get_event_loop().time()

        async def flush_buffer() -> None:
            if not buffer:
                return
            chunk_text = "".join(buffer)
            buffer.clear()
            await self._post_progress(http_client, chunk_text, final=False)

        while True:
            if proc.poll() is not None:
                break

            line_bytes = proc.stdout.readline()  # type: ignore[union-attr]
            if not line_bytes:
                break

            line = line_bytes.decode("utf-8", errors="replace")
            buffer.append(line)

            now = asyncio.get_event_loop().time()
            elapsed_ms = (now - last_flush_time) * 1000
            buffer_size = sum(len(s.encode()) for s in buffer)

            if elapsed_ms >= buffer_ms or buffer_size >= max_chunk_bytes:
                await flush_buffer()
                last_flush_time = now

        # Flush remaining
        if buffer:
            await flush_buffer()

    async def _listen_for_cancel(
        self,
        proc: subprocess.Popen[bytes],
    ) -> None:
        """Subscribe to Redis control:{agent_id} channel and handle cancel commands.

        Continues listening until a cancel command is received, handled, or the
        Redis channel is exhausted.  Process exit state is only checked AFTER
        processing each message so queued cancel commands are never missed.
        """
        redis_url = self.config.redis_url or "redis://localhost:6379"
        redis_client = redis.asyncio.from_url(redis_url)
        channel = f"control:{self.config.agent_id}"

        try:
            pubsub = redis_client.pubsub()
            await pubsub.subscribe(channel)

            async for message in pubsub.listen():
                if message.get("type") != "message":
                    # Non-message frames (e.g. subscribe confirmations) — check
                    # process state and continue.
                    if proc.poll() is not None:
                        break
                    continue

                data_raw = message.get("data", "")
                try:
                    if isinstance(data_raw, bytes):
                        data = json.loads(data_raw.decode())
                    else:
                        data = json.loads(data_raw)
                except (json.JSONDecodeError, AttributeError):
                    if proc.poll() is not None:
                        break
                    continue

                if data.get("command") == "cancel":
                    await self._escalate_cancel(proc)
                    break

                # Non-cancel message — check if process has already exited
                if proc.poll() is not None:
                    break

        except Exception:
            pass
        finally:
            try:
                await pubsub.unsubscribe(channel)
            except Exception:
                pass

    async def _process_cancel_command(self, task_id: str) -> ExitReason:
        """Process a cancel command for the given task_id.

        If the task_id matches this harness's task, mark as cancelled
        and return ExitReason.CANCELLED.

        Args:
            task_id: The task_id from the cancel command.

        Returns:
            ExitReason.CANCELLED if the cancel applies to this task.
        """
        if task_id == self.config.task_id:
            self._cancelled = True
            self._exit_reason = ExitReason.CANCELLED
        return ExitReason.CANCELLED

    async def _should_abort_for_task(self, cancel_task_id: str, my_task_id: str) -> bool:
        """Check whether a cancel command should abort this harness.

        Args:
            cancel_task_id: The task_id from the cancel command.
            my_task_id: This harness's task_id.

        Returns:
            True if the cancel targets this task, False otherwise.
        """
        return cancel_task_id == my_task_id

    async def _escalate_cancel(
        self,
        proc: subprocess.Popen[bytes],
    ) -> None:
        """Escalating cancel: abort keystroke -> SIGTERM -> SIGKILL.

        Step 1: Write abort keystroke to PTY master fd.
        Step 2: After grace period, send SIGTERM.
        Step 3: If still running, send SIGKILL.
        """
        self._cancelled = True
        grace = self.config.abort_grace_period_s
        pid = proc.pid

        # Step 1: Send abort keystroke to PTY master
        if self._pty_master is not None:
            try:
                keystroke_bytes = self.config.abort_keystroke.encode()
                os.write(self._pty_master, keystroke_bytes)
            except OSError:
                pass

        # Wait up to grace seconds for voluntary exit
        deadline = asyncio.get_event_loop().time() + max(grace, 0)
        while asyncio.get_event_loop().time() < deadline:
            if proc.poll() is not None:
                return
            await asyncio.sleep(0.05)

        if proc.poll() is not None:
            return

        # Step 2: SIGTERM
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return

        # Wait another grace period for SIGTERM to take effect
        deadline = asyncio.get_event_loop().time() + max(grace, 1)
        while asyncio.get_event_loop().time() < deadline:
            if proc.poll() is not None:
                return
            await asyncio.sleep(0.05)

        if proc.poll() is not None:
            return

        # Step 3: SIGKILL (last resort — falls back to SIGTERM on Windows)
        try:
            os.kill(pid, _SIGKILL)
        except ProcessLookupError:
            pass

    async def _post_progress(
        self,
        http_client: httpx.AsyncClient,
        chunk: str,
        *,
        final: bool = False,
        exit_reason: str | None = None,
    ) -> None:
        """POST a progress chunk to the Gateway progress endpoint."""
        url = f"{self.config.gateway_url}/tasks/{self.config.task_id}/progress"
        payload: dict[str, Any] = {
            "task_id": self.config.task_id,
            "agent_id": self.config.agent_id,
            "chunk": chunk,
            "final": final,
        }
        if exit_reason is not None:
            payload["exit_reason"] = exit_reason

        try:
            await http_client.post(url, json=payload)
        except Exception:
            pass

    async def _post_final_progress(
        self,
        http_client: httpx.AsyncClient,
        exit_reason: ExitReason,
        returncode: int | None,
    ) -> None:
        """POST the final progress update with final=True and exit_reason."""
        await self._post_progress(
            http_client,
            chunk="",
            final=True,
            exit_reason=exit_reason.value,
        )

    async def _store_result(
        self,
        http_client: httpx.AsyncClient,
        exit_reason: ExitReason,
        returncode: int | None,
    ) -> None:
        """Store task result via Broker POST /tasks/{id}/result."""
        url = f"{self.config.broker_url}/tasks/{self.config.task_id}/result"
        payload: dict[str, Any] = {
            "task_id": self.config.task_id,
            "agent_id": self.config.agent_id,
            "result": {
                "status": exit_reason.value,
                "exit_code": returncode,
            },
        }
        try:
            await http_client.post(url, json=payload)
        except Exception:
            pass
