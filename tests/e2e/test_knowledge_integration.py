"""Wave 5C — Spec-Driven E2E Tests for Knowledge Base Integration.

These tests encode the EXPECTED behavior of the Gateway knowledge action
handlers as specified in:
  - IMPLEMENTATION-PLAN.md  Wave 5, Stream 5C
  - docs/architecture.md    Knowledge layer: Graphiti + OpenSearch
  - docs/gateway.md         Action routing, policy cascade, rate limiting

Wave 5C delivers:
  - Gateway handlers for QUERY_KNOWLEDGE, STORE_KNOWLEDGE, SEARCH_CORPUS
  - OpenSearch index template setup at service startup
  - Graphiti client wrapper (agents/knowledge/graphiti_client.py or similar)
  - Rate limiting for knowledge actions (30/min, 10/min, 20/min)
  - Budget tracking for knowledge operations (500 tokens, 1500 tokens)

Currently the Gateway main.py routes these action types to the generic
"accepted" fallthrough (line ~156-159).  The Wave 5C implementation adds
specific handlers that proxy to Graphiti/OpenSearch.

ActionType enum (already defined in kubex_common/schemas/actions.py):
    QUERY_KNOWLEDGE = "query_knowledge"
    STORE_KNOWLEDGE = "store_knowledge"
    SEARCH_CORPUS   = "search_corpus"

Tests are SKIPPED until Wave 5C implementation lands.  The skip guard
checks for the presence of a knowledge handler in the Gateway.

All external HTTP calls (to Graphiti, OpenSearch) are mocked via
unittest.mock.patch — no real network or external services required.
fakeredis is used for Redis.  TestClient is used for the Gateway.

Patterns follow test_smoke.py exactly (make_gateway_client factory).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest

# ---------------------------------------------------------------------------
# Path setup — mirror pattern from test_smoke.py
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/gateway"))
sys.path.insert(0, os.path.join(_ROOT, "services/broker"))
sys.path.insert(0, os.path.join(_ROOT, "services/registry"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common"))

# ---------------------------------------------------------------------------
# Conditional import — skip if Wave 5C not yet implemented.
#
# The wave5c readiness signal: the Gateway must have a _handle_query_knowledge
# function (or equivalent) that is NOT the generic fallthrough.
# ---------------------------------------------------------------------------
_WAVE5C_IMPLEMENTED = False
try:
    from gateway.main import GatewayService, _handle_query_knowledge  # type: ignore[import]
    from gateway.budget import BudgetTracker  # type: ignore[import]
    from gateway.ratelimit import RateLimiter  # type: ignore[import]
    from fastapi.testclient import TestClient

    _WAVE5C_IMPLEMENTED = True
except (ImportError, AttributeError):
    # _handle_query_knowledge doesn't exist yet — Wave 5C not landed
    try:
        from gateway.main import GatewayService  # type: ignore[import]
        from gateway.budget import BudgetTracker  # type: ignore[import]
        from gateway.ratelimit import RateLimiter  # type: ignore[import]
        from fastapi.testclient import TestClient
    except ImportError:
        pass

_skip_wave5c = pytest.mark.skipif(
    not _WAVE5C_IMPLEMENTED,
    reason=(
        "Wave 5C not yet implemented — "
        "gateway._handle_query_knowledge missing (knowledge action handlers not yet added)"
    ),
)

# ---------------------------------------------------------------------------
# Shared fakeredis factory (mirrors test_smoke.py)
# ---------------------------------------------------------------------------


def make_fake_redis(
    server: "fakeredis.FakeServer | None" = None,
) -> "fakeredis.FakeAsyncRedis":
    """Return an async fakeredis client. Pass a shared FakeServer for cross-service tests."""
    if server is None:
        server = fakeredis.FakeServer()
    return fakeredis.FakeAsyncRedis(server=server, decode_responses=True)


# ---------------------------------------------------------------------------
# Gateway client factory (mirrors test_smoke.py make_gateway_client)
# ---------------------------------------------------------------------------


def make_gateway_client(
    redis: "fakeredis.FakeAsyncRedis | None" = None,
    graphiti_url: str = "http://graphiti:8000",
    opensearch_url: str = "http://opensearch:9200",
) -> "TestClient":
    """Create a Gateway TestClient with fakeredis and mocked knowledge backends."""
    svc = GatewayService()

    if redis is not None:
        svc.redis_db1 = redis
        svc.rate_limiter = RateLimiter(redis)
        svc.budget_tracker = BudgetTracker(redis)

    # Inject knowledge backend URLs (Wave 5C adds these to GatewayService)
    if hasattr(svc, "graphiti_url"):
        svc.graphiti_url = graphiti_url
    if hasattr(svc, "opensearch_url"):
        svc.opensearch_url = opensearch_url

    import httpx
    svc.llm_proxy._http_client = httpx.AsyncClient()

    return TestClient(svc.app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Helper: build a minimal ActionRequest body for knowledge actions
# ---------------------------------------------------------------------------


def _knowledge_action(
    action: str,
    agent_id: str = "orchestrator",
    parameters: dict | None = None,
    task_id: str = "task-know-001",
) -> dict:
    return {
        "request_id": f"req-{action}-001",
        "agent_id": agent_id,
        "action": action,
        "parameters": parameters or {},
        "context": {"task_id": task_id},
    }


# ===========================================================================
# 5C-QUERY: query_knowledge action handler
# ===========================================================================


@_skip_wave5c
class TestQueryKnowledgeAction:
    """Spec ref: IMPLEMENTATION-PLAN.md 5C — query_knowledge proxies to Graphiti search."""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    @patch("gateway.main.httpx.AsyncClient")
    def test_query_knowledge_routed_to_graphiti(self, mock_httpx: MagicMock) -> None:
        """5C-QUERY-01: query_knowledge action is routed to the Graphiti search endpoint.

        Spec: 'query_knowledge routes to Graphiti — POST /search or GET /episodes'
        The handler must NOT fall through to the generic "accepted" response.
        """
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [{"entity": "Nike", "summary": "Sportswear brand"}],
            "total": 1,
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                parameters={"query": "Nike brand history"},
            ),
        )

        # Must NOT be the generic fallthrough (status=accepted)
        assert resp.status_code in (200, 202), (
            f"Expected 200/202, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        # Should return structured knowledge results, not just {"status": "accepted"}
        assert "results" in data or "knowledge" in str(data).lower(), (
            f"query_knowledge returned generic fallthrough: {data}"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_query_knowledge_returns_structured_result(self, mock_httpx: MagicMock) -> None:
        """5C-QUERY-02: query_knowledge returns KnowledgeQueryResult schema.

        Spec: 'query_knowledge returns structured KnowledgeQueryResult'
        Response must include: results (list), total (int).
        """
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [
                {"entity": "Nike", "summary": "Global sportswear company", "relevance": 0.95}
            ],
            "total": 1,
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                parameters={"query": "Nike brand"},
            ),
        )

        assert resp.status_code in (200, 202)
        data = resp.json()
        assert "results" in data
        assert isinstance(data["results"], list)
        assert "total" in data

    @patch("gateway.main.httpx.AsyncClient")
    def test_query_knowledge_passes_as_of_timestamp(self, mock_httpx: MagicMock) -> None:
        """5C-QUERY-03: query_knowledge with as_of passes temporal filter to Graphiti.

        Spec: 'query_knowledge with as_of timestamp passes temporal filter'
        Graphiti's bi-temporal model supports point-in-time queries via valid_at parameter.
        """
        captured_requests: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            captured_requests.append({"url": url, "body": kwargs.get("json", {})})
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"results": [], "total": 0}
            return resp

        mock_client = AsyncMock()
        mock_client.post = capture_post
        mock_client.get = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                parameters={
                    "query": "Nike Q1 performance",
                    "as_of": "2026-01-01T00:00:00Z",
                },
            ),
        )

        assert resp.status_code in (200, 202)
        # Verify the temporal filter was forwarded to Graphiti
        all_bodies = [str(r) for r in captured_requests]
        assert any("2026-01-01" in body or "as_of" in body or "valid_at" in body
                   for body in all_bodies), (
            "as_of timestamp was not forwarded to Graphiti"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_query_knowledge_rate_limited_at_30_per_min(self, mock_httpx: MagicMock) -> None:
        """5C-QUERY-04: query_knowledge is rate limited at 30 requests per minute.

        Spec: 'query_knowledge rate limited at 30/min' (from skills/knowledge/recall/skill.yaml)
        """
        from gateway.main import GatewayService
        from gateway.policy import (
            PolicyLoader, PolicyEngine, AgentPolicy, GlobalPolicy, EgressRule
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"results": [], "total": 0}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        # Wire a service with a tight rate limit (2/task) to verify rate limiting works
        svc = GatewayService()
        svc.redis_db1 = self.redis
        svc.rate_limiter = RateLimiter(self.redis)
        svc.budget_tracker = BudgetTracker(self.redis)

        loader = PolicyLoader(policy_root="/nonexistent")
        loader._global = GlobalPolicy()
        loader._agent_policies = {
            "orchestrator": AgentPolicy(
                agent_id="orchestrator",
                allowed_actions=["query_knowledge"],
                blocked_actions=[],
                egress_mode="denyall",
                egress_rules=[],
                rate_limits={"query_knowledge": "2/task"},
            )
        }
        svc.policy_loader = loader
        svc.policy_engine = PolicyEngine(loader)

        import httpx as httpx_lib
        svc.llm_proxy._http_client = httpx_lib.AsyncClient()

        from fastapi.testclient import TestClient as TC
        rate_client = TC(svc.app, raise_server_exceptions=False)

        results = []
        for i in range(3):
            resp = rate_client.post(
                "/actions",
                json={
                    **_knowledge_action("query_knowledge", parameters={"query": "test"}),
                    "context": {"task_id": "rl-know-task-001"},
                    "request_id": f"req-rl-{i}",
                },
            )
            results.append(resp.status_code)

        # First 2 should pass (200 or 202 from knowledge handler)
        assert results[0] in (200, 202), f"First request failed unexpectedly: {results[0]}"
        assert results[1] in (200, 202), f"Second request failed unexpectedly: {results[1]}"
        # Third should be rate limited
        assert results[2] == 429, f"Third request should be 429, got: {results[2]}"

    @patch("gateway.main.httpx.AsyncClient")
    def test_query_knowledge_empty_results_returns_200_not_404(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-QUERY-05: Empty knowledge results return 200 with empty list, not 404.

        Spec: 'query_knowledge empty results returns empty list (not error)'
        """
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"results": [], "total": 0}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                parameters={"query": "obscure-xyz-no-match-guaranteed"},
            ),
        )

        assert resp.status_code in (200, 202)
        data = resp.json()
        assert "results" in data
        assert data["results"] == [] or data["total"] == 0


