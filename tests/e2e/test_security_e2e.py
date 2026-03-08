"""Wave 6 — Spec-Driven E2E Tests: Security Validation.

These tests encode the EXPECTED security behaviors of the KubexClaw platform:

  1. Kill switch — forcefully terminate any running Kubex container
  2. Identity spoofing prevention — agent_id from Docker labels, not request body
  3. Egress blocking — agents with deny_all egress cannot reach the internet
  4. Policy cascade — global → agent → egress, first-deny-wins
  5. KUBEX_STRICT_IDENTITY mode — reject requests when identity cannot be resolved

Tests are SKIPPED until Wave 6 security integration layer is implemented.

Security architecture spec refs:
  - docs/architecture.md   Security-first principles
  - docs/gateway.md        Identity model, policy cascade, egress enforcement
  - CLAUDE.md              Least privilege, prompt injection defence

Module paths exercised:
  services/gateway/gateway/main.py      (handle_action, cancel_task endpoints)
  services/gateway/gateway/identity.py  (IdentityResolver)
  services/gateway/gateway/policy.py    (PolicyEngine cascade)
  services/kubex-manager/kubex_manager/main.py  (kill endpoint)
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
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Implementation guard
# ---------------------------------------------------------------------------
_WAVE6_IMPLEMENTED = False
try:
    from security.integration import SecurityLayer  # type: ignore[import]
    _WAVE6_IMPLEMENTED = True
except ImportError:
    pass

_skip_wave6 = pytest.mark.skipif(
    not _WAVE6_IMPLEMENTED,
    reason=(
        "Wave 6 not yet implemented — "
        "security/integration.py missing (security validation layer)"
    ),
)

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

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


# ===========================================================================
# SEC-KILL: Kill Switch
# ===========================================================================


@_skip_wave6
class TestKillSwitch:
    """Spec: Kill switch immediately terminates any running Kubex container."""

    def setup_method(self) -> None:
        try:
            from kubex_manager.main import app as manager_app
            from fastapi.testclient import TestClient

            self.mock_docker = MagicMock()
            self.mock_container = MagicMock()
            self.mock_docker.containers.create.return_value = self.mock_container
            self.mock_docker.containers.get.return_value = self.mock_container
            self.mock_container.id = "abc123deadbeef"
            self.mock_container.status = "running"
            self.client = TestClient(manager_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_kill_switch_terminates_running_container(self, mock_docker_env: MagicMock) -> None:
        """SEC-KILL-01: POST /kubexes/{id}/kill forcefully terminates a running container.

        Spec: 'Kill switch — docker stop + secret file cleanup' (docs/agents.md)
        The kill switch must work even if the container is non-responsive.
        """
        mock_docker_env.return_value = self.mock_docker
        orchestrator_config = {
            "agent": {
                "id": ORCHESTRATOR_ID,
                "boundary": "platform",
                "prompt": "test",
                "skills": [],
                "models": {"allowed": [], "default": "claude-sonnet-4-6"},
                "providers": ["anthropic"],
            }
        }

        create_resp = self.client.post(
            "/kubexes",
            json={"config": orchestrator_config},
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert create_resp.status_code == 201
        kubex_id = create_resp.json()["kubex_id"]

        kill_resp = self.client.post(
            f"/kubexes/{kubex_id}/kill",
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert kill_resp.status_code == 200
        # Docker kill or stop must have been called
        assert self.mock_container.kill.called or self.mock_container.stop.called

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_kill_switch_deregisters_from_registry(
        self, mock_docker_env: MagicMock
    ) -> None:
        """SEC-KILL-02: Kill switch deregisters the agent from the Registry.

        Spec: 'Registry integration — deregister on kill'
        After kill, the agent must not appear in capability resolution.
        """
        mock_docker_env.return_value = self.mock_docker

        with patch("kubex_manager.lifecycle.httpx.AsyncClient") as mock_httpx:
            mock_response = MagicMock()
            mock_response.status_code = 204
            mock_httpx.return_value.__aenter__.return_value.delete = AsyncMock(
                return_value=mock_response
            )

            orchestrator_config = {
                "agent": {
                    "id": ORCHESTRATOR_ID,
                    "boundary": "platform",
                    "prompt": "test",
                    "skills": [],
                    "models": {"allowed": [], "default": "claude-sonnet-4-6"},
                    "providers": ["anthropic"],
                }
            }

            create_resp = self.client.post(
                "/kubexes",
                json={"config": orchestrator_config},
                headers={"Authorization": "Bearer kubex-mgmt-token"},
            )
            kubex_id = create_resp.json()["kubex_id"]

            kill_resp = self.client.post(
                f"/kubexes/{kubex_id}/kill",
                headers={"Authorization": "Bearer kubex-mgmt-token"},
            )
            assert kill_resp.status_code == 200

            # Registry DELETE must have been called
            delete_calls = mock_httpx.return_value.__aenter__.return_value.delete.call_args_list
            assert any("/agents/" in str(c) for c in delete_calls), (
                "Expected Registry DELETE call after kill"
            )

    def test_kill_switch_requires_management_auth(self) -> None:
        """SEC-KILL-03: Kill endpoint requires Bearer token auth — unauthenticated = 401.

        Spec: 'Bearer token auth for Management API' (docs/architecture.md)
        Kill must be protected; random HTTP callers must be rejected.
        """
        resp = self.client.post(
            "/kubexes/some-kubex-id/kill"
            # No Authorization header
        )
        assert resp.status_code == 401

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_kill_nonexistent_kubex_returns_404(self, mock_docker_env: MagicMock) -> None:
        """SEC-KILL-04: Killing a non-existent kubex_id returns 404.

        Spec: Prevent false-positive kill confirmations — if no container, say so.
        """
        mock_docker_env.return_value = self.mock_docker
        resp = self.client.post(
            "/kubexes/does-not-exist-ever/kill",
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert resp.status_code == 404


# ===========================================================================
# SEC-IDENTITY: Identity Spoofing Prevention
# ===========================================================================


@_skip_wave6
class TestIdentitySpoofingPrevention:
    """Spec: Gateway resolves agent_id from Docker labels — body-supplied ID is ignored."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gateway_app
            from gateway.identity import IdentityResolver
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.gateway_app = gateway_app
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_identity_overwritten_from_docker_labels(self) -> None:
        """SEC-IDENTITY-01: agent_id in ActionRequest body is overwritten by Docker label resolution.

        Spec: 'Identity resolution — Docker label kubex.agent_id (prevents spoofing)'
        A rogue agent claiming to be 'orchestrator' must be identified correctly.
        """
        mock_docker = MagicMock()
        mock_container = MagicMock()
        mock_container.attrs = {
            "NetworkSettings": {
                "Networks": {
                    "kubex-internal": {"IPAddress": "172.18.0.10"}
                }
            }
        }
        mock_container.labels = {
            "kubex.agent_id": SCRAPER_ID,
            "kubex.boundary": "data-collection",
        }
        mock_docker.containers.list.return_value = [mock_container]

        from gateway.identity import IdentityResolver
        resolver = IdentityResolver(docker_client=mock_docker)
        self.gateway_app.state.gateway_service.identity_resolver = resolver

        # Rogue agent claims to be orchestrator (which has more privileges)
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,  # Claimed identity — should be overwritten
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "go"},
        )

        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_resp = MagicMock()
            mock_resp.status_code = 202
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {"message_id": "1-0"}
            mock_httpx.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_resp
            )
            resp = self.client.post("/actions", json=body)

        # Scraper is not allowed to dispatch_task — policy should deny this
        # (because the real identity is SCRAPER_ID, which has dispatch_task blocked)
        assert resp.status_code == 403, (
            f"Expected 403 (scraper cannot dispatch_task), got {resp.status_code}: {resp.text}"
        )

    def test_strict_identity_mode_rejects_unresolvable_ip(self) -> None:
        """SEC-IDENTITY-02: KUBEX_STRICT_IDENTITY=true rejects requests when IP is unknown.

        Spec: 'In production, identity resolution failure is a hard failure'
        Enables zero-trust mode: every caller must be a known Kubex container.
        """
        import os

        mock_docker = MagicMock()
        mock_docker.containers.list.return_value = []  # No known containers

        from gateway.identity import IdentityResolver
        resolver = IdentityResolver(docker_client=mock_docker)
        self.gateway_app.state.gateway_service.identity_resolver = resolver

        original = os.environ.get("KUBEX_STRICT_IDENTITY")
        try:
            os.environ["KUBEX_STRICT_IDENTITY"] = "true"
            body = make_action_request(
                agent_id=ORCHESTRATOR_ID,
                action="report_result",
                parameters={"result": "done"},
            )
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 401, (
                f"Expected 401 in strict identity mode, got {resp.status_code}: {resp.text}"
            )
        finally:
            if original is None:
                os.environ.pop("KUBEX_STRICT_IDENTITY", None)
            else:
                os.environ["KUBEX_STRICT_IDENTITY"] = original

    def test_identity_cache_is_used_on_second_request(self) -> None:
        """SEC-IDENTITY-03: IdentityResolver caches resolved identities by IP.

        Spec: 'IP → (agent_id, boundary) cache with 30s TTL'
        Docker API should only be called once per IP per cache window.
        """
        mock_docker = MagicMock()
        mock_container = MagicMock()
        mock_container.attrs = {
            "NetworkSettings": {
                "Networks": {"kubex-internal": {"IPAddress": "172.18.0.20"}}
            }
        }
        mock_container.labels = {
            "kubex.agent_id": ORCHESTRATOR_ID,
            "kubex.boundary": "platform",
        }
        mock_docker.containers.list.return_value = [mock_container]

        from gateway.identity import IdentityResolver
        import asyncio

        resolver = IdentityResolver(docker_client=mock_docker)

        async def resolve_twice() -> tuple[str, str]:
            r1 = await resolver.resolve("172.18.0.20")
            r2 = await resolver.resolve("172.18.0.20")
            return r1, r2

        r1, r2 = asyncio.get_event_loop().run_until_complete(resolve_twice())
        assert r1 == r2 == (ORCHESTRATOR_ID, "platform")

        # Docker should have been called only once (second is from cache)
        assert mock_docker.containers.list.call_count == 1

    def test_identity_resolver_raises_for_unknown_ip(self) -> None:
        """SEC-IDENTITY-04: IdentityResolver raises IdentityResolutionError for unknown IP.

        Spec: Unknown IPs must not be granted any identity — fail closed.
        """
        from gateway.identity import IdentityResolver
        from kubex_common.errors import IdentityResolutionError
        import asyncio

        mock_docker = MagicMock()
        mock_docker.containers.list.return_value = []

        resolver = IdentityResolver(docker_client=mock_docker)

        with pytest.raises(IdentityResolutionError):
            asyncio.get_event_loop().run_until_complete(
                resolver.resolve("192.168.1.99")
            )


