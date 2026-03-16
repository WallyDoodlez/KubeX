"""Unit tests for SkillResolver and SkillManifest schema (Phase 5 — SKIL-01, SKIL-03).

Covers:
- SKIL-01: Skill schema validation — SkillManifest structure, rejection of
  legacy fields, version / dependency / tool typing.
- SKIL-03: Skill composition — union of capabilities/deps, tool namespacing,
  version conflict detection, ordering preservation.

All tests use pytest.importorskip() so they SKIP cleanly when the feature
modules (kubex_manager.skill_resolver, kubex_common.schemas.config) do not
exist yet (plan 05-01 = red tests only; implementation lands in 05-02).
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
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Implementation guard — skip until skill_resolver module exists.
# ---------------------------------------------------------------------------
skill_resolver_mod = pytest.importorskip(
    "kubex_manager.skill_resolver",
    reason="SKIL-01/SKIL-03: skill_resolver not yet implemented (plan 05-02)",
)
config_mod = pytest.importorskip(
    "kubex_common.schemas.config",
    reason="SKIL-01: new SkillManifest schema not yet implemented (plan 05-02)",
)

SkillResolver = skill_resolver_mod.SkillResolver
ComposedSkillSet = skill_resolver_mod.ComposedSkillSet
SkillResolutionError = skill_resolver_mod.SkillResolutionError

SkillManifest = config_mod.SkillManifest
SkillTool = config_mod.SkillTool
SkillDependencies = config_mod.SkillDependencies


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_skill(skills_dir: Path, name: str, manifest: dict) -> Path:
    """Write a skill directory with a manifest.yaml."""
    skill_dir = skills_dir / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "manifest.yaml").write_text(yaml.dump(manifest), encoding="utf-8")
    (skill_dir / "SKILL.md").write_text(f"# {name}\nDo things.", encoding="utf-8")
    return skill_dir


MINIMAL_MANIFEST: dict = {
    "name": "web-scraping",
    "version": "1.0.0",
    "description": "Scrape web pages",
    "category": "data",
    "capabilities": ["scrape_web"],
    "tools": [
        {
            "name": "scrape_profile",
            "description": "Fetch profile data from a URL",
            "parameters": {"url": {"type": "string", "description": "Target URL"}},
        }
    ],
    "dependencies": {
        "pip": ["requests>=2.31"],
        "system": [],
    },
    "egress_domains": ["instagram.com"],
}


# ---------------------------------------------------------------------------
# Tests — SkillManifest schema validation (SKIL-01)
# ---------------------------------------------------------------------------


class TestSkillManifestSchema:
    """New SkillManifest schema accepts correct structure and rejects legacy fields."""

    def test_skill_manifest_validates_correct_schema(self) -> None:
        """SkillManifest validates with all required new fields."""
        manifest = SkillManifest(
            name="web-scraping",
            version="1.0.0",
            description="Scrape web pages",
            category="data",
            capabilities=["scrape_web"],
            tools=[
                SkillTool(
                    name="scrape_profile",
                    description="Fetch profile data",
                    parameters={"url": {"type": "string", "description": "URL"}},
                )
            ],
            dependencies=SkillDependencies(pip=["requests>=2.31"], system=[]),
            egress_domains=["instagram.com"],
        )
        assert manifest.name == "web-scraping"
        assert manifest.version == "1.0.0"
        assert len(manifest.tools) == 1
        assert manifest.tools[0].name == "scrape_profile"

    def test_skill_manifest_rejects_actions_required(self) -> None:
        """SkillManifest raises ValidationError when legacy 'actions_required' field passed."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            SkillManifest(
                name="old-skill",
                version="0.1.0",
                description="Legacy",
                category="misc",
                capabilities=[],
                tools=[],
                dependencies=SkillDependencies(pip=[], system=[]),
                egress_domains=[],
                actions_required=["some_action"],  # legacy — must be rejected
            )

    def test_skill_manifest_rejects_resource_requirements(self) -> None:
        """SkillManifest raises ValidationError when legacy 'resource_requirements' field passed."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            SkillManifest(
                name="old-skill",
                version="0.1.0",
                description="Legacy",
                category="misc",
                capabilities=[],
                tools=[],
                dependencies=SkillDependencies(pip=[], system=[]),
                egress_domains=[],
                resource_requirements={"cpu": 1},  # legacy — must be rejected
            )

    def test_skill_manifest_rejects_system_prompt_section(self) -> None:
        """SkillManifest raises ValidationError when legacy 'system_prompt_section' passed."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            SkillManifest(
                name="old-skill",
                version="0.1.0",
                description="Legacy",
                category="misc",
                capabilities=[],
                tools=[],
                dependencies=SkillDependencies(pip=[], system=[]),
                egress_domains=[],
                system_prompt_section="You are...",  # legacy — must be rejected
            )

    def test_skill_tool_requires_name_and_description(self) -> None:
        """SkillTool requires at minimum name and description."""
        tool = SkillTool(name="my_tool", description="Does something")
        assert tool.name == "my_tool"
        assert tool.description == "Does something"

    def test_skill_dependencies_pip_and_system(self) -> None:
        """SkillDependencies holds pip and system dep lists."""
        deps = SkillDependencies(pip=["requests>=2.31", "bs4"], system=["libxml2"])
        assert "requests>=2.31" in deps.pip
        assert "libxml2" in deps.system