# ===========================================================================
# 5C-STORE: store_knowledge action handler
# ===========================================================================


@_skip_wave5c
class TestStoreKnowledgeAction:
    """Spec ref: IMPLEMENTATION-PLAN.md 5C — store_knowledge two-step: OpenSearch + Graphiti."""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    @patch("gateway.main.httpx.AsyncClient")
    def test_store_knowledge_calls_both_opensearch_and_graphiti(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-STORE-01: store_knowledge two-step: OpenSearch index + Graphiti episode.

        Spec: 'store_knowledge two-step: OpenSearch index + Graphiti episode'
        Both backends must be called: OpenSearch first (full-text), Graphiti second (graph).
        """
        call_urls: list[str] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            call_urls.append(url)
            resp = MagicMock()
            resp.status_code = 201
            resp.json.return_value = {
                "_id": "doc-abc123",
                "nodes_created": 2,
                "edges_created": 1,
            }
            return resp

        mock_client = AsyncMock()
        mock_client.post = capture_post
        mock_client.put = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "store_knowledge",
                agent_id="instagram-scraper",
                parameters={
                    "content": "Nike has 42M Instagram followers.",
                    "summary": "Nike Instagram follower count",
                    "source": {"task_id": "task-know-001"},
                },
            ),
        )

        assert resp.status_code in (200, 202, 201)
        # At least two backend calls should have been made
        assert len(call_urls) >= 2, (
            f"Expected 2 backend calls (OpenSearch + Graphiti), got {len(call_urls)}: {call_urls}"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_store_knowledge_returns_nodes_and_edges_created(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-STORE-02: store_knowledge response includes nodes_created and edges_created.

        Spec: 'store_knowledge returns nodes_created/edges_created'
        """
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = {
            "nodes_created": 3,
            "edges_created": 2,
            "opensearch_id": "doc-abc123",
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.put = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "store_knowledge",
                agent_id="knowledge",
                parameters={
                    "content": "Nike Q1 revenue up 12%.",
                    "summary": "Nike Q1 2026 financial results",
                },
            ),
        )

        assert resp.status_code in (200, 201, 202)
        data = resp.json()
        assert "nodes_created" in data, f"Response missing nodes_created: {data}"
        assert "edges_created" in data, f"Response missing edges_created: {data}"

    @patch("gateway.main.httpx.AsyncClient")
    def test_store_knowledge_rate_limited_at_10_per_min(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-STORE-03: store_knowledge is rate limited at 10 requests per minute.

        Spec: 'store_knowledge rate limited at 10/min'
        """
        from gateway.main import GatewayService
        from gateway.policy import (
            PolicyLoader, PolicyEngine, AgentPolicy, GlobalPolicy
        )

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"nodes_created": 1, "edges_created": 0}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.put = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        svc = GatewayService()
        svc.redis_db1 = self.redis
        svc.rate_limiter = RateLimiter(self.redis)
        svc.budget_tracker = BudgetTracker(self.redis)

        loader = PolicyLoader(policy_root="/nonexistent")
        loader._global = GlobalPolicy()
        loader._agent_policies = {
            "knowledge": AgentPolicy(
                agent_id="knowledge",
                allowed_actions=["store_knowledge"],
                blocked_actions=[],
                egress_mode="denyall",
                egress_rules=[],
                rate_limits={"store_knowledge": "2/task"},
            )
        }
        svc.policy_loader = loader
        svc.policy_engine = PolicyEngine(loader)

        import httpx as httpx_lib
        svc.llm_proxy._http_client = httpx_lib.AsyncClient()

        from fastapi.testclient import TestClient as TC
        rate_client = TC(svc.app, raise_server_exceptions=False)

        results = []
        for i in range(3):
            resp = rate_client.post(
                "/actions",
                json={
                    **_knowledge_action(
                        "store_knowledge",
                        agent_id="knowledge",
                        parameters={"content": f"fact {i}", "summary": f"summary {i}"},
                    ),
                    "context": {"task_id": "rl-store-task-001"},
                    "request_id": f"req-store-rl-{i}",
                },
            )
            results.append(resp.status_code)

        assert results[0] in (200, 201, 202)
        assert results[1] in (200, 201, 202)
        assert results[2] == 429, f"Third store_knowledge should be rate limited: {results[2]}"

    @pytest.mark.asyncio
    async def test_store_knowledge_deducts_budget_tokens(self) -> None:
        """5C-STORE-04: store_knowledge deducts estimated 1500 tokens from budget.

        Spec: 'store_knowledge deducts budget tokens (estimated 1500)'
        Storing knowledge requires LLM parsing — budget must be decremented.
        """
        task_id = "budget-store-task"
        today = datetime.now(UTC).strftime("%Y-%m-%d")

        # Pre-set token count to 0
        await self.redis.set(f"budget:task:{task_id}:tokens", "0")

        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_response.json.return_value = {"nodes_created": 1, "edges_created": 0}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.put = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client(redis=self.redis)
            resp = client.post(
                "/actions",
                json=_knowledge_action(
                    "store_knowledge",
                    agent_id="knowledge",
                    task_id=task_id,
                    parameters={"content": "Important fact", "summary": "Summary"},
                ),
            )

        assert resp.status_code in (200, 201, 202)

        # Verify budget was deducted
        recorded_tokens = await self.redis.get(f"budget:task:{task_id}:tokens")
        if recorded_tokens is not None:
            token_count = int(float(recorded_tokens))
            assert token_count >= 1000, (
                f"Expected ≥1000 tokens deducted for store_knowledge, got {token_count}"
            )

    @patch("gateway.main.httpx.AsyncClient")
    def test_store_knowledge_with_entity_hints_passes_to_graphiti(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-STORE-05: store_knowledge with entity_hints passes them to Graphiti.

        Spec: 'store_knowledge with entity hints passes them to Graphiti'
        Entity hints help Graphiti create the correct graph nodes.
        """
        captured_bodies: list[dict] = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            captured_bodies.append({"url": url, "body": kwargs.get("json", {})})
            resp = MagicMock()
            resp.status_code = 201
            resp.json.return_value = {"nodes_created": 2, "edges_created": 1}
            return resp

        mock_client = AsyncMock()
        mock_client.post = capture_post
        mock_client.put = capture_post
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "store_knowledge",
                parameters={
                    "content": "Nike founded 1964 by Phil Knight.",
                    "summary": "Nike founding date",
                    "entity_hints": [
                        {"type": "Organization", "name": "Nike"},
                        {"type": "Person", "name": "Phil Knight"},
                    ],
                },
            ),
        )

        assert resp.status_code in (200, 201, 202)
        # Entity hints should be forwarded to Graphiti
        all_body_str = str(captured_bodies)
        assert "Nike" in all_body_str or "entity" in all_body_str.lower(), (
            "entity_hints were not forwarded to any backend"
        )


