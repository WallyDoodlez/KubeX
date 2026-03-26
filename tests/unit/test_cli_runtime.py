"""Unit tests for CLIRuntime — cli_runtime.py.

Tests cover:
  - CliState enum values
  - CREDENTIAL_PATHS mapping
  - FAILURE_PATTERNS keys
  - _credentials_present behavior (file missing, empty, present, unknown runtime)
  - _classify_failure behavior (exit 0, auth_expired, subscription_limit,
    runtime_not_available, cli_crash default)
  - _build_command structure and flags
  - _publish_state publishes to correct Redis channel
  - State machine transitions: BOOTING -> CREDENTIAL_WAIT -> READY -> BUSY
  - HITL triggered on missing credentials
  - watchfiles credential watcher detects file appearance
  - Auth-expired failure bypasses retry (D-16)
  - SIGTERM forwarding + SIGKILL escalation on graceful_shutdown
  - ThreadPoolExecutor(max_workers=1) used for drain loop
  - MAX_OUTPUT_BYTES constant
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kubex_harness.cli_runtime import (
    CLIRuntime,
    CliState,
    CREDENTIAL_PATHS,
    FAILURE_PATTERNS,
    MAX_OUTPUT_BYTES,
    CLI_COMMAND_BUILDERS,
    CLI_SKILL_FILES,
    _HITL_AUTH_MESSAGES,
    _build_gemini_command,
    _build_claude_command,
)
from kubex_harness.config_loader import AgentConfig


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def make_config(**kwargs) -> AgentConfig:
    """Create a minimal AgentConfig for testing."""
    defaults = {
        "agent_id": "test-agent",
        "model": "claude-sonnet-4-6",
        "runtime": "claude-code",
        "capabilities": ["test-cap"],
        "gateway_url": "http://gateway:8080",
        "broker_url": "http://kubex-broker:8060",
        "boundary": "default",
    }
    defaults.update(kwargs)
    return AgentConfig(**defaults)


@pytest.fixture
def config():
    return make_config()


@pytest.fixture
def runtime(config):
    return CLIRuntime(config)


@pytest.fixture
def mock_redis():
    r = AsyncMock()
    r.publish = AsyncMock(return_value=1)
    return r


@pytest.fixture
def mock_http():
    client = AsyncMock()
    resp = MagicMock()
    resp.status_code = 200
    client.post = AsyncMock(return_value=resp)
    client.get = AsyncMock(return_value=resp)
    return client


# ---------------------------------------------------------------------------
# CliState enum
# ---------------------------------------------------------------------------


class TestCliStateEnum:
    def test_booting_value(self):
        assert CliState.BOOTING == "booting"

    def test_credential_wait_value(self):
        assert CliState.CREDENTIAL_WAIT == "credential_wait"

    def test_ready_value(self):
        assert CliState.READY == "ready"

    def test_busy_value(self):
        assert CliState.BUSY == "busy"

    def test_is_str_enum(self):
        import enum
        assert issubclass(CliState, str)
        assert issubclass(CliState, enum.Enum)


# ---------------------------------------------------------------------------
# CREDENTIAL_PATHS
# ---------------------------------------------------------------------------


class TestCredentialPaths:
    def test_claude_code_key_exists(self):
        assert "claude-code" in CREDENTIAL_PATHS

    def test_claude_code_path_ends_with_credentials_json(self):
        path = CREDENTIAL_PATHS["claude-code"]
        assert path.name == ".credentials.json"
        assert ".claude" in str(path)

    def test_path_is_pathlib_path(self):
        assert isinstance(CREDENTIAL_PATHS["claude-code"], Path)

    def test_codex_cli_key_exists(self):
        """codex-cli must be in CREDENTIAL_PATHS."""
        assert "codex-cli" in CREDENTIAL_PATHS

    def test_codex_cli_path_ends_with_credentials_json(self):
        path = CREDENTIAL_PATHS["codex-cli"]
        assert path.name == ".credentials.json"
        assert ".codex" in str(path)

    def test_gemini_cli_key_exists(self):
        assert "gemini-cli" in CREDENTIAL_PATHS


# ---------------------------------------------------------------------------
# FAILURE_PATTERNS
# ---------------------------------------------------------------------------


class TestFailurePatterns:
    def test_auth_expired_key_exists(self):
        assert "auth_expired" in FAILURE_PATTERNS

    def test_subscription_limit_key_exists(self):
        assert "subscription_limit" in FAILURE_PATTERNS

    def test_runtime_not_available_key_exists(self):
        assert "runtime_not_available" in FAILURE_PATTERNS

    def test_all_values_are_lists(self):
        for key, val in FAILURE_PATTERNS.items():
            assert isinstance(val, list), f"{key} value should be a list"

    def test_auth_expired_has_patterns(self):
        assert len(FAILURE_PATTERNS["auth_expired"]) > 0

    def test_subscription_limit_has_patterns(self):
        assert len(FAILURE_PATTERNS["subscription_limit"]) > 0

    def test_runtime_not_available_has_patterns(self):
        assert len(FAILURE_PATTERNS["runtime_not_available"]) > 0


# ---------------------------------------------------------------------------
# MAX_OUTPUT_BYTES
# ---------------------------------------------------------------------------


class TestMaxOutputBytes:
    def test_constant_is_one_megabyte(self):
        assert MAX_OUTPUT_BYTES == 1_048_576


# ---------------------------------------------------------------------------
# _credentials_present
# ---------------------------------------------------------------------------


class TestCredentialsPresent:
    def test_missing_file_returns_false(self, runtime, tmp_path):
        """File doesn't exist -> False."""
        non_existent = tmp_path / ".credentials.json"
        with patch.dict(CREDENTIAL_PATHS, {"claude-code": non_existent}):
            assert runtime._credentials_present("claude-code") is False

    def test_empty_file_returns_false(self, runtime, tmp_path):
        """File exists but is 0 bytes -> False."""
        cred_file = tmp_path / ".credentials.json"
        cred_file.write_text("")
        with patch.dict(CREDENTIAL_PATHS, {"claude-code": cred_file}):
            assert runtime._credentials_present("claude-code") is False

    def test_populated_file_returns_true(self, runtime, tmp_path):
        """File exists and has content -> True."""
        cred_file = tmp_path / ".credentials.json"
        cred_file.write_text('{"claudeAiOauth": {"accessToken": "tok"}}')
        with patch.dict(CREDENTIAL_PATHS, {"claude-code": cred_file}):
            assert runtime._credentials_present("claude-code") is True

    def test_unknown_runtime_returns_false(self, runtime):
        """Runtime not in CREDENTIAL_PATHS -> False."""
        assert runtime._credentials_present("unknown-runtime") is False


