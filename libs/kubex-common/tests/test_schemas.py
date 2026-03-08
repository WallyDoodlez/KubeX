"""Tests for kubex_common.schemas — Pydantic model validation."""

from datetime import datetime

import pytest

from kubex_common.schemas.actions import (
    ActionRequest,
    ActionResponse,
    ActionType,
    Priority,
    RequestContext,
    ResultStatus,
)
from kubex_common.schemas.config import AgentConfig, BoundaryConfig, ModelAllowlist, SkillManifest
from kubex_common.schemas.envelope import (
    ApprovalTier,
    Decision,
    EnvelopeEnrichment,
    EnvelopeEvaluation,
    GatekeeperEnvelope,
)
from kubex_common.schemas.events import ControlCommand, ControlMessage, LifecycleAction, LifecycleEvent, ProgressUpdate
from kubex_common.schemas.knowledge import EntityType, KnowledgeQueryParams, KnowledgeStoreParams, RelationshipType
from kubex_common.schemas.routing import BrokeredRequest, RoutedRequest, TaskDelivery


class TestActionRequest:
    def test_minimal(self) -> None:
        req = ActionRequest(
            request_id="ar-001",
            agent_id="test",
            action=ActionType.HTTP_GET,
        )
        assert req.action == ActionType.HTTP_GET
        assert req.priority == Priority.NORMAL
        assert req.target is None
        assert req.parameters == {}

    def test_full(self) -> None:
        req = ActionRequest(
            request_id="ar-002",
            agent_id="scraper",
            action=ActionType.HTTP_GET,
            target="https://instagram.com",
            parameters={"fields": "caption"},
            priority=Priority.HIGH,
            context=RequestContext(workflow_id="wf-1", task_id="t-1", chain_depth=2),
        )
        assert req.context.chain_depth == 2
        assert req.priority == Priority.HIGH

    def test_serialization_roundtrip(self) -> None:
        req = ActionRequest(
            request_id="ar-003",
            agent_id="test",
            action=ActionType.DISPATCH_TASK,
        )
        data = req.model_dump()
        restored = ActionRequest.model_validate(data)
        assert restored.request_id == req.request_id
        assert restored.action == req.action


class TestActionResponse:
    def test_success(self) -> None:
        resp = ActionResponse(
            status=ResultStatus.SUCCESS,
            task_id="t-1",
            result={"data": [1, 2, 3]},
        )
        assert resp.status == ResultStatus.SUCCESS
        assert resp.error is None

    def test_failure(self) -> None:
        resp = ActionResponse(
            status=ResultStatus.FAILURE,
            error="Connection refused",
        )
        assert resp.error == "Connection refused"

    def test_needs_clarification(self) -> None:
        resp = ActionResponse(
            status=ResultStatus.NEEDS_CLARIFICATION,
            question="Profile is private. Continue with public posts?",
        )
        assert resp.question is not None


class TestGatekeeperEnvelope:
    def test_create(self) -> None:
        req = ActionRequest(
            request_id="ar-001",
            agent_id="test",
            action=ActionType.HTTP_GET,
        )
        envelope = GatekeeperEnvelope(
            envelope_id="ge-001",
            request=req,
            enrichment=EnvelopeEnrichment(boundary="default"),
            evaluation=EnvelopeEvaluation(
                decision=Decision.ALLOW,
                tier=ApprovalTier.LOW,
                evaluated_by="policy_engine",
            ),
        )
        assert envelope.evaluation.decision == Decision.ALLOW


class TestRoutingModels:
    def test_task_delivery(self) -> None:
        td = TaskDelivery(
            task_id="task-001",
            capability="scrape_instagram",
            context_message="Scrape Nike",
            from_agent="orchestrator",
        )
        assert td.priority == Priority.NORMAL


class TestKnowledgeModels:
    def test_entity_types_count(self) -> None:
        assert len(EntityType) == 10

    def test_relationship_types_count(self) -> None:
        assert len(RelationshipType) == 12

    def test_query_params(self) -> None:
        params = KnowledgeQueryParams(query="Nike engagement")
        assert params.query == "Nike engagement"

    def test_store_params(self) -> None:
        params = KnowledgeStoreParams(
            content="Nike posts outperform",
            source_description="Nike engagement insight",
        )
        assert params.content is not None


class TestEventModels:
    def test_progress_update(self) -> None:
        pu = ProgressUpdate(
            task_id="t-1",
            agent_id="scraper",
            message="Scraping...",
        )
        assert pu.progress_pct is None

    def test_lifecycle_event(self) -> None:
        le = LifecycleEvent(
            agent_id="scraper",
            action=LifecycleAction.STARTED,
        )
        assert le.action == LifecycleAction.STARTED

    def test_control_message(self) -> None:
        cm = ControlMessage(
            agent_id="scraper",
            command=ControlCommand.CANCEL,
        )
        assert cm.command == ControlCommand.CANCEL


class TestActionTypeEnum:
    def test_all_action_types_are_strings(self) -> None:
        for action in ActionType:
            assert isinstance(action.value, str)

    def test_key_action_types_exist(self) -> None:
        assert ActionType.HTTP_GET
        assert ActionType.DISPATCH_TASK
        assert ActionType.QUERY_KNOWLEDGE
        assert ActionType.STORE_KNOWLEDGE
        assert ActionType.REPORT_RESULT
