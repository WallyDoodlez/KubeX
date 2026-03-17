"""query_registry tool — GET /agents?capability={cap} from Registry."""

from __future__ import annotations

from typing import Any

import httpx


async def query_registry(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    *,
    agent_id: str,
    registry_url: str = "http://registry:8070",
    **_kwargs: Any,
) -> Any:
    """Resolve a capability to available agent Kubexes.

    Use this to discover which agents can handle a specific task type.

    Args:
        client: Async HTTP client.
        args: Tool arguments (capability).
        agent_id: Calling agent's identifier.
        registry_url: Registry base URL.

    Returns:
        List of matching agent records, or error dict on failure.
    """
    resp = await client.get(
        f"{registry_url}/agents",
        params={"capability": args["capability"]},
        headers={"X-Kubex-Agent-Id": agent_id},
    )
    if resp.status_code >= 400:
        return {"error": f"query_registry failed: {resp.status_code}"}
    data = resp.json()
    return data if isinstance(data, list) else data.get("agents", [])
