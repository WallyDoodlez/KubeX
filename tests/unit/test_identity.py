"""Unit tests for gateway/identity.py — IdentityResolver.

Layer 1.1: UT-ID-01 through UT-ID-09
"""

from __future__ import annotations

import sys
import os
import time
from unittest.mock import MagicMock, AsyncMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))

from gateway.identity import IdentityResolver, IDENTITY_CACHE_TTL, LABEL_AGENT_ID, LABEL_BOUNDARY
from kubex_common.errors import IdentityResolutionError


def _make_container(ip: str, agent_id: str, boundary: str | None = None) -> dict:
    """Build a mock container dict matching the structure used by IdentityResolver."""
    labels: dict[str, str] = {LABEL_AGENT_ID: agent_id}
    if boundary is not None:
        labels[LABEL_BOUNDARY] = boundary
    return {
        "NetworkSettings": {
            "Networks": {
                "kubex_net": {"IPAddress": ip},
            }
        },
        "Labels": labels,
    }


def _make_docker_client(containers: list[dict]) -> MagicMock:
    """Create a mock Docker SDK client that returns the given containers."""
    mock = MagicMock()
    mock_containers = []
    for c in containers:
        mc = MagicMock()
        mc.attrs = {"NetworkSettings": c["NetworkSettings"]}
        mc.labels = c["Labels"]
        mock_containers.append(mc)
    mock.containers.list.return_value = mock_containers
    return mock


# ─────────────────────────────────────────────
# UT-ID-01 — raises when docker_client is None
# ─────────────────────────────────────────────


class TestIdentityResolverNoDocker:
    @pytest.mark.asyncio
    async def test_resolve_raises_when_no_docker_client(self) -> None:
        """UT-ID-01: IdentityResolver(docker_client=None).resolve() raises IdentityResolutionError."""
        resolver = IdentityResolver(docker_client=None)
        with pytest.raises(IdentityResolutionError):
            await resolver.resolve("1.2.3.4")


# ─────────────────────────────────────────────
# UT-ID-02 — resolves agent_id from Docker labels
# ─────────────────────────────────────────────


class TestIdentityResolverWithDocker:
    @pytest.mark.asyncio
    async def test_resolve_returns_agent_id_from_docker_labels(self) -> None:
        """UT-ID-02: Resolver returns (agent_id, boundary) from Docker labels."""
        docker_client = _make_docker_client([
            _make_container("10.0.0.5", "scraper-agent", "default"),
        ])
        resolver = IdentityResolver(docker_client=docker_client)
        agent_id, boundary = await resolver.resolve("10.0.0.5")
        assert agent_id == "scraper-agent"
        assert boundary == "default"

    # ─────────────────────────────────────────
    # UT-ID-03 — cache hit on second call
    # ─────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_resolve_uses_cache_on_second_call(self) -> None:
        """UT-ID-03: Docker API is called only once; second call hits cache."""
        docker_client = _make_docker_client([
            _make_container("10.0.0.5", "scraper-agent", "default"),
        ])
        resolver = IdentityResolver(docker_client=docker_client)
        await resolver.resolve("10.0.0.5")
        await resolver.resolve("10.0.0.5")
        assert docker_client.containers.list.call_count == 1

    # ─────────────────────────────────────────
    # UT-ID-04 — stale cache triggers re-fetch
    # ─────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_cache_expires_after_ttl(self) -> None:
        """UT-ID-04: Stale cache entry (past TTL) causes Docker API to be called again."""
        docker_client = _make_docker_client([
            _make_container("10.0.0.5", "scraper-agent", "default"),
        ])
        resolver = IdentityResolver(docker_client=docker_client)

        # Inject a stale cache entry (timestamp = now - TTL - 1)
        stale_ts = time.time() - IDENTITY_CACHE_TTL - 1
        resolver._cache["10.0.0.5"] = ("scraper-agent", "default", stale_ts)

        await resolver.resolve("10.0.0.5")
        # Docker API should have been called to refresh
        assert docker_client.containers.list.call_count == 1

    # ─────────────────────────────────────────
    # UT-ID-05 — no matching container raises
    # ─────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_resolve_raises_when_no_matching_container(self) -> None:
        """UT-ID-05: No container with matching IP raises IdentityResolutionError."""
        docker_client = _make_docker_client([
            _make_container("10.0.0.99", "other-agent", "default"),
        ])
        resolver = IdentityResolver(docker_client=docker_client)
        with pytest.raises(IdentityResolutionError):
            await resolver.resolve("10.0.0.5")

    # ─────────────────────────────────────────
    # UT-ID-06 — default boundary when label missing
    # ─────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_resolve_uses_default_boundary_when_label_missing(self) -> None:
        """UT-ID-06: Container with kubex.agent_id but no kubex.boundary defaults to 'default'."""
        docker_client = _make_docker_client([
            _make_container("10.0.0.5", "scraper-agent", boundary=None),  # no boundary label
        ])
        resolver = IdentityResolver(docker_client=docker_client)
        agent_id, boundary = await resolver.resolve("10.0.0.5")
        assert agent_id == "scraper-agent"
        assert boundary == "default"

    # ─────────────────────────────────────────
    # UT-ID-09 — Docker API exception wrapped
    # ─────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_resolve_raises_on_docker_api_exception(self) -> None:
        """UT-ID-09: Docker client raises RuntimeError — wrapped in IdentityResolutionError."""
        docker_client = MagicMock()
        docker_client.containers.list.side_effect = RuntimeError("Docker socket unreachable")
        resolver = IdentityResolver(docker_client=docker_client)
        with pytest.raises(IdentityResolutionError):
            await resolver.resolve("10.0.0.5")


# ─────────────────────────────────────────────
# UT-ID-07 / UT-ID-08 — invalidate_cache
# ─────────────────────────────────────────────


class TestIdentityResolverCacheInvalidation:
    def test_invalidate_cache_clears_single_ip(self) -> None:
        """UT-ID-07: invalidate_cache('1.2.3.4') removes only that entry."""
        resolver = IdentityResolver(docker_client=None)
        now = time.time()
        resolver._cache["1.2.3.4"] = ("agent-a", "default", now)
        resolver._cache["5.6.7.8"] = ("agent-b", "default", now)

        resolver.invalidate_cache("1.2.3.4")

        assert "1.2.3.4" not in resolver._cache
        assert "5.6.7.8" in resolver._cache

    def test_invalidate_cache_clears_all(self) -> None:
        """UT-ID-08: invalidate_cache() with no argument clears entire cache."""
        resolver = IdentityResolver(docker_client=None)
        now = time.time()
        resolver._cache["1.2.3.4"] = ("agent-a", "default", now)
        resolver._cache["5.6.7.8"] = ("agent-b", "default", now)

        resolver.invalidate_cache()

        assert len(resolver._cache) == 0
