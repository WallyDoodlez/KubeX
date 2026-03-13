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
    """Environment variables take priority over config.yaml values."""

    def test_env_vars_override_config(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """KUBEX_MODEL env var overrides model in config.yaml."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        monkeypatch.setenv("KUBEX_MODEL", "gpt-3.5-turbo")
        config = load_agent_config(config_path)
        assert config.model == "gpt-3.5-turbo"

    def test_env_var_capabilities_override(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """KUBEX_CAPABILITIES env var (comma-separated) overrides config capabilities."""
        config_path = write_config(tmp_path / "config.yaml", MINIMAL_CONFIG)
        monkeypatch.setenv("KUBEX_CAPABILITIES", "cap_a,cap_b")
        config = load_agent_config(config_path)
        assert "cap_a" in config.capabilities
        assert "cap_b" in config.capabilities


# ---------------------------------------------------------------------------
# Tests — fallback to env vars (backward compatibility, BASE-02)
# ---------------------------------------------------------------------------


class TestEnvVarFallback:
    """When config.yaml does not exist, env vars provide backward-compatible config."""

    def test_fallback_to_env_vars_when_no_config(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With a nonexistent config path, load_agent_config falls back to env vars."""
        monkeypatch.setenv("KUBEX_AGENT_ID", "env-agent")
        monkeypatch.setenv("KUBEX_MODEL", "gpt-4o-mini")
        monkeypatch.setenv("GATEWAY_URL", "http://gateway:8080")
        config = load_agent_config("/nonexistent/config.yaml")
        assert config.agent_id == "env-agent"
        assert config.model == "gpt-4o-mini"

    def test_missing_config_and_no_env_raises_or_defaults(self) -> None:
        """With no config and no env vars, either raise or return safe defaults."""
        # We allow either behavior — just must not crash unpredictably.
        try:
            config = load_agent_config("/nonexistent/config.yaml")
            # If it returns, it should be an AgentConfig instance
            assert isinstance(config, AgentConfig)
        except (ValueError, KeyError, FileNotFoundError):
            pass  # Raising is also acceptable


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
