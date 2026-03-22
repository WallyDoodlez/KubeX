"""Agent configuration loader — reads config.yaml and fails fast if missing (BASE-02, BASE-04).

Provides ``load_agent_config()`` which reads ``/app/config.yaml`` and raises
``ValueError`` if the file is not found or the required ``agent.id`` field is
missing.  There are no environment variable overrides — ``config.yaml`` is the
sole source of truth for agent identity and routing.

Usage:
    from kubex_harness.config_loader import load_agent_config, AgentConfig

    config = load_agent_config("/app/config.yaml")
    print(config.agent_id, config.harness_mode)
"""

from __future__ import annotations

import logging
from typing import Any

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger("kubex_harness.config_loader")


# ---------------------------------------------------------------------------
# PolicyConfig and BudgetConfig — sub-models for AgentConfig (PROMPT-01)
# ---------------------------------------------------------------------------


class PolicyConfig(BaseModel):
    """Policy constraints for an agent, parsed from config.yaml agent.policy stanza.

    Fields:
        allowed_actions: List of Gateway action names this agent may perform.
        blocked_actions: List of Gateway action names explicitly denied.

    Actions not in either list are ESCALATED to the reviewer agent.
    """

    allowed_actions: list[str] = Field(default_factory=list)
    blocked_actions: list[str] = Field(default_factory=list)


class BudgetConfig(BaseModel):
    """Token and cost budget for an agent, parsed from config.yaml agent.budget stanza.

    Fields:
        per_task_token_limit: Maximum tokens allowed per task (0 = unconstrained).
        daily_cost_limit_usd: Maximum USD spend per day (0.0 = unconstrained).
    """

    per_task_token_limit: int = 0
    daily_cost_limit_usd: float = 0.0


# ---------------------------------------------------------------------------
# AgentConfig — harness-specific config model
# ---------------------------------------------------------------------------


class AgentConfig(BaseModel):
    """Harness agent configuration, loaded exclusively from config.yaml.

    Fields:
        agent_id:     Unique agent identifier (required — read from agent.id)
        model:        LLM model name to use (default: gpt-5.2)
        skills:       Ordered list of skill directory names to load
        capabilities: List of broker consumer group / capability names
        harness_mode: "standalone" (default) or "openclaw" or "mcp-bridge"
        runtime:      Runtime type for transport selection (D-13).
                      "openai-api" = in-memory transport (bridge and LLM share same process).
                      Any other value (e.g. "claude-code", "codex", "gemini-cli") = stdio
                      transport (CLI connects as MCP client). Default: "openai-api".
        gateway_url:  Gateway base URL (default: http://gateway:8080)
        broker_url:   Broker base URL (default: http://kubex-broker:8060)
        description:  Human-readable agent description for MCP tool metadata (MCP-05)
        boundary:     Policy boundary this agent belongs to (default: "default")
        policy:       Policy constraints parsed from config.yaml agent.policy stanza (PROMPT-01)
        budget:       Token/cost budget parsed from config.yaml agent.budget stanza (PROMPT-01)
    """

    agent_id: str = ""
    model: str = "gpt-5.2"
    skills: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    harness_mode: str = "standalone"
    runtime: str = "openai-api"  # Transport selection: "openai-api" = in-memory, anything else = stdio
    gateway_url: str = "http://gateway:8080"
    broker_url: str = "http://kubex-broker:8060"
    description: str = ""
    boundary: str = "default"
    policy: PolicyConfig = Field(default_factory=PolicyConfig)
    budget: BudgetConfig = Field(default_factory=BudgetConfig)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_agent_config(config_path: str = "/app/config.yaml") -> AgentConfig:
    """Load agent configuration from a YAML file.

    Reads ``config_path`` as YAML and parses the ``agent:`` stanza.
    No environment variable overrides are applied — config.yaml is the sole
    source of truth.  ``gateway_url`` and ``broker_url`` are read from the
    config file; if absent they use the built-in defaults from ``AgentConfig``.

    Args:
        config_path: Path to the config YAML file. Defaults to ``/app/config.yaml``.

    Returns:
        AgentConfig instance populated from the file.

    Raises:
        ValueError: If the config file is not found at ``config_path``.
        ValueError: If the config file is missing the required ``agent.id`` field.
    """
    # Step 1: read config file — fail fast if missing
    try:
        with open(config_path, encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
        logger.debug("Loaded agent config from %s", config_path)
    except FileNotFoundError:
        raise ValueError(f"Required config file not found: {config_path}") from None
    except Exception as exc:
        raise ValueError(f"Failed to read config file {config_path}: {exc}") from exc

    # Step 2: parse the agent: stanza
    file_data: dict[str, Any] = {}
    if isinstance(raw, dict):
        file_data = raw.get("agent", {}) or {}

    # Step 3: validate required fields
    agent_id = file_data.get("id", "")
    if not agent_id:
        raise ValueError("Config missing required field: agent.id")

    # Parse policy and budget stanzas — both are optional (hello-world has neither)
    policy_raw: dict[str, Any] = file_data.get("policy", {}) or {}
    budget_raw: dict[str, Any] = file_data.get("budget", {}) or {}

    return AgentConfig(
        agent_id=agent_id,
        model=file_data.get("model", "gpt-5.2"),
        skills=file_data.get("skills", []) or [],
        capabilities=file_data.get("capabilities", []) or [],
        harness_mode=file_data.get("harness_mode", "standalone"),
        runtime=file_data.get("runtime", "openai-api"),
        gateway_url=file_data.get("gateway_url", "http://gateway:8080"),
        broker_url=file_data.get("broker_url", "http://kubex-broker:8060"),
        description=file_data.get("description", ""),
        boundary=file_data.get("boundary", "default"),
        policy=PolicyConfig(**policy_raw) if policy_raw else PolicyConfig(),
        budget=BudgetConfig(**budget_raw) if budget_raw else BudgetConfig(),
    )