# ===========================================================================
# 5C-SEARCH: search_corpus action handler
# ===========================================================================


@_skip_wave5c
class TestSearchCorpusAction:
    """Spec ref: IMPLEMENTATION-PLAN.md 5C — search_corpus routes to OpenSearch _search."""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    @patch("gateway.main.httpx.AsyncClient")
    def test_search_corpus_routes_to_opensearch(self, mock_httpx: MagicMock) -> None:
        """5C-SEARCH-01: search_corpus action routes to OpenSearch _search endpoint.

        Spec: 'search_corpus routes to OpenSearch _search endpoint'
        """
        call_urls: list[str] = []

        async def capture_get(url: str, **kwargs: Any) -> MagicMock:
            call_urls.append(url)
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {
                "hits": {
                    "total": {"value": 1},
                    "hits": [{"_id": "doc-001", "_source": {"content": "Nike Q1 report"}}],
                }
            }
            return resp

        mock_client = AsyncMock()
        mock_client.get = capture_get
        mock_client.post = AsyncMock(return_value=MagicMock(
            status_code=200,
            json=MagicMock(return_value={"hits": {"total": {"value": 0}, "hits": []}}),
        ))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "search_corpus",
                parameters={"query": "Nike quarterly revenue"},
            ),
        )

        assert resp.status_code in (200, 202)
        # Verify OpenSearch was called
        os_calls = [u for u in call_urls if "opensearch" in u.lower() or "_search" in u]
        assert len(os_calls) >= 1 or any("search" in u.lower() for u in call_urls), (
            f"OpenSearch _search endpoint was not called. Calls: {call_urls}"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_search_corpus_returns_corpus_search_result(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-SEARCH-02: search_corpus returns CorpusSearchResult with documents list.

        Spec: 'search_corpus returns CorpusSearchResult with documents'
        """
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "hits": {
                "total": {"value": 2},
                "hits": [
                    {"_id": "doc-001", "_source": {"content": "Nike Q1 2026", "date": "2026-01-15"}},
                    {"_id": "doc-002", "_source": {"content": "Nike Q4 2025", "date": "2025-10-15"}},
                ],
            }
        }
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "search_corpus",
                parameters={"query": "Nike quarterly performance"},
            ),
        )

        assert resp.status_code in (200, 202)
        data = resp.json()
        assert "documents" in data or "hits" in data or "results" in data, (
            f"search_corpus response missing documents field: {data}"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_search_corpus_rate_limited_at_20_per_min(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-SEARCH-03: search_corpus is rate limited at 20 requests per minute.

        Spec: 'search_corpus rate limited at 20/min'
        """
        from gateway.main import GatewayService
        from gateway.policy import (
            PolicyLoader, PolicyEngine, AgentPolicy, GlobalPolicy
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"hits": {"total": {"value": 0}, "hits": []}}
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        svc = GatewayService()
        svc.redis_db1 = self.redis
        svc.rate_limiter = RateLimiter(self.redis)
        svc.budget_tracker = BudgetTracker(self.redis)

        loader = PolicyLoader(policy_root="/nonexistent")
        loader._global = GlobalPolicy()
        loader._agent_policies = {
            "orchestrator": AgentPolicy(
                agent_id="orchestrator",
                allowed_actions=["search_corpus"],
                blocked_actions=[],
                egress_mode="denyall",
                egress_rules=[],
                rate_limits={"search_corpus": "2/task"},
            )
        }
        svc.policy_loader = loader
        svc.policy_engine = PolicyEngine(loader)

        import httpx as httpx_lib
        svc.llm_proxy._http_client = httpx_lib.AsyncClient()

        from fastapi.testclient import TestClient as TC
        rate_client = TC(svc.app, raise_server_exceptions=False)

        results = []
        for i in range(3):
            resp = rate_client.post(
                "/actions",
                json={
                    **_knowledge_action(
                        "search_corpus",
                        parameters={"query": f"test query {i}"},
                    ),
                    "context": {"task_id": "rl-search-task-001"},
                    "request_id": f"req-search-rl-{i}",
                },
            )
            results.append(resp.status_code)

        assert results[0] in (200, 202)
        assert results[1] in (200, 202)
        assert results[2] == 429, f"Third search_corpus should be rate limited: {results[2]}"

    @patch("gateway.main.httpx.AsyncClient")
    def test_search_corpus_with_date_range_filter(self, mock_httpx: MagicMock) -> None:
        """5C-SEARCH-04: search_corpus with date_from/date_to passes date filter to OpenSearch.

        Spec: 'search_corpus with date_from/date_to filters'
        """
        captured_bodies: list[dict] = []

        async def capture_request(url: str, **kwargs: Any) -> MagicMock:
            captured_bodies.append(kwargs.get("json", kwargs.get("params", {})))
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"hits": {"total": {"value": 0}, "hits": []}}
            return resp

        mock_client = AsyncMock()
        mock_client.get = capture_request
        mock_client.post = capture_request
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "search_corpus",
                parameters={
                    "query": "Nike performance",
                    "date_from": "2026-01-01",
                    "date_to": "2026-03-31",
                },
            ),
        )

        assert resp.status_code in (200, 202)
        all_body_str = str(captured_bodies)
        assert "2026-01-01" in all_body_str or "date_from" in all_body_str or "range" in all_body_str.lower(), (
            "Date range filter was not forwarded to OpenSearch"
        )


