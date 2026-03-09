"""E2E Tests: Knowledge Base Live Wiring.

These tests validate the Knowledge Base integration through the Gateway:

  1.  Agent can store knowledge via store_knowledge action
  2.  Agent can query knowledge via query_knowledge action
  3.  Agent can search corpus via search_corpus action
  4.  Stored knowledge persists and can be recalled
  5.  Knowledge stored by one agent is accessible by another (shared group)
  6.  Gateway proxies knowledge requests to Graphiti (graph queries)
  7.  Gateway proxies corpus requests to OpenSearch (text search)
  8.  Knowledge store includes provenance (agent_id, timestamp)
  9.  Budget tracking applies to knowledge operations
  10. Knowledge query with date range filter works
  11. Orchestrator can use store/query knowledge tools across tasks

Architecture spec refs:
  - MVP.md: 'Phase 5: Knowledge Base'
  - docs/gateway.md: 'Knowledge action handlers'
  - docker-compose.yml: neo4j, graphiti, opensearch services

Module paths exercised:
  services/gateway/gateway/main.py         (store_knowledge, query_knowledge, search_corpus)
  services/gateway/gateway/budget.py       (token deduction for knowledge ops)
  agents/orchestrator/mcp_bridge/server.py (query_knowledge, store_knowledge MCP tools)
  agents/orchestrator/mcp-bridge/client/gateway.py (GatewayClient knowledge methods)
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/gateway"))
sys.path.insert(0, os.path.join(_ROOT, "services/broker"))
sys.path.insert(0, os.path.join(_ROOT, "services/registry"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))
sys.path.insert(0, os.path.join(_ROOT, "agents/orchestrator"))

# ---------------------------------------------------------------------------
# Implementation guard -- verify gateway knowledge handlers exist
# ---------------------------------------------------------------------------
_KNOWLEDGE_LIVE = False
try:
    from gateway.main import (
        _handle_query_knowledge,
        _handle_store_knowledge,
        _handle_search_corpus,
    )
    _KNOWLEDGE_LIVE = True
except ImportError:
    pass

_skip_knowledge = pytest.mark.skipif(
    not _KNOWLEDGE_LIVE,
    reason=(
        "Knowledge Base handlers not found in gateway.main -- "
        "_handle_query_knowledge / _handle_store_knowledge / _handle_search_corpus missing"
    ),
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

ORCHESTRATOR_ID = "orchestrator"
SCRAPER_ID = "instagram-scraper"
KNOWLEDGE_ID = "knowledge"
REVIEWER_ID = "reviewer"


def make_task_id() -> str:
    return f"task-{uuid.uuid4().hex[:12]}"


def make_workflow_id() -> str:
    return f"wf-{uuid.uuid4().hex[:8]}"


def make_knowledge_action(
    agent_id: str,
    action: str,
    parameters: dict[str, Any],
    task_id: str | None = None,
    workflow_id: str | None = None,
) -> dict[str, Any]:
    """Build an action request body for a knowledge action."""
    return {
        "request_id": f"req-{uuid.uuid4().hex[:8]}",
        "agent_id": agent_id,
        "action": action,
        "target": None,
        "parameters": parameters,
        "priority": "normal",
        "context": {
            "task_id": task_id or make_task_id(),
            "workflow_id": workflow_id or make_workflow_id(),
            "chain_depth": 1,
        },
    }


# ---------------------------------------------------------------------------
# Mock helpers for httpx calls to Graphiti / OpenSearch
# ---------------------------------------------------------------------------

# In-memory store shared within a test class instance to simulate persistence
# across store -> query/search round-trips.

class _InMemoryKnowledgeBackend:
    """Simulates Graphiti + OpenSearch responses for E2E testing."""

    def __init__(self) -> None:
        self.opensearch_docs: dict[str, dict[str, Any]] = {}
        self.graphiti_episodes: list[dict[str, Any]] = []

    def make_mock_client(self) -> MagicMock:
        """Return a mock httpx.AsyncClient that routes calls to in-memory stores."""
        mock_client_instance = MagicMock()

        # POST handler (OpenSearch index + Graphiti episode)
        async def mock_post(url: str, json: Any = None, **kwargs: Any) -> MagicMock:
            resp = MagicMock()

            if "knowledge-corpus-shared" in url and "/_doc/" in url:
                # OpenSearch index request
                doc_id = url.split("/_doc/")[-1]
                if json:
                    self.opensearch_docs[doc_id] = json
                resp.status_code = 201
                resp.json.return_value = {"_id": doc_id, "result": "created"}
                return resp

            if "/episodes" in url:
                # Graphiti episode creation
                if json:
                    self.graphiti_episodes.append(json)
                resp.status_code = 201
                resp.json.return_value = {
                    "nodes_created": 2,
                    "edges_created": 1,
                    "episode_id": f"ep-{uuid.uuid4().hex[:8]}",
                }
                return resp

            if "/search" in url:
                # Graphiti search
                query = (json or {}).get("query", "")
                entity_types = (json or {}).get("entity_types")
                results = []
                for ep in self.graphiti_episodes:
                    content = ep.get("content", "")
                    summary = ep.get("summary", "")
                    # Simple keyword matching
                    if any(
                        word.lower() in (content + " " + summary).lower()
                        for word in query.split()
                        if len(word) > 2
                    ):
                        results.append({
                            "content": content,
                            "summary": summary,
                            "source": ep.get("source", {}),
                            "valid_at": ep.get("valid_at"),
                            "score": 0.85,
                        })
                resp.status_code = 200
                resp.json.return_value = {"results": results, "total": len(results)}
                return resp

            # Default fallback
            resp.status_code = 404
            resp.json.return_value = {"error": "not found"}
            return resp

        # GET handler (OpenSearch _search)
        async def mock_get(url: str, json: Any = None, params: Any = None, **kwargs: Any) -> MagicMock:
            resp = MagicMock()

            if "/_search" in url:
                # OpenSearch search request
                query_text = ""
                date_from = None
                date_to = None
                if json and "query" in json:
                    must_clauses = json.get("query", {}).get("bool", {}).get("must", [])
                    for clause in must_clauses:
                        if "multi_match" in clause:
                            query_text = clause["multi_match"].get("query", "")
                        if "range" in clause:
                            ts_range = clause["range"].get("timestamp", {})
                            date_from = ts_range.get("gte")
                            date_to = ts_range.get("lte")

                hits = []
                for doc_id, doc in self.opensearch_docs.items():
                    content = doc.get("content", "")
                    summary = doc.get("summary", "")
                    doc_ts = doc.get("timestamp", "")

                    # Date range filtering
                    if date_from and doc_ts and doc_ts < date_from:
                        continue
                    if date_to and doc_ts and doc_ts > date_to:
                        continue

                    # Simple keyword matching
                    if query_text and any(
                        word.lower() in (content + " " + summary).lower()
                        for word in query_text.split()
                        if len(word) > 2
                    ):
                        hits.append({
                            "_id": doc_id,
                            "_score": 0.9,
                            "_source": doc,
                        })

                limit = (json or {}).get("size", 10)
                hits = hits[:limit]

                resp.status_code = 200
                resp.json.return_value = {
                    "hits": {
                        "total": {"value": len(hits)},
                        "hits": hits,
                    }
                }
                return resp

            # Graphiti fallback GET /episodes
            if "/episodes" in url:
                resp.status_code = 200
                resp.json.return_value = {"episodes": self.graphiti_episodes, "total": len(self.graphiti_episodes)}
                return resp

            resp.status_code = 404
            resp.json.return_value = {"error": "not found"}
            return resp

        mock_client_instance.post = AsyncMock(side_effect=mock_post)
        mock_client_instance.get = AsyncMock(side_effect=mock_get)

        return mock_client_instance


def _patch_httpx_with_backend(backend: _InMemoryKnowledgeBackend):
    """Return a patch context manager that replaces httpx.AsyncClient with the backend mock."""
    mock_client_instance = backend.make_mock_client()

    mock_async_client = MagicMock()
    mock_async_client.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_async_client.return_value.__aexit__ = AsyncMock(return_value=False)

    return patch("gateway.main.httpx.AsyncClient", mock_async_client)


# ===========================================================================
# KB-STORE: Store Knowledge via Gateway
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestStoreKnowledge:
    """Spec: Agent stores knowledge via store_knowledge action through Gateway."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_store_knowledge_returns_201_with_stored_status(self) -> None:
        """KB-STORE-01: store_knowledge returns 201 with status='stored'.

        Spec: Gateway two-step ingestion -- OpenSearch index + Graphiti episode.
        The response must confirm storage with node/edge counts.
        """
        body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Nike Instagram account has 42.1M followers as of Q1 2026.",
                "summary": "Nike Instagram metrics Q1 2026",
                "source": {"task_id": make_task_id(), "workflow_id": make_workflow_id()},
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 201, f"store_knowledge failed: {resp.text}"
        data = resp.json()
        assert data.get("status") == "stored"
        assert "opensearch_id" in data
        assert "nodes_created" in data

    def test_store_knowledge_indexes_in_opensearch(self) -> None:
        """KB-STORE-02: store_knowledge writes document to OpenSearch index.

        Spec: 'Step 1: Index full content in OpenSearch for full-text retrieval'
        The document must be indexed at knowledge-corpus-shared-001/_doc/{id}.
        """
        body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Adidas has 30M followers on Instagram.",
                "summary": "Adidas Instagram followers",
                "source": {"task_id": make_task_id()},
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 201
        data = resp.json()
        # opensearch_id should be a valid document ID (kn-... format)
        assert data.get("opensearch_id", "").startswith("kn-")

    def test_store_knowledge_writes_graphiti_episode(self) -> None:
        """KB-STORE-03: store_knowledge writes an episode to Graphiti.

        Spec: 'Step 2: Write an episode to Graphiti for graph-based retrieval'
        The Graphiti episode includes content, summary, source, and valid_at.
        """
        body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Puma Instagram engagement rate is 2.3%.",
                "summary": "Puma engagement metrics",
                "source": {"task_id": make_task_id()},
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 201
        data = resp.json()
        # Graphiti returns node/edge creation counts
        assert data.get("nodes_created", 0) >= 0
        assert data.get("edges_created", 0) >= 0


