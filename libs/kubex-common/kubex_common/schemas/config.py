"""Configuration models for agents, skills, and boundaries."""

from __future__ import annotations

from pydantic import BaseModel, Field


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


class SkillManifest(BaseModel):
    """Skill manifest (loaded from skill.yaml)."""

    name: str
    version: str = "0.1.0"
    description: str = ""
    category: str = ""
    capabilities: list[str] = Field(default_factory=list)
    actions_required: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list, description="Tool definition file names")
    system_prompt_section: str = ""
    egress_domains: list[str] = Field(default_factory=list)
    resource_requirements: dict[str, str] = Field(default_factory=dict)


class BoundaryConfig(BaseModel):
    """Boundary configuration (loaded from boundaries/*.yaml)."""

    id: str
    display_name: str = ""
    description: str = ""
    agents: list[str] = Field(default_factory=list)
    max_agents: int = 10
    shared_knowledge: bool = True
    cross_agent_comms: bool = True
