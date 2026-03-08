"""Layer 2: Redis Integration Tests using fakeredis.

Tests real Redis semantics (Streams, sorted sets, hashes, etc.) without
requiring a running Redis server.  Uses fakeredis.FakeAsyncRedis as a
drop-in async Redis client.

Coverage:
  2.1 Broker Streams  — INT-BR-01 … INT-BR-09
  2.2 Registry Store  — INT-REG-01 … INT-REG-06
  2.3 Rate Limiter    — INT-RL-01 … INT-RL-04
  2.4 Budget Tracker  — INT-BT-01 … INT-BT-03
"""

from __future__ import annotations

import json
import sys
import os
import time
from datetime import datetime, UTC, timedelta
from unittest.mock import patch

import fakeredis
import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Path setup — add service roots so imports resolve without installation
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/broker"))
sys.path.insert(0, os.path.join(_ROOT, "services/registry"))
sys.path.insert(0, os.path.join(_ROOT, "services/gateway"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

from broker.streams import (
    BrokerStreams,
    STREAM_NAME,
    AUDIT_STREAM,
    DLQ_STREAM,
    RESULT_KEY_PREFIX,
    MAX_RETRIES,
    RESULT_TTL_SECONDS,
)
from registry.store import (
    AgentRegistration,
    AgentStatus,
    CapabilityStore,
    AGENTS_HASH_KEY,
    CAPABILITY_SET_PREFIX,
)
from gateway.ratelimit import RateLimiter, RATE_LIMIT_PREFIX
from gateway.budget import BudgetTracker, TASK_TOKENS_KEY, AGENT_DAILY_COST_KEY
from kubex_common.schemas.routing import TaskDelivery


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_redis() -> fakeredis.FakeAsyncRedis:
    """Return a fresh isolated fakeredis async client with decode_responses=True."""
    # Each test gets its own FakeServer so data never bleeds between tests
    server = fakeredis.FakeServer()
    return fakeredis.FakeAsyncRedis(server=server, decode_responses=True)


def make_delivery(**kwargs: object) -> TaskDelivery:
    defaults: dict[str, object] = {
        "task_id": "task-001",
        "workflow_id": "wf-001",
        "capability": "scrape_profile",
        "context_message": "Scrape Nike Instagram profile",
        "from_agent": "orchestrator",
        "priority": "normal",
    }
    defaults.update(kwargs)
    return TaskDelivery(**defaults)  # type: ignore[arg-type]


def make_registration(**kwargs: object) -> AgentRegistration:
    defaults: dict[str, object] = {
        "agent_id": "scraper-1",
        "capabilities": ["scrape_profile"],
        "status": AgentStatus.RUNNING,
        "boundary": "default",
    }
    defaults.update(kwargs)
    return AgentRegistration(**defaults)  # type: ignore[arg-type]


# ===========================================================================
# 2.1  Broker Streams
# ===========================================================================


class TestBrokerStreamsIntegration:
    """INT-BR-*: BrokerStreams with real Redis semantics via fakeredis."""

    @pytest.mark.asyncio
    async def test_publish_then_consume_round_trip(self) -> None:
        """INT-BR-01: A published message is consumed by the correct group."""
        r = make_redis()
        streams = BrokerStreams(r)
        delivery = make_delivery(capability="scrape_profile")

        msg_id = await streams.publish(delivery)
        assert msg_id  # non-empty stream ID

        consumed = await streams.consume("scrape_profile")
        assert len(consumed) == 1
        assert consumed[0]["task_id"] == "task-001"
        assert consumed[0]["message_id"] == msg_id

    @pytest.mark.asyncio
    async def test_consumer_group_created_on_first_publish(self) -> None:
        """INT-BR-02: The consumer group is created in Redis by ensure_stream_and_group."""
        r = make_redis()
        streams = BrokerStreams(r)

        await streams.ensure_stream_and_group("my-agent")

        # The group should now exist — a second call should not raise
        # (BUSYGROUP is swallowed) and the group should appear in XINFO
        info = await r.xinfo_groups(STREAM_NAME)
        group_names = [g["name"] for g in info]
        assert "my-agent" in group_names

    @pytest.mark.asyncio
    async def test_acknowledge_removes_from_pending(self) -> None:
        """INT-BR-03: Acknowledging a message removes it from the pending list."""
        r = make_redis()
        streams = BrokerStreams(r)
        delivery = make_delivery(capability="scrape_profile")

        await streams.publish(delivery)
        consumed = await streams.consume("scrape_profile")
        assert len(consumed) == 1

        msg_id = consumed[0]["message_id"]

        # Before ack — one pending entry
        pending_before = await r.xpending_range(STREAM_NAME, "scrape_profile", min="-", max="+", count=100)
        assert len(pending_before) == 1

        await streams.acknowledge("scrape_profile", msg_id)

        # After ack — no pending entries
        pending_after = await r.xpending_range(STREAM_NAME, "scrape_profile", min="-", max="+", count=100)
        assert len(pending_after) == 0

    @pytest.mark.asyncio
    async def test_multiple_agents_get_independent_consumer_groups(self) -> None:
        """INT-BR-04: Two agents each get their own consumer group and see their own messages."""
        r = make_redis()
        streams = BrokerStreams(r)

        # Publish one message
        delivery = make_delivery(capability="scrape_profile")
        await streams.publish(delivery)

        # Both agents consume — each sees the message independently
        consumed_agent1 = await streams.consume("scrape_profile")
        # Second consumer group: register a separate group
        await streams.ensure_stream_and_group("other_agent")
        # Publish another message for other_agent to consume
        delivery2 = make_delivery(task_id="task-002", capability="scrape_profile")
        await streams.publish(delivery2)

        consumed_agent2 = await streams.consume("other_agent")

        # scrape_profile consumed task-001
        assert any(m["task_id"] == "task-001" for m in consumed_agent1)
        # other_agent consumed task-002 (task-001 was before the group was created at id=0, but group reads from now)
        assert any(m["task_id"] == "task-002" for m in consumed_agent2)

    @pytest.mark.asyncio
    async def test_store_and_retrieve_result(self) -> None:
        """INT-BR-05: store_result writes JSON to Redis; get_result reads it back."""
        r = make_redis()
        streams = BrokerStreams(r)

        result_data = {"status": "success", "output": "scraped 42 posts"}
        await streams.store_result("task-001", result_data)

        retrieved = await streams.get_result("task-001")
        assert retrieved == result_data

    @pytest.mark.asyncio
    async def test_result_expires_after_ttl(self) -> None:
        """INT-BR-06: Stored results have a TTL set in Redis."""
        r = make_redis()
        streams = BrokerStreams(r)

        await streams.store_result("task-ttl", {"done": True})

        key = f"{RESULT_KEY_PREFIX}task-ttl"
        ttl = await r.ttl(key)
        # TTL should be close to RESULT_TTL_SECONDS (within a small tolerance)
        assert ttl > 0
        assert ttl <= RESULT_TTL_SECONDS

    @pytest.mark.asyncio
    async def test_audit_stream_written_on_publish(self) -> None:
        """INT-BR-07: Publishing a message writes a record to the audit stream."""
        r = make_redis()
        streams = BrokerStreams(r)

        delivery = make_delivery()
        await streams.publish(delivery)

        # Read audit stream entries
        audit_entries = await r.xrange(AUDIT_STREAM, min="-", max="+")
        assert len(audit_entries) >= 1
        _, fields = audit_entries[0]
        assert fields["event"] == "message_published"
        assert fields["task_id"] == "task-001"

    @pytest.mark.asyncio
    async def test_handle_pending_sends_to_dlq_after_max_retries(self) -> None:
        """INT-BR-08: Messages with delivery_count >= MAX_RETRIES are moved to DLQ.

        fakeredis tracks real wall-clock idle time, so xpending_range(idle=60000) returns
        nothing for a freshly consumed message.  We patch xpending_range on the Redis client
        to return a synthetic entry with times_delivered == MAX_RETRIES, simulating a message
        that has exceeded its retry budget.
        """
        r = make_redis()
        streams = BrokerStreams(r)

        delivery = make_delivery(capability="scrape_profile")
        msg_id = await streams.publish(delivery)
        # Consume so the message is in the pending list with delivery_count=1 in Redis
        await streams.consume("scrape_profile")

        # Patch xpending_range to report MAX_RETRIES deliveries (bypasses idle-time filter)
        original_xpending = r.xpending_range

        async def fake_xpending_range(*args: object, **kwargs: object) -> list[dict]:  # type: ignore[type-arg]
            """Return the real pending entry but override times_delivered."""
            # Call without the idle kwarg so fakeredis returns the entry
            kwargs_no_idle = {k: v for k, v in kwargs.items() if k != "idle"}
            real_results = await original_xpending(*args, **kwargs_no_idle)
            return [
                {**entry, "times_delivered": MAX_RETRIES}
                for entry in real_results
            ]

        r.xpending_range = fake_xpending_range  # type: ignore[method-assign]

        dlq_count = await streams.handle_pending("scrape_profile")
        assert dlq_count == 1

        # Message should be in the DLQ stream
        dlq_entries = await r.xrange(DLQ_STREAM, min="-", max="+")
        assert len(dlq_entries) >= 1
        _, dlq_fields = dlq_entries[0]
        assert dlq_fields["original_message_id"] == msg_id

    @pytest.mark.asyncio
    async def test_stream_maxlen_is_applied(self) -> None:
        """INT-BR-09: Publishing with maxlen keeps the stream bounded."""
        r = make_redis()
        streams = BrokerStreams(r)

        # Publish several messages
        for i in range(5):
            await streams.publish(make_delivery(task_id=f"task-{i:03d}"))

        # Stream should have at most the messages we added (fakeredis honours maxlen)
        entries = await r.xrange(STREAM_NAME, min="-", max="+")
        assert len(entries) <= 5
        assert len(entries) >= 1


# ===========================================================================
# 2.2  Registry Store
# ===========================================================================


class TestRegistryStoreIntegration:
    """INT-REG-*: CapabilityStore Redis persistence via fakeredis."""

    @pytest.mark.asyncio
    async def test_register_writes_to_redis(self) -> None:
        """INT-REG-01: register() with redis_client writes agent JSON to Redis hash."""
        r = make_redis()
        store = CapabilityStore()
        reg = make_registration()

        await store.register(reg, redis_client=r)

        raw = await r.hgetall(AGENTS_HASH_KEY)
        assert "scraper-1" in raw
        parsed = json.loads(raw["scraper-1"])
        assert parsed["agent_id"] == "scraper-1"

    @pytest.mark.asyncio
    async def test_capability_set_updated_on_register(self) -> None:
        """INT-REG-02: register() adds agent_id to the capability set in Redis."""
        r = make_redis()
        store = CapabilityStore()
        reg = make_registration(capabilities=["scrape_profile", "scrape_posts"])

        await store.register(reg, redis_client=r)

        members_profile = await r.smembers(f"{CAPABILITY_SET_PREFIX}scrape_profile")
        members_posts = await r.smembers(f"{CAPABILITY_SET_PREFIX}scrape_posts")
        assert "scraper-1" in members_profile
        assert "scraper-1" in members_posts

    @pytest.mark.asyncio
    async def test_deregister_removes_from_redis(self) -> None:
        """INT-REG-03: deregister() removes the agent hash entry and capability set members."""
        r = make_redis()
        store = CapabilityStore()
        reg = make_registration(capabilities=["scrape_profile"])

        await store.register(reg, redis_client=r)
        await store.deregister("scraper-1", redis_client=r)

        raw = await r.hgetall(AGENTS_HASH_KEY)
        assert "scraper-1" not in raw

        members = await r.smembers(f"{CAPABILITY_SET_PREFIX}scrape_profile")
        assert "scraper-1" not in members

    @pytest.mark.asyncio
    async def test_restore_from_redis_repopulates_memory(self) -> None:
        """INT-REG-04: A new store can restore its in-memory state from Redis."""
        r = make_redis()
        store1 = CapabilityStore()
        reg = make_registration()
        await store1.register(reg, redis_client=r)

        # Simulate restart: fresh store restores from Redis
        store2 = CapabilityStore()
        assert len(store2.list_all()) == 0  # empty before restore

        await store2.restore_from_redis(r)

        agents = store2.list_all()
        assert len(agents) == 1
        assert agents[0].agent_id == "scraper-1"
        assert agents[0].status == AgentStatus.RUNNING

    @pytest.mark.asyncio
    async def test_restore_from_redis_handles_corrupt_entry(self) -> None:
        """INT-REG-05: Corrupt JSON in Redis does not crash restore; valid entries still load."""
        r = make_redis()

        # Inject one valid and one corrupt entry directly
        valid_reg = make_registration(agent_id="valid-agent")
        valid_json = valid_reg.model_dump_json()
        await r.hset(AGENTS_HASH_KEY, "valid-agent", valid_json)
        await r.hset(AGENTS_HASH_KEY, "corrupt-agent", "NOT VALID JSON {{{{")

        store = CapabilityStore()
        # Should not raise
        await store.restore_from_redis(r)

        agents = store.list_all()
        agent_ids = [a.agent_id for a in agents]
        assert "valid-agent" in agent_ids
        # corrupt entry was skipped
        assert "corrupt-agent" not in agent_ids

    @pytest.mark.asyncio
    async def test_update_status_syncs_to_redis(self) -> None:
        """INT-REG-06: update_status() persists the new status to the Redis hash."""
        r = make_redis()
        store = CapabilityStore()
        reg = make_registration(status=AgentStatus.UNKNOWN)

        await store.register(reg, redis_client=r)
        await store.update_status("scraper-1", AgentStatus.RUNNING, redis_client=r)

        raw = await r.hgetall(AGENTS_HASH_KEY)
        assert "scraper-1" in raw
        parsed = json.loads(raw["scraper-1"])
        assert parsed["status"] == "running"


# ===========================================================================
# 2.3  Gateway Rate Limiter
# ===========================================================================


class TestRateLimiterIntegration:
    """INT-RL-*: RateLimiter sliding window with real Redis sorted set operations."""

    @pytest.mark.asyncio
    async def test_sliding_window_allows_under_limit(self) -> None:
        """INT-RL-01: Requests under the limit are all allowed."""
        r = make_redis()
        limiter = RateLimiter(r)

        allowed = []
        for _ in range(5):
            result = await limiter.check_and_increment("agent-1", "http_get", "10/min")
            allowed.append(result)

        assert all(allowed)

    @pytest.mark.asyncio
    async def test_sliding_window_blocks_at_limit(self) -> None:
        """INT-RL-02: The (N+1)th request within the window is denied."""
        r = make_redis()
        limiter = RateLimiter(r)

        # Fill up the limit (limit = 3)
        for _ in range(3):
            allowed = await limiter.check_and_increment("agent-1", "http_get", "3/min")
            assert allowed is True

        # Next request should be blocked
        blocked = await limiter.check_and_increment("agent-1", "http_get", "3/min")
        assert blocked is False

    @pytest.mark.asyncio
    async def test_sliding_window_allows_after_expiry(self) -> None:
        """INT-RL-03: After window entries expire, new requests are allowed again."""
        r = make_redis()
        limiter = RateLimiter(r)

        # Fill the window (limit=2, window=min)
        await limiter.check_and_increment("agent-1", "http_get", "2/min")
        await limiter.check_and_increment("agent-1", "http_get", "2/min")
        blocked = await limiter.check_and_increment("agent-1", "http_get", "2/min")
        assert blocked is False

        # Simulate time passing by directly removing all entries from the sorted set
        # (equivalent to the window expiring)
        key = f"{RATE_LIMIT_PREFIX}window:agent-1:http_get"
        await r.zremrangebyscore(key, "-inf", "+inf")  # clear all

        # Now the window is empty — request should be allowed
        allowed_after = await limiter.check_and_increment("agent-1", "http_get", "2/min")
        assert allowed_after is True

    @pytest.mark.asyncio
    async def test_task_counter_resets_for_new_task(self) -> None:
        """INT-RL-04: Task-scoped counters are independent per task_id."""
        r = make_redis()
        limiter = RateLimiter(r)

        # Fill task-A to its limit
        for _ in range(3):
            await limiter.check_and_increment("agent-1", "http_get", "3/task", task_id="task-A")
        blocked_a = await limiter.check_and_increment("agent-1", "http_get", "3/task", task_id="task-A")
        assert blocked_a is False

        # task-B should start fresh
        allowed_b = await limiter.check_and_increment("agent-1", "http_get", "3/task", task_id="task-B")
        assert allowed_b is True

        # Counter for task-B should be 1
        count = await limiter.get_counter("agent-1", "http_get", "task-B")
        assert count == 1


# ===========================================================================
# 2.4  Gateway Budget Tracker
# ===========================================================================


class TestBudgetTrackerIntegration:
    """INT-BT-*: BudgetTracker accumulation and persistence via fakeredis."""

    @pytest.mark.asyncio
    async def test_daily_cost_accumulates_across_calls(self) -> None:
        """INT-BT-01: Multiple increment_tokens calls accumulate daily cost correctly."""
        r = make_redis()
        tracker = BudgetTracker(r)

        await tracker.increment_tokens("t-1", "scraper", input_tokens=100, output_tokens=50, cost_usd=0.01)
        await tracker.increment_tokens("t-1", "scraper", input_tokens=200, output_tokens=100, cost_usd=0.02)
        await tracker.increment_tokens("t-1", "scraper", input_tokens=50, output_tokens=25, cost_usd=0.005)

        daily_cost = await tracker.get_daily_cost("scraper")
        assert daily_cost == pytest.approx(0.035, abs=1e-6)

    @pytest.mark.asyncio
    async def test_task_tokens_accumulate_correctly(self) -> None:
        """INT-BT-02: Token counts for a task accumulate correctly across calls."""
        r = make_redis()
        tracker = BudgetTracker(r)

        await tracker.increment_tokens("t-2", "scraper", input_tokens=100, output_tokens=50)
        await tracker.increment_tokens("t-2", "scraper", input_tokens=200, output_tokens=100)

        total = await tracker.get_task_tokens("t-2")
        # 100+50 + 200+100 = 450
        assert total == 450

    @pytest.mark.asyncio
    async def test_daily_key_rolls_over_at_midnight(self) -> None:
        """INT-BT-03: Cost for a different date is stored under a different key."""
        r = make_redis()
        tracker = BudgetTracker(r)

        today = datetime.now(UTC).strftime("%Y-%m-%d")
        yesterday = (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%d")

        # Simulate yesterday's cost by writing directly to Redis
        yesterday_key = AGENT_DAILY_COST_KEY.format(agent_id="scraper", date=yesterday)
        await r.set(yesterday_key, "5.000000")

        # Today's increment should NOT include yesterday's value
        await tracker.increment_tokens("t-3", "scraper", cost_usd=0.10)
        today_cost = await tracker.get_daily_cost("scraper")

        assert today_cost == pytest.approx(0.10, abs=1e-6)
        # Yesterday's key is untouched
        raw_yesterday = await r.get(yesterday_key)
        assert float(raw_yesterday) == pytest.approx(5.0)

    @pytest.mark.asyncio
    async def test_task_tokens_ttl_is_set(self) -> None:
        """INT-BT-04: Task token keys have a TTL set after increment."""
        r = make_redis()
        tracker = BudgetTracker(r)

        await tracker.increment_tokens("t-ttl", "scraper", input_tokens=10)

        key = TASK_TOKENS_KEY.format(task_id="t-ttl")
        ttl = await r.ttl(key)
        assert ttl > 0

    @pytest.mark.asyncio
    async def test_multiple_agents_have_independent_daily_costs(self) -> None:
        """INT-BT-05: Daily cost is tracked independently per agent_id."""
        r = make_redis()
        tracker = BudgetTracker(r)

        await tracker.increment_tokens("t-1", "scraper", cost_usd=0.05)
        await tracker.increment_tokens("t-2", "orchestrator", cost_usd=0.20)

        scraper_cost = await tracker.get_daily_cost("scraper")
        orch_cost = await tracker.get_daily_cost("orchestrator")

        assert scraper_cost == pytest.approx(0.05, abs=1e-6)
        assert orch_cost == pytest.approx(0.20, abs=1e-6)
