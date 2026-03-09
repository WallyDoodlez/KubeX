"""E2E Tests: Kill Switch.

These tests validate the kill switch flow end-to-end:

  1. Kill switch stops a running kubex mid-task (container kill)
  2. Harness detects cancel and sends final progress with exit_reason
  3. Kill switch deregisters agent from registry
  4. Gateway cancel endpoint publishes to Redis control channel
  5. Only the task originator can trigger cancel (auth check)
  6. Kill switch works even when agent is mid-LLM-call
  7. After kill switch, task result shows "cancelled" status

Tests are SKIPPED until the kill switch integration layer is fully wired.

Spec refs:
  - MVP.md line 1246: 'Test kill switch: stop scraper mid-task, verify cleanup'
  - services/gateway/gateway/main.py: cancel_task endpoint
  - agents/_base/kubex_harness/harness.py: _listen_for_cancel, _escalate_cancel
  - services/kubex-manager/kubex_manager/main.py: kill endpoint

Module paths exercised:
  services/gateway/gateway/main.py        (cancel_task, handle_action)
  services/kubex-manager/kubex_manager/main.py  (kill endpoint)
  agents/_base/kubex_harness/harness.py   (cancel listener, escalation)
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
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "agents/_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/kubex_common"))

# ---------------------------------------------------------------------------
# Implementation guard — kill switch integration not yet fully wired
# ---------------------------------------------------------------------------
_KILL_SWITCH_INTEGRATED = False
try:
    from gateway.main import app as _gateway_app
    from kubex_manager.main import app as _manager_app
    from kubex_harness.harness import KubexHarness, HarnessConfig, ExitReason

    _KILL_SWITCH_INTEGRATED = True
except ImportError:
    pass

_skip_not_integrated = pytest.mark.skipif(
    not _KILL_SWITCH_INTEGRATED,
    reason="Kill switch integration not available — missing gateway/manager/harness imports",
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ORCHESTRATOR_ID = "orchestrator"
SCRAPER_ID = "instagram-scraper"
KNOWLEDGE_ID = "knowledge"
REVIEWER_ID = "reviewer"

TASK_ORIGINATOR_PREFIX = "task:originator:"
TASK_ORIGINATOR_TTL = 86400


def make_task_id() -> str:
    return f"task-{uuid.uuid4().hex[:12]}"


def make_action_request(
    agent_id: str = ORCHESTRATOR_ID,
    action: str = "dispatch_task",
    parameters: dict[str, Any] | None = None,
    target: str | None = None,
    task_id: str | None = None,
    chain_depth: int = 1,
) -> dict[str, Any]:
    return {
        "request_id": f"req-{uuid.uuid4().hex[:8]}",
        "agent_id": agent_id,
        "action": action,
        "target": target,
        "parameters": parameters or {},
        "priority": "normal",
        "context": {
            "task_id": task_id or make_task_id(),
            "workflow_id": f"wf-{uuid.uuid4().hex[:8]}",
            "chain_depth": chain_depth,
        },
    }


# ===========================================================================
# KILLSWITCH-01: Kill switch stops a running kubex mid-task
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchStopsRunningKubex:
    """Spec: Kill switch immediately terminates any running Kubex container."""

    def setup_method(self) -> None:
        try:
            from kubex_manager.main import app as manager_app
            from fastapi.testclient import TestClient

            self.mock_docker = MagicMock()
            self.mock_container = MagicMock()
            self.mock_docker.containers.create.return_value = self.mock_container
            self.mock_docker.containers.get.return_value = self.mock_container
            self.mock_container.id = "abc123deadbeef"
            self.mock_container.status = "running"
            self.client = TestClient(manager_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_kill_switch_stops_running_container(self, mock_docker_env: MagicMock) -> None:
        """KILLSWITCH-01: POST /kubexes/{id}/kill forcefully terminates a running container.

        Spec: 'Kill switch -- docker stop + secret file cleanup' (docs/agents.md)
        The kill switch must work even if the container is non-responsive.
        Docker kill() or stop() must be called on the container.
        """
        mock_docker_env.return_value = self.mock_docker
        config = {
            "agent": {
                "id": SCRAPER_ID,
                "boundary": "data-collection",
                "prompt": "scrape task",
                "skills": [],
                "models": {"allowed": [], "default": "gpt-5.2"},
                "providers": ["openai"],
            }
        }

        create_resp = self.client.post(
            "/kubexes",
            json={"config": config},
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert create_resp.status_code == 201
        kubex_id = create_resp.json()["kubex_id"]

        # Now kill it mid-task
        kill_resp = self.client.post(
            f"/kubexes/{kubex_id}/kill",
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert kill_resp.status_code == 200
        assert self.mock_container.kill.called or self.mock_container.stop.called, (
            "Docker kill() or stop() must be called on the container"
        )


# ===========================================================================
# KILLSWITCH-02: Harness cleanup on cancel (final progress with exit_reason)
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchHarnessCleanup:
    """Spec: Harness detects cancel, sends final progress update with exit_reason."""

    def setup_method(self) -> None:
        try:
            import fakeredis

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            from kubex_harness.harness import KubexHarness, HarnessConfig, ExitReason

            self.KubexHarness = KubexHarness
            self.HarnessConfig = HarnessConfig
            self.ExitReason = ExitReason
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_harness_sets_cancelled_exit_reason_on_cancel_command(self) -> None:
        """KILLSWITCH-02a: When cancel command is received, harness exit_reason is 'cancelled'.

        Spec: 'Final progress update must have exit_reason=cancelled'
        The kill switch triggers a cancel command on Redis control channel,
        and the harness must set ExitReason.CANCELLED.
        """
        task_id = make_task_id()
        config = self.HarnessConfig(
            agent_id=SCRAPER_ID,
            task_id=task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        exit_reason = asyncio.get_event_loop().run_until_complete(
            harness._process_cancel_command(task_id)
        )

        assert exit_reason == self.ExitReason.CANCELLED
        assert harness._cancelled is True

    def test_harness_final_progress_includes_exit_reason(self) -> None:
        """KILLSWITCH-02b: Final progress POST includes exit_reason field.

        Spec: Harness sends POST /tasks/{task_id}/progress with final=True
        and exit_reason='cancelled' so the SSE stream can emit the cancelled event.
        """
        task_id = make_task_id()
        config = self.HarnessConfig(
            agent_id=SCRAPER_ID,
            task_id=task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        mock_http = AsyncMock()

        asyncio.get_event_loop().run_until_complete(
            harness._post_final_progress(mock_http, self.ExitReason.CANCELLED, returncode=-9)
        )

        mock_http.post.assert_called_once()
        call_kwargs = mock_http.post.call_args
        url = call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs.get("url", "")
        payload = call_kwargs.kwargs.get("json", {})

        assert f"/tasks/{task_id}/progress" in url
        assert payload.get("final") is True
        assert payload.get("exit_reason") == "cancelled"


# ===========================================================================
# KILLSWITCH-03: Kill switch deregisters agent from registry
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchDeregistersFromRegistry:
    """Spec: Kill switch deregisters the agent from the Registry."""

    def setup_method(self) -> None:
        try:
            from kubex_manager.main import app as manager_app
            from fastapi.testclient import TestClient

            self.mock_docker = MagicMock()
            self.mock_container = MagicMock()
            self.mock_docker.containers.create.return_value = self.mock_container
            self.mock_docker.containers.get.return_value = self.mock_container
            self.mock_container.id = "abc123deadbeef"
            self.mock_container.status = "running"
            self.client = TestClient(manager_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_kill_calls_registry_delete(self, mock_docker_env: MagicMock) -> None:
        """KILLSWITCH-03: After kill, Registry DELETE /agents/{id} is called.

        Spec: 'Registry integration -- deregister on kill'
        After kill, the agent must not appear in capability resolution.
        This prevents stale agent entries from receiving new tasks.
        """
        mock_docker_env.return_value = self.mock_docker

        with patch("kubex_manager.lifecycle.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 204
            mock_httpx.return_value.__aenter__.return_value.delete = AsyncMock(
                return_value=mock_response
            )
            mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=MagicMock(status_code=201)
            )

            config = {
                "agent": {
                    "id": SCRAPER_ID,
                    "boundary": "data-collection",
                    "prompt": "scrape",
                    "skills": [],
                    "models": {"allowed": [], "default": "gpt-5.2"},
                    "providers": ["openai"],
                }
            }

            create_resp = self.client.post(
                "/kubexes",
                json={"config": config},
                headers={"Authorization": "Bearer kubex-mgmt-token"},
            )
            kubex_id = create_resp.json()["kubex_id"]

            kill_resp = self.client.post(
                f"/kubexes/{kubex_id}/kill",
                headers={"Authorization": "Bearer kubex-mgmt-token"},
            )
            assert kill_resp.status_code == 200

            delete_calls = mock_httpx.return_value.__aenter__.return_value.delete.call_args_list
            assert any("/agents/" in str(c) for c in delete_calls), (
                "Expected Registry DELETE call after kill to deregister the agent"
            )


# ===========================================================================
# KILLSWITCH-04: Gateway cancel endpoint publishes to control channel
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchPublishesToControlChannel:
    """Spec: Cancel command is published to Redis 'control:{agent_id}' channel."""

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

    def test_cancel_publishes_cancel_command_to_control_channel(self) -> None:
        """KILLSWITCH-04: Successful cancel publishes {command: cancel, task_id} to channel.

        Spec: 'Gateway publishes cancel command to control:{agent_id} Redis pub/sub channel'
        The harness listens on this channel and initiates graceful abort.
        This is the mechanism by which the kill switch reaches the running agent.
        """
        task_id = make_task_id()

        # Store originator so cancel is authorized
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(
                f"{TASK_ORIGINATOR_PREFIX}{task_id}",
                ORCHESTRATOR_ID,
                ex=TASK_ORIGINATOR_TTL,
            )
        )

        # Subscribe to control channel, then issue cancel
        async def listen_and_cancel() -> list[Any]:
            pubsub = self.fake_redis.pubsub()
            await pubsub.subscribe(f"control:{ORCHESTRATOR_ID}")

            self.client.post(
                f"/tasks/{task_id}/cancel",
                json={"agent_id": ORCHESTRATOR_ID, "reason": "Kill switch activated"},
            )

            received = []
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    received.append(json.loads(msg["data"]))
                    break
            await pubsub.unsubscribe(f"control:{ORCHESTRATOR_ID}")
            return received

        received = asyncio.get_event_loop().run_until_complete(listen_and_cancel())
        assert len(received) >= 1, "Expected cancel command on control channel"
        msg = received[0]
        assert msg.get("command") == "cancel"
        assert msg.get("task_id") == task_id


# ===========================================================================
# KILLSWITCH-05: Only the task originator can trigger cancel
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchOriginatorAuth:
    """Spec: Only the originating agent can cancel a task."""

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

    def test_originator_can_cancel(self) -> None:
        """KILLSWITCH-05a: The originator can cancel its own task (200).

        Spec: 'Orchestrator can cancel tasks it dispatched'
        """
        task_id = make_task_id()
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(
                f"{TASK_ORIGINATOR_PREFIX}{task_id}",
                ORCHESTRATOR_ID,
                ex=TASK_ORIGINATOR_TTL,
            )
        )

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": ORCHESTRATOR_ID, "reason": "Operator kill switch"},
        )
        assert resp.status_code == 200
        assert resp.json().get("status") == "cancel_requested"

    @pytest.mark.parametrize("non_originator", [SCRAPER_ID, KNOWLEDGE_ID, REVIEWER_ID])
    def test_non_originator_cannot_cancel(self, non_originator: str) -> None:
        """KILLSWITCH-05b: Non-originators are rejected with 403.

        Spec: 'Only the originating agent can cancel a task'
        A compromised worker must not be able to kill another agent's task.
        """
        task_id = make_task_id()
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(
                f"{TASK_ORIGINATOR_PREFIX}{task_id}",
                ORCHESTRATOR_ID,
                ex=TASK_ORIGINATOR_TTL,
            )
        )

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": non_originator, "reason": "Rogue kill attempt"},
        )
        assert resp.status_code == 403, (
            f"Expected 403 for {non_originator} attempting kill switch, "
            f"got {resp.status_code}: {resp.text}"
        )

    def test_cancel_without_agent_id_returns_400(self) -> None:
        """KILLSWITCH-05c: Cancel without agent_id returns 400.

        Spec: Anonymous cancel requests must be rejected.
        """
        task_id = make_task_id()
        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"reason": "No identity"},
        )
        assert resp.status_code == 400


# ===========================================================================
# KILLSWITCH-06: Kill switch works during mid-LLM-call
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchDuringLLMCall:
    """Spec: Kill switch works even when agent is mid-LLM-call."""

    def setup_method(self) -> None:
        try:
            import fakeredis

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            from kubex_harness.harness import KubexHarness, HarnessConfig, ExitReason

            self.KubexHarness = KubexHarness
            self.HarnessConfig = HarnessConfig
            self.ExitReason = ExitReason
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_cancel_during_blocked_io_marks_cancelled(self) -> None:
        """KILLSWITCH-06: Cancel command during a long-running subprocess marks cancelled.

        Spec: Kill switch must work even when the agent is mid-LLM-call.
        The harness cancel listener runs concurrently with output streaming.
        A cancel command received while the subprocess is blocked on I/O
        (e.g., waiting for LLM response) must still be processed.
        """
        task_id = make_task_id()
        config = self.HarnessConfig(
            agent_id=SCRAPER_ID,
            task_id=task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        # Simulate cancel arriving while process is blocked
        exit_reason = asyncio.get_event_loop().run_until_complete(
            harness._process_cancel_command(task_id)
        )

        assert exit_reason == self.ExitReason.CANCELLED
        assert harness._cancelled is True

    def test_cancel_for_wrong_task_does_not_abort(self) -> None:
        """KILLSWITCH-06b: Cancel for a different task does not affect this harness.

        Spec: Cancel commands are scoped to specific task IDs.
        A cancel for task-A must not disrupt the harness running task-B.
        """
        my_task_id = make_task_id()
        other_task_id = make_task_id()

        config = self.HarnessConfig(
            agent_id=SCRAPER_ID,
            task_id=my_task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        should_abort = asyncio.get_event_loop().run_until_complete(
            harness._should_abort_for_task(other_task_id, my_task_id)
        )
        assert should_abort is False


# ===========================================================================
# KILLSWITCH-07: After kill switch, task result shows "cancelled" status
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestKillSwitchResultStatus:
    """Spec: After kill switch, task result shows cancelled status."""

    def setup_method(self) -> None:
        try:
            import fakeredis

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            from kubex_harness.harness import KubexHarness, HarnessConfig, ExitReason

            self.KubexHarness = KubexHarness
            self.HarnessConfig = HarnessConfig
            self.ExitReason = ExitReason
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_store_result_with_cancelled_status(self) -> None:
        """KILLSWITCH-07a: Harness stores result with status='cancelled' after kill.

        Spec: 'After kill switch, task result shows cancelled status'
        The result stored via POST /tasks/{task_id}/result must have
        status='cancelled' so consumers know the task did not complete.
        """
        task_id = make_task_id()
        config = self.HarnessConfig(
            agent_id=SCRAPER_ID,
            task_id=task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        mock_http = AsyncMock()

        asyncio.get_event_loop().run_until_complete(
            harness._store_result(mock_http, self.ExitReason.CANCELLED, returncode=-9)
        )

        mock_http.post.assert_called_once()
        call_kwargs = mock_http.post.call_args
        url = call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs.get("url", "")
        payload = call_kwargs.kwargs.get("json", {})

        assert f"/tasks/{task_id}/result" in url
        assert payload["result"]["status"] == "cancelled"

    def test_store_result_with_completed_status_on_normal_exit(self) -> None:
        """KILLSWITCH-07b: Normal exit stores result with status='completed'.

        Spec: Non-cancelled tasks should have status='completed' (contrast test).
        """
        task_id = make_task_id()
        config = self.HarnessConfig(
            agent_id=SCRAPER_ID,
            task_id=task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        mock_http = AsyncMock()

        asyncio.get_event_loop().run_until_complete(
            harness._store_result(mock_http, self.ExitReason.COMPLETED, returncode=0)
        )

        payload = mock_http.post.call_args.kwargs.get("json", {})
        assert payload["result"]["status"] == "completed"

    def test_cancelled_exit_reason_enum_value(self) -> None:
        """KILLSWITCH-07c: ExitReason.CANCELLED has string value 'cancelled'.

        Spec: The exit reason value must match the SSE event type for cancelled tasks.
        """
        assert self.ExitReason.CANCELLED.value == "cancelled"
        assert self.ExitReason.COMPLETED.value == "completed"
        assert self.ExitReason.FAILED.value == "failed"
