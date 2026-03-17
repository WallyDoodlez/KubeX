"""cancel_task tool — POST /tasks/{id}/cancel to cancel a task."""

from __future__ import annotations

from typing import Any

import httpx


async def cancel_task(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    gateway_url: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Cancel a running task. Only the originating agent can cancel.

    Args:
        client: Async HTTP client.
        args: Tool arguments (task_id, reason optional).
        agent_id: Calling agent's identifier.
        gateway_url: Gateway base URL.

    Returns:
        Cancellation response JSON, or error dict on failure.
    """
    target_task_id = args["task_id"]
    payload = {
        "agent_id": agent_id,
        "reason": args.get("reason", ""),
    }
    resp = await client.post(
        f"{gateway_url}/tasks/{target_task_id}/cancel",
        json=payload,
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code >= 400:
        return {"error": f"cancel failed: {resp.status_code}", "detail": resp.text[:300]}
    return resp.json()
