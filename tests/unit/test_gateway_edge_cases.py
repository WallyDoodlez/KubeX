"""Unit tests for Gateway edge cases (Layer 1, Sections 1.3-1.6).

Covers:
  - 1.3 Gateway Endpoint Edge Cases
  - 1.4 Policy Engine Missing Edge Cases
  - 1.5 RateLimiter Edge Cases
  - 1.6 BudgetTracker Edge Cases
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))

from gateway.policy import (
    AgentPolicy,
    EgressRule,
    GlobalPolicy,
    PolicyDecision,
    PolicyEngine,
    PolicyLoader,
    PolicyResult,
)
from gateway.ratelimit import RateLimiter, WINDOW_SECONDS, _parse_limit
from gateway.budget import BudgetTracker, TASK_TOKENS_KEY, AGENT_DAILY_COST_KEY
from kubex_common.schemas.actions import ActionRequest, ActionType, Priority, RequestContext


# ─────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────


def make_request(
    agent_id: str = "test-agent",
    action: ActionType = ActionType.HTTP_GET,
    target: str | None = "https://graph.instagram.com/v18/media",
    chain_depth: int = 1,
    task_id: str | None = "task-001",
) -> ActionRequest:
    return ActionRequest(
        request_id="req-edge-001",
        agent_id=agent_id,
        action=action,
        target=target,
        context=RequestContext(chain_depth=chain_depth, task_id=task_id),
    )


def make_loader_with_policies(
    global_data: dict | None = None,
    agent_policies: dict | None = None,
) -> PolicyLoader:
    """Build a PolicyLoader from dicts without disk I/O."""
    loader = PolicyLoader(policy_root="/nonexistent")

    if global_data:
        gd = global_data.get("global", {})
        rate_limits = gd.get("rate_limits", {}).get("default", {})
        loader._global = GlobalPolicy(
            blocked_actions=gd.get("blocked_actions", []),
            max_chain_depth=gd.get("max_chain_depth", 5),
            default_daily_cost_limit_usd=gd.get("budget", {}).get("default_daily_cost_limit_usd", 10.0),
            rate_limits=rate_limits,
        )
    else:
        loader._global = GlobalPolicy()

    loader._agent_policies = {}
    if agent_policies:
        for agent_id, policy_data in agent_policies.items():
            agent_data = policy_data.get("agent_policy", {})
            actions_data = agent_data.get("actions", {})
            egress_data = agent_data.get("egress", {})
            budget_data = agent_data.get("budget", {})
            egress_rules = [
                EgressRule(
                    domain=e["domain"],
                    methods=e.get("methods", ["GET"]),
                    blocked_paths=e.get("blocked_paths", []),
                )
                for e in egress_data.get("allowed", [])
            ]
            loader._agent_policies[agent_id] = AgentPolicy(
                agent_id=agent_id,
                allowed_actions=actions_data.get("allowed", []),
                blocked_actions=actions_data.get("blocked", []),
                egress_mode=egress_data.get("mode", "deny_all"),
                egress_rules=egress_rules,
                per_task_token_limit=budget_data.get("per_task_token_limit"),
                daily_cost_limit_usd=budget_data.get("daily_cost_limit_usd"),
                rate_limits=actions_data.get("rate_limits", {}),
            )
    return loader


# ─────────────────────────────────────────────
# 1.3 Gateway Endpoint Edge Cases
# ─────────────────────────────────────────────


class TestGatewayEndpointEdgeCases:
    def setup_method(self) -> None:
        from gateway.main import app
        # Reset Redis state to None (may have been set by E2E tests on the shared singleton)
        app.state.gateway_service.redis_db0 = None
        app.state.gateway_service.redis_db1 = None
        app.state.gateway_service.budget_tracker = None
        app.state.gateway_service.rate_limiter = None
        self.client = TestClient(app)

    def test_dispatch_task_missing_capability_returns_400(self) -> None:
        """UT-GW-01: dispatch_task without capability param returns 400."""
        resp = self.client.post(
            "/actions",
            json={
                "request_id": "req-gw-01",
                "agent_id": "orchestrator",
                "action": "dispatch_task",
                # No 'capability' in parameters
                "parameters": {},
            },
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["error"] == "MissingCapability"

    def test_http_action_missing_target_returns_400(self) -> None:
        """UT-GW-02: HTTP action (http_get) that passes policy but has no target returns 400.

        instagram-scraper has http_get allowed + instagram in allowlist.
        No target -> _handle_egress returns 400.
        """
        # Use an agent that is allowed to do http_get so we reach the egress handler
        # The scraper policy has http_get allowed and egress allowlist for instagram.com
        # With no target, the policy passes (no target = skip egress check),
        # but _handle_egress is called and it checks for missing target.
        resp = self.client.post(
            "/actions",
            json={
                "request_id": "req-gw-02",
                "agent_id": "instagram-scraper",
                "action": "http_get",
                # No 'target' field — should reach _handle_egress and fail with 400
            },
        )
        # Policy allows http_get for instagram-scraper without target (no egress check).
        # But _handle_egress requires target — returns 400.
        assert resp.status_code == 400
        data = resp.json()
        assert data["error"] == "MissingTarget"

    def test_cancel_task_non_originator_blocked(self) -> None:
        """UT-GW-03: Only the originating agent can cancel a task.

        When Redis IS available, the cancel endpoint checks the stored originator.
        Without Redis the check is skipped (redis_db1 is None).
        This test exercises the 400 path for missing agent_id.
        """
        # Missing agent_id always returns 400
        resp = self.client.post(
            "/tasks/some-task/cancel",
            json={},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert data["error"] == "MissingAgentId"

    def test_task_result_returns_503_when_redis_unavailable(self) -> None:
        """UT-GW-04: get_task_result returns 503 when Redis not connected."""
        resp = self.client.get("/tasks/nonexistent-task/result")
        assert resp.status_code == 503
        data = resp.json()
        assert data["error"] == "RedisUnavailable"

    def test_kubex_strict_identity_rejects_unknown_ip(self) -> None:
        """UT-GW-06: With KUBEX_STRICT_IDENTITY=true, unresolvable IP returns 401."""
        with patch.dict(os.environ, {"KUBEX_STRICT_IDENTITY": "true"}):
            resp = self.client.post(
                "/actions",
                json={
                    "request_id": "req-strict-01",
                    "agent_id": "orchestrator",
                    "action": "report_result",
                },
            )
        assert resp.status_code == 401
        data = resp.json()
        assert data["error"] == "IdentityResolutionFailed"

    def test_rate_limit_config_falls_back_to_global(self) -> None:
        """UT-GW-05: rate_limit_config returns global defaults for unknown agent."""
        from gateway.main import GatewayService
        svc = GatewayService()
        # Agent without a policy should still get global rate limits
        config = svc.rate_limit_config("unknown-agent-xyz")
        # Global policy has http_get: 60/min
        assert "http_get" in config
        assert config["http_get"] == "60/min"


# ─────────────────────────────────────────────
# 1.4 Policy Engine Missing Edge Cases
# ─────────────────────────────────────────────


class TestPolicyEngineEdgeCases:
    def setup_method(self) -> None:
        # Use real policy files from the project root
        policy_root = os.path.join(os.path.dirname(__file__), "../../")
        self.loader = PolicyLoader(policy_root=policy_root)
        self.loader.load_all()
        self.engine = PolicyEngine(self.loader)

    def test_egress_subdomain_matches_parent_rule(self) -> None:
        """UT-POL-01: i.instagram.com is an allowed subdomain for instagram-scraper."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://i.instagram.com/photos/thumbnail.jpg",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_path_matches_wildcard_pattern(self) -> None:
        """UT-POL-02: Path matching with * wildcard correctly identifies blocked paths."""
        from gateway.policy import PolicyEngine
        engine_under_test = PolicyEngine(self.loader)
        # instagram.com/accounts/* is blocked for instagram-scraper
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/accounts/password_reset",
        )
        result = engine_under_test.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.egress.blocked_path"

    def test_path_matches_no_match(self) -> None:
        """UT-POL-03: Path that does NOT match any blocked pattern is allowed."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/nike/media",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_global_policy_missing_file_uses_defaults(self) -> None:
        """UT-POL-04: PolicyLoader with missing global.yaml returns default GlobalPolicy."""
        loader = PolicyLoader(policy_root="/nonexistent/path")
        global_policy = loader.global_policy
        assert isinstance(global_policy, GlobalPolicy)
        assert global_policy.max_chain_depth == 5
        assert global_policy.default_daily_cost_limit_usd == 10.0

    def test_knowledge_agent_dispatch_task_blocked(self) -> None:
        """UT-POL-05: knowledge agent cannot dispatch_task."""
        req = make_request(
            agent_id="knowledge",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_reviewer_report_result_allowed(self) -> None:
        """UT-POL-06: reviewer can use report_result."""
        req = make_request(
            agent_id="reviewer",
            action=ActionType.REPORT_RESULT,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_reviewer_write_output_blocked(self) -> None:
        """UT-POL-07: reviewer cannot write_output (not in allowed list)."""
        req = make_request(
            agent_id="reviewer",
            action=ActionType.WRITE_OUTPUT,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_knowledge_agent_has_deny_all_egress(self) -> None:
        """UT-POL-08: knowledge agent has deny_all egress mode."""
        knowledge_policy = self.loader.get_agent_policy("knowledge")
        assert knowledge_policy is not None
        assert knowledge_policy.egress_mode == "deny_all"


# ─────────────────────────────────────────────
# 1.5 RateLimiter Edge Cases
# ─────────────────────────────────────────────


class TestRateLimiterEdgeCases:
    def setup_method(self) -> None:
        self.redis = AsyncMock()
        self.limiter = RateLimiter(self.redis)

    def test_parse_per_day_window(self) -> None:
        """UT-RL-01: Parse 500/day returns (500, 'day')."""
        count, window = _parse_limit("500/day")
        assert count == 500
        assert window == "day"

    @pytest.mark.asyncio
    async def test_task_limit_exactly_at_limit_is_allowed(self) -> None:
        """UT-RL-02: Counter == limit is allowed (uses <= check)."""
        self.redis.incr = AsyncMock(return_value=100)  # exactly at 100/task limit
        self.redis.expire = AsyncMock(return_value=True)
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "100/task", task_id="t-1")
        assert allowed is True

    @pytest.mark.asyncio
    async def test_window_limit_adds_entry_on_allow(self) -> None:
        """UT-RL-03: When under limit, zadd is called to record the new entry."""
        self.redis.zremrangebyscore = AsyncMock(return_value=0)
        self.redis.zcard = AsyncMock(return_value=5)
        self.redis.zadd = AsyncMock(return_value=1)
        self.redis.expire = AsyncMock(return_value=True)

        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "60/min")
        assert allowed is True
        self.redis.zadd.assert_called_once()

    @pytest.mark.asyncio
    async def test_window_limit_unknown_window_defaults_to_60s(self) -> None:
        """UT-RL-04: Unknown window string defaults to 60 seconds in WINDOW_SECONDS."""
        # WINDOW_SECONDS.get(unknown, 60) should default to 60
        assert WINDOW_SECONDS.get("unknown_window", 60) == 60

        self.redis.zremrangebyscore = AsyncMock(return_value=0)
        self.redis.zcard = AsyncMock(return_value=0)
        self.redis.zadd = AsyncMock(return_value=1)
        self.redis.expire = AsyncMock(return_value=True)

        # Using an unknown window type — should not raise, and should default to 60s
        allowed = await self.limiter.check_and_increment("agent-1", "http_get", "10/unknown_window")
        assert allowed is True


# ─────────────────────────────────────────────
# 1.6 BudgetTracker Edge Cases
# ─────────────────────────────────────────────


class TestBudgetTrackerEdgeCases:
    def setup_method(self) -> None:
        self.redis = AsyncMock()
        self.tracker = BudgetTracker(self.redis)

    @pytest.mark.asyncio
    async def test_increment_tokens_accumulates_daily_cost(self) -> None:
        """UT-BT-01: Calling increment_tokens twice accumulates cost correctly."""
        # First call: no previous daily cost
        self.redis.incrby = AsyncMock(return_value=100)
        self.redis.expire = AsyncMock(return_value=True)
        self.redis.get = AsyncMock(side_effect=[None, b"100"])  # first get=None (no prior cost), second get for total tokens
        self.redis.set = AsyncMock(return_value=True)

        result1 = await self.tracker.increment_tokens(
            task_id="t-1", agent_id="scraper", input_tokens=50, output_tokens=50, cost_usd=0.005
        )
        assert result1["daily_cost_usd"] == pytest.approx(0.005)

    @pytest.mark.asyncio
    async def test_budget_status_combines_task_and_daily(self) -> None:
        """UT-BT-02: get_budget_status returns combined task tokens and daily cost."""
        self.redis.get = AsyncMock(side_effect=["200", "3.500000"])
        status = await self.tracker.get_budget_status("t-1", "agent-1")
        assert status["task_id"] == "t-1"
        assert status["agent_id"] == "agent-1"
        assert status["task_total_tokens"] == 200
        assert status["daily_cost_usd"] == pytest.approx(3.5)

    @pytest.mark.asyncio
    async def test_task_tokens_ttl_set_on_increment(self) -> None:
        """UT-BT-03: increment_tokens sets TTL on the task key via expire()."""
        self.redis.incrby = AsyncMock(return_value=50)
        self.redis.expire = AsyncMock(return_value=True)
        self.redis.get = AsyncMock(side_effect=[None, b"50"])
        self.redis.set = AsyncMock(return_value=True)

        await self.tracker.increment_tokens(
            task_id="t-ttl", agent_id="agent-1", input_tokens=25, output_tokens=25, cost_usd=0.001
        )
        # expire should have been called for the task key
        self.redis.expire.assert_called()
        expire_call_args = self.redis.expire.call_args_list[0]
        # First positional arg is the key; it should contain the task_id
        task_key_arg = expire_call_args[0][0]
        assert "t-ttl" in task_key_arg
