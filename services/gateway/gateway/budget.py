"""Budget tracking for the Gateway using Redis db4.

Tracks per-task and per-day token usage and cost.
"""

from __future__ import annotations

import json
from datetime import datetime, UTC
from typing import Any

from kubex_common.logging import get_logger

logger = get_logger(__name__)

BUDGET_PREFIX = "budget:"
TASK_TOKENS_KEY = "budget:task:{task_id}:tokens"
AGENT_DAILY_COST_KEY = "budget:agent:{agent_id}:daily:{date}"
TASK_TTL_SECONDS = 86400 * 7  # 7 days
DAILY_TTL_SECONDS = 86400 * 2  # 2 days (cover rollover)


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


class BudgetTracker:
    """Redis-backed budget tracking per task and per day."""

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    async def increment_tokens(
        self,
        task_id: str,
        agent_id: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str = "unknown",
        cost_usd: float = 0.0,
    ) -> dict[str, Any]:
        """Record token usage for a task.

        Returns updated totals: {total_tokens, total_cost_usd}
        """
        today = _today()
        task_key = TASK_TOKENS_KEY.format(task_id=task_id)
        daily_key = AGENT_DAILY_COST_KEY.format(agent_id=agent_id, date=today)

        total_tokens = input_tokens + output_tokens

        # Increment task token counter
        await self._redis.incrby(task_key, total_tokens)
        await self._redis.expire(task_key, TASK_TTL_SECONDS)

        # Track daily cost as float string
        current_raw = await self._redis.get(daily_key)
        current_cost = float(current_raw) if current_raw else 0.0
        new_cost = current_cost + cost_usd
        await self._redis.set(daily_key, f"{new_cost:.6f}", ex=DAILY_TTL_SECONDS)

        new_total_tokens = int(await self._redis.get(task_key) or 0)

        logger.debug(
            "tokens_tracked",
            task_id=task_id,
            agent_id=agent_id,
            input=input_tokens,
            output=output_tokens,
            model=model,
            cost_usd=cost_usd,
        )

        return {
            "task_total_tokens": new_total_tokens,
            "daily_cost_usd": new_cost,
        }

    async def get_task_tokens(self, task_id: str) -> int:
        """Get total token count for a task."""
        key = TASK_TOKENS_KEY.format(task_id=task_id)
        val = await self._redis.get(key)
        return int(val) if val else 0

    async def get_daily_cost(self, agent_id: str) -> float:
        """Get today's total cost for an agent."""
        today = _today()
        key = AGENT_DAILY_COST_KEY.format(agent_id=agent_id, date=today)
        val = await self._redis.get(key)
        return float(val) if val else 0.0

    async def get_budget_status(self, task_id: str, agent_id: str) -> dict[str, Any]:
        """Get current budget status for a task/agent combo."""
        task_tokens = await self.get_task_tokens(task_id)
        daily_cost = await self.get_daily_cost(agent_id)
        return {
            "task_id": task_id,
            "agent_id": agent_id,
            "task_total_tokens": task_tokens,
            "daily_cost_usd": daily_cost,
        }