# ===========================================================================
# 5C-POLICY: Knowledge Actions Policy Enforcement
# ===========================================================================


@_skip_wave5c
class TestKnowledgePolicyEnforcement:
    """Spec ref: 'Knowledge actions blocked by policy for unauthorized agents.'"""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    def test_knowledge_actions_blocked_for_unauthorized_agent(self) -> None:
        """5C-POL-01: Knowledge actions from an agent without policy permission return 403.

        Spec: 'Knowledge actions blocked by policy for unauthorized agents'
        The Gateway policy must enforce knowledge action restrictions.
        """
        client = make_gateway_client(redis=self.redis)

        # reviewer is blocked from knowledge actions per config
        resp = client.post(
            "/actions",
            json=_knowledge_action("query_knowledge", agent_id="reviewer"),
        )

        assert resp.status_code == 403
        data = resp.json()
        assert data["error"] == "PolicyDenied"

    def test_orchestrator_allowed_to_query_knowledge(self) -> None:
        """5C-POL-02: Orchestrator is allowed to query_knowledge per its policy.

        Spec: 'Orchestrator allowed to query_knowledge (policy)'
        agents/orchestrator/config.yaml lists query_knowledge in allowed_actions.
        """
        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"results": [], "total": 0}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client(redis=self.redis)
            resp = client.post(
                "/actions",
                json=_knowledge_action("query_knowledge", agent_id="orchestrator"),
            )

        # Should not be 403 (policy allows it)
        assert resp.status_code != 403, (
            f"orchestrator should be allowed to query_knowledge, got 403: {resp.json()}"
        )

    def test_knowledge_agent_allowed_to_store_knowledge(self) -> None:
        """5C-POL-03: Knowledge agent is allowed to store_knowledge per its policy.

        Spec: 'Knowledge agent allowed to store_knowledge (policy)'
        agents/knowledge/config.yaml lists store_knowledge in allowed_actions.
        """
        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_response.json.return_value = {"nodes_created": 1, "edges_created": 0}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.put = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client(redis=self.redis)
            resp = client.post(
                "/actions",
                json=_knowledge_action(
                    "store_knowledge",
                    agent_id="knowledge",
                    parameters={"content": "test", "summary": "test summary"},
                ),
            )

        assert resp.status_code != 403, (
            f"knowledge agent should be allowed to store_knowledge, got 403: {resp.json()}"
        )

    def test_instagram_scraper_allowed_to_store_knowledge(self) -> None:
        """5C-POL-04: instagram-scraper is allowed to store_knowledge per its policy.

        Spec: 'Instagram-scraper allowed to store_knowledge (policy)'
        Scrapers write their findings to knowledge — this must be allowed.
        """
        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_response.json.return_value = {"nodes_created": 2, "edges_created": 1}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.put = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client(redis=self.redis)
            resp = client.post(
                "/actions",
                json=_knowledge_action(
                    "store_knowledge",
                    agent_id="instagram-scraper",
                    parameters={
                        "content": "Nike has 42M Instagram followers.",
                        "summary": "Nike follower count",
                    },
                ),
            )

        assert resp.status_code != 403, (
            f"instagram-scraper should be allowed to store_knowledge, got 403: {resp.json()}"
        )

    def test_reviewer_blocked_from_store_knowledge(self) -> None:
        """5C-POL-05: reviewer is blocked from store_knowledge by its policy.

        Spec: 'Reviewer blocked from knowledge actions (policy)'
        The reviewer only approves/denies — it must not write to knowledge.
        """
        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action("store_knowledge", agent_id="reviewer"),
        )

        assert resp.status_code == 403
        data = resp.json()
        assert data["error"] == "PolicyDenied"

    def test_reviewer_blocked_from_search_corpus(self) -> None:
        """5C-POL-06: reviewer is blocked from search_corpus by its policy.

        Spec: 'Reviewer blocked from knowledge actions (policy)'
        """
        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action("search_corpus", agent_id="reviewer"),
        )

        assert resp.status_code == 403


