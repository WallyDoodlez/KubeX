"""check_task_status tool — GET /tasks/{id}/result to check task status."""

from __future__ import annotations

from typing import Any

import httpx


async def check_task_status(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    gateway_url: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Check the status/result of a dispatched task by task_id.

    Args:
        client: Async HTTP client.
        args: Tool arguments (task_id).
        agent_id: Calling agent's identifier.
        gateway_url: Gateway base URL.

    Returns:
        Task status dict, or error dict on failure.
    """
    target_task_id = args["task_id"]
    resp = await client.get(
        f"{gateway_url}/tasks/{target_task_id}/result",
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code == 404:
        return {"task_id": target_task_id, "status": "pending"}
    if resp.status_code >= 400:
        return {"error": f"status check failed: {resp.status_code}"}
    return resp.json()