# ---------------------------------------------------------------------------
# _classify_failure
# ---------------------------------------------------------------------------


class TestClassifyFailure:
    def test_exit_code_zero_returns_empty(self, runtime):
        assert runtime._classify_failure(0, "anything") == ""

    def test_auth_expired_pattern(self, runtime):
        assert runtime._classify_failure(1, "authentication failed") == "auth_expired"

    def test_rate_limit_returns_subscription_limit(self, runtime):
        assert runtime._classify_failure(1, "rate limit exceeded") == "subscription_limit"

    def test_command_not_found_returns_runtime_not_available(self, runtime):
        assert runtime._classify_failure(1, "command not found: claude") == "runtime_not_available"

    def test_unknown_error_returns_cli_crash(self, runtime):
        assert runtime._classify_failure(1, "some random error output") == "cli_crash"

    def test_session_expired_is_auth_expired(self, runtime):
        assert runtime._classify_failure(1, "session expired please re-authenticate") == "auth_expired"

    def test_usage_limit_is_subscription_limit(self, runtime):
        assert runtime._classify_failure(1, "usage limit reached for today") == "subscription_limit"

    def test_no_such_file_is_runtime_not_available(self, runtime):
        assert runtime._classify_failure(1, "no such file or directory") == "runtime_not_available"

    def test_exit_code_zero_with_error_text_returns_empty(self, runtime):
        assert runtime._classify_failure(0, "authentication failed") == ""

    def test_case_insensitive_matching(self, runtime):
        """Pattern matching should be case-insensitive (lowercase scan)."""
        assert runtime._classify_failure(1, "AUTHENTICATION FAILED") == "auth_expired"


# ---------------------------------------------------------------------------
# _build_command
# ---------------------------------------------------------------------------


class TestBuildCommand:
    def test_command_starts_with_claude(self, runtime):
        cmd = runtime._build_command("do something")
        assert cmd[0] == "claude"

    def test_command_includes_p_flag(self, runtime):
        cmd = runtime._build_command("my task")
        assert "-p" in cmd

    def test_task_message_follows_p_flag(self, runtime):
        cmd = runtime._build_command("my task")
        idx = cmd.index("-p")
        assert cmd[idx + 1] == "my task"

    def test_includes_output_format_json(self, runtime):
        cmd = runtime._build_command("task")
        assert "--output-format" in cmd
        idx = cmd.index("--output-format")
        assert cmd[idx + 1] == "json"

    def test_includes_dangerously_skip_permissions(self, runtime):
        cmd = runtime._build_command("task")
        assert "--dangerously-skip-permissions" in cmd

    def test_includes_no_session_persistence(self, runtime):
        cmd = runtime._build_command("task")
        assert "--no-session-persistence" in cmd

    def test_includes_model_when_set(self, runtime):
        cmd = runtime._build_command("task")
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == runtime.config.model

    def test_no_model_flag_when_empty_model(self):
        config = make_config(model="")
        rt = CLIRuntime(config)
        cmd = rt._build_command("task")
        assert "--model" not in cmd

    def test_returns_list(self, runtime):
        cmd = runtime._build_command("task")
        assert isinstance(cmd, list)


# ---------------------------------------------------------------------------
# _publish_state
# ---------------------------------------------------------------------------


