"""query_knowledge tool — POST /actions with query_knowledge action."""

from __future__ import annotations

from typing import Any

import httpx


async def query_knowledge(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    gateway_url: str,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Search the KubexClaw knowledge graph for relevant information.

    Supports natural language queries.

    Args:
        client: Async HTTP client.
        args: Tool arguments (query, entity_types optional).
        agent_id: Calling agent's identifier.
        gateway_url: Gateway base URL.

    Returns:
        Knowledge query results, or error dict on failure.
    """
    params: dict[str, Any] = {"query": args["query"]}
    if args.get("entity_types"):
        params["entity_types"] = args["entity_types"]
    payload = {
        "agent_id": agent_id,
        "action": "query_knowledge",
        "parameters": params,
        "context": {},
    }
    resp = await client.post(
        f"{gateway_url}/actions",
        json=payload,
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code >= 400:
        return {"error": f"query_knowledge failed: {resp.status_code}"}
    return resp.json()