# ===========================================================================
# SEC-EGRESS: Egress Enforcement
# ===========================================================================


@_skip_wave6
class TestEgressEnforcement:
    """Spec: agents with deny_all egress cannot reach the internet; allowlist enforced."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_orchestrator_cannot_make_http_get_request(self) -> None:
        """SEC-EGRESS-01: Orchestrator (deny_all egress) is blocked from HTTP GET.

        Spec: Orchestrator policy has egress mode 'deny_all' and http_get in blocked actions.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="http_get",
            target="https://example.com/data",
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403, (
            f"Expected 403 for orchestrator HTTP GET, got {resp.status_code}: {resp.text}"
        )

    def test_scraper_can_access_instagram_domain(self) -> None:
        """SEC-EGRESS-02: Scraper agent can GET from allowlisted instagram domain.

        Spec: instagram-scraper policy allows 'graph.instagram.com' GET requests.
        """
        with patch("gateway.main.httpx.AsyncClient") as mock_httpx:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = json.dumps({"data": [{"id": "12345"}]})
            mock_resp.headers = {"content-type": "application/json"}
            mock_httpx.return_value.__aenter__.return_value.request = AsyncMock(
                return_value=mock_resp
            )

            body = make_action_request(
                agent_id=SCRAPER_ID,
                action="http_get",
                target="https://graph.instagram.com/v18.0/12345/media",
            )
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 200, (
                f"Expected 200 for scraper instagram access, got {resp.status_code}: {resp.text}"
            )

    def test_scraper_cannot_access_non_instagram_domain(self) -> None:
        """SEC-EGRESS-03: Scraper is blocked from accessing non-allowlisted domains.

        Spec: instagram-scraper allowlist only includes instagram domains.
        Access to arbitrary URLs must be denied (egress enforcement).
        """
        body = make_action_request(
            agent_id=SCRAPER_ID,
            action="http_get",
            target="https://api.example.com/exfiltrate",
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403, (
            f"Expected 403 for scraper non-instagram access, got {resp.status_code}: {resp.text}"
        )

    def test_scraper_cannot_access_blocked_instagram_path(self) -> None:
        """SEC-EGRESS-04: Scraper cannot access blocked paths on allowed domain.

        Spec: instagram-scraper policy blocks paths matching '*/accounts/*'.
        Login and account management pages must be inaccessible.
        """
        body = make_action_request(
            agent_id=SCRAPER_ID,
            action="http_get",
            target="https://instagram.com/accounts/login",
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403, (
            f"Expected 403 for blocked path, got {resp.status_code}: {resp.text}"
        )

    def test_scraper_cannot_post_to_instagram(self) -> None:
        """SEC-EGRESS-05: Scraper cannot POST to Instagram (read-only agent).

        Spec: instagram-scraper has http_post in blocked actions.
        A scraper agent must never be able to mutate remote data.
        """
        body = make_action_request(
            agent_id=SCRAPER_ID,
            action="http_post",
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403

    def test_knowledge_agent_cannot_make_any_http_request(self) -> None:
        """SEC-EGRESS-06: Knowledge agent (deny_all egress) cannot make HTTP requests.

        Spec: knowledge agent has egress mode 'deny_all' and http_get in blocked actions.
        Knowledge agent talks only to internal services via Gateway actions.
        """
        body = make_action_request(
            agent_id="knowledge",
            action="http_get",
            target="https://graph.instagram.com/v18.0/12345/media",
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403

    def test_reviewer_cannot_dispatch_tasks(self) -> None:
        """SEC-EGRESS-07: Reviewer agent cannot dispatch tasks (not in allowed actions).

        Spec: reviewer has a minimal action allowlist — only report_result.
        Preventing reviewers from spawning sub-tasks limits blast radius.
        """
        body = make_action_request(
            agent_id="reviewer",
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "go"},
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403


# ===========================================================================
# SEC-POLICY: Policy Cascade — Global Rules
# ===========================================================================


@_skip_wave6
class TestPolicyCascadeGlobalRules:
    """Spec: global policy applied before agent policy — first-deny-wins cascade."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_globally_blocked_action_denied_for_all_agents(self) -> None:
        """SEC-POLICY-01: activate_kubex is globally blocked for ALL agents.

        Spec: global.yaml blocks 'activate_kubex' — no agent may spawn containers directly.
        Only the Kubex Manager (management API) can do this.
        """
        for agent_id in [ORCHESTRATOR_ID, SCRAPER_ID, "knowledge", "reviewer"]:
            body = make_action_request(
                agent_id=agent_id,
                action="activate_kubex",
                parameters={"agent_id": "rogue-agent"},
            )
            resp = self.client.post("/actions", json=body)
            assert resp.status_code == 403, (
                f"Expected 403 for activate_kubex by {agent_id}, got {resp.status_code}"
            )

    def test_chain_depth_exceeded_is_denied(self) -> None:
        """SEC-POLICY-02: Requests with chain_depth > 5 are rejected globally.

        Spec: 'max_chain_depth: 5' in global.yaml — prevents infinite delegation loops.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "go"},
            chain_depth=6,  # Over the limit of 5
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403, (
            f"Expected 403 for chain_depth=6, got {resp.status_code}: {resp.text}"
        )

    @pytest.mark.parametrize("chain_depth", [1, 3, 5])
    def test_valid_chain_depths_are_accepted(self, chain_depth: int) -> None:
        """SEC-POLICY-03: Chain depths 1-5 are within the allowed range.

        Spec: Chain depth is checked for each hop — intermediate agents at depth 5
        can still report results.
        """
        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="report_result",
            parameters={"result": "done"},
            chain_depth=chain_depth,
        )
        resp = self.client.post("/actions", json=body)
        # Should not be denied for chain depth reason
        # (may succeed with 200 or fail for other policy reasons but not chain depth)
        if resp.status_code == 403:
            error_data = resp.json()
            rule = error_data.get("details", {}).get("rule", "")
            assert "chain_depth" not in rule, (
                f"chain_depth={chain_depth} should not trigger chain depth denial"
            )

    def test_daily_budget_exceeded_blocks_all_agents(self) -> None:
        """SEC-POLICY-04: When daily cost exceeds limit, all agents are blocked.

        Spec: global.budget.default_daily_cost_limit_usd = $10.00
        Budget exceeded → all requests denied regardless of agent or action.
        """
        import asyncio

        # Simulate an agent with $999 in daily spend in Redis
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set("budget:daily:orchestrator", "999.00")
        )

        body = make_action_request(
            agent_id=ORCHESTRATOR_ID,
            action="dispatch_task",
            parameters={"capability": "scrape_instagram", "context_message": "go"},
        )
        resp = self.client.post("/actions", json=body)
        assert resp.status_code == 403, (
            f"Expected 403 for budget exceeded, got {resp.status_code}: {resp.text}"
        )


# ===========================================================================
# SEC-CANCEL: Cancel Authorization
# ===========================================================================


@_skip_wave6
class TestCancelAuthorization:
    """Spec: only the originating agent can cancel a task it dispatched."""

    def setup_method(self) -> None:
        try:
            from gateway.main import app as gateway_app
            from fastapi.testclient import TestClient
            import fakeredis

            self.fake_server = fakeredis.FakeServer()
            self.fake_redis = fakeredis.FakeAsyncRedis(
                server=self.fake_server, decode_responses=True
            )
            gateway_app.state.gateway_service.redis_db1 = self.fake_redis
            self.client = TestClient(gateway_app, raise_server_exceptions=False)

        except ImportError as exc:
            pytest.skip(f"Required dependency missing: {exc}")

    def test_originator_can_cancel_own_task(self) -> None:
        """SEC-CANCEL-01: The agent that dispatched a task can cancel it.

        Spec: 'Only the originating agent can cancel a task'
        The originator's agent_id is stored in Redis on dispatch.
        """
        import asyncio

        task_id = f"task-{uuid.uuid4().hex[:12]}"
        # Register orchestrator as originator
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(f"task:originator:{task_id}", ORCHESTRATOR_ID, ex=86400)
        )

        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": ORCHESTRATOR_ID, "reason": "User requested"},
        )
        assert resp.status_code == 200, (
            f"Expected originator to cancel successfully, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert data.get("status") == "cancel_requested"
        assert data.get("task_id") == task_id

    def test_non_originator_cannot_cancel_task(self) -> None:
        """SEC-CANCEL-02: A non-originating agent is rejected when trying to cancel.

        Spec: 'Only the originating agent can cancel a task — others get 403'
        This prevents a rogue agent from cancelling another agent's work.
        """
        import asyncio

        task_id = f"task-{uuid.uuid4().hex[:12]}"
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(f"task:originator:{task_id}", ORCHESTRATOR_ID, ex=86400)
        )

        # Scraper tries to cancel orchestrator's task — should be denied
        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"agent_id": SCRAPER_ID, "reason": "Rogue cancel attempt"},
        )
        assert resp.status_code == 403, (
            f"Expected 403 for non-originator cancel, got {resp.status_code}: {resp.text}"
        )
        data = resp.json()
        assert "NotOriginator" in data.get("error", "") or "originator" in str(data).lower()

    def test_cancel_without_agent_id_returns_400(self) -> None:
        """SEC-CANCEL-03: Cancel request without agent_id field returns 400.

        Spec: Cancel request must identify the caller — anonymous cancel is rejected.
        """
        task_id = f"task-{uuid.uuid4().hex[:12]}"
        resp = self.client.post(
            f"/tasks/{task_id}/cancel",
            json={"reason": "No agent_id provided"},
        )
        assert resp.status_code == 400, (
            f"Expected 400 for missing agent_id, got {resp.status_code}"
        )

    def test_cancel_publishes_to_redis_control_channel(self) -> None:
        """SEC-CANCEL-04: Successful cancel publishes to Redis 'control:{agent_id}' channel.

        Spec: 'Gateway publishes cancel command to control:{agent_id} for harness'
        The harness listens on this channel and escalates abort on receipt.
        """
        import asyncio

        task_id = f"task-{uuid.uuid4().hex[:12]}"
        asyncio.get_event_loop().run_until_complete(
            self.fake_redis.set(f"task:originator:{task_id}", ORCHESTRATOR_ID, ex=86400)
        )

        # Subscribe to the control channel before issuing cancel
        async def listen_for_cancel() -> list[Any]:
            pubsub = self.fake_redis.pubsub()
            await pubsub.subscribe(f"control:{ORCHESTRATOR_ID}")

            # Issue cancel
            self.client.post(
                f"/tasks/{task_id}/cancel",
                json={"agent_id": ORCHESTRATOR_ID, "reason": "Test cancel"},
            )

            received = []
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    received.append(json.loads(msg["data"]))
                    break
            await pubsub.unsubscribe(f"control:{ORCHESTRATOR_ID}")
            return received

        received = asyncio.get_event_loop().run_until_complete(listen_for_cancel())
        assert len(received) >= 1
        cancel_msg = received[0]
        assert cancel_msg.get("command") == "cancel"
        assert cancel_msg.get("task_id") == task_id
