"""Configuration models for agents, skills, and boundaries."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ModelTier(BaseModel):
    """A model in an agent's allowlist."""

    id: str
    tier: str = "light"
    provider: str | None = None
    cost_per_1k_tokens: float | None = None


class ModelAllowlist(BaseModel):
    """Model configuration for a Kubex."""

    allowed: list[ModelTier] = Field(default_factory=list)
    default: str = "claude-haiku-4-5"
    max_tokens_per_request: int = 4096
    max_tokens_per_task: int = 50000


class EgressRule(BaseModel):
    """Egress allowlist entry."""

    domain: str
    methods: list[str] = Field(default_factory=lambda: ["GET"])
    blocked_paths: list[str] = Field(default_factory=list)


class RateLimitConfig(BaseModel):
    """Rate limit for an action type."""

    action: str
    limit: int
    window: str = "1m"


class AgentPolicy(BaseModel):
    """Per-agent policy configuration."""

    allowed_actions: list[str] = Field(default_factory=list)
    blocked_actions: list[str] = Field(default_factory=list)
    rate_limits: dict[str, str] = Field(default_factory=dict, description="action -> 'N/window' e.g. '100/task'")
    egress_mode: str = "deny_all"
    egress_allowed: list[EgressRule] = Field(default_factory=list)


class BudgetConfig(BaseModel):
    """Budget limits for a Kubex."""

    per_task_token_limit: int = 50000
    daily_cost_limit_usd: float = 5.00


class AgentConfig(BaseModel):
    """Full agent configuration (loaded from config.yaml)."""

    id: str
    boundary: str = "default"
    prompt: str = ""
    skills: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list, description="Auto-derived from skills — do not set manually")
    models: ModelAllowlist = Field(default_factory=ModelAllowlist)
    policy: AgentPolicy = Field(default_factory=AgentPolicy)
    budget: BudgetConfig = Field(default_factory=BudgetConfig)
    providers: list[str] = Field(default_factory=list, description="Required LLM providers (e.g., ['anthropic'])")


# ---------------------------------------------------------------------------
# Skill schema — Phase 5 new schema (BASE-01, SKIL-01)
# ---------------------------------------------------------------------------


class SkillDependencies(BaseModel):
    """Dependencies required by a skill."""

    pip: list[str] = Field(default_factory=list)
    system: list[str] = Field(default_factory=list)


class SkillTool(BaseModel):
    """A tool exposed by a skill."""

    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)


class ValidationStamp(BaseModel):
    """Stamp applied to a skill after it passes validation."""

    content_hash: str
    validated_at: str
    validator_version: str
    verdict: str


class SkillManifest(BaseModel):
    """Skill manifest (loaded from skill.yaml / manifest.yaml).

    Phase 5 rewrite: removed legacy fields (actions_required, resource_requirements,
    system_prompt_section). Added SkillDependencies, SkillTool, ValidationStamp.
    extra='forbid' rejects any unknown / legacy fields at parse time.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    version: str = "0.1.0"
    description: str = ""
    category: str = ""
    capabilities: list[str] = Field(default_factory=list)
    tools: list[SkillTool] = Field(default_factory=list)
    dependencies: SkillDependencies = Field(default_factory=SkillDependencies)
    egress_domains: list[str] = Field(default_factory=list)
    validation_stamp: ValidationStamp | None = None


class BoundaryConfig(BaseModel):
    """Boundary configuration (loaded from boundaries/*.yaml)."""

    id: str
    display_name: str = ""
    description: str = ""
    agents: list[str] = Field(default_factory=list)
    max_agents: int = 10
    shared_knowledge: bool = True
    cross_agent_comms: bool = True
