"""Gateway HTTP client for the MCP Bridge.

Handles all outbound HTTP calls from the MCP Bridge to the KubexClaw Gateway.
Implements retry logic (3 retries on 503) and a 30-second timeout.

All Gateway interactions flow through this client — no direct network calls
from the MCP tools themselves.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx


class GatewayClient:
    """Thin async HTTP client for the KubexClaw Gateway.

    All tool implementations delegate to this client for network I/O.
    Retries up to 3 times on 503 responses.  Raises on persistent failure.
    """

    #: Maximum number of attempts (1 original + 2 retries = 3 total)
    MAX_RETRIES = 3
    #: HTTP status codes that trigger a retry
    RETRY_STATUS_CODES = {503, 429}

    def __init__(self, base_url: str, agent_id: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.agent_id = agent_id

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _base_headers(self) -> dict[str, str]:
        return {"X-Kubex-Agent-Id": self.agent_id}

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """POST to the gateway with retry logic.

        Retries up to MAX_RETRIES times on RETRY_STATUS_CODES.
        Raises httpx.HTTPStatusError after exhausting retries.
        """
        url = f"{self.base_url}{path}"
        last_exc: Exception | None = None

        for attempt in range(self.MAX_RETRIES):
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload, headers=self._base_headers())
                if resp.status_code not in self.RETRY_STATUS_CODES:
                    # Check for non-retry error statuses (4xx, 5xx not in retry list)
                    if resp.status_code >= 400:
                        raise Exception(
                            f"Gateway returned error {resp.status_code} for {url}"
                        )
                    return resp.json()
                # Store error info for retry tracking
                last_exc = Exception(
                    f"Gateway returned {resp.status_code} after {attempt + 1} attempt(s) for {url}"
                )
                # Brief backoff before retry (exponential: 0.1, 0.2, 0.4...)
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(0.1 * (2 ** attempt))

        assert last_exc is not None
        raise last_exc

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """GET from the gateway with retry logic."""
        url = f"{self.base_url}{path}"
        last_exc: Exception | None = None

        for attempt in range(self.MAX_RETRIES):
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url, params=params, headers=self._base_headers())
                if resp.status_code not in self.RETRY_STATUS_CODES:
                    resp.raise_for_status()
                    return resp.json()
                last_exc = httpx.HTTPStatusError(
                    f"{resp.status_code} from {url}",
                    request=resp.request,
                    response=resp,
                )
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(0.1 * (2 ** attempt))

        assert last_exc is not None
        raise last_exc

    def _action_request(self, action: str, parameters: dict[str, Any]) -> dict[str, Any]:
        """Build a minimal ActionRequest body."""
        return {
            "agent_id": self.agent_id,
            "action": action,
            "parameters": parameters,
            "context": {},
        }

    # ------------------------------------------------------------------
    # Tool-level methods (called by MCPBridgeServer tools)
    # ------------------------------------------------------------------

    async def dispatch_task(
        self,
        capability: str,
        context_message: str,
        workflow_id: str | None = None,
    ) -> dict[str, Any]:
        """Dispatch a task to a worker Kubex via Gateway POST /actions."""
        params: dict[str, Any] = {
            "capability": capability,
            "context_message": context_message,
        }
        if workflow_id:
            params["workflow_id"] = workflow_id
        payload = self._action_request("dispatch_task", params)
        if workflow_id:
            payload["context"] = {"workflow_id": workflow_id}
        return await self._post("/actions", payload)

    async def check_task_status(self, task_id: str) -> dict[str, Any]:
        """Get task status via Gateway GET /tasks/{id}/result."""
        try:
            return await self._get(f"/tasks/{task_id}/result")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return {"task_id": task_id, "status": "pending"}
            raise

    async def cancel_task(self, task_id: str, reason: str = "") -> dict[str, Any]:
        """Cancel a running task via Gateway POST /tasks/{id}/cancel."""
        payload = {"agent_id": self.agent_id, "reason": reason}
        return await self._post(f"/tasks/{task_id}/cancel", payload)

    async def subscribe_task_progress(self, task_id: str) -> dict[str, Any]:
        """Register an SSE subscription for task progress."""
        # The Gateway SSE endpoint is GET /tasks/{id}/stream.
        # We return subscription metadata rather than opening the stream here.
        return {
            "subscription_id": f"sub-{task_id}",
            "task_id": task_id,
            "status": "subscribed",
            "stream_url": f"{self.base_url}/tasks/{task_id}/stream",
        }

    async def get_task_progress(self, task_id: str) -> dict[str, Any]:
        """Retrieve buffered progress for a task from Gateway."""
        try:
            result = await self._get(f"/tasks/{task_id}/result")
            return {
                "task_id": task_id,
                "chunks": [result.get("output", "")],
                "final": result.get("status") in ("completed", "failed", "cancelled"),
            }
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return {"task_id": task_id, "chunks": [], "final": False}
            raise

    async def list_agents(self) -> list[dict[str, Any]]:
        """List available agents via Gateway → Registry."""
        result = await self._get("/registry/agents")
        if isinstance(result, list):
            return result
        return result.get("agents", [])

    async def query_registry(self, capability: str) -> list[dict[str, Any]]:
        """Resolve a capability to agents via Gateway → Registry."""
        result = await self._get("/registry/capabilities", params={"capability": capability})
        if isinstance(result, list):
            return result
        return result.get("agents", [])

    async def query_knowledge(
        self,
        query: str,
        entity_types: list[str] | None = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        """Query the knowledge graph via Gateway POST /actions."""
        params: dict[str, Any] = {"query": query}
        if entity_types:
            params["entity_types"] = entity_types
        if as_of:
            params["as_of"] = as_of
        payload = self._action_request("query_knowledge", params)
        return await self._post("/actions", payload)

    async def store_knowledge(
        self,
        content: str,
        summary: str,
        source: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Store knowledge via Gateway POST /actions."""
        params: dict[str, Any] = {"content": content, "summary": summary}
        if source:
            params["source"] = source
        payload = self._action_request("store_knowledge", params)
        return await self._post("/actions", payload)

    async def report_result(
        self,
        task_id: str,
        status: str,
        result: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Record a task outcome via Gateway POST /actions."""
        params: dict[str, Any] = {
            "task_id": task_id,
            "status": status,
            "result": result or {},
        }
        payload = self._action_request("report_result", params)
        payload["context"] = {"task_id": task_id}
        return await self._post("/actions", payload)

    async def request_user_input(
        self,
        question: str,
        timeout_seconds: int = 300,
    ) -> dict[str, Any]:
        """Request human clarification via Gateway POST /actions."""
        params: dict[str, Any] = {
            "question": question,
            "timeout_seconds": timeout_seconds,
        }
        payload = self._action_request("request_user_input", params)
        return await self._post("/actions", payload)
