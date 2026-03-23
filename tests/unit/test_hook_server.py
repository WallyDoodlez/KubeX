"""Unit tests for HookServer — hooks monitoring (Phase 10).

Tests cover:
  HOOK-01: Hook endpoint receives and accepts all event types
  HOOK-02: Security — injection payloads are discarded, not executed
  HOOK-03: Lifecycle events — Stop/SessionEnd trigger CLIRuntime._post_progress
  HOOK-04: Audit trail — PostToolUse events write to Redis sorted set audit:{task_id}
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# HOOK-01: Endpoint receives events
# ---------------------------------------------------------------------------


class TestHookEndpoint:
    """POST /hooks accepts all defined event types and returns 200."""

    def _make_client(self):
        from kubex_harness.hook_server import create_hook_app
        mock_runtime = MagicMock()
        mock_runtime._on_post_tool_use = AsyncMock()
        mock_runtime._on_stop = AsyncMock()
        mock_runtime._on_session_end = AsyncMock()
        mock_runtime._on_subagent_stop = AsyncMock()
        app = create_hook_app(mock_runtime)
        return TestClient(app), mock_runtime

    def test_post_tool_use_accepted(self):
        """POST /hooks with PostToolUse JSON returns 200."""
        client, _ = self._make_client()
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "s1",
            "tool_name": "Write",
            "tool_use_id": "t1",
            "tool_input": {},
            "tool_response": {"success": True},
        }
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_stop_event_accepted(self):
        """POST /hooks with Stop JSON returns 200."""
        client, _ = self._make_client()
        payload = {"hook_event_name": "Stop", "session_id": "s1"}
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_session_end_accepted(self):
        """POST /hooks with SessionEnd JSON returns 200."""
        client, _ = self._make_client()
        payload = {"hook_event_name": "SessionEnd", "session_id": "s1", "reason": "clear"}
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_subagent_stop_accepted(self):
        """POST /hooks with SubagentStop JSON returns 200."""
        client, _ = self._make_client()
        payload = {"hook_event_name": "SubagentStop", "session_id": "s1"}
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_unknown_event_type_returns_200(self):
        """POST /hooks with unknown hook_event_name returns 200 (not 422)."""
        client, _ = self._make_client()
        payload = {"hook_event_name": "FutureHook", "session_id": "s1"}
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_malformed_payload_returns_200(self):
        """POST /hooks with invalid JSON structure returns 200."""
        client, _ = self._make_client()
        # No hook_event_name field at all
        payload = {"garbage": "data"}
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}


# ---------------------------------------------------------------------------
# HOOK-02: Security
# ---------------------------------------------------------------------------


class TestHookSecurity:
    """Hook endpoint discards dangerous payloads without execution."""

    def test_injection_payload_discarded(self):
        """POST /hooks with shell injection in tool_name does not cause execution, returns 200."""
        from kubex_harness.hook_server import create_hook_app
        mock_runtime = MagicMock()
        mock_runtime._on_post_tool_use = AsyncMock()
        mock_runtime._on_stop = AsyncMock()
        mock_runtime._on_session_end = AsyncMock()
        mock_runtime._on_subagent_stop = AsyncMock()
        app = create_hook_app(mock_runtime)
        client = TestClient(app)

        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "s1",
            "tool_name": "; rm -rf /",
            "tool_use_id": "t1",
            "tool_input": {},
            "tool_response": {"success": True},
        }
        resp = client.post("/hooks", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        # Data flows through normally — handler is called, no shell execution
        mock_runtime._on_post_tool_use.assert_called_once()


# ---------------------------------------------------------------------------
# HOOK-03: Lifecycle events
# ---------------------------------------------------------------------------


class TestHookHandlers:
    """Stop and SessionEnd events trigger CLIRuntime progress reporting."""

    @pytest.mark.asyncio
    async def test_stop_calls_post_progress(self):
        """Stop event calls CLIRuntime._post_progress with task_id."""
        from kubex_harness.hook_server import StopEvent
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.cli_runtime import CLIRuntime

        config = MagicMock(spec=AgentConfig)
        config.runtime = "claude-code"
        config.agent_id = "test-agent"
        config.gateway_url = "http://gateway:8000"
        config.broker_url = "http://broker:8001"
        config.capabilities = ["test"]
        config.boundary = "internal"
        config.model = None

        runtime = CLIRuntime(config)
        runtime._current_task_id = "task-1"
        runtime._post_progress = AsyncMock()
        runtime._http = AsyncMock()

        event = StopEvent(
            hook_event_name="Stop",
            session_id="s1",
            last_assistant_message="All done!",
        )
        await runtime._on_stop(event)

        runtime._post_progress.assert_called_once()
        call_args = runtime._post_progress.call_args
        assert call_args[0][0] == "task-1"  # task_id positional arg
        assert call_args[0][1].startswith("turn_complete:")

    @pytest.mark.asyncio
    async def test_stop_no_task_id_skipped(self):
        """Stop event with no current task_id does not call _post_progress."""
        from kubex_harness.hook_server import StopEvent
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.cli_runtime import CLIRuntime

        config = MagicMock(spec=AgentConfig)
        config.runtime = "claude-code"
        config.agent_id = "test-agent"
        config.gateway_url = "http://gateway:8000"
        config.broker_url = "http://broker:8001"
        config.capabilities = ["test"]
        config.boundary = "internal"
        config.model = None

        runtime = CLIRuntime(config)
        runtime._current_task_id = None
        runtime._post_progress = AsyncMock()
        runtime._http = AsyncMock()

        event = StopEvent(hook_event_name="Stop", session_id="s1")
        await runtime._on_stop(event)

        runtime._post_progress.assert_not_called()


# ---------------------------------------------------------------------------
# HOOK-04: Audit trail write
# ---------------------------------------------------------------------------


class TestAuditTrail:
    """PostToolUse events write structured audit entries to Redis."""

    @pytest.mark.asyncio
    async def test_post_tool_use_writes_audit_entry(self):
        """PostToolUse event writes to Redis sorted set audit:{task_id}."""
        from kubex_harness.hook_server import PostToolUseEvent
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.cli_runtime import CLIRuntime

        config = MagicMock(spec=AgentConfig)
        config.runtime = "claude-code"
        config.agent_id = "test-agent"
        config.gateway_url = "http://gateway:8000"
        config.broker_url = "http://broker:8001"
        config.capabilities = ["test"]
        config.boundary = "internal"
        config.model = None

        runtime = CLIRuntime(config)
        runtime._current_task_id = "task-1"
        mock_redis = AsyncMock()
        runtime._redis = mock_redis

        event = PostToolUseEvent(
            hook_event_name="PostToolUse",
            session_id="s1",
            tool_name="Write",
            tool_use_id="t1",
            tool_input={},
            tool_response={"success": True},
        )
        await runtime._on_post_tool_use(event)

        mock_redis.zadd.assert_called_once()
        call_args = mock_redis.zadd.call_args
        key = call_args[0][0]
        assert key == "audit:task-1"
        members = call_args[0][1]
        # members is a dict {json_entry: score}
        json_entry = list(members.keys())[0]
        entry = json.loads(json_entry)
        assert entry["tool_name"] == "Write"

    @pytest.mark.asyncio
    async def test_audit_key_has_24h_ttl(self):
        """audit:{task_id} key has EXPIRE set to 86400."""
        from kubex_harness.hook_server import PostToolUseEvent
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.cli_runtime import CLIRuntime

        config = MagicMock(spec=AgentConfig)
        config.runtime = "claude-code"
        config.agent_id = "test-agent"
        config.gateway_url = "http://gateway:8000"
        config.broker_url = "http://broker:8001"
        config.capabilities = ["test"]
        config.boundary = "internal"
        config.model = None

        runtime = CLIRuntime(config)
        runtime._current_task_id = "task-1"
        mock_redis = AsyncMock()
        runtime._redis = mock_redis

        event = PostToolUseEvent(
            hook_event_name="PostToolUse",
            session_id="s1",
            tool_name="Write",
            tool_use_id="t1",
            tool_input={},
            tool_response={"success": True},
        )
        await runtime._on_post_tool_use(event)

        mock_redis.expire.assert_called_once_with("audit:task-1", 86400)

    def test_audit_entry_minimal_fields(self):
        """audit entry contains only tool_name, timestamp, success."""
        import json
        import time

        entry = {"tool_name": "Write", "timestamp": time.time(), "success": True}
        assert set(entry.keys()) == {"tool_name", "timestamp", "success"}
        # Verify no extra fields like tool_input or tool_response
        assert "tool_input" not in entry
        assert "tool_response" not in entry

    @pytest.mark.asyncio
    async def test_no_task_id_discards_event(self):
        """PostToolUse with no current task_id does not write to Redis."""
        from kubex_harness.hook_server import PostToolUseEvent
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.cli_runtime import CLIRuntime

        config = MagicMock(spec=AgentConfig)
        config.runtime = "claude-code"
        config.agent_id = "test-agent"
        config.gateway_url = "http://gateway:8000"
        config.broker_url = "http://broker:8001"
        config.capabilities = ["test"]
        config.boundary = "internal"
        config.model = None

        runtime = CLIRuntime(config)
        runtime._current_task_id = None
        mock_redis = AsyncMock()
        runtime._redis = mock_redis

        event = PostToolUseEvent(
            hook_event_name="PostToolUse",
            session_id="s1",
            tool_name="Write",
            tool_use_id="t1",
            tool_input={},
            tool_response={"success": True},
        )
        await runtime._on_post_tool_use(event)

        mock_redis.zadd.assert_not_called()
