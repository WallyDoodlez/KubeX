"""Layer 4: Contract Tests — schema round-trips and policy file validation.

Covers:
  4.1 Schema Contract Tests (CT-SCH-01 to CT-SCH-06)
  4.2 Policy File Contract Tests (CT-POL-01 to CT-POL-12)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
import yaml

# Add libs to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../libs/kubex-common"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/registry"))


# ─────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────

PROJECT_ROOT = Path(os.path.dirname(__file__)).parent.parent
POLICIES_DIR = PROJECT_ROOT / "policies"
AGENTS_DIR = PROJECT_ROOT / "agents"


def get_all_policy_files() -> list[Path]:
    """Collect all *.yaml policy files from policies/ and agents/*/policies/."""
    files: list[Path] = []
    global_yaml = POLICIES_DIR / "global.yaml"
    if global_yaml.exists():
        files.append(global_yaml)
    if AGENTS_DIR.exists():
        for agent_dir in AGENTS_DIR.iterdir():
            if agent_dir.is_dir() and not agent_dir.name.startswith("_"):
                policy_file = agent_dir / "policies" / "policy.yaml"
                if policy_file.exists():
                    files.append(policy_file)
    return files


# ─────────────────────────────────────────────
# 4.1 Schema Contract Tests
# ─────────────────────────────────────────────


class TestSchemaContracts:
    def test_action_request_serializes_to_valid_json(self) -> None:
        """CT-SCH-01: ActionRequest round-trips through JSON serialization."""
        from kubex_common.schemas.actions import ActionRequest, ActionType, RequestContext

        req = ActionRequest(
            request_id="req-contract-001",
            agent_id="orchestrator",
            action=ActionType.DISPATCH_TASK,
            target=None,
            context=RequestContext(task_id="task-abc", chain_depth=2),
        )

        # Serialize to JSON
        json_str = req.model_dump_json()
        assert isinstance(json_str, str)

        # Parse raw JSON
        data = json.loads(json_str)
        assert data["request_id"] == "req-contract-001"
        assert data["agent_id"] == "orchestrator"
        assert data["action"] == "dispatch_task"
        assert data["context"]["task_id"] == "task-abc"
        assert data["context"]["chain_depth"] == 2

        # Deserialize back to model
        req2 = ActionRequest.model_validate(data)
        assert req2.request_id == req.request_id
        assert req2.action == ActionType.DISPATCH_TASK

    def test_task_delivery_matches_broker_publish_request(self) -> None:
        """CT-SCH-02: TaskDelivery serializes correctly for Broker publish."""
        from kubex_common.schemas.routing import TaskDelivery, Priority

        delivery = TaskDelivery(
            task_id="task-broker-001",
            workflow_id="wf-001",
            capability="scrape_profile",
            context_message="Scrape Nike Instagram profile",
            from_agent="orchestrator",
            priority=Priority.NORMAL,
        )

        data = delivery.model_dump()
        assert data["task_id"] == "task-broker-001"
        assert data["capability"] == "scrape_profile"
        assert data["from_agent"] == "orchestrator"
        assert data["priority"] == "normal"

        # Round-trip
        delivery2 = TaskDelivery.model_validate(data)
        assert delivery2.task_id == delivery.task_id
        assert delivery2.priority == Priority.NORMAL

    def test_agent_registration_json_schema_consistency(self) -> None:
        """CT-SCH-03: AgentRegistration serializes and deserializes consistently."""
        from registry.store import AgentRegistration, AgentStatus

        reg = AgentRegistration(
            agent_id="test-scraper",
            capabilities=["scrape_profile", "scrape_posts"],
            boundary="default",
            accepts_from=["orchestrator"],
            status=AgentStatus.RUNNING,
        )

        data = reg.model_dump()
        assert data["agent_id"] == "test-scraper"
        assert "scrape_profile" in data["capabilities"]
        assert data["status"] == "running"

        # Deserialize and check
        reg2 = AgentRegistration.model_validate(data)
        assert reg2.agent_id == reg.agent_id
        assert reg2.status == AgentStatus.RUNNING

    def test_gatekeeper_envelope_includes_all_required_sections(self) -> None:
        """CT-SCH-04: GatekeeperEnvelope has envelope_id, request, enrichment sections."""
        from kubex_common.schemas.actions import ActionRequest, ActionType
        from kubex_common.schemas.envelope import (
            GatekeeperEnvelope,
            EnvelopeEnrichment,
            EnvelopeEvaluation,
            Decision,
        )

        req = ActionRequest(
            request_id="req-env-001",
            agent_id="orchestrator",
            action=ActionType.REPORT_RESULT,
        )

        envelope = GatekeeperEnvelope(
            envelope_id="env-001",
            request=req,
            enrichment=EnvelopeEnrichment(boundary="production"),
        )

        data = envelope.model_dump()
        assert "envelope_id" in data
        assert "request" in data
        assert "enrichment" in data
        assert data["enrichment"]["boundary"] == "production"
        # evaluation is optional
        assert "evaluation" in data

    def test_error_response_schema_consistent_across_services(self) -> None:
        """CT-SCH-05: ErrorResponse has consistent fields (error, message, details, request_id)."""
        from kubex_common.errors import ErrorResponse

        err = ErrorResponse(
            error="PolicyDenied",
            message="Action blocked by global policy",
            details={"rule": "global.blocked_actions"},
            request_id="req-001",
        )

        data = err.model_dump()
        assert "error" in data
        assert "message" in data
        assert "details" in data
        assert "request_id" in data
        assert data["error"] == "PolicyDenied"

        # Minimal error response (no details or request_id)
        err_minimal = ErrorResponse(
            error="NotFound",
            message="Resource not found",
        )
        data2 = err_minimal.model_dump()
        assert data2["details"] is None
        assert data2["request_id"] is None

    def test_action_type_enum_values_match_policy_yaml_strings(self) -> None:
        """CT-SCH-06: ActionType enum values match the strings used in policy YAML files."""
        from kubex_common.schemas.actions import ActionType

        # Load the orchestrator policy
        policy_file = AGENTS_DIR / "orchestrator" / "policies" / "policy.yaml"
        assert policy_file.exists(), f"Policy file not found: {policy_file}"

        with open(policy_file) as f:
            data = yaml.safe_load(f)

        agent_policy = data.get("agent_policy", {})
        actions_data = agent_policy.get("actions", {})
        allowed_actions = actions_data.get("allowed", [])
        blocked_actions = actions_data.get("blocked", [])

        all_action_values = {at.value for at in ActionType}

        for action_str in allowed_actions + blocked_actions:
            assert action_str in all_action_values, (
                f"Policy action string '{action_str}' not found in ActionType enum. "
                f"Valid values: {sorted(all_action_values)}"
            )


# ─────────────────────────────────────────────
# 4.2 Policy File Contract Tests
# ─────────────────────────────────────────────


class TestPolicyFileContracts:
    def setup_method(self) -> None:
        self.all_policy_files = get_all_policy_files()

    def test_all_policy_files_are_valid_yaml(self) -> None:
        """CT-POL-01: All *.yaml policy files parse without error."""
        assert len(self.all_policy_files) > 0, "No policy files found"
        for policy_path in self.all_policy_files:
            with open(policy_path) as f:
                data = yaml.safe_load(f)
            assert data is not None, f"Policy file is empty: {policy_path}"
            assert isinstance(data, dict), f"Policy file is not a dict: {policy_path}"

    def test_global_policy_has_required_keys(self) -> None:
        """CT-POL-02: global.yaml has 'global' key with blocked_actions, max_chain_depth, budget."""
        global_policy_file = POLICIES_DIR / "global.yaml"
        assert global_policy_file.exists()

        with open(global_policy_file) as f:
            data = yaml.safe_load(f)

        assert "global" in data, "global.yaml must have 'global' top-level key"
        gd = data["global"]
        assert "blocked_actions" in gd, "global policy must have blocked_actions"
        assert "max_chain_depth" in gd, "global policy must have max_chain_depth"
        assert "budget" in gd, "global policy must have budget"

    def test_agent_policy_has_required_keys(self) -> None:
        """CT-POL-03: Each agent policy.yaml has agent_policy key with actions and egress."""
        agent_policy_files = [
            f for f in self.all_policy_files if "agents" in str(f)
        ]
        assert len(agent_policy_files) > 0, "No agent policy files found"

        for policy_path in agent_policy_files:
            with open(policy_path) as f:
                data = yaml.safe_load(f)
            assert "agent_policy" in data, f"Missing 'agent_policy' key in {policy_path}"
            ap = data["agent_policy"]
            assert "actions" in ap, f"Missing 'actions' key in {policy_path}"
            assert "egress" in ap, f"Missing 'egress' key in {policy_path}"

    def test_all_policy_action_strings_are_known_action_types(self) -> None:
        """CT-POL-04: All action strings in policy files match known ActionType enum values."""
        from kubex_common.schemas.actions import ActionType

        all_action_values = {at.value for at in ActionType}

        for policy_path in self.all_policy_files:
            with open(policy_path) as f:
                data = yaml.safe_load(f)

            # Check global policy
            if "global" in data:
                blocked = data["global"].get("blocked_actions", [])
                for action_str in blocked:
                    assert action_str in all_action_values, (
                        f"Unknown action '{action_str}' in global blocked_actions ({policy_path})"
                    )

            # Check agent policy
            if "agent_policy" in data:
                actions_data = data["agent_policy"].get("actions", {})
                for list_key in ("allowed", "blocked"):
                    for action_str in actions_data.get(list_key, []):
                        assert action_str in all_action_values, (
                            f"Unknown action '{action_str}' in agent.actions.{list_key} ({policy_path})"
                        )

    def test_scraper_policy_approve_expected_actions(self) -> None:
        """CT-POL-05: instagram-scraper allowed actions include http_get, write_output."""
        with open(AGENTS_DIR / "instagram-scraper" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        allowed = data["agent_policy"]["actions"]["allowed"]
        assert "http_get" in allowed
        assert "write_output" in allowed
        assert "report_result" in allowed

    def test_scraper_policy_deny_expected_actions(self) -> None:
        """CT-POL-06: instagram-scraper blocked actions include http_post, execute_code."""
        with open(AGENTS_DIR / "instagram-scraper" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        blocked = data["agent_policy"]["actions"]["blocked"]
        assert "http_post" in blocked
        assert "execute_code" in blocked
        assert "dispatch_task" in blocked

    def test_orchestrator_policy_approve_expected_actions(self) -> None:
        """CT-POL-07: orchestrator allowed actions include dispatch_task, cancel_task."""
        with open(AGENTS_DIR / "orchestrator" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        allowed = data["agent_policy"]["actions"]["allowed"]
        assert "dispatch_task" in allowed
        assert "cancel_task" in allowed
        assert "report_result" in allowed

    def test_orchestrator_policy_deny_expected_actions(self) -> None:
        """CT-POL-08: orchestrator blocked actions include http_get, execute_code."""
        with open(AGENTS_DIR / "orchestrator" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        blocked = data["agent_policy"]["actions"]["blocked"]
        assert "http_get" in blocked
        assert "execute_code" in blocked
        assert "send_email" in blocked

    def test_reviewer_policy_approve_expected_actions(self) -> None:
        """CT-POL-09: reviewer allowed actions include report_result only."""
        with open(AGENTS_DIR / "reviewer" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        allowed = data["agent_policy"]["actions"]["allowed"]
        assert "report_result" in allowed

    def test_reviewer_policy_deny_expected_actions(self) -> None:
        """CT-POL-10: reviewer blocked actions include http_get, dispatch_task, write_output."""
        with open(AGENTS_DIR / "reviewer" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        blocked = data["agent_policy"]["actions"]["blocked"]
        assert "http_get" in blocked
        assert "dispatch_task" in blocked
        assert "write_output" in blocked

    def test_knowledge_policy_approve_expected_actions(self) -> None:
        """CT-POL-11: knowledge agent allowed actions include query_knowledge, store_knowledge."""
        with open(AGENTS_DIR / "knowledge" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        allowed = data["agent_policy"]["actions"]["allowed"]
        assert "query_knowledge" in allowed
        assert "store_knowledge" in allowed
        assert "report_result" in allowed

    def test_knowledge_policy_deny_expected_actions(self) -> None:
        """CT-POL-12: knowledge agent blocked actions include http_get, dispatch_task."""
        with open(AGENTS_DIR / "knowledge" / "policies" / "policy.yaml") as f:
            data = yaml.safe_load(f)
        blocked = data["agent_policy"]["actions"]["blocked"]
        assert "http_get" in blocked
        assert "dispatch_task" in blocked
        assert "execute_code" in blocked
