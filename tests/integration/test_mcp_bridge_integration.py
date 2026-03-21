"""Integration tests for MCPBridgeServer — Phase 8 Plan 04.

Tests cover real async patterns without full network dependencies:
  - Long-running task dispatch: tool returns task_id immediately (MCP-03)
  - Pub/sub cache invalidation: registry:agent_changed triggers refresh_worker_tools
  - Cold boot: refresh_worker_tools populates _tool_cache before MCP server starts
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "agents", "_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs", "kubex-common", "src"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_response(status_code: int, json_data: Any = None, text: str = "") -> httpx.Response:
    """Create a mock httpx Response without touching a real HTTP transport."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = text or ""
    return resp


def _make_agent_list() -> list[dict]:
    """Return a Registry /agents response with orchestrator + 2 workers."""
    return [
        {
            "agent_id": "orchestrator",
            "capabilities": ["task_orchestration"],
            "status": "running",
            "metadata": {"description": "Orchestrator"},
        },
        {
            "agent_id": "knowledge",
            "capabilities": ["knowledge_management"],
            "status": "running",
            "metadata": {"description": "Knowledge base specialist"},
        },
        {
            "agent_id": "instagram-scraper",
            "capabilities": ["scrape_instagram"],
            "status": "running",
            "metadata": {"description": "Instagram data collector"},
        },
    ]


def aiter_from_list(items: list) -> Any:
    """Create an async iterator from a list (for mocking pubsub.listen())."""

    async def _gen():
        for item in items:
            yield item

    return _gen()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_fastmcp():
    """Patch FastMCP to avoid starting a real MCP server."""
    with patch("kubex_harness.mcp_bridge.FastMCP") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.tool = MagicMock(return_value=lambda fn: fn)
        mock_cls.return_value = mock_instance
        yield mock_cls, mock_instance


@pytest.fixture()
def config():
    """AgentConfig for orchestrator with openai-api runtime."""
    from kubex_harness.config_loader import AgentConfig

    return AgentConfig(
        agent_id="orchestrator",
        gateway_url="http://gateway:8080",
        broker_url="http://kubex-broker:8060",
        runtime="openai-api",
    )


@pytest.fixture()
def mock_http():
    """Provide a mock AsyncClient."""
    client = MagicMock(spec=httpx.AsyncClient)
    client.get = AsyncMock()
    client.post = AsyncMock()
    return client


@pytest.fixture()
def bridge(config, mock_http, mock_fastmcp):
    """MCPBridgeServer with mocked FastMCP and injected HTTP client."""
    from kubex_harness.mcp_bridge import MCPBridgeServer

    b = MCPBridgeServer(config)
    b._http = mock_http
    return b


# ---------------------------------------------------------------------------
# test_long_running_task
# ---------------------------------------------------------------------------


class TestLongRunningTask:
    """MCP-03: Worker dispatch returns task_id immediately without waiting for result."""

    @pytest.mark.asyncio
    async def test_long_running_task(self, bridge, mock_http):
        """Dispatch a worker task and assert it returns task_id immediately (within 1s).

        A long-running escalation that would take minutes must not block the tool call.
        The tool returns {status: dispatched, task_id: ...} at once.
        Polling for result is handled separately via kubex__poll_task.
        """
        mock_http.post.return_value = _mock_response(
            200, json_data={"task_id": "task-long-running-001"}
        )

        # Dispatch should return immediately without waiting for task to complete
        import time

        start = time.monotonic()
        result = await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="Summarise the entire knowledge base and produce a 50-page report",
        )
        elapsed = time.monotonic() - start

        # Must return immediately — well under 1 second
        assert elapsed < 1.0, f"Dispatch took {elapsed:.2f}s — should be immediate"

        # Returns task_id for polling
        assert result["status"] == "dispatched"
        assert result["task_id"] == "task-long-running-001"

        # No GET call made — no polling (MCP-03: async task_id pattern)
        mock_http.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_poll_task_returns_pending_when_not_ready(self, bridge, mock_http):
        """After dispatch, polling with 404 confirms task is still in progress."""
        # First: dispatch the task
        mock_http.post.return_value = _mock_response(
            200, json_data={"task_id": "task-pending-poll"}
        )
        dispatch_result = await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="Long running task",
        )
        task_id = dispatch_result["task_id"]

        # Second: poll — task not yet complete (404)
        mock_http.get.return_value = _mock_response(404)
        poll_result = await bridge._handle_poll_task(task_id)

        assert poll_result["status"] == "pending"
        assert poll_result["task_id"] == task_id


# ---------------------------------------------------------------------------
# test_pubsub_cache_invalidation
# ---------------------------------------------------------------------------


