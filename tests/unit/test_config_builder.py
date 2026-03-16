"""Unit tests for ConfigBuilder (Phase 6 — KMGR-02).

ConfigBuilder assembles the final agent config.yaml from:
  - An agent config dict (identity, model, resources, policy, overrides)
  - A ComposedSkillSet from SkillResolver
  - Validated skill directories on disk

All tests in this file SKIP when the `kubex_manager.config_builder` module
does not yet exist (plan 06-01 = red tests only; implementation lands in 06-02).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common"))

# ---------------------------------------------------------------------------
# Implementation guard — skip entire module until config_builder exists.
# ---------------------------------------------------------------------------
config_builder_mod = pytest.importorskip(
    "kubex_manager.config_builder",
    reason="KMGR-02: config_builder not yet implemented (plan 06-02)",
)

ConfigBuilder = config_builder_mod.ConfigBuilder
ConfigBuildError = config_builder_mod.ConfigBuildError


# ---------------------------------------------------------------------------
# Helpers & fixtures
# ---------------------------------------------------------------------------

def make_composed(
    capabilities: list[str] | None = None,
    pip_deps: list[str] | None = None,
    system_deps: list[str] | None = None,
    egress_domains: list[str] | None = None,
    tools: dict | None = None,
    ordered_skill_names: list[str] | None = None,
    version_conflicts: list[str] | None = None,
) -> Any:
    """Create a minimal ComposedSkillSet-like object for testing."""
    try:
        from kubex_manager.skill_resolver import ComposedSkillSet
        return ComposedSkillSet(
            capabilities=capabilities or [],
            pip_deps=pip_deps or [],
            system_deps=system_deps or [],
            egress_domains=egress_domains or [],
            tools=tools or {},
            ordered_skill_names=ordered_skill_names or [],
            version_conflicts=version_conflicts or [],
        )
    except ImportError:
        # Fallback: plain object for when skill_resolver is also missing
        class _Composed:
            pass
        obj = _Composed()
        obj.capabilities = capabilities or []
        obj.pip_deps = pip_deps or []
        obj.system_deps = system_deps or []
        obj.egress_domains = egress_domains or []
        obj.tools = tools or {}
        obj.ordered_skill_names = ordered_skill_names or []
        obj.version_conflicts = version_conflicts or []
        return obj


def write_skill_tool(skill_dir: Path, skill_name: str, tool_name: str) -> None:
    """Write a minimal tool .py file to a skill's tools/ directory."""
    tools_dir = skill_dir / skill_name / "tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    (tools_dir / f"{tool_name}.py").write_text(
        f"def {tool_name}(**kwargs): pass\n", encoding="utf-8"
    )


MINIMAL_AGENT_CONFIG: dict[str, Any] = {
    "agent": {
        "id": "test-agent",
        "boundary": "test-boundary",
    },
    "model": {
        "provider": "openai",
        "name": "gpt-4o",
    },
    "skills": ["web-scraping"],
}


# ---------------------------------------------------------------------------
# Tests — ConfigBuilder (KMGR-02)
# ---------------------------------------------------------------------------


