"""E2E Tests: Human-in-the-Loop (HITL).

These tests validate the request_user_input action flow end-to-end:

  1. Orchestrator can send request_user_input action
  2. Workers are DENIED request_user_input action
  3. request_user_input pauses task execution until response
  4. Human response is delivered back to the orchestrator
  5. request_user_input includes the question/prompt text
  6. Timeout on request_user_input if no human response
  7. Multiple request_user_input calls in a single task work correctly
  8. Policy engine allows request_user_input only for orchestrator agent

Tests are SKIPPED until the HITL integration layer is fully wired.

Spec refs:
  - MVP.md Section 5.8: 'request_user_input is an Orchestrator-only action'
  - MVP.md line 1258: 'Test request_user_input action: Gateway allows for Orchestrator, verify DENY for worker Kubexes'
  - agents/orchestrator/policies/policy.yaml: request_user_input in allowed list
  - agents/instagram-scraper/policies/policy.yaml: request_user_input NOT in allowed list
  - services/gateway/gateway/main.py: handle_action policy enforcement

Module paths exercised:
  services/gateway/gateway/main.py          (handle_action, policy evaluation)
  services/gateway/gateway/policy.py        (PolicyEngine cascade)
  agents/orchestrator/mcp-bridge/server.py  (request_user_input tool)
  agents/orchestrator/mcp-bridge/client/gateway.py  (GatewayClient.request_user_input)
"""

from __future__ import annotations