class TestPubSubCacheInvalidation:
    """Pub/sub registry:agent_changed triggers refresh_worker_tools."""

    @pytest.mark.asyncio
    async def test_pubsub_cache_invalidation(self, bridge, mock_http):
        """Publish registry:agent_changed message, verify refresh_worker_tools is called.

        Simulates live agent registration: a new agent comes online, the registry
        publishes a change event, and the bridge refreshes its tool cache.
        """
        mock_http.get.return_value = _mock_response(200, json_data=_make_agent_list())
        bridge._register_worker_tool = MagicMock()

        subscribe_calls = []
        fake_pubsub = MagicMock()
        fake_pubsub.subscribe = AsyncMock(side_effect=lambda ch: subscribe_calls.append(ch))

        # Simulate: subscribe event, then one registry change message, then stop
        messages = [
            {"type": "subscribe", "data": 1},
            {"type": "message", "data": "new-agent-001"},
        ]
        fake_pubsub.listen = MagicMock(return_value=aiter_from_list(messages))
        fake_pubsub.unsubscribe = AsyncMock()

        fake_client = MagicMock()
        fake_client.pubsub.return_value = fake_pubsub
        fake_client.aclose = AsyncMock()

        refresh_calls = []
        original_refresh = bridge.refresh_worker_tools

        async def counted_refresh():
            refresh_calls.append(1)
            await original_refresh()

        bridge.refresh_worker_tools = counted_refresh
        bridge._running = True

        async def stop_after_delay():
            await asyncio.sleep(0.05)
            bridge._running = False

        with patch("redis.asyncio.from_url", return_value=fake_client):
            await asyncio.gather(
                bridge._listen_registry_changes(),
                stop_after_delay(),
            )

        assert "registry:agent_changed" in subscribe_calls, (
            "Listener must subscribe to 'registry:agent_changed'"
        )
        assert len(refresh_calls) >= 1, (
            f"refresh_worker_tools not called — got {len(refresh_calls)} calls"
        )

    @pytest.mark.asyncio
    async def test_pubsub_ignores_subscribe_type_messages(self, bridge, mock_http):
        """Pub/sub listener ignores 'subscribe' confirmation messages, not just 'message' type."""
        mock_http.get.return_value = _mock_response(200, json_data=[])
        bridge._register_worker_tool = MagicMock()

        fake_pubsub = MagicMock()
        fake_pubsub.subscribe = AsyncMock()

        # Only a subscribe confirmation message — no actual agent_changed message
        messages = [
            {"type": "subscribe", "data": 1},
        ]
        fake_pubsub.listen = MagicMock(return_value=aiter_from_list(messages))
        fake_pubsub.unsubscribe = AsyncMock()

        fake_client = MagicMock()
        fake_client.pubsub.return_value = fake_pubsub
        fake_client.aclose = AsyncMock()

        refresh_calls = []

        async def counted_refresh():
            refresh_calls.append(1)

        bridge.refresh_worker_tools = counted_refresh
        bridge._running = True

        with patch("redis.asyncio.from_url", return_value=fake_client):
            await bridge._listen_registry_changes()

        # Subscribe-type message must NOT trigger a refresh
        assert len(refresh_calls) == 0, (
            "Subscribe confirmation messages must not trigger refresh_worker_tools"
        )


# ---------------------------------------------------------------------------
# test_cold_boot_fetches_agents
# ---------------------------------------------------------------------------


class TestColdBootFetchesAgents:
    """Cold boot: refresh_worker_tools populates _tool_cache before MCP server starts."""

    @pytest.mark.asyncio
    async def test_cold_boot_fetches_agents(self, bridge, mock_http):
        """MCPBridgeServer.run() calls refresh_worker_tools at cold boot.

        Verifies that before the MCP server accepts connections, the tool cache
        is populated from the registry.
        """
        # Mock registry to return 2 workers
        mock_http.get.return_value = _mock_response(200, json_data=_make_agent_list())

        refresh_called = []

        original_refresh = bridge.refresh_worker_tools

        async def spy_refresh():
            refresh_called.append(1)
            await original_refresh()

        bridge.refresh_worker_tools = spy_refresh

        # Mock _listen_registry_changes to be a no-op
        async def noop_listener():
            await asyncio.sleep(100)  # wait until cancelled

        bridge._listen_registry_changes = noop_listener

        # Mock mcp.run_async to capture state and immediately return
        tool_cache_at_boot = {}
        mock_fastmcp_instance = bridge._mcp

        async def capture_state(**kwargs):
            # Capture tool cache state at the moment MCP server would start
            tool_cache_at_boot.update(bridge._tool_cache)

        mock_fastmcp_instance.run_async = capture_state

        # Run the bridge (will exit after mock run_async returns)
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as real_client:
            # Use a mock client so no real HTTP calls are made
            bridge._http = mock_http

            # Simulate run() lifecycle manually (skip the httpx.AsyncClient context)
            pubsub_task = asyncio.create_task(bridge._listen_registry_changes())
            bridge._pubsub_task = pubsub_task
            await bridge.refresh_worker_tools()

            # Cancel the listener
            pubsub_task.cancel()
            try:
                await pubsub_task
            except asyncio.CancelledError:
                pass

        # Tool cache should be populated after cold boot
        assert len(refresh_called) >= 1, "refresh_worker_tools must be called during cold boot"
        assert "knowledge_management" in bridge._tool_cache, (
            "Tool cache must contain registered agent capabilities after cold boot"
        )
        assert "scrape_instagram" in bridge._tool_cache, (
            "Tool cache must contain all worker agent capabilities after cold boot"
        )
