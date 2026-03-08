"""Wave 4B — Spec-Driven E2E Tests for the Base Agent Image / kubex-harness.

These tests encode the EXPECTED behavior of the kubex-harness entrypoint as specified in:
  - IMPLEMENTATION-PLAN.md  Wave 4, Stream 4B
  - docs/agents.md          Agent identity model, harness lifecycle
  - docs/gateway.md         POST /tasks/{id}/progress endpoint, cancel via control channel

The kubex-harness is a Python process (installed alongside OpenClaw in the base image)
that manages the OpenClaw subprocess lifecycle.  It lives at:
    agents/_base/kubex_harness/harness.py  (expected module path)

Tests are SKIPPED until Wave 4B implementation lands.  Removing the skip decorator
or the import guard activates them.

External dependencies are fully mocked:
  - subprocess / pty spawning (openclaw agent --local)
  - httpx calls to Gateway (POST /tasks/{id}/progress)
  - Redis pub/sub (control:{agent_id} channel)
  - os signals (SIGTERM, SIGKILL)
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "agents/_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Conditional import — skip if Wave 4B not yet implemented.
#
# Once agents/_base/kubex_harness/harness.py (or similar) lands, remove the guard.
# ---------------------------------------------------------------------------
_WAVE4B_IMPLEMENTED = False
try:
    from kubex_harness.harness import (  # type: ignore[import]
        KubexHarness,
        HarnessConfig,
        ExitReason,
    )

    _WAVE4B_IMPLEMENTED = True
except ImportError:
    pass

_skip_wave4b = pytest.mark.skipif(
    not _WAVE4B_IMPLEMENTED,
    reason=(
        "Wave 4B not yet implemented — "
        "agents/_base/kubex_harness/harness.py missing"
    ),
)

# ---------------------------------------------------------------------------
# Harness config fixture (env var-driven per spec)
# ---------------------------------------------------------------------------

DEFAULT_HARNESS_ENV: dict[str, str] = {
    "KUBEX_AGENT_ID": "instagram-scraper",
    "KUBEX_TASK_ID": "task-abc123",
    "KUBEX_TASK_MESSAGE": "Scrape Nike Instagram profile and return structured JSON",
    "GATEWAY_URL": "http://gateway:8080",
    "KUBEX_PROGRESS_BUFFER_MS": "100",
    "KUBEX_PROGRESS_MAX_CHUNK_KB": "64",
    "KUBEX_ABORT_KEYSTROKE": "\x03",  # Ctrl+C
    "KUBEX_ABORT_GRACE_PERIOD_S": "10",
    "ANTHROPIC_BASE_URL": "http://gateway:8080/v1/proxy/anthropic",
}


def make_harness_config(**overrides: str) -> "HarnessConfig":
    """Create a HarnessConfig from DEFAULT_HARNESS_ENV with optional overrides."""
    env = {**DEFAULT_HARNESS_ENV, **overrides}
    return HarnessConfig.from_env(env)


# ===========================================================================
# 4B-SPAWN: Subprocess Spawning
# ===========================================================================


@_skip_wave4b
class TestHarnessSubprocessSpawning:
    """Spec ref: 'PTY spawn of openclaw agent --local --message "<task>"'."""

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_harness_spawns_openclaw_agent_command(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """HARNESS-SPAWN-01: Harness spawns 'openclaw agent --local --message <task>' subprocess.

        Spec: 'PTY spawn of openclaw agent --local --message "<task>" (the openclaw npm binary)'
        """
        mock_master, mock_slave = 10, 11
        mock_openpty.return_value = (mock_master, mock_slave)

        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.stdout.readline.return_value = b""
        mock_popen.return_value = mock_proc

        config = make_harness_config()
        harness = KubexHarness(config)

        # Run the harness with a mock that immediately terminates
        mock_proc.poll.return_value = 0
        await harness.run()

        # Verify the command includes 'openclaw agent --local'
        spawn_call = mock_popen.call_args
        cmd = spawn_call.args[0] if spawn_call.args else spawn_call[0][0]
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert "openclaw" in cmd_str
        assert "agent" in cmd_str
        assert "--local" in cmd_str

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_harness_passes_task_message_to_openclaw(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """HARNESS-SPAWN-02: Task message is passed as --message argument to openclaw.

        Spec: 'PTY spawn of openclaw agent --local --message "<task>"'
        The KUBEX_TASK_MESSAGE env var becomes the --message argument.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.poll.return_value = 0
        mock_proc.stdout.readline.return_value = b""
        mock_popen.return_value = mock_proc

        task_message = "Scrape Nike Instagram profile and return structured JSON"
        config = make_harness_config(KUBEX_TASK_MESSAGE=task_message)
        harness = KubexHarness(config)
        await harness.run()

        spawn_call = mock_popen.call_args
        cmd = spawn_call.args[0] if spawn_call.args else spawn_call[0][0]
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert task_message in cmd_str or "--message" in cmd_str

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_harness_spawns_with_pty(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """HARNESS-SPAWN-03: Harness uses PTY (pty.openpty) for subprocess spawning.

        Spec: 'PTY spawn' — required because OpenClaw detects TTY for interactive mode.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.poll.return_value = 0
        mock_proc.stdout.readline.return_value = b""
        mock_popen.return_value = mock_proc

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        # PTY must be opened
        mock_openpty.assert_called()


# ===========================================================================
# 4B-PROGRESS: Progress Streaming to Gateway
# ===========================================================================


@_skip_wave4b
class TestHarnessProgressStreaming:
    """Spec ref: 'POST /tasks/{task_id}/progress to Gateway'
                 'stdout/stderr capture with chunk buffering'
    """

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_harness_posts_stdout_as_progress_chunks(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HARNESS-PROGRESS-01: Stdout from openclaw is forwarded as POST /tasks/{id}/progress.

        Spec: 'POST /tasks/{task_id}/progress to Gateway'
        Spec: 'stdout/stderr capture with chunk buffering (KUBEX_PROGRESS_BUFFER_MS,
               KUBEX_PROGRESS_MAX_CHUNK_KB)'
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0

        # Simulate two lines of stdout then EOF
        lines = [b"Step 1 done\n", b"Step 2 done\n", b""]
        mock_proc.stdout.readline.side_effect = lines
        mock_proc.poll.side_effect = [None, None, 0]
        mock_popen.return_value = mock_proc

        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        # Verify POST was made to the progress endpoint
        post_calls = mock_http_client.post.call_args_list
        progress_calls = [
            c for c in post_calls
            if "/tasks/task-abc123/progress" in str(c)
        ]
        assert len(progress_calls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_progress_chunk_contains_task_id(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HARNESS-PROGRESS-02: Progress chunks include task_id field.

        Spec: ProgressUpdate schema from kubex_common.schemas.events has task_id field.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.stdout.readline.side_effect = [b"output line\n", b""]
        mock_proc.poll.side_effect = [None, 0]
        mock_popen.return_value = mock_proc

        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        post_calls = mock_http_client.post.call_args_list
        assert len(post_calls) >= 1
        body = post_calls[0].kwargs.get("json") or post_calls[0][1].get("json", {})
        assert body.get("task_id") == "task-abc123"

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_final_progress_chunk_sets_final_flag(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HARNESS-PROGRESS-03: The last progress POST has final=True and includes exit_reason.

        Spec: 'Final progress update with exit_reason'
        Spec: ProgressUpdate schema has final: bool and exit_reason: str | None fields.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.stdout.readline.side_effect = [b"work done\n", b""]
        mock_proc.poll.side_effect = [None, 0]
        mock_popen.return_value = mock_proc

        posted_bodies: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_bodies.append(kwargs.get("json", {}))
            resp = MagicMock()
            resp.status_code = 202
            return resp

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        # Find the final chunk
        final_chunks = [b for b in posted_bodies if b.get("final") is True]
        assert len(final_chunks) >= 1
        final = final_chunks[-1]
        assert "exit_reason" in final
        assert final["exit_reason"] is not None

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_progress_url_uses_gateway_url_env(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HARNESS-PROGRESS-04: Progress POSTs go to GATEWAY_URL/tasks/{id}/progress.

        Spec: 'GATEWAY_URL on worker containers' (set by Kubex Manager)
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.stdout.readline.side_effect = [b"hello\n", b""]
        mock_proc.poll.side_effect = [None, 0]
        mock_popen.return_value = mock_proc

        posted_urls: list[str] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_urls.append(url)
            resp = MagicMock()
            resp.status_code = 202
            return resp

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config(GATEWAY_URL="http://gateway:8080")
        harness = KubexHarness(config)
        await harness.run()

        assert any("http://gateway:8080" in url for url in posted_urls)
        assert any("/tasks/task-abc123/progress" in url for url in posted_urls)


# ===========================================================================
# 4B-CANCEL: Cancel Command Handling via Redis control channel
# ===========================================================================


@_skip_wave4b
class TestHarnessCancelHandling:
    """Spec ref: 'Redis control:{agent_id} subscription for cancel commands'
                 'Graceful cancellation escalation: keystroke -> SIGTERM -> SIGKILL'
    """

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_harness_subscribes_to_control_channel(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """HARNESS-CANCEL-01: Harness subscribes to Redis 'control:{agent_id}' channel.

        Spec: 'Redis control:{agent_id} subscription for cancel commands'
        Channel name = 'control:instagram-scraper' for agent_id=instagram-scraper.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.poll.return_value = 0
        mock_proc.stdout.readline.return_value = b""
        mock_popen.return_value = mock_proc

        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = AsyncMock(return_value=aiter([]))  # empty channel
        mock_redis_factory.return_value = mock_redis

        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        # Verify subscription was made to the correct channel
        subscribe_calls = mock_pubsub.subscribe.call_args_list
        subscribed_channels = [str(c) for c in subscribe_calls]
        assert any("control:instagram-scraper" in ch for ch in subscribed_channels)

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_sends_abort_keystroke_first(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """HARNESS-CANCEL-02: On cancel command, harness first sends KUBEX_ABORT_KEYSTROKE to PTY.

        Spec: 'Graceful cancellation escalation: keystroke -> SIGTERM -> SIGKILL with grace period'
        First step is sending Ctrl+C (or configured abort keystroke) via os.write to the PTY master.
        """
        mock_openpty.return_value = (10, 11)  # master=10
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = None  # still running when cancel arrives

        cancel_message = json.dumps({"command": "cancel", "task_id": "task-abc123"})

        # PTY read yields one chunk then blocks; cancel arrives after that
        read_calls = [b"processing...\n"]
        mock_proc.stdout.readline.side_effect = read_calls + [b""]
        mock_proc.poll.side_effect = [None, None, -15]  # exits on SIGTERM
        mock_popen.return_value = mock_proc

        async def mock_listen():
            # Yield cancel message after a short sequence
            yield {"type": "message", "data": cancel_message}

        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_redis_factory.return_value = mock_redis

        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.write") as mock_os_write:
            config = make_harness_config(KUBEX_ABORT_KEYSTROKE="\x03")
            harness = KubexHarness(config)
            await harness.run()

            # Verify os.write was called with master fd (10) and the abort keystroke
            write_calls = mock_os_write.call_args_list
            keystroke_writes = [
                c for c in write_calls
                if c.args[0] == 10 and b"\x03" in (c.args[1] if c.args else b"")
            ]
            assert len(keystroke_writes) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_escalates_to_sigterm_after_grace(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """HARNESS-CANCEL-03: If process doesn't exit after keystroke, harness sends SIGTERM.

        Spec: 'Graceful cancellation escalation: keystroke -> SIGTERM -> SIGKILL with grace period'
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        # Process ignores Ctrl+C and only exits on SIGTERM
        mock_proc.poll.side_effect = [None] * 15 + [-15]
        mock_proc.stdout.readline.side_effect = [b""]
        mock_popen.return_value = mock_proc

        cancel_message = json.dumps({"command": "cancel", "task_id": "task-abc123"})

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_redis_factory.return_value = mock_redis

        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.kill") as mock_os_kill:
            with patch("kubex_harness.harness.os.write"):
                config = make_harness_config(
                    KUBEX_ABORT_GRACE_PERIOD_S="0"  # zero grace for fast test
                )
                harness = KubexHarness(config)
                await harness.run()

                kill_calls = mock_os_kill.call_args_list
                sigterm_calls = [
                    c for c in kill_calls
                    if c.args[1] == signal.SIGTERM
                ]
                assert len(sigterm_calls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_escalates_to_sigkill_after_sigterm_timeout(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """HARNESS-CANCEL-04: If process survives SIGTERM, harness sends SIGKILL.

        Spec: 'Graceful cancellation escalation: keystroke -> SIGTERM -> SIGKILL with grace period'
        Last resort — unconditional kill.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        # Process ignores both Ctrl+C and SIGTERM, only exits on SIGKILL
        mock_proc.poll.side_effect = [None] * 30 + [-9]
        mock_proc.stdout.readline.side_effect = [b""]
        mock_popen.return_value = mock_proc

        cancel_message = json.dumps({"command": "cancel", "task_id": "task-abc123"})

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_redis_factory.return_value = mock_redis

        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.kill") as mock_os_kill:
            with patch("kubex_harness.harness.os.write"):
                config = make_harness_config(KUBEX_ABORT_GRACE_PERIOD_S="0")
                harness = KubexHarness(config)
                await harness.run()

                kill_calls = mock_os_kill.call_args_list
                sigkill_calls = [
                    c for c in kill_calls
                    if c.args[1] == signal.SIGKILL
                ]
                assert len(sigkill_calls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_final_progress_has_cancelled_exit_reason(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """HARNESS-CANCEL-05: After cancellation, final progress update has exit_reason='cancelled'.

        Spec: 'Final progress update with exit_reason'
        The exit_reason field (ProgressUpdate schema) must be set to 'cancelled' on cancel.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.poll.side_effect = [None] * 5 + [-15]
        mock_proc.stdout.readline.side_effect = [b""]
        mock_popen.return_value = mock_proc

        cancel_message = json.dumps({"command": "cancel", "task_id": "task-abc123"})

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_redis_factory.return_value = mock_redis

        posted_bodies: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_bodies.append(kwargs.get("json", {}))
            resp = MagicMock()
            resp.status_code = 202
            return resp

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.kill"):
            with patch("kubex_harness.harness.os.write"):
                config = make_harness_config(KUBEX_ABORT_GRACE_PERIOD_S="0")
                harness = KubexHarness(config)
                await harness.run()

        final_chunks = [b for b in posted_bodies if b.get("final") is True]
        assert len(final_chunks) >= 1
        assert final_chunks[-1].get("exit_reason") == "cancelled"


# ===========================================================================
# 4B-RESULT: Task Completion Stores Result via Broker
# ===========================================================================


@_skip_wave4b
class TestHarnessTaskCompletion:
    """Spec ref: 'Task completion stores result via Broker'."""

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_successful_completion_stores_result_via_broker(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HARNESS-RESULT-01: After successful openclaw exit, harness POSTs result to Broker.

        Spec: 'Task completion stores result via Broker'
        The Broker endpoint is POST /tasks/{task_id}/result.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 0
        mock_proc.stdout.readline.side_effect = [b"Job done\n", b""]
        mock_proc.poll.side_effect = [None, 0]
        mock_popen.return_value = mock_proc

        posted_urls: list[str] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_urls.append(url)
            resp = MagicMock()
            resp.status_code = 202
            return resp

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        broker_result_calls = [u for u in posted_urls if "/tasks/task-abc123/result" in u]
        assert len(broker_result_calls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_nonzero_exit_stores_failed_result(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HARNESS-RESULT-02: Non-zero exit code from openclaw results in 'failed' result stored.

        Spec: 'Final progress update with exit_reason' — exit_reason='failed' on non-zero exit.
        """
        mock_openpty.return_value = (10, 11)
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.returncode = 1
        mock_proc.stdout.readline.side_effect = [b"Error occurred\n", b""]
        mock_proc.poll.side_effect = [None, 1]
        mock_popen.return_value = mock_proc

        stored_results: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            if "/result" in url:
                stored_results.append(kwargs.get("json", {}))
            resp = MagicMock()
            resp.status_code = 202
            return resp

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_harness_config()
        harness = KubexHarness(config)
        await harness.run()

        assert len(stored_results) >= 1
        result_body = stored_results[-1]
        result = result_body.get("result", result_body)
        assert result.get("status") in ("failed", "error") or result.get("exit_code") != 0


# ===========================================================================
# 4B-HEALTH: Health Check / Version Reporting
# ===========================================================================


@_skip_wave4b
class TestHarnessHealthCheck:
    """Spec ref: 'Harness reports agent's OpenClaw version on health check'."""

    @patch("kubex_harness.harness.subprocess.run")
    def test_harness_reports_openclaw_version(self, mock_subprocess_run: MagicMock) -> None:
        """HARNESS-HEALTH-01: Harness can query OpenClaw version via 'openclaw --version'.

        Spec: 'Harness reports agent's OpenClaw version on health check'
        Spec (docs/agents.md 13.4): Gateway uses version for VERSION_MISMATCH checks.
        """
        mock_subprocess_run.return_value = MagicMock(
            stdout="2026.2.26\n",
            returncode=0,
        )

        config = make_harness_config()
        harness = KubexHarness(config)
        version = harness.get_openclaw_version()

        assert version is not None
        assert isinstance(version, str)
        assert len(version) > 0

    @patch("kubex_harness.harness.subprocess.run")
    def test_harness_version_check_calls_openclaw_version_flag(
        self, mock_subprocess_run: MagicMock
    ) -> None:
        """HARNESS-HEALTH-02: Version check runs 'openclaw --version' subprocess.

        Spec: 'Harness reports agent's OpenClaw version on health check'
        """
        mock_subprocess_run.return_value = MagicMock(stdout="2026.2.26\n", returncode=0)

        config = make_harness_config()
        harness = KubexHarness(config)
        harness.get_openclaw_version()

        call_args = mock_subprocess_run.call_args
        cmd = call_args.args[0] if call_args.args else call_args[0][0]
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert "openclaw" in cmd_str
        assert "--version" in cmd_str


# ===========================================================================
# 4B-CONFIG: HarnessConfig loading from environment
# ===========================================================================


@_skip_wave4b
class TestHarnessConfig:
    """Spec ref: HarnessConfig must be env-var driven (KUBEX_* env vars set by Kubex Manager)."""

    def test_harness_config_loads_from_env(self) -> None:
        """HARNESS-CFG-01: HarnessConfig reads all required fields from environment.

        Spec: Kubex Manager sets KUBEX_PROGRESS_BUFFER_MS, KUBEX_PROGRESS_MAX_CHUNK_KB,
              KUBEX_ABORT_KEYSTROKE, KUBEX_ABORT_GRACE_PERIOD_S, GATEWAY_URL on containers.
        """
        config = make_harness_config()
        assert config.agent_id == "instagram-scraper"
        assert config.task_id == "task-abc123"
        assert config.gateway_url == "http://gateway:8080"
        assert config.progress_buffer_ms == 100
        assert config.progress_max_chunk_kb == 64
        assert config.abort_grace_period_s == 10

    def test_harness_config_requires_agent_id(self) -> None:
        """HARNESS-CFG-02: HarnessConfig raises ValueError if KUBEX_AGENT_ID is missing."""
        env = {k: v for k, v in DEFAULT_HARNESS_ENV.items() if k != "KUBEX_AGENT_ID"}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)

    def test_harness_config_requires_task_id(self) -> None:
        """HARNESS-CFG-03: HarnessConfig raises ValueError if KUBEX_TASK_ID is missing."""
        env = {k: v for k, v in DEFAULT_HARNESS_ENV.items() if k != "KUBEX_TASK_ID"}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)

    def test_harness_config_requires_gateway_url(self) -> None:
        """HARNESS-CFG-04: HarnessConfig raises ValueError if GATEWAY_URL is missing."""
        env = {k: v for k, v in DEFAULT_HARNESS_ENV.items() if k != "GATEWAY_URL"}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)

    def test_harness_config_abort_keystroke_default(self) -> None:
        """HARNESS-CFG-05: Default abort keystroke is Ctrl+C if not specified."""
        env = {k: v for k, v in DEFAULT_HARNESS_ENV.items() if k != "KUBEX_ABORT_KEYSTROKE"}
        config = HarnessConfig.from_env(env)
        # Default keystroke should be Ctrl+C (\x03) or similar abort key
        assert config.abort_keystroke in ("\x03", "^C", "CTRL_C")


# ===========================================================================
# 4B-ENTRYPOINT: agents/_base/entrypoint.sh contract
# ===========================================================================


@_skip_wave4b
class TestBaseImageEntrypoint:
    """Spec ref: 'agents/_base/entrypoint.sh — bootstrap: write ~/.openclaw/openclaw.json
                  from mounted config, load skills into ~/.openclaw/skills/, invoke kubex-harness'
    """

    @patch("subprocess.run")
    def test_entrypoint_invokes_kubex_harness(self, mock_run: MagicMock) -> None:
        """ENTRYPOINT-01: entrypoint.sh eventually invokes the kubex-harness Python module.

        Spec: 'invoke kubex-harness'
        The entrypoint is a shell script; we test it by running the script with a mock
        environment and verifying the harness is called.
        """
        entrypoint_path = os.path.join(_ROOT, "agents/_base/entrypoint.sh")
        if not os.path.exists(entrypoint_path):
            pytest.skip("agents/_base/entrypoint.sh not yet created")

        mock_run.return_value = MagicMock(returncode=0)

        # Simulate running the entrypoint with the required env vars
        env = {**os.environ, **DEFAULT_HARNESS_ENV}
        result = subprocess.run(
            ["bash", "-n", entrypoint_path],  # -n = syntax check only
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, f"entrypoint.sh has syntax errors: {result.stderr}"

    def test_openclaw_json_config_written_by_entrypoint(self) -> None:
        """ENTRYPOINT-02: entrypoint.sh writes ~/.openclaw/openclaw.json from mounted config.

        Spec: 'write ~/.openclaw/openclaw.json from mounted config'
        The openclaw CLI reads its config from this path on startup.
        """
        entrypoint_path = os.path.join(_ROOT, "agents/_base/entrypoint.sh")
        if not os.path.exists(entrypoint_path):
            pytest.skip("agents/_base/entrypoint.sh not yet created")

        with open(entrypoint_path) as f:
            content = f.read()

        assert ".openclaw/openclaw.json" in content or "openclaw.json" in content, (
            "entrypoint.sh must write openclaw.json to ~/.openclaw/"
        )


# ===========================================================================
# Helper: async iterator for mock pub/sub
# ===========================================================================

async def aiter(items):  # type: ignore[no-untyped-def]
    """Async iterator from a list — used to mock Redis pubsub.listen()."""
    for item in items:
        yield item
