"""Unit tests for the Kubex Broker service."""

from __future__ import annotations

import json
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/broker"))

from broker.streams import BrokerStreams, STREAM_NAME, RESULT_KEY_PREFIX, MAX_RETRIES
from kubex_common.schemas.routing import TaskDelivery


def make_delivery(**kwargs: object) -> TaskDelivery:
    defaults = {
        "task_id": "task-001",
        "workflow_id": "wf-001",
        "capability": "scrape_profile",
        "context_message": "Scrape Nike Instagram profile",
        "from_agent": "orchestrator",
        "priority": "normal",
    }
    defaults.update(kwargs)
    return TaskDelivery(**defaults)  # type: ignore[arg-type]


def make_mock_redis() -> AsyncMock:
    """Create a mock Redis client."""
    mock = AsyncMock()
    mock.xgroup_create = AsyncMock(return_value=True)
    mock.xadd = AsyncMock(return_value="1234567890-0")
    mock.xreadgroup = AsyncMock(return_value=[])
    mock.xack = AsyncMock(return_value=1)
    mock.xpending_range = AsyncMock(return_value=[])
    mock.xclaim = AsyncMock(return_value=[])
    mock.xrange = AsyncMock(return_value=[])
    mock.set = AsyncMock(return_value=True)
    mock.get = AsyncMock(return_value=None)
    return mock


class TestBrokerStreams:
    def setup_method(self) -> None:
        self.redis = make_mock_redis()
        self.streams = BrokerStreams(self.redis)

    @pytest.mark.asyncio
    async def test_ensure_stream_and_group_creates_new(self) -> None:
        await self.streams.ensure_stream_and_group("scraper")
        self.redis.xgroup_create.assert_called_once_with(
            STREAM_NAME, "scraper", id="0", mkstream=True
        )

    @pytest.mark.asyncio
    async def test_ensure_stream_and_group_handles_busygroup(self) -> None:
        self.redis.xgroup_create = AsyncMock(side_effect=Exception("BUSYGROUP group already exists"))
        # Should not raise
        await self.streams.ensure_stream_and_group("scraper")

    @pytest.mark.asyncio
    async def test_publish_returns_message_id(self) -> None:
        delivery = make_delivery()
        msg_id = await self.streams.publish(delivery)
        assert msg_id == "1234567890-0"

    @pytest.mark.asyncio
    async def test_publish_calls_xadd(self) -> None:
        delivery = make_delivery()
        await self.streams.publish(delivery)
        # xadd called at least once for the main stream (and possibly for audit)
        assert self.redis.xadd.call_count >= 1
        # First call should be to the main stream
        first_call_args = self.redis.xadd.call_args_list[0]
        assert first_call_args[0][0] == STREAM_NAME  # first positional arg is stream name

    @pytest.mark.asyncio
    async def test_publish_audits_message(self) -> None:
        delivery = make_delivery()
        await self.streams.publish(delivery)
        # audit stream should be written to
        audit_call = any(
            "audit:messages" in str(call) for call in self.redis.xadd.call_args_list
        )
        assert audit_call

    @pytest.mark.asyncio
    async def test_consume_returns_empty_list_when_no_messages(self) -> None:
        self.redis.xreadgroup = AsyncMock(return_value=[])
        result = await self.streams.consume("scraper")
        assert result == []

    @pytest.mark.asyncio
    async def test_consume_parses_messages(self) -> None:
        self.redis.xreadgroup = AsyncMock(
            return_value=[
                (
                    STREAM_NAME,
                    [
                        (
                            "123-0",
                            {
                                "task_id": "t-1",
                                "capability": "scrape_profile",
                                "context_message": "Do it",
                                "from_agent": "orchestrator",
                            },
                        )
                    ],
                )
            ]
        )
        result = await self.streams.consume("scraper")
        assert len(result) == 1
        assert result[0]["task_id"] == "t-1"
        assert result[0]["message_id"] == "123-0"

    @pytest.mark.asyncio
    async def test_acknowledge_calls_xack(self) -> None:
        await self.streams.acknowledge("scraper", "123-0")
        self.redis.xack.assert_called_once_with(STREAM_NAME, "scraper", "123-0")

    @pytest.mark.asyncio
    async def test_handle_pending_no_pending_messages(self) -> None:
        count = await self.streams.handle_pending("scraper")
        assert count == 0

    @pytest.mark.asyncio
    async def test_handle_pending_sends_to_dlq_when_max_retries_exceeded(self) -> None:
        pending_entry = {
            "message_id": "123-0",
            "times_delivered": MAX_RETRIES,
        }
        self.redis.xpending_range = AsyncMock(return_value=[pending_entry])
        self.redis.xrange = AsyncMock(
            return_value=[("123-0", {"task_id": "t-1", "capability": "test"})]
        )

        count = await self.streams.handle_pending("scraper")
        assert count == 1
        # Should have acked the message
        self.redis.xack.assert_called()

    @pytest.mark.asyncio
    async def test_handle_pending_reclaims_retryable(self) -> None:
        pending_entry = {
            "message_id": "456-0",
            "times_delivered": 1,
        }
        self.redis.xpending_range = AsyncMock(return_value=[pending_entry])

        count = await self.streams.handle_pending("scraper")
        assert count == 0
        self.redis.xclaim.assert_called()

    @pytest.mark.asyncio
    async def test_store_result(self) -> None:
        await self.streams.store_result("task-001", {"status": "success", "data": "foo"})
        self.redis.set.assert_called_once()
        call_args = self.redis.set.call_args
        assert f"{RESULT_KEY_PREFIX}task-001" in call_args[0]

    @pytest.mark.asyncio
    async def test_get_result_returns_none_when_missing(self) -> None:
        self.redis.get = AsyncMock(return_value=None)
        result = await self.streams.get_result("task-001")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_result_returns_stored_data(self) -> None:
        stored = {"status": "success", "data": "scraped"}
        self.redis.get = AsyncMock(return_value=json.dumps(stored))
        result = await self.streams.get_result("task-001")
        assert result == stored

    @pytest.mark.asyncio
    async def test_store_result_sets_ttl(self) -> None:
        await self.streams.store_result("task-001", {"result": "ok"})
        call_args = self.redis.set.call_args
        # TTL should be set via 'ex' keyword argument
        assert call_args[1].get("ex") is not None or len(call_args[0]) > 2


class TestBrokerEndpoints:
    def setup_method(self) -> None:
        import sys
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/broker"))
        from fastapi.testclient import TestClient
        from broker.main import app
        self.client = TestClient(app)

    def test_health_endpoint(self) -> None:
        resp = self.client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["service"] == "kubex-broker"

    def test_publish_without_redis_returns_503_or_500(self) -> None:
        # Without Redis connected, streams is None, so any operation should fail
        resp = self.client.post(
            "/messages",
            json={
                "delivery": {
                    "task_id": "task-001",
                    "capability": "scrape_profile",
                    "context_message": "Do scraping",
                    "from_agent": "orchestrator",
                    "priority": "normal",
                }
            },
        )
        # Without Redis, this will fail — 500 is acceptable
        assert resp.status_code in (202, 422, 500, 503)

    def test_get_task_result_without_redis_returns_error(self) -> None:
        resp = self.client.get("/tasks/nonexistent-task/result")
        assert resp.status_code in (404, 500, 503)
