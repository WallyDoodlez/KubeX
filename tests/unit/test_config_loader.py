"""Unit tests for AgentConfig / load_agent_config (Phase 5 — BASE-02, BASE-04).

Covers:
- BASE-02: Config-driven boot — agents read identity, model, skills, and
  capabilities from /app/config.yaml rather than environment variables alone.
- BASE-04: Harness mode routing — config.yaml specifies harness_mode
  (standalone | openclaw) and the loader returns the correct mode.

All tests use pytest.importorskip() so they SKIP cleanly when the feature
module (kubex_harness.config_loader) does not exist yet (plan 05-01 = red
tests only; implementation lands in 05-02).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
import yaml

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "agents/_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Implementation guard — skip until config_loader module exists.
# ---------------------------------------------------------------------------
config_loader_mod = pytest.importorskip(
    "kubex_harness.config_loader",
    reason="BASE-02/BASE-04: config_loader not yet implemented (plan 05-02)",
)

load_agent_config = config_loader_mod.load_agent_config
AgentConfig = config_loader_mod.AgentConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_config(path: Path, data: dict) -> str:
    """Write a YAML config file and return the path as string."""
    path.write_text(yaml.dump(data), encoding="utf-8")
    return str(path)


MINIMAL_CONFIG: dict = {
    "agent": {
        "id": "instagram-scraper",
        "model": "gpt-4o",
        "skills": ["web-scraping"],
        "capabilities": ["scrape_profiles"],
        "harness_mode": "standalone",
    }
}

OPENCLAW_CONFIG: dict = {
    "agent": {
        "id": "orchestrator",
        "model": "gpt-4o",
        "skills": [],
        "capabilities": ["orchestrate"],
        "harness_mode": "openclaw",
    }
}


# ---------------------------------------------------------------------------
# Tests — YAML loading (BASE-02)
# ---------------------------------------------------------------------------


class TestConfigLoading:
    """load_agent_config reads agent identity, model, skills, and capabilities from YAML."""

    def test_loads_config_from_yaml(self, tmp_path: Path) -> None:
        """Config loaded from YAML returns correct model, skills, capabilities."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        config = load_agent_config(config_path)
        assert isinstance(config, AgentConfig)
        assert config.model == "gpt-4o"
        assert "web-scraping" in config.skills
        assert "scrape_profiles" in config.capabilities

    def test_agent_id_loaded_from_yaml(self, tmp_path: Path) -> None:
        """agent.id is populated from the YAML file."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        config = load_agent_config(config_path)
        assert config.agent_id == "instagram-scraper"

    def test_skills_loaded_from_config(self, tmp_path: Path) -> None:
        """Config with 2 skill names returns AgentConfig with both skills."""
        data = {
            "agent": {
                "id": "worker",
                "model": "gpt-4o",
                "skills": ["web-scraping", "recall"],
                "capabilities": [],
                "harness_mode": "standalone",
            }
        }
        config_path = write_config(tmp_path / "config.yaml", data)
        config = load_agent_config(config_path)
        assert "web-scraping" in config.skills
        assert "recall" in config.skills
        assert len(config.skills) == 2


# ---------------------------------------------------------------------------
# Tests — env var override (BASE-02)
# ---------------------------------------------------------------------------


class TestEnvVarOverride:
    """config.yaml is the sole source of truth — env vars do NOT override."""

    def test_env_vars_do_not_override_config(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """KUBEX_MODEL env var is ignored — model comes from config.yaml only."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        monkeypatch.setenv("KUBEX_MODEL", "gpt-3.5-turbo")
        config = load_agent_config(config_path)
        # Model must come from config.yaml, not the env var
        assert config.model == "gpt-4o"

    def test_env_var_capabilities_do_not_override(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """KUBEX_CAPABILITIES env var is ignored — capabilities come from config.yaml only."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        monkeypatch.setenv("KUBEX_CAPABILITIES", "cap_a,cap_b")
        config = load_agent_config(config_path)
        # Capabilities must come from config.yaml, not env vars
        assert "cap_a" not in config.capabilities
        assert "scrape_profiles" in config.capabilities


# ---------------------------------------------------------------------------
# Tests — fallback to env vars (backward compatibility, BASE-02)
# ---------------------------------------------------------------------------


class TestEnvVarFallback:
    """When config.yaml does not exist, load_agent_config fails fast (no env var fallback)."""

    def test_missing_config_raises_value_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """With a nonexistent config path, load_agent_config raises ValueError immediately.

        No fallback to env vars — config.yaml is the sole source of truth.
        """
        monkeypatch.setenv("KUBEX_AGENT_ID", "env-agent")
        monkeypatch.setenv("KUBEX_MODEL", "gpt-4o-mini")
        monkeypatch.setenv("GATEWAY_URL", "http://gateway:8080")
        with pytest.raises(ValueError, match="config"):
            load_agent_config("/nonexistent/config.yaml")

    def test_missing_config_raises_regardless_of_env(self) -> None:
        """Missing config.yaml always raises ValueError, even with no env vars set."""
        with pytest.raises(ValueError, match="config"):
            load_agent_config("/nonexistent/config.yaml")

    def test_missing_agent_id_raises(self, tmp_path: Path) -> None:
        """Config file with no agent.id field raises ValueError.

        agent.id is a required field — absence must be caught at load time, not silently
        defaulted to an empty string.
        """
        config_path = write_config(tmp_path / "config.yaml", {"agent": {"model": "gpt-4o"}})
        with pytest.raises(ValueError, match="agent.id"):
            load_agent_config(config_path)


# ---------------------------------------------------------------------------
# Tests — harness mode routing (BASE-04)
# ---------------------------------------------------------------------------


class TestHarnessModeRouting:
    """Config specifies harness_mode: standalone or openclaw."""

    def test_routes_to_standalone_mode(self, tmp_path: Path) -> None:
        """harness_mode: standalone in config returns standalone in AgentConfig."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        config = load_agent_config(config_path)
        assert config.harness_mode == "standalone"

    def test_routes_to_openclaw_mode(self, tmp_path: Path) -> None:
        """harness_mode: openclaw in config returns openclaw in AgentConfig."""
        config_path = write_config(tmp_path / "config.yaml", OPENCLAW_CONFIG)
        config = load_agent_config(config_path)
        assert config.harness_mode == "openclaw"

    def test_default_harness_mode_when_not_specified(self, tmp_path: Path) -> None:
        """If harness_mode is absent, a sensible default (standalone) is used."""
        data = {
            "agent": {
                "id": "worker",
                "model": "gpt-4o",
                "skills": [],
                "capabilities": [],
                # no harness_mode key
            }
        }
        config_path = write_config(tmp_path / "config.yaml", data)
        config = load_agent_config(config_path)
        # standalone is the safe default
        assert config.harness_mode in ("standalone", "openclaw")


# ---------------------------------------------------------------------------
# Tests — description and boundary fields (MCP-05)
# ---------------------------------------------------------------------------


class TestDescriptionAndBoundaryFields:
    """AgentConfig has description and boundary fields populated from config.yaml."""

    def test_description_field_default_is_empty_string(self) -> None:
        """AgentConfig with no description argument defaults description to empty string."""
        config = AgentConfig(agent_id="test-agent")
        assert config.description == ""

    def test_description_field_set_explicitly(self) -> None:
        """AgentConfig with description set to 'test desc' has config.description == 'test desc'."""
        config = AgentConfig(agent_id="test-agent", description="test desc")
        assert config.description == "test desc"

    def test_boundary_field_default_is_default(self) -> None:
        """AgentConfig with no boundary argument defaults to 'default'."""
        config = AgentConfig(agent_id="test-agent")
        assert config.boundary == "default"

    def test_boundary_field_set_explicitly(self) -> None:
        """AgentConfig with boundary set to 'secure' has config.boundary == 'secure'."""
        config = AgentConfig(agent_id="test-agent", boundary="secure")
        assert config.boundary == "secure"

    def test_load_agent_config_parses_description(self, tmp_path: Path) -> None:
        """load_agent_config() with YAML containing description returns config with that description."""
        data = {
            "agent": {
                "id": "my-agent",
                "description": "My agent",
                "model": "gpt-5.2",
                "skills": [],
                "capabilities": [],
            }
        }
        config_path = write_config(tmp_path / "config.yaml", data)
        config = load_agent_config(config_path)
        assert config.description == "My agent"

    def test_load_agent_config_parses_boundary(self, tmp_path: Path) -> None:
        """load_agent_config() with YAML containing boundary returns config with that boundary."""
        data = {
            "agent": {
                "id": "my-agent",
                "boundary": "restricted",
                "model": "gpt-5.2",
                "skills": [],
                "capabilities": [],
            }
        }
        config_path = write_config(tmp_path / "config.yaml", data)
        config = load_agent_config(config_path)
        assert config.boundary == "restricted"

    def test_load_agent_config_description_defaults_to_empty(self, tmp_path: Path) -> None:
        """load_agent_config() with no description in YAML returns config with description == ''."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        config = load_agent_config(config_path)
        assert config.description == ""

    def test_load_agent_config_boundary_defaults_to_default(self, tmp_path: Path) -> None:
        """load_agent_config() with no boundary in YAML returns config with boundary == 'default'."""
        data = {
            "agent": {
                "id": "worker",
                "model": "gpt-4o",
                "skills": [],
                "capabilities": [],
                # no boundary key
            }
        }
        config_path = write_config(tmp_path / "config.yaml", data)
        config = load_agent_config(config_path)
        assert config.boundary == "default"