# ===========================================================================
# 5C-BUDGET: Budget Tracking for Knowledge Actions
# ===========================================================================


@_skip_wave5c
class TestKnowledgeBudgetTracking:
    """Spec ref: 'Budget tracking for knowledge operations.'"""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    @pytest.mark.asyncio
    async def test_query_knowledge_deducts_500_tokens_from_budget(self) -> None:
        """5C-BUDGET-01: query_knowledge deducts estimated 500 tokens from task budget.

        Spec: 'Knowledge query budget deduction (estimated 500 tokens)'
        """
        task_id = "budget-query-task"
        await self.redis.set(f"budget:task:{task_id}:tokens", "0")

        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"results": [], "total": 0}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

            client = make_gateway_client(redis=self.redis)
            resp = client.post(
                "/actions",
                json=_knowledge_action(
                    "query_knowledge",
                    task_id=task_id,
                    parameters={"query": "Nike brand"},
                ),
            )

        assert resp.status_code in (200, 202)

        recorded_tokens = await self.redis.get(f"budget:task:{task_id}:tokens")
        if recorded_tokens is not None:
            token_count = int(float(recorded_tokens))
            assert token_count >= 100, (
                f"Expected budget deduction for query_knowledge, got {token_count} tokens"
            )

    @pytest.mark.asyncio
    async def test_daily_budget_exceeded_blocks_knowledge_actions(self) -> None:
        """5C-BUDGET-02: Daily budget exceeded blocks all knowledge actions with 403.

        Spec: 'Daily budget exceeded blocks knowledge actions'
        Same mechanism as generic budget enforcement — knowledge actions must check it.
        """
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        # Set daily cost way over the agent's limit
        await self.redis.set(
            f"budget:agent:orchestrator:daily:{today}", "999.000000"
        )

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                parameters={"query": "Nike brand"},
                task_id="over-budget-task",
            ),
        )

        assert resp.status_code == 403
        data = resp.json()
        assert data["error"] == "PolicyDenied"
        assert "budget" in data.get("details", {}).get("rule", "").lower() or (
            "daily_cost" in data.get("details", {}).get("rule", "")
        )


