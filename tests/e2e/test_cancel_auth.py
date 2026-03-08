"""Wave 6 — Spec-Driven E2E Tests: Cancel Authorization.

These tests validate the cancel authorization flow end-to-end:

  1. Task dispatch stores originator in Redis
  2. Only the originator can cancel
  3. Non-originators receive 403
  4. Cancel with missing agent_id receives 400
  5. Cancel publishes to Redis control channel for the harness
  6. Cancel command is received by the harness cancel listener
  7. Stale/expired originator records are handled correctly

Tests are SKIPPED until Wave 6 cancel authorization integration is in place.

Spec refs:
  - docs/gateway.md: 'Cancel authorization — only originator can cancel'
  - services/gateway/gateway/main.py: cancel_task endpoint
  - agents/_base/kubex_harness/harness.py: _listen_for_cancel

Module paths exercised:
  services/gateway/gateway/main.py   (cancel_task, handle_action → originator store)
  agents/_base/kubex_harness/harness.py  (cancel listener)
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
sys.path.insert(0, os.path.join(_ROOT, "agents/_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Implementation guard
# ---------------------------------------------------------------------------
_WAVE6_IMPLEMENTED = False
try:
    from cancel.integration import CancelAuthCoordinator  # type: ignore[import]
    _WAVE6_IMPLEMENTED = True
except ImportError:
    pass

_skip_wave6 = pytest.mark.skipif(
    not _WAVE6_IMPLEMENTED,
    reason=(
        "Wave 6 not yet implemented — "
        "cancel/integration.py missing (cancel authorization coordination)"
    ),
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


def store_originator_sync(redis: Any, task_id: str, agent_id: str) -> None:
    """Synchronously store originator in fakeredis."""
    asyncio.get_event_loop().run_until_complete(
        redis.set(f"{TASK_ORIGINATOR_PREFIX}{task_id}", agent_id, ex=TASK_ORIGINATOR_TTL)
    )


def read_control_channel_sync(redis: Any, agent_id: str, issuer: Any) -> list[Any]:
    """Subscribe to control channel, execute issuer(), return received messages."""
    async def _listen() -> list[Any]:
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"control:{agent_id}")
        issuer()
        received = []
        async for msg in pubsub.listen():
            if msg["type"] == "message":
                received.append(json.loads(msg["data"]))
                break
        await pubsub.unsubscribe(f"control:{agent_id}")
        return received

    return asyncio.get_event_loop().run_until_complete(_listen())


# ===========================================================================
# CANCEL-DISPATCH: Originator stored during dispatch
# ===========================================================================


@_skip_wave6
class TestOriginatorStoredOnDispatch:
    """Spec: Gateway stores task originator in Redis when a task is dispatched."""

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

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_stores_originator_in_redis(self, mock_httpx: MagicMock) -> None:
        """CANCEL-DISPATCH-01: dispatch_task stores agent_id as task originator in Redis.

        Spec: Gateway must record who dispatched each task so cancel auth can verify.
        Key: 'task:originator:{task_id}' → agent_id, TTL 24h.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": ORCHESTRATOR_ID,
            "action": "dispatch_task",
            "target": None,
            "parameters": {"capability": "scrape_instagram", "context_message": "go"},
            "priority": "normal",
            "context": {
                "task_id": None,  # Gateway generates this
                "workflow_id": "wf-001",
                "chain_depth": 1,
            },
        }

        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 202

        task_id = resp.json()["task_id"]

        # Verify originator stored in Redis
        originator = asyncio.get_event_loop().run_until_complete(
            self.fake_redis.get(f"{TASK_ORIGINATOR_PREFIX}{task_id}")
        )
        assert originator == ORCHESTRATOR_ID, (
            f"Expected originator '{ORCHESTRATOR_ID}', got '{originator}'"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_dispatch_originator_has_24h_ttl(self, mock_httpx: MagicMock) -> None:
        """CANCEL-DISPATCH-02: Originator record expires after 24 hours.

        Spec: Task originator records have TASK_ORIGINATOR_TTL = 86400 seconds TTL.
        Old tasks should not accumulate indefinitely in Redis.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        body = {
            "request_id": f"req-{uuid.uuid4().hex[:8]}",
            "agent_id": ORCHESTRATOR_ID,
            "action": "dispatch_task",
            "target": None,
            "parameters": {"capability": "scrape_instagram", "context_message": "go"},
            "priority": "normal",
            "context": {"task_id": None, "workflow_id": "wf-001", "chain_depth": 1},
        }

        resp = self.client.post("/actions", json=body)
        task_id = resp.json()["task_id"]

        # Check TTL is close to 86400 seconds
        ttl = asyncio.get_event_loop().run_until_complete(
            self.fake_redis.ttl(f"{TASK_ORIGINATOR_PREFIX}{task_id}")
        )
        assert ttl > 0, "Originator key should have a TTL"
        assert ttl <= TASK_ORIGINATOR_TTL, f"TTL {ttl} exceeds max {TASK_ORIGINATOR_TTL}"
        # Allow some seconds of slack for test execution time
        assert ttl >= TASK_ORIGINATOR_TTL - 10, (
            f"TTL {ttl} is too low — should be ~{TASK_ORIGINATOR_TTL}s"
        )

    @patch("gateway.main.httpx.AsyncClient")
    def test_multiple_dispatches_store_separate_originators(self, mock_httpx: MagicMock) -> None:
        """CANCEL-DISPATCH-03: Each dispatched task has its own originator record.

        Spec: Originator is keyed by task_id — multiple tasks have independent records.
        """
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message_id": "1-0"}
        mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        task_ids = []
        for i in range(3):
            body = {
                "request_id": f"req-{i}",
                "agent_id": ORCHESTRATOR_ID,
                "action": "dispatch_task",
                "target": None,
                "parameters": {"capability": "scrape_instagram", "context_message": f"go {i}"},
                "priority": "normal",
                "context": {"task_id": None, "workflow_id": f"wf-{i}", "chain_depth": 1},
            }
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 202
            task_ids.append(resp.json()["task_id"])

        # All task IDs must be unique
        assert len(set(task_ids)) == 3, f"Expected 3 unique task IDs, got: {task_ids}"

        # All must have originator stored
        for tid in task_ids:
            originator = asyncio.get_event_loop().run_until_complete(
                self.fake_redis.get(f"{TASK_ORIGINATOR_PREFIX}{tid}")
            )
            assert originator == ORCHESTRATOR_ID


# ===========================================================================
# CANCEL-AUTHZ: Cancel Authorization Enforcement
# ===========================================================================


@_skip_wave6
class TestCancelAuthorizationEnforcement:
    """Spec: Gateway verifies the canceller is the originator before proceeding."""

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

    def test_originator_cancel_succeeds(self) -> None:
        """CANCEL-AUTHZ-01: Originator cancels its own task — 200 returned.

        Spec: 'Orchestrator can cancel tasks it dispatched'
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": ORCHESTRATOR_ID, "reason": "User requested cancellation"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "cancel_requested"
        assert data.get("task_id") == task_id

    @pytest.mark.parametrize("non_originator", [SCRAPER_ID, KNOWLEDGE_ID, REVIEWER_ID])
    def test_non_originator_cancel_rejected(self, non_originator: str) -> None:
        """CANCEL-AUTHZ-02: Non-originating agents cannot cancel the task.

        Spec: 'Only the originating agent can cancel a task'
        This prevents:
          - Compromised worker cancelling the orchestrator's oversight tasks
          - Rogue agent performing denial-of-service via mass cancellation
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": non_originator, "reason": "Unauthorized cancel attempt"},
        )
        assert resp.status_code == 403, (
            f"Expected 403 for {non_originator} cancelling orchestrator's task, "
            f"got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert (
            "NotOriginator" in data.get("error", "")
            or "originator" in str(data).lower()
        ), f"Expected NotOriginator error, got: {data}"

    def test_cancel_without_agent_id_returns_400(self) -> None:
        """CANCEL-AUTHZ-03: Cancel request missing agent_id field returns 400.

        Spec: Agent identity is required to perform authorization check.
        Anonymous cancel requests must be rejected.
        """
        task_id = make_task_id()
        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"reason": "No caller identity provided"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert "agent_id" in str(data).lower() or "MissingAgentId" in data.get("error", "")

    def test_cancel_for_unknown_task_allows_if_no_originator_record(self) -> None:
        """CANCEL-AUTHZ-04: Cancel for unknown task_id (no originator stored) is allowed.

        Spec: If no originator is stored, the Gateway cannot enforce cancel auth
        and allows the cancel to proceed (for backward compatibility / incomplete flows).
        The cancel command is still published to the control channel.
        """
        task_id = make_task_id()
        # No originator stored — Redis has no entry for this task

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": ORCHESTRATOR_ID, "reason": "Cleanup cancel"},
        )
        # Gateway should allow this (no originator = no restriction)
        assert resp.status_code == 200, (
            f"Expected 200 for cancel with no originator stored, "
            f"got {resp.status_code}: {resp.text}"
        )

    def test_cancel_response_includes_task_id(self) -> None:
        """CANCEL-AUTHZ-05: Successful cancel response includes the task_id.

        Spec: The caller needs the task_id echoed back to confirm which task was cancelled.
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": ORCHESTRATOR_ID, "reason": "Done"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "task_id" in data
        assert data["task_id"] == task_id

    def test_originator_error_in_cancel_response(self) -> None:
        """CANCEL-AUTHZ-06: 403 response includes originator identity in details.

        Spec: The 403 response details include the actual originator so the caller
        knows who dispatched the task.  This aids debugging.
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": SCRAPER_ID, "reason": "Unauthorized"},
        )
        assert resp.status_code == 403
        data = resp.json()
        details = data.get("details", {})
        assert (
            details.get("originator") == ORCHESTRATOR_ID
            or ORCHESTRATOR_ID in str(data)
        )


# ===========================================================================
# CANCEL-CONTROL: Control Channel Publishing
# ===========================================================================


@_skip_wave6
class TestCancelControlChannel:
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
        """CANCEL-CTRL-01: Successful cancel publishes {command: cancel, task_id} to channel.

        Spec: 'Gateway publishes cancel command to control:{agent_id} Redis pub/sub channel'
        The harness listens on this channel and initiates graceful abort.
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        received = read_control_channel_sync(
            self.fake_redis,
            ORCHESTRATOR_ID,
            lambda: self.client.post(
                f"/tasks/{task_id}/cancel",
                json={"agent_id": ORCHESTRATOR_ID, "reason": "Test"},
            ),
        )

        assert len(received) >= 1, "Expected cancel command on control channel"
        msg = received[0]
        assert msg.get("command") == "cancel"
        assert msg.get("task_id") == task_id

    def test_cancel_uses_requesting_agent_control_channel(self) -> None:
        """CANCEL-CTRL-02: Cancel is published to the REQUESTING agent's control channel.

        Spec: control:{requesting_agent_id} — the harness registers by agent_id,
        so the cancel must target the agent's control channel, not a generic one.
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        # The channel should be control:orchestrator (requesting agent)
        received = read_control_channel_sync(
            self.fake_redis,
            ORCHESTRATOR_ID,  # Listen on orchestrator's channel
            lambda: self.client.post(
                f"/tasks/{task_id}/cancel",
                json={"agent_id": ORCHESTRATOR_ID, "reason": "Routing test"},
            ),
        )
        assert len(received) >= 1

    def test_rejected_cancel_does_not_publish_to_control_channel(self) -> None:
        """CANCEL-CTRL-03: Rejected cancel (wrong originator) does not publish to channel.

        Spec: Only authorized cancels should publish cancel commands.
        A rejected cancel must not disrupt the running task.
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        # Track messages published
        messages_published: list[Any] = []

        async def listen_briefly() -> None:
            pubsub = self.fake_redis.pubsub()
            await pubsub.subscribe(f"control:{SCRAPER_ID}")
            # Issue the unauthorized cancel
            self.client.post(
                f"/tasks/{task_id}/cancel",
                json={"agent_id": SCRAPER_ID, "reason": "Rogue cancel"},
            )
            # Brief listen for any published messages
            try:
                msg = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True),
                    timeout=0.1,
                )
                if msg:
                    messages_published.append(msg)
            except asyncio.TimeoutError:
                pass
            await pubsub.unsubscribe(f"control:{SCRAPER_ID}")

        asyncio.get_event_loop().run_until_complete(listen_briefly())
        assert len(messages_published) == 0, (
            "Rejected cancel should not publish to control channel"
        )