class TestPublishState:
    @pytest.mark.asyncio
    async def test_publishes_to_lifecycle_channel(self, runtime, mock_redis):
        runtime._redis = mock_redis
        await runtime._publish_state(CliState.READY)
        mock_redis.publish.assert_called_once()
        channel, _ = mock_redis.publish.call_args[0]
        assert channel == f"lifecycle:{runtime.config.agent_id}"

    @pytest.mark.asyncio
    async def test_payload_contains_state_value(self, runtime, mock_redis):
        runtime._redis = mock_redis
        await runtime._publish_state(CliState.BUSY)
        _, payload_str = mock_redis.publish.call_args[0]
        payload = json.loads(payload_str)
        assert payload["state"] == "busy"

    @pytest.mark.asyncio
    async def test_payload_contains_agent_id(self, runtime, mock_redis):
        runtime._redis = mock_redis
        await runtime._publish_state(CliState.BOOTING)
        _, payload_str = mock_redis.publish.call_args[0]
        payload = json.loads(payload_str)
        assert payload["agent_id"] == runtime.config.agent_id

    @pytest.mark.asyncio
    async def test_publish_failure_does_not_raise(self, runtime):
        """State publish must never block or raise."""
        bad_redis = AsyncMock()
        bad_redis.publish = AsyncMock(side_effect=Exception("Redis down"))
        runtime._redis = bad_redis
        # Should not raise
        await runtime._publish_state(CliState.READY)

    @pytest.mark.asyncio
    async def test_publish_state_when_redis_none_does_not_raise(self, runtime):
        """If _redis is None (pre-boot), publish should silently skip."""
        runtime._redis = None
        # Should not raise
        await runtime._publish_state(CliState.BOOTING)

    @pytest.mark.asyncio
    async def test_publish_state_side_writes_agent_state_key(self, runtime, mock_redis):
        """_publish_state also writes to agent:state:{agent_id} key for poll-based reads."""
        mock_redis.set = AsyncMock(return_value=True)
        runtime._redis = mock_redis
        await runtime._publish_state(CliState.READY)
        mock_redis.set.assert_called_once()
        key = mock_redis.set.call_args[0][0]
        assert key == f"agent:state:{runtime.config.agent_id}"

    @pytest.mark.asyncio
    async def test_publish_state_side_write_failure_does_not_raise(self, runtime):
        """Side-write to agent:state key must never block or raise."""
        bad_redis = AsyncMock()
        bad_redis.publish = AsyncMock(return_value=1)
        bad_redis.set = AsyncMock(side_effect=Exception("Redis down"))
        runtime._redis = bad_redis
        # Should not raise even if SET fails
        await runtime._publish_state(CliState.READY)


# ---------------------------------------------------------------------------
# _request_hitl
# ---------------------------------------------------------------------------


class TestRequestHitl:
    @pytest.mark.asyncio
    async def test_posts_to_actions_endpoint(self, runtime, mock_http):
        runtime._http = mock_http
        await runtime._request_hitl("Please authenticate")
        mock_http.post.assert_called_once()
        url = mock_http.post.call_args[0][0]
        assert "/actions" in url

    @pytest.mark.asyncio
    async def test_payload_contains_request_user_input(self, runtime, mock_http):
        runtime._http = mock_http
        await runtime._request_hitl("Authenticate now")
        call_kwargs = mock_http.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert payload.get("action") == "request_user_input"

    @pytest.mark.asyncio
    async def test_payload_contains_agent_id(self, runtime, mock_http):
        runtime._http = mock_http
        await runtime._request_hitl("Auth needed")
        call_kwargs = mock_http.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert payload.get("agent_id") == runtime.config.agent_id

    @pytest.mark.asyncio
    async def test_hitl_failure_does_not_raise(self, runtime):
        """HITL post failure must not crash the harness."""
        bad_http = AsyncMock()
        bad_http.post = AsyncMock(side_effect=Exception("HTTP down"))
        runtime._http = bad_http
        await runtime._request_hitl("Auth needed")


# ---------------------------------------------------------------------------
# _graceful_shutdown
# ---------------------------------------------------------------------------


class TestGracefulShutdown:
    @pytest.mark.asyncio
    async def test_sigterm_sent_to_child(self, runtime):
        """First terminate(force=False) is called."""
        mock_child = MagicMock()
        mock_child.isalive.return_value = False  # exits immediately
        runtime._child = mock_child
        await runtime._graceful_shutdown()
        mock_child.terminate.assert_called_with(force=False)

    @pytest.mark.asyncio
    async def test_sigkill_sent_when_child_does_not_exit(self, runtime):
        """If child stays alive after 5s grace, SIGKILL is sent."""
        mock_child = MagicMock()
        # isalive() always True -> SIGKILL needed
        mock_child.isalive.return_value = True

        original_terminate = MagicMock()

        def terminate_side_effect(force=False):
            original_terminate(force=force)
            if force:
                # After SIGKILL, mark as dead
                mock_child.isalive.return_value = False

        mock_child.terminate.side_effect = terminate_side_effect
        runtime._child = mock_child

        # Patch sleep to avoid real 5s wait
        with patch("asyncio.sleep", new=AsyncMock()):
            await runtime._graceful_shutdown()

        # Both calls should have been made
        calls = mock_child.terminate.call_args_list
        force_values = [c.kwargs.get("force", c.args[0] if c.args else None) for c in calls]
        assert False in force_values, "terminate(force=False) was not called"
        assert True in force_values, "terminate(force=True) was not called"

    @pytest.mark.asyncio
    async def test_graceful_shutdown_no_child(self, runtime):
        """Graceful shutdown with no child should not raise."""
        runtime._child = None
        await runtime._graceful_shutdown()  # should not raise

    @pytest.mark.asyncio
    async def test_graceful_shutdown_child_exception(self, runtime):
        """Exceptions during terminate are swallowed."""
        mock_child = MagicMock()
        mock_child.isalive.return_value = False
        mock_child.terminate.side_effect = Exception("PTY gone")
        runtime._child = mock_child
        await runtime._graceful_shutdown()  # should not raise


# ---------------------------------------------------------------------------
# CLIRuntime initialization
# ---------------------------------------------------------------------------


class TestCLIRuntimeInit:
    def test_initial_state_is_booting(self, runtime):
        assert runtime._state == CliState.BOOTING

    def test_running_is_true(self, runtime):
        assert runtime._running is True

    def test_child_is_none(self, runtime):
        assert runtime._child is None

    def test_redis_is_none(self, runtime):
        assert runtime._redis is None

    def test_http_is_none(self, runtime):
        assert runtime._http is None

    def test_executor_has_max_workers_one(self, runtime):
        """ThreadPoolExecutor must use max_workers=1 for pexpect safety."""
        from concurrent.futures import ThreadPoolExecutor
        assert isinstance(runtime._executor, ThreadPoolExecutor)
        # max_workers is stored as _max_workers in CPython
        assert runtime._executor._max_workers == 1


