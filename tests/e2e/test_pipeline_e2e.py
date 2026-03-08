"""Wave 6 — Spec-Driven E2E Tests: Full Pipeline Flow.

These tests encode the EXPECTED behavior of the complete orchestration loop:

    Human → Orchestrator → Gateway → Broker → Worker → Result

Each test exercises a distinct slice of the pipeline using TestClient (for
HTTP services) and fakeredis (for Redis Streams / pub-sub).  Docker and
external HTTP calls are fully mocked.

The full orchestration loop is NOT yet wired end-to-end; these tests are
SKIPPED until Wave 6 implementation lands.

Pipeline flow spec (IMPLEMENTATION-PLAN.md Wave 6):
  1. Orchestrator dispatches task via dispatch_task ActionRequest → Gateway
  2. Gateway validates identity + policy, then forwards TaskDelivery to Broker
  3. Broker publishes to Redis Stream 'boundary:default'
  4. Worker consumes from stream, processes, posts progress chunks to Gateway
  5. Worker posts final result to Broker + Gateway
  6. Orchestrator polls Gateway for task status, receives result

Test files validated:
  services/gateway/gateway/main.py     (GatewayService, all action endpoints)
  services/broker/broker/main.py       (BrokerService, publish/consume/ack/result)
  services/registry/registry/main.py   (RegistryService, agent registration)
"""

from __future__ import annotations

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
# Implementation guard — skip until Wave 6 pipeline wiring is in place.
#
# The guard checks for a WaveSixPipeline integration class that the Wave 6
# implementation should provide.  Until then, ALL tests in this file are
# SKIPPED automatically.
# ---------------------------------------------------------------------------
_WAVE6_IMPLEMENTED = False
try:
    # Wave 6 should expose a PipelineCoordinator that wires the services together
    from pipeline.coordinator import PipelineCoordinator  # type: ignore[import]
    _WAVE6_IMPLEMENTED = True
except ImportError:
    pass

_skip_wave6 = pytest.mark.skipif(
    not _WAVE6_IMPLEMENTED,
    reason=(
        "Wave 6 not yet implemented — "
        "pipeline/coordinator.py missing (full orchestration loop)"
    ),
)

# ---------------------------------------------------------------------------
# Shared fixtures and helpers
# ---------------------------------------------------------------------------

ORCHESTRATOR_AGENT_ID = "orchestrator"
SCRAPER_AGENT_ID = "instagram-scraper"
TASK_ID = f"task-{uuid.uuid4().hex[:12]}"
WORKFLOW_ID = f"wf-{uuid.uuid4().hex[:8]}"
MGMT_TOKEN = "Bearer kubex-mgmt-token"


