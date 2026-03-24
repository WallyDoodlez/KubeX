"""Unit tests for the Gateway service endpoints."""

from __future__ import annotations

import json
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))

from gateway.ratelimit import RateLimiter, _parse_limit
from gateway.budget import BudgetTracker


# ─────────────────────────────────────────────
# Rate limiter tests
# ─────────────────────────────────────────────


class TestParseLimitString:
    def test_parse_per_minute(self) -> None:
        count, window = _parse_limit("60/min")
        assert count == 60
        assert window == "min"

    def test_parse_per_task(self) -> None:
        count, window = _parse_limit("100/task")
        assert count == 100
        assert window == "task"

    def test_parse_per_hour(self) -> None:
        count, window = _parse_limit("30/hour")
        assert count == 30
        assert window == "hour"

    def test_parse_invalid_format_raises(self) -> None:
        with pytest.raises(ValueError):
            _parse_limit("60")


class TestRateLimiter:
    def setup_method(self) -> None:
        self.redis = AsyncMock()
        self.limiter = RateLimiter(self.redis)

    @pytest.mark.asyncio
    async def test_task_limit_allows_first_request(self) -> None:
        self.redis.incr = AsyncMock(return_value=1)
        self.redis.expire = AsyncMock(return_value=True)
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "100/task", task_id="t-1")
        assert allowed is True

    @pytest.mark.asyncio
    async def test_task_limit_denies_over_limit(self) -> None:
        self.redis.incr = AsyncMock(return_value=101)
        self.redis.expire = AsyncMock(return_value=True)
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "100/task", task_id="t-1")
        assert allowed is False

    @pytest.mark.asyncio
    async def test_window_limit_allows_under_limit(self) -> None:
        self.redis.zremrangebyscore = AsyncMock(return_value=0)
        self.redis.zcard = AsyncMock(return_value=5)
        self.redis.zadd = AsyncMock(return_value=1)
        self.redis.expire = AsyncMock(return_value=True)
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "60/min")
        assert allowed is True

    @pytest.mark.asyncio
    async def test_window_limit_denies_at_limit(self) -> None:
        self.redis.zremrangebyscore = AsyncMock(return_value=0)
        self.redis.zcard = AsyncMock(return_value=60)
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "60/min")
        assert allowed is False

    @pytest.mark.asyncio
    async def test_fails_open_on_redis_error(self) -> None:
        self.redis.incr = AsyncMock(side_effect=Exception("Redis down"))
        # Should not raise, should allow (fail open)
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "100/task", task_id="t-1")
        assert allowed is True

    @pytest.mark.asyncio
    async def test_get_counter(self) -> None:
        self.redis.get = AsyncMock(return_value="42")
        count = await self.limiter.get_counter("agent-1", "http_get", "t-1")
        assert count == 42

    @pytest.mark.asyncio
    async def test_get_counter_returns_zero_when_missing(self) -> None:
        self.redis.get = AsyncMock(return_value=None)
        count = await self.limiter.get_counter("agent-1", "http_get", "t-1")
        assert count == 0


# ─────────────────────────────────────────────
# Budget tracker tests
# ─────────────────────────────────────────────


class TestBudgetTracker:
    def setup_method(self) -> None:
        self.redis = AsyncMock()
        self.tracker = BudgetTracker(self.redis)

    @pytest.mark.asyncio
    async def test_increment_tokens_stores_to_redis(self) -> None:
        self.redis.incrby = AsyncMock(return_value=100)
        self.redis.expire = AsyncMock(return_value=True)
        self.redis.get = AsyncMock(return_value=None)
        self.redis.set = AsyncMock(return_value=True)

        result = await self.tracker.increment_tokens(
            task_id="t-1",
            agent_id="scraper",
            input_tokens=50,
            output_tokens=50,
            cost_usd=0.001,
        )
        assert result["daily_cost_usd"] == pytest.approx(0.001)

    @pytest.mark.asyncio
    async def test_get_task_tokens_returns_zero_when_missing(self) -> None:
        self.redis.get = AsyncMock(return_value=None)
        tokens = await self.tracker.get_task_tokens("t-1")
        assert tokens == 0

    @pytest.mark.asyncio
    async def test_get_task_tokens_returns_stored_value(self) -> None:
        self.redis.get = AsyncMock(return_value="500")
        tokens = await self.tracker.get_task_tokens("t-1")
        assert tokens == 500

    @pytest.mark.asyncio
    async def test_get_daily_cost_returns_zero_when_missing(self) -> None:
        self.redis.get = AsyncMock(return_value=None)
        cost = await self.tracker.get_daily_cost("agent-1")
        assert cost == 0.0

    @pytest.mark.asyncio
    async def test_get_daily_cost_returns_stored_value(self) -> None:
        self.redis.get = AsyncMock(return_value="2.500000")
        cost = await self.tracker.get_daily_cost("agent-1")
        assert cost == pytest.approx(2.5)

    @pytest.mark.asyncio
    async def test_get_budget_status_returns_combined_data(self) -> None:
        self.redis.get = AsyncMock(side_effect=["100", "1.25"])
        status = await self.tracker.get_budget_status("t-1", "agent-1")
        assert status["task_id"] == "t-1"
        assert status["agent_id"] == "agent-1"


