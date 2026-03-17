"""wait_for_result tool — Poll GET /tasks/{id}/result until completed or timeout."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx


async def wait_for_result(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    gateway_url: str,
    poll_timeout: int = 30,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Poll for a task result with a timeout.

    Blocks until the task completes or the timeout is reached.
    Use this after dispatch_task to wait for worker completion.

    Args:
        client: Async HTTP client.
        args: Tool arguments (task_id, timeout_seconds optional).
        agent_id: Calling agent's identifier.
        gateway_url: Gateway base URL.
        poll_timeout: Default poll timeout in seconds.

    Returns:
        Task result dict when complete, or timeout/error dict.
    """
    target_task_id = args["task_id"]
    timeout = args.get("timeout_seconds", poll_timeout)
    poll_interval = 2  # seconds

    elapsed = 0
    while elapsed < timeout:
        resp = await client.get(
            f"{gateway_url}/tasks/{target_task_id}/result",
            headers={"X-Kubex-Agent-Id": agent_id},
        )
        if resp.status_code == 200:
            data = resp.json()
            status = data.get("status", data.get("result", {}).get("status", ""))
            if status in ("completed", "failed", "cancelled"):
                return data
        elif resp.status_code != 404:
            return {"error": f"poll failed: {resp.status_code}"}

        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    return {
        "task_id": target_task_id,
        "status": "timeout",
        "message": f"Task did not complete within {timeout}s",
    }
