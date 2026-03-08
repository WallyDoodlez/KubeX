"""Gateway envelope — wraps ActionRequest with infrastructure metadata."""

from __future__ import annotations

import enum
from datetime import datetime

from pydantic import BaseModel, Field

from .actions import ActionRequest


class Decision(str, enum.Enum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    ESCALATE = "ESCALATE"


class ApprovalTier(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EnvelopeEnrichment(BaseModel):
    """Infrastructure-populated metadata. Kubexes cannot set these."""

    boundary: str = "default"
    model_used: str | None = None
    model_tier: str | None = None
    token_count_so_far: int = 0
    cost_so_far_usd: float = 0.0
    agent_status: str = "available"
    agent_denial_rate_1h: float = 0.0


class EnvelopeEvaluation(BaseModel):
    """Policy evaluation result."""

    decision: Decision
    tier: ApprovalTier = ApprovalTier.LOW
    evaluated_by: str = "policy_engine"
    rule_matched: str | None = None
    latency_ms: float = 0.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    denial_reason: str | None = None


class GatekeeperEnvelope(BaseModel):
    """Wraps an ActionRequest with infrastructure enrichment and evaluation."""

    envelope_id: str
    request: ActionRequest
    enrichment: EnvelopeEnrichment = Field(default_factory=EnvelopeEnrichment)
    evaluation: EnvelopeEvaluation | None = None