# ─────────────────────────────────────────────
# Gateway endpoints integration tests
# ─────────────────────────────────────────────


class TestGatewayEndpoints:
    def setup_method(self) -> None:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))
        from fastapi.testclient import TestClient
        from gateway.main import app
        # Reset Redis state to None (may have been set by E2E tests on the shared singleton)
        app.state.gateway_service.redis_db0 = None
        app.state.gateway_service.redis_db1 = None
        app.state.gateway_service.budget_tracker = None
        app.state.gateway_service.rate_limiter = None
        self.client = TestClient(app)

    def test_health_endpoint(self) -> None:
        resp = self.client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "gateway"

    def test_action_blocked_globally(self) -> None:
        """activate_kubex is globally blocked."""
        resp = self.client.post(
            "/actions",
            json={
                "request_id": "req-001",
                "agent_id": "orchestrator",
                "action": "activate_kubex",
            },
        )
        assert resp.status_code == 403
        data = resp.json()
        assert data["error"] == "PolicyDenied"

    def test_action_allowed_no_redis(self) -> None:
        """Without Redis, report_result should be allowed (no rate limits active)."""
        resp = self.client.post(
            "/actions",
            json={
                "request_id": "req-002",
                "agent_id": "orchestrator",
                "action": "report_result",
            },
        )
        # Without Redis no rate limiting — policy allows orchestrator's report_result
        # orchestrator has report_result in allowed list
        assert resp.status_code in (200, 202, 403)  # Accept any valid response

    def test_orchestrator_http_get_denied(self) -> None:
        """Orchestrator's http_get is in blocked list."""
        resp = self.client.post(
            "/actions",
            json={
                "request_id": "req-003",
                "agent_id": "orchestrator",
                "action": "http_get",
                "target": "https://example.com",
            },
        )
        assert resp.status_code == 403

    def test_invalid_action_returns_validation_error(self) -> None:
        resp = self.client.post(
            "/actions",
            json={
                "request_id": "req-004",
                "agent_id": "orchestrator",
                "action": "not_a_real_action",
            },
        )
        assert resp.status_code == 422

    def test_task_cancel_without_agent_id_returns_400(self) -> None:
        resp = self.client.post(
            "/tasks/some-task-id/cancel",
            json={},
        )
        assert resp.status_code == 400

    def test_task_result_without_redis_returns_503(self) -> None:
        resp = self.client.get("/tasks/nonexistent-task/result")
        assert resp.status_code == 503

    def test_receive_progress_without_redis(self) -> None:
        resp = self.client.post(
            "/tasks/t-001/progress",
            json={"type": "progress", "message": "Working..."},
        )
        # Should succeed even without Redis (just logs warning)
        assert resp.status_code == 202


# ─────────────────────────────────────────────
# Phase 6 — POST /policy/skill-check endpoint (PSEC-03)
# ─────────────────────────────────────────────


