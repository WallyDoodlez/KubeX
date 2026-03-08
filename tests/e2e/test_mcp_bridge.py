"""Wave 5A — Spec-Driven E2E Tests for the MCP Bridge + Orchestrator.

These tests encode the EXPECTED behavior of the MCP Bridge as specified in:
  - IMPLEMENTATION-PLAN.md  Wave 5, Stream 5A
  - docs/agents.md          Orchestrator agent, MCP bridge lifecycle
  - docs/gateway.md         Gateway HTTP client, retry/timeout policy

The MCP Bridge is a Model Context Protocol server running inside the
Orchestrator container.  It exposes 11 tools that the OpenClaw agent
runtime calls to interact with the KubexClaw platform:

    dispatch_task, check_task_status, cancel_task,
    subscribe_task_progress, get_task_progress,
    list_agents, query_knowledge, store_knowledge,
    report_result, request_user_input, query_registry

Each tool is a thin shim: it validates inputs, then calls the Gateway
HTTP client, and returns the response to the LLM.

Tests are SKIPPED until Wave 5A implementation lands.  Removing the
skip decorator (or the try/except import guard) is sufficient to
activate them.

External dependencies are fully mocked — no real Gateway network.

Module paths tested:
    agents/orchestrator/mcp_bridge/server.py    (MCPBridgeServer class)
    agents/orchestrator/mcp_bridge/client/gateway.py  (GatewayClient class)
"""

from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup — mirror pattern used in existing e2e tests
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "agents/orchestrator"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common"))

# ---------------------------------------------------------------------------
# Conditional import — skip if Wave 5A not yet implemented.
#
# Once agents/orchestrator/mcp_bridge/server.py and
# agents/orchestrator/mcp_bridge/client/gateway.py land, remove this guard.
# ---------------------------------------------------------------------------
_WAVE5A_IMPLEMENTED = False
try:
    from mcp_bridge.server import MCPBridgeServer  # type: ignore[import]
    from mcp_bridge.client.gateway import GatewayClient  # type: ignore[import]

    _WAVE5A_IMPLEMENTED = True
except ImportError:
    pass

_skip_wave5a = pytest.mark.skipif(
    not _WAVE5A_IMPLEMENTED,
    reason=(
        "Wave 5A not yet implemented — "
        "agents/orchestrator/mcp_bridge/server.py missing"
    ),
)

# ---------------------------------------------------------------------------
# Shared fixture values
# ---------------------------------------------------------------------------

GATEWAY_URL = "http://gateway:8080"
AGENT_ID = "orchestrator"
TASK_ID = "task-abc123"
WORKFLOW_ID = "wf-xyz789"

# The full list of tools the MCP Bridge must expose (spec ref: IMPLEMENTATION-PLAN.md 5A)
EXPECTED_TOOLS = [
    "dispatch_task",
    "check_task_status",
    "cancel_task",
    "subscribe_task_progress",
    "get_task_progress",
    "list_agents",
    "query_knowledge",
    "store_knowledge",
    "report_result",
    "request_user_input",
    "query_registry",
]


def make_server(gateway_url: str = GATEWAY_URL) -> "MCPBridgeServer":
    """Construct an MCPBridgeServer pointed at the given gateway URL."""
    return MCPBridgeServer(gateway_url=gateway_url, agent_id=AGENT_ID)


def make_gateway_client(gateway_url: str = GATEWAY_URL) -> "GatewayClient":
    """Construct a GatewayClient pointed at the given gateway URL."""
    return GatewayClient(base_url=gateway_url, agent_id=AGENT_ID)


# ===========================================================================
# 5A-INIT: MCP Server Initialization
# ===========================================================================