import asyncio
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
sys.path.insert(0, os.path.join(_ROOT, "agents/orchestrator"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/kubex_common"))

# ---------------------------------------------------------------------------
# Implementation guard — HITL integration not yet fully wired
# ---------------------------------------------------------------------------
_HITL_INTEGRATED = False
try:
    from gateway.main import app as _gateway_app

    _HITL_INTEGRATED = True
except ImportError:
    pass

_skip_not_integrated = pytest.mark.skipif(
    not _HITL_INTEGRATED,
    reason="HITL integration not available — missing gateway imports",
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ORCHESTRATOR_ID = "orchestrator"
SCRAPER_ID = "instagram-scraper"
KNOWLEDGE_ID = "knowledge"
REVIEWER_ID = "reviewer"


def make_task_id() -> str:
    return f"task-{uuid.uuid4().hex[:12]}"


def make_action_request(
    agent_id: str = ORCHESTRATOR_ID,
    action: str = "request_user_input",
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
            "task_id": task_id or make_task_id(),
            "workflow_id": f"wf-{uuid.uuid4().hex[:8]}",
            "chain_depth": chain_depth,
        },
    }


# ===========================================================================
# HITL-01: Orchestrator can send request_user_input action
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestOrchestratorCanRequestUserInput:
    """Spec: Orchestrator is allowed to call request_user_input."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_orchestrator_request_user_input_is_allowed(self) -> None:
        """HITL-01: Orchestrator can send request_user_input and gets 200 (accepted).

        Spec: 'request_user_input is an Orchestrator-only action'
        (MVP.md Section 5.8)
        The orchestrator policy includes request_user_input in allowed actions.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="request_user_input",
            parameters={
                "question": "The target Instagram profile is private. Proceed with public data only?",
                "options": ["yes", "no", "skip"],
                "timeout_seconds": 300,
            },
        )
        resp = self.client.post("/actions", json=body)

        # Policy should ALLOW this action for the orchestrator
        assert resp.status_code == 200, (
            f"Expected 200 for orchestrator request_user_input, "
            f"got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert data.get("action") == "request_user_input" or data.get("status") == "accepted"


# ===========================================================================
# HITL-02: Workers are DENIED request_user_input action
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestWorkersCannotRequestUserInput:
    """Spec: Worker Kubexes are not permitted to call request_user_input."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @pytest.mark.parametrize("worker_id", [SCRAPER_ID, KNOWLEDGE_ID, REVIEWER_ID])
    def test_worker_request_user_input_is_denied(self, worker_id: str) -> None:
        """HITL-02: Worker agents get 403 when trying request_user_input.

        Spec: 'Worker Kubexes are not permitted to call request_user_input --
        they must use needs_clarification on report_result instead.'
        (MVP.md Section 5.8)

        This prevents workers from directly interacting with the human operator,
        preserving the orchestrator as the single point of human interaction.
        """
        body = make_action_request(
            agent_id=worker_id,
            action="request_user_input",
            parameters={
                "question": "Can I access this private profile?",
                "timeout_seconds": 60,
            },
        )
        resp = self.client.post("/actions", json=body)

        assert resp.status_code == 403, (
            f"Expected 403 for {worker_id} calling request_user_input, "
            f"got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert "PolicyDenied" in data.get("error", "") or "denied" in str(data).lower(), (
            f"Expected policy denial error for {worker_id}, got: {data}"
        )


# ===========================================================================
# HITL-03: request_user_input pauses task execution until response
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestRequestUserInputPausesExecution:
    """Spec: request_user_input blocks until the human operator responds."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_request_user_input_returns_accepted_status(self) -> None:
        """HITL-03: request_user_input returns an accepted status indicating it is pending.

        Spec: The MCP Bridge receives the ALLOW response and blocks on stdin.
        At the Gateway level, the action is accepted (200) and the blocking
        happens in the MCP Bridge layer, not the Gateway.
        The response should indicate the action was accepted for processing.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="request_user_input",
            parameters={
                "question": "Approve high-risk action: delete old data?",
                "options": ["approve", "deny"],
                "timeout_seconds": 600,
            },
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200

        data = resp.json()
        # Gateway accepts the action; the MCP Bridge handles the blocking
        assert "status" in data or "action" in data


# ===========================================================================
# HITL-05: request_user_input includes the question/prompt text
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestRequestUserInputIncludesQuestion:
    """Spec: request_user_input carries the question text to the human."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_question_text_is_preserved_in_action_request(self) -> None:
        """HITL-05: The question/prompt text is included in the action parameters.

        Spec: request_user_input parameters include 'question' field with the
        prompt text, optional 'options' for multiple-choice, and 'timeout_seconds'.
        (MVP.md Section 5.8 -- ActionRequest example)
        """
        question_text = "The target Instagram profile is private. Should I proceed with public data only, or skip this profile entirely?"
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="request_user_input",
            parameters={
                "question": question_text,
                "options": ["proceed_public", "skip_profile", "abort_task"],
                "timeout_seconds": 300,
            },
        )
        resp = self.client.post("/actions", json=body)

        # The action should be accepted (policy allows it for orchestrator)
        assert resp.status_code == 200, (
            f"Expected 200, got {resp.status_code}: {resp.text}"
        )

    def test_question_without_options_is_valid(self) -> None:
        """HITL-05b: request_user_input works without options (free-text input).

        Spec: Options are optional. The human can provide free-text when no
        options are specified.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="request_user_input",
            parameters={
                "question": "What is the target Instagram username to scrape?",
                "timeout_seconds": 600,
            },
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 200


# ===========================================================================
# HITL-06: Timeout on request_user_input if no human response
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestRequestUserInputTimeout:
    """Spec: request_user_input times out if no human response."""

    def test_short_timeout_value_is_accepted(self) -> None:
        """HITL-06b: Very short timeout values are accepted (for testing).

        Spec: Timeout value should be validated but low values allowed.
        """
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = fake_redis
            client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="request_user_input",
            parameters={
                "question": "Quick approval needed",
                "timeout_seconds": 5,
            },
        )
        resp = client.post("/actions", json=body)
        # Should be accepted (policy allows it)
        assert resp.status_code == 200


# ===========================================================================
# HITL-07: Multiple request_user_input calls in a single task
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestMultipleRequestUserInputCalls:
    """Spec: Multiple request_user_input calls in a single task work correctly."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_multiple_hitl_requests_in_same_task(self) -> None:
        """HITL-07: Multiple request_user_input calls in a single task all succeed.

        Spec: An orchestrator may need to ask the human multiple questions
        during a single task (e.g., first for approval, then for clarification).
        Each request should be evaluated independently.
        """
        task_id = make_task_id()

        questions = [
            "The scraper found 3 profiles matching 'company_x'. Which one is correct?",
            "Profile is private. Proceed with public data only?",
            "Scraped 500 posts. Continue to older posts or stop here?",
        ]

        for i, question in enumerate(questions):
            body = make_action_request(
                agent_id=ORCHESTRATOR_ID,
                action="request_user_input",
                parameters={
                    "question": question,
                    "timeout_seconds": 300,
                },
                task_id=task_id,
            )
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 200, (
                f"Expected 200 for HITL request #{i+1}, "
                f"got {resp.status_code}: {resp.text}"
            )

    def test_hitl_requests_across_different_tasks(self) -> None:
        """HITL-07b: request_user_input works across different tasks.

        Spec: Each task is independent. HITL requests in different tasks
        should not interfere with each other.
        """
        for i in range(3):
            body = make_action_request(
                agent_id=ORCHESTRATOR_ID,
                action="request_user_input",
                parameters={
                    "question": f"Approval needed for task {i}",
                    "timeout_seconds": 300,
                },
                task_id=make_task_id(),
            )
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 200


# ===========================================================================
# HITL-08: Policy engine allows request_user_input only for orchestrator
# ===========================================================================


@_skip_not_integrated
@pytest.mark.e2e
class TestPolicyEngineHITLEnforcement:
    """Spec: Policy engine enforces request_user_input access control."""

    def setup_method(self) -> None:
        try:
            import fakeredis
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)
        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_orchestrator_policy_includes_request_user_input(self) -> None:
        """HITL-08a: Orchestrator policy file includes request_user_input in allowed actions.

        Spec: agents/orchestrator/policies/policy.yaml must have
        request_user_input in the allowed actions list.
        """
        from gateway.policy import PolicyLoader

        policy_root = os.environ.get("KUBEX_POLICY_ROOT", _ROOT)
        loader = PolicyLoader(policy_root=policy_root)
        loader.load_all()

        orch_policy = loader.get_agent_policy(ORCHESTRATOR_ID)
        assert orch_policy is not None, "Orchestrator policy must exist"

        allowed = [a for a in orch_policy.allowed_actions]
        assert "request_user_input" in allowed, (
            f"request_user_input not in orchestrator allowed actions: {allowed}"
        )

    @pytest.mark.parametrize("worker_id", [SCRAPER_ID, KNOWLEDGE_ID, REVIEWER_ID])
    def test_worker_policy_excludes_request_user_input(self, worker_id: str) -> None:
        """HITL-08b: Worker policies do NOT include request_user_input.

        Spec: 'Worker Kubexes are not permitted to call request_user_input'
        Workers must use needs_clarification instead.
        """
        from gateway.policy import PolicyLoader

        policy_root = os.environ.get("KUBEX_POLICY_ROOT", _ROOT)
        loader = PolicyLoader(policy_root=policy_root)
        loader.load_all()

        worker_policy = loader.get_agent_policy(worker_id)
        if worker_policy is None:
            pytest.skip(f"No policy found for {worker_id}")

        allowed = [a for a in worker_policy.allowed_actions]
        assert "request_user_input" not in allowed, (
            f"request_user_input should NOT be in {worker_id} allowed actions: {allowed}"
        )

    def test_policy_cascade_denies_worker_request_user_input(self) -> None:
        """HITL-08c: Full policy cascade denies request_user_input for scraper.

        Spec: Global policy -> agent policy cascade. The scraper's allowed list
        does not include request_user_input, so the policy engine must deny it.
        """
        from gateway.policy import PolicyEngine, PolicyLoader
        from kubex_common.schemas.actions import ActionRequest, ActionType, RequestContext

        policy_root = os.environ.get("KUBEX_POLICY_ROOT", _ROOT)
        loader = PolicyLoader(policy_root=policy_root)
        loader.load_all()
        engine = PolicyEngine(loader)

        request = ActionRequest(
            request_id="req-hitl-test",
            agent_id=SCRAPER_ID,
            action=ActionType.REQUEST_USER_INPUT,
            parameters={"question": "test"},
            context=RequestContext(task_id="t-test", chain_depth=1),
        )

        result = engine.evaluate(request, token_count_so_far=0, cost_today_usd=0.0)
        assert result.decision.value == "deny", (
            f"Expected DENY for scraper request_user_input, got {result.decision}: {result.reason}"
        )

    def test_policy_cascade_allows_orchestrator_request_user_input(self) -> None:
        """HITL-08d: Full policy cascade allows request_user_input for orchestrator.

        Spec: Orchestrator policy allows request_user_input, and the global
        policy does not block it. The cascade should result in ALLOW.
        """
        from gateway.policy import PolicyEngine, PolicyLoader, PolicyDecision
        from kubex_common.schemas.actions import ActionRequest, ActionType, RequestContext

        policy_root = os.environ.get("KUBEX_POLICY_ROOT", _ROOT)
        loader = PolicyLoader(policy_root=policy_root)
        loader.load_all()
        engine = PolicyEngine(loader)

        request = ActionRequest(
            request_id="req-hitl-orch",
            agent_id=ORCHESTRATOR_ID,
            action=ActionType.REQUEST_USER_INPUT,
            parameters={"question": "Approve?"},
            context=RequestContext(task_id="t-orch", chain_depth=1),
        )

        result = engine.evaluate(request, token_count_so_far=0, cost_today_usd=0.0)
        assert result.decision == PolicyDecision.ALLOW, (
            f"Expected ALLOW for orchestrator request_user_input, got {result.decision}: {result.reason}"
        )