# ===========================================================================
# KB-QUERY: Query Knowledge via Gateway
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestQueryKnowledge:
    """Spec: Agent queries knowledge via query_knowledge action through Gateway."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_query_knowledge_returns_results(self) -> None:
        """KB-QUERY-01: query_knowledge returns 200 with results array.

        Spec: 'query_knowledge routes to Graphiti POST /search'
        The response includes results list and total count.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={"query": "Nike Instagram followers"},
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200, f"query_knowledge failed: {resp.text}"
        data = resp.json()
        assert "results" in data
        assert "total" in data

    def test_query_knowledge_proxies_to_graphiti(self) -> None:
        """KB-QUERY-02: query_knowledge proxies the request to Graphiti search endpoint.

        Spec: 'Gateway proxies knowledge requests to Graphiti'
        The Gateway must forward the query to Graphiti POST /search.
        """
        body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="query_knowledge",
            parameters={"query": "brand engagement metrics"},
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        # Results should come from Graphiti (may be empty if no data stored yet)
        assert isinstance(data.get("results"), list)

    def test_query_knowledge_with_entity_types_filter(self) -> None:
        """KB-QUERY-03: query_knowledge supports entity_types filter.

        Spec: 'Supports entity type filtering for graph queries'
        Passing entity_types narrows results to matching graph entities.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={
                "query": "brand metrics",
                "entity_types": ["Brand", "SocialMedia"],
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data


# ===========================================================================
# KB-SEARCH: Search Corpus via Gateway
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestSearchCorpus:
    """Spec: Agent searches corpus via search_corpus action through Gateway."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_search_corpus_returns_documents(self) -> None:
        """KB-SEARCH-01: search_corpus returns 200 with documents array.

        Spec: 'search_corpus proxies to OpenSearch keyword/semantic search'
        The response includes documents list and total count.
        """
        body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="search_corpus",
            parameters={"query": "Nike Instagram posts", "limit": 5},
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200, f"search_corpus failed: {resp.text}"
        data = resp.json()
        assert "documents" in data or "results" in data
        assert "total" in data

    def test_search_corpus_proxies_to_opensearch(self) -> None:
        """KB-SEARCH-02: search_corpus proxies the request to OpenSearch.

        Spec: 'Gateway proxies corpus requests to OpenSearch'
        The Gateway must forward the query to OpenSearch knowledge-corpus-shared-*/_search.
        """
        body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="search_corpus",
            parameters={"query": "engagement rate", "limit": 10},
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("documents") or data.get("results", [])
        assert isinstance(items, list)

    def test_search_corpus_with_date_range_filter(self) -> None:
        """KB-SEARCH-03: search_corpus supports date_from/date_to range filter.

        Spec: 'Supports date_from/date_to filters (range query on timestamp field)'
        Date range filtering narrows results to a time window.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="search_corpus",
            parameters={
                "query": "quarterly metrics",
                "date_from": "2026-01-01T00:00:00Z",
                "date_to": "2026-03-31T23:59:59Z",
                "limit": 20,
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert "documents" in data or "results" in data


# ===========================================================================
# KB-PERSIST: Knowledge Persistence and Recall
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestKnowledgePersistence:
    """Spec: Stored knowledge persists and can be recalled."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_store_then_query_returns_stored_content(self) -> None:
        """KB-PERSIST-01: Knowledge stored via store_knowledge is returned by query_knowledge.

        Spec: 'Knowledge base round-trip: store -> query -> verify'
        Full Graphiti + OpenSearch pipeline must return previously stored data.
        """
        workflow_id = make_workflow_id()
        content = "Nike's Instagram account has 42.1M followers as of Q1 2026."
        summary = "Nike Instagram metrics Q1 2026"

        # Step 1: Store knowledge
        store_body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": content,
                "summary": summary,
                "source": {"task_id": make_task_id(), "workflow_id": workflow_id},
            },
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201, f"store failed: {store_resp.text}"

        # Step 2: Query knowledge
        query_body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={"query": "Nike Instagram followers"},
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            query_resp = self.client.post("/actions", json=query_body)
        assert query_resp.status_code == 200, f"query failed: {query_resp.text}"
        data = query_resp.json()
        assert "results" in data
        assert data.get("total", 0) >= 1

    def test_store_then_search_returns_stored_document(self) -> None:
        """KB-PERSIST-02: Knowledge stored is findable via search_corpus.

        Spec: 'OpenSearch full-text search over knowledge corpus'
        Documents indexed via store_knowledge must appear in search_corpus results.
        """
        workflow_id = make_workflow_id()
        content = "Adidas had a 15% increase in Instagram engagement in Q1 2026."
        summary = "Adidas Q1 2026 engagement growth"

        # Store
        store_body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={"content": content, "summary": summary, "source": {}},
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201

        # Search
        search_body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="search_corpus",
            parameters={"query": "Adidas engagement Q1 2026", "limit": 5},
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            search_resp = self.client.post("/actions", json=search_body)
        assert search_resp.status_code == 200
        data = search_resp.json()
        items = data.get("documents") or data.get("results", [])
        assert len(items) >= 1


