"""Agent configuration loader — reads config.yaml with env var fallback (BASE-02, BASE-04).

Provides ``load_agent_config()`` which tries to read ``/app/config.yaml`` first,
then falls back to environment variables for backward compatibility with containers
that don't have a config file mounted.

Priority (highest to lowest):
    1. Environment variables (always override file values when set)
    2. config.yaml file
    3. Built-in defaults

Usage:
    from kubex_harness.config_loader import load_agent_config, AgentConfig

    config = load_agent_config("/app/config.yaml")
    print(config.agent_id, config.harness_mode)
"""

from __future__ import annotations

import logging
import os
from typing import Any

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger("kubex_harness.config_loader")


# ---------------------------------------------------------------------------
# AgentConfig — harness-specific config model
# ---------------------------------------------------------------------------


class AgentConfig(BaseModel):
    """Harness agent configuration, loaded from config.yaml or env vars.

    Fields:
        agent_id:     Unique agent identifier (env: KUBEX_AGENT_ID)
        model:        LLM model name to use (env: KUBEX_MODEL)
        skills:       Ordered list of skill directory names to load
        capabilities: List of broker consumer group / capability names (env: KUBEX_CAPABILITIES)
        harness_mode: "standalone" (default) or "openclaw" (env: KUBEX_HARNESS_MODE)
        gateway_url:  Gateway base URL (env: GATEWAY_URL)
        broker_url:   Broker base URL (env: BROKER_URL)
    """

    agent_id: str = ""
    model: str = "gpt-5.2"
    skills: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    harness_mode: str = "standalone"
    gateway_url: str = "http://gateway:8080"
    broker_url: str = "http://broker:8060"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_agent_config(config_path: str = "/app/config.yaml") -> AgentConfig:
    """Load agent configuration from a YAML file with environment variable fallback.

    Steps:
    1. Try to read ``config_path`` as YAML.
    2. Parse the ``agent:`` stanza into base values.
    3. Override with any set environment variables.

    Args:
        config_path: Path to the config YAML file. Defaults to ``/app/config.yaml``.

    Returns:
        AgentConfig instance populated from file + env var overrides.

    Raises:
        ValueError: If no agent_id can be determined (neither file nor env var).
    """
    file_data: dict[str, Any] = {}
    file_found = False

    # Step 1: try to read config file
    try:
        with open(config_path, encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
        if isinstance(raw, dict):
            file_data = raw.get("agent", {}) or {}
            file_found = True
            logger.debug("Loaded agent config from %s", config_path)
    except FileNotFoundError:
        logger.debug("Config file not found: %s — falling back to env vars", config_path)
    except Exception as exc:
        logger.warning("Failed to read config file %s: %s", config_path, exc)

    # Step 2: build base config from file data
    config = AgentConfig(
        agent_id=file_data.get("id", ""),
        model=file_data.get("model", "gpt-5.2"),
        skills=file_data.get("skills", []) or [],
        capabilities=file_data.get("capabilities", []) or [],
        harness_mode=file_data.get("harness_mode", "standalone"),
        gateway_url=os.environ.get("GATEWAY_URL", "http://gateway:8080"),
        broker_url=os.environ.get("BROKER_URL", "http://broker:8060"),
    )

    # Step 3: apply env var overrides (always take priority)
    env_agent_id = os.environ.get("KUBEX_AGENT_ID")
    if env_agent_id:
        config.agent_id = env_agent_id

    env_model = os.environ.get("KUBEX_MODEL")
    if env_model:
        config.model = env_model

    env_capabilities = os.environ.get("KUBEX_CAPABILITIES")
    if env_capabilities:
        config.capabilities = [c.strip() for c in env_capabilities.split(",") if c.strip()]

    env_harness_mode = os.environ.get("KUBEX_HARNESS_MODE")
    if env_harness_mode:
        config.harness_mode = env_harness_mode

    # If no config file was found and no agent_id env var is set, fall back
    # to a permissive state (let caller raise if agent_id is required).
    if not file_found and not config.agent_id:
        logger.warning(
            "No config.yaml found at %s and KUBEX_AGENT_ID not set. " "Agent will not have a valid identity.",
            config_path,
        )

    return config
