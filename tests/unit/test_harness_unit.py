"""Unit tests for the kubex-harness (Wave 4B).

Tests mock subprocess, pty, httpx, Redis, and os signals.
Coverage target: >=90% on agents/_base/kubex_harness/harness.py
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
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

from kubex_harness.harness import (
    KubexHarness,
    HarnessConfig,
    ExitReason,
    _SIGKILL,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_ENV: dict[str, str] = {
    "KUBEX_AGENT_ID": "test-agent",
    "KUBEX_TASK_ID": "task-001",
    "KUBEX_TASK_MESSAGE": "Do some work",
    "GATEWAY_URL": "http://gateway:8080",
    "KUBEX_PROGRESS_BUFFER_MS": "50",
    "KUBEX_PROGRESS_MAX_CHUNK_KB": "8",
    "KUBEX_ABORT_KEYSTROKE": "\x03",
    "KUBEX_ABORT_GRACE_PERIOD_S": "0",
}


def make_config(**overrides: str) -> HarnessConfig:
    return HarnessConfig.from_env({**BASE_ENV, **overrides})


def make_mock_proc(
    *,
    pid: int = 99,
    returncode: int | None = 0,
    readline_outputs: list[bytes] | None = None,
    poll_side_effect: list[int | None] | None = None,
) -> MagicMock:
    mock_proc = MagicMock()
    mock_proc.pid = pid
    mock_proc.returncode = returncode
    if readline_outputs is not None:
        mock_proc.stdout.readline.side_effect = readline_outputs
    else:
        mock_proc.stdout.readline.return_value = b""
    if poll_side_effect is not None:
        mock_proc.poll.side_effect = poll_side_effect
    else:
        mock_proc.poll.return_value = returncode
    return mock_proc


async def aiter(items: list) -> Any:  # type: ignore[return]
    for item in items:
        yield item


# ===========================================================================
# HarnessConfig
# ===========================================================================


class TestHarnessConfig:
    """Tests for HarnessConfig.from_env."""

    def test_load_all_fields(self) -> None:
        config = make_config()
        assert config.agent_id == "test-agent"
        assert config.task_id == "task-001"
        assert config.task_message == "Do some work"
        assert config.gateway_url == "http://gateway:8080"
        assert config.progress_buffer_ms == 50
        assert config.progress_max_chunk_kb == 8
        assert config.abort_keystroke == "\x03"
        assert config.abort_grace_period_s == 0

    def test_default_env_on_none(self) -> None:
        """from_env(None) reads os.environ — just test it doesn't crash."""
        with patch.dict(os.environ, BASE_ENV, clear=False):
            config = HarnessConfig.from_env(None)
            assert config.agent_id == "test-agent"

    def test_raises_without_agent_id(self) -> None:
        env = {k: v for k, v in BASE_ENV.items() if k != "KUBEX_AGENT_ID"}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)

    def test_raises_without_task_id(self) -> None:
        env = {k: v for k, v in BASE_ENV.items() if k != "KUBEX_TASK_ID"}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)

    def test_raises_without_gateway_url(self) -> None:
        env = {k: v for k, v in BASE_ENV.items() if k != "GATEWAY_URL"}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)

    def test_default_abort_keystroke_is_ctrl_c(self) -> None:
        env = {k: v for k, v in BASE_ENV.items() if k != "KUBEX_ABORT_KEYSTROKE"}
        config = HarnessConfig.from_env(env)
        assert config.abort_keystroke in ("\x03", "^C", "CTRL_C")

    def test_broker_url_defaults_to_gateway_url(self) -> None:
        env = {k: v for k, v in BASE_ENV.items() if k != "BROKER_URL"}
        config = HarnessConfig.from_env(env)
        assert config.broker_url == config.gateway_url

    def test_explicit_broker_url(self) -> None:
        config = make_config(BROKER_URL="http://broker:8060")
        assert config.broker_url == "http://broker:8060"

    def test_empty_agent_id_raises(self) -> None:
        env = {**BASE_ENV, "KUBEX_AGENT_ID": ""}
        with pytest.raises((ValueError, KeyError)):
            HarnessConfig.from_env(env)


# ===========================================================================
# ExitReason
# ===========================================================================


class TestExitReason:
    def test_values(self) -> None:
        assert ExitReason.COMPLETED.value == "completed"
        assert ExitReason.CANCELLED.value == "cancelled"
        assert ExitReason.FAILED.value == "failed"


# ===========================================================================
# KubexHarness — subprocess spawning
# ===========================================================================