# ---------------------------------------------------------------------------
# Tests — SkillResolver composition (SKIL-03)
# ---------------------------------------------------------------------------


class TestSkillResolver:
    """SkillResolver combines multiple skills into a ComposedSkillSet."""

    def test_single_skill_resolves(self, tmp_path: Path) -> None:
        """Resolving a single skill returns capabilities, deps, and tools."""
        write_skill(tmp_path, "web-scraping", MINIMAL_MANIFEST)
        resolver = SkillResolver()
        composed = resolver.resolve(["web-scraping"], tmp_path)
        assert isinstance(composed, ComposedSkillSet)
        assert "scrape_web" in composed.capabilities
        assert any("requests" in dep for dep in composed.pip_deps)

    def test_two_skills_both_in_prompt(self, tmp_path: Path) -> None:
        """Resolving 2 skills includes both names in ordered_skill_names."""
        write_skill(tmp_path, "web-scraping", MINIMAL_MANIFEST)
        recall_manifest = {
            **MINIMAL_MANIFEST,
            "name": "recall",
            "capabilities": ["recall_memory"],
            "tools": [{"name": "recall", "description": "Retrieve memory", "parameters": {}}],
            "dependencies": {"pip": ["chromadb"], "system": []},
            "egress_domains": [],
        }
        write_skill(tmp_path, "recall", recall_manifest)
        resolver = SkillResolver()
        composed = resolver.resolve(["web-scraping", "recall"], tmp_path)
        assert "web-scraping" in composed.ordered_skill_names
        assert "recall" in composed.ordered_skill_names

    def test_tool_namespacing(self, tmp_path: Path) -> None:
        """Resolved tools are keyed as '{skill-name}.{tool-name}'."""
        write_skill(tmp_path, "web-scraping", MINIMAL_MANIFEST)
        resolver = SkillResolver()
        composed = resolver.resolve(["web-scraping"], tmp_path)
        assert "web-scraping.scrape_profile" in composed.tools

    def test_capabilities_union_deduplicated(self, tmp_path: Path) -> None:
        """When two skills share a capability, it appears only once in the union."""
        manifest_a = {
            **MINIMAL_MANIFEST,
            "name": "skill-a",
            "capabilities": ["data_collection"],
            "tools": [],
            "dependencies": {"pip": [], "system": []},
            "egress_domains": [],
        }
        manifest_b = {
            **MINIMAL_MANIFEST,
            "name": "skill-b",
            "capabilities": ["data_collection"],
            "tools": [],
            "dependencies": {"pip": [], "system": []},
            "egress_domains": [],
        }
        write_skill(tmp_path, "skill-a", manifest_a)
        write_skill(tmp_path, "skill-b", manifest_b)
        resolver = SkillResolver()
        composed = resolver.resolve(["skill-a", "skill-b"], tmp_path)
        assert composed.capabilities.count("data_collection") == 1

    def test_dependencies_union(self, tmp_path: Path) -> None:
        """Deps from multiple skills are combined into a single pip_deps list."""
        manifest_a = {
            **MINIMAL_MANIFEST,
            "name": "skill-a",
            "capabilities": [],
            "tools": [],
            "dependencies": {"pip": ["requests>=2.31"], "system": []},
            "egress_domains": [],
        }
        manifest_b = {
            **MINIMAL_MANIFEST,
            "name": "skill-b",
            "capabilities": [],
            "tools": [],
            "dependencies": {"pip": ["beautifulsoup4"], "system": []},
            "egress_domains": [],
        }
        write_skill(tmp_path, "skill-a", manifest_a)
        write_skill(tmp_path, "skill-b", manifest_b)
        resolver = SkillResolver()
        composed = resolver.resolve(["skill-a", "skill-b"], tmp_path)
        deps_str = " ".join(composed.pip_deps)
        assert "requests" in deps_str
        assert "beautifulsoup4" in deps_str

    def test_version_conflict_raises_or_populates(self, tmp_path: Path) -> None:
        """Conflicting pinned versions of the same package raise or populate version_conflicts."""
        manifest_a = {
            **MINIMAL_MANIFEST,
            "name": "skill-a",
            "capabilities": [],
            "tools": [],
            "dependencies": {"pip": ["requests==2.31.0"], "system": []},
            "egress_domains": [],
        }
        manifest_b = {
            **MINIMAL_MANIFEST,
            "name": "skill-b",
            "capabilities": [],
            "tools": [],
            "dependencies": {"pip": ["requests==2.28.0"], "system": []},
            "egress_domains": [],
        }
        write_skill(tmp_path, "skill-a", manifest_a)
        write_skill(tmp_path, "skill-b", manifest_b)
        resolver = SkillResolver()
        try:
            composed = resolver.resolve(["skill-a", "skill-b"], tmp_path)
            assert len(composed.version_conflicts) > 0, (
                "Expected version_conflicts to be populated for conflicting pinned versions"
            )
        except SkillResolutionError:
            pass  # also acceptable — raising on conflict is valid

    def test_skill_ordering_preserved(self, tmp_path: Path) -> None:
        """ordered_skill_names preserves the input order (not alphabetical)."""
        manifest_a = {**MINIMAL_MANIFEST, "name": "b-skill", "capabilities": [], "tools": [],
                      "dependencies": {"pip": [], "system": []}, "egress_domains": []}
        manifest_b = {**MINIMAL_MANIFEST, "name": "a-skill", "capabilities": [], "tools": [],
                      "dependencies": {"pip": [], "system": []}, "egress_domains": []}
        write_skill(tmp_path, "b-skill", manifest_a)
        write_skill(tmp_path, "a-skill", manifest_b)
        resolver = SkillResolver()
        composed = resolver.resolve(["b-skill", "a-skill"], tmp_path)
        assert composed.ordered_skill_names == ["b-skill", "a-skill"]

    def test_resolve_unknown_skill_raises(self, tmp_path: Path) -> None:
        """Resolving a skill name that doesn't exist on disk raises SkillResolutionError."""
        resolver = SkillResolver()
        with pytest.raises(SkillResolutionError):
            resolver.resolve(["nonexistent-skill"], tmp_path)