@_skip_wave5a
class TestMCPServerInitialization:
    """Spec ref: IMPLEMENTATION-PLAN.md Stream 5A — MCP Bridge server setup."""

    def test_server_has_correct_name(self) -> None:
        """MCP-INIT-01: MCPBridgeServer has a descriptive server name.

        Spec: 'MCP server initialization and stdio transport'
        The server name is used by OpenClaw to identify the MCP provider.
        """
        server = make_server()
        name = server.name
        assert name is not None
        assert isinstance(name, str)
        assert len(name) > 0
        assert "kubex" in name.lower() or "bridge" in name.lower() or "mcp" in name.lower()

    def test_server_exposes_exactly_11_tools(self) -> None:
        """MCP-INIT-02: MCPBridgeServer registers exactly 11 tools.

        Spec: '11 tools (dispatch_task, check_task_status, cancel_task,
               subscribe_task_progress, get_task_progress, list_agents,
               query_knowledge, store_knowledge, report_result,
               request_user_input, query_registry)'
        """
        server = make_server()
        tools = server.list_tools()
        assert len(tools) == 11, (
            f"Expected 11 tools, got {len(tools)}: {[t.name for t in tools]}"
        )

    def test_server_exposes_all_expected_tool_names(self) -> None:
        """MCP-INIT-03: Each of the 11 expected tool names is registered.

        Spec: MCP tool names must exactly match the skill names in the agent config.
        """
        server = make_server()
        registered = {t.name for t in server.list_tools()}
        for expected in EXPECTED_TOOLS:
            assert expected in registered, f"Missing expected tool: {expected}"

    def test_server_stores_gateway_url(self) -> None:
        """MCP-INIT-04: MCPBridgeServer stores the gateway URL for outbound calls.

        Spec: 'Gateway HTTP client' — all tool calls must route through Gateway.
        """
        server = make_server(gateway_url="http://custom-gateway:9090")
        assert "custom-gateway" in server.gateway_url or "9090" in server.gateway_url

    def test_server_stores_agent_id(self) -> None:
        """MCP-INIT-05: MCPBridgeServer stores the agent_id for request attribution.

        Spec: Gateway requires agent_id in every ActionRequest.
        """
        server = make_server()
        assert server.agent_id == AGENT_ID

    def test_each_tool_has_description(self) -> None:
        """MCP-INIT-06: Every registered tool has a non-empty description.

        Spec: MCP tools must have descriptions so the LLM can select them.
        """
        server = make_server()
        for tool in server.list_tools():
            assert tool.description, f"Tool '{tool.name}' is missing a description"
            assert len(tool.description.strip()) > 10, (
                f"Tool '{tool.name}' description is too short: {tool.description!r}"
            )


# ===========================================================================
# 5A-TOOLS: Individual Tool Calls → Gateway Client
# ===========================================================================