# ===========================================================================
# CANCEL-HARNESS: Harness Cancel Integration
# ===========================================================================


@_skip_wave6
class TestHarnessCancelIntegration:
    """Spec: Agent harness listens for cancel command and escalates abort."""

    def setup_method(self) -> None:
        try:
            from kubex_harness.harness import KubexHarness, HarnessConfig, ExitReason
            import fakeredis

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            self.HarnessConfig = HarnessConfig
            self.KubexHarness = KubexHarness
            self.ExitReason = ExitReason

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_harness_exit_reason_on_cancel(self) -> None:
        """CANCEL-HARNESS-01: When cancel command received, harness exits with 'cancelled' reason.

        Spec: Harness abort sequence: keystroke → SIGTERM → SIGKILL
        Final progress update must have exit_reason='cancelled'.
        """
        import asyncio

        config = self.HarnessConfig(
            agent_id=ORCHESTRATOR_ID,
            task_id=make_task_id(),
            gateway_url="http://gateway:8080",
        )

        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        # Simulate cancel command arriving on the control channel
        task_id = config.task_id

        async def simulate_cancel_and_check() -> str | None:
            """Publish cancel then check the exit reason."""
            await self.fake_redis.publish(
                f"control:{ORCHESTRATOR_ID}",
                json.dumps({"command": "cancel", "task_id": task_id}),
            )
            # The harness should process this and record exit_reason
            exit_reason = await harness._process_cancel_command(task_id)
            return exit_reason

        exit_reason = asyncio.get_event_loop().run_until_complete(simulate_cancel_and_check())
        assert exit_reason == self.ExitReason.CANCELLED or (
            hasattr(exit_reason, "value") and exit_reason.value == "cancelled"
        )

    def test_harness_ignores_cancel_for_different_task_id(self) -> None:
        """CANCEL-HARNESS-02: Harness ignores cancel commands for other task IDs.

        Spec: Cancel commands must be scoped to the specific task the harness is running.
        A cancel for task-A must not abort the harness running task-B.
        """
        import asyncio

        my_task_id = make_task_id()
        other_task_id = make_task_id()

        config = self.HarnessConfig(
            agent_id=ORCHESTRATOR_ID,
            task_id=my_task_id,
            gateway_url="http://gateway:8080",
        )
        harness = self.KubexHarness(config=config, redis_client=self.fake_redis)

        async def simulate() -> bool:
            # Publish cancel for a different task
            await self.fake_redis.publish(
                f"control:{ORCHESTRATOR_ID}",
                json.dumps({"command": "cancel", "task_id": other_task_id}),
            )
            # Harness should ignore this
            should_abort = await harness._should_abort_for_task(other_task_id, my_task_id)
            return should_abort

        should_abort = asyncio.get_event_loop().run_until_complete(simulate())
        assert should_abort is False, (
            "Harness should not abort for a cancel command targeting a different task_id"
        )