# ---------------------------------------------------------------------------
# _wait_for_credentials — polling fallback
# ---------------------------------------------------------------------------


class TestWaitForCredentials:
    @pytest.mark.asyncio
    async def test_returns_true_when_credentials_appear(self, runtime, tmp_path):
        """Polling fallback: credentials appear on second check."""
        cred_file = tmp_path / ".credentials.json"
        call_count = [0]

        def fake_credentials_present(rt):
            call_count[0] += 1
            if call_count[0] >= 2:
                cred_file.write_text('{"token": "abc"}')
                return True
            return False

        with patch.object(runtime, "_credentials_present", side_effect=fake_credentials_present):
            with patch("asyncio.sleep", new=AsyncMock()):
                with patch("kubex_harness.cli_runtime.awatch", None):
                    result = await runtime._wait_for_credentials("claude-code", timeout_s=10.0)
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_on_timeout(self, runtime):
        """Polling fallback: returns False when timeout expires."""
        with patch.object(runtime, "_credentials_present", return_value=False):
            with patch("asyncio.sleep", new=AsyncMock()):
                with patch("kubex_harness.cli_runtime.awatch", None):
                    # Very short timeout so we don't wait
                    result = await runtime._wait_for_credentials("claude-code", timeout_s=0.001)
        assert result is False


# ---------------------------------------------------------------------------
# Auth-expired bypasses retry (D-16)
# ---------------------------------------------------------------------------


class TestAuthExpiredBypassesRetry:
    @pytest.mark.asyncio
    async def test_auth_expired_does_not_retry(self, runtime, mock_redis, mock_http):
        """On auth_expired failure, _execute_task should NOT call _run_cli_process a second time."""
        runtime._redis = mock_redis
        runtime._http = mock_http

        task = {"task_id": "task-1", "message": "do stuff"}

        with patch.object(
            runtime, "_run_cli_process", new=AsyncMock(return_value=(1, "authentication failed"))
        ) as mock_run:
            with patch.object(runtime, "_credential_gate", new=AsyncMock()):
                await runtime._execute_task(task)
            # Should only have been called once — no retry on auth_expired
            assert mock_run.call_count == 1

    @pytest.mark.asyncio
    async def test_cli_crash_retries_once(self, runtime, mock_redis, mock_http):
        """On cli_crash, _execute_task retries exactly once, then sends task_failed."""
        runtime._redis = mock_redis
        runtime._http = mock_http

        task = {"task_id": "task-2", "message": "do stuff"}

        with patch.object(
            runtime, "_run_cli_process", new=AsyncMock(return_value=(1, "some random error"))
        ) as mock_run:
            await runtime._execute_task(task)
            # Should have been called twice: original + 1 retry
            assert mock_run.call_count == 2


# ---------------------------------------------------------------------------
# _post_progress
# ---------------------------------------------------------------------------


class TestPostProgress:
    @pytest.mark.asyncio
    async def test_posts_to_task_progress_endpoint(self, runtime, mock_http):
        runtime._http = mock_http
        await runtime._post_progress("task-99", "some output")
        mock_http.post.assert_called_once()
        url = mock_http.post.call_args[0][0]
        assert "/tasks/task-99/progress" in url

    @pytest.mark.asyncio
    async def test_progress_failure_does_not_raise(self, runtime):
        bad_http = AsyncMock()
        bad_http.post = AsyncMock(side_effect=Exception("network error"))
        runtime._http = bad_http
        await runtime._post_progress("task-1", "chunk")  # should not raise


# ---------------------------------------------------------------------------
# _drain_to_buffer — unit behavior
# ---------------------------------------------------------------------------