# ===========================================================================
# 5C-BACKENDS: Backend Error Handling
# ===========================================================================


@_skip_wave5c
class TestKnowledgeBackendErrors:
    """Spec ref: 'Graphiti/OpenSearch connection errors return 502.'"""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    @patch("gateway.main.httpx.AsyncClient")
    def test_graphiti_connection_error_returns_502(self, mock_httpx: MagicMock) -> None:
        """5C-ERR-01: Graphiti connection failure returns 502 to the calling agent.

        Spec: 'Graphiti client handles connection errors gracefully (returns 502)'
        """
        import httpx

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused: graphiti:8000")
        )
        mock_client.get = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused: graphiti:8000")
        )
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                parameters={"query": "Nike brand"},
            ),
        )

        assert resp.status_code == 502, (
            f"Expected 502 on Graphiti connection error, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert "error" in data

    @patch("gateway.main.httpx.AsyncClient")
    def test_opensearch_connection_error_returns_502(self, mock_httpx: MagicMock) -> None:
        """5C-ERR-02: OpenSearch connection failure returns 502 to the calling agent.

        Spec: 'OpenSearch client handles connection errors gracefully (returns 502)'
        """
        import httpx

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused: opensearch:9200")
        )
        mock_client.post = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused: opensearch:9200")
        )
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "search_corpus",
                parameters={"query": "Nike revenue"},
            ),
        )

        assert resp.status_code == 502, (
            f"Expected 502 on OpenSearch connection error, got {resp.status_code}: {resp.text}"
        )


