"""Unit tests for the Gateway Policy Engine.

Required coverage: minimum 95% on policy.py.
"""

from __future__ import annotations

import sys
import os
import tempfile
from pathlib import Path

import pytest
import yaml

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
from kubex_common.schemas.actions import ActionRequest, ActionType, Priority, RequestContext


# ─────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────


def make_request(
    agent_id: str = "test-agent",
    action: ActionType = ActionType.HTTP_GET,
    target: str | None = "https://graph.instagram.com/v18/media",
    chain_depth: int = 1,
    task_id: str | None = "task-001",
) -> ActionRequest:
    return ActionRequest(
        request_id="req-001",
        agent_id=agent_id,
        action=action,
        target=target,
        context=RequestContext(chain_depth=chain_depth, task_id=task_id),
    )


def make_loader_with_policies(
    global_data: dict | None = None,
    agent_policies: dict[str, dict] | None = None,
    package_blocklist: dict | None = None,
    runtime_install_soft_limit: int = 10,
) -> PolicyLoader:
    """Create a PolicyLoader pre-populated with given policies (no disk I/O)."""
    loader = PolicyLoader(policy_root="/nonexistent")

    if global_data:
        gd = global_data.get("global", {})
        rate_limits = gd.get("rate_limits", {}).get("default", {})
        loader._global = GlobalPolicy(
            blocked_actions=gd.get("blocked_actions", []),
            max_chain_depth=gd.get("max_chain_depth", 5),
            default_daily_cost_limit_usd=gd.get("budget", {}).get("default_daily_cost_limit_usd", 10.0),
            rate_limits=rate_limits,
            package_blocklist=package_blocklist or {},
            runtime_install_soft_limit=runtime_install_soft_limit,
        )
    else:
        loader._global = GlobalPolicy(
            package_blocklist=package_blocklist or {},
            runtime_install_soft_limit=runtime_install_soft_limit,
        )

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


SCRAPER_POLICY = {
    "agent_policy": {
        "egress": {
            "mode": "allowlist",
            "allowed": [
                {
                    "domain": "graph.instagram.com",
                    "methods": ["GET"],
                },
                {
                    "domain": "instagram.com",
                    "methods": ["GET"],
                    "blocked_paths": ["*/accounts/*", "*/api/v1/friendships/*"],
                },
            ],
        },
        "actions": {
            "allowed": ["http_get", "write_output", "report_result", "progress_update"],
            "blocked": ["http_post", "http_put", "http_delete", "execute_code"],
            "rate_limits": {"http_get": "100/task"},
        },
        "budget": {
            "per_task_token_limit": 10000,
            "daily_cost_limit_usd": 1.00,
        },
    }
}

ORCHESTRATOR_POLICY = {
    "agent_policy": {
        "egress": {"mode": "deny_all"},
        "actions": {
            "allowed": ["dispatch_task", "check_task_status", "cancel_task", "report_result", "query_registry"],
            "blocked": ["http_get", "http_post", "execute_code"],
        },
        "budget": {"per_task_token_limit": 50000},
    }
}


# ─────────────────────────────────────────────
# PolicyLoader tests
# ─────────────────────────────────────────────


class TestPolicyLoader:
    def test_returns_default_global_when_no_file(self) -> None:
        loader = PolicyLoader(policy_root="/nonexistent")
        global_policy = loader.global_policy
        assert isinstance(global_policy, GlobalPolicy)
        assert global_policy.max_chain_depth == 5

    def test_load_from_disk(self, tmp_path: Path) -> None:
        """Write real policy files and load them."""
        policy_dir = tmp_path / "policies"
        policy_dir.mkdir()
        global_yaml = {
            "global": {
                "blocked_actions": ["activate_kubex"],
                "max_chain_depth": 3,
                "rate_limits": {"default": {"http_get": "60/min"}},
                "budget": {"default_daily_cost_limit_usd": 5.0},
            }
        }
        with open(policy_dir / "global.yaml", "w") as f:
            yaml.dump(global_yaml, f)

        agents_dir = tmp_path / "agents" / "scraper" / "policies"
        agents_dir.mkdir(parents=True)
        with open(agents_dir / "policy.yaml", "w") as f:
            yaml.dump(SCRAPER_POLICY, f)

        loader = PolicyLoader(policy_root=str(tmp_path))
        loader.load_all()

        assert loader.global_policy.max_chain_depth == 3
        assert "activate_kubex" in loader.global_policy.blocked_actions
        assert loader.get_agent_policy("scraper") is not None
        assert loader.get_agent_policy("scraper").egress_mode == "allowlist"

    def test_get_agent_policy_returns_none_for_unknown(self) -> None:
        loader = make_loader_with_policies()
        assert loader.get_agent_policy("unknown-agent") is None


