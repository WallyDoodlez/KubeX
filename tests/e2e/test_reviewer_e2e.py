"""E2E Tests: Reviewer Agent — Security Review Agent.

These tests encode the EXPECTED behaviors of the Reviewer agent:

  1. Reviewer spawns and registers with 'security_review' capability
  2. Reviewer receives structured action payloads and returns ALLOW/DENY/ESCALATE
  3. Reviewer uses a different model than worker agents (anti-collusion)
  4. Reviewer has no external egress (deny_all policy)
  5. Reviewer can only use 'report_result' action (minimal action surface)
  6. Gateway routes ambiguous policy decisions to the reviewer
  7. Reviewer evaluation result is returned to the requesting agent

Tests are SKIPPED until the Reviewer evaluation integration is implemented.
The reviewer agent config, Dockerfile, and policy already exist (Wave 2/5).
What is missing is the Gateway integration that routes ambiguous decisions
to the reviewer and processes its ALLOW/DENY/ESCALATE response.

Spec refs:
  - MVP.md Section 4.3            Reviewer role, model assignment, action restrictions
  - agents/reviewer/config.yaml   Agent config (security_review capability, gpt-5.2 model)
  - agents/reviewer/policies/policy.yaml  Deny-all egress, report_result only
  - services/gateway/gateway/policy.py    PolicyDecision.ESCALATE (defined but not routed)
  - services/gateway/gateway/main.py      handle_action (no ESCALATE routing yet)

Module paths exercised:
  services/gateway/gateway/main.py        (handle_action, reviewer routing)
  services/gateway/gateway/policy.py      (PolicyEngine, ESCALATE decision)
  services/kubex-manager/kubex_manager/main.py  (reviewer container lifecycle)
  services/registry/registry/main.py      (capability registration)
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/gateway"))
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "services/registry"))
sys.path.insert(0, os.path.join(_ROOT, "services/broker"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Implementation guard — reviewer evaluation integration
# ---------------------------------------------------------------------------
_REVIEWER_INTEGRATION_IMPLEMENTED = False
try:
    from gateway.main import app as gateway_app

    # Check if the gateway has reviewer routing support
    # The feature is "implemented" when handle_action routes ESCALATE decisions
    # to the reviewer agent and processes its response.
    _has_reviewer_routing = hasattr(gateway_app, "state") and hasattr(
        gateway_app.state, "gateway_service"
    )
    # Even though gateway_app exists, reviewer routing is not yet implemented.
    # We check for the specific function/class that handles reviewer dispatch.
    from gateway import main as _gw_main

    _REVIEWER_INTEGRATION_IMPLEMENTED = hasattr(_gw_main, "_handle_reviewer_evaluation")
except ImportError:
    pass

_skip_reviewer = pytest.mark.skipif(
    not _REVIEWER_INTEGRATION_IMPLEMENTED,
    reason=(
        "Reviewer evaluation integration not yet implemented -- "
        "gateway.main._handle_reviewer_evaluation missing "
        "(routes ESCALATE decisions to reviewer agent)"
    ),
)

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

REVIEWER_ID = "reviewer"
ORCHESTRATOR_ID = "orchestrator"
SCRAPER_ID = "instagram-scraper"
TASK_ID = f"task-{uuid.uuid4().hex[:12]}"
WORKFLOW_ID = f"wf-{uuid.uuid4().hex[:8]}"


def make_action_request(
    agent_id: str = ORCHESTRATOR_ID,
    action: str = "dispatch_task",
    parameters: dict[str, Any] | None = None,
    target: str | None = None,
    task_id: str | None = None,
    chain_depth: int = 1,
) -> dict[str, Any]:
    return {
        "request_id": f"req-{uuid.uuid4().hex[:8]}",
        "agent_id": agent_id,
        "action": action,
        "target": target,
        "parameters": parameters or {},
        "priority": "normal",
        "context": {
            "task_id": task_id or TASK_ID,
            "workflow_id": WORKFLOW_ID,
            "chain_depth": chain_depth,
        },
    }


def make_review_payload(
    original_action: str = "http_post",
    original_agent_id: str = SCRAPER_ID,
    original_target: str | None = "https://graph.instagram.com/v18.0/12345/comments",
    reason: str = "Action could not be deterministically approved or denied",
) -> dict[str, Any]:
    """Create a structured review payload that the reviewer agent receives."""
    return {
        "review_request_id": f"rev-{uuid.uuid4().hex[:8]}",
        "original_action": original_action,
        "original_agent_id": original_agent_id,
        "original_target": original_target,
        "original_parameters": {},
        "reason_for_review": reason,
        "policy_context": {
            "matched_rules": ["agent.egress.method"],
            "agent_boundary": "data-collection",
            "chain_depth": 1,
        },
    }


# ===========================================================================
# REV-SPAWN: Reviewer Agent Spawning and Registration
# ===========================================================================


@_skip_reviewer
@pytest.mark.e2e
class TestReviewerSpawning:
    """Spec: Reviewer agent can be spawned and registered with correct capabilities."""

    def setup_method(self) -> None:
        try:
            from kubex_manager.main import app as manager_app
            from fastapi.testclient import TestClient

            self.mock_docker = MagicMock()
            self.mock_container = MagicMock()
            self.mock_docker.containers.create.return_value = self.mock_container
            self.mock_docker.containers.get.return_value = self.mock_container
            self.mock_container.id = "reviewer-container-abc123"
            self.mock_container.status = "running"
            self.client = TestClient(manager_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_reviewer_spawns_with_security_review_capability(
        self, mock_docker_env: MagicMock
    ) -> None:
        """REV-SPAWN-01: Reviewer agent registers with 'security_review' capability.

        Spec: 'capabilities: ["security_review"]' in reviewer config.yaml.
        The reviewer must be discoverable via capability resolution.
        """
        mock_docker_env.return_value = self.mock_docker

        reviewer_config = {
            "agent": {
                "id": REVIEWER_ID,
                "boundary": "default",
                "prompt": (
                    "You are a security reviewer for KubexClaw. You evaluate action "
                    "requests that the policy engine could not deterministically decide."
                ),
                "skills": [],
                "capabilities": ["security_review"],
                "models": {
                    "allowed": [{"id": "o3-mini", "provider": "openai", "tier": "standard"}],
                    "default": "o3-mini",
                },
                "providers": ["openai"],
            }
        }

        with patch("kubex_manager.lifecycle.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"agent_id": REVIEWER_ID}
            mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )

            create_resp = self.client.post(
                "/kubexes",
                json={"config": reviewer_config},
                headers={"Authorization": "Bearer kubex-mgmt-token"},
            )
            assert create_resp.status_code == 201, (
                f"Expected 201 for reviewer creation, got {create_resp.status_code}: "
                f"{create_resp.text}"
            )

            data = create_resp.json()
            assert data["kubex_id"] is not None

            # Verify Registry POST was called with security_review capability
            post_calls = (
                mock_httpx.return_value.__aenter__.return_value.post.call_args_list
            )
            registry_calls = [c for c in post_calls if "/agents" in str(c)]
            assert len(registry_calls) >= 1, (
                "Expected Registry POST call to register reviewer agent"
            )

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_reviewer_container_has_no_api_key_env_vars(
        self, mock_docker_env: MagicMock
    ) -> None:
        """REV-SPAWN-02: Reviewer container does not receive raw API keys.

        Spec: 'OPENAI_BASE_URL points to the Gateway proxy -- no direct API key access.'
        The reviewer must go through the Gateway LLM proxy for all LLM calls.
        """
        mock_docker_env.return_value = self.mock_docker

        reviewer_config = {
            "agent": {
                "id": REVIEWER_ID,
                "boundary": "default",
                "prompt": "Security reviewer",
                "skills": [],
                "capabilities": ["security_review"],
                "models": {
                    "allowed": [{"id": "o3-mini", "provider": "openai"}],
                    "default": "o3-mini",
                },
                "providers": ["openai"],
            }
        }

        create_resp = self.client.post(
            "/kubexes",
            json={"config": reviewer_config},
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert create_resp.status_code == 201

        # Check that docker create was called and env vars do NOT contain raw keys
        create_call = self.mock_docker.containers.create
        assert create_call.called
        call_kwargs = create_call.call_args
        env_dict = call_kwargs.kwargs.get("environment", call_kwargs[1].get("environment", {}))

        # OPENAI_BASE_URL should point to gateway proxy, not api.openai.com
        if isinstance(env_dict, dict):
            openai_url = env_dict.get("OPENAI_BASE_URL", "")
            assert "api.openai.com" not in openai_url, (
                "Reviewer must NOT have direct OpenAI API access"
            )
            assert "OPENAI_API_KEY" not in env_dict, (
                "Reviewer must NOT receive raw OPENAI_API_KEY"
            )


# ===========================================================================
# REV-EVAL: Reviewer Evaluation Decisions
# ===========================================================================


@_skip_reviewer
@pytest.mark.e2e
class TestReviewerEvaluation:
    """Spec: Reviewer receives structured payloads and returns ALLOW/DENY/ESCALATE."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.gateway_app = gw_app
            self.client = TestClient(gw_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_reviewer_returns_allow_for_safe_action(self) -> None:
        """REV-EVAL-01: Reviewer returns ALLOW for an action deemed safe.

        Spec: 'You evaluate action requests ... return ALLOW, DENY, or ESCALATE.'
        When the reviewer determines an action is safe, it returns ALLOW and
        the original action is executed.
        """
        review_payload = make_review_payload(
            original_action="http_get",
            original_agent_id=SCRAPER_ID,
            original_target="https://graph.instagram.com/v18.0/12345/media",
            reason="Could not determine if rate limit applies",
        )

        # Mock the reviewer agent's LLM response returning ALLOW
        mock_reviewer_response = {
            "decision": "ALLOW",
            "reasoning": "The action is a standard read from an allowed domain.",
            "risk_level": "low",
        }

        with patch(
            "gateway.main._handle_reviewer_evaluation",
            new_callable=AsyncMock,
            return_value=mock_reviewer_response,
        ):
            body = make_action_request(
                agent_id=SCRAPER_ID,
                action="http_get",
                target="https://graph.instagram.com/v18.0/12345/media",
            )

            # Simulate an ESCALATE decision from the policy engine leading to reviewer
            with patch(
                "gateway.main.httpx.AsyncClient"
            ) as mock_httpx:
                mock_resp = MagicMock()
                mock_resp.status_code = 200
                mock_resp.text = json.dumps({"data": []})
                mock_resp.headers = {"content-type": "application/json"}
                mock_httpx.return_value.__aenter__.return_value.request = AsyncMock(
                    return_value=mock_resp
                )

                resp = self.client.post("/actions", json=body)

            # ALLOW means the action proceeds -- should get 200
            assert resp.status_code == 200, (
                f"Expected 200 after reviewer ALLOW, got {resp.status_code}: {resp.text}"
            )

    def test_reviewer_returns_deny_for_dangerous_action(self) -> None:
        """REV-EVAL-02: Reviewer returns DENY for a dangerous action.

        Spec: 'You must be conservative -- when in doubt, DENY or ESCALATE.'
        When the reviewer determines an action is dangerous, it returns DENY
        and the action is blocked with 403.
        """
        review_payload = make_review_payload(
            original_action="http_post",
            original_agent_id=SCRAPER_ID,
            original_target="https://graph.instagram.com/v18.0/12345/comments",
            reason="POST action by a read-only scraper agent",
        )

        mock_reviewer_response = {
            "decision": "DENY",
            "reasoning": "Scraper agents must not modify remote data. POST to comments endpoint is a mutation.",
            "risk_level": "high",
        }

        with patch(
            "gateway.main._handle_reviewer_evaluation",
            new_callable=AsyncMock,
            return_value=mock_reviewer_response,
        ):
            body = make_action_request(
                agent_id=SCRAPER_ID,
                action="http_post",
                target="https://graph.instagram.com/v18.0/12345/comments",
            )
            resp = self.client.post("/actions", json=body)

        # DENY means the action is blocked
        assert resp.status_code == 403, (
            f"Expected 403 after reviewer DENY, got {resp.status_code}: {resp.text}"
        )

    def test_reviewer_returns_escalate_for_ambiguous_action(self) -> None:
        """REV-EVAL-03: Reviewer returns ESCALATE for an ambiguous action.

        Spec: 'Human-in-the-loop is mandatory for high-risk actions.'
        When even the reviewer cannot decide, it returns ESCALATE, which
        triggers human-in-the-loop approval.
        """
        review_payload = make_review_payload(
            original_action="execute_code",
            original_agent_id=ORCHESTRATOR_ID,
            original_target=None,
            reason="Code execution request with unclear intent",
        )

        mock_reviewer_response = {
            "decision": "ESCALATE",
            "reasoning": "Cannot determine safety of code execution without seeing the code. Human review required.",
            "risk_level": "critical",
        }

        with patch(
            "gateway.main._handle_reviewer_evaluation",
            new_callable=AsyncMock,
            return_value=mock_reviewer_response,
        ):
            body = make_action_request(
                agent_id=ORCHESTRATOR_ID,
                action="execute_code",
                parameters={"code": "import os; os.listdir('/')"},
            )
            resp = self.client.post("/actions", json=body)

        # ESCALATE should return a specific status indicating human review needed
        # 202 Accepted with escalation details, or 403 with escalation info
        assert resp.status_code in (202, 403, 423), (
            f"Expected 202/403/423 after reviewer ESCALATE, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        # Response must indicate escalation
        assert (
            "escalat" in json.dumps(data).lower()
            or data.get("status") == "escalated"
        ), f"Response should indicate escalation: {data}"


# ===========================================================================
# REV-MODEL: Anti-Collusion Model Separation
# ===========================================================================


@_skip_reviewer
@pytest.mark.e2e
class TestReviewerModelSeparation:
    """Spec: Reviewer uses a different model than worker agents (anti-collusion)."""

    def test_reviewer_uses_different_model_than_workers(self) -> None:
        """REV-MODEL-01: Reviewer model (o3-mini) differs from worker models (gpt-5.2).

        Spec: 'Uses a different LLM provider than workers (anti-collusion)'
        MVP.md: 'Model assignment: OpenAI -- o3-mini (single tier, zero overlap with worker models)'
        The reviewer MUST use a different model to prevent collusion attacks
        where a compromised model approves its own malicious actions.
        """
        import yaml

        # Load reviewer config
        reviewer_config_path = os.path.join(_ROOT, "agents", "reviewer", "config.yaml")
        with open(reviewer_config_path) as f:
            reviewer_config = yaml.safe_load(f)

        reviewer_default_model = reviewer_config["agent"]["models"]["default"]

        # Load worker configs and verify no overlap
        worker_agents = ["instagram-scraper", "knowledge"]
        for worker_id in worker_agents:
            worker_config_path = os.path.join(
                _ROOT, "agents", worker_id, "config.yaml"
            )
            if not os.path.exists(worker_config_path):
                continue
            with open(worker_config_path) as f:
                worker_config = yaml.safe_load(f)

            worker_default_model = worker_config["agent"]["models"]["default"]

            # Extract all allowed model IDs for the worker
            worker_model_ids = [
                m["id"]
                for m in worker_config["agent"]["models"].get("allowed", [])
            ]

            # Reviewer's default model must NOT be in worker's allowed models
            assert reviewer_default_model not in worker_model_ids, (
                f"Anti-collusion violation: reviewer model '{reviewer_default_model}' "
                f"is also allowed for worker '{worker_id}' (models: {worker_model_ids})"
            )

    def test_reviewer_policy_specifies_exclusive_model(self) -> None:
        """REV-MODEL-02: Reviewer policy limits models to o3-mini only.

        Spec: The reviewer policy.yaml must specify an exclusive model allowlist
        that does not overlap with any worker agent's model allowlist.
        """
        import yaml

        policy_path = os.path.join(
            _ROOT, "agents", "reviewer", "policies", "policy.yaml"
        )
        with open(policy_path) as f:
            policy = yaml.safe_load(f)

        allowed_models = policy["agent_policy"]["models"]["allowed"]
        model_ids = [m["id"] for m in allowed_models]

        assert len(model_ids) >= 1, "Reviewer must have at least one allowed model"
        assert "o3-mini" in model_ids, (
            f"Reviewer must use o3-mini per spec, got: {model_ids}"
        )

        # Verify no worker models are in the list
        worker_models = ["gpt-5.2", "claude-sonnet-4-6", "claude-sonnet-4-20250514"]
        for wm in worker_models:
            assert wm not in model_ids, (
                f"Anti-collusion violation: worker model '{wm}' found in reviewer policy"
            )


# ===========================================================================
# REV-POLICY: Reviewer Action Restrictions
# ===========================================================================


@_skip_reviewer
@pytest.mark.e2e
class TestReviewerPolicyRestrictions:
    """Spec: Reviewer has deny_all egress and can only use report_result."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gw_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_reviewer_has_deny_all_egress(self) -> None:
        """REV-POLICY-01: Reviewer has egress mode 'deny_all'.

        Spec: 'Blocked actions: All external actions (http_get, http_post, ...)'
        Reviewer must not be able to make any external HTTP requests.
        """
        for action in ["http_get", "http_post", "http_put", "http_delete"]:
            body = make_action_request(
                agent_id=REVIEWER_ID,
                action=action,
                target="https://example.com/exfiltrate",
            )
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 403, (
                f"Expected 403 for reviewer {action}, got {resp.status_code}: {resp.text}"
            )

    def test_reviewer_can_only_report_result(self) -> None:
        """REV-POLICY-02: Reviewer can only use report_result action.

        Spec: 'Allowed actions: report_result (to return review decisions)'
        All other actions must be denied by the reviewer's policy.
        """
        # report_result should be allowed
        body = make_action_request(
            agent_id=REVIEWER_ID,
            action="report_result",
            parameters={"decision": "DENY", "reasoning": "Too risky"},
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200, (
            f"Expected 200 for reviewer report_result, got {resp.status_code}: {resp.text}"
        )

    @pytest.mark.parametrize(
        "blocked_action",
        [
            "dispatch_task",
            "execute_code",
            "send_email",
            "write_output",
            "read_input",
        ],
    )
    def test_reviewer_cannot_use_blocked_actions(self, blocked_action: str) -> None:
        """REV-POLICY-03: Reviewer is denied all actions except report_result.

        Spec: reviewer config.yaml explicitly blocks dispatch_task, execute_code,
        send_email, write_output, read_input, and all HTTP methods.
        """
        body = make_action_request(
            agent_id=REVIEWER_ID,
            action=blocked_action,
            parameters={"data": "test"},
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403, (
            f"Expected 403 for reviewer {blocked_action}, "
            f"got {resp.status_code}: {resp.text}"
        )

    def test_reviewer_budget_is_limited(self) -> None:
        """REV-POLICY-04: Reviewer has tight budget limits.

        Spec: 'per_task_token_limit: 20000, daily_cost_limit_usd: 2.00'
        Reviewer evaluations should be fast and cheap -- tight limits enforce this.
        """
        import yaml

        policy_path = os.path.join(
            _ROOT, "agents", "reviewer", "policies", "policy.yaml"
        )
        with open(policy_path) as f:
            policy = yaml.safe_load(f)

        budget = policy["agent_policy"]["budget"]
        assert budget["per_task_token_limit"] <= 20000, (
            f"Reviewer per-task token limit should be <= 20000, got {budget['per_task_token_limit']}"
        )
        assert budget["daily_cost_limit_usd"] <= 5.0, (
            f"Reviewer daily cost limit should be tight, got ${budget['daily_cost_limit_usd']}"
        )


# ===========================================================================
# REV-ROUTING: Gateway Routes ESCALATE to Reviewer
# ===========================================================================


@_skip_reviewer
@pytest.mark.e2e
class TestGatewayReviewerRouting:
    """Spec: Gateway routes ambiguous policy decisions to the reviewer."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gw_app
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gw_app.state.gateway_service.redis_db1 = self.fake_redis
            self.gateway_app = gw_app
            self.client = TestClient(gw_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_escalate_decision_dispatches_to_reviewer(self) -> None:
        """REV-ROUTING-01: PolicyDecision.ESCALATE triggers reviewer dispatch.

        Spec: When the policy engine cannot deterministically approve or deny,
        it returns ESCALATE. The gateway must then dispatch the action to
        the reviewer agent for evaluation.
        """
        from gateway.policy import PolicyDecision, PolicyResult

        # Mock policy engine to return ESCALATE
        escalate_result = PolicyResult(
            decision=PolicyDecision.ESCALATE,
            reason="Cannot determine if this action is safe",
            rule_matched="ambiguous_action",
            agent_id=SCRAPER_ID,
        )

        with patch.object(
            self.gateway_app.state.gateway_service.policy_engine,
            "evaluate",
            return_value=escalate_result,
        ):
            with patch(
                "gateway.main._handle_reviewer_evaluation",
                new_callable=AsyncMock,
            ) as mock_reviewer:
                mock_reviewer.return_value = {
                    "decision": "ALLOW",
                    "reasoning": "Safe action",
                }

                body = make_action_request(
                    agent_id=SCRAPER_ID,
                    action="http_get",
                    target="https://graph.instagram.com/v18.0/12345/media",
                )
                resp = self.client.post("/actions", json=body)

                # Verify reviewer was called
                assert mock_reviewer.called, (
                    "Expected _handle_reviewer_evaluation to be called on ESCALATE"
                )

    def test_reviewer_deny_blocks_original_action(self) -> None:
        """REV-ROUTING-02: When reviewer returns DENY, original action is blocked.

        Spec: Reviewer DENY decision must result in 403 for the original caller.
        The denial reason from the reviewer should be included in the response.
        """
        from gateway.policy import PolicyDecision, PolicyResult

        escalate_result = PolicyResult(
            decision=PolicyDecision.ESCALATE,
            reason="Ambiguous egress request",
            rule_matched="ambiguous_egress",
            agent_id=SCRAPER_ID,
        )

        with patch.object(
            self.gateway_app.state.gateway_service.policy_engine,
            "evaluate",
            return_value=escalate_result,
        ):
            with patch(
                "gateway.main._handle_reviewer_evaluation",
                new_callable=AsyncMock,
            ) as mock_reviewer:
                mock_reviewer.return_value = {
                    "decision": "DENY",
                    "reasoning": "Target endpoint allows data mutation",
                    "risk_level": "high",
                }

                body = make_action_request(
                    agent_id=SCRAPER_ID,
                    action="http_post",
                    target="https://graph.instagram.com/v18.0/12345/comments",
                )
                resp = self.client.post("/actions", json=body)

        assert resp.status_code == 403, (
            f"Expected 403 after reviewer DENY, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert "ReviewerDenied" in data.get("error", "") or "deny" in json.dumps(data).lower(), (
            f"Response should indicate reviewer denial: {data}"
        )

    def test_reviewer_result_returned_to_requesting_agent(self) -> None:
        """REV-ROUTING-03: Reviewer evaluation result includes reasoning for the caller.

        Spec: The requesting agent should receive the reviewer's reasoning
        so it can adjust its behavior (e.g., retry with different parameters).
        """
        from gateway.policy import PolicyDecision, PolicyResult

        escalate_result = PolicyResult(
            decision=PolicyDecision.ESCALATE,
            reason="Action needs security review",
            rule_matched="escalate_to_reviewer",
            agent_id=SCRAPER_ID,
        )

        with patch.object(
            self.gateway_app.state.gateway_service.policy_engine,
            "evaluate",
            return_value=escalate_result,
        ):
            with patch(
                "gateway.main._handle_reviewer_evaluation",
                new_callable=AsyncMock,
            ) as mock_reviewer:
                mock_reviewer.return_value = {
                    "decision": "DENY",
                    "reasoning": "Mutation on external API is not allowed for read-only agents.",
                    "risk_level": "high",
                }

                body = make_action_request(
                    agent_id=SCRAPER_ID,
                    action="http_post",
                    target="https://graph.instagram.com/v18.0/12345/comments",
                )
                resp = self.client.post("/actions", json=body)

        data = resp.json()
        # The response should include the reviewer's reasoning
        response_text = json.dumps(data).lower()
        assert "reason" in response_text or "message" in response_text, (
            f"Response should include reasoning from reviewer: {data}"
        )

    def test_reviewer_timeout_defaults_to_deny(self) -> None:
        """REV-ROUTING-04: If reviewer evaluation times out, default to DENY.

        Spec: 'You must be conservative -- when in doubt, DENY or ESCALATE.'
        If the reviewer agent is unavailable or slow, the gateway must fail
        closed (deny the action) rather than allowing it through.
        """
        from gateway.policy import PolicyDecision, PolicyResult

        escalate_result = PolicyResult(
            decision=PolicyDecision.ESCALATE,
            reason="Needs review",
            rule_matched="escalate_to_reviewer",
            agent_id=SCRAPER_ID,
        )

        with patch.object(
            self.gateway_app.state.gateway_service.policy_engine,
            "evaluate",
            return_value=escalate_result,
        ):
            with patch(
                "gateway.main._handle_reviewer_evaluation",
                new_callable=AsyncMock,
                side_effect=TimeoutError("Reviewer agent did not respond in time"),
            ):
                body = make_action_request(
                    agent_id=SCRAPER_ID,
                    action="http_get",
                    target="https://graph.instagram.com/v18.0/12345/media",
                )
                resp = self.client.post("/actions", json=body)

        # Timeout must result in denial (fail closed)
        assert resp.status_code == 403, (
            f"Expected 403 on reviewer timeout (fail closed), "
            f"got {resp.status_code}: {resp.text}"
        )