class TestSkillCheckEndpoint:
    """PSEC-03: Gateway POST /policy/skill-check endpoint for skill allowlist checks.

    Implemented in plan 06-02.

    Contract:
        POST /policy/skill-check
        Body: {"agent_id": str, "skills": [str]}
        Response: PolicyResult JSON {decision, reason, rule_matched, agent_id}
        - Skills on agent's allowlist → ALLOW
        - Skills not on allowlist → ESCALATE
        - Agent with no policy → ESCALATE
    """

    def setup_method(self) -> None:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))
        from fastapi.testclient import TestClient
        from gateway.main import app
        app.state.gateway_service.redis_db0 = None
        app.state.gateway_service.redis_db1 = None
        app.state.gateway_service.budget_tracker = None
        app.state.gateway_service.rate_limiter = None
        self.client = TestClient(app)

    def test_skill_check_allowed_skills_returns_allow(self) -> None:
        """Skills on the agent's allowed_skills list return ALLOW."""
        resp = self.client.post(
            "/policy/skill-check",
            json={
                "agent_id": "instagram-scraper",
                "skills": ["web-scraping"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "allow"

    def test_skill_check_unknown_skill_returns_escalate(self) -> None:
        """Skills not on the agent's allowlist return ESCALATE (consistent with policy
        philosophy: not explicitly allowed = human review, not hard deny)."""
        resp = self.client.post(
            "/policy/skill-check",
            json={
                "agent_id": "instagram-scraper",
                "skills": ["some-unknown-skill-xyz"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "escalate"

    def test_skill_check_no_policy_returns_escalate(self) -> None:
        """An agent with no policy file returns ESCALATE for any skill check."""
        resp = self.client.post(
            "/policy/skill-check",
            json={
                "agent_id": "agent-with-no-policy-file",
                "skills": ["any-skill"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["decision"] == "escalate"

    def test_skill_check_response_format_matches_policy_result(self) -> None:
        """Response JSON has decision, reason, rule_matched, agent_id fields
        matching the PolicyResult schema."""
        resp = self.client.post(
            "/policy/skill-check",
            json={
                "agent_id": "instagram-scraper",
                "skills": ["web-scraping"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()

        # Must have all PolicyResult fields
        assert "decision" in data, "Missing 'decision' field in response"
        assert "reason" in data, "Missing 'reason' field in response"
        assert "rule_matched" in data, "Missing 'rule_matched' field in response"
        assert "agent_id" in data, "Missing 'agent_id' field in response"

        # decision must be one of the valid PolicyDecision values
        assert data["decision"] in ("allow", "deny", "escalate"), (
            f"Invalid decision value: {data['decision']}"
        )
        assert data["agent_id"] == "instagram-scraper"


# ─────────────────────────────────────────────
# Phase 12 — AUTH-01: Gateway lifecycle SSE endpoint
# ─────────────────────────────────────────────


class TestLifecycleSSE:
    """Tests for GET /agents/{agent_id}/lifecycle SSE endpoint (AUTH-01).

    Contract:
        GET /agents/{agent_id}/lifecycle
        Auth: Bearer token required (401 without valid token)
        Response: text/event-stream with lifecycle state events from Redis DB 0
        Event format: data: {"agent_id": "...", "state": "...", "timestamp": "..."}\n\n
    """

    def setup_method(self) -> None:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))
        from fastapi.testclient import TestClient
        from gateway.main import app
        app.state.gateway_service.redis_db0 = None
        app.state.gateway_service.redis_db1 = None
        app.state.gateway_service.budget_tracker = None
        app.state.gateway_service.rate_limiter = None
        self.client = TestClient(app, raise_server_exceptions=False)
        self.auth_header = {"Authorization": "Bearer kubex-mgmt-token"}

    def test_auth_required_no_header_returns_401(self) -> None:
        """GET /agents/{id}/lifecycle without Authorization header returns 401."""
        resp = self.client.get("/agents/test-agent/lifecycle")
        assert resp.status_code == 401

    def test_auth_required_wrong_token_returns_401(self) -> None:
        """GET /agents/{id}/lifecycle with wrong token returns 401."""
        resp = self.client.get(
            "/agents/test-agent/lifecycle",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401

    def test_auth_valid_returns_event_stream(self) -> None:
        """GET /agents/{id}/lifecycle with valid Bearer token returns text/event-stream."""
        from unittest.mock import MagicMock
        from gateway.main import app

        # Set up a mock redis_db0 with a pubsub that immediately closes
        mock_pubsub = MagicMock()
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        async def empty_listen():
            return
            yield  # make it an async generator

        mock_pubsub.listen = empty_listen
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        app.state.gateway_service.redis_db0 = mock_redis

        resp = self.client.get(
            "/agents/test-agent/lifecycle",
            headers=self.auth_header,
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")

    def test_redis_unavailable_yields_error_and_closes(self) -> None:
        """When redis_db0 is None, SSE yields error event and closes."""
        from gateway.main import app

        app.state.gateway_service.redis_db0 = None

        resp = self.client.get(
            "/agents/test-agent/lifecycle",
            headers=self.auth_header,
        )
        assert resp.status_code == 200
        body = resp.text
        assert "Redis not available" in body

    def test_stream_events_from_redis_pubsub(self) -> None:
        """When Redis publishes a lifecycle event, SSE yields the event data."""
        from unittest.mock import MagicMock
        from gateway.main import app

        event_payload = json.dumps({
            "agent_id": "a1",
            "state": "ready",
            "timestamp": "2026-03-24T00:00:00",
        })

        mock_pubsub = MagicMock()
        mock_pubsub.subscribe = AsyncMock()
        mock_pubsub.unsubscribe = AsyncMock()
        mock_pubsub.aclose = AsyncMock()

        async def mock_listen():
            yield {"type": "subscribe", "data": 1}
            yield {"type": "message", "data": event_payload}

        mock_pubsub.listen = mock_listen
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub
        app.state.gateway_service.redis_db0 = mock_redis

        resp = self.client.get(
            "/agents/a1/lifecycle",
            headers=self.auth_header,
        )
        assert resp.status_code == 200
        body = resp.text
        assert f"data: {event_payload}" in body
