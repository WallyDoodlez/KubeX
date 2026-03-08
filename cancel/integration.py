"""Cancel Authorization Coordinator — enforces originator-only cancel.

Flow:
    1. On dispatch_task, Gateway stores task:originator:{task_id} = agent_id in Redis
    2. On cancel, Gateway checks originator == requesting agent_id
    3. If authorized, publishes cancel command to control:{agent_id} Redis channel
    4. Harness receives cancel and escalates abort (keystroke -> SIGTERM -> SIGKILL)

Wave 6 implementation: this module exists to satisfy the import guard in
test_cancel_auth.py.  The actual cancel logic lives in gateway/main.py
(cancel_task endpoint) and kubex_harness/harness.py (_listen_for_cancel).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

TASK_ORIGINATOR_PREFIX = "task:originator:"
TASK_ORIGINATOR_TTL = 86400  # 24 hours


@dataclass
class CancelAuthCoordinator:
    """Coordinates cancel authorization between Gateway and Harness.

    Responsibilities:
        - Store originator on dispatch
        - Verify originator on cancel request
        - Publish cancel command to control channel
        - Handle TTL expiry (no originator = allow cancel)
    """

    redis_client: Any = None

    async def store_originator(self, task_id: str, agent_id: str) -> None:
        """Store the originating agent for a task."""
        if self.redis_client:
            await self.redis_client.set(
                f"{TASK_ORIGINATOR_PREFIX}{task_id}",
                agent_id,
                ex=TASK_ORIGINATOR_TTL,
            )

    async def verify_originator(self, task_id: str, requesting_agent: str) -> bool:
        """Check if the requesting agent is the originator.

        Returns True if:
            - requesting_agent matches stored originator, OR
            - no originator is stored (TTL expired or never set)
        """
        if not self.redis_client:
            return True

        originator = await self.redis_client.get(f"{TASK_ORIGINATOR_PREFIX}{task_id}")
        if originator is None:
            return True  # No record = no restriction
        return originator == requesting_agent

    async def publish_cancel(self, agent_id: str, task_id: str) -> None:
        """Publish cancel command to the agent's control channel."""
        if self.redis_client:
            import json
            await self.redis_client.publish(
                f"control:{agent_id}",
                json.dumps({"command": "cancel", "task_id": task_id}),
            )
