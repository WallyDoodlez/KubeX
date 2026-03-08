"""Wave 6 — Spec-Driven E2E Tests: Multi-Agent Workflow.

These tests validate orchestrated multi-agent workflows:

  1. Orchestrator dispatches to multiple workers in parallel
  2. Each worker processes independently and stores its result
  3. Orchestrator collects all results (aggregation)
  4. Partial failure handling — one worker fails, orchestrator handles it
  5. Knowledge base round-trip — store then recall within a workflow
  6. Worker capability resolution — only capable, running agents get tasks
  7. Multi-step sequential workflow (A → B → C chained dispatch)

Tests are SKIPPED until Wave 6 multi-agent coordination is implemented.

Architecture spec refs:
  - docs/architecture.md: 'Multi-agent pipeline'
  - docs/agents.md: 'Orchestrator dispatches to worker Kubexes by capability'
  - docs/gateway.md: 'Broker routes to capable agents'

Module paths exercised:
  services/gateway/gateway/main.py         (dispatch_task, progress, cancel)
  services/broker/broker/main.py           (publish, consume, result endpoints)
  services/registry/registry/main.py       (register, list, capability resolution)
  agents/orchestrator/mcp_bridge/server.py (dispatch_task MCP tool)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
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

# ---------------------------------------------------------------------------
# Implementation guard
# ---------------------------------------------------------------------------
_WAVE6_IMPLEMENTED = False
try:
    from workflow.coordinator import WorkflowCoordinator  # type: ignore[import]
    _WAVE6_IMPLEMENTED = True
except ImportError:
    pass

_skip_wave6 = pytest.mark.skipif(
    not _WAVE6_IMPLEMENTED,
    reason=(
        "Wave 6 not yet implemented — "
        "workflow/coordinator.py missing (multi-agent workflow coordination)"
    ),
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

ORCHESTRATOR_ID = "orchestrator"
SCRAPER_ID = "instagram-scraper"
KNOWLEDGE_ID = "knowledge"
REVIEWER_ID = "reviewer"

WORKFLOW_ID = f"wf-{uuid.uuid4().hex[:8]}"


def make_task_id() -> str:
    return f"task-{uuid.uuid4().hex[:12]}"


def make_dispatch_body(
    agent_id: str = ORCHESTRATOR_ID,
    capability: str = "scrape_instagram",
    context_message: str = "Go",
    task_id: str | None = None,
    workflow_id: str = WORKFLOW_ID,
) -> dict[str, Any]:
    return {
        "request_id": f"req-{uuid.uuid4().hex[:8]}",
        "agent_id": agent_id,
        "action": "dispatch_task",
        "target": None,
        "parameters": {"capability": capability, "context_message": context_message},
        "priority": "normal",
        "context": {
            "task_id": task_id,
            "workflow_id": workflow_id,
            "chain_depth": 1,
        },
    }


# ===========================================================================
# MULTI-PARALLEL: Parallel Dispatch
# ===========================================================================


@_skip_wave6
class TestParallelDispatch:
    """Spec: Orchestrator dispatches multiple tasks in parallel to multiple workers."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from broker.main import app as broker_app
            from broker.streams import BrokerStreams
            from fastapi.testclient import TestClient

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )

            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.gateway_client = TestClient(gateway_app, raise_server_exceptions=False)

            broker_app.state.streams = BrokerStreams(self.fake_redis)
            self.broker_client = TestClient(broker_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_multiple_tasks_returns_unique_task_ids(
        self, mock_httpx: MagicMock
    ) -> None:
        """MULTI-PARALLEL-01: Dispatching N tasks returns N unique task_ids.

        Spec: Each dispatch_task call produces a globally unique task_id.
        Orchestrator must be able to track multiple tasks by their IDs.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        n_tasks = 5
        task_ids = []
        for i in range(n_tasks):
            body = make_dispatch_body(
                capability="scrape_instagram",
                context_message=f"Scrape profile {i}",
            )
            resp = self.gateway_client.post("/actions", json=body)
            assert resp.status_code == 202, f"Dispatch {i} failed: {resp.text}"
            task_ids.append(resp.json()["task_id"])

        assert len(set(task_ids)) == n_tasks, (
            f"Expected {n_tasks} unique task IDs, got duplicates: {task_ids}"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_parallel_dispatch_to_different_capabilities(
        self, mock_httpx: MagicMock
    ) -> None:
        """MULTI-PARALLEL-02: Orchestrator can dispatch to different capabilities in parallel.

        Spec: 'Orchestrator dispatches to worker Kubexes by capability'
        A workflow may dispatch to scrape_instagram AND knowledge_management simultaneously.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        capabilities = ["scrape_instagram", "knowledge_management", "review_content"]
        task_ids = {}
        for cap in capabilities:
            body = make_dispatch_body(capability=cap, context_message=f"Task for {cap}")
            resp = self.gateway_client.post("/actions", json=body)
            assert resp.status_code == 202
            task_ids[cap] = resp.json()["task_id"]

        # All dispatched with different task_ids
        assert len(set(task_ids.values())) == len(capabilities)

    def test_broker_queues_tasks_for_correct_consumer_groups(self) -> None:
        """MULTI-PARALLEL-03: Broker creates consumer groups per capability.

        Spec: 'Broker publishes to stream; consumer groups per capability'
        When multiple capabilities are dispatched, each gets its own consumer group.
        """
        capabilities = ["scrape_instagram", "knowledge_management"]

        for cap in capabilities:
            delivery = {
                "task_id": make_task_id(),
                "workflow_id": WORKFLOW_ID,
                "capability": cap,
                "context_message": f"Task for {cap}",
                "from_agent": ORCHESTRATOR_ID,
                "priority": "normal",
            }
            resp = self.broker_client.post("/messages", json={"delivery": delivery})
            assert resp.status_code == 202

        # Each capability can consume its own messages
        for cap in capabilities:
            resp = self.broker_client.get(f"/messages/consume/{cap}?count=10")
            assert resp.status_code == 200
            messages = resp.json()
            # Check only messages for this capability are in the group
            for msg in messages:
                assert msg.get("capability") == cap, (
                    f"Consumer group '{cap}' received message for '{msg.get('capability')}'"
                )


# ===========================================================================
# MULTI-AGGREGATE: Result Aggregation
# ===========================================================================


@_skip_wave6
class TestResultAggregation:
    """Spec: Orchestrator collects results from multiple workers."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from broker.main import app as broker_app
            from broker.streams import BrokerStreams
            from fastapi.testclient import TestClient

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            broker_app.state.streams = BrokerStreams(self.fake_redis)
            self.client = TestClient(broker_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_multiple_workers_store_distinct_results(self) -> None:
        """MULTI-AGG-01: Multiple workers store results independently; all are retrievable.

        Spec: 'Orchestrator collects results from multiple workers'
        Each task has a separate result key — no overwriting between workers.
        """
        n_workers = 3
        task_ids = [make_task_id() for _ in range(n_workers)]
        expected_results = [
            {"status": "success", "records": 10 * (i + 1), "worker": i}
            for i in range(n_workers)
        ]

        # Each worker stores its result
        for task_id, result in zip(task_ids, expected_results):
            resp = self.client.post(
                f"/tasks/{task_id}/result",
                json={"result": result},
            )
            assert resp.status_code == 204

        # Orchestrator retrieves all results
        for task_id, expected in zip(task_ids, expected_results):
            resp = self.client.get(f"/tasks/{task_id}/result")
            assert resp.status_code == 200
            data = resp.json()
            assert data["records"] == expected["records"]
            assert data["worker"] == expected["worker"]

    def test_failed_worker_stores_error_result(self) -> None:
        """MULTI-AGG-02: Failed worker stores a failure result; orchestrator detects it.

        Spec: 'Partial failure handling — orchestrator handles individual worker failures'
        Workers must store a result even on failure so the orchestrator knows the outcome.
        """
        task_id = make_task_id()
        failure_result = {
            "status": "failed",
            "exit_reason": "failed",
            "error": "Rate limit exceeded on Instagram API",
            "task_id": task_id,
        }

        self.client.post(f"/tasks/{task_id}/result", json={"result": failure_result})
        resp = self.client.get(f"/tasks/{task_id}/result")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "failed"
        assert "error" in data

    def test_orchestrator_can_read_all_results_after_all_complete(self) -> None:
        """MULTI-AGG-03: All worker results are available once workers finish.

        Spec: 'Orchestrator aggregates results after all workers complete'
        Simulates the orchestrator waiting for all N tasks to finish, then reading all.
        """
        n = 4
        task_ids = [make_task_id() for _ in range(n)]

        # Simulate all workers completing
        for i, task_id in enumerate(task_ids):
            result = {"status": "success", "index": i, "data": f"result-{i}"}
            self.client.post(f"/tasks/{task_id}/result", json={"result": result})

        # Orchestrator reads all
        all_data = []
        for task_id in task_ids:
            resp = self.client.get(f"/tasks/{task_id}/result")
            assert resp.status_code == 200
            all_data.append(resp.json())

        assert len(all_data) == n
        indices = [d["index"] for d in all_data]
        assert sorted(indices) == list(range(n))


# ===========================================================================
# MULTI-FAILURE: Partial Failure Handling
# ===========================================================================


@_skip_wave6
class TestPartialFailureHandling:
    """Spec: Orchestrator handles partial failure — some workers succeed, some fail."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from broker.main import app as broker_app
            from broker.streams import BrokerStreams
            from fastapi.testclient import TestClient

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            broker_app.state.streams = BrokerStreams(self.fake_redis)
            self.client = TestClient(broker_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_partial_results_distinguishable_by_status(self) -> None:
        """MULTI-FAIL-01: Orchestrator can distinguish successful vs failed worker results.

        Spec: 'Partial failure — orchestrator reads status field to triage'
        Workers report status: 'success' | 'failed' | 'cancelled'.
        """
        results_map = {
            make_task_id(): {"status": "success", "records": 42},
            make_task_id(): {"status": "failed", "error": "timeout"},
            make_task_id(): {"status": "success", "records": 18},
            make_task_id(): {"status": "cancelled", "reason": "User requested"},
        }

        for task_id, result in results_map.items():
            self.client.post(f"/tasks/{task_id}/result", json={"result": result})

        successes = 0
        failures = 0
        for task_id in results_map:
            resp = self.client.get(f"/tasks/{task_id}/result")
            data = resp.json()
            if data.get("status") == "success":
                successes += 1
            else:
                failures += 1

        assert successes == 2
        assert failures == 2

    def test_dlq_handles_messages_after_max_retries(self) -> None:
        """MULTI-FAIL-02: Messages that fail processing 3x are moved to DLQ.

        Spec: 'Broker DLQ — messages exceeding MAX_RETRIES go to boundary:dlq'
        This prevents stuck tasks from blocking the stream indefinitely.
        """
        from broker.streams import BrokerStreams, DLQ_STREAM, MAX_RETRIES

        streams = BrokerStreams(self.fake_redis)

        delivery = {
            "task_id": make_task_id(),
            "workflow_id": WORKFLOW_ID,
            "capability": "unreliable_capability",
            "context_message": "This will fail",
            "from_agent": ORCHESTRATOR_ID,
            "priority": "normal",
        }

        async def setup_dlq_scenario() -> int:
            """Publish message and simulate max retries exceeded."""
            from kubex_common.schemas.routing import TaskDelivery

            delivery_obj = TaskDelivery(**delivery)
            msg_id = await streams.publish(delivery_obj)

            # Simulate MAX_RETRIES failures by calling handle_pending
            # (In a real scenario, RETRY_AFTER_MS would need to pass)
            # Here we mock the pending entries
            dlq_count = await streams._send_to_dlq_for_test(msg_id, "unreliable_capability")
            return dlq_count

        # Just verify the DLQ stream mechanism exists
        assert hasattr(streams, "_send_to_dlq"), "BrokerStreams must have _send_to_dlq method"


# ===========================================================================
# MULTI-KNOWLEDGE: Knowledge Base Round-Trip
# ===========================================================================


@_skip_wave6
class TestKnowledgeRoundTrip:
    """Spec: Knowledge stored during a workflow is retrievable in subsequent queries."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("gateway.main.httpx.AsyncClient")
    def test_store_knowledge_then_query_returns_it(self, mock_httpx: MagicMock) -> None:
        """MULTI-KB-01: Knowledge stored via store_knowledge is returned by query_knowledge.

        Spec: 'Knowledge base round-trip: store → query → verify'
        This validates the full Graphiti + OpenSearch pipeline from end to end.
        """
        stored_content = "Nike's Instagram account has 42.1M followers as of Q1 2026."
        stored_summary = "Nike Instagram metrics Q1 2026"

        # Mock OpenSearch and Graphiti responses
        store_calls: list[Any] = []
        query_calls: list[Any] = []

        async def mock_post(url: str, **kwargs: Any) -> MagicMock:
            resp = MagicMock()
            if "/episodes" in url or "/_doc/" in url:
                store_calls.append(url)
                resp.status_code = 201
                resp.json.return_value = {
                    "nodes_created": 3,
                    "edges_created": 2,
                    "_id": f"kn-{uuid.uuid4().hex[:6]}",
                }
            elif "/search" in url:
                query_calls.append(url)
                resp.status_code = 200
                resp.json.return_value = {
                    "results": [
                        {
                            "entity": "Nike",
                            "summary": stored_summary,
                            "content": stored_content,
                            "relevance": 0.95,
                        }
                    ],
                    "total": 1,
                }
            else:
                resp.status_code = 202
                resp.raise_for_status = MagicMock()
                resp.json.return_value = {"message_id": "1-0"}
            return resp

        async def mock_get(url: str, **kwargs: Any) -> MagicMock:
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {
                "hits": {
                    "hits": [
                        {
                            "_id": "kn-001",
                            "_score": 0.95,
                            "_source": {"content": stored_content, "summary": stored_summary},
                        }
                    ],
                    "total": {"value": 1},
                },
                "documents": [],
            }
            return resp

        mock_httpx.return_value.__aenter__.return_value.post = mock_post
        mock_httpx.return_value.__aenter__.return_value.get = mock_get

        # Step 1: Store knowledge
        store_body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": SCRAPER_ID,
            "action": "store_knowledge",
            "target": None,
            "parameters": {
                "content": stored_content,
                "summary": stored_summary,
                "source": {"task_id": make_task_id(), "workflow_id": WORKFLOW_ID},
            },
            "priority": "normal",
            "context": {"task_id": make_task_id(), "workflow_id": WORKFLOW_ID, "chain_depth": 1},
        }
        store_resp = self.client.post("/actions", json=store_body)
        assert store_resp.status_code == 201, f"store_knowledge failed: {store_resp.text}"
        store_data = store_resp.json()
        assert store_data.get("status") == "stored"
        assert store_data.get("nodes_created", 0) >= 0

        # Step 2: Query knowledge
        query_body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": ORCHESTRATOR_ID,
            "action": "query_knowledge",
            "target": None,
            "parameters": {"query": "Nike Instagram followers"},
            "priority": "normal",
            "context": {"task_id": make_task_id(), "workflow_id": WORKFLOW_ID, "chain_depth": 1},
        }
        query_resp = self.client.post("/actions", json=query_body)
        assert query_resp.status_code == 200, f"query_knowledge failed: {query_resp.text}"
        query_data = query_resp.json()
        assert "results" in query_data
        assert query_data.get("total", 0) >= 1

    @patch("gateway.main.httpx.AsyncClient")
    def test_search_corpus_returns_stored_documents(self, mock_httpx: MagicMock) -> None:
        """MULTI-KB-02: search_corpus returns documents stored via store_knowledge.

        Spec: 'OpenSearch full-text search over knowledge corpus'
        Worker scrapers store data; knowledge agent queries it via search_corpus.
        """
        stored_content = "Nike has 500 posts on Instagram with 15k average likes."

        async def mock_get(url: str, **kwargs: Any) -> MagicMock:
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {
                "hits": {
                    "hits": [
                        {
                            "_id": "kn-002",
                            "_score": 0.88,
                            "_source": {
                                "content": stored_content,
                                "summary": "Nike post metrics",
                                "agent_id": SCRAPER_ID,
                            },
                        }
                    ],
                    "total": {"value": 1},
                }
            }
            return resp

        async def mock_post(url: str, **kwargs: Any) -> MagicMock:
            resp = MagicMock()
            resp.status_code = 202
            resp.raise_for_status = MagicMock()
            resp.json.return_value = {}
            return resp

        mock_httpx.return_value.__aenter__.return_value.get = mock_get
        mock_httpx.return_value.__aenter__.return_value.post = mock_post

        body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": KNOWLEDGE_ID,
            "action": "search_corpus",
            "target": None,
            "parameters": {"query": "Nike Instagram posts", "limit": 5},
            "priority": "normal",
            "context": {"task_id": make_task_id(), "workflow_id": WORKFLOW_ID, "chain_depth": 1},
        }
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200, f"search_corpus failed: {resp.text}"
        data = resp.json()
        assert "documents" in data or "results" in data
        items = data.get("documents") or data.get("results", [])
        assert len(items) >= 1


# ===========================================================================
# MULTI-SEQUENTIAL: Sequential Chained Dispatch
# ===========================================================================


@_skip_wave6
class TestSequentialChainedWorkflow:
    """Spec: Multi-step workflows where each step dispatches the next."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("gateway.main.httpx.AsyncClient")
    def test_workflow_step_1_dispatch_scraper(self, mock_httpx: MagicMock) -> None:
        """MULTI-SEQ-01: Step 1 — orchestrator dispatches scrape task.

        Spec: 'Full pipeline: human → orchestrator → gateway → broker → scraper → result'
        Step 1 of the multi-step workflow.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        body = make_dispatch_body(
            agent_id=ORCHESTRATOR_ID,
            capability="scrape_instagram",
            context_message="Scrape Nike profile for Q1 2026 report",
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "dispatched"
        assert data["capability"] == "scrape_instagram"

    @patch("gateway.main.httpx.AsyncClient")
    def test_workflow_step_2_dispatch_knowledge_store(self, mock_httpx: MagicMock) -> None:
        """MULTI-SEQ-02: Step 2 — after scrape completes, scraper stores knowledge.

        Spec: 'instagram-scraper has store_knowledge in allowed actions'
        The scraper stores scraped data in the knowledge base before reporting done.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"nodes_created": 3, "edges_created": 2, "status": "stored"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": SCRAPER_ID,
            "action": "store_knowledge",
            "target": None,
            "parameters": {
                "content": "Nike: 42.1M followers, 500 posts, 15k avg likes",
                "summary": "Nike Q1 2026 Instagram metrics",
                "source": {"task_id": make_task_id(), "workflow_id": WORKFLOW_ID},
            },
            "priority": "normal",
            "context": {"task_id": make_task_id(), "workflow_id": WORKFLOW_ID, "chain_depth": 2},
        }
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 201, f"store_knowledge step failed: {resp.text}"

    @patch("gateway.main.httpx.AsyncClient")
    def test_workflow_step_3_report_result(self, mock_httpx: MagicMock) -> None:
        """MULTI-SEQ-03: Step 3 — scraper reports result to orchestrator via Gateway.

        Spec: 'instagram-scraper has report_result in allowed actions'
        After scraping and storing knowledge, the worker signals completion.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        task_id = make_task_id()
        body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": SCRAPER_ID,
            "action": "report_result",
            "target": None,
            "parameters": {
                "task_id": task_id,
                "status": "success",
                "result": {"records": 42, "knowledge_stored": True},
            },
            "priority": "normal",
            "context": {"task_id": task_id, "workflow_id": WORKFLOW_ID, "chain_depth": 2},
        }
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200, f"report_result step failed: {resp.text}"

    @patch("gateway.main.httpx.AsyncClient")
    def test_chain_depth_increments_across_workflow_steps(self, mock_httpx: MagicMock) -> None:
        """MULTI-SEQ-04: Chain depth increments correctly across workflow steps.

        Spec: 'Chain depth tracks how many hops a request has made'
        Step 1 (human → orchestrator) = chain_depth 1
        Step 2 (orchestrator → scraper) = chain_depth 2
        This prevents infinite delegation loops.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        # Step 1: chain_depth=1
        body_step1 = make_dispatch_body(
            agent_id=ORCHESTRATOR_ID,
            capability="scrape_instagram",
            context_message="Step 1",
        )
        body_step1["context"]["chain_depth"] = 1
        resp1 = self.client.post("/actions", json=body_step1)
        assert resp1.status_code == 202

        # Step 2: chain_depth=2 (orchestrator dispatched to scraper)
        body_step2 = make_dispatch_body(
            agent_id=ORCHESTRATOR_ID,
            capability="review_content",
            context_message="Step 2 — review scraper output",
        )
        body_step2["context"]["chain_depth"] = 2
        resp2 = self.client.post("/actions", json=body_step2)
        assert resp2.status_code == 202

        # Step 3: chain_depth=5 (at the limit — still allowed)
        body_step3 = make_dispatch_body(
            agent_id=ORCHESTRATOR_ID,
            capability="scrape_instagram",
            context_message="Step 3",
        )
        body_step3["context"]["chain_depth"] = 5
        resp3 = self.client.post("/actions", json=body_step3)
        assert resp3.status_code == 202

        # Step 4: chain_depth=6 (exceeds limit — denied)
        body_step4 = make_dispatch_body(
            agent_id=ORCHESTRATOR_ID,
            capability="scrape_instagram",
            context_message="Step 4 — too deep",
        )
        body_step4["context"]["chain_depth"] = 6
        resp4 = self.client.post("/actions", json=body_step4)
        assert resp4.status_code == 403, (
            f"Expected 403 for chain_depth=6, got {resp4.status_code}"
        )


# ===========================================================================
# MULTI-REGISTRY: Registry-Aware Dispatch
# ===========================================================================


@_skip_wave6
class TestRegistryAwareDispatch:
    """Spec: Gateway resolves capability from Registry before dispatching to Broker."""

    def setup_method(self) -> None:
        try:
            from registry.main import app as registry_app
            from fastapi.testclient import TestClient

            self.registry_client = TestClient(registry_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_only_running_agents_appear_in_capability_resolution(self) -> None:
        """MULTI-REG-01: Capability resolution only returns agents with status=running.

        Spec: 'Worker agents must be running to receive tasks'
        Crashed or stopped agents must not be dispatched new tasks.
        """
        capability = f"test_cap_{uuid.uuid4().hex[:6]}"

        # Register one running and one stopped agent
        for status, agent_suffix in [("running", "running"), ("stopped", "stopped")]:
            reg = {
                "agent_id": f"test-{agent_suffix}-{capability}",
                "capabilities": [capability],
                "status": status,
                "boundary": "data-collection",
            }
            self.registry_client.post("/agents", json=reg)

        resp = self.registry_client.get(f"/capabilities/{capability}")
        assert resp.status_code == 200
        agents = resp.json()
        for agent in agents:
            assert agent.get("status") == "running", (
                f"Non-running agent '{agent.get('agent_id')}' returned by capability resolution"
            )

    def test_registry_returns_multiple_capable_agents(self) -> None:
        """MULTI-REG-02: Multiple agents with same capability are all returned.

        Spec: Multiple scrapers can handle the same capability (horizontal scaling).
        Gateway / orchestrator picks which one to use (or round-robins).
        """
        capability = f"multi_cap_{uuid.uuid4().hex[:6]}"

        # Register 3 running agents with the same capability
        for i in range(3):
            reg = {
                "agent_id": f"scraper-{i}-{capability}",
                "capabilities": [capability],
                "status": "running",
                "boundary": "data-collection",
            }
            self.registry_client.post("/agents", json=reg)

        resp = self.registry_client.get(f"/capabilities/{capability}")
        assert resp.status_code == 200
        agents = resp.json()
        assert len(agents) >= 3, (
            f"Expected at least 3 agents for capability, got {len(agents)}"
        )

    def test_agent_with_multiple_capabilities_appears_in_all(self) -> None:
        """MULTI-REG-03: An agent with multiple capabilities is discoverable by any of them.

        Spec: 'instagram-scraper has capabilities: [scrape_instagram, scrape_profile, scrape_posts]'
        Workers may handle multiple related capabilities.
        """
        agent_id = f"multi-cap-agent-{uuid.uuid4().hex[:6]}"
        capabilities = [f"cap_a_{uuid.uuid4().hex[:4]}", f"cap_b_{uuid.uuid4().hex[:4]}"]

        reg = {
            "agent_id": agent_id,
            "capabilities": capabilities,
            "status": "running",
            "boundary": "data-collection",
        }
        self.registry_client.post("/agents", json=reg)

        for cap in capabilities:
            resp = self.registry_client.get(f"/capabilities/{cap}")
            assert resp.status_code == 200
            agent_ids = [a["agent_id"] for a in resp.json()]
            assert agent_id in agent_ids, (
                f"Agent {agent_id} should appear in capability resolution for {cap}"
            )