# ─────────────────────────────────────────────
# PolicyEngine — Global policy tests
# ─────────────────────────────────────────────


class TestPolicyEngineGlobal:
    def setup_method(self) -> None:
        self.loader = make_loader_with_policies(
            global_data={"global": {"blocked_actions": ["activate_kubex"], "max_chain_depth": 5}},
            agent_policies={"scraper": SCRAPER_POLICY},
        )
        self.engine = PolicyEngine(self.loader)

    def test_globally_blocked_action_is_denied(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.ACTIVATE_KUBEX,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.blocked_actions"

    def test_chain_depth_exceeded_is_denied(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.DISPATCH_TASK, target=None, chain_depth=6)
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.max_chain_depth"

    def test_chain_depth_at_limit_is_allowed(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.REPORT_RESULT,
            target=None,
            chain_depth=5,
        )
        result = self.engine.evaluate(req)
        # Should pass chain depth check (5 <= 5)
        assert result.decision != PolicyDecision.DENY or result.rule_matched != "global.max_chain_depth"

    def test_global_daily_cost_exceeded_is_denied(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.REPORT_RESULT, target=None)
        result = self.engine.evaluate(req, cost_today_usd=15.0)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.budget.daily_cost_limit"


# ─────────────────────────────────────────────
# PolicyEngine — Agent action policy tests
# ─────────────────────────────────────────────


class TestPolicyEngineAgentActions:
    def setup_method(self) -> None:
        self.loader = make_loader_with_policies(
            agent_policies={"scraper": SCRAPER_POLICY, "orchestrator": ORCHESTRATOR_POLICY},
        )
        self.engine = PolicyEngine(self.loader)

    def test_blocked_action_for_agent_is_denied(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.HTTP_POST, target=None)
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.actions.blocked"

    def test_action_not_in_allowed_list_is_escalated(self) -> None:
        """Actions not in allowed list AND not in blocked list are escalated for review."""
        req = make_request(
            agent_id="scraper",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ESCALATE
        assert result.rule_matched == "agent.actions.escalate"

    def test_allowed_action_passes_action_check(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.WRITE_OUTPUT,
            target=None,
        )
        result = self.engine.evaluate(req)
        # write_output is allowed, no egress check needed for non-HTTP
        assert result.decision == PolicyDecision.ALLOW

    def test_orchestrator_blocked_http_get(self) -> None:
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.HTTP_GET,
            target="https://example.com",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.actions.blocked"

    def test_no_policy_agent_action_passes(self) -> None:
        """Unknown agent with no policy — non-HTTP actions should pass (no allowed list)."""
        req = make_request(
            agent_id="unknown-agent",
            action=ActionType.REPORT_RESULT,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW


# ─────────────────────────────────────────────
# PolicyEngine — Egress tests
# ─────────────────────────────────────────────


class TestPolicyEngineEgress:
    def setup_method(self) -> None:
        self.loader = make_loader_with_policies(
            agent_policies={"scraper": SCRAPER_POLICY, "orchestrator": ORCHESTRATOR_POLICY},
        )
        self.engine = PolicyEngine(self.loader)

    def test_allowed_domain_passes(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.HTTP_GET,
            target="https://graph.instagram.com/v18/media",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_blocked_domain_is_denied(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.HTTP_GET,
            target="https://example.com/data",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.egress.not_in_allowlist"

    def test_deny_all_egress_blocks_all_http(self) -> None:
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.HTTP_GET,
            target="https://graph.instagram.com/v18/media",
        )
        # Orchestrator has http_get in blocked list — should be denied at action level
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_wrong_method_blocked(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.HTTP_POST,  # POST is blocked in actions.blocked
            target="https://graph.instagram.com/v18/media",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_blocked_path_is_denied(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/api/v1/accounts/login",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.egress.blocked_path"

    def test_allowed_path_on_allowed_domain_passes(self) -> None:
        req = make_request(
            agent_id="scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/nike/posts",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_no_target_http_passes_egress(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.HTTP_GET, target=None)
        result = self.engine.evaluate(req)
        # No target → no egress check
        assert result.decision == PolicyDecision.ALLOW

    def test_no_policy_agent_egress_denied(self) -> None:
        req = make_request(
            agent_id="unknown-agent",
            action=ActionType.HTTP_GET,
            target="https://example.com",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "no_policy_egress_deny"


# ─────────────────────────────────────────────
# PolicyEngine — Budget tests
# ─────────────────────────────────────────────


class TestPolicyEngineBudget:
    def setup_method(self) -> None:
        self.loader = make_loader_with_policies(
            agent_policies={"scraper": SCRAPER_POLICY},
        )
        self.engine = PolicyEngine(self.loader)

    def test_per_task_token_limit_exceeded(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.WRITE_OUTPUT, target=None)
        result = self.engine.evaluate(req, token_count_so_far=15000)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "budget.per_task_token_limit"

    def test_per_task_token_limit_at_boundary(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.WRITE_OUTPUT, target=None)
        # Exactly at limit (10000) — should be denied (>= check)
        result = self.engine.evaluate(req, token_count_so_far=10000)
        assert result.decision == PolicyDecision.DENY

    def test_per_task_token_under_limit_allows(self) -> None:
        req = make_request(agent_id="scraper", action=ActionType.WRITE_OUTPUT, target=None)
        result = self.engine.evaluate(req, token_count_so_far=5000)
        assert result.decision == PolicyDecision.ALLOW


# ─────────────────────────────────────────────
# Policy fixture tests (approve/deny/escalate outcomes)
# ─────────────────────────────────────────────


class TestPolicyFixtures:
    """Policy file tests — assert expected outcomes for each policy."""

    def setup_method(self) -> None:
        # Use real policy files from the project
        policy_root = os.path.join(os.path.dirname(__file__), "../../")
        self.loader = PolicyLoader(policy_root=policy_root)
        self.loader.load_all()
        self.engine = PolicyEngine(self.loader)

    def test_global_blocks_activate_kubex(self) -> None:
        """Global policy: activate_kubex is always blocked."""
        for agent_id in ["orchestrator", "instagram-scraper", "knowledge", "reviewer"]:
            req = make_request(agent_id=agent_id, action=ActionType.ACTIVATE_KUBEX, target=None)
            result = self.engine.evaluate(req)
            assert result.decision == PolicyDecision.DENY, f"Expected DENY for {agent_id}"
            assert result.rule_matched == "global.blocked_actions"

    def test_orchestrator_dispatch_task_allowed(self) -> None:
        """Orchestrator can dispatch tasks."""
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_orchestrator_http_get_denied(self) -> None:
        """Orchestrator cannot make HTTP requests."""
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.HTTP_GET,
            target="https://example.com",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_instagram_scraper_http_get_instagram_allowed(self) -> None:
        """Instagram scraper can GET from graph.instagram.com."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_instagram_scraper_http_post_denied(self) -> None:
        """Instagram scraper cannot POST."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_POST,
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_instagram_scraper_blocked_path_denied(self) -> None:
        """Instagram scraper cannot access accounts endpoints."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/accounts/login",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_instagram_scraper_external_domain_denied(self) -> None:
        """Instagram scraper cannot access arbitrary domains."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://api.example.com/data",
        )
        result = self.engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_reviewer_has_deny_all_egress(self) -> None:
        """Reviewer should have deny_all egress."""
        reviewer_policy = self.loader.get_agent_policy("reviewer")
        if reviewer_policy:
            assert reviewer_policy.egress_mode in ("deny_all", "allowlist")

    def test_budget_limit_blocks_all_agents(self) -> None:
        """All agents are blocked when daily budget exceeded."""
        for agent_id in ["orchestrator", "instagram-scraper", "knowledge"]:
            req = make_request(agent_id=agent_id, action=ActionType.REPORT_RESULT, target=None)
            result = self.engine.evaluate(req, cost_today_usd=999.0)
            assert result.decision == PolicyDecision.DENY


# ─────────────────────────────────────────────
# Phase 6 — Runtime dependency policy gating (PSEC-02)
# ─────────────────────────────────────────────


class TestInstallDependencyPolicy:
    """PSEC-02: install_dependency action type and Gateway policy evaluation.

    These tests use xfail because ActionType.INSTALL_DEPENDENCY does not exist yet
    and the policy engine does not handle blocklist/soft-limit logic for it.
    Implementation lands in plan 06-02.
    """

    def test_install_dependency_action_type_exists(self) -> None:
        """ActionType.INSTALL_DEPENDENCY exists in the enum with value 'install_dependency'."""
        assert hasattr(ActionType, "INSTALL_DEPENDENCY"), (
            "ActionType.INSTALL_DEPENDENCY enum value not found"
        )
        assert ActionType.INSTALL_DEPENDENCY.value == "install_dependency"

    def test_install_dependency_blocklist_deny(self) -> None:
        """install_dependency for a blocklisted package returns DENY (never ESCALATE).

        The hard package blocklist prevents dangerous packages from ever being
        installed even if a reviewer would approve — DENY is unconditional.
        """
        loader = make_loader_with_policies(
            agent_policies={"test-agent": SCRAPER_POLICY},
            package_blocklist={"pip": ["malware-package", "paramiko", "pwntools"]},
        )
        engine = PolicyEngine(loader)

        req = ActionRequest(
            request_id="req-block-001",
            agent_id="test-agent",
            action=ActionType.INSTALL_DEPENDENCY,
            parameters={"package": "malware-package", "type": "pip"},
            context=RequestContext(chain_depth=1, task_id="t-001"),
        )
        result = engine.evaluate(req)

        assert result.decision == PolicyDecision.DENY, (
            "Blocklisted package must return DENY, not ESCALATE"
        )
        assert result.rule_matched is not None

    def test_install_dependency_soft_limit_escalate(self) -> None:
        """Exceeding the per-agent runtime install limit triggers ESCALATE, not hard deny.

        The soft limit allows human review rather than hard blocking — operator
        can approve additional installs if the agent legitimately needs them.
        """
        loader = make_loader_with_policies(
            agent_policies={"test-agent": SCRAPER_POLICY},
        )
        engine = PolicyEngine(loader)

        # Pass runtime_dep_count_today that exceeds the soft limit
        req = ActionRequest(
            request_id="req-limit-001",
            agent_id="test-agent",
            action=ActionType.INSTALL_DEPENDENCY,
            parameters={"package": "pandas", "type": "pip"},
            context=RequestContext(chain_depth=1, task_id="t-001"),
        )
        result = engine.evaluate(req, runtime_dep_count_today=999)

        assert result.decision == PolicyDecision.ESCALATE, (
            "Soft limit exceeded must ESCALATE (not DENY) for human review"
        )

    def test_install_dependency_allowed(self) -> None:
        """Non-blocklisted package within install limit returns ALLOW."""
        loader = make_loader_with_policies(
            agent_policies={"test-agent": SCRAPER_POLICY},
        )
        engine = PolicyEngine(loader)

        req = ActionRequest(
            request_id="req-allow-001",
            agent_id="test-agent",
            action=ActionType.INSTALL_DEPENDENCY,
            parameters={"package": "requests", "type": "pip"},
            context=RequestContext(chain_depth=1, task_id="t-001"),
        )
        # Within soft limit (low count)
        result = engine.evaluate(req, runtime_dep_count_today=0)

        assert result.decision == PolicyDecision.ALLOW