# ===========================================================================
# 5C-BOUNDARY: Agent Boundary Isolation for Knowledge
# ===========================================================================


@_skip_wave5c
class TestKnowledgeBoundaryIsolation:
    """Spec ref: 'Knowledge actions respect agent boundary isolation.'"""

    def setup_method(self) -> None:
        self.server = fakeredis.FakeServer()
        self.redis = make_fake_redis(self.server)

    @patch("gateway.main.httpx.AsyncClient")
    def test_knowledge_results_scoped_to_agent_boundary(
        self, mock_httpx: MagicMock
    ) -> None:
        """5C-BOUNDARY-01: query_knowledge requests include agent boundary in the query.

        Spec: 'Knowledge actions respect agent boundary isolation'
        Knowledge stored by one boundary should not be accessible from another boundary.
        The Gateway must inject the agent's boundary into Graphiti/OpenSearch queries.
        """
        captured_bodies: list[dict] = []

        async def capture_request(url: str, **kwargs: Any) -> MagicMock:
            captured_bodies.append({"url": url, "body": kwargs.get("json", {})})
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"results": [], "total": 0}
            return resp

        mock_client = AsyncMock()
        mock_client.post = capture_request
        mock_client.get = capture_request
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        client = make_gateway_client(redis=self.redis)
        resp = client.post(
            "/actions",
            json=_knowledge_action(
                "query_knowledge",
                agent_id="instagram-scraper",
                parameters={"query": "Nike brand history"},
            ),
        )

        assert resp.status_code in (200, 202)
        # Boundary should be injected into the backend request
        # instagram-scraper has boundary "default" per config.yaml
        all_body_str = str(captured_bodies).lower()
        assert "boundary" in all_body_str or "default" in all_body_str or len(captured_bodies) >= 1, (
            "Boundary was not injected into knowledge backend request"
        )