class TestConfigBuilder:
    """ConfigBuilder assembles config.yaml from agent config + ComposedSkillSet."""

    def test_build_produces_valid_config_yaml(self, tmp_path: Path) -> None:
        """ConfigBuilder.build() returns Path to a written config.yaml with correct structure."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        composed = make_composed(
            capabilities=["scrape_web"],
            pip_deps=["requests>=2.31"],
            egress_domains=["instagram.com"],
            ordered_skill_names=["web-scraping"],
        )

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=MINIMAL_AGENT_CONFIG,
            composed=composed,
            skill_dir=skill_dir,
            output_dir=output_dir,
        )

        assert isinstance(config_path, Path)
        assert config_path.exists()
        content = yaml.safe_load(config_path.read_text())
        assert isinstance(content, dict)

    def test_build_merges_capabilities_from_skills(self, tmp_path: Path) -> None:
        """Capabilities in output config are the union from ComposedSkillSet."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        composed = make_composed(
            capabilities=["scrape_web", "recall_memory"],
            ordered_skill_names=["web-scraping", "recall"],
        )

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=MINIMAL_AGENT_CONFIG,
            composed=composed,
            skill_dir=skill_dir,
            output_dir=output_dir,
        )

        content = yaml.safe_load(config_path.read_text())
        # Capabilities should come from composed skill set
        caps = content.get("agent", {}).get("capabilities", content.get("capabilities", []))
        assert "scrape_web" in caps
        assert "recall_memory" in caps

    def test_build_model_from_agent_config_not_skills(self, tmp_path: Path) -> None:
        """Output config uses model from agent_config; skills do not override model choice."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        agent_config = {
            **MINIMAL_AGENT_CONFIG,
            "model": {"provider": "anthropic", "name": "claude-3-opus"},
        }
        composed = make_composed(ordered_skill_names=["web-scraping"])

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=agent_config,
            composed=composed,
            skill_dir=skill_dir,
            output_dir=output_dir,
        )

        content = yaml.safe_load(config_path.read_text())
        model = content.get("model", {})
        assert model.get("provider") == "anthropic"
        assert model.get("name") == "claude-3-opus"

    def test_build_tools_namespaced(self, tmp_path: Path) -> None:
        """Tools in output config use '{skill}.{tool}' naming convention."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        # Create tool file on disk so ConfigBuilder doesn't raise
        write_skill_tool(skill_dir, "web-scraping", "scrape_profile")

        from kubex_manager.skill_resolver import SkillTool
        composed = make_composed(
            tools={"web-scraping.scrape_profile": SkillTool(
                name="scrape_profile",
                description="Scrape a profile page",
            )},
            ordered_skill_names=["web-scraping"],
        )

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=MINIMAL_AGENT_CONFIG,
            composed=composed,
            skill_dir=skill_dir,
            output_dir=output_dir,
        )

        content = yaml.safe_load(config_path.read_text())
        tools = content.get("tools", {})
        assert "web-scraping.scrape_profile" in tools

    def test_build_raises_on_missing_tool_file(self, tmp_path: Path) -> None:
        """ConfigBuilder raises ConfigBuildError when a declared tool has no .py file."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        # Do NOT create the tool file — this should trigger an error
        try:
            from kubex_manager.skill_resolver import SkillTool
            tool_obj = SkillTool(name="missing_tool", description="No file on disk")
        except ImportError:
            class _Tool:
                name = "missing_tool"
                description = "No file on disk"
            tool_obj = _Tool()

        composed = make_composed(
            tools={"web-scraping.missing_tool": tool_obj},
            ordered_skill_names=["web-scraping"],
        )

        builder = ConfigBuilder()
        with pytest.raises(ConfigBuildError, match="tool"):
            builder.build(
                agent_config=MINIMAL_AGENT_CONFIG,
                composed=composed,
                skill_dir=skill_dir,
                output_dir=output_dir,
            )

    def test_build_raises_on_conflict(self, tmp_path: Path) -> None:
        """ConfigBuilder raises ConfigBuildError when egress domain conflicts are detected."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        # Simulate a composed set that has version conflicts (blocking conflicts)
        composed = make_composed(
            version_conflicts=["requests==2.31.0 vs requests==2.28.0"],
            ordered_skill_names=["skill-a", "skill-b"],
        )

        builder = ConfigBuilder()
        with pytest.raises(ConfigBuildError):
            builder.build(
                agent_config=MINIMAL_AGENT_CONFIG,
                composed=composed,
                skill_dir=skill_dir,
                output_dir=output_dir,
            )

    def test_build_applies_agent_overrides(self, tmp_path: Path) -> None:
        """agent_config['overrides'] are applied last, overriding skill contributions."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        agent_config = {
            **MINIMAL_AGENT_CONFIG,
            "overrides": {
                "egress_domains": ["custom-override.com"],
            },
        }
        composed = make_composed(
            egress_domains=["instagram.com"],
            ordered_skill_names=["web-scraping"],
        )

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=agent_config,
            composed=composed,
            skill_dir=skill_dir,
            output_dir=output_dir,
        )

        content = yaml.safe_load(config_path.read_text())
        # The overrides must be visible in the output
        egress = content.get("egress_domains", content.get("egress", {}).get("domains", []))
        assert "custom-override.com" in egress

    def test_build_writes_to_persistent_dir(self, tmp_path: Path) -> None:
        """Output config.yaml is written to output_dir/{agent_id}.yaml (persistent path)."""
        skill_dir = tmp_path / "skills"
        skill_dir.mkdir()
        output_dir = tmp_path / "configs"
        output_dir.mkdir()

        composed = make_composed(ordered_skill_names=["web-scraping"])

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=MINIMAL_AGENT_CONFIG,
            composed=composed,
            skill_dir=skill_dir,
            output_dir=output_dir,
        )

        # File must be inside output_dir
        assert str(config_path).startswith(str(output_dir))
        # File name must contain agent_id
        assert "test-agent" in config_path.name