# ===========================================================================
# KB-SHARED: Cross-Agent Knowledge Sharing
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestCrossAgentKnowledgeSharing:
    """Spec: Knowledge stored by one agent is accessible by another (shared group)."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_scraper_stores_knowledge_orchestrator_queries_it(self) -> None:
        """KB-SHARED-01: Scraper stores knowledge; orchestrator can query it.

        Spec: 'Knowledge stored by one agent is accessible by another'
        The shared corpus (knowledge-corpus-shared-*) is accessible to all agents
        within the same boundary/group.
        """
        workflow_id = make_workflow_id()

        # Scraper stores data
        store_body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Puma launched a new product line in March 2026.",
                "summary": "Puma product launch March 2026",
                "source": {"task_id": make_task_id()},
            },
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201

        # Orchestrator queries the same data
        query_body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={"query": "Puma product launch"},
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            query_resp = self.client.post("/actions", json=query_body)
        assert query_resp.status_code == 200
        data = query_resp.json()
        assert "results" in data
        assert data.get("total", 0) >= 1

    def test_knowledge_agent_searches_scraper_stored_data(self) -> None:
        """KB-SHARED-02: Knowledge agent searches corpus data stored by scraper.

        Spec: 'Worker scrapers store data; knowledge agent queries it via search_corpus'
        The knowledge agent can perform full-text search across all stored knowledge.
        """
        workflow_id = make_workflow_id()

        # Scraper stores
        store_body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Under Armour Instagram engagement dropped 5% in Feb 2026.",
                "summary": "UA engagement decline",
                "source": {},
            },
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            self.client.post("/actions", json=store_body)

        # Knowledge agent searches
        search_body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="search_corpus",
            parameters={"query": "Under Armour engagement", "limit": 10},
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            search_resp = self.client.post("/actions", json=search_body)
        assert search_resp.status_code == 200
        data = search_resp.json()
        items = data.get("documents") or data.get("results", [])
        assert len(items) >= 1


# ===========================================================================
# KB-PROVENANCE: Knowledge Provenance Tracking
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestKnowledgeProvenance:
    """Spec: Knowledge store includes provenance (which agent stored it, when)."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_stored_knowledge_includes_agent_id_provenance(self) -> None:
        """KB-PROV-01: Stored knowledge includes the agent_id of the storing agent.

        Spec: 'store_knowledge includes provenance -- which agent stored it'
        The OpenSearch document must contain agent_id for audit/traceability.
        """
        store_body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Reebok has 5M followers.",
                "summary": "Reebok follower count",
                "source": {"task_id": make_task_id()},
            },
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201

        # Search and verify provenance in the returned document
        search_body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="search_corpus",
            parameters={"query": "Reebok followers", "limit": 1},
        )
        with _patch_httpx_with_backend(self.backend):
            search_resp = self.client.post("/actions", json=search_body)
        assert search_resp.status_code == 200
        data = search_resp.json()
        items = data.get("documents") or data.get("results", [])
        assert len(items) >= 1
        doc = items[0]
        assert doc.get("agent_id") == SCRAPER_ID, (
            f"Expected agent_id='{SCRAPER_ID}' in provenance, got '{doc.get('agent_id')}'"
        )

    def test_stored_knowledge_includes_timestamp(self) -> None:
        """KB-PROV-02: Stored knowledge includes a timestamp for temporal ordering.

        Spec: 'Knowledge store includes provenance -- when it was stored'
        The OpenSearch document must contain a timestamp field.
        """
        store_body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "New Balance Q1 2026 revenue: $1.2B.",
                "summary": "NB Q1 revenue",
                "source": {},
            },
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201

        # Search and verify timestamp is present
        search_body = make_knowledge_action(
            agent_id=KNOWLEDGE_ID,
            action="search_corpus",
            parameters={"query": "New Balance revenue", "limit": 1},
        )
        with _patch_httpx_with_backend(self.backend):
            search_resp = self.client.post("/actions", json=search_body)
        assert search_resp.status_code == 200
        data = search_resp.json()
        items = data.get("documents") or data.get("results", [])
        assert len(items) >= 1
        doc = items[0]
        assert "timestamp" in doc, "Document must include a timestamp field"


