"""E2E CLI Runtime Harness Tests — Tier A (mock) + Tier B (live CLI stubs).

Tier A tests wire Gateway + Broker + Registry in-process using the same
httpx.MockTransport pattern from test_hello_world_e2e.py. They simulate what
the CLI Runtime harness does — consuming tasks, posting progress, storing
results — and verify the Wave 2 fixes are correct:

  - Progress schema: {"chunk": "...", "final": false}
  - Results go to Broker (POST /tasks/{task_id}/result), NOT Gateway
  - Registration goes to Registry (POST /agents), NOT Gateway
  - Final progress event: {"chunk": "", "final": true}

Tier B tests are live CLI smoke tests that require actual CLI installations
and subscriptions. They are skipped by default.

Run Tier B with: pytest tests/e2e/test_cli_runtime_e2e.py -m live_cli
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from typing import Any
from unittest.mock import patch

import fakeredis
import httpx
import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Path setup — add all service roots so imports resolve without installation
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/gateway"))
sys.path.insert(0, os.path.join(_ROOT, "services/broker"))
sys.path.insert(0, os.path.join(_ROOT, "services/registry"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))


# ---------------------------------------------------------------------------
# Shared fakeredis factory
# ---------------------------------------------------------------------------


def _make_fake_redis(server: fakeredis.FakeServer | None = None) -> fakeredis.FakeAsyncRedis:
    if server is None:
        server = fakeredis.FakeServer()
    return fakeredis.FakeAsyncRedis(server=server, decode_responses=True)


# ---------------------------------------------------------------------------
# Service client factories
# ---------------------------------------------------------------------------


def _make_broker_client(redis: fakeredis.FakeAsyncRedis) -> TestClient:
    from broker.main import BrokerService
    from broker.streams import BrokerStreams

    svc = BrokerService()
    svc.app.state.streams = BrokerStreams(redis)
    return TestClient(svc.app, raise_server_exceptions=True)


def _make_registry_client() -> TestClient:
    from registry.main import RegistryService

    svc = RegistryService()
    return TestClient(svc.app, raise_server_exceptions=True)


def _make_mock_transport(broker_client: TestClient, registry_client: TestClient) -> httpx.MockTransport:
    """Return an httpx transport that routes requests to in-process TestClients."""

    def _adapt_response(tc_resp: Any) -> httpx.Response:
        content = tc_resp.content if hasattr(tc_resp, "content") else b""
        return httpx.Response(
            status_code=tc_resp.status_code,
            content=content,
            headers=dict(tc_resp.headers),
        )

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        path = request.url.path
        query = f"?{request.url.query}" if request.url.query else ""
        full_path = path + query

        # Route to Broker
        if "broker:8060" in url or ":8060" in url:
            if request.method == "POST":
                tc_resp = broker_client.post(
                    full_path,
                    content=request.content,
                    headers={"content-type": "application/json"},
                )
            elif request.method == "GET":
                tc_resp = broker_client.get(full_path)
            else:
                tc_resp = broker_client.request(request.method, full_path, content=request.content)
            return _adapt_response(tc_resp)

        # Route to Registry
        if "registry:8070" in url or ":8070" in url:
            if request.method == "GET":
                tc_resp = registry_client.get(full_path)
            elif request.method == "POST":
                tc_resp = registry_client.post(
                    full_path,
                    content=request.content,
                    headers={"content-type": "application/json"},
                )
            else:
                tc_resp = registry_client.request(request.method, full_path, content=request.content)
            return _adapt_response(tc_resp)

        raise ValueError(f"Unrouted request: {request.method} {url}")

    return httpx.MockTransport(handler)


def _make_gateway_client(
    redis: fakeredis.FakeAsyncRedis,
    broker_client: TestClient,
    registry_client: TestClient,
) -> TestClient:
    """Create a Gateway TestClient with fakeredis and in-process routing to Broker+Registry."""
    from gateway.main import GatewayService
    from gateway.budget import BudgetTracker
    from gateway.ratelimit import RateLimiter

    svc = GatewayService()
    svc.redis_db0 = redis
    svc.redis_db1 = redis
    svc.rate_limiter = RateLimiter(redis)
    svc.budget_tracker = BudgetTracker(redis)

    # Replace LLM proxy http client (avoids connect() call during startup)
    svc.llm_proxy._http_client = httpx.AsyncClient()

    transport = _make_mock_transport(broker_client, registry_client)

    original_init = httpx.AsyncClient.__init__

    def patched_init(self_inner: httpx.AsyncClient, **kwargs: Any) -> None:
        original_init(self_inner, transport=transport)

    svc._patched_init = patched_init
    svc._original_init = original_init

    return TestClient(svc.app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def services():
    """Wire Gateway, Broker, and Registry together with shared fakeredis.

    Uses the same pattern as test_hello_world_e2e.py.
    """
    server = fakeredis.FakeServer()
    redis = _make_fake_redis(server)
    broker = _make_broker_client(redis)
    registry = _make_registry_client()
    gateway = _make_gateway_client(redis, broker, registry)

    transport = _make_mock_transport(broker, registry)

    original_init = httpx.AsyncClient.__init__

    def patched_init(self_inner: httpx.AsyncClient, **kwargs: Any) -> None:
        original_init(self_inner, transport=transport)

    with patch.object(httpx.AsyncClient, "__init__", patched_init):
        yield {
            "redis": redis,
            "server": server,
            "gateway": gateway,
            "broker": broker,
            "registry": registry,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _register_agent(
    registry: TestClient,
    agent_id: str,
    capabilities: list[str],
    boundary: str = "default",
) -> None:
    """Register an agent in the Registry."""
    resp = registry.post(
        "/agents",
        json={
            "agent_id": agent_id,
            "capabilities": capabilities,
            "status": "running",
            "boundary": boundary,
        },
    )
    assert resp.status_code in (200, 201), (
        f"Failed to register {agent_id}: {resp.status_code} {resp.text}"
    )


def _dispatch_task(
    gateway: TestClient,
    agent_id: str,
    capability: str,
    message: str,
) -> str:
    """Dispatch a task via Gateway and return the task_id from the 202 response."""
    payload = {
        "request_id": f"req-{uuid.uuid4().hex[:8]}",
        "agent_id": agent_id,
        "action": "dispatch_task",
        "parameters": {
            "capability": capability,
            "context_message": message,
        },
        "priority": "normal",
        "context": {
            "task_id": f"outer-{uuid.uuid4().hex[:8]}",
            "workflow_id": f"wf-{uuid.uuid4().hex[:8]}",
            "chain_depth": 1,
        },
    }
    resp = gateway.post("/actions", json=payload)
    assert resp.status_code == 202, (
        f"Expected 202 from Gateway dispatch, got {resp.status_code}: {resp.text}"
    )
    data = resp.json()
    assert "task_id" in data, f"No task_id in response: {data}"
    return data["task_id"]


def _consume_task(broker: TestClient, capability: str, task_id: str) -> str:
    """Consume from broker stream, assert task_id is present, return message_id."""
    resp = broker.get(f"/messages/consume/{capability}")
    assert resp.status_code == 200, f"Consume failed: {resp.status_code} {resp.text}"
    messages = resp.json()
    task_ids = [m["task_id"] for m in messages]
    assert task_id in task_ids, (
        f"Expected task_id {task_id} in {capability} stream. Got: {task_ids}"
    )
    msg = next(m for m in messages if m["task_id"] == task_id)
    return msg["message_id"]


def _ack_message(broker: TestClient, message_id: str, capability: str) -> None:
    """Acknowledge a consumed message."""
    resp = broker.post(
        f"/messages/{message_id}/ack",
        json={"message_id": message_id, "group": capability},
    )
    assert resp.status_code == 204, f"ACK failed: {resp.status_code} {resp.text}"


def _store_result(broker: TestClient, task_id: str, result: dict[str, Any]) -> None:
    """Store a result via Broker (Wave 2 fix: results go to Broker, not Gateway)."""
    resp = broker.post(f"/tasks/{task_id}/result", json={"result": result})
    assert resp.status_code == 204, f"Store result failed: {resp.status_code} {resp.text}"


def _post_progress(
    gateway: TestClient,
    task_id: str,
    chunk: str = "",
    final: bool = True,
) -> int:
    """Post a progress chunk to Gateway. Returns the HTTP status code."""
    resp = gateway.post(
        f"/tasks/{task_id}/progress",
        json={"chunk": chunk, "final": final},
    )
    return resp.status_code


def _get_result_via_gateway(gateway: TestClient, task_id: str) -> dict[str, Any]:
    """Retrieve a task result via Gateway (reads from shared Redis)."""
    resp = gateway.get(f"/tasks/{task_id}/result")
    assert resp.status_code == 200, (
        f"Gateway result retrieval failed: {resp.status_code} {resp.text}"
    )
    return resp.json()


# ===========================================================================
# Tier A — CLI Runtime Harness Tests (no subscriptions needed)
# ===========================================================================


@pytest.mark.e2e
class TestCLIRuntimeHarness:
    """CLI Runtime harness round-trip tests using a fake CLI process simulation.

    These tests verify the Wave 2 harness fixes without requiring real CLI tools:
    - Correct progress schema: {"chunk": "...", "final": false}
    - Results stored to Broker (not Gateway)
    - Registration goes to Registry (not Gateway)
    - Final progress event: {"chunk": "", "final": true}
    """

    def test_cli_agent_happy_path(self, services) -> None:
        """Full round-trip: dispatch → consume → progress → result → retrieve.

        Simulates what the CLI Runtime harness does:
        1. Register CLI agent with a capability
        2. Dispatch task via Gateway
        3. CLI Runtime consumes from Broker
        4. Post 3 progress chunks via Gateway progress endpoint
        5. Store result via Broker (Wave 2 fix)
        6. Post final progress with final=True
        7. Retrieve result via Gateway
        """
        gateway = services["gateway"]
        broker = services["broker"]
        registry = services["registry"]

        # Register a fake CLI agent in the Registry
        _register_agent(registry, "test-cli-agent", ["cli_test"])

        # Dispatch task via Gateway
        task_id = _dispatch_task(
            gateway,
            agent_id="test-cli-agent",
            capability="cli_test",
            message="Run a simple CLI test task",
        )
        assert task_id.startswith("task-"), f"Unexpected task_id format: {task_id}"

        # CLI Runtime consumes from Broker stream
        msg_id = _consume_task(broker, "cli_test", task_id)
        _ack_message(broker, msg_id, "cli_test")

        # CLI Runtime posts progress chunks (correct schema: chunk + final=False)
        for i, chunk_text in enumerate(["Starting CLI...", "Processing...", "Finishing up..."]):
            status = _post_progress(gateway, task_id, chunk=chunk_text, final=False)
            assert status == 202, f"Progress chunk {i} failed with status {status}"

        # CLI Runtime stores result in Broker (Wave 2 fix — not Gateway)
        result = {
            "status": "completed",
            "output": "CLI task completed successfully: all checks passed",
        }
        _store_result(broker, task_id, result)

        # CLI Runtime posts final progress event
        status = _post_progress(gateway, task_id, chunk="", final=True)
        assert status == 202, f"Final progress post failed with status {status}"

        # Retrieve result via Gateway — reads from shared Redis (DB0)
        data = _get_result_via_gateway(gateway, task_id)
        assert data["status"] == "completed"
        assert "CLI task completed" in data["output"]

    def test_cli_agent_failed_task(self, services) -> None:
        """CLI exits non-zero — verify failed status is stored and retrieved correctly."""
        gateway = services["gateway"]
        broker = services["broker"]
        registry = services["registry"]

        _register_agent(registry, "test-cli-agent", ["cli_test"])

        task_id = _dispatch_task(
            gateway,
            agent_id="test-cli-agent",
            capability="cli_test",
            message="Run a task that will fail",
        )

        # Consume the task
        msg_id = _consume_task(broker, "cli_test", task_id)
        _ack_message(broker, msg_id, "cli_test")

        # CLI process exits non-zero — post an error progress chunk
        _post_progress(gateway, task_id, chunk="CLI process exited with code 1", final=False)

        # Store failed result via Broker
        failed_result = {
            "status": "failed",
            "error": "CLIError: process exited with non-zero exit code 1",
        }
        _store_result(broker, task_id, failed_result)

        # Final progress event
        _post_progress(gateway, task_id, chunk="", final=True)

        # Retrieve via Gateway — should reflect failed status
        data = _get_result_via_gateway(gateway, task_id)
        assert data["status"] == "failed"
        assert "CLIError" in data["error"]
        assert "exit code 1" in data["error"]

    def test_cli_agent_progress_schema(self, services) -> None:
        """Verify progress uses the correct Wave 2 schema: {"chunk": "...", "final": false}.

        The incorrect (pre-Wave-2) schema used different field names.
        This test asserts the correct schema is accepted with 202.
        """
        gateway = services["gateway"]
        registry = services["registry"]
        broker = services["broker"]

        _register_agent(registry, "test-cli-agent", ["cli_test"])

        task_id = _dispatch_task(
            gateway,
            agent_id="test-cli-agent",
            capability="cli_test",
            message="Test progress schema",
        )

        # Correct schema from Wave 2 fix
        resp = gateway.post(
            f"/tasks/{task_id}/progress",
            json={"chunk": "working on it...", "final": False},
        )
        assert resp.status_code == 202, (
            f"Expected 202 for correct progress schema, got {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        assert body.get("status") == "published", f"Unexpected response body: {body}"

        # Final event also uses same schema with final=True
        resp = gateway.post(
            f"/tasks/{task_id}/progress",
            json={"chunk": "", "final": True},
        )
        assert resp.status_code == 202, (
            f"Expected 202 for final progress event, got {resp.status_code}: {resp.text}"
        )

    def test_cli_agent_result_goes_to_broker_not_gateway(self, services) -> None:
        """Wave 2 fix: results stored via Broker are retrievable via Gateway.

        Pre-Wave-2 the harness incorrectly POSTed results to Gateway.
        This test proves: Broker result storage → shared Redis → Gateway retrieval.
        """
        gateway = services["gateway"]
        broker = services["broker"]
        registry = services["registry"]

        _register_agent(registry, "test-cli-agent", ["cli_test"])

        task_id = _dispatch_task(
            gateway,
            agent_id="test-cli-agent",
            capability="cli_test",
            message="Test result routing",
        )

        msg_id = _consume_task(broker, "cli_test", task_id)
        _ack_message(broker, msg_id, "cli_test")

        # Store result directly via Broker endpoint (correct Wave 2 behavior)
        result = {
            "status": "completed",
            "output": "Result stored via Broker — Wave 2 fix verified",
        }
        resp = broker.post(f"/tasks/{task_id}/result", json={"result": result})
        assert resp.status_code == 204, (
            f"Broker result storage failed: {resp.status_code} {resp.text}"
        )

        # Verify it's retrievable via Gateway (proves shared Redis: Broker writes, Gateway reads)
        data = _get_result_via_gateway(gateway, task_id)
        assert data["status"] == "completed"
        assert "Wave 2 fix verified" in data["output"]

    def test_cli_agent_registers_via_registry(self, services) -> None:
        """Wave 2 fix: CLI agents register via Registry, not Gateway.

        Verifies:
        1. Registration via Registry POST /agents succeeds
        2. Agent is retrievable via Registry GET /agents/{agent_id}
        3. Capability resolves via Registry GET /capabilities/{capability}
        """
        registry = services["registry"]

        agent_id = f"test-cli-agent-{uuid.uuid4().hex[:6]}"
        capability = "cli_test_register"

        # Register via Registry (Wave 2 fix — not via Gateway)
        resp = registry.post(
            "/agents",
            json={
                "agent_id": agent_id,
                "capabilities": [capability],
                "status": "running",
                "boundary": "default",
            },
        )
        assert resp.status_code in (200, 201), (
            f"Registry registration failed: {resp.status_code} {resp.text}"
        )

        # Verify agent is retrievable from Registry by agent_id
        resp = registry.get(f"/agents/{agent_id}")
        assert resp.status_code == 200, (
            f"Agent lookup failed: {resp.status_code} {resp.text}"
        )
        agent_data = resp.json()
        assert agent_data["agent_id"] == agent_id
        assert capability in agent_data["capabilities"]

        # Verify capability resolves to this agent
        resp = registry.get(f"/capabilities/{capability}")
        assert resp.status_code == 200, (
            f"Capability resolution failed: {resp.status_code} {resp.text}"
        )
        agents_with_cap = resp.json()
        agent_ids = [a["agent_id"] for a in agents_with_cap]
        assert agent_id in agent_ids, (
            f"Expected {agent_id} in capability resolution results: {agent_ids}"
        )


# ===========================================================================
# Tier B — Live CLI Smoke Tests (skipped by default)
# ===========================================================================


@pytest.mark.live_cli
class TestClaudeCodeLive:
    """Live smoke test — requires Claude Code CLI installed and authenticated.

    Run with: pytest tests/e2e/test_cli_runtime_e2e.py -m live_cli
    Prerequisites:
    - Claude Code CLI installed (`claude --version`)
    - Authenticated session (`claude auth login` completed)
    """

    @pytest.fixture(autouse=True)
    def check_claude_available(self):
        """Skip if Claude Code CLI is not installed or not authenticated."""
        import shutil
        import subprocess

        if not shutil.which("claude"):
            pytest.skip("Claude Code CLI not installed")
        # Check auth by running a minimal command; handle OS errors gracefully
        try:
            result = subprocess.run(
                ["claude", "--version"],
                capture_output=True,
                timeout=10,
                shell=False,
            )
        except (FileNotFoundError, OSError):
            pytest.skip("Claude Code CLI not working (OS error)")
        if result.returncode != 0:
            pytest.skip("Claude Code CLI not working")

    def test_claude_code_responds_to_simple_prompt(self):
        """Send a trivial prompt to Claude Code and verify it produces output.

        This does NOT go through the full Kubex pipeline — it just verifies
        the CLI itself works, which is a prerequisite for CLI Runtime tests.
        """
        import subprocess

        result = subprocess.run(
            ["claude", "-p", "Reply with exactly: KUBEX_PING_OK"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0
        assert "KUBEX_PING_OK" in result.stdout


@pytest.mark.live_cli
class TestGeminiCLILive:
    """Live smoke test — requires Gemini CLI installed and authenticated.

    SKIPPED: No Gemini subscription available.
    Run with: pytest tests/e2e/test_cli_runtime_e2e.py -m live_cli
    """

    @pytest.fixture(autouse=True)
    def check_gemini_available(self):
        pytest.skip("No Gemini subscription — test stubbed for future use")

    def test_gemini_cli_responds(self):
        """Placeholder for Gemini CLI smoke test."""
        pass


@pytest.mark.live_cli
class TestCodexCLILive:
    """Live smoke test — requires Codex CLI installed and authenticated.

    SKIPPED: No Codex subscription available.
    """

    @pytest.fixture(autouse=True)
    def check_codex_available(self):
        pytest.skip("No Codex subscription — test stubbed for future use")

    def test_codex_cli_responds(self):
        """Placeholder for Codex CLI smoke test."""
        pass