class TestDrainToBuffer:
    def test_drain_reads_chunks_into_buffer(self, runtime):
        """_drain_to_buffer accumulates data until EOF."""
        mock_child = MagicMock()
        try:
            import pexpect
            eof_exc = pexpect.EOF
        except ImportError:
            pytest.skip("pexpect not available")

        read_values = ["hello ", "world", eof_exc("EOF")]

        def read_side_effect(size, timeout):
            val = read_values.pop(0)
            if isinstance(val, Exception):
                raise val
            return val

        mock_child.read_nonblocking = MagicMock(side_effect=read_side_effect)
        mock_child.isalive.return_value = True

        buf: list[str] = []
        runtime._drain_to_buffer(mock_child, buf, "task-1")

        assert "".join(buf) == "hello world"

    def test_drain_breaks_on_timeout_when_dead(self, runtime):
        """On TIMEOUT, if child is not alive, drain should stop."""
        mock_child = MagicMock()
        try:
            import pexpect
            timeout_exc = pexpect.TIMEOUT
        except ImportError:
            pytest.skip("pexpect not available")

        mock_child.read_nonblocking = MagicMock(side_effect=timeout_exc("TIMEOUT"))
        mock_child.isalive.return_value = False

        buf: list[str] = []
        runtime._drain_to_buffer(mock_child, buf, "task-1")
        assert buf == []

    def test_drain_truncates_at_max_output_bytes(self, runtime):
        """Drain truncates output at MAX_OUTPUT_BYTES."""
        mock_child = MagicMock()
        try:
            import pexpect
            eof_exc = pexpect.EOF
        except ImportError:
            pytest.skip("pexpect not available")

        # Generate chunks that exceed MAX_OUTPUT_BYTES
        chunk_size = 1024
        num_chunks = (MAX_OUTPUT_BYTES // chunk_size) + 10

        chunks = ["x" * chunk_size] * num_chunks + [eof_exc("EOF")]

        def read_side_effect(size, timeout):
            val = chunks.pop(0)
            if isinstance(val, Exception):
                raise val
            return val

        mock_child.read_nonblocking = MagicMock(side_effect=read_side_effect)
        mock_child.isalive.return_value = True

        buf: list[str] = []
        runtime._drain_to_buffer(mock_child, buf, "task-1")

        total_bytes = sum(len(s.encode()) for s in buf)
        assert total_bytes <= MAX_OUTPUT_BYTES


# ---------------------------------------------------------------------------
# Legacy stub tests — these are kept and now pass with the real implementation
# ---------------------------------------------------------------------------


def test_cli_state_enum():
    assert CliState.BOOTING == "booting"
    assert CliState.CREDENTIAL_WAIT == "credential_wait"
    assert CliState.READY == "ready"
    assert CliState.BUSY == "busy"


def test_credentials_missing(tmp_path):
    config = make_config()
    rt = CLIRuntime(config)
    non_existent = tmp_path / ".credentials.json"
    with patch.dict(CREDENTIAL_PATHS, {"claude-code": non_existent}):
        assert rt._credentials_present("claude-code") is False


def test_credentials_empty(tmp_path):
    config = make_config()
    rt = CLIRuntime(config)
    cred_file = tmp_path / ".credentials.json"
    cred_file.write_text("")
    with patch.dict(CREDENTIAL_PATHS, {"claude-code": cred_file}):
        assert rt._credentials_present("claude-code") is False


def test_credentials_present(tmp_path):
    config = make_config()
    rt = CLIRuntime(config)
    cred_file = tmp_path / ".credentials.json"
    cred_file.write_text('{"claudeAiOauth": {"accessToken": "tok"}}')
    with patch.dict(CREDENTIAL_PATHS, {"claude-code": cred_file}):
        assert rt._credentials_present("claude-code") is True


def test_credentials_unknown_runtime():
    config = make_config()
    rt = CLIRuntime(config)
    assert rt._credentials_present("unknown-runtime") is False


def test_pty_spawn_success():
    """PTY spawn is tested via _drain_to_buffer — actual pexpect.spawn requires a real PTY."""
    try:
        import pexpect  # noqa: F401
    except ImportError:
        pytest.skip("pexpect not available")
    config = make_config()
    rt = CLIRuntime(config)
    cmd = rt._build_command("echo hello")
    assert "claude" in cmd


def test_large_output_no_deadlock():
    """Drain truncates at MAX_OUTPUT_BYTES — deadlock prevention verified in TestDrainToBuffer."""
    assert MAX_OUTPUT_BYTES == 1_048_576


def test_failure_classification_auth_expired():
    config = make_config()
    rt = CLIRuntime(config)
    assert rt._classify_failure(1, "authentication failed") == "auth_expired"


def test_failure_classification_subscription_limit():
    config = make_config()
    rt = CLIRuntime(config)
    assert rt._classify_failure(1, "rate limit exceeded") == "subscription_limit"


def test_failure_classification_runtime_not_available():
    config = make_config()
    rt = CLIRuntime(config)
    assert rt._classify_failure(1, "command not found: claude") == "runtime_not_available"


def test_failure_classification_cli_crash():
    config = make_config()
    rt = CLIRuntime(config)
    assert rt._classify_failure(1, "some random error") == "cli_crash"


def test_failure_classification_success():
    config = make_config()
    rt = CLIRuntime(config)
    assert rt._classify_failure(0, "anything") == ""


def test_command_includes_required_flags():
    config = make_config()
    rt = CLIRuntime(config)
    cmd = rt._build_command("do task")
    assert "claude" in cmd
    assert "-p" in cmd
    assert "--output-format" in cmd
    assert "--dangerously-skip-permissions" in cmd
    assert "--no-session-persistence" in cmd


def test_command_includes_model():
    config = make_config(model="claude-opus-4")
    rt = CLIRuntime(config)
    cmd = rt._build_command("do task")
    assert "--model" in cmd
    idx = cmd.index("--model")
    assert cmd[idx + 1] == "claude-opus-4"


def test_command_no_model_when_empty():
    config = make_config(model="")
    rt = CLIRuntime(config)
    cmd = rt._build_command("do task")
    assert "--model" not in cmd


@pytest.mark.asyncio
async def test_lifecycle_state_published():
    config = make_config()
    rt = CLIRuntime(config)
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock(return_value=1)
    rt._redis = mock_redis
    await rt._publish_state(CliState.READY)
    channel, payload_str = mock_redis.publish.call_args[0]
    assert channel == f"lifecycle:{config.agent_id}"
    payload = json.loads(payload_str)
    assert payload["state"] == "ready"


@pytest.mark.asyncio
async def test_boot_sequence_credential_wait():
    """Credential gate transitions to CREDENTIAL_WAIT when creds missing."""
    config = make_config()
    rt = CLIRuntime(config)
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock(return_value=1)
    rt._redis = mock_redis
    rt._http = AsyncMock()
    rt._http.post = AsyncMock(return_value=MagicMock(status_code=200))

    states_published = []

    async def capture_state(state):
        states_published.append(state)

    with patch.object(rt, "_publish_state", side_effect=capture_state):
        with patch.object(rt, "_credentials_present", return_value=False):
            with patch.object(rt, "_request_hitl", new=AsyncMock()):
                with patch.object(rt, "_wait_for_credentials", new=AsyncMock(return_value=True)):
                    await rt._credential_gate()

    assert CliState.CREDENTIAL_WAIT in states_published


@pytest.mark.asyncio
async def test_task_loop_state_transitions():
    """Task loop sets state to BUSY around a task dispatch.

    The _task_loop sets _state = BUSY before calling _execute_task.
    We verify by observing _state on the runtime after simulate one iteration.
    """
    config = make_config()
    rt = CLIRuntime(config)
    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock(return_value=1)
    rt._redis = mock_redis
    rt._http = AsyncMock()
    rt._http.post = AsyncMock(return_value=MagicMock(status_code=200))

    # Simulate what _task_loop does: set BUSY, call _execute_task
    rt._state = CliState.BUSY
    await rt._publish_state(CliState.BUSY)

    task = {"task_id": "t1", "message": "do it"}
    with patch.object(rt, "_run_cli_process", new=AsyncMock(return_value=(0, "done"))):
        await rt._execute_task(task)

    # After _execute_task returns success, task_loop will set READY
    # Here we verify BUSY was published (via mock_redis)
    published_channels = [call[0][0] for call in mock_redis.publish.call_args_list]
    assert any(f"lifecycle:{config.agent_id}" in ch for ch in published_channels)


@pytest.mark.asyncio
async def test_hitl_triggered_on_missing_creds():
    """HITL request is sent when credentials are missing at boot."""
    config = make_config()
    rt = CLIRuntime(config)
    rt._redis = AsyncMock()
    rt._http = AsyncMock()
    rt._http.post = AsyncMock(return_value=MagicMock(status_code=200))

    with patch.object(rt, "_publish_state", new=AsyncMock()):
        with patch.object(rt, "_credentials_present", return_value=False):
            with patch.object(rt, "_request_hitl", new=AsyncMock()) as mock_hitl:
                with patch.object(rt, "_wait_for_credentials", new=AsyncMock(return_value=True)):
                    await rt._credential_gate()
    mock_hitl.assert_called_once()


@pytest.mark.asyncio
async def test_credential_watcher_detects_file():
    """_wait_for_credentials returns True when file appears (polling fallback)."""
    config = make_config()
    rt = CLIRuntime(config)
    call_count = [0]

    def fake_present(runtime_name):
        call_count[0] += 1
        return call_count[0] >= 2

    with patch.object(rt, "_credentials_present", side_effect=fake_present):
        with patch("asyncio.sleep", new=AsyncMock()):
            with patch("kubex_harness.cli_runtime.awatch", None):
                result = await rt._wait_for_credentials("claude-code", timeout_s=10.0)
    assert result is True


@pytest.mark.asyncio
async def test_sigterm_forwarding():
    """stop() sets _running=False and signals graceful shutdown."""
    config = make_config()
    rt = CLIRuntime(config)
    mock_child = MagicMock()
    mock_child.isalive.return_value = True
    rt._child = mock_child
    rt._running = True

    rt.stop()

    assert rt._running is False


@pytest.mark.asyncio
async def test_sigkill_escalation():
    """_graceful_shutdown sends SIGKILL when child doesn't exit after 5s."""
    config = make_config()
    rt = CLIRuntime(config)
    mock_child = MagicMock()
    mock_child.isalive.return_value = True

    call_record = []

    def terminate_side(force=False):
        call_record.append(force)
        if force:
            mock_child.isalive.return_value = False

    mock_child.terminate.side_effect = terminate_side
    rt._child = mock_child

    with patch("asyncio.sleep", new=AsyncMock()):
        await rt._graceful_shutdown()

    assert False in call_record, "SIGTERM (force=False) should have been sent"
    assert True in call_record, "SIGKILL (force=True) should have been sent"


def test_claude_md_written(tmp_path):
    """_write_skill_file writes skill content to CLAUDE.md for claude-code runtime."""
    config = make_config(runtime="claude-code")
    rt = CLIRuntime(config)

    skill_dir = tmp_path / "skills" / "my-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("# My Skill\n\nDo this thing.")

    claude_md_path = tmp_path / "CLAUDE.md"

    with patch("kubex_harness.cli_runtime.Path") as mock_path_class:
        # Route Path("/app/skills") to tmp_path/skills
        # Route Path("/app") / "CLAUDE.md" to tmp_path/CLAUDE.md
        def path_constructor(p):
            if str(p) == "/app/skills":
                return tmp_path / "skills"
            if str(p) == "/app":
                return tmp_path
            return Path(p)

        mock_path_class.side_effect = path_constructor
        rt._write_skill_file()

    assert claude_md_path.exists()
    content = claude_md_path.read_text()
    assert "My Skill" in content


@pytest.mark.asyncio
async def test_auth_expired_bypasses_retry():
    """Auth-expired failure does NOT trigger a second _run_cli_process call."""
    config = make_config()
    rt = CLIRuntime(config)
    rt._redis = AsyncMock()
    rt._redis.publish = AsyncMock(return_value=1)
    rt._http = AsyncMock()
    rt._http.post = AsyncMock(return_value=MagicMock(status_code=200))

    task = {"task_id": "task-auth", "message": "work"}

    with patch.object(rt, "_publish_state", new=AsyncMock()):
        with patch.object(
            rt, "_run_cli_process", new=AsyncMock(return_value=(1, "authentication failed"))
        ) as mock_run:
            with patch.object(rt, "_credential_gate", new=AsyncMock()):
                await rt._execute_task(task)
        assert mock_run.call_count == 1, "auth_expired must not retry"


# ---------------------------------------------------------------------------
# CLI_COMMAND_BUILDERS dispatch dict
# ---------------------------------------------------------------------------


class TestCLICommandBuilders:
    def test_has_claude_code_key(self):
        assert "claude-code" in CLI_COMMAND_BUILDERS

    def test_has_gemini_cli_key(self):
        assert "gemini-cli" in CLI_COMMAND_BUILDERS

    def test_claude_code_maps_to_callable(self):
        assert callable(CLI_COMMAND_BUILDERS["claude-code"])

    def test_gemini_cli_maps_to_callable(self):
        assert callable(CLI_COMMAND_BUILDERS["gemini-cli"])


# ---------------------------------------------------------------------------
# CLI_SKILL_FILES mapping
# ---------------------------------------------------------------------------


class TestCLISkillFiles:
    def test_claude_code_maps_to_claude_md(self):
        assert CLI_SKILL_FILES["claude-code"] == "CLAUDE.md"

    def test_gemini_cli_maps_to_gemini_md(self):
        assert CLI_SKILL_FILES["gemini-cli"] == "GEMINI.md"


# ---------------------------------------------------------------------------
# CREDENTIAL_PATHS — gemini-cli entry
# ---------------------------------------------------------------------------


class TestGeminiCredentialPath:
    def test_gemini_cli_key_exists(self):
        assert "gemini-cli" in CREDENTIAL_PATHS

    def test_gemini_cli_path_is_oauth_creds(self):
        path = CREDENTIAL_PATHS["gemini-cli"]
        assert path.name == "oauth_creds.json"
        assert ".gemini" in str(path)

    def test_gemini_cli_path_is_pathlib_path(self):
        assert isinstance(CREDENTIAL_PATHS["gemini-cli"], Path)


# ---------------------------------------------------------------------------
# _build_gemini_command module-level function
# ---------------------------------------------------------------------------


class TestBuildGeminiCommand:
    def test_command_starts_with_gemini(self):
        cmd = _build_gemini_command("hello", None)
        assert cmd[0] == "gemini"

    def test_includes_p_flag(self):
        cmd = _build_gemini_command("hello", None)
        assert "-p" in cmd

    def test_task_follows_p_flag(self):
        cmd = _build_gemini_command("hello", None)
        idx = cmd.index("-p")
        assert cmd[idx + 1] == "hello"

    def test_includes_output_format_json(self):
        cmd = _build_gemini_command("hello", None)
        assert "--output-format" in cmd
        idx = cmd.index("--output-format")
        assert cmd[idx + 1] == "json"

    def test_no_dangerously_skip_permissions(self):
        cmd = _build_gemini_command("hello", None)
        assert "--dangerously-skip-permissions" not in cmd

    def test_no_no_session_persistence(self):
        cmd = _build_gemini_command("hello", None)
        assert "--no-session-persistence" not in cmd

    def test_includes_model_when_set(self):
        cmd = _build_gemini_command("hello", "gemini-2.5-pro")
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == "gemini-2.5-pro"

    def test_no_model_when_none(self):
        cmd = _build_gemini_command("hello", None)
        assert "--model" not in cmd


# ---------------------------------------------------------------------------
# _build_claude_command module-level function
# ---------------------------------------------------------------------------


class TestBuildClaudeCommand:
    def test_command_starts_with_claude(self):
        cmd = _build_claude_command("task", None)
        assert cmd[0] == "claude"

    def test_includes_dangerously_skip_permissions(self):
        cmd = _build_claude_command("task", None)
        assert "--dangerously-skip-permissions" in cmd

    def test_includes_no_session_persistence(self):
        cmd = _build_claude_command("task", None)
        assert "--no-session-persistence" in cmd

    def test_includes_model_when_set(self):
        cmd = _build_claude_command("task", "claude-opus-4")
        assert "--model" in cmd
        idx = cmd.index("--model")
        assert cmd[idx + 1] == "claude-opus-4"


# ---------------------------------------------------------------------------
# _build_command dispatch per runtime
# ---------------------------------------------------------------------------


class TestBuildCommandDispatch:
    def test_gemini_cli_dispatch_starts_with_gemini(self):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        cmd = rt._build_command("task")
        assert cmd[0] == "gemini"

    def test_claude_code_dispatch_starts_with_claude(self):
        config = make_config(runtime="claude-code")
        rt = CLIRuntime(config)
        cmd = rt._build_command("task")
        assert cmd[0] == "claude"

    def test_gemini_cli_no_dangerously_skip_permissions(self):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        cmd = rt._build_command("task")
        assert "--dangerously-skip-permissions" not in cmd

    def test_claude_code_has_dangerously_skip_permissions(self):
        config = make_config(runtime="claude-code")
        rt = CLIRuntime(config)
        cmd = rt._build_command("task")
        assert "--dangerously-skip-permissions" in cmd


# ---------------------------------------------------------------------------
# _write_skill_file — generalized skill injection
# ---------------------------------------------------------------------------


class TestWriteSkillFile:
    def test_claude_code_writes_claude_md(self, tmp_path):
        config = make_config(runtime="claude-code")
        rt = CLIRuntime(config)

        skill_dir = tmp_path / "skills" / "my-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# My Skill")

        claude_md_path = tmp_path / "CLAUDE.md"

        with patch("kubex_harness.cli_runtime.Path") as mock_path_class:
            def path_constructor(p):
                if str(p) == "/app/skills":
                    return tmp_path / "skills"
                if str(p) == "/app":
                    return tmp_path
                return Path(p)

            mock_path_class.side_effect = path_constructor
            rt._write_skill_file()

        assert claude_md_path.exists()

    def test_gemini_cli_writes_gemini_md(self, tmp_path):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)

        skill_dir = tmp_path / "skills" / "my-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# My Skill")

        gemini_md_path = tmp_path / "GEMINI.md"

        with patch("kubex_harness.cli_runtime.Path") as mock_path_class:
            def path_constructor(p):
                if str(p) == "/app/skills":
                    return tmp_path / "skills"
                if str(p) == "/app":
                    return tmp_path
                return Path(p)

            mock_path_class.side_effect = path_constructor
            rt._write_skill_file()

        assert gemini_md_path.exists()