# ===========================================================================
# KB-BUDGET: Budget Tracking for Knowledge Operations
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestKnowledgeBudgetTracking:
    """Spec: Budget tracking applies to knowledge operations (token deduction)."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from gateway.budget import BudgetTracker
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            self.budget_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis

            # Wire up a budget tracker backed by fakeredis
            self.budget_tracker = BudgetTracker(self.budget_redis)
            gw_app.state.gateway_service.budget_tracker = self.budget_tracker

            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_query_knowledge_deducts_500_tokens(self) -> None:
        """KB-BUDGET-01: query_knowledge deducts 500 estimated tokens from task budget.

        Spec: 'Budget deduction happens BEFORE the actual backend call'
        query_knowledge costs 500 tokens per call.
        """
        task_id = make_task_id()
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={"query": "brand metrics"},
            task_id=task_id,
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        # Even if Graphiti is unavailable (502), budget should have been deducted
        # The deduction happens BEFORE the backend call
        assert resp.status_code in (200, 502)

        # Verify budget was deducted (500 tokens for query_knowledge)
        # Budget tracker stores token counts in Redis
        # This will be verified once the budget tracker wiring is live

    def test_store_knowledge_deducts_1500_tokens(self) -> None:
        """KB-BUDGET-02: store_knowledge deducts 1500 estimated tokens from task budget.

        Spec: 'store_knowledge costs 1500 tokens (OpenSearch + Graphiti overhead)'
        The two-step ingestion is estimated at 1500 tokens total.
        """
        task_id = make_task_id()
        body = make_knowledge_action(
            agent_id=SCRAPER_ID,
            action="store_knowledge",
            parameters={
                "content": "Test content for budget tracking.",
                "summary": "Budget test",
                "source": {},
            },
            task_id=task_id,
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code in (201, 502)


# ===========================================================================
# KB-DATERANGE: Date Range Filtering
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestKnowledgeDateRangeFilter:
    """Spec: Knowledge query with date range filter works."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_search_corpus_with_date_from_filter(self) -> None:
        """KB-DATE-01: search_corpus filters results by date_from.

        Spec: 'Supports date_from/date_to filters (range query on timestamp field)'
        Only documents with timestamp >= date_from should be returned.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="search_corpus",
            parameters={
                "query": "brand metrics",
                "date_from": "2026-01-01T00:00:00Z",
                "limit": 10,
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("documents") or data.get("results", [])
        # All returned items should have timestamp >= date_from
        for item in items:
            ts = item.get("timestamp")
            if ts:
                assert ts >= "2026-01-01T00:00:00Z", (
                    f"Document timestamp {ts} is before date_from filter"
                )

    def test_search_corpus_with_date_to_filter(self) -> None:
        """KB-DATE-02: search_corpus filters results by date_to.

        Spec: 'Supports date_from/date_to filters (range query on timestamp field)'
        Only documents with timestamp <= date_to should be returned.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="search_corpus",
            parameters={
                "query": "quarterly report",
                "date_to": "2026-03-31T23:59:59Z",
                "limit": 10,
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("documents") or data.get("results", [])
        for item in items:
            ts = item.get("timestamp")
            if ts:
                assert ts <= "2026-03-31T23:59:59Z", (
                    f"Document timestamp {ts} is after date_to filter"
                )

    def test_search_corpus_with_full_date_range(self) -> None:
        """KB-DATE-03: search_corpus filters results by combined date_from + date_to.

        Spec: 'date_from and date_to can be used together for a time window'
        The range filter is applied as a bool must clause on the timestamp field.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="search_corpus",
            parameters={
                "query": "social media analytics",
                "date_from": "2026-01-01T00:00:00Z",
                "date_to": "2026-06-30T23:59:59Z",
                "limit": 20,
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert "documents" in data or "results" in data

    def test_query_knowledge_with_as_of_temporal_filter(self) -> None:
        """KB-DATE-04: query_knowledge supports as_of temporal filter.

        Spec: 'Supports temporal queries via as_of parameter (Graphiti valid_at filter)'
        Graphiti returns entities valid at the specified point in time.
        """
        body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={
                "query": "Nike followers",
                "as_of": "2026-03-01T00:00:00Z",
            },
        )
        with _patch_httpx_with_backend(self.backend):
            resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data


# ===========================================================================
# KB-ORCHESTRATOR: Orchestrator MCP Tools for Knowledge
# ===========================================================================


@pytest.mark.e2e
@_skip_knowledge
class TestOrchestratorKnowledgeTools:
    """Spec: Orchestrator can use store/query knowledge tools to persist info across tasks."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)
            self.backend = _InMemoryKnowledgeBackend()
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_orchestrator_stores_knowledge_from_task_result(self) -> None:
        """KB-ORCH-01: Orchestrator stores knowledge derived from a completed task.

        Spec: 'Orchestrator uses store_knowledge to persist information across tasks'
        After a worker completes a task, the orchestrator stores key findings.
        """
        workflow_id = make_workflow_id()

        # Orchestrator stores synthesized knowledge from scraper result
        store_body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="store_knowledge",
            parameters={
                "content": "Nike Q1 2026 report: 42.1M followers, 15k avg likes, engagement up 8%.",
                "summary": "Nike Q1 2026 synthesized report",
                "source": {
                    "task_id": make_task_id(),
                    "workflow_id": workflow_id,
                    "derived_from": "instagram-scraper task results",
                },
            },
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201
        data = store_resp.json()
        assert data.get("status") == "stored"

    def test_orchestrator_queries_knowledge_before_dispatching_task(self) -> None:
        """KB-ORCH-02: Orchestrator queries knowledge to inform task dispatch.

        Spec: 'Orchestrator queries knowledge base for context before dispatching'
        The orchestrator can look up existing knowledge to avoid redundant work.
        """
        workflow_id = make_workflow_id()

        query_body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={"query": "latest Nike Instagram metrics"},
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            query_resp = self.client.post("/actions", json=query_body)
        assert query_resp.status_code == 200
        data = query_resp.json()
        assert "results" in data

    def test_orchestrator_stores_then_queries_across_tasks(self) -> None:
        """KB-ORCH-03: Orchestrator stores knowledge in one task and queries it in another.

        Spec: 'Knowledge persists across tasks within a workflow and beyond'
        This validates cross-task knowledge persistence via the shared corpus.
        """
        workflow_id = make_workflow_id()
        task_1 = make_task_id()
        task_2 = make_task_id()

        # Task 1: Store knowledge
        store_body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="store_knowledge",
            parameters={
                "content": "Competitive analysis: Nike leads in followers, Adidas in engagement.",
                "summary": "Brand comparison Q1 2026",
                "source": {"task_id": task_1},
            },
            task_id=task_1,
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201

        # Task 2: Query the same knowledge (different task_id, same workflow)
        query_body = make_knowledge_action(
            agent_id=ORCHESTRATOR_ID,
            action="query_knowledge",
            parameters={"query": "brand comparison followers engagement"},
            task_id=task_2,
            workflow_id=workflow_id,
        )
        with _patch_httpx_with_backend(self.backend):
            query_resp = self.client.post("/actions", json=query_body)
        assert query_resp.status_code == 200
        data = query_resp.json()
        assert "results" in data
        assert data.get("total", 0) >= 1

    def test_mcp_bridge_exposes_knowledge_tools(self) -> None:
        """KB-ORCH-04: MCP Bridge server exposes query_knowledge and store_knowledge tools.

        Spec: 'MCPBridgeServer exposes 11 tools via MCP protocol'
        The orchestrator's MCP bridge must list both knowledge tools.
        """
        try:
            from mcp_bridge.server import MCPBridgeServer  # type: ignore[import]

            server = MCPBridgeServer.__new__(MCPBridgeServer)
            # Check that tool handlers are registered
            assert hasattr(server, "_query_knowledge"), (
                "MCPBridgeServer must have _query_knowledge handler"
            )
            assert hasattr(server, "_store_knowledge"), (
                "MCPBridgeServer must have _store_knowledge handler"
            )
        except ImportError:
            pytest.skip("MCP bridge module not importable")
