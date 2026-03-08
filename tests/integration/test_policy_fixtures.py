"""Wave 6 — Comprehensive Policy Fixture Tests.

These tests load the REAL policy files from disk and assert expected
approve/deny/escalate outcomes for every agent and every action in the system.

Policy files covered:
  policies/global.yaml                            — global rules
  agents/orchestrator/policies/policy.yaml        — orchestrator agent
  agents/instagram-scraper/policies/policy.yaml   — instagram-scraper agent
  agents/knowledge/policies/policy.yaml           — knowledge agent
  agents/reviewer/policies/policy.yaml            — reviewer agent

Test categories:
  1. GLOBAL — global blocked actions, chain depth, budget limits, rate limits
  2. ORCHESTRATOR — action allowlist/blocklist, egress mode
  3. INSTAGRAM-SCRAPER — egress allowlist, blocked paths, method restrictions
  4. KNOWLEDGE — action allowlist, egress deny_all
  5. REVIEWER — minimal allowlist, anti-collusion model restriction
  6. CROSS-AGENT — actions that must be approved/denied across all agents
  7. BUDGET — per-task and daily cost limits
  8. PARAMETRIZE — exhaustive matrix of agent × action combinations

Tests use the REAL PolicyEngine and REAL policy files from disk.
These tests run WITHOUT the Wave 6 implementation guard — they test the
existing policy infrastructure which is already implemented.
The Wave 6 guard is only used for integration tests that require the full
pipeline to be wired.

Module paths:
  services/gateway/gateway/policy.py   (PolicyEngine, PolicyLoader, PolicyDecision)
"""

from __future__ import annotations

import os
import sys
from typing import Any

import pytest
import yaml

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/gateway"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

from gateway.policy import (
    AgentPolicy,
    EgressRule,
    GlobalPolicy,
    PolicyDecision,
    PolicyEngine,
    PolicyLoader,
    PolicyResult,
)
from kubex_common.schemas.actions import ActionRequest, ActionType, RequestContext

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PROJECT_ROOT = _ROOT


def make_request(
    agent_id: str = "test-agent",
    action: ActionType = ActionType.HTTP_GET,
    target: str | None = "https://graph.instagram.com/v18/media",
    chain_depth: int = 1,
    task_id: str | None = "task-001",
) -> ActionRequest:
    """Build a minimal ActionRequest for policy testing."""
    return ActionRequest(
        request_id="req-001",
        agent_id=agent_id,
        action=action,
        target=target,
        context=RequestContext(chain_depth=chain_depth, task_id=task_id),
    )


def make_engine_from_disk() -> PolicyEngine:
    """Load real policy files from disk and return a configured PolicyEngine."""
    loader = PolicyLoader(policy_root=PROJECT_ROOT)
    loader.load_all()
    return PolicyEngine(loader)


@pytest.fixture(scope="module")
def engine() -> PolicyEngine:
    """Module-scoped fixture: one PolicyEngine loaded from real policy files."""
    return make_engine_from_disk()


@pytest.fixture(scope="module")
def loader() -> PolicyLoader:
    """Module-scoped fixture: one PolicyLoader loaded from real policy files."""
    l = PolicyLoader(policy_root=PROJECT_ROOT)
    l.load_all()
    return l


# ===========================================================================
# POLICY-GLOBAL: Global Policy Rules
# ===========================================================================


