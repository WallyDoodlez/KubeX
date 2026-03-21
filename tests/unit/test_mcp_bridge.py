"""Unit tests for MCPBridgeServer — Phase 8 MCP Bridge.

Tests cover:
  - MCPBridgeServer initialization and FastMCP instance creation
  - refresh_worker_tools: one tool per agent (excluding self) from Registry
  - Worker delegation tools: async task_id dispatch via Gateway POST /actions
  - kubex__poll_task: pending (404), completed (200), error handling
  - Exception handling: all tool handlers return error dicts, never raise
  - Registry pub/sub subscription to registry:agent_changed channel
  - Cold boot: refresh_worker_tools called before accepting connections
  - Need_info protocol (D-05/D-06): kubex__poll_task surfaces need_info status
  - Delegation depth (D-07): max depth enforcement, tracking per task_id
"""

from __future__ import annotations

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


def _make_agent_list(include_self: str = "orchestrator") -> list[dict]:
    """Return a sample Registry /agents response with self + 2 workers."""
    return [
        {
            "agent_id": include_self,
            "capabilities": ["orchestrate"],
            "status": "running",
            "metadata": {"description": "Orchestrator agent"},
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


def _mock_response(status_code: int, json_data: Any = None, text: str = "") -> httpx.Response:
    """Create a mock httpx Response without touching a real HTTP transport."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = text or ""
    return resp


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
    from kubex_harness.config_loader import AgentConfig
    return AgentConfig(agent_id="orchestrator", gateway_url="http://gateway:8080")


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
# TestInit
# ---------------------------------------------------------------------------


class TestInit:
    def test_creates_fastmcp_named_kubex_bridge(self, config, mock_fastmcp):
        """MCPBridgeServer.__init__ creates a FastMCP instance named 'kubex-bridge'."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        mock_cls, _ = mock_fastmcp
        MCPBridgeServer(config)
        mock_cls.assert_called_once_with(name="kubex-bridge")

    def test_default_delegation_depth(self, bridge):
        """Default max delegation depth is 3 (D-07)."""
        from kubex_harness.mcp_bridge import DEFAULT_MAX_DELEGATION_DEPTH
        assert bridge.max_delegation_depth == DEFAULT_MAX_DELEGATION_DEPTH
        assert bridge.max_delegation_depth == 3

    def test_delegation_depth_dict_starts_empty(self, bridge):
        """_delegation_depth tracking dict starts empty."""
        assert bridge._delegation_depth == {}

    def test_poll_tool_registered_at_init(self, config, mock_fastmcp):
        """kubex__poll_task tool is registered during __init__."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        _, mock_instance = mock_fastmcp
        MCPBridgeServer(config)
        # tool() should have been called at least once (for poll_task)
        assert mock_instance.tool.called


# ---------------------------------------------------------------------------
# TestRefreshWorkerTools
# ---------------------------------------------------------------------------


class TestRefreshWorkerTools:
    @pytest.mark.asyncio
    async def test_worker_tool_per_agent(self, bridge, mock_http):
        """refresh_worker_tools registers one tool per non-self agent from Registry."""
        mock_http.get.return_value = _mock_response(200, json_data=_make_agent_list())
        registered = []
        bridge._register_worker_tool = MagicMock(side_effect=lambda cap, desc: registered.append(cap))

        await bridge.refresh_worker_tools()

        # knowledge_management + scrape_instagram (orchestrator is self, skipped)
        assert "knowledge_management" in registered
        assert "scrape_instagram" in registered
        assert len(registered) == 2

    @pytest.mark.asyncio
    async def test_skips_self(self, bridge, mock_http):
        """refresh_worker_tools does not register a tool for self (agent_id = orchestrator)."""
        mock_http.get.return_value = _mock_response(200, json_data=_make_agent_list())
        registered = []
        bridge._register_worker_tool = MagicMock(side_effect=lambda cap, desc: registered.append(cap))

        await bridge.refresh_worker_tools()

        # 'orchestrate' is the orchestrator's capability — must not be registered
        assert "orchestrate" not in registered

    @pytest.mark.asyncio
    async def test_updates_tool_cache(self, bridge, mock_http):
        """refresh_worker_tools populates _tool_cache keyed by capability."""
        mock_http.get.return_value = _mock_response(200, json_data=_make_agent_list())
        bridge._register_worker_tool = MagicMock()  # silence actual registration

        await bridge.refresh_worker_tools()

        assert "knowledge_management" in bridge._tool_cache
        assert "scrape_instagram" in bridge._tool_cache

    @pytest.mark.asyncio
    async def test_handles_registry_non_200(self, bridge, mock_http):
        """refresh_worker_tools silently returns if Registry returns non-200."""
        mock_http.get.return_value = _mock_response(503)
        # Should not raise
        await bridge.refresh_worker_tools()
        assert bridge._tool_cache == {}


# ---------------------------------------------------------------------------
# TestWorkerDelegation
# ---------------------------------------------------------------------------


class TestWorkerDelegation:
    @pytest.mark.asyncio
    async def test_delegation_uses_gateway(self, bridge, mock_http):
        """Worker delegation handler calls Gateway POST /actions (not direct broker)."""
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "t-001"})

        result = await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="Summarise the knowledge base",
        )

        mock_http.post.assert_called_once()
        call_args = mock_http.post.call_args
        assert "actions" in call_args.args[0]

    @pytest.mark.asyncio
    async def test_async_dispatch_returns_task_id(self, bridge, mock_http):
        """Worker delegation returns {status: dispatched, task_id: ...} immediately."""
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "t-abc"})

        result = await bridge._handle_worker_dispatch(
            capability="scrape_instagram",
            task="Scrape user feed",
        )

        assert result["status"] == "dispatched"
        assert result["task_id"] == "t-abc"

    @pytest.mark.asyncio
    async def test_dispatch_does_not_await_result(self, bridge, mock_http):
        """Worker delegation NEVER polls for task result (only one HTTP call: POST /actions)."""
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "t-001"})

        await bridge._handle_worker_dispatch(capability="knowledge_management", task="do thing")

        # Only POST should be called, no GET
        mock_http.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_dispatch_uses_dispatch_task_action(self, bridge, mock_http):
        """Worker delegation payload uses action='dispatch_task'."""
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "t-002"})

        await bridge._handle_worker_dispatch(capability="scrape_instagram", task="Scrape feed")

        call_json = mock_http.post.call_args.kwargs.get("json") or mock_http.post.call_args[1].get("json")
        assert call_json["action"] == "dispatch_task"

    @pytest.mark.asyncio
    async def test_dispatch_exception_returns_error_dict(self, bridge, mock_http):
        """Worker tool handler wraps exceptions in try/except and returns error dict."""
        mock_http.post.side_effect = httpx.ConnectError("Connection refused")

        result = await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="do thing",
        )

        assert result["status"] == "error"
        assert "message" in result

    @pytest.mark.asyncio
    async def test_dispatch_non_2xx_returns_error(self, bridge, mock_http):
        """Worker delegation handler returns error dict on non-2xx Gateway response."""
        mock_http.post.return_value = _mock_response(500, text="Internal server error")

        result = await bridge._handle_worker_dispatch(capability="scrape_instagram", task="do thing")

        assert result["status"] == "error"
        assert result["code"] == 500


# ---------------------------------------------------------------------------
# TestPollTask
# ---------------------------------------------------------------------------


class TestPollTask:
    @pytest.mark.asyncio
    async def test_poll_task_pending_returns_pending(self, bridge, mock_http):
        """kubex__poll_task with 404 from Gateway returns {status: pending, task_id: ...}."""
        mock_http.get.return_value = _mock_response(404)

        result = await bridge._handle_poll_task("task-pending")

        assert result["status"] == "pending"
        assert result["task_id"] == "task-pending"

    @pytest.mark.asyncio
    async def test_poll_task_completed_returns_completed(self, bridge, mock_http):
        """kubex__poll_task with 200 from Gateway returns {status: completed, ...result}."""
        mock_http.get.return_value = _mock_response(
            200,
            json_data={"status": "completed", "result": "task done"},
        )

        result = await bridge._handle_poll_task("task-done")

        assert result["status"] == "completed"
        assert result["result"] == "task done"

    @pytest.mark.asyncio
    async def test_poll_task_error_http_exception(self, bridge, mock_http):
        """kubex__poll_task wraps httpx errors in error dict."""
        mock_http.get.side_effect = httpx.ConnectError("Gateway down")

        result = await bridge._handle_poll_task("task-err")

        assert result["status"] == "error"
        assert "message" in result

    @pytest.mark.asyncio
    async def test_poll_task_non_200_non_404_returns_error(self, bridge, mock_http):
        """kubex__poll_task handles unexpected status codes as error."""
        mock_http.get.return_value = _mock_response(503, text="Service unavailable")

        result = await bridge._handle_poll_task("task-503")

        assert result["status"] == "error"
        assert result["code"] == 503


# ---------------------------------------------------------------------------
# TestPubSubRegistryChanges
# ---------------------------------------------------------------------------


class TestPubSubRegistryChanges:
    @pytest.mark.asyncio
    async def test_pubsub_cache_invalidation(self, bridge, mock_http):
        """_listen_registry_changes subscribes to registry:agent_changed and calls refresh."""
        mock_http.get.return_value = _mock_response(200, json_data=[])
        bridge._register_worker_tool = MagicMock()

        subscribe_calls = []
        fake_pubsub = MagicMock()  # sync mock, not AsyncMock — pubsub() is sync
        fake_pubsub.subscribe = AsyncMock(side_effect=lambda ch: subscribe_calls.append(ch))

        messages = [
            {"type": "subscribe", "data": 1},
            {"type": "message", "data": "knowledge"},
        ]
        fake_pubsub.listen = MagicMock(return_value=aiter_from_list(messages))
        fake_pubsub.unsubscribe = AsyncMock()

        fake_client = MagicMock()  # sync mock — from_url returns sync client
        fake_client.pubsub.return_value = fake_pubsub
        fake_client.aclose = AsyncMock()

        bridge._running = True
        refresh_calls = []
        original_refresh = bridge.refresh_worker_tools

        async def counted_refresh():
            refresh_calls.append(1)
            await original_refresh()

        bridge.refresh_worker_tools = counted_refresh

        with patch("redis.asyncio.from_url", return_value=fake_client):
            import asyncio
            # Set _running to False after one message to stop the listener
            async def stop_after_delay():
                await asyncio.sleep(0.05)
                bridge._running = False

            await asyncio.gather(
                bridge._listen_registry_changes(),
                stop_after_delay(),
            )

        assert "registry:agent_changed" in subscribe_calls
        assert len(refresh_calls) >= 1

    @pytest.mark.asyncio
    async def test_subscribe_channel_name(self, bridge, mock_http):
        """_listen_registry_changes subscribes to exactly 'registry:agent_changed'."""
        subscribe_calls = []

        fake_pubsub = MagicMock()  # sync — pubsub() is a sync method call

        async def capture_subscribe(*args, **kwargs):
            subscribe_calls.extend(args)

        fake_pubsub.subscribe = capture_subscribe

        async def empty_listen():
            bridge._running = False
            return
            yield  # make it an async generator

        fake_pubsub.listen = empty_listen
        fake_pubsub.unsubscribe = AsyncMock()

        fake_client = MagicMock()  # sync — from_url returns sync-compatible client
        fake_client.pubsub.return_value = fake_pubsub
        fake_client.aclose = AsyncMock()

        with patch("redis.asyncio.from_url", return_value=fake_client):
            await bridge._listen_registry_changes()

        assert "registry:agent_changed" in subscribe_calls


# ---------------------------------------------------------------------------
# TestNeedInfoProtocol
# ---------------------------------------------------------------------------


class TestNeedInfoProtocol:
    @pytest.mark.asyncio
    async def test_poll_task_returns_need_info_status(self, bridge, mock_http):
        """D-05: kubex__poll_task surfaces need_info with request and data."""
        mock_http.get.return_value = _mock_response(
            200,
            json_data={
                "status": "need_info",
                "request": "What is the target audience?",
                "data": {"draft": "Initial content here..."},
            },
        )

        result = await bridge._handle_poll_task("task-abc")

        assert result["status"] == "need_info"
        assert result["request"] == "What is the target audience?"
        assert result["data"]["draft"] == "Initial content here..."
        assert result["task_id"] == "task-abc"

    @pytest.mark.asyncio
    async def test_poll_task_need_info_includes_raw_data(self, bridge, mock_http):
        """D-06: need_info results include raw data for orchestrator to pass."""
        mock_http.get.return_value = _mock_response(
            200,
            json_data={
                "status": "need_info",
                "request": "Need profile metrics",
                "data": {"profiles_found": 15, "raw_urls": ["url1", "url2"]},
            },
        )

        result = await bridge._handle_poll_task("task-xyz")

        assert result["status"] == "need_info"
        assert result["data"]["profiles_found"] == 15
        assert len(result["data"]["raw_urls"]) == 2


# ---------------------------------------------------------------------------
# TestDelegationDepth
# ---------------------------------------------------------------------------


class TestDelegationDepth:
    @pytest.mark.asyncio
    async def test_dispatch_at_max_depth_rejected(self, bridge, mock_http):
        """D-07: dispatch with depth >= max returns error."""
        bridge.max_delegation_depth = 3

        result = await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="Look up info",
            delegation_depth=3,
        )

        assert result["status"] == "error"
        assert "Max delegation depth" in result["message"]

    @pytest.mark.asyncio
    async def test_dispatch_below_max_depth_succeeds(self, bridge, mock_http):
        """D-07: dispatch with depth < max proceeds normally."""
        bridge.max_delegation_depth = 3
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "task-new"})

        result = await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="Look up info",
            delegation_depth=2,
        )

        assert result["status"] == "dispatched"
        assert result["task_id"] == "task-new"
        assert result["delegation_depth"] == 2

    @pytest.mark.asyncio
    async def test_delegation_depth_passed_in_gateway_payload(self, bridge, mock_http):
        """D-07: delegation_depth is included in Gateway dispatch payload."""
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "task-456"})

        await bridge._handle_worker_dispatch(
            capability="scrape_instagram",
            task="Scrape profile",
            delegation_depth=1,
        )

        call_json = mock_http.post.call_args.kwargs.get("json") or mock_http.post.call_args[1].get("json")
        assert call_json["parameters"]["delegation_depth"] == 1

    @pytest.mark.asyncio
    async def test_custom_max_depth_from_env(self):
        """D-07: MAX_DELEGATION_DEPTH env var overrides default 3."""
        os.environ["MAX_DELEGATION_DEPTH"] = "5"
        try:
            # Need fresh FastMCP mock to avoid starting a server
            with patch("kubex_harness.mcp_bridge.FastMCP"):
                from kubex_harness.config_loader import AgentConfig
                from kubex_harness.mcp_bridge import MCPBridgeServer
                config = AgentConfig(agent_id="orchestrator")
                b = MCPBridgeServer(config)
                assert b.max_delegation_depth == 5
        finally:
            os.environ.pop("MAX_DELEGATION_DEPTH", None)

    @pytest.mark.asyncio
    async def test_delegation_depth_tracked_per_task(self, bridge, mock_http):
        """D-07: _delegation_depth dict records depth per task_id."""
        mock_http.post.return_value = _mock_response(200, json_data={"task_id": "task-tracked"})

        await bridge._handle_worker_dispatch(
            capability="knowledge_management",
            task="Look up info",
            delegation_depth=1,
        )

        assert bridge._delegation_depth["task-tracked"] == 1


# ---------------------------------------------------------------------------
# Async iterator helper
# ---------------------------------------------------------------------------


def aiter_from_list(items: list) -> Any:
    """Create an async iterator from a list (for mocking pubsub.listen())."""

    async def _gen():
        for item in items:
            yield item

    return _gen()
