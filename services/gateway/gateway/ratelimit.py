"""Rate limiting for the Gateway using Redis db1.

Implements sliding window rate limiting per-agent per-action.
Rate limit format: "N/window" where window is "min", "hour", or "task".

For MVP, "task" limits are tracked per task_id + action.
"min" and "hour" limits use sliding window via Redis sorted sets.
"""

from __future__ import annotations

import time
from typing import Any

from kubex_common.logging import get_logger

logger = get_logger(__name__)

# Redis key prefixes
RATE_LIMIT_PREFIX = "ratelimit:"
WINDOW_SECONDS = {
    "min": 60,
    "hour": 3600,
    "day": 86400,
}


def _parse_limit(limit_str: str) -> tuple[int, str]:
    """Parse a rate limit string like '100/task' or '60/min'.

    Returns (count, window) where window is 'min', 'hour', 'day', or 'task'.
    """
    parts = limit_str.split("/")
    if len(parts) != 2:
        raise ValueError(f"Invalid rate limit format: {limit_str}")
    count = int(parts[0].strip())
    window = parts[1].strip().lower()
    return count, window


class RateLimiter:
    """Sliding window rate limiter backed by Redis.

    Uses Redis sorted sets with timestamps as scores for sliding windows.
    """

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    async def check_and_increment(
        self,
        agent_id: str,
        action: str,
        limit_str: str,
        task_id: str | None = None,
    ) -> bool:
        """Check if the rate limit is exceeded and increment counter.

        Returns True if allowed, False if rate-limited.
        """
        try:
            limit, window = _parse_limit(limit_str)

            if window == "task":
                return await self._check_task_limit(agent_id, action, limit, task_id or "unknown")
            else:
                return await self._check_time_window_limit(agent_id, action, limit, window)
        except Exception as exc:
            logger.warning("rate_limit_check_error", agent_id=agent_id, action=action, error=str(exc))
            # Fail open — if rate limiter is broken, don't block requests
            return True

    async def _check_task_limit(
        self, agent_id: str, action: str, limit: int, task_id: str
    ) -> bool:
        """Counter-based rate limit per task."""
        key = f"{RATE_LIMIT_PREFIX}task:{task_id}:{agent_id}:{action}"
        current = await self._redis.incr(key)
        if current == 1:
            # Set expiry on first increment (24h to handle long tasks)
            await self._redis.expire(key, 86400)
        allowed = current <= limit
        if not allowed:
            logger.info(
                "rate_limit_exceeded",
                agent_id=agent_id,
                action=action,
                limit=limit,
                current=current,
                window="task",
            )
        return allowed

    async def _check_time_window_limit(
        self, agent_id: str, action: str, limit: int, window: str
    ) -> bool:
        """Sliding window rate limit using sorted set."""
        window_seconds = WINDOW_SECONDS.get(window, 60)
        now = time.time()
        window_start = now - window_seconds
        key = f"{RATE_LIMIT_PREFIX}window:{agent_id}:{action}"

        # Remove expired entries
        await self._redis.zremrangebyscore(key, "-inf", window_start)

        # Count current entries
        current = await self._redis.zcard(key)

        if current >= limit:
            logger.info(
                "rate_limit_exceeded",
                agent_id=agent_id,
                action=action,
                limit=limit,
                current=current,
                window=window,
            )
            return False

        # Add current request
        await self._redis.zadd(key, {f"{now}:{id(object())}": now})
        # Set expiry to clean up old keys
        await self._redis.expire(key, window_seconds * 2)
        return True

    async def get_counter(self, agent_id: str, action: str, task_id: str) -> int:
        """Get current task-scoped counter for monitoring."""
        key = f"{RATE_LIMIT_PREFIX}task:{task_id}:{agent_id}:{action}"
        val = await self._redis.get(key)
        return int(val) if val else 0