class TestGlobalPolicy:
    """Tests for policies/global.yaml — rules that apply to ALL agents."""

    def test_global_policy_is_loaded(self, loader: PolicyLoader) -> None:
        """POLICY-GLOBAL-01: global.yaml is loaded correctly from disk.

        Spec: Global policy file must exist and be parseable.
        """
        gp = loader.global_policy
        assert gp is not None
        assert isinstance(gp, GlobalPolicy)

    def test_global_blocks_activate_kubex(self, engine: PolicyEngine) -> None:
        """POLICY-GLOBAL-02: activate_kubex is globally blocked for every agent.

        Spec: global.yaml blocked_actions: [activate_kubex]
        Agents cannot spawn containers directly — only Kubex Manager may do this.
        """
        for agent_id in ["orchestrator", "instagram-scraper", "knowledge", "reviewer"]:
            req = make_request(agent_id=agent_id, action=ActionType.ACTIVATE_KUBEX, target=None)
            result = engine.evaluate(req)
            assert result.decision == PolicyDecision.DENY, (
                f"Expected DENY for activate_kubex by {agent_id}, got {result.decision}"
            )
            assert result.rule_matched == "global.blocked_actions"

    def test_global_max_chain_depth_is_5(self, loader: PolicyLoader) -> None:
        """POLICY-GLOBAL-03: global.yaml max_chain_depth is 5.

        Spec: 'max_chain_depth: 5' — prevents infinite delegation.
        """
        assert loader.global_policy.max_chain_depth == 5

    def test_chain_depth_6_denied(self, engine: PolicyEngine) -> None:
        """POLICY-GLOBAL-04: chain_depth=6 is denied globally.

        Spec: Depth 5 is the maximum; depth 6 exceeds the limit.
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.DISPATCH_TASK,
            target=None,
            chain_depth=6,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.max_chain_depth"

    def test_chain_depth_5_not_denied_for_depth_check(self, engine: PolicyEngine) -> None:
        """POLICY-GLOBAL-05: chain_depth=5 is within the allowed range.

        Spec: The check is > max_chain_depth, so depth 5 is allowed.
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.REPORT_RESULT,
            target=None,
            chain_depth=5,
        )
        result = engine.evaluate(req)
        # Must not be denied for chain_depth reason
        if result.decision == PolicyDecision.DENY:
            assert result.rule_matched != "global.max_chain_depth", (
                "chain_depth=5 should not trigger global.max_chain_depth denial"
            )

    def test_global_daily_cost_limit_is_10_usd(self, loader: PolicyLoader) -> None:
        """POLICY-GLOBAL-06: default_daily_cost_limit_usd is $10.00.

        Spec: global.yaml budget.default_daily_cost_limit_usd: 10.00
        """
        assert loader.global_policy.default_daily_cost_limit_usd == 10.0

    def test_daily_cost_limit_exceeded_denied_for_all_agents(
        self, engine: PolicyEngine
    ) -> None:
        """POLICY-GLOBAL-07: Any agent is denied when daily cost exceeds $10.00.

        Spec: 'Budget exceeded → deny all requests'
        """
        for agent_id in ["orchestrator", "instagram-scraper", "knowledge"]:
            req = make_request(agent_id=agent_id, action=ActionType.REPORT_RESULT, target=None)
            result = engine.evaluate(req, cost_today_usd=15.0)
            assert result.decision == PolicyDecision.DENY
            assert result.rule_matched == "global.budget.daily_cost_limit"

    def test_global_rate_limits_are_defined(self, loader: PolicyLoader) -> None:
        """POLICY-GLOBAL-08: Global default rate limits are configured.

        Spec: global.yaml rate_limits.default defines per-action rate limits.
        """
        rate_limits = loader.global_policy.rate_limits
        assert isinstance(rate_limits, dict)
        # Per spec: global rate limits are defined for common actions
        # At least one rate limit should be defined
        assert len(rate_limits) >= 1


# ===========================================================================
# POLICY-ORCHESTRATOR: Orchestrator Agent Policy
# ===========================================================================


