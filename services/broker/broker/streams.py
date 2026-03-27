"""Redis Streams transport layer for the Kubex Broker.

Uses a single stream 'boundary:default' for MVP.
Consumer groups are created per agent_id.
"""

from __future__ import annotations

import json
from datetime import datetime, UTC
from typing import Any

from kubex_common.logging import get_logger
from kubex_common.schemas.routing import TaskDelivery

logger = get_logger(__name__)

# Constants
STREAM_NAME = "boundary:default"
AUDIT_STREAM = "audit:messages"
DLQ_STREAM = "boundary:dlq"
STREAM_MAXLEN = 10000
MAX_RETRIES = 3
RETRY_AFTER_MS = 60_000  # 60 seconds
RESULT_KEY_PREFIX = "task:result:"
RESULT_TTL_SECONDS = 86400  # 24 hours


class BrokerStreams:
    """Redis Streams transport for the Broker.

    Manages:
    - Publishing TaskDelivery messages to boundary:default stream
    - Consumer group management per agent
    - Message acknowledgment and dead letter handling
    - Audit forwarding
    - Task result storage and retrieval
    """

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    async def ensure_stream_and_group(self, agent_id: str) -> None:
        """Ensure the stream and consumer group for an agent exist."""
        try:
            # Create stream with dummy entry if it doesn't exist, then delete that entry
            # xgroup_create with mkstream=True creates the stream if needed
            await self._redis.xgroup_create(
                STREAM_NAME,
                agent_id,
                id="$",
                mkstream=True,
            )
            logger.info("consumer_group_created", stream=STREAM_NAME, group=agent_id)
        except Exception as exc:
            # BUSYGROUP = group already exists, that's OK
            if "BUSYGROUP" in str(exc):
                logger.debug("consumer_group_exists", group=agent_id)
            else:
                logger.warning("consumer_group_create_failed", group=agent_id, error=str(exc))

    async def publish(self, delivery: TaskDelivery) -> str:
        """Publish a TaskDelivery to the boundary:default stream.

        Returns the stream message ID.
        """
        # Ensure consumer group for the target capability's agents
        await self.ensure_stream_and_group(delivery.capability)

        payload = {
            "task_id": delivery.task_id,
            "workflow_id": delivery.workflow_id or "",
            "capability": delivery.capability,
            "context_message": delivery.context_message,
            "from_agent": delivery.from_agent,
            "priority": delivery.priority,
            "published_at": datetime.now(UTC).isoformat(),
        }

        message_id: str = await self._redis.xadd(
            STREAM_NAME,
            payload,
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )

        # Forward to audit stream
        await self._audit(message_id, delivery)

        logger.info(
            "message_published",
            task_id=delivery.task_id,
            capability=delivery.capability,
            stream_id=message_id,
        )
        return message_id

    async def consume(
        self,
        agent_id: str,
        count: int = 10,
        block_ms: int = 0,
        *,
        filter_by_capability: bool = False,
    ) -> list[dict[str, Any]]:
        """Consume messages from the agent's consumer group.

        Returns a list of TaskDelivery-like dicts.
        block_ms=0 means non-blocking (returns immediately).

        When filter_by_capability is True (default), messages whose
        'capability' field does not match the agent_id (consumer group
        name) are silently acknowledged and skipped.  This ensures that
        capability-based consumer groups only receive their own tasks
        even though all messages share a single Redis stream.

        Reliable delivery: pending messages (delivered but not yet acked)
        are re-delivered first (id="0"), followed by new messages (id=">").
        This ensures messages are never lost if a consumer crashes between
        delivery and acknowledgement.
        """
        await self.ensure_stream_and_group(agent_id)

        # Step 1: re-deliver any pending (previously delivered but unacked) messages.
        # Using id="0" fetches all PEL entries for this consumer that have not been acked.
        # This handles the case where the consumer crashed or was restarted after receiving
        # a message but before acknowledging it.
        pending_messages = await self._redis.xreadgroup(
            groupname=agent_id,
            consumername=agent_id,
            streams={STREAM_NAME: "0"},
            count=count,
        )

        # Step 2: fetch new messages not yet delivered to any consumer in this group.
        # block only applies to new messages (not pending re-delivery).
        new_messages = await self._redis.xreadgroup(
            groupname=agent_id,
            consumername=agent_id,
            streams={STREAM_NAME: ">"},
            count=count,
            block=block_ms if block_ms > 0 else None,
        )

        # Combine pending + new, pending first so stuck messages are resolved before
        # accepting new work.
        all_raw: list[tuple[str, list[tuple[str, dict[str, Any]]]]] = []
        if pending_messages:
            all_raw.extend(pending_messages)
        if new_messages:
            all_raw.extend(new_messages)

        result = []
        for _stream_name, entries in all_raw:
            for message_id, fields in entries:
                # Filter by capability when the consumer group represents
                # a capability (not a generic agent consumer).
                if filter_by_capability:
                    msg_capability = fields.get("capability", "")
                    if msg_capability and msg_capability != agent_id:
                        # Auto-ack messages not meant for this consumer group
                        try:
                            await self._redis.xack(STREAM_NAME, agent_id, message_id)
                        except Exception:
                            pass
                        continue
                result.append({"message_id": message_id, **fields})

        return result

    async def acknowledge(self, agent_id: str, message_id: str) -> None:
        """Acknowledge successful processing of a message."""
        await self._redis.xack(STREAM_NAME, agent_id, message_id)
        logger.debug("message_acked", group=agent_id, message_id=message_id)

    async def handle_pending(self, agent_id: str) -> int:
        """Process pending (unacknowledged) messages.

        Messages older than RETRY_AFTER_MS are retried.
        Messages exceeding MAX_RETRIES go to the DLQ.

        Returns the number of messages sent to DLQ.
        """
        dlq_count = 0
        try:
            # Get pending messages older than RETRY_AFTER_MS
            pending = await self._redis.xpending_range(
                STREAM_NAME,
                agent_id,
                min="-",
                max="+",
                count=100,
                idle=RETRY_AFTER_MS,
            )

            for entry in pending:
                message_id = entry["message_id"]
                delivery_count = entry.get("times_delivered", 0)

                if delivery_count >= MAX_RETRIES:
                    # Move to DLQ
                    await self._send_to_dlq(message_id, agent_id)
                    await self.acknowledge(agent_id, message_id)
                    dlq_count += 1
                    logger.warning(
                        "message_sent_to_dlq",
                        message_id=message_id,
                        group=agent_id,
                        delivery_count=delivery_count,
                    )
                else:
                    # Re-claim for retry — xclaim transfers ownership back to the consumer
                    # so that the next xreadgroup with id=0 (pending entries) will re-deliver it.
                    await self._redis.xclaim(
                        STREAM_NAME,
                        agent_id,
                        agent_id,
                        min_idle_time=0,
                        message_ids=[message_id],
                    )

        except Exception as exc:
            logger.warning("pending_handling_failed", group=agent_id, error=str(exc))

        return dlq_count

    async def _send_to_dlq_for_test(self, message_id: str, group: str) -> int:
        """Test helper — send a message directly to DLQ and return count.

        This method is used by tests to simulate DLQ scenarios without
        waiting for RETRY_AFTER_MS to elapse.
        """
        await self._send_to_dlq(message_id, group)
        return 1

    async def _send_to_dlq(self, message_id: str, group: str) -> None:
        """Send a message to the dead letter queue."""
        try:
            # Read the original message
            messages = await self._redis.xrange(STREAM_NAME, min=message_id, max=message_id)
            if messages:
                _, fields = messages[0]
                dlq_payload = {
                    **fields,
                    "original_message_id": message_id,
                    "original_group": group,
                    "moved_to_dlq_at": datetime.now(UTC).isoformat(),
                }
                await self._redis.xadd(DLQ_STREAM, dlq_payload)
        except Exception as exc:
            logger.error("dlq_send_failed", message_id=message_id, error=str(exc))

    async def _audit(self, message_id: str, delivery: TaskDelivery) -> None:
        """Log message to audit stream."""
        try:
            audit_payload = {
                "event": "message_published",
                "stream_message_id": message_id,
                "task_id": delivery.task_id,
                "capability": delivery.capability,
                "from_agent": delivery.from_agent,
                "timestamp": datetime.now(UTC).isoformat(),
            }
            await self._redis.xadd("audit:messages", audit_payload, maxlen=10000, approximate=True)
        except Exception as exc:
            logger.warning("audit_failed", error=str(exc))

    async def store_result(self, task_id: str, result: dict[str, Any]) -> None:
        """Store task result in Redis with TTL."""
        key = f"{RESULT_KEY_PREFIX}{task_id}"
        await self._redis.set(key, json.dumps(result), ex=RESULT_TTL_SECONDS)
        logger.info("result_stored", task_id=task_id)

    async def get_result(self, task_id: str) -> dict[str, Any] | None:
        """Retrieve task result from Redis."""
        key = f"{RESULT_KEY_PREFIX}{task_id}"
        raw = await self._redis.get(key)
        if raw is None:
            return None
        return json.loads(raw)
