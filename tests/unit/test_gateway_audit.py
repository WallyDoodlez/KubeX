"""Unit tests for Gateway audit endpoint (Phase 10).

Tests cover:
  HOOK-04 (read): GET /tasks/{task_id}/audit returns audit trail from Redis
"""

from __future__ import annotations

import json
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))


# ---------------------------------------------------------------------------
# HOOK-04: Audit trail read
# ---------------------------------------------------------------------------


class TestGatewayAuditEndpoint:
    """GET /tasks/{task_id}/audit returns sorted audit trail from Redis."""

    def setup_method(self) -> None:
        from gateway.main import app

        self.app = app
        # Reset shared singleton Redis state before each test
        self.app.state.gateway_service.redis_db0 = None
        self.app.state.gateway_service.redis_db1 = None
        self.app.state.gateway_service.budget_tracker = None
        self.app.state.gateway_service.rate_limiter = None
        self.client = TestClient(app)

    def test_audit_endpoint_returns_entries(self) -> None:
        """GET /tasks/{task_id}/audit returns JSON array of audit entries."""
        entry1 = json.dumps({"tool_name": "Write", "timestamp": 1711100000.0, "success": True})
        entry2 = json.dumps({"tool_name": "Read", "timestamp": 1711100001.0, "success": True})

        mock_redis = AsyncMock()
        mock_redis.zrange = AsyncMock(return_value=[entry1, entry2])
        self.app.state.gateway_service.redis_db0 = mock_redis

        resp = self.client.get("/tasks/task-123/audit")

        assert resp.status_code == 200
        data = resp.json()
        assert data["task_id"] == "task-123"
        assert isinstance(data["entries"], list)
        assert len(data["entries"]) == 2
        assert data["entries"][0]["tool_name"] == "Write"
        assert data["entries"][1]["tool_name"] == "Read"

    def test_audit_endpoint_empty_task(self) -> None:
        """GET /tasks/{task_id}/audit for unknown task_id returns empty entries array."""
        mock_redis = AsyncMock()
        mock_redis.zrange = AsyncMock(return_value=[])
        self.app.state.gateway_service.redis_db0 = mock_redis

        resp = self.client.get("/tasks/unknown-task/audit")

        assert resp.status_code == 200
        data = resp.json()
        assert data["task_id"] == "unknown-task"
        assert data["entries"] == []

    def test_audit_endpoint_redis_unavailable(self) -> None:
        """GET /tasks/{task_id}/audit returns 503 when Redis is down."""
        # redis_db0 is already None from setup_method
        resp = self.client.get("/tasks/task-123/audit")

        assert resp.status_code == 503
        data = resp.json()
        assert data["error"] == "Redis unavailable"