class TestOrchestratorPolicy:
    """Tests for agents/orchestrator/policies/policy.yaml."""

    def test_orchestrator_policy_is_loaded(self, loader: PolicyLoader) -> None:
        """POLICY-ORCH-01: Orchestrator policy is loaded from disk."""
        policy = loader.get_agent_policy("orchestrator")
        assert policy is not None, "orchestrator policy should be loaded"

    def test_orchestrator_dispatch_task_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-02: Orchestrator can dispatch_task (core function).

        Spec: orchestrator policy allowed: [dispatch_task, ...]
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW, (
            f"Expected ALLOW for orchestrator dispatch_task, got {result.decision}: {result.reason}"
        )

    def test_orchestrator_check_task_status_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-03: Orchestrator can check_task_status.

        Spec: orchestrator policy allowed: [..., check_task_status, ...]
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.CHECK_TASK_STATUS,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_orchestrator_cancel_task_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-04: Orchestrator can cancel_task.

        Spec: orchestrator policy allowed: [..., cancel_task, ...]
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.CANCEL_TASK,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_orchestrator_report_result_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-05: Orchestrator can report_result.

        Spec: orchestrator policy allowed: [..., report_result, ...]
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.REPORT_RESULT,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_orchestrator_query_knowledge_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-06: Orchestrator can query_knowledge.

        Spec: orchestrator policy allowed: [..., query_knowledge, ...]
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.QUERY_KNOWLEDGE,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_orchestrator_http_get_denied(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-07: Orchestrator CANNOT make HTTP GET requests.

        Spec: orchestrator policy blocked: [http_get, http_post, ...]
        Orchestrators must not access the internet directly.
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.HTTP_GET,
            target="https://example.com",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_orchestrator_http_post_denied(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-08: Orchestrator CANNOT make HTTP POST requests."""
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.HTTP_POST,
            target="https://api.example.com",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_orchestrator_execute_code_denied(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-09: Orchestrator CANNOT execute code.

        Spec: orchestrator policy blocked: [..., execute_code, ...]
        Code execution from the orchestrator is a high-risk operation.
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.EXECUTE_CODE,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_orchestrator_egress_mode_is_deny_all(self, loader: PolicyLoader) -> None:
        """POLICY-ORCH-10: Orchestrator egress mode is 'deny_all'.

        Spec: orchestrator policy egress.mode: 'deny_all'
        """
        policy = loader.get_agent_policy("orchestrator")
        assert policy is not None
        assert policy.egress_mode == "deny_all"

    def test_orchestrator_per_task_token_limit_is_50000(self, loader: PolicyLoader) -> None:
        """POLICY-ORCH-11: Orchestrator per-task token limit is 50,000.

        Spec: orchestrator policy budget.per_task_token_limit: 50000
        """
        policy = loader.get_agent_policy("orchestrator")
        assert policy is not None
        assert policy.per_task_token_limit == 50000

    def test_orchestrator_budget_exceeded_denied(self, engine: PolicyEngine) -> None:
        """POLICY-ORCH-12: Orchestrator is denied when token budget is exceeded.

        Spec: budget.per_task_token_limit: 50000 — over limit → deny
        """
        req = make_request(
            agent_id="orchestrator",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = engine.evaluate(req, token_count_so_far=60000)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "budget.per_task_token_limit"


# ===========================================================================
# POLICY-SCRAPER: Instagram-Scraper Agent Policy
# ===========================================================================


class TestInstagramScraperPolicy:
    """Tests for agents/instagram-scraper/policies/policy.yaml."""

    def test_scraper_policy_is_loaded(self, loader: PolicyLoader) -> None:
        """POLICY-SCRAPER-01: instagram-scraper policy is loaded from disk."""
        policy = loader.get_agent_policy("instagram-scraper")
        assert policy is not None

    def test_scraper_http_get_instagram_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-02: Scraper can GET from graph.instagram.com.

        Spec: instagram-scraper egress allowlist: graph.instagram.com (GET)
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_scraper_http_get_i_instagram_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-03: Scraper can GET from i.instagram.com.

        Spec: instagram-scraper egress allowlist: i.instagram.com (GET)
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://i.instagram.com/api/v1/users/web_profile_info/",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_scraper_http_get_instagram_com_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-04: Scraper can GET from instagram.com (non-blocked paths).

        Spec: instagram-scraper egress allowlist: instagram.com (GET, with blocked paths)
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/nike/",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_scraper_accounts_path_blocked(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-05: Scraper cannot access instagram.com/accounts/* paths.

        Spec: blocked_paths: ['*/accounts/*', '*/api/v1/friendships/*']
        Login and account management paths must be blocked.
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/accounts/login/",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.egress.blocked_path"

    def test_scraper_friendships_path_blocked(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-06: Scraper cannot access friendships API paths.

        Spec: blocked_paths: [..., '*/api/v1/friendships/*']
        Following/unfollowing endpoints are blocked for the scraper.
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com/api/v1/friendships/12345/",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "agent.egress.blocked_path"

    def test_scraper_external_domain_denied(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-07: Scraper cannot access non-instagram domains.

        Spec: Egress is allowlist mode — only listed domains are accessible.
        """
        for domain in [
            "https://api.example.com/data",
            "https://google.com/search",
            "https://twitter.com/api",
            "https://tiktok.com/api",
        ]:
            req = make_request(
                agent_id="instagram-scraper",
                action=ActionType.HTTP_GET,
                target=domain,
            )
            result = engine.evaluate(req)
            assert result.decision == PolicyDecision.DENY, (
                f"Expected DENY for scraper accessing {domain}"
            )

    def test_scraper_http_post_blocked(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-08: Scraper cannot POST to ANY domain.

        Spec: instagram-scraper actions.blocked: [http_post, http_put, http_delete, ...]
        Scrapers are read-only — no write operations.
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_POST,
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_scraper_write_output_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-09: Scraper can write_output (store scraped data).

        Spec: instagram-scraper actions.allowed: [..., write_output, ...]
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.WRITE_OUTPUT,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_scraper_dispatch_task_blocked(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-10: Scraper CANNOT dispatch_task (no sub-agent spawning).

        Spec: instagram-scraper actions.blocked: [..., dispatch_task, ...]
        Worker agents must not spawn other agents.
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_scraper_token_limit_is_10000(self, loader: PolicyLoader) -> None:
        """POLICY-SCRAPER-11: Scraper per-task token limit is 10,000.

        Spec: instagram-scraper budget.per_task_token_limit: 10000
        """
        policy = loader.get_agent_policy("instagram-scraper")
        assert policy is not None
        assert policy.per_task_token_limit == 10000

    def test_scraper_daily_cost_limit_is_1_usd(self, loader: PolicyLoader) -> None:
        """POLICY-SCRAPER-12: Scraper daily cost limit is $1.00.

        Spec: instagram-scraper budget.daily_cost_limit_usd: 1.00
        """
        policy = loader.get_agent_policy("instagram-scraper")
        assert policy is not None
        assert policy.daily_cost_limit_usd == 1.00

    def test_scraper_token_limit_exceeded_denied(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-13: Scraper denied when token budget (10k) exceeded."""
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.HTTP_GET,
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        result = engine.evaluate(req, token_count_so_far=15000)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "budget.per_task_token_limit"

    def test_scraper_store_knowledge_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-SCRAPER-14: Scraper can store_knowledge (persist scraped data).

        Spec: instagram-scraper actions.allowed: [..., store_knowledge, ...]
        """
        req = make_request(
            agent_id="instagram-scraper",
            action=ActionType.STORE_KNOWLEDGE,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW


# ===========================================================================
# POLICY-KNOWLEDGE: Knowledge Agent Policy
# ===========================================================================


class TestKnowledgeAgentPolicy:
    """Tests for agents/knowledge/policies/policy.yaml."""

    def test_knowledge_policy_is_loaded(self, loader: PolicyLoader) -> None:
        """POLICY-KB-01: knowledge agent policy is loaded from disk."""
        policy = loader.get_agent_policy("knowledge")
        assert policy is not None

    def test_knowledge_query_knowledge_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-KB-02: Knowledge agent can query_knowledge.

        Spec: knowledge policy allowed: [query_knowledge, ...]
        """
        req = make_request(
            agent_id="knowledge",
            action=ActionType.QUERY_KNOWLEDGE,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_knowledge_store_knowledge_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-KB-03: Knowledge agent can store_knowledge.

        Spec: knowledge policy allowed: [..., store_knowledge, ...]
        """
        req = make_request(
            agent_id="knowledge",
            action=ActionType.STORE_KNOWLEDGE,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_knowledge_search_corpus_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-KB-04: Knowledge agent can search_corpus.

        Spec: knowledge policy allowed: [..., search_corpus, ...]
        """
        req = make_request(
            agent_id="knowledge",
            action=ActionType.SEARCH_CORPUS,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_knowledge_http_get_denied(self, engine: PolicyEngine) -> None:
        """POLICY-KB-05: Knowledge agent CANNOT make HTTP GET requests.

        Spec: knowledge policy blocked: [http_get, http_post, ...]
        Knowledge agent only talks to internal services via Gateway actions.
        """
        req = make_request(
            agent_id="knowledge",
            action=ActionType.HTTP_GET,
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_knowledge_dispatch_task_denied(self, engine: PolicyEngine) -> None:
        """POLICY-KB-06: Knowledge agent CANNOT dispatch tasks.

        Spec: knowledge policy blocked: [..., dispatch_task, ...]
        Knowledge agents are leaf nodes — they don't spawn sub-agents.
        """
        req = make_request(
            agent_id="knowledge",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_knowledge_egress_mode_is_deny_all(self, loader: PolicyLoader) -> None:
        """POLICY-KB-07: Knowledge agent egress mode is 'deny_all'.

        Spec: knowledge policy egress.mode: 'deny_all'
        """
        policy = loader.get_agent_policy("knowledge")
        assert policy is not None
        assert policy.egress_mode == "deny_all"

    def test_knowledge_token_limit_is_5000(self, loader: PolicyLoader) -> None:
        """POLICY-KB-08: Knowledge agent per-task token limit is 5,000.

        Spec: knowledge policy budget.per_task_token_limit: 5000
        """
        policy = loader.get_agent_policy("knowledge")
        assert policy is not None
        assert policy.per_task_token_limit == 5000

    def test_knowledge_daily_cost_limit_is_2_usd(self, loader: PolicyLoader) -> None:
        """POLICY-KB-09: Knowledge agent daily cost limit is $2.00.

        Spec: knowledge policy budget.daily_cost_limit_usd: 2.00
        """
        policy = loader.get_agent_policy("knowledge")
        assert policy is not None
        assert policy.daily_cost_limit_usd == 2.00


# ===========================================================================
# POLICY-REVIEWER: Reviewer Agent Policy
# ===========================================================================


class TestReviewerAgentPolicy:
    """Tests for agents/reviewer/policies/policy.yaml."""

    def test_reviewer_policy_is_loaded(self, loader: PolicyLoader) -> None:
        """POLICY-REVIEWER-01: reviewer agent policy is loaded from disk."""
        policy = loader.get_agent_policy("reviewer")
        assert policy is not None

    def test_reviewer_report_result_allowed(self, engine: PolicyEngine) -> None:
        """POLICY-REVIEWER-02: Reviewer can only report_result.

        Spec: reviewer policy allowed: [report_result]
        Reviewer is a read-evaluate-judge agent — it only submits verdicts.
        """
        req = make_request(
            agent_id="reviewer",
            action=ActionType.REPORT_RESULT,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW

    def test_reviewer_dispatch_task_denied(self, engine: PolicyEngine) -> None:
        """POLICY-REVIEWER-03: Reviewer CANNOT dispatch tasks.

        Spec: reviewer policy blocked: [..., dispatch_task, ...]
        Reviewers must not create new work — they only evaluate existing results.
        """
        req = make_request(
            agent_id="reviewer",
            action=ActionType.DISPATCH_TASK,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_reviewer_http_get_denied(self, engine: PolicyEngine) -> None:
        """POLICY-REVIEWER-04: Reviewer CANNOT make HTTP requests.

        Spec: reviewer policy blocked: [http_get, http_post, ...]
        Anti-collusion: reviewer uses OpenAI, not Anthropic — no internet access.
        """
        req = make_request(
            agent_id="reviewer",
            action=ActionType.HTTP_GET,
            target="https://example.com",
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_reviewer_write_output_denied(self, engine: PolicyEngine) -> None:
        """POLICY-REVIEWER-05: Reviewer CANNOT write_output.

        Spec: reviewer policy blocked: [..., write_output, ...]
        Reviewers do not produce raw data — only structured verdicts.
        """
        req = make_request(
            agent_id="reviewer",
            action=ActionType.WRITE_OUTPUT,
            target=None,
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY

    def test_reviewer_egress_mode_is_deny_all(self, loader: PolicyLoader) -> None:
        """POLICY-REVIEWER-06: Reviewer egress mode is 'deny_all'.

        Spec: reviewer policy egress.mode: 'deny_all'
        """
        policy = loader.get_agent_policy("reviewer")
        assert policy is not None
        assert policy.egress_mode == "deny_all"

    def test_reviewer_token_limit_is_20000(self, loader: PolicyLoader) -> None:
        """POLICY-REVIEWER-07: Reviewer per-task token limit is 20,000.

        Spec: reviewer policy budget.per_task_token_limit: 20000
        Reviews require reading and evaluating long outputs.
        """
        policy = loader.get_agent_policy("reviewer")
        assert policy is not None
        assert policy.per_task_token_limit == 20000

    def test_reviewer_daily_cost_limit_is_2_usd(self, loader: PolicyLoader) -> None:
        """POLICY-REVIEWER-08: Reviewer daily cost limit is $2.00.

        Spec: reviewer policy budget.daily_cost_limit_usd: 2.00
        """
        policy = loader.get_agent_policy("reviewer")
        assert policy is not None
        assert policy.daily_cost_limit_usd == 2.00


# ===========================================================================
# POLICY-CROSS: Cross-Agent Invariants
# ===========================================================================


class TestCrossAgentPolicyInvariants:
    """Tests that certain rules hold across ALL agents."""

    ALL_AGENTS = ["orchestrator", "instagram-scraper", "knowledge", "reviewer"]

    @pytest.mark.parametrize("agent_id", ALL_AGENTS)
    def test_activate_kubex_blocked_for_all_agents(
        self, engine: PolicyEngine, agent_id: str
    ) -> None:
        """POLICY-CROSS-01: activate_kubex is DENY for every agent.

        Spec: 'activate_kubex is globally blocked' — only Kubex Manager can do this.
        """
        req = make_request(agent_id=agent_id, action=ActionType.ACTIVATE_KUBEX, target=None)
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.blocked_actions"

    @pytest.mark.parametrize("agent_id", ALL_AGENTS)
    def test_chain_depth_exceeded_blocked_for_all_agents(
        self, engine: PolicyEngine, agent_id: str
    ) -> None:
        """POLICY-CROSS-02: chain_depth=6 is DENY for every agent.

        Spec: max_chain_depth=5 applies globally to all agents.
        """
        req = make_request(
            agent_id=agent_id, action=ActionType.REPORT_RESULT, target=None, chain_depth=6
        )
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.max_chain_depth"

    @pytest.mark.parametrize("agent_id", ALL_AGENTS)
    def test_daily_budget_exceeded_blocked_for_all_agents(
        self, engine: PolicyEngine, agent_id: str
    ) -> None:
        """POLICY-CROSS-03: Daily cost > $10.00 is DENY for every agent.

        Spec: global budget.default_daily_cost_limit_usd: 10.00
        """
        req = make_request(agent_id=agent_id, action=ActionType.REPORT_RESULT, target=None)
        result = engine.evaluate(req, cost_today_usd=999.0)
        assert result.decision == PolicyDecision.DENY
        assert result.rule_matched == "global.budget.daily_cost_limit"

    def test_no_agent_can_access_arbitrary_internet(self, engine: PolicyEngine) -> None:
        """POLICY-CROSS-04: No agent can make HTTP GET to an arbitrary domain.

        Spec: All agents have either deny_all egress OR allowlist with only
        internal/partner domains. No agent has unrestricted internet access.
        """
        for agent_id in self.ALL_AGENTS:
            req = make_request(
                agent_id=agent_id,
                action=ActionType.HTTP_GET,
                target="https://attacker-controlled-server.example.com/exfil",
            )
            result = engine.evaluate(req)
            assert result.decision == PolicyDecision.DENY, (
                f"Agent '{agent_id}' should not be able to access arbitrary URLs"
            )

    def test_all_policies_are_loaded(self, loader: PolicyLoader) -> None:
        """POLICY-CROSS-05: All 4 agent policies are loaded from disk.

        Spec: Policy files exist for all 4 agents defined in configs/.
        """
        for agent_id in self.ALL_AGENTS:
            policy = loader.get_agent_policy(agent_id)
            assert policy is not None, f"Policy for '{agent_id}' should be loaded"


# ===========================================================================
# POLICY-EXHAUSTIVE: Parametrized Action × Agent Matrix
# ===========================================================================


class TestActionAgentMatrix:
    """Exhaustive matrix: for each agent, assert ALLOW/DENY for every action type."""

    # (agent_id, action, expected_decision, note)
    DENY_EXPECTATIONS: list[tuple[str, ActionType, str]] = [
        # Globally blocked — all agents
        ("orchestrator", ActionType.ACTIVATE_KUBEX, "global block"),
        ("instagram-scraper", ActionType.ACTIVATE_KUBEX, "global block"),
        ("knowledge", ActionType.ACTIVATE_KUBEX, "global block"),
        ("reviewer", ActionType.ACTIVATE_KUBEX, "global block"),
        # Orchestrator blocked actions
        ("orchestrator", ActionType.HTTP_GET, "orch blocked"),
        ("orchestrator", ActionType.HTTP_POST, "orch blocked"),
        ("orchestrator", ActionType.EXECUTE_CODE, "orch blocked"),
        # Scraper blocked actions
        ("instagram-scraper", ActionType.HTTP_POST, "scraper blocked"),
        ("instagram-scraper", ActionType.DISPATCH_TASK, "scraper blocked"),
        ("instagram-scraper", ActionType.EXECUTE_CODE, "scraper blocked"),
        # Knowledge blocked actions
        ("knowledge", ActionType.HTTP_GET, "knowledge blocked"),
        ("knowledge", ActionType.DISPATCH_TASK, "knowledge blocked"),
        ("knowledge", ActionType.EXECUTE_CODE, "knowledge blocked"),
        # Reviewer blocked actions
        ("reviewer", ActionType.HTTP_GET, "reviewer blocked"),
        ("reviewer", ActionType.DISPATCH_TASK, "reviewer blocked"),
        ("reviewer", ActionType.WRITE_OUTPUT, "reviewer blocked"),
        ("reviewer", ActionType.EXECUTE_CODE, "reviewer blocked"),
    ]

    ALLOW_EXPECTATIONS: list[tuple[str, ActionType, str]] = [
        # Orchestrator allowed actions
        ("orchestrator", ActionType.DISPATCH_TASK, "orch core"),
        ("orchestrator", ActionType.CHECK_TASK_STATUS, "orch core"),
        ("orchestrator", ActionType.CANCEL_TASK, "orch core"),
        ("orchestrator", ActionType.REPORT_RESULT, "orch core"),
        ("orchestrator", ActionType.QUERY_KNOWLEDGE, "orch knowledge"),
        ("orchestrator", ActionType.STORE_KNOWLEDGE, "orch knowledge"),
        # Scraper allowed actions
        ("instagram-scraper", ActionType.WRITE_OUTPUT, "scraper output"),
        ("instagram-scraper", ActionType.REPORT_RESULT, "scraper report"),
        ("instagram-scraper", ActionType.QUERY_KNOWLEDGE, "scraper knowledge"),
        ("instagram-scraper", ActionType.STORE_KNOWLEDGE, "scraper store"),
        # Knowledge allowed actions
        ("knowledge", ActionType.QUERY_KNOWLEDGE, "kb query"),
        ("knowledge", ActionType.STORE_KNOWLEDGE, "kb store"),
        ("knowledge", ActionType.SEARCH_CORPUS, "kb search"),
        ("knowledge", ActionType.REPORT_RESULT, "kb report"),
        # Reviewer allowed actions
        ("reviewer", ActionType.REPORT_RESULT, "reviewer verdict"),
    ]

    @pytest.mark.parametrize("agent_id,action,note", DENY_EXPECTATIONS)
    def test_expected_deny(
        self, engine: PolicyEngine, agent_id: str, action: ActionType, note: str
    ) -> None:
        """POLICY-MATRIX-DENY: Agent × Action combinations that must be DENY.

        Parametrized test covering all documented deny cases.
        """
        req = make_request(agent_id=agent_id, action=action, target=None)
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.DENY, (
            f"[{note}] Expected DENY for {agent_id}.{action.value}, "
            f"got {result.decision}: {result.reason}"
        )

    @pytest.mark.parametrize("agent_id,action,note", ALLOW_EXPECTATIONS)
    def test_expected_allow(
        self, engine: PolicyEngine, agent_id: str, action: ActionType, note: str
    ) -> None:
        """POLICY-MATRIX-ALLOW: Agent × Action combinations that must be ALLOW.

        Parametrized test covering all documented allow cases.
        """
        req = make_request(agent_id=agent_id, action=action, target=None)
        result = engine.evaluate(req)
        assert result.decision == PolicyDecision.ALLOW, (
            f"[{note}] Expected ALLOW for {agent_id}.{action.value}, "
            f"got {result.decision}: {result.reason}"
        )


# ===========================================================================
# POLICY-YAML: Raw YAML Structure Validation
# ===========================================================================


class TestPolicyYamlStructure:
    """Validate the YAML structure of policy files without the policy engine."""

    def _load_yaml(self, path: str) -> dict[str, Any]:
        with open(path) as f:
            return yaml.safe_load(f) or {}

    def test_global_yaml_has_required_keys(self) -> None:
        """POLICY-YAML-01: global.yaml has all required top-level keys.

        Spec: Global policy must define: global.blocked_actions, max_chain_depth, budget.
        """
        path = os.path.join(PROJECT_ROOT, "policies", "global.yaml")
        data = self._load_yaml(path)
        global_data = data.get("global", {})
        assert "blocked_actions" in global_data
        assert "max_chain_depth" in global_data
        assert "budget" in global_data

    def test_global_yaml_budget_has_daily_limit(self) -> None:
        """POLICY-YAML-02: global.yaml budget section has default_daily_cost_limit_usd."""
        path = os.path.join(PROJECT_ROOT, "policies", "global.yaml")
        data = self._load_yaml(path)
        budget = data.get("global", {}).get("budget", {})
        assert "default_daily_cost_limit_usd" in budget
        assert budget["default_daily_cost_limit_usd"] > 0

    @pytest.mark.parametrize("agent_id", ["orchestrator", "instagram-scraper", "knowledge", "reviewer"])
    def test_agent_policy_yaml_has_required_keys(self, agent_id: str) -> None:
        """POLICY-YAML-03: Each agent policy YAML has required keys.

        Spec: All policy files must define agent_policy.actions and agent_policy.egress.
        """
        path = os.path.join(PROJECT_ROOT, "agents", agent_id, "policies", "policy.yaml")
        data = self._load_yaml(path)
        agent_policy = data.get("agent_policy", {})
        assert "egress" in agent_policy, f"{agent_id} policy missing egress"
        assert "actions" in agent_policy, f"{agent_id} policy missing actions"

    @pytest.mark.parametrize("agent_id", ["orchestrator", "instagram-scraper", "knowledge", "reviewer"])
    def test_agent_policy_egress_has_mode(self, agent_id: str) -> None:
        """POLICY-YAML-04: Each agent policy has egress.mode defined.

        Spec: Egress mode must be 'allowlist' or 'deny_all'.
        """
        path = os.path.join(PROJECT_ROOT, "agents", agent_id, "policies", "policy.yaml")
        data = self._load_yaml(path)
        egress = data.get("agent_policy", {}).get("egress", {})
        assert "mode" in egress, f"{agent_id} policy egress missing mode"
        assert egress["mode"] in ("allowlist", "deny_all"), (
            f"{agent_id} policy egress.mode invalid: {egress['mode']}"
        )

    @pytest.mark.parametrize("agent_id", ["orchestrator", "instagram-scraper", "knowledge", "reviewer"])
    def test_agent_policy_budget_has_token_limit(self, agent_id: str) -> None:
        """POLICY-YAML-05: Each agent policy has budget.per_task_token_limit.

        Spec: All agents must have a per-task token budget for cost control.
        """
        path = os.path.join(PROJECT_ROOT, "agents", agent_id, "policies", "policy.yaml")
        data = self._load_yaml(path)
        budget = data.get("agent_policy", {}).get("budget", {})
        assert "per_task_token_limit" in budget, (
            f"{agent_id} policy budget missing per_task_token_limit"
        )
        assert budget["per_task_token_limit"] > 0

    def test_scraper_policy_egress_allowlist_has_domains(self) -> None:
        """POLICY-YAML-06: instagram-scraper egress allowlist has at least 2 domains.

        Spec: Scraper needs graph.instagram.com and instagram.com at minimum.
        """
        path = os.path.join(PROJECT_ROOT, "agents", "instagram-scraper", "policies", "policy.yaml")
        data = self._load_yaml(path)
        allowed = data.get("agent_policy", {}).get("egress", {}).get("allowed", [])
        assert len(allowed) >= 2, (
            f"Expected at least 2 egress domains for scraper, got {len(allowed)}"
        )
        domains = [entry.get("domain", "") for entry in allowed]
        assert any("instagram.com" in d for d in domains), (
            "instagram.com must be in scraper egress allowlist"
        )

    def test_reviewer_policy_has_minimal_allowlist(self) -> None:
        """POLICY-YAML-07: Reviewer allowed actions list is minimal (security principle).

        Spec: Reviewer is least-privilege — minimal allowed actions.
        Reviewer should only be allowed to report_result.
        """
        path = os.path.join(PROJECT_ROOT, "agents", "reviewer", "policies", "policy.yaml")
        data = self._load_yaml(path)
        allowed = data.get("agent_policy", {}).get("actions", {}).get("allowed", [])
        # Reviewer should have a very small allowlist
        assert "report_result" in allowed, "Reviewer must be allowed to report_result"
        # The allowlist should be minimal — fewer than 5 allowed actions
        assert len(allowed) <= 5, (
            f"Reviewer allowed actions list should be minimal, got {len(allowed)}: {allowed}"
        )
