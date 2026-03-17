"""store_knowledge tool — POST /actions with store_knowledge action."""

from __future__ import annotations

from typing import Any

import httpx


async def store_knowledge(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    gateway_url: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Persist new knowledge to the knowledge graph and document corpus.

    Args:
        client: Async HTTP client.
        args: Tool arguments (content, summary).
        agent_id: Calling agent's identifier.
        gateway_url: Gateway base URL.

    Returns:
        Store response JSON, or error dict on failure.
    """
    payload = {
        "agent_id": agent_id,
        "action": "store_knowledge",
        "parameters": {
            "content": args["content"],
            "summary": args.get("summary", ""),
        },
        "context": {},
    }
    resp = await client.post(
        f"{gateway_url}/actions",
        json=payload,
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code >= 400:
        return {"error": f"store_knowledge failed: {resp.status_code}"}
    return resp.json()