# ---------------------------------------------------------------------------
# Tests — SkillResolver.resolve_from_config() (KMGR-01)
# ---------------------------------------------------------------------------


class TestSkillResolverFromConfig:
    """KMGR-01: SkillResolver accepts an agent_config dict instead of a skill name list.

    These tests use xfail because SkillResolver exists but resolve_from_config()
    does not yet exist — it will be added in plan 06-02.
    """

    def test_resolve_from_agent_config(self, tmp_path: Path) -> None:
        """resolve_from_config(agent_config, skill_dir) extracts skill names from
        agent_config['skills'] and returns a ComposedSkillSet."""
        write_skill(tmp_path, "web-scraping", MINIMAL_MANIFEST)

        agent_config = {
            "agent": {"id": "test-agent", "boundary": "test"},
            "skills": ["web-scraping"],
        }

        resolver = SkillResolver()
        composed = resolver.resolve_from_config(agent_config, tmp_path)

        assert isinstance(composed, ComposedSkillSet)
        assert "scrape_web" in composed.capabilities
        assert "web-scraping" in composed.ordered_skill_names

    def test_resolve_from_config_missing_skills_key(self, tmp_path: Path) -> None:
        """resolve_from_config raises SkillResolutionError when agent_config
        has no 'skills' key."""
        agent_config = {
            "agent": {"id": "test-agent"},
            # No 'skills' key — should raise
        }

        resolver = SkillResolver()
        with pytest.raises(SkillResolutionError, match="skills"):
            resolver.resolve_from_config(agent_config, tmp_path)

    def test_resolve_from_config_with_overrides(self, tmp_path: Path) -> None:
        """resolve_from_config applies agent_config['overrides'] to the ComposedSkillSet.

        Overrides can modify composed fields (e.g., remove an egress domain,
        pin a dep version) before ConfigBuilder uses the result.
        """
        write_skill(tmp_path, "web-scraping", MINIMAL_MANIFEST)

        agent_config = {
            "agent": {"id": "test-agent", "boundary": "test"},
            "skills": ["web-scraping"],
            "overrides": {
                "egress_domains": ["custom-domain.com"],
            },
        }

        resolver = SkillResolver()
        composed = resolver.resolve_from_config(agent_config, tmp_path)

        # With overrides applied, composed.egress_domains should reflect the override
        assert "custom-domain.com" in composed.egress_domains