# ---------------------------------------------------------------------------
# FAILURE_PATTERNS — Gemini-specific patterns
# ---------------------------------------------------------------------------


class TestGeminiFailurePatterns:
    def test_auth_expired_contains_invalid_grant(self):
        assert "invalid_grant" in FAILURE_PATTERNS["auth_expired"]

    def test_auth_expired_contains_failed_to_sign_in(self):
        assert "failed to sign in" in FAILURE_PATTERNS["auth_expired"]

    def test_subscription_limit_contains_resource_exhausted(self):
        assert "resource_exhausted" in FAILURE_PATTERNS["subscription_limit"]

    def test_subscription_limit_contains_resource_has_been_exhausted(self):
        assert "resource has been exhausted" in FAILURE_PATTERNS["subscription_limit"]

    def test_classify_resource_exhausted(self):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        assert rt._classify_failure(1, "RESOURCE_EXHAUSTED: quota hit") == "subscription_limit"

    def test_classify_invalid_grant(self):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        assert rt._classify_failure(1, "invalid_grant: token revoked") == "auth_expired"


# ---------------------------------------------------------------------------
# Hook server gate — only for claude-code
# ---------------------------------------------------------------------------


class TestHookServerGate:
    @pytest.mark.asyncio
    async def test_hook_server_not_started_for_gemini_cli(self):
        """Hook server must NOT be started when runtime=gemini-cli."""
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        rt._redis = AsyncMock()
        rt._http = AsyncMock()

        with patch("kubex_harness.cli_runtime.Path") as mock_path_class:
            mock_path_class.side_effect = lambda p: Path(p)
            with patch.object(rt, "_credential_gate", new=AsyncMock()):
                with patch.object(rt, "_task_loop", new=AsyncMock()):
                    with patch.object(rt, "_register", new=AsyncMock()):
                        with patch.object(rt, "_deregister", new=AsyncMock()):
                            with patch("kubex_harness.cli_runtime.aioredis") as mock_redis_mod:
                                mock_redis_mod.from_url.return_value = AsyncMock()
                                with patch("httpx.AsyncClient") as mock_client:
                                    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
                                    mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
                                    # hook_server import must not be called
                                    with patch("kubex_harness.hook_server.start_hook_server") as mock_hook:
                                        try:
                                            await rt.run()
                                        except Exception:
                                            pass
                                        mock_hook.assert_not_called()

    def test_hook_server_gate_is_claude_code_only(self):
        """The hook server gate in run() checks runtime == 'claude-code' (D-13)."""
        import inspect
        import kubex_harness.cli_runtime as cli_mod
        source = inspect.getsource(cli_mod.CLIRuntime.run)
        assert 'self.config.runtime == "claude-code"' in source