@_skip_wave5a
class TestMCPToolCalls:
    """Spec ref: 'Each tool is a shim that calls the Gateway HTTP client.'"""

    def setup_method(self) -> None:
        self.server = make_server()
        self.mock_gateway = AsyncMock(spec=GatewayClient)

    @pytest.mark.asyncio
    async def test_dispatch_task_calls_gateway_dispatch(self) -> None:
        """MCP-TOOL-01: dispatch_task tool calls gateway.dispatch_task() with correct args.

        Spec: 'dispatch_task — dispatch to worker Kubex by capability'
        The tool must call gateway.dispatch_task(capability=..., context_message=...).
        """
        self.mock_gateway.dispatch_task = AsyncMock(return_value={
            "task_id": TASK_ID,
            "status": "dispatched",
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "dispatch_task",
            {"capability": "scrape_instagram", "context_message": "Scrape Nike profile"},
        )

        self.mock_gateway.dispatch_task.assert_called_once()
        call_kwargs = self.mock_gateway.dispatch_task.call_args.kwargs
        assert call_kwargs.get("capability") == "scrape_instagram"
        assert "task_id" in str(result) or isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_check_task_status_calls_gateway(self) -> None:
        """MCP-TOOL-02: check_task_status tool calls gateway.check_task_status(task_id).

        Spec: 'check_task_status — poll task status by task_id'
        """
        self.mock_gateway.check_task_status = AsyncMock(return_value={
            "task_id": TASK_ID,
            "status": "running",
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool("check_task_status", {"task_id": TASK_ID})

        self.mock_gateway.check_task_status.assert_called_once_with(task_id=TASK_ID)
        assert "status" in str(result) or isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_cancel_task_calls_gateway(self) -> None:
        """MCP-TOOL-03: cancel_task tool calls gateway.cancel_task(task_id, reason).

        Spec: 'cancel_task — cancel a running task via POST /tasks/{id}/cancel'
        """
        self.mock_gateway.cancel_task = AsyncMock(return_value={
            "task_id": TASK_ID,
            "status": "cancel_requested",
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "cancel_task",
            {"task_id": TASK_ID, "reason": "User requested cancellation"},
        )

        self.mock_gateway.cancel_task.assert_called_once()
        call_args = self.mock_gateway.cancel_task.call_args
        assert TASK_ID in str(call_args)

    @pytest.mark.asyncio
    async def test_query_knowledge_calls_gateway(self) -> None:
        """MCP-TOOL-04: query_knowledge tool calls gateway.query_knowledge(query, ...).

        Spec: 'query_knowledge — search knowledge graph via Gateway action endpoint'
        """
        self.mock_gateway.query_knowledge = AsyncMock(return_value={
            "results": [{"entity": "Nike", "facts": ["Founded 1964"]}],
            "total": 1,
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "query_knowledge",
            {"query": "Nike brand history", "entity_types": ["Organization"]},
        )

        self.mock_gateway.query_knowledge.assert_called_once()
        call_kwargs = self.mock_gateway.query_knowledge.call_args.kwargs
        assert "Nike" in call_kwargs.get("query", "")

    @pytest.mark.asyncio
    async def test_store_knowledge_calls_gateway(self) -> None:
        """MCP-TOOL-05: store_knowledge tool calls gateway.store_knowledge(content, summary, source).

        Spec: 'store_knowledge — persist episode to Graphiti + OpenSearch via Gateway'
        """
        self.mock_gateway.store_knowledge = AsyncMock(return_value={
            "nodes_created": 3,
            "edges_created": 2,
            "status": "stored",
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "store_knowledge",
            {
                "content": "Nike has 42 posts on Instagram with avg 15k likes.",
                "summary": "Nike Instagram metrics Q1 2026",
                "source": {"task_id": TASK_ID, "workflow_id": WORKFLOW_ID},
            },
        )

        self.mock_gateway.store_knowledge.assert_called_once()
        call_kwargs = self.mock_gateway.store_knowledge.call_args.kwargs
        assert "content" in call_kwargs or "Nike" in str(call_kwargs)

    @pytest.mark.asyncio
    async def test_list_agents_calls_registry(self) -> None:
        """MCP-TOOL-06: list_agents tool calls gateway.list_agents() to query Registry.

        Spec: 'list_agents — query Registry via Gateway for available Kubexes'
        """
        self.mock_gateway.list_agents = AsyncMock(return_value=[
            {"agent_id": "instagram-scraper", "status": "running", "capabilities": ["scrape_instagram"]},
            {"agent_id": "knowledge", "status": "running", "capabilities": ["knowledge_management"]},
        ])
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool("list_agents", {})

        self.mock_gateway.list_agents.assert_called_once()

    @pytest.mark.asyncio
    async def test_query_registry_with_capability_filter(self) -> None:
        """MCP-TOOL-07: query_registry passes capability filter to gateway.

        Spec: 'query_registry — resolve capability to agent via Registry'
        """
        self.mock_gateway.query_registry = AsyncMock(return_value=[
            {"agent_id": "instagram-scraper", "capabilities": ["scrape_instagram"]},
        ])
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "query_registry",
            {"capability": "scrape_instagram"},
        )

        self.mock_gateway.query_registry.assert_called_once()
        call_kwargs = self.mock_gateway.query_registry.call_args.kwargs
        assert call_kwargs.get("capability") == "scrape_instagram"

    @pytest.mark.asyncio
    async def test_report_result_calls_gateway(self) -> None:
        """MCP-TOOL-08: report_result tool calls gateway.report_result(task_id, status, result).

        Spec: 'report_result — record task outcome to Broker via Gateway'
        """
        self.mock_gateway.report_result = AsyncMock(return_value={"status": "accepted"})
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "report_result",
            {
                "task_id": TASK_ID,
                "status": "success",
                "result": {"records": 42, "output_path": "/data/nike.json"},
            },
        )

        self.mock_gateway.report_result.assert_called_once()
        call_kwargs = self.mock_gateway.report_result.call_args.kwargs
        assert call_kwargs.get("task_id") == TASK_ID
        assert call_kwargs.get("status") == "success"

    @pytest.mark.asyncio
    async def test_subscribe_task_progress_calls_gateway(self) -> None:
        """MCP-TOOL-09: subscribe_task_progress registers an SSE subscription with Gateway.

        Spec: 'subscribe_task_progress — open SSE stream for task progress events'
        """
        self.mock_gateway.subscribe_task_progress = AsyncMock(return_value={
            "subscription_id": "sub-abc123",
            "task_id": TASK_ID,
            "status": "subscribed",
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "subscribe_task_progress",
            {"task_id": TASK_ID},
        )

        self.mock_gateway.subscribe_task_progress.assert_called_once_with(task_id=TASK_ID)

    @pytest.mark.asyncio
    async def test_get_task_progress_calls_gateway(self) -> None:
        """MCP-TOOL-10: get_task_progress retrieves buffered progress chunks from Gateway.

        Spec: 'get_task_progress — retrieve buffered progress chunks for a task'
        """
        self.mock_gateway.get_task_progress = AsyncMock(return_value={
            "task_id": TASK_ID,
            "chunks": ["Processing...", "Step 1 done", "Step 2 done"],
            "final": False,
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "get_task_progress",
            {"task_id": TASK_ID},
        )

        self.mock_gateway.get_task_progress.assert_called_once_with(task_id=TASK_ID)

    @pytest.mark.asyncio
    async def test_request_user_input_calls_gateway_with_timeout(self) -> None:
        """MCP-TOOL-11: request_user_input calls gateway with a configurable timeout.

        Spec: 'request_user_input — pause task and prompt human for clarification'
        The tool must pass the timeout so the Gateway can expire the wait.
        """
        self.mock_gateway.request_user_input = AsyncMock(return_value={
            "status": "pending",
            "request_id": "ui-req-xyz",
            "question": "Which Nike product line should I focus on?",
        })
        self.server.gateway_client = self.mock_gateway

        result = await self.server.call_tool(
            "request_user_input",
            {
                "question": "Which Nike product line should I focus on?",
                "timeout_seconds": 300,
            },
        )

        self.mock_gateway.request_user_input.assert_called_once()
        call_kwargs = self.mock_gateway.request_user_input.call_args.kwargs
        assert "question" in call_kwargs
        assert "timeout" in str(call_kwargs) or "timeout_seconds" in call_kwargs


# ===========================================================================
# 5A-RESULTS: Tool Return Values
# ===========================================================================


@_skip_wave5a
class TestMCPToolReturnValues:
    """Spec ref: 'Tools return structured results that the LLM can consume.'"""

    def setup_method(self) -> None:
        self.server = make_server()
        self.mock_gateway = AsyncMock(spec=GatewayClient)
        self.server.gateway_client = self.mock_gateway

    @pytest.mark.asyncio
    async def test_dispatch_task_returns_task_id_and_status(self) -> None:
        """MCP-RET-01: dispatch_task result contains task_id and status fields.

        Spec: Gateway returns {task_id: str, status: 'dispatched'} on success.
        """
        self.mock_gateway.dispatch_task = AsyncMock(return_value={
            "task_id": TASK_ID,
            "status": "dispatched",
            "capability": "scrape_instagram",
        })

        result = await self.server.call_tool(
            "dispatch_task",
            {"capability": "scrape_instagram", "context_message": "Go"},
        )

        result_str = str(result)
        assert TASK_ID in result_str or "dispatched" in result_str

    @pytest.mark.asyncio
    async def test_check_task_status_returns_status_enum(self) -> None:
        """MCP-RET-02: check_task_status returns a valid status value.

        Spec: Task status values: pending, running, completed, failed, cancelled.
        """
        valid_statuses = {"pending", "running", "completed", "failed", "cancelled"}
        self.mock_gateway.check_task_status = AsyncMock(return_value={
            "task_id": TASK_ID,
            "status": "running",
        })

        result = await self.server.call_tool("check_task_status", {"task_id": TASK_ID})

        result_str = str(result).lower()
        assert any(s in result_str for s in valid_statuses)

    @pytest.mark.asyncio
    async def test_query_knowledge_returns_structured_results(self) -> None:
        """MCP-RET-03: query_knowledge returns a structured list of knowledge results.

        Spec: KnowledgeQueryResult schema — results: list, total: int.
        """
        self.mock_gateway.query_knowledge = AsyncMock(return_value={
            "results": [
                {"entity": "Nike", "summary": "Global sportswear brand", "relevance": 0.95}
            ],
            "total": 1,
        })

        result = await self.server.call_tool(
            "query_knowledge",
            {"query": "Nike brand"},
        )

        result_str = str(result)
        assert "Nike" in result_str or "results" in result_str

    @pytest.mark.asyncio
    async def test_store_knowledge_returns_nodes_and_edges_count(self) -> None:
        """MCP-RET-04: store_knowledge result includes nodes_created and edges_created.

        Spec: Graphiti returns node/edge counts after writing an episode.
        """
        self.mock_gateway.store_knowledge = AsyncMock(return_value={
            "nodes_created": 5,
            "edges_created": 3,
            "status": "stored",
        })

        result = await self.server.call_tool(
            "store_knowledge",
            {"content": "Some knowledge", "summary": "Summary"},
        )

        result_str = str(result)
        assert "nodes_created" in result_str or "5" in result_str or "stored" in result_str

    @pytest.mark.asyncio
    async def test_cancel_task_returns_cancel_confirmation(self) -> None:
        """MCP-RET-05: cancel_task result confirms the cancel was requested.

        Spec: Gateway POST /tasks/{id}/cancel returns {status: 'cancel_requested', task_id}.
        """
        self.mock_gateway.cancel_task = AsyncMock(return_value={
            "task_id": TASK_ID,
            "status": "cancel_requested",
        })

        result = await self.server.call_tool("cancel_task", {"task_id": TASK_ID})

        result_str = str(result)
        assert "cancel" in result_str.lower() or TASK_ID in result_str

    @pytest.mark.asyncio
    async def test_query_knowledge_empty_results_returns_empty_list(self) -> None:
        """MCP-RET-06: query_knowledge with no matches returns empty results, not an error.

        Spec: Empty knowledge results must be distinguishable from errors.
        """
        self.mock_gateway.query_knowledge = AsyncMock(return_value={
            "results": [],
            "total": 0,
        })

        # Should not raise an exception for empty results
        result = await self.server.call_tool(
            "query_knowledge",
            {"query": "obscure query with no match xyz"},
        )

        assert result is not None


# ===========================================================================
# 5A-ERRORS: Error Handling
# ===========================================================================


@_skip_wave5a
class TestMCPBridgeErrorHandling:
    """Spec ref: 'Gateway unreachable → graceful error message to LLM.'"""

    def setup_method(self) -> None:
        self.server = make_server()
        self.mock_gateway = AsyncMock(spec=GatewayClient)
        self.server.gateway_client = self.mock_gateway

    @pytest.mark.asyncio
    async def test_gateway_unreachable_returns_error_message(self) -> None:
        """MCP-ERR-01: When Gateway is unreachable, tool returns an error message (not exception).

        Spec: 'Error handling: gateway unreachable → graceful error message'
        The MCP protocol requires tools to return text, not raise Python exceptions.
        """
        import httpx
        self.mock_gateway.dispatch_task = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        # Should not raise — should return error text
        result = await self.server.call_tool(
            "dispatch_task",
            {"capability": "scrape_instagram", "context_message": "Go"},
        )

        result_str = str(result).lower()
        assert "error" in result_str or "unavailable" in result_str or "failed" in result_str

    @pytest.mark.asyncio
    async def test_missing_required_param_returns_validation_error(self) -> None:
        """MCP-ERR-02: Calling a tool with missing required params returns a validation error.

        Spec: MCP tool input validation — required parameters must be present.
        dispatch_task requires 'capability' and 'context_message'.
        """
        # call_tool should catch missing params and return error, not raise
        result = await self.server.call_tool("dispatch_task", {})

        result_str = str(result).lower()
        assert "error" in result_str or "required" in result_str or "missing" in result_str or "invalid" in result_str

    @pytest.mark.asyncio
    async def test_gateway_500_returns_error_to_llm(self) -> None:
        """MCP-ERR-03: Gateway 500 response is surfaced as an error message to the LLM.

        Spec: 'Error handling: gateway unreachable → graceful error message'
        HTTP 5xx responses from Gateway must not crash the MCP bridge.
        """
        import httpx
        self.mock_gateway.dispatch_task = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "500 Internal Server Error",
                request=MagicMock(),
                response=MagicMock(status_code=500),
            )
        )

        result = await self.server.call_tool(
            "dispatch_task",
            {"capability": "scrape_instagram", "context_message": "Go"},
        )

        result_str = str(result).lower()
        assert "error" in result_str or "500" in result_str or "failed" in result_str


# ===========================================================================
# 5A-CLIENT: GatewayClient HTTP Behavior
# ===========================================================================


@_skip_wave5a
class TestGatewayClientHTTP:
    """Spec ref: 'Gateway HTTP client with retries + error handling (docs/gateway.md 13.9)'."""

    @pytest.mark.asyncio
    async def test_gateway_client_retries_on_503(self) -> None:
        """MCP-CLIENT-01: GatewayClient retries up to 3 times on 503 responses.

        Spec: 'retry on 503 (3 retries)' — transient gateway unavailability must be tolerated.
        """
        import httpx

        call_count = {"n": 0}
        responses = [
            httpx.Response(503, json={"error": "Service Unavailable"}),
            httpx.Response(503, json={"error": "Service Unavailable"}),
            httpx.Response(202, json={"task_id": TASK_ID, "status": "dispatched"}),
        ]

        async def mock_post(*args: Any, **kwargs: Any) -> httpx.Response:
            idx = call_count["n"]
            call_count["n"] += 1
            if idx < len(responses):
                return responses[idx]
            return responses[-1]

        with patch("mcp_bridge.client.gateway.httpx.AsyncClient") as mock_httpx_cls:
            mock_client = AsyncMock()
            mock_client.post = mock_post
            mock_httpx_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx_cls.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client()
            result = await client.dispatch_task(
                capability="scrape_instagram",
                context_message="Scrape Nike",
            )

        assert call_count["n"] == 3, f"Expected 3 attempts (2 retries), got {call_count['n']}"
        assert result.get("task_id") == TASK_ID

    @pytest.mark.asyncio
    async def test_gateway_client_raises_after_max_retries(self) -> None:
        """MCP-CLIENT-02: GatewayClient raises after exhausting all retries.

        Spec: 'retry on 503 (3 retries)' — after 3 retries, raise so caller can handle.
        """
        import httpx

        async def always_503(*args: Any, **kwargs: Any) -> httpx.Response:
            return httpx.Response(503, json={"error": "Overloaded"})

        with patch("mcp_bridge.client.gateway.httpx.AsyncClient") as mock_httpx_cls:
            mock_client = AsyncMock()
            mock_client.post = always_503
            mock_httpx_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx_cls.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client()
            with pytest.raises(Exception):
                await client.dispatch_task(
                    capability="scrape_instagram",
                    context_message="Scrape Nike",
                )

    @pytest.mark.asyncio
    async def test_gateway_client_uses_30s_timeout(self) -> None:
        """MCP-CLIENT-03: GatewayClient configures a 30-second request timeout.

        Spec: 'timeout after 30s' — Gateway must not hang the MCP bridge indefinitely.
        """
        with patch("mcp_bridge.client.gateway.httpx.AsyncClient") as mock_httpx_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(
                return_value=MagicMock(
                    status_code=202,
                    json=MagicMock(return_value={"task_id": TASK_ID, "status": "dispatched"}),
                )
            )
            mock_httpx_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx_cls.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client()
            await client.dispatch_task(
                capability="scrape_instagram",
                context_message="Scrape Nike",
            )

            # Check that httpx was constructed with a timeout
            init_kwargs = mock_httpx_cls.call_args
            timeout_val = (
                init_kwargs.kwargs.get("timeout")
                if init_kwargs and init_kwargs.kwargs
                else None
            )
            if timeout_val is None and init_kwargs and init_kwargs.args:
                timeout_val = init_kwargs.args[0] if init_kwargs.args else None
            assert timeout_val == 30.0 or (
                hasattr(timeout_val, "read") and timeout_val.read == 30.0
            ), f"Expected 30s timeout, got: {timeout_val}"

    def test_gateway_client_stores_base_url(self) -> None:
        """MCP-CLIENT-04: GatewayClient stores the gateway base URL for all requests.

        Spec: 'GATEWAY_URL env var set by Kubex Manager on orchestrator container'
        """
        client = make_gateway_client(gateway_url="http://gateway:9090")
        assert "gateway" in client.base_url or "9090" in client.base_url

    def test_gateway_client_stores_agent_id(self) -> None:
        """MCP-CLIENT-05: GatewayClient stores agent_id for ActionRequest attribution.

        Spec: Every ActionRequest must include the sender's agent_id.
        """
        client = make_gateway_client()
        assert client.agent_id == AGENT_ID
