"""dispatch_task tool — POST /actions to dispatch a task to a worker agent."""

from __future__ import annotations

import uuid
from typing import Any

import httpx


async def dispatch_task(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    gateway_url: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Dispatch a subtask to a worker Kubex by capability.

    Args:
        client: Async HTTP client.
        args: Tool arguments (capability, context_message, workflow_id optional).
        agent_id: Calling agent's identifier.
        gateway_url: Gateway base URL.

    Returns:
        Gateway response JSON, or error dict on failure.
    """
    sub_task_id = f"sub-{uuid.uuid4().hex[:12]}"
    task_id = args.get("workflow_id", str(uuid.uuid4()))
    payload = {
        "request_id": str(uuid.uuid4()),
        "agent_id": agent_id,
        "action": "dispatch_task",
        "parameters": {
            "capability": args["capability"],
            "context_message": args["context_message"],
        },
        "context": {"task_id": sub_task_id, "workflow_id": task_id},
        "priority": "normal",
    }
    if args.get("workflow_id"):
        payload["context"]["workflow_id"] = args["workflow_id"]
        payload["parameters"]["workflow_id"] = args["workflow_id"]  # type: ignore[index]

    resp = await client.post(
        f"{gateway_url}/actions",
        json=payload,
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code >= 400:
        return {"error": f"dispatch failed: {resp.status_code}", "detail": resp.text[:300]}
    return resp.json()