class TestKubexHarnessSpawning:
    """Tests for how KubexHarness spawns the openclaw subprocess."""

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_spawns_openclaw_agent_local(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """Harness spawns 'openclaw agent --local --message ...' command."""
        mock_openpty.return_value = (10, 11)
        mock_proc = make_mock_proc()
        mock_popen.return_value = mock_proc

        config = make_config()
        harness = KubexHarness(config)

        async with _no_httpx_calls():
            await harness.run()

        spawn_call = mock_popen.call_args
        cmd = spawn_call.args[0] if spawn_call.args else spawn_call[0][0]
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert "openclaw" in cmd_str
        assert "agent" in cmd_str
        assert "--local" in cmd_str

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_passes_task_message_as_argument(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """Task message is passed as --message argument."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc()

        config = make_config(KUBEX_TASK_MESSAGE="build me something")
        harness = KubexHarness(config)

        async with _no_httpx_calls():
            await harness.run()

        spawn_call = mock_popen.call_args
        cmd = spawn_call.args[0] if spawn_call.args else spawn_call[0][0]
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert "--message" in cmd_str

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_opens_pty(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """Harness calls pty.openpty() to create a PTY pair."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc()

        config = make_config()
        harness = KubexHarness(config)

        async with _no_httpx_calls():
            await harness.run()

        mock_openpty.assert_called()

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_run_returns_completed_on_zero_exit(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """run() returns ExitReason.COMPLETED when process exits with code 0."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc(returncode=0)

        config = make_config()
        harness = KubexHarness(config)

        async with _no_httpx_calls():
            result = await harness.run()

        assert result == ExitReason.COMPLETED

    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_run_returns_failed_on_nonzero_exit(
        self, mock_popen: MagicMock, mock_openpty: MagicMock
    ) -> None:
        """run() returns ExitReason.FAILED when process exits with non-zero code."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc(returncode=1)

        config = make_config()
        harness = KubexHarness(config)

        async with _no_httpx_calls():
            result = await harness.run()

        assert result == ExitReason.FAILED


# ===========================================================================
# KubexHarness — progress streaming
# ===========================================================================


class TestKubexHarnessProgressStreaming:
    """Tests for stdout capture and progress POSTing."""

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_posts_stdout_to_progress_endpoint(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """Stdout lines are forwarded via POST to Gateway progress endpoint."""
        mock_openpty.return_value = (10, 11)
        mock_proc = make_mock_proc(
            readline_outputs=[b"line one\n", b""],
            poll_side_effect=[None, 0],
        )
        mock_popen.return_value = mock_proc

        posted_urls: list[str] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_urls.append(url)
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        await harness.run()

        progress_urls = [u for u in posted_urls if "/tasks/task-001/progress" in u]
        assert len(progress_urls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_progress_payload_contains_task_id(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """Progress POST payload includes task_id."""
        mock_openpty.return_value = (10, 11)
        mock_proc = make_mock_proc(
            readline_outputs=[b"output\n", b""],
            poll_side_effect=[None, 0],
        )
        mock_popen.return_value = mock_proc

        posted_bodies: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_bodies.append(kwargs.get("json", {}))
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        await harness.run()

        assert len(posted_bodies) >= 1
        assert posted_bodies[0].get("task_id") == "task-001"

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_final_chunk_has_final_true_and_exit_reason(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """The last POST has final=True and a non-None exit_reason."""
        mock_openpty.return_value = (10, 11)
        mock_proc = make_mock_proc(
            readline_outputs=[b"done\n", b""],
            poll_side_effect=[None, 0],
        )
        mock_popen.return_value = mock_proc

        posted_bodies: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_bodies.append(kwargs.get("json", {}))
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        await harness.run()

        final_chunks = [b for b in posted_bodies if b.get("final") is True]
        assert len(final_chunks) >= 1
        assert final_chunks[-1]["exit_reason"] is not None

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_progress_uses_gateway_url(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """Progress URL uses GATEWAY_URL env var."""
        mock_openpty.return_value = (10, 11)
        mock_proc = make_mock_proc(
            readline_outputs=[b"output\n", b""],
            poll_side_effect=[None, 0],
        )
        mock_popen.return_value = mock_proc

        posted_urls: list[str] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_urls.append(url)
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config(GATEWAY_URL="http://custom-gateway:9999")
        harness = KubexHarness(config)
        await harness.run()

        assert any("http://custom-gateway:9999" in u for u in posted_urls)

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_progress_http_error_does_not_crash_harness(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """HTTP errors posting progress are swallowed — harness continues."""
        mock_openpty.return_value = (10, 11)
        mock_proc = make_mock_proc(
            readline_outputs=[b"work\n", b""],
            poll_side_effect=[None, 0],
        )
        mock_popen.return_value = mock_proc

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        # Should not raise
        result = await harness.run()
        assert result == ExitReason.COMPLETED


# ===========================================================================
# KubexHarness — task result storage
# ===========================================================================


class TestKubexHarnessResultStorage:
    """Tests for task result storage via Broker."""

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_stores_result_on_success(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """Successful completion stores result via POST /tasks/{id}/result."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc(
            readline_outputs=[b"done\n", b""],
            poll_side_effect=[None, 0],
        )

        posted_urls: list[str] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_urls.append(url)
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        await harness.run()

        result_urls = [u for u in posted_urls if "/tasks/task-001/result" in u]
        assert len(result_urls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_result_payload_contains_exit_code(
        self, mock_popen: MagicMock, mock_openpty: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """Result payload includes status and exit_code fields."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc(
            returncode=1,
            readline_outputs=[b"error\n", b""],
            poll_side_effect=[None, 1],
        )

        stored_results: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            if "/result" in url:
                stored_results.append(kwargs.get("json", {}))
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        await harness.run()

        assert len(stored_results) >= 1
        payload = stored_results[-1]
        result = payload.get("result", payload)
        assert result.get("exit_code") == 1 or result.get("status") == "failed"


# ===========================================================================
# KubexHarness — cancel escalation
# ===========================================================================


class TestKubexHarnessCancelEscalation:
    """Tests for cancel escalation logic."""

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_subscribe_to_correct_channel(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """Harness subscribes to 'control:{agent_id}' channel."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc()

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=aiter([]))
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis_factory.return_value = mock_redis

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=MagicMock(status_code=202))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        config = make_config()
        harness = KubexHarness(config)
        await harness.run()

        subscribe_calls = mock_pubsub.subscribe.call_args_list
        assert any("control:test-agent" in str(c) for c in subscribe_calls)

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_sends_keystroke_to_pty(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """On cancel, harness writes abort keystroke to the PTY master fd."""
        mock_openpty.return_value = (10, 11)
        cancel_message = json.dumps({"command": "cancel", "task_id": "task-001"})

        mock_popen.return_value = make_mock_proc(
            returncode=None,
            readline_outputs=[b""],
            poll_side_effect=[None] * 5 + [-15],
        )

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis_factory.return_value = mock_redis

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=MagicMock(status_code=202))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.write") as mock_os_write:
            config = make_config()
            harness = KubexHarness(config)
            await harness.run()

        keystroke_writes = [
            c for c in mock_os_write.call_args_list
            if c.args[0] == 10 and b"\x03" in (c.args[1] if c.args else b"")
        ]
        assert len(keystroke_writes) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_escalates_to_sigterm(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """If process doesn't exit after keystroke, SIGTERM is sent."""
        mock_openpty.return_value = (10, 11)
        cancel_message = json.dumps({"command": "cancel", "task_id": "task-001"})

        mock_popen.return_value = make_mock_proc(
            returncode=None,
            readline_outputs=[b""],
            poll_side_effect=[None] * 15 + [-15],
        )

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis_factory.return_value = mock_redis

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=MagicMock(status_code=202))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.kill") as mock_os_kill:
            with patch("kubex_harness.harness.os.write"):
                config = make_config()
                harness = KubexHarness(config)
                await harness.run()

        sigterm_calls = [c for c in mock_os_kill.call_args_list if c.args[1] == signal.SIGTERM]
        assert len(sigterm_calls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_escalates_to_sigkill(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """If process ignores SIGTERM, SIGKILL is sent as last resort."""
        mock_openpty.return_value = (10, 11)
        cancel_message = json.dumps({"command": "cancel", "task_id": "task-001"})

        mock_popen.return_value = make_mock_proc(
            returncode=None,
            readline_outputs=[b""],
            poll_side_effect=[None] * 30 + [-9],
        )

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis_factory.return_value = mock_redis

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=MagicMock(status_code=202))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.kill") as mock_os_kill:
            with patch("kubex_harness.harness.os.write"):
                config = make_config()
                harness = KubexHarness(config)
                await harness.run()

        sigkill_calls = [c for c in mock_os_kill.call_args_list if c.args[1] == _SIGKILL]
        assert len(sigkill_calls) >= 1

    @patch("kubex_harness.harness.httpx.AsyncClient")
    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_cancel_exit_reason_is_cancelled(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
        mock_httpx: MagicMock,
    ) -> None:
        """After cancellation, exit_reason in final progress is 'cancelled'."""
        mock_openpty.return_value = (10, 11)
        cancel_message = json.dumps({"command": "cancel", "task_id": "task-001"})

        mock_popen.return_value = make_mock_proc(
            returncode=None,
            readline_outputs=[b""],
            poll_side_effect=[None] * 5 + [-15],
        )

        async def mock_listen():
            yield {"type": "message", "data": cancel_message}

        mock_redis = MagicMock()
        mock_pubsub = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.listen = MagicMock(return_value=mock_listen())
        mock_pubsub.unsubscribe = AsyncMock()
        mock_redis_factory.return_value = mock_redis

        posted_bodies: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            posted_bodies.append(kwargs.get("json", {}))
            return MagicMock(status_code=202)

        mock_http_client = AsyncMock()
        mock_http_client.post = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        with patch("kubex_harness.harness.os.kill"):
            with patch("kubex_harness.harness.os.write"):
                config = make_config()
                harness = KubexHarness(config)
                result = await harness.run()

        assert result == ExitReason.CANCELLED
        final_chunks = [b for b in posted_bodies if b.get("final") is True]
        assert final_chunks[-1]["exit_reason"] == "cancelled"

    @patch("kubex_harness.harness.redis.asyncio.from_url")
    @patch("kubex_harness.harness.pty.openpty")
    @patch("kubex_harness.harness.subprocess.Popen")
    @pytest.mark.asyncio
    async def test_redis_error_does_not_crash_harness(
        self,
        mock_popen: MagicMock,
        mock_openpty: MagicMock,
        mock_redis_factory: MagicMock,
    ) -> None:
        """Redis connection failure in cancel listener is silently ignored."""
        mock_openpty.return_value = (10, 11)
        mock_popen.return_value = make_mock_proc()
        mock_redis_factory.side_effect = Exception("Redis not available")

        config = make_config()
        harness = KubexHarness(config)

        async with _no_httpx_calls():
            result = await harness.run()

        assert result == ExitReason.COMPLETED


# ===========================================================================
# KubexHarness — get_openclaw_version
# ===========================================================================


class TestKubexHarnessVersion:
    """Tests for get_openclaw_version()."""

    @patch("kubex_harness.harness.subprocess.run")
    def test_returns_version_string(self, mock_run: MagicMock) -> None:
        """get_openclaw_version returns the version string from openclaw --version."""
        mock_run.return_value = MagicMock(stdout="2026.2.26\n", returncode=0)
        config = make_config()
        harness = KubexHarness(config)
        version = harness.get_openclaw_version()
        assert version == "2026.2.26"

    @patch("kubex_harness.harness.subprocess.run")
    def test_calls_openclaw_version_flag(self, mock_run: MagicMock) -> None:
        """get_openclaw_version invokes 'openclaw --version'."""
        mock_run.return_value = MagicMock(stdout="1.0.0\n", returncode=0)
        config = make_config()
        harness = KubexHarness(config)
        harness.get_openclaw_version()

        call_args = mock_run.call_args
        cmd = call_args.args[0] if call_args.args else call_args[0][0]
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert "openclaw" in cmd_str
        assert "--version" in cmd_str

    @patch("kubex_harness.harness.subprocess.run")
    def test_strips_whitespace_from_version(self, mock_run: MagicMock) -> None:
        """get_openclaw_version strips leading/trailing whitespace."""
        mock_run.return_value = MagicMock(stdout="  2026.3.1  \n", returncode=0)
        config = make_config()
        harness = KubexHarness(config)
        version = harness.get_openclaw_version()
        assert version == "2026.3.1"


# ===========================================================================
# Helpers
# ===========================================================================


class _no_httpx_calls:
    """Async context manager that patches httpx.AsyncClient to do nothing."""

    async def __aenter__(self) -> "_no_httpx_calls":
        self._patcher = patch("kubex_harness.harness.httpx.AsyncClient")
        self._mock = self._patcher.start()
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=MagicMock(status_code=202))
        self._mock.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        self._mock.return_value.__aexit__ = AsyncMock(return_value=None)
        return self

    async def __aexit__(self, *args: Any) -> None:
        self._patcher.stop()


# ===========================================================================
# Standalone — Skill Injection
# ===========================================================================

from kubex_harness.standalone import _load_skill_files, StandaloneConfig


class TestSkillInjection:
    """Tests for skill file loading and system prompt injection."""

    def test_load_skill_files_nonexistent_dir(self, tmp_path: Any) -> None:
        """Returns empty string when skills directory doesn't exist."""
        result = _load_skill_files(str(tmp_path / "does-not-exist"))
        assert result == ""

    def test_load_skill_files_empty_dir(self, tmp_path: Any) -> None:
        """Returns empty string when directory exists but has no .md files."""
        result = _load_skill_files(str(tmp_path))
        assert result == ""

    def test_load_skill_files_single_md(self, tmp_path: Any) -> None:
        """Loads a single .md file and includes it in output."""
        skill_file = tmp_path / "SKILL.md"
        skill_file.write_text("# My Skill\nDo stuff.", encoding="utf-8")
        result = _load_skill_files(str(tmp_path))
        assert "## Loaded Skills" in result
        assert "# My Skill" in result
        assert "Do stuff." in result

    def test_load_skill_files_nested_dirs(self, tmp_path: Any) -> None:
        """Loads .md files from nested subdirectories."""
        sub = tmp_path / "category" / "subcategory"
        sub.mkdir(parents=True)
        (sub / "SKILL.md").write_text("nested skill content", encoding="utf-8")
        result = _load_skill_files(str(tmp_path))
        assert "nested skill content" in result
        assert "category" in result  # relative path shown in header

    def test_load_skill_files_ignores_non_md(self, tmp_path: Any) -> None:
        """Only loads .md files, ignores .py, .txt, etc."""
        (tmp_path / "SKILL.md").write_text("good", encoding="utf-8")
        (tmp_path / "script.py").write_text("bad", encoding="utf-8")
        (tmp_path / "notes.txt").write_text("bad", encoding="utf-8")
        result = _load_skill_files(str(tmp_path))
        assert "good" in result
        assert "bad" not in result

    def test_load_skill_files_multiple_sorted(self, tmp_path: Any) -> None:
        """Multiple .md files are loaded in sorted order."""
        (tmp_path / "b.md").write_text("second", encoding="utf-8")
        (tmp_path / "a.md").write_text("first", encoding="utf-8")
        result = _load_skill_files(str(tmp_path))
        a_pos = result.index("first")
        b_pos = result.index("second")
        assert a_pos < b_pos

    def test_config_injects_skills_into_prompt(self, tmp_path: Any) -> None:
        """StandaloneConfig appends skill content to the system prompt."""
        skill_file = tmp_path / "SKILL.md"
        skill_file.write_text("# Scraping Instructions\nScrape carefully.", encoding="utf-8")
        env = {
            "KUBEX_AGENT_ID": "test-agent",
            "GATEWAY_URL": "http://gateway:8080",
            "KUBEX_SKILLS_DIR": str(tmp_path),
        }
        with patch.dict(os.environ, env, clear=False):
            config = StandaloneConfig()
        assert "KubexClaw worker agent" in config.system_prompt
        assert "# Scraping Instructions" in config.system_prompt
        assert "Scrape carefully." in config.system_prompt

    def test_config_no_skills_dir_uses_base_prompt(self) -> None:
        """When skills dir doesn't exist, system prompt is just the base prompt."""
        env = {
            "KUBEX_AGENT_ID": "test-agent",
            "GATEWAY_URL": "http://gateway:8080",
            "KUBEX_SKILLS_DIR": "/nonexistent/skills/path",
        }
        with patch.dict(os.environ, env, clear=False):
            config = StandaloneConfig()
        assert config.system_prompt == (
            "You are a KubexClaw worker agent. Complete the task described in the user message. "
            "Be concise and return structured results when possible."
        )

    def test_config_custom_prompt_plus_skills(self, tmp_path: Any) -> None:
        """Custom KUBEX_AGENT_PROMPT is used as base, skills appended after."""
        (tmp_path / "recall.md").write_text("recall instructions", encoding="utf-8")
        env = {
            "KUBEX_AGENT_ID": "knowledge",
            "GATEWAY_URL": "http://gateway:8080",
            "KUBEX_AGENT_PROMPT": "You are the knowledge agent.",
            "KUBEX_SKILLS_DIR": str(tmp_path),
        }
        with patch.dict(os.environ, env, clear=False):
            config = StandaloneConfig()
        assert config.system_prompt.startswith("You are the knowledge agent.")
        assert "recall instructions" in config.system_prompt
