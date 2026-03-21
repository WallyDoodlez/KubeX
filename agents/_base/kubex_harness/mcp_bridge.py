"""MCP Bridge Server -- replaces the custom 8-tool OpenAI loop (Phase 8).

Runs in-process inside the orchestrator container. Exposes three tool categories:
1. Worker delegation tools (one per registered agent) -- async task_id pattern
2. Vault direct tools (reads in-process, writes via Gateway) -- Plan 03
3. Meta-tools (list_agents, agent_status, cancel_task) -- Plan 03

The bridge subscribes to Redis pub/sub channel 'registry:agent_changed' for
live tool cache invalidation (MCP-05).

Need_info protocol (D-05/D-06/D-07):
- Workers return {status: "need_info", request: "...", data: {...}} via result pipeline
- kubex__poll_task surfaces need_info status to the LLM for re-delegation
- delegation_depth tracked per dispatch chain, configurable max (default 3)
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

from kubex_harness.config_loader import AgentConfig

logger = logging.getLogger("kubex_harness.mcp_bridge")

# MCP tool timeout -- minimum 300s to survive long-running policy escalations
MCP_TOOL_TIMEOUT = int(os.environ.get("MCP_TOOL_TIMEOUT", "300"))

# Max delegation depth (D-07) -- prevent infinite need_info chains
DEFAULT_MAX_DELEGATION_DEPTH = 3


class MCPBridgeServer:
    """In-process MCP server bridging orchestrator LLM to worker agents.

    All worker delegation tools use the async task_id pattern (MCP-03):
    tool call returns {"status": "dispatched", "task_id": "..."} immediately.
    A separate kubex__poll_task tool checks task status.
    This prevents MCP SDK timeout crashes (SDK Issue #212).

    Need_info protocol (D-05/D-06/D-07):
    - kubex__poll_task returns need_info status with request and data fields
    - Worker delegation tools accept optional delegation_depth parameter
    - Max depth configurable via MAX_DELEGATION_DEPTH env var (default 3)
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._mcp = FastMCP(name="kubex-bridge")
        self._http: httpx.AsyncClient | None = None
        self._running = True
        self._tool_cache: dict[str, dict[str, Any]] = {}
        self._pubsub_task: asyncio.Task[None] | None = None

        # Delegation depth tracking (D-07): task_id -> current depth
        self._delegation_depth: dict[str, int] = {}
        self.max_delegation_depth = int(
            os.environ.get("MAX_DELEGATION_DEPTH", str(DEFAULT_MAX_DELEGATION_DEPTH))
        )

        self.registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")
        self.redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")

        # Register static tools (poll_task is always available)
        self._register_poll_tool()

    def _register_poll_tool(self) -> None:
        """Register kubex__poll_task -- always available."""

        @self._mcp.tool(
            name="kubex__poll_task",
            description=(
                "Poll status of a previously dispatched worker task. "
                "Returns {status: pending|completed|need_info|error, ...}. "
                "When status is 'need_info', the response includes 'request' "
                "(what the worker needs) and 'data' (raw data for context)."
            ),
        )
        async def kubex__poll_task(task_id: str) -> dict:
            return await self._handle_poll_task(task_id)

    async def _handle_poll_task(self, task_id: str) -> dict:
        """Poll GET /tasks/{id}/result via Gateway and return structured result.

        Returns:
            {status: "pending", task_id: ...} on 404 (task not yet complete)
            {status: "completed", ...result} on 200 with completed status
            {status: "need_info", task_id: ..., request: ..., data: {...}} on need_info (D-05/D-06)
            {status: "error", code: ..., message: ...} on non-200/404 or exception
        """
        try:
            assert self._http is not None
            resp = await self._http.get(
                f"{self.config.gateway_url}/tasks/{task_id}/result",
            )
            if resp.status_code == 404:
                return {"status": "pending", "task_id": task_id}
            if resp.status_code == 200:
                data = resp.json()
                result_status = data.get("status", "completed")

                # D-05/D-06: Handle need_info status from workers
                if result_status == "need_info":
                    return {
                        "status": "need_info",
                        "task_id": task_id,
                        "request": data.get("request", ""),
                        "data": data.get("data", {}),
                    }

                return {"status": "completed", **data}
            return {"status": "error", "code": resp.status_code, "message": resp.text[:200]}
        except Exception as exc:
            return {"status": "error", "message": str(exc)}

    async def refresh_worker_tools(self) -> None:
        """Fetch registered agents from Registry, rebuild worker delegation tools."""
        try:
            assert self._http is not None
            resp = await self._http.get(f"{self.registry_url}/agents")
            if resp.status_code != 200:
                logger.warning("Registry returned %d when fetching agents", resp.status_code)
                return

            agents = resp.json()
            new_cache: dict[str, dict[str, Any]] = {}

            for agent in agents:
                agent_id = agent.get("agent_id", "")
                if agent_id == self.config.agent_id:
                    continue  # skip self

                capabilities = agent.get("capabilities", [])
                metadata = agent.get("metadata", {})
                description = metadata.get("description", f"Delegate tasks to {agent_id}")

                for capability in capabilities:
                    new_cache[capability] = {
                        "agent_id": agent_id,
                        "capability": capability,
                        "description": description,
                    }
                    self._register_worker_tool(capability, description)

            self._tool_cache = new_cache
            logger.info(
                "Refreshed worker tools: %d tools from %d agents",
                len(new_cache),
                len([a for a in agents if a.get("agent_id") != self.config.agent_id]),
            )

        except Exception as exc:
            logger.error("Failed to refresh worker tools: %s", exc)

    def _register_worker_tool(self, capability: str, description: str) -> None:
        """Register a single worker delegation tool for a capability."""

        @self._mcp.tool(name=capability, description=description)
        async def worker_delegate(task: str, delegation_depth: int = 0) -> dict:
            """Dispatch task to worker; return task_id for polling.

            Args:
                task: The task description to send to the worker.
                delegation_depth: Current delegation chain depth (D-07).
                    Incremented automatically on re-delegation after need_info.
                    If >= max_delegation_depth, dispatch is rejected.
            """
            return await self._handle_worker_dispatch(
                capability=capability,
                task=task,
                delegation_depth=delegation_depth,
            )

    async def _handle_worker_dispatch(
        self,
        capability: str,
        task: str,
        delegation_depth: int = 0,
    ) -> dict:
        """Dispatch a task to a worker via Gateway POST /actions.

        Args:
            capability: The worker capability to invoke.
            task: The task description to pass to the worker.
            delegation_depth: Current chain depth for D-07 enforcement.

        Returns:
            {status: "dispatched", task_id: ..., delegation_depth: ...} on success.
            {status: "error", message: ...} on failure or depth exceeded.
        """
        # D-07: Enforce max delegation depth
        if delegation_depth >= self.max_delegation_depth:
            return {
                "status": "error",
                "message": (
                    f"Max delegation depth ({self.max_delegation_depth}) exceeded. "
                    f"Current depth: {delegation_depth}. Cannot re-delegate."
                ),
            }

        try:
            assert self._http is not None
            resp = await self._http.post(
                f"{self.config.gateway_url}/actions",
                json={
                    "agent_id": self.config.agent_id,
                    "action": "dispatch_task",
                    "parameters": {
                        "capability": capability,
                        "context_message": task,
                        "delegation_depth": delegation_depth,
                    },
                },
            )
            if resp.status_code in (200, 201, 202):
                data = resp.json()
                task_id = data.get("task_id", "unknown")
                # Track delegation depth for this task chain (D-07)
                self._delegation_depth[task_id] = delegation_depth
                return {
                    "status": "dispatched",
                    "task_id": task_id,
                    "delegation_depth": delegation_depth,
                }
            return {"status": "error", "code": resp.status_code, "message": resp.text[:200]}
        except Exception as exc:
            return {"status": "error", "message": str(exc)}

    async def _listen_registry_changes(self) -> None:
        """Background task: subscribe to registry:agent_changed, refresh tool cache."""
        import redis.asyncio as aioredis  # noqa: PLC0415

        client = aioredis.from_url(self.redis_url, decode_responses=True)
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe("registry:agent_changed")
            logger.info("Subscribed to registry:agent_changed pub/sub channel")

            async for message in pubsub.listen():
                if not self._running:
                    break
                if message["type"] == "message":
                    agent_id = message.get("data", "unknown")
                    logger.info(
                        "Registry change detected: agent_id=%s, refreshing tools", agent_id
                    )
                    await self.refresh_worker_tools()

        except asyncio.CancelledError:
            logger.info("Registry pub/sub listener cancelled")
        except Exception as exc:
            logger.error("Registry pub/sub listener error: %s", exc)
        finally:
            try:
                await pubsub.unsubscribe("registry:agent_changed")
                await client.aclose()
            except Exception:
                pass

    async def run(self) -> None:
        """Start the MCP Bridge Server.

        1. Create HTTP client
        2. Subscribe to registry pub/sub (background task)
        3. Fetch initial agent list (cold boot)
        4. Run MCP server
        """
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            self._http = client

            # Start pub/sub listener as background task
            self._pubsub_task = asyncio.create_task(self._listen_registry_changes())

            # Cold boot: fetch current agents before accepting connections
            await self.refresh_worker_tools()

            logger.info(
                "MCPBridgeServer starting: agent_id=%s tools=%d max_delegation_depth=%d",
                self.config.agent_id,
                len(self._tool_cache) + 1,  # +1 for poll_task
                self.max_delegation_depth,
            )

            # Run MCP server (blocks until stopped)
            try:
                await self._mcp.run_async()
            finally:
                await self._shutdown()

    async def _shutdown(self) -> None:
        """Clean shutdown: cancel pub/sub, close connections."""
        self._running = False
        if self._pubsub_task and not self._pubsub_task.done():
            self._pubsub_task.cancel()
            try:
                await self._pubsub_task
            except asyncio.CancelledError:
                pass
        logger.info("MCPBridgeServer shut down")

    def stop(self) -> None:
        """Signal the bridge to stop (called from signal handler)."""
        self._running = False
        # FastMCP doesn't expose a stop method; the run loop will exit
        # when the asyncio event loop is cancelled by the signal handler.