def make_action_request(
    agent_id: str = ORCHESTRATOR_AGENT_ID,
    action: str = "dispatch_task",
    parameters: dict[str, Any] | None = None,
    target: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    """Build a minimal ActionRequest payload."""
    return {
        "request_id": f"req-{uuid.uuid4().hex[:8]}",
        "agent_id": agent_id,
        "action": action,
        "target": target,
        "parameters": parameters or {},
        "priority": "normal",
        "context": {
            "task_id": task_id or TASK_ID,
            "workflow_id": WORKFLOW_ID,
            "chain_depth": 1,
        },
    }


# ===========================================================================
# PIPE-DISPATCH: Orchestrator → Gateway → Broker dispatch flow
# ===========================================================================


@_skip_wave6
class TestDispatchTaskPipelineFlow:
    """Spec: orchestrator dispatches → gateway validates → broker queues."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from broker.main import app as broker_app
            from fastapi.testclient import TestClient

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )

            # Wire gateway with fakeredis
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.gateway_client = TestClient(gateway_app, raise_server_exceptions=False)

            # Wire broker with fakeredis
            from broker.streams import BrokerStreams
            broker_app.state.streams = BrokerStreams(self.fake_redis)
            self.broker_client = TestClient(broker_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_task_returns_202_with_task_id(self, mock_httpx: MagicMock) -> None:
        """PIPE-DISPATCH-01: POST /actions with dispatch_task returns 202 + task_id.

        Spec: Gateway validates the action request then forwards TaskDelivery to Broker.
        The task_id must be globally unique and returned to the caller.
        """
        # Mock the broker POST call
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.json.return_value = {"message_id": "1-0", "task_id": TASK_ID}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        body = make_action_request(
            agent_id=ORCHESTRATOR_AGENT_ID,
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "Scrape Nike"},
        )
        resp = self.gateway_client.post("/actions", json=body)

        assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "task_id" in data
        assert data["status"] == "dispatched"
        assert data.get("capability") == "scrape_instagram"

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_task_stores_originator_in_redis(self, mock_httpx: MagicMock) -> None:
        """PIPE-DISPATCH-02: Gateway stores task originator in Redis for cancel authorization.

        Spec: Gateway stores {task:originator:<task_id>: <agent_id>} so that only
        the original dispatcher can cancel the task.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.json.return_value = {"message_id": "1-0", "task_id": TASK_ID}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        body = make_action_request(
            agent_id=ORCHESTRATOR_AGENT_ID,
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "Scrape Nike"},
        )
        resp = self.gateway_client.post("/actions", json=body)
        assert resp.status_code == 202

        task_id = resp.json()["task_id"]

        # Verify originator was stored in Redis
        import asyncio
        originator = asyncio.get_event_loop().run_until_complete(
            self.fake_redis.get(f"task:originator:{task_id}")
        )
        assert originator == ORCHESTRATOR_AGENT_ID

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_task_forwards_to_broker(self, mock_httpx: MagicMock) -> None:
        """PIPE-DISPATCH-03: Gateway POSTs a valid TaskDelivery to Broker /messages.

        Spec: Gateway creates TaskDelivery and forwards to Broker POST /messages.
        The Broker receives capability, from_agent, task_id, context_message.
        """
        broker_call_args = []

        async def capture_post(url: str, **kwargs: Any) -> MagicMock:
            broker_call_args.append({"url": url, "json": kwargs.get("json", {})})
            resp = MagicMock()
            resp.status_code = 202
            resp.raise_for_status = MagicMock()
            resp.json.return_value = {"message_id": "1-0"}
            return resp

        mock_httpx.return_value.__aenter__.return_value.post = capture_post

        body = make_action_request(
            agent_id=ORCHESTRATOR_AGENT_ID,
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "Scrape Nike profile"},
        )
        resp = self.gateway_client.post("/actions", json=body)
        assert resp.status_code == 202

        # Verify the broker was called
        assert len(broker_call_args) >= 1
        broker_payload = broker_call_args[0]["json"]
        delivery = broker_payload.get("delivery", {})
        assert delivery.get("capability") == "scrape_instagram"
        assert delivery.get("from_agent") == ORCHESTRATOR_AGENT_ID
        assert "task_id" in delivery

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_task_missing_capability_returns_400(self, mock_httpx: MagicMock) -> None:
        """PIPE-DISPATCH-04: dispatch_task without 'capability' parameter returns 400.

        Spec: Gateway validates required parameters before dispatching.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_AGENT_ID,
            action="dispatch_task",
            parameters={},  # Missing capability
        )
        resp = self.gateway_client.post("/actions", json=body)

        assert resp.status_code in (400, 422), (
            f"Expected 400/422 for missing capability, got {resp.status_code}: {resp.text}"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_task_broker_down_returns_502(self, mock_httpx: MagicMock) -> None:
        """PIPE-DISPATCH-05: Gateway returns 502 when Broker is unreachable.

        Spec: Gateway must return a coherent error when downstream services are down.
        """
        import httpx
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        body = make_action_request(
            agent_id=ORCHESTRATOR_AGENT_ID,
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "Go"},
        )
        resp = self.gateway_client.post("/actions", json=body)

        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "error" in data or "detail" in data


# ===========================================================================
# PIPE-BROKER: Broker Queuing → Worker Consumption
# ===========================================================================


@_skip_wave6
class TestBrokerQueueToWorkerFlow:
    """Spec: broker publishes to stream → worker consumes → worker acks."""

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

    def test_publish_message_returns_202_with_message_id(self) -> None:
        """PIPE-BROKER-01: POST /messages returns 202 with a stream message_id.

        Spec: Broker publishes to Redis Streams 'boundary:default' stream.
        """
        from kubex_common.schemas.routing import TaskDelivery

        delivery = {
            "task_id": TASK_ID,
            "workflow_id": WORKFLOW_ID,
            "capability": "scrape_instagram",
            "context_message": "Scrape Nike",
            "from_agent": ORCHESTRATOR_AGENT_ID,
            "priority": "normal",
        }
        resp = self.client.post("/messages", json={"delivery": delivery})
        assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "message_id" in data
        assert "task_id" in data
        assert data["task_id"] == TASK_ID

    def test_consume_returns_published_message(self) -> None:
        """PIPE-BROKER-02: Worker consuming from its group receives the published task.

        Spec: Worker calls GET /messages/consume/{agent_id} to dequeue tasks.
        Messages published with capability 'scrape_instagram' are readable by
        consumers in the 'scrape_instagram' consumer group.
        """
        delivery = {
            "task_id": TASK_ID,
            "workflow_id": WORKFLOW_ID,
            "capability": "scrape_instagram",
            "context_message": "Scrape Nike",
            "from_agent": ORCHESTRATOR_AGENT_ID,
            "priority": "normal",
        }
        self.client.post("/messages", json={"delivery": delivery})

        resp = self.client.get("/messages/consume/scrape_instagram?count=1")
        assert resp.status_code == 200
        messages = resp.json()
        assert isinstance(messages, list)
        assert len(messages) >= 1
        msg = messages[0]
        assert msg.get("task_id") == TASK_ID
        assert msg.get("capability") == "scrape_instagram"

    def test_ack_removes_message_from_pending(self) -> None:
        """PIPE-BROKER-03: Worker acks a message; it leaves the pending state.

        Spec: Broker POST /messages/{id}/ack acknowledges the message.
        After ack, the message is no longer in pending-entries-list (PEL).
        """
        delivery = {
            "task_id": TASK_ID,
            "workflow_id": WORKFLOW_ID,
            "capability": "scrape_instagram",
            "context_message": "Scrape Nike",
            "from_agent": ORCHESTRATOR_AGENT_ID,
            "priority": "normal",
        }
        self.client.post("/messages", json={"delivery": delivery})

        # Consume to get the message
        consume_resp = self.client.get("/messages/consume/scrape_instagram?count=1")
        messages = consume_resp.json()
        message_id = messages[0]["message_id"]

        # Ack it
        ack_resp = self.client.post(
            f"/messages/{message_id}/ack",
            json={"message_id": message_id, "group": "scrape_instagram"},
        )
        assert ack_resp.status_code == 204, f"Expected 204, got {ack_resp.status_code}"

    def test_store_and_retrieve_task_result(self) -> None:
        """PIPE-BROKER-04: Worker stores result; orchestrator retrieves it via Broker.

        Spec: Worker POST /tasks/{id}/result stores the completed task result.
        Orchestrator GET /tasks/{id}/result reads it back.
        """
        result_payload = {
            "status": "success",
            "records": 42,
            "output_path": "/data/nike.json",
            "task_id": TASK_ID,
        }

        # Worker stores result
        store_resp = self.client.post(
            f"/tasks/{TASK_ID}/result",
            json={"result": result_payload},
        )
        assert store_resp.status_code == 204, f"Expected 204, got {store_resp.status_code}"

        # Orchestrator reads result
        get_resp = self.client.get(f"/tasks/{TASK_ID}/result")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data.get("status") == "success"
        assert data.get("records") == 42

    def test_get_result_not_found_returns_404(self) -> None:
        """PIPE-BROKER-05: Getting result for unknown task_id returns 404.

        Spec: Broker returns 404 when no result has been stored for a task.
        """
        fake_task_id = f"task-{uuid.uuid4().hex[:12]}"
        resp = self.client.get(f"/tasks/{fake_task_id}/result")
        assert resp.status_code == 404


# ===========================================================================
# PIPE-PROGRESS: Worker Progress Streaming → Gateway SSE
# ===========================================================================


@_skip_wave6
class TestProgressStreamingFlow:
    """Spec: harness POSTs progress chunks to Gateway → Gateway publishes to Redis pub/sub."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_post_progress_returns_202(self) -> None:
        """PIPE-PROGRESS-01: POST /tasks/{id}/progress returns 202 published.

        Spec: Gateway accepts progress chunks from worker harness via POST.
        """
        chunk = {"type": "progress", "text": "Processing page 1...", "chunk_index": 0}
        resp = self.client.post(f"/tasks/{TASK_ID}/progress", json=chunk)
        assert resp.status_code == 202
        data = resp.json()
        assert data.get("status") == "published"

    def test_post_progress_publishes_to_redis_pubsub(self) -> None:
        """PIPE-PROGRESS-02: Progress chunks are published to Redis 'progress:{task_id}' channel.

        Spec: Gateway publishes progress to Redis pub/sub so that SSE subscribers receive it.
        """
        import asyncio

        # Subscribe to the progress channel before posting
        async def listen_and_post() -> list[Any]:
            pubsub = self.fake_redis.pubsub()
            await pubsub.subscribe(f"progress:{TASK_ID}")

            # Post progress chunk via HTTP
            chunk = {"type": "progress", "text": "Step 1 done", "final": False}
            self.client.post(f"/tasks/{TASK_ID}/progress", json=chunk)

            # Read one message (non-blocking, brief wait)
            received = []
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    received.append(json.loads(msg["data"]))
                    break
            await pubsub.unsubscribe(f"progress:{TASK_ID}")
            return received

        received = asyncio.get_event_loop().run_until_complete(listen_and_post())
        assert len(received) >= 1
        assert received[0].get("text") == "Step 1 done"

    def test_post_final_progress_chunk_signals_completion(self) -> None:
        """PIPE-PROGRESS-03: Final progress chunk with type='result' signals task completion.

        Spec: Harness sends a final chunk with type='result' to signal task done.
        The SSE stream must detect this and close the connection.
        """
        final_chunk = {
            "type": "result",
            "exit_reason": "completed",
            "final": True,
            "task_id": TASK_ID,
        }
        resp = self.client.post(f"/tasks/{TASK_ID}/progress", json=final_chunk)
        assert resp.status_code == 202

    def test_post_progress_multiple_chunks_in_sequence(self) -> None:
        """PIPE-PROGRESS-04: Multiple progress chunks can be sent sequentially.

        Spec: Worker harness buffers output and sends in chunks; gateway accepts all.
        """
        for i in range(5):
            chunk = {"type": "progress", "text": f"Step {i}", "chunk_index": i}
            resp = self.client.post(f"/tasks/{TASK_ID}/progress", json=chunk)
            assert resp.status_code == 202, f"Chunk {i} failed: {resp.text}"


