"""list_agents tool — GET /agents from Registry to list all agents."""

from __future__ import annotations

from typing import Any

import httpx


async def list_agents(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    registry_url: str = "http://registry:8070",
    **_kwargs: Any,
) -> Any:
    """List all registered agent Kubexes and their capabilities.

    Args:
        client: Async HTTP client.
        args: Tool arguments (unused for this tool).
        agent_id: Calling agent's identifier.
        registry_url: Registry base URL.

    Returns:
        List of agent records, or error dict on failure.
    """
    resp = await client.get(
        f"{registry_url}/agents",
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code >= 400:
        return {"error": f"list_agents failed: {resp.status_code}"}
    data = resp.json()
    return data if isinstance(data, list) else data.get("agents", [])
