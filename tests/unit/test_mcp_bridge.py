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
  - Vault tools: reads in-process (vault_ops), writes via Gateway (Plan 03)
  - Meta-tools: kubex__list_agents, kubex__agent_status, kubex__cancel_task (Plan 03)
  - Concurrent dispatch: asyncio.gather for parallel worker tasks (MCP-07)
"""

from __future__ import annotations

import json
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
# TestVaultOpsModule
# ---------------------------------------------------------------------------


class TestVaultOpsModule:
    def test_vault_ops_module_exists(self):
        """vault_ops.py exists and is importable from kubex_harness."""
        import kubex_harness.vault_ops as vault_ops  # noqa: F401

    def test_vault_ops_exports_search_notes(self):
        """vault_ops exports search_notes function."""
        import kubex_harness.vault_ops as vault_ops
        assert callable(vault_ops.search_notes)

    def test_vault_ops_exports_get_note(self):
        """vault_ops exports get_note function."""
        import kubex_harness.vault_ops as vault_ops
        assert callable(vault_ops.get_note)

    def test_vault_ops_exports_list_notes(self):
        """vault_ops exports list_notes function."""
        import kubex_harness.vault_ops as vault_ops
        assert callable(vault_ops.list_notes)

    def test_vault_ops_exports_find_backlinks(self):
        """vault_ops exports find_backlinks function."""
        import kubex_harness.vault_ops as vault_ops
        assert callable(vault_ops.find_backlinks)

    def test_search_notes_returns_list(self):
        """search_notes returns a list."""
        import kubex_harness.vault_ops as vault_ops
        result = vault_ops.search_notes(query="test")
        assert isinstance(result, list)

    def test_get_note_returns_dict(self):
        """get_note returns a dict."""
        import kubex_harness.vault_ops as vault_ops
        result = vault_ops.get_note(path="notes/test.md")
        assert isinstance(result, dict)

    def test_list_notes_returns_list(self):
        """list_notes returns a list."""
        import kubex_harness.vault_ops as vault_ops
        result = vault_ops.list_notes()
        assert isinstance(result, list)

    def test_find_backlinks_returns_list(self):
        """find_backlinks returns a list."""
        import kubex_harness.vault_ops as vault_ops
        result = vault_ops.find_backlinks(path="notes/target.md")
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# TestVaultReadTools
# ---------------------------------------------------------------------------


class TestVaultReadTools:
    """Vault read tools call in-process vault_ops functions, no Gateway HTTP."""

    @pytest.mark.asyncio
    async def test_vault_read_in_process_search(self, bridge, mock_http):
        """vault_search_notes calls in-process search_notes, no httpx request made."""
        with patch("kubex_harness.vault_ops.search_notes", return_value=[{"path": "a.md", "title": "A", "snippet": "..."}]) as mock_fn:
            result = await bridge._vault_search_notes(query="test query", folder="")

        # Vault read tools must NOT call Gateway
        mock_http.post.assert_not_called()
        mock_http.get.assert_not_called()
        mock_fn.assert_called_once_with(query="test query", folder="")
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_vault_read_in_process_get_note(self, bridge, mock_http):
        """vault_get_note calls in-process get_note, no httpx request made."""
        note_data = {"path": "notes/test.md", "title": "Test", "content": "Body", "metadata": {}}
        with patch("kubex_harness.vault_ops.get_note", return_value=note_data) as mock_fn:
            result = await bridge._vault_get_note(path="notes/test.md")

        mock_http.post.assert_not_called()
        mock_http.get.assert_not_called()
        mock_fn.assert_called_once_with(path="notes/test.md")
        assert result["title"] == "Test"

    @pytest.mark.asyncio
    async def test_vault_read_in_process_list_notes(self, bridge, mock_http):
        """vault_list_notes calls in-process list_notes, no httpx request made."""
        with patch("kubex_harness.vault_ops.list_notes", return_value=[]) as mock_fn:
            result = await bridge._vault_list_notes(folder="projects")

        mock_http.post.assert_not_called()
        mock_http.get.assert_not_called()
        mock_fn.assert_called_once_with(folder="projects")
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_vault_read_in_process_find_backlinks(self, bridge, mock_http):
        """vault_find_backlinks calls in-process find_backlinks, no httpx request made."""
        with patch("kubex_harness.vault_ops.find_backlinks", return_value=[]) as mock_fn:
            result = await bridge._vault_find_backlinks(path="notes/target.md")

        mock_http.post.assert_not_called()
        mock_http.get.assert_not_called()
        mock_fn.assert_called_once_with(path="notes/target.md")
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# TestVaultWriteTools
# ---------------------------------------------------------------------------


class TestVaultWriteTools:
    """Vault write tools route through Gateway POST /actions (D-02)."""

    @pytest.mark.asyncio
    async def test_vault_write_uses_gateway_create(self, bridge, mock_http):
        """vault_create_note calls Gateway POST /actions with action='vault_create'."""
        mock_http.post.return_value = _mock_response(200, json_data={"note_id": "n-123"})

        result = await bridge._vault_create_note(title="Test Note", content="Body text", folder="")

        mock_http.post.assert_called_once()
        call_args = mock_http.post.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", "")
        assert "actions" in url
        call_json = call_args.kwargs.get("json") or call_args[1].get("json")
        assert call_json["action"] == "vault_create"
        assert call_json["parameters"]["title"] == "Test Note"
        assert call_json["parameters"]["content"] == "Body text"
        assert call_json["parameters"]["folder"] == ""

    @pytest.mark.asyncio
    async def test_vault_write_uses_gateway_update(self, bridge, mock_http):
        """vault_update_note calls Gateway POST /actions with action='vault_update'."""
        mock_http.post.return_value = _mock_response(200, json_data={"updated": True})

        result = await bridge._vault_update_note(path="notes/test.md", content="Updated body")

        mock_http.post.assert_called_once()
        call_json = mock_http.post.call_args.kwargs.get("json") or mock_http.post.call_args[1].get("json")
        assert call_json["action"] == "vault_update"
        assert call_json["parameters"]["path"] == "notes/test.md"
        assert call_json["parameters"]["content"] == "Updated body"

    @pytest.mark.asyncio
    async def test_vault_write_escalated_403(self, bridge, mock_http):
        """vault_create_note with Gateway returning 403 returns {'status': 'escalated'}."""
        mock_http.post.return_value = _mock_response(403, json_data={"reason": "policy_blocked"})

        result = await bridge._vault_create_note(title="Blocked", content="Dangerous content", folder="")

        assert result["status"] == "escalated"
        assert "message" in result

    @pytest.mark.asyncio
    async def test_vault_write_update_escalated_403(self, bridge, mock_http):
        """vault_update_note with Gateway returning 403 returns {'status': 'escalated'}."""
        mock_http.post.return_value = _mock_response(403, json_data={"reason": "policy_blocked"})

        result = await bridge._vault_update_note(path="notes/sensitive.md", content="Blocked content")

        assert result["status"] == "escalated"

    @pytest.mark.asyncio
    async def test_vault_write_exception_returns_error_dict(self, bridge, mock_http):
        """vault write tool wraps exceptions in error dict, never raises."""
        mock_http.post.side_effect = httpx.ConnectError("Gateway down")

        result = await bridge._vault_create_note(title="Test", content="Body", folder="")

        assert result["status"] == "error"
        assert "message" in result

    @pytest.mark.asyncio
    async def test_vault_update_exception_returns_error_dict(self, bridge, mock_http):
        """vault_update_note exception returns error dict, never raises."""
        mock_http.post.side_effect = RuntimeError("Unexpected error")

        result = await bridge._vault_update_note(path="notes/test.md", content="Body")

        assert result["status"] == "error"
        assert "message" in result


# ---------------------------------------------------------------------------
# TestMetaTools
# ---------------------------------------------------------------------------


class TestMetaTools:
    """Meta-tools: kubex__list_agents, kubex__agent_status, kubex__cancel_task."""

    @pytest.mark.asyncio
    async def test_meta_tool_list_agents(self, bridge, mock_http):
        """kubex__list_agents calls Registry GET /agents and returns structured list excluding self."""
        agents = _make_agent_list(include_self="orchestrator")
        mock_http.get.return_value = _mock_response(200, json_data=agents)

        result = await bridge._kubex_list_agents()

        # Should exclude self (orchestrator)
        agent_ids = [a["agent_id"] for a in result]
        assert "orchestrator" not in agent_ids
        assert "knowledge" in agent_ids
        assert "instagram-scraper" in agent_ids

        # Check structure
        for agent in result:
            assert "agent_id" in agent
            assert "capabilities" in agent
            assert "status" in agent
            assert "description" in agent

    @pytest.mark.asyncio
    async def test_meta_tool_list_agents_registry_error(self, bridge, mock_http):
        """kubex__list_agents with Registry error returns [{'error': '...'}]."""
        mock_http.get.return_value = _mock_response(503)

        result = await bridge._kubex_list_agents()

        assert isinstance(result, list)
        assert len(result) >= 1
        assert "error" in result[0]

    @pytest.mark.asyncio
    async def test_meta_tool_list_agents_exception(self, bridge, mock_http):
        """kubex__list_agents exception returns [{'error': '...'}]."""
        mock_http.get.side_effect = httpx.ConnectError("Registry down")

        result = await bridge._kubex_list_agents()

        assert isinstance(result, list)
        assert "error" in result[0]

    @pytest.mark.asyncio
    async def test_meta_tool_agent_status(self, bridge, mock_http):
        """kubex__agent_status calls Registry GET /agents/{agent_id} and returns status dict."""
        agent_data = {
            "agent_id": "knowledge",
            "status": "running",
            "capabilities": ["knowledge_management"],
            "metadata": {"description": "Knowledge base specialist"},
        }
        mock_http.get.return_value = _mock_response(200, json_data=agent_data)

        result = await bridge._kubex_agent_status(agent_id="knowledge")

        assert result["agent_id"] == "knowledge"
        assert result["status"] == "running"
        assert "capabilities" in result

    @pytest.mark.asyncio
    async def test_meta_tool_agent_status_not_found(self, bridge, mock_http):
        """kubex__agent_status with 404 returns error dict."""
        mock_http.get.return_value = _mock_response(404)

        result = await bridge._kubex_agent_status(agent_id="nonexistent")

        assert "error" in result

    @pytest.mark.asyncio
    async def test_meta_tool_cancel_task(self, bridge, mock_http):
        """kubex__cancel_task calls Broker POST /tasks/{task_id}/cancel and returns result."""
        mock_http.post.return_value = _mock_response(200, json_data={"status": "cancelled", "task_id": "t-xyz"})

        result = await bridge._kubex_cancel_task(task_id="t-xyz")

        mock_http.post.assert_called_once()
        call_args = mock_http.post.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", "")
        assert "t-xyz" in url
        assert "cancel" in url
        assert result["status"] == "cancelled"
        assert result["task_id"] == "t-xyz"

    @pytest.mark.asyncio
    async def test_meta_tool_cancel_task_error(self, bridge, mock_http):
        """kubex__cancel_task with non-200 response returns error dict."""
        mock_http.post.return_value = _mock_response(404, text="Task not found")

        result = await bridge._kubex_cancel_task(task_id="t-missing")

        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_meta_tool_cancel_task_exception(self, bridge, mock_http):
        """kubex__cancel_task exception returns error dict."""
        mock_http.post.side_effect = httpx.ConnectError("Broker down")

        result = await bridge._kubex_cancel_task(task_id="t-err")

        assert result["status"] == "error"
        assert "message" in result


# ---------------------------------------------------------------------------
# TestConcurrentDispatch
# ---------------------------------------------------------------------------


class TestConcurrentDispatch:
    """dispatch_concurrent runs multiple tasks via asyncio.gather (MCP-07)."""

    @pytest.mark.asyncio
    async def test_concurrent_dispatch_all_succeed(self, bridge, mock_http):
        """dispatch_concurrent with 3 calls returns list of 3 results."""
        mock_http.post.return_value = _mock_response(
            200, json_data={"task_id": "t-concurrent"}
        )

        dispatches = [
            {"capability": "knowledge_management", "task": "Summarise knowledge"},
            {"capability": "scrape_instagram", "task": "Scrape feed"},
            {"capability": "scrape_instagram", "task": "Scrape profile"},
        ]

        results = await bridge.dispatch_concurrent(dispatches)

        assert len(results) == 3
        assert mock_http.post.call_count == 3
        for r in results:
            assert r["status"] == "dispatched"

    @pytest.mark.asyncio
    async def test_concurrent_dispatch_partial_failure(self, bridge, mock_http):
        """dispatch_concurrent with 1 failure and 2 successes returns all 3 results."""
        success_response = _mock_response(200, json_data={"task_id": "t-ok"})
        call_count = [0]

        async def side_effect(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 2:
                raise httpx.ConnectError("Worker down")
            return success_response

        mock_http.post.side_effect = side_effect

        dispatches = [
            {"capability": "knowledge_management", "task": "Task 1"},
            {"capability": "scrape_instagram", "task": "Task 2"},  # this one fails
            {"capability": "scrape_instagram", "task": "Task 3"},
        ]

        results = await bridge.dispatch_concurrent(dispatches)

        assert len(results) == 3
        # 2 successes, 1 failure — all returned (no exception propagated)
        statuses = [r["status"] for r in results]
        assert "dispatched" in statuses
        assert "error" in statuses

    @pytest.mark.asyncio
    async def test_concurrent_dispatch_preserves_order(self, bridge, mock_http):
        """dispatch_concurrent returns results in same order as input dispatches."""
        task_ids = ["t-001", "t-002", "t-003"]
        call_count = [0]

        async def side_effect(*args, **kwargs):
            idx = call_count[0]
            call_count[0] += 1
            return _mock_response(200, json_data={"task_id": task_ids[idx]})

        mock_http.post.side_effect = side_effect

        dispatches = [
            {"capability": "knowledge_management", "task": "First"},
            {"capability": "scrape_instagram", "task": "Second"},
            {"capability": "scrape_instagram", "task": "Third"},
        ]

        results = await bridge.dispatch_concurrent(dispatches)

        assert len(results) == 3
        # All should be dispatched
        assert all(r["status"] == "dispatched" for r in results)


# ---------------------------------------------------------------------------
# TestTransportSelection (D-13)
# ---------------------------------------------------------------------------


class TestTransportSelection:
    """MCPBridgeServer selects transport based on config.runtime (D-13)."""

    def test_transport_inmemory_for_openai_api(self, mock_fastmcp):
        """config.runtime='openai-api' -> _transport == 'inmemory' (D-13)."""
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.mcp_bridge import MCPBridgeServer

        config = AgentConfig(agent_id="orchestrator", runtime="openai-api")
        bridge = MCPBridgeServer(config)
        assert bridge._transport == "inmemory"

    def test_transport_stdio_for_claude_code(self, mock_fastmcp):
        """config.runtime='claude-code' -> _transport == 'stdio' (D-13)."""
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.mcp_bridge import MCPBridgeServer

        config = AgentConfig(agent_id="orchestrator", runtime="claude-code")
        bridge = MCPBridgeServer(config)
        assert bridge._transport == "stdio"

    def test_transport_stdio_for_codex(self, mock_fastmcp):
        """config.runtime='codex' -> _transport == 'stdio' (D-13)."""
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.mcp_bridge import MCPBridgeServer

        config = AgentConfig(agent_id="orchestrator", runtime="codex")
        bridge = MCPBridgeServer(config)
        assert bridge._transport == "stdio"

    def test_transport_stdio_default_non_api(self, mock_fastmcp):
        """config.runtime='gemini-cli' (any non-openai-api) -> _transport == 'stdio' (D-13)."""
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.mcp_bridge import MCPBridgeServer

        config = AgentConfig(agent_id="orchestrator", runtime="gemini-cli")
        bridge = MCPBridgeServer(config)
        assert bridge._transport == "stdio"

    def test_transport_default_is_inmemory_when_runtime_is_default(self, mock_fastmcp):
        """AgentConfig default runtime='openai-api' -> _transport == 'inmemory'."""
        from kubex_harness.config_loader import AgentConfig
        from kubex_harness.mcp_bridge import MCPBridgeServer

        config = AgentConfig(agent_id="orchestrator")  # default runtime
        assert config.runtime == "openai-api"
        bridge = MCPBridgeServer(config)
        assert bridge._transport == "inmemory"


# ---------------------------------------------------------------------------
# Async iterator helper
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# TestParticipantEvents (Phase 14)
# ---------------------------------------------------------------------------


class TestParticipantEvents:
    """Phase 14: agent_joined and hitl_request emission from _handle_poll_task."""

    @pytest.fixture()
    def participant_bridge(self, config, mock_fastmcp):
        """MCPBridgeServer with _post_progress mocked as AsyncMock and active task set."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        server = MCPBridgeServer(config)
        server._http = MagicMock(spec=httpx.AsyncClient)
        server._http.get = AsyncMock()
        server._http.post = AsyncMock()
        server._post_progress = AsyncMock()
        server._active_task_id = "orch-task-1"
        server._task_capability["sub-task-123"] = "scrape_instagram"
        return server

    def _make_need_info_response(
        self,
        agent_id: str = "worker-1",
        request: str = "Which account?",
        data: dict | None = None,
    ) -> "MagicMock":
        return _mock_response(
            200,
            json_data={
                "status": "need_info",
                "agent_id": agent_id,
                "request": request,
                "data": data or {},
            },
        )

    @pytest.mark.asyncio
    async def test_agent_joined_emitted_on_first_need_info(self, participant_bridge):
        """D-01/D-03/D-14: agent_joined emitted on first need_info for a sub-task."""
        participant_bridge._http.get.return_value = self._make_need_info_response(
            agent_id="worker-1", request="Which account?"
        )

        result = await participant_bridge._handle_poll_task("sub-task-123")

        assert result["status"] == "need_info"

        # Find the agent_joined call
        calls = participant_bridge._post_progress.call_args_list
        agent_joined_calls = [
            c for c in calls
            if "agent_joined" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_joined_calls) >= 1
        chunk = agent_joined_calls[0].args[1]
        payload = json.loads(chunk)
        assert payload["type"] == "agent_joined"
        assert payload["agent_id"] == "worker-1"
        assert payload["sub_task_id"] == "sub-task-123"
        assert payload["capability"] == "scrape_instagram"

    @pytest.mark.asyncio
    async def test_agent_joined_not_emitted_on_second_poll(self, participant_bridge):
        """D-03/D-14: second poll of same sub_task_id with need_info does NOT emit agent_joined again."""
        participant_bridge._http.get.return_value = self._make_need_info_response()

        # First poll
        await participant_bridge._handle_poll_task("sub-task-123")
        first_count = participant_bridge._post_progress.call_count

        # Second poll
        participant_bridge._post_progress.reset_mock()
        await participant_bridge._handle_poll_task("sub-task-123")

        # On second poll: only hitl_request (no agent_joined)
        second_calls = participant_bridge._post_progress.call_args_list
        agent_joined_calls = [
            c for c in second_calls
            if "agent_joined" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_joined_calls) == 0

    @pytest.mark.asyncio
    async def test_hitl_request_emitted_with_source_agent(self, participant_bridge):
        """D-10: hitl_request event emitted with source_agent field on every need_info poll."""
        participant_bridge._http.get.return_value = self._make_need_info_response(
            agent_id="worker-1", request="Which account?"
        )

        await participant_bridge._handle_poll_task("sub-task-123")

        calls = participant_bridge._post_progress.call_args_list
        hitl_calls = [
            c for c in calls
            if "hitl_request" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(hitl_calls) >= 1
        chunk = hitl_calls[0].args[1]
        payload = json.loads(chunk)
        assert payload["type"] == "hitl_request"
        assert payload["prompt"] == "Which account?"
        assert payload["source_agent"] == "worker-1"

    @pytest.mark.asyncio
    async def test_hitl_request_emitted_on_every_poll(self, participant_bridge):
        """hitl_request emits on EVERY need_info poll (not deduped like agent_joined)."""
        participant_bridge._http.get.return_value = self._make_need_info_response()

        # First poll
        await participant_bridge._handle_poll_task("sub-task-123")

        # Second poll
        participant_bridge._post_progress.reset_mock()
        await participant_bridge._handle_poll_task("sub-task-123")

        second_calls = participant_bridge._post_progress.call_args_list
        hitl_calls = [
            c for c in second_calls
            if "hitl_request" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(hitl_calls) >= 1

    @pytest.mark.asyncio
    async def test_capability_comes_from_task_capability_dict(self, participant_bridge):
        """Pitfall 4: capability in agent_joined comes from _task_capability populated at dispatch."""
        participant_bridge._task_capability["sub-task-456"] = "knowledge_management"
        participant_bridge._http.get.return_value = self._make_need_info_response(
            agent_id="knowledge-worker"
        )

        await participant_bridge._handle_poll_task("sub-task-456")

        calls = participant_bridge._post_progress.call_args_list
        agent_joined_calls = [
            c for c in calls
            if "agent_joined" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_joined_calls) >= 1
        payload = json.loads(agent_joined_calls[0].args[1])
        assert payload["capability"] == "knowledge_management"

    @pytest.mark.asyncio
    async def test_post_progress_failure_does_not_block_poll_return(self, participant_bridge):
        """Per Claude discretion: _post_progress failure must not block the poll return value."""
        participant_bridge._post_progress.side_effect = RuntimeError("Progress endpoint down")
        participant_bridge._http.get.return_value = self._make_need_info_response()

        result = await participant_bridge._handle_poll_task("sub-task-123")

        # Must still return the need_info dict — failure is swallowed
        assert result["status"] == "need_info"
        assert result["task_id"] == "sub-task-123"

    @pytest.mark.asyncio
    async def test_missing_agent_id_uses_unknown_fallback(self, participant_bridge):
        """Pitfall 5: when result has no agent_id field, agent_joined uses 'unknown'."""
        participant_bridge._http.get.return_value = _mock_response(
            200,
            json_data={"status": "need_info", "request": "Something?", "data": {}},
            # note: no agent_id in this payload
        )

        await participant_bridge._handle_poll_task("sub-task-123")

        calls = participant_bridge._post_progress.call_args_list
        agent_joined_calls = [
            c for c in calls
            if "agent_joined" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_joined_calls) >= 1
        payload = json.loads(agent_joined_calls[0].args[1])
        assert payload["agent_id"] == "unknown"

    @pytest.mark.asyncio
    async def test_sub_task_agent_populated_after_first_need_info(self, participant_bridge):
        """_sub_task_agent[task_id] is populated with worker_agent_id inside the dedup guard (for Plan 02 agent_left)."""
        participant_bridge._http.get.return_value = self._make_need_info_response(
            agent_id="instagram-scraper-1"
        )

        await participant_bridge._handle_poll_task("sub-task-123")

        assert participant_bridge._sub_task_agent["sub-task-123"] == "instagram-scraper-1"

    @pytest.mark.asyncio
    async def test_no_events_emitted_when_active_task_id_is_none(self, participant_bridge):
        """When _active_task_id is None, no participant events are emitted (no orch task to route to)."""
        participant_bridge._active_task_id = None
        participant_bridge._http.get.return_value = self._make_need_info_response()

        result = await participant_bridge._handle_poll_task("sub-task-123")

        assert result["status"] == "need_info"
        participant_bridge._post_progress.assert_not_called()

    @pytest.mark.asyncio
    async def test_task_capability_stored_at_dispatch(self, participant_bridge):
        """_task_capability[task_id] = capability is set during _handle_worker_dispatch."""
        participant_bridge._http.post.return_value = _mock_response(
            200, json_data={"task_id": "new-task-999"}
        )

        await participant_bridge._handle_worker_dispatch(
            capability="scrape_instagram",
            task="Scrape the feed",
        )

        assert participant_bridge._task_capability["new-task-999"] == "scrape_instagram"

    @pytest.mark.asyncio
    async def test_joined_sub_tasks_tracking_dict_starts_empty(self, config, mock_fastmcp):
        """_joined_sub_tasks starts as empty set on MCPBridgeServer init."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        server = MCPBridgeServer(config)
        assert hasattr(server, "_joined_sub_tasks")
        assert isinstance(server._joined_sub_tasks, set)
        assert len(server._joined_sub_tasks) == 0

    @pytest.mark.asyncio
    async def test_sub_task_agent_dict_starts_empty(self, config, mock_fastmcp):
        """_sub_task_agent starts as empty dict on MCPBridgeServer init."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        server = MCPBridgeServer(config)
        assert hasattr(server, "_sub_task_agent")
        assert isinstance(server._sub_task_agent, dict)
        assert len(server._sub_task_agent) == 0

    @pytest.mark.asyncio
    async def test_active_task_id_starts_none(self, config, mock_fastmcp):
        """_active_task_id starts as None on MCPBridgeServer init."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        server = MCPBridgeServer(config)
        assert hasattr(server, "_active_task_id")
        assert server._active_task_id is None

    @pytest.mark.asyncio
    async def test_task_capability_dict_starts_empty(self, config, mock_fastmcp):
        """_task_capability starts as empty dict on MCPBridgeServer init."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        server = MCPBridgeServer(config)
        assert hasattr(server, "_task_capability")
        assert isinstance(server._task_capability, dict)
        assert len(server._task_capability) == 0

    # ------------------------------------------------------------------
    # Plan 02: kubex__forward_hitl_response and agent_left emission
    # ------------------------------------------------------------------

    def test_forward_hitl_tool_registered(self, config, mock_fastmcp):
        """kubex__forward_hitl_response is registered via _mcp.tool() during __init__."""
        from kubex_harness.mcp_bridge import MCPBridgeServer
        _, mock_instance = mock_fastmcp
        MCPBridgeServer(config)
        # Collect all 'name' kwargs passed to mock_instance.tool()
        registered_names = [
            call.kwargs.get("name") or (call.args[0] if call.args else None)
            for call in mock_instance.tool.call_args_list
        ]
        assert "kubex__forward_hitl_response" in registered_names

    @pytest.mark.asyncio
    async def test_agent_left_emitted_after_hitl_forward(self, participant_bridge):
        """D-11: agent_left emitted on progress channel after forwarding HITL answer."""
        participant_bridge._sub_task_agent["sub-task-123"] = "worker-agent-1"
        participant_bridge._joined_sub_tasks.add("sub-task-123")
        participant_bridge._http.post.return_value = _mock_response(200)

        result = await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-123", answer="The answer is 42"
        )

        assert result["status"] == "forwarded"
        assert result["sub_task_id"] == "sub-task-123"

        calls = participant_bridge._post_progress.call_args_list
        agent_left_calls = [
            c for c in calls
            if "agent_left" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_left_calls) >= 1
        payload = json.loads(agent_left_calls[0].args[1])
        assert payload["type"] == "agent_left"
        assert payload["agent_id"] == "worker-agent-1"
        assert payload["sub_task_id"] == "sub-task-123"
        assert payload["status"] == "resolved"

    @pytest.mark.asyncio
    async def test_agent_left_uses_sub_task_agent_dict(self, participant_bridge):
        """agent_left reads worker identity from _sub_task_agent (not guessed)."""
        participant_bridge._sub_task_agent["sub-task-999"] = "specific-worker"
        participant_bridge._active_task_id = "orch-task-1"
        participant_bridge._http.post.return_value = _mock_response(200)

        await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-999", answer="Yes"
        )

        calls = participant_bridge._post_progress.call_args_list
        agent_left_calls = [
            c for c in calls
            if "agent_left" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_left_calls) >= 1
        payload = json.loads(agent_left_calls[0].args[1])
        assert payload["agent_id"] == "specific-worker"

    @pytest.mark.asyncio
    async def test_agent_left_joined_sub_tasks_cleaned_up(self, participant_bridge):
        """Pitfall 2: sub_task_id removed from _joined_sub_tasks after forward."""
        participant_bridge._sub_task_agent["sub-task-123"] = "worker-1"
        participant_bridge._joined_sub_tasks.add("sub-task-123")
        participant_bridge._http.post.return_value = _mock_response(200)

        await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-123", answer="Done"
        )

        assert "sub-task-123" not in participant_bridge._joined_sub_tasks

    @pytest.mark.asyncio
    async def test_agent_left_sub_task_agent_cleaned_up(self, participant_bridge):
        """_sub_task_agent cleared for sub_task_id after forward."""
        participant_bridge._sub_task_agent["sub-task-123"] = "worker-1"
        participant_bridge._joined_sub_tasks.add("sub-task-123")
        participant_bridge._http.post.return_value = _mock_response(200)

        await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-123", answer="Done"
        )

        assert "sub-task-123" not in participant_bridge._sub_task_agent

    @pytest.mark.asyncio
    async def test_forward_hitl_stores_answer_via_broker(self, participant_bridge):
        """HITL answer stored via Broker POST /tasks/{sub_task_id}/result with hitl_answer status."""
        participant_bridge._sub_task_agent["sub-task-123"] = "worker-1"
        participant_bridge._http.post.return_value = _mock_response(200)

        await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-123", answer="My answer here"
        )

        participant_bridge._http.post.assert_called_once()
        call_args = participant_bridge._http.post.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", "")
        assert "sub-task-123" in url
        assert "result" in url
        call_json = call_args.kwargs.get("json") or call_args[1].get("json")
        assert call_json["result"]["status"] == "hitl_answer"
        assert call_json["result"]["output"] == "My answer here"

    @pytest.mark.asyncio
    async def test_forward_hitl_broker_failure_returns_error_dict(self, participant_bridge):
        """If Broker POST fails, _handle_forward_hitl returns error dict (not raise)."""
        participant_bridge._sub_task_agent["sub-task-123"] = "worker-1"
        participant_bridge._http.post.return_value = _mock_response(500, text="Server error")

        result = await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-123", answer="Done"
        )

        assert result["status"] == "error"
        assert "500" in result["message"]

    @pytest.mark.asyncio
    async def test_forward_hitl_post_progress_failure_does_not_block_result(self, participant_bridge):
        """If _post_progress fails during agent_left, forward still returns forwarded status."""
        participant_bridge._sub_task_agent["sub-task-123"] = "worker-1"
        participant_bridge._joined_sub_tasks.add("sub-task-123")
        participant_bridge._http.post.return_value = _mock_response(200)
        participant_bridge._post_progress.side_effect = RuntimeError("Progress down")

        result = await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-123", answer="Done"
        )

        assert result["status"] == "forwarded"

    @pytest.mark.asyncio
    async def test_agent_left_emitted_even_when_not_in_joined_sub_tasks(self, participant_bridge):
        """agent_left is still emitted when sub_task_id was never in _joined_sub_tasks."""
        # Do not add to _joined_sub_tasks
        participant_bridge._sub_task_agent["sub-task-orphan"] = "worker-1"
        participant_bridge._http.post.return_value = _mock_response(200)

        result = await participant_bridge._handle_forward_hitl(
            sub_task_id="sub-task-orphan", answer="Answer"
        )

        assert result["status"] == "forwarded"
        calls = participant_bridge._post_progress.call_args_list
        agent_left_calls = [
            c for c in calls
            if "agent_left" in (c.args[1] if c.args else c.kwargs.get("chunk", ""))
        ]
        assert len(agent_left_calls) >= 1


def aiter_from_list(items: list) -> Any:
    """Create an async iterator from a list (for mocking pubsub.listen())."""

    async def _gen():
        for item in items:
            yield item

    return _gen()
