"""Unit tests for Gateway audit endpoint (Phase 10).

Tests cover:
  HOOK-04 (read): GET /tasks/{task_id}/audit returns audit trail from Redis
"""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# HOOK-04: Audit trail read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_endpoint_returns_entries():
    """GET /tasks/{task_id}/audit returns JSON array of audit entries."""
    pytest.skip("Plan 02 implementation")


@pytest.mark.asyncio
async def test_audit_endpoint_empty_task():
    """GET /tasks/{task_id}/audit for unknown task_id returns empty entries array."""
    pytest.skip("Plan 02 implementation")


@pytest.mark.asyncio
async def test_audit_endpoint_redis_unavailable():
    """GET /tasks/{task_id}/audit returns 503 when Redis is down."""
    pytest.skip("Plan 02 implementation")