# ===========================================================================
# PIPE-RESULT: Gateway Task Result Retrieval
# ===========================================================================


@_skip_wave6
class TestGatewayTaskResultFlow:
    """Spec: orchestrator polls Gateway GET /tasks/{id}/result after dispatch."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_get_task_result_not_found_returns_404(self) -> None:
        """PIPE-RESULT-01: GET /tasks/{id}/result returns 404 when task not complete.

        Spec: Orchestrator polls this endpoint until the result is available.
        404 is the expected response while the task is still running.
        """
        fake_task_id = f"task-{uuid.uuid4().hex[:12]}"
        resp = self.client.get(f"/tasks/{fake_task_id}/result")
        assert resp.status_code == 404

    def test_get_task_result_returns_stored_result(self) -> None:
        """PIPE-RESULT-02: GET /tasks/{id}/result returns result stored by worker.

        Spec: Worker stores result → Gateway reads it from Redis → Orchestrator gets it.
        """
        import asyncio

        result_data = {
            "status": "success",
            "records": 42,
            "task_id": TASK_ID,
            "output_path": "/data/nike.json",
        }

        # Simulate worker storing result directly in Redis
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(
                f"task:{TASK_ID}:result", json.dumps(result_data)
            )
        )

        resp = self.client.get(f"/tasks/{TASK_ID}/result")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "success"
        assert data.get("records") == 42

    def test_get_task_result_preserves_all_fields(self) -> None:
        """PIPE-RESULT-03: Task result preserves all fields written by the worker.

        Spec: Worker can include arbitrary result fields; they must survive the round-trip.
        """
        import asyncio

        task_id = f"task-{uuid.uuid4().hex[:12]}"
        result_data = {
            "status": "success",
            "records": 100,
            "pages_scraped": 5,
            "profile_handle": "nike",
            "followers": 314000000,
            "posts_data": [{"id": "p1", "likes": 15000}],
        }

        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(f"task:{task_id}:result", json.dumps(result_data))
        )

        resp = self.client.get(f"/tasks/{task_id}/result")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("followers") == 314000000
        assert data.get("pages_scraped") == 5
        assert len(data.get("posts_data", [])) == 1


# ===========================================================================
# PIPE-REGISTRY: Registry + Gateway Capability Resolution
# ===========================================================================


@_skip_wave6
class TestRegistryCapabilityResolutionFlow:
    """Spec: registry stores agents → gateway resolves capability to agent."""

    def setup_method(self) -> None:
        try:
            from registry.main import app as registry_app
            from fastapi.testclient import TestClient

            self.client = TestClient(registry_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_register_agent_then_resolve_capability(self) -> None:
        """PIPE-REGISTRY-01: Registered agent is discoverable by capability.

        Spec: Kubex Manager registers agent on start → Gateway resolves capability
        by querying Registry GET /capabilities/{capability}.
        """
        registration = {
            "agent_id": SCRAPER_AGENT_ID,
            "capabilities": ["scrape_instagram", "scrape_profile"],
            "status": "running",
            "boundary": "data-collection",
        }
        reg_resp = self.client.post("/agents", json=registration)
        assert reg_resp.status_code == 201, f"Registration failed: {reg_resp.text}"

        # Resolve the capability
        resolve_resp = self.client.get("/capabilities/scrape_instagram")
        assert resolve_resp.status_code == 200
        agents = resolve_resp.json()
        assert isinstance(agents, list)
        agent_ids = [a["agent_id"] for a in agents]
        assert SCRAPER_AGENT_ID in agent_ids

    def test_capability_resolution_filters_by_status(self) -> None:
        """PIPE-REGISTRY-02: Only 'running' agents are returned by capability resolution.

        Spec: Dead/stopped agents must not receive new tasks.
        Registry only returns agents with status='running'.
        """
        # Register a running agent and a stopped one
        for status in ("running", "stopped"):
            registration = {
                "agent_id": f"test-scraper-{status}",
                "capabilities": ["test_capability_xyz"],
                "status": status,
                "boundary": "data-collection",
            }
            self.client.post("/agents", json=registration)

        resolve_resp = self.client.get("/capabilities/test_capability_xyz")
        assert resolve_resp.status_code == 200
        agents = resolve_resp.json()
        for agent in agents:
            assert agent.get("status") == "running", (
                f"Expected only running agents, got {agent.get('status')} for {agent.get('agent_id')}"
            )

    def test_unknown_capability_returns_404(self) -> None:
        """PIPE-REGISTRY-03: Resolving a capability with no matching agents returns 404.

        Spec: Gateway receives 404 from Registry if no agent handles the capability.
        """
        resp = self.client.get("/capabilities/capability_that_does_not_exist_xyz")
        assert resp.status_code == 404

    def test_deregister_agent_removes_from_capability_resolution(self) -> None:
        """PIPE-REGISTRY-04: Deregistered agent no longer appears in capability resolution.

        Spec: When a Kubex is stopped/killed, it is deregistered from Registry.
        Subsequent capability resolution should not return the stopped agent.
        """
        agent_id = f"temp-scraper-{uuid.uuid4().hex[:6]}"
        capability = f"temp_capability_{uuid.uuid4().hex[:6]}"

        # Register
        registration = {
            "agent_id": agent_id,
            "capabilities": [capability],
            "status": "running",
            "boundary": "data-collection",
        }
        self.client.post("/agents", json=registration)

        # Verify it appears
        resp = self.client.get(f"/capabilities/{capability}")
        assert resp.status_code == 200

        # Deregister
        del_resp = self.client.delete(f"/agents/{agent_id}")
        assert del_resp.status_code == 204

        # Verify it no longer appears
        resp = self.client.get(f"/capabilities/{capability}")
        assert resp.status_code == 404