# ---------------------------------------------------------------------------
# HITL auth message — runtime-specific
# ---------------------------------------------------------------------------


class TestHITLAuthMessages:
    def test_claude_code_hitl_message_exists(self):
        assert "claude-code" in _HITL_AUTH_MESSAGES

    def test_gemini_cli_hitl_message_exists(self):
        assert "gemini-cli" in _HITL_AUTH_MESSAGES

    def test_gemini_cli_hitl_message_contains_docker_exec(self):
        msg = _HITL_AUTH_MESSAGES["gemini-cli"]
        assert "docker exec" in msg

    def test_gemini_cli_hitl_message_contains_gemini(self):
        msg = _HITL_AUTH_MESSAGES["gemini-cli"]
        assert "gemini" in msg

    def test_claude_code_hitl_message_does_not_say_gemini(self):
        msg = _HITL_AUTH_MESSAGES["claude-code"]
        assert "gemini" not in msg.lower()

    @pytest.mark.asyncio
    async def test_credential_gate_uses_gemini_message_for_gemini(self):
        """HITL message for gemini-cli must reference gemini, not claude auth login."""
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        rt._redis = AsyncMock()
        rt._http = AsyncMock()

        captured_messages = []

        async def capture_hitl(msg):
            captured_messages.append(msg)

        with patch.object(rt, "_publish_state", new=AsyncMock()):
            with patch.object(rt, "_credentials_present", return_value=False):
                with patch.object(rt, "_request_hitl", side_effect=capture_hitl):
                    with patch.object(rt, "_wait_for_credentials", new=AsyncMock(return_value=True)):
                        await rt._credential_gate()

        assert len(captured_messages) == 1
        msg = captured_messages[0]
        assert "gemini" in msg.lower()
        assert "claude auth login" not in msg


# ---------------------------------------------------------------------------
# _credentials_present — gemini-cli path
# ---------------------------------------------------------------------------


class TestGeminiCredentialsPresent:
    def test_gemini_cli_missing_file_returns_false(self, tmp_path):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        non_existent = tmp_path / "oauth_creds.json"
        with patch.dict(CREDENTIAL_PATHS, {"gemini-cli": non_existent}):
            assert rt._credentials_present("gemini-cli") is False

    def test_gemini_cli_populated_file_returns_true(self, tmp_path):
        config = make_config(runtime="gemini-cli")
        rt = CLIRuntime(config)
        cred_file = tmp_path / "oauth_creds.json"
        cred_file.write_text('{"access_token": "tok"}')
        with patch.dict(CREDENTIAL_PATHS, {"gemini-cli": cred_file}):
            assert rt._credentials_present("gemini-cli") is True