# ===========================================================================
# CANCEL-EDGE: Edge Cases and Expiry
# ===========================================================================


@_skip_wave6
class TestCancelEdgeCases:
    """Spec: Edge cases and TTL expiry for cancel authorization."""

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

    def test_cancel_after_ttl_expiry_is_allowed(self) -> None:
        """CANCEL-EDGE-01: Cancel after originator TTL expiry is allowed (no record = no restriction).

        Spec: TTL-expired originator records should not block cleanup operations.
        Operations infrastructure may need to cancel tasks after the TTL.
        """
        task_id = make_task_id()
        # Do NOT store originator — simulates TTL expiry

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": ORCHESTRATOR_ID, "reason": "Post-TTL cleanup"},
        )
        # No originator stored → no restriction → allowed
        assert resp.status_code == 200

    def test_cancel_same_task_twice_is_idempotent(self) -> None:
        """CANCEL-EDGE-02: Cancelling the same task twice does not cause errors.

        Spec: Cancel is idempotent — re-cancelling an already-cancelled task must
        return 200, not 500 or 404.  The harness handles duplicate cancel commands.
        """
        task_id = make_task_id()
        store_originator_sync(self.fake_redis, task_id, ORCHESTRATOR_ID)

        for _ in range(2):
            resp = self.client.post(
                f"/tasks/{task_id}/cancel",
                json={"agent_id": ORCHESTRATOR_ID, "reason": "Duplicate cancel"},
            )
            assert resp.status_code == 200, (
                f"Expected 200 on idempotent cancel, got {resp.status_code}: {resp.text}"
            )
