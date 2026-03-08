"""MCP Bridge Server — Model Context Protocol server for the KubexClaw orchestrator.

Implements Stream 5A:
  - MCPBridgeServer class exposing 11 tools to the OpenClaw LLM runtime
  - Each tool validates inputs and delegates to GatewayClient
  - Error handling: network failures are caught and returned as error text
  - All tools registered at construction time for synchronous list_tools() access

Tools exposed:
    dispatch_task, check_task_status, cancel_task,
    subscribe_task_progress, get_task_progress,
    list_agents, query_knowledge, store_knowledge,
    report_result, request_user_input, query_registry

OpenClaw connects to this server via stdio transport configured in mcp.json:
    {
        "mcpServers": {
            "kubex": {
                "command": "python",
                "args": ["-m", "mcp_bridge.server"],
                "transport": "stdio"
            }
        }
    }
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import httpx

from .client.gateway import GatewayClient


# ---------------------------------------------------------------------------
# Tool descriptor (minimal, without requiring the full MCP SDK)
# ---------------------------------------------------------------------------


@dataclass
class ToolDescriptor:
    """Describes an MCP tool (name + description + input schema)."""

    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# MCPBridgeServer
# ---------------------------------------------------------------------------


class MCPBridgeServer:
    """MCP Bridge server that exposes KubexClaw Gateway operations as MCP tools.

    This server is consumed by the OpenClaw agent runtime via stdio transport.
    Each registered tool maps to a GatewayClient method.

    Usage::

        server = MCPBridgeServer(gateway_url="http://gateway:8080", agent_id="orchestrator")
        # In production: run as stdio MCP server via the 'mcp' package
        # In tests: call server.call_tool(name, args) directly
    """

    SERVER_NAME = "kubex-mcp-bridge"

    def __init__(self, gateway_url: str, agent_id: str) -> None:
        self.gateway_url = gateway_url
        self.agent_id = agent_id
        self.gateway_client: GatewayClient = GatewayClient(
            base_url=gateway_url,
            agent_id=agent_id,
        )
        self._tools: list[ToolDescriptor] = []
        self._register_tools()

    @property
    def name(self) -> str:
        return self.SERVER_NAME

    # ------------------------------------------------------------------
    # Tool registration
    # ------------------------------------------------------------------

    def _register_tools(self) -> None:
        """Register all 11 MCP tools at construction time."""
        self._tools = [
            ToolDescriptor(
                name="dispatch_task",
                description=(
                    "Dispatch a subtask to a worker Kubex by capability. "
                    "Returns task_id and status once the task is queued."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "capability": {
                            "type": "string",
                            "description": "The capability identifier to resolve (e.g. 'scrape_instagram')",
                        },
                        "context_message": {
                            "type": "string",
                            "description": "The task instruction for the worker agent",
                        },
                        "workflow_id": {
                            "type": "string",
                            "description": "Optional workflow ID for task grouping",
                        },
                    },
                    "required": ["capability", "context_message"],
                },
            ),
            ToolDescriptor(
                name="check_task_status",
                description=(
                    "Poll the status of a dispatched task by task_id. "
                    "Returns status: pending, running, completed, failed, or cancelled."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The task ID to query"},
                    },
                    "required": ["task_id"],
                },
            ),
            ToolDescriptor(
                name="cancel_task",
                description=(
                    "Cancel a running task via the Gateway. "
                    "Only the originating agent can cancel a task."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The task ID to cancel"},
                        "reason": {"type": "string", "description": "Optional reason for cancellation"},
                    },
                    "required": ["task_id"],
                },
            ),
            ToolDescriptor(
                name="subscribe_task_progress",
                description=(
                    "Open an SSE subscription for real-time task progress events. "
                    "Returns subscription metadata and stream URL."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The task ID to subscribe to"},
                    },
                    "required": ["task_id"],
                },
            ),
            ToolDescriptor(
                name="get_task_progress",
                description=(
                    "Retrieve buffered progress chunks for a task from the Gateway. "
                    "Returns chunks list and whether the task has finalised."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The task ID to retrieve progress for"},
                    },
                    "required": ["task_id"],
                },
            ),
            ToolDescriptor(
                name="list_agents",
                description=(
                    "List all registered agent Kubexes and their capabilities "
                    "by querying the Registry via the Gateway."
                ),
                input_schema={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            ),
            ToolDescriptor(
                name="query_knowledge",
                description=(
                    "Search the KubexClaw knowledge graph (Graphiti) for relevant information. "
                    "Supports natural language queries, entity type filtering, and temporal queries."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Natural language query to search the knowledge graph",
                        },
                        "entity_types": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional entity type filters (e.g. ['Organization', 'Person'])",
                        },
                        "as_of": {
                            "type": "string",
                            "description": "ISO 8601 timestamp for point-in-time (temporal) queries",
                        },
                    },
                    "required": ["query"],
                },
            ),
            ToolDescriptor(
                name="store_knowledge",
                description=(
                    "Persist new knowledge to the knowledge graph (Graphiti) and "
                    "document corpus (OpenSearch) via two-step ingestion through the Gateway."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The full content/episode to store",
                        },
                        "summary": {
                            "type": "string",
                            "description": "Brief summary of the knowledge for indexing",
                        },
                        "source": {
                            "type": "object",
                            "description": "Source metadata (task_id, workflow_id, url)",
                        },
                    },
                    "required": ["content", "summary"],
                },
            ),
            ToolDescriptor(
                name="report_result",
                description=(
                    "Record the outcome of a delegated task back to the Broker via the Gateway. "
                    "Call this when the orchestrator has received and validated a worker's result."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The task ID being reported"},
                        "status": {
                            "type": "string",
                            "description": "Outcome: 'success', 'failed', or 'cancelled'",
                        },
                        "result": {
                            "type": "object",
                            "description": "Structured result data from the task",
                        },
                    },
                    "required": ["task_id", "status"],
                },
            ),
            ToolDescriptor(
                name="request_user_input",
                description=(
                    "Pause the current task and request a human operator to provide clarification "
                    "or additional information. The Gateway holds the task open until the timeout."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "question": {
                            "type": "string",
                            "description": "The question or prompt for the human operator",
                        },
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "Maximum seconds to wait for human input (default: 300)",
                            "default": 300,
                        },
                    },
                    "required": ["question"],
                },
            ),
            ToolDescriptor(
                name="query_registry",
                description=(
                    "Resolve a capability to one or more available agent Kubexes "
                    "by querying the Registry via the Gateway."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "capability": {
                            "type": "string",
                            "description": "The capability to resolve (e.g. 'scrape_instagram')",
                        },
                    },
                    "required": ["capability"],
                },
            ),
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_tools(self) -> list[ToolDescriptor]:
        """Return all registered MCP tools."""
        return list(self._tools)

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any] | str | list[Any]:
        """Dispatch a tool call by name.

        Validates required parameters, delegates to GatewayClient, and
        catches all exceptions to return error messages (not raise).
        The MCP protocol requires tools to return text, not exceptions.

        Args:
            name: Tool name (must match a registered tool).
            arguments: Tool arguments dict from the LLM.

        Returns:
            Tool result (dict, list, or str).  Errors returned as str.
        """
        handler = self._get_handler(name)
        if handler is None:
            return f"error: unknown tool '{name}'"

        # Validate required parameters
        tool_def = next((t for t in self._tools if t.name == name), None)
        if tool_def:
            required = tool_def.input_schema.get("required", [])
            missing = [k for k in required if k not in arguments or arguments[k] is None]
            if missing:
                return (
                    f"error: missing required parameters for '{name}': {missing}"
                )

        try:
            return await handler(arguments)
        except httpx.ConnectError as exc:
            return f"error: gateway unavailable — {exc}"
        except httpx.HTTPStatusError as exc:
            return f"error: gateway returned {exc.response.status_code} — {exc}"
        except Exception as exc:
            return f"error: tool '{name}' failed — {exc}"

    # ------------------------------------------------------------------
    # Private: per-tool handlers
    # ------------------------------------------------------------------

    def _get_handler(self, name: str):  # type: ignore[return]
        return {
            "dispatch_task": self._dispatch_task,
            "check_task_status": self._check_task_status,
            "cancel_task": self._cancel_task,
            "subscribe_task_progress": self._subscribe_task_progress,
            "get_task_progress": self._get_task_progress,
            "list_agents": self._list_agents,
            "query_knowledge": self._query_knowledge,
            "store_knowledge": self._store_knowledge,
            "report_result": self._report_result,
            "request_user_input": self._request_user_input,
            "query_registry": self._query_registry,
        }.get(name)

    async def _dispatch_task(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.dispatch_task(
            capability=args["capability"],
            context_message=args["context_message"],
            workflow_id=args.get("workflow_id"),
        )

    async def _check_task_status(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.check_task_status(task_id=args["task_id"])

    async def _cancel_task(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.cancel_task(
            task_id=args["task_id"],
            reason=args.get("reason", ""),
        )

    async def _subscribe_task_progress(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.subscribe_task_progress(task_id=args["task_id"])

    async def _get_task_progress(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.get_task_progress(task_id=args["task_id"])

    async def _list_agents(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        return await self.gateway_client.list_agents()

    async def _query_knowledge(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.query_knowledge(
            query=args["query"],
            entity_types=args.get("entity_types"),
            as_of=args.get("as_of"),
        )

    async def _store_knowledge(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.store_knowledge(
            content=args["content"],
            summary=args.get("summary", ""),
            source=args.get("source"),
        )

    async def _report_result(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.report_result(
            task_id=args["task_id"],
            status=args["status"],
            result=args.get("result"),
        )

    async def _request_user_input(self, args: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway_client.request_user_input(
            question=args["question"],
            timeout_seconds=args.get("timeout_seconds", 300),
        )

    async def _query_registry(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        return await self.gateway_client.query_registry(capability=args["capability"])


# ---------------------------------------------------------------------------
# Entry point for stdio MCP server mode
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    import os
    import json
    import sys

    gateway_url = os.environ.get("GATEWAY_URL", "http://gateway:8080")
    agent_id = os.environ.get("KUBEX_AGENT_ID", "orchestrator")

    server = MCPBridgeServer(gateway_url=gateway_url, agent_id=agent_id)

    # Minimal stdio JSON-RPC loop for the MCP protocol
    # In production, use the official 'mcp' Python SDK for full compliance.
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            method = request.get("method", "")
            params = request.get("params", {})
            req_id = request.get("id")

            if method == "tools/list":
                tools = [
                    {
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema,
                    }
                    for t in server.list_tools()
                ]
                response = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools}}
            elif method == "tools/call":
                tool_name = params.get("name", "")
                arguments = params.get("arguments", {})
                result = asyncio.run(server.call_tool(tool_name, arguments))
                content = [{"type": "text", "text": json.dumps(result)}]
                response = {"jsonrpc": "2.0", "id": req_id, "result": {"content": content}}
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }
        except Exception as exc:
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": str(exc)},
            }

        print(json.dumps(response), flush=True)
