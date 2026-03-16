"""ConfigBuilder — assembles the final agent config.yaml from agent config + ComposedSkillSet.

Phase 6 — KMGR-02: ConfigBuilder produces a valid config.yaml used to spawn agents.

The build process:
1. Validates the agent config has required fields.
2. Merges agent identity, model, and resources from agent_config (never from skills).
3. Merges capabilities, tools, deps, egress_domains from ComposedSkillSet.
4. Validates that all declared tools have .py files on disk.
5. Applies agent_config["overrides"] last (deep merge).
6. Writes config.yaml to output_dir/{agent_id}.yaml and returns the path.

Conflicts (version_conflicts from ComposedSkillSet) fail the spawn immediately.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .skill_resolver import ComposedSkillSet

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ConfigBuildError(Exception):
    """Raised when config assembly fails (missing tool, conflicts, validation)."""


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


class ConfigBuilder:
    """Assembles a final agent config.yaml from an agent config dict and a ComposedSkillSet.

    Usage::

        builder = ConfigBuilder()
        config_path = builder.build(
            agent_config=agent_config,
            composed=composed_skill_set,
            skill_dir=Path("/app/skills"),
            output_dir=Path("/app/configs"),
        )
    """

    def build(
        self,
        agent_config: dict[str, Any],
        composed: ComposedSkillSet,
        skill_dir: Path,
        output_dir: Path,
    ) -> Path:
        """Build and write the agent config.yaml.

        Args:
            agent_config: Raw agent configuration dict (from Manager API request).
            composed: ComposedSkillSet produced by SkillResolver.
            skill_dir: Root directory containing skill subdirectories (for tool validation).
            output_dir: Directory to write the config YAML file into.

        Returns:
            Path to the written config YAML file.

        Raises:
            ConfigBuildError: If version conflicts exist, tool files are missing,
                or required config fields are absent.
        """
        # Step 1: Fail fast on version conflicts
        if composed.version_conflicts:
            conflict_list = "\n  ".join(composed.version_conflicts)
            raise ConfigBuildError(f"Skill dependency version conflicts detected — spawn aborted:\n  {conflict_list}")

        # Step 2: Validate required agent config fields
        agent_section = agent_config.get("agent", {})
        agent_id = agent_section.get("id")
        if not agent_id:
            raise ConfigBuildError("agent_config missing required field: agent.id")

        boundary = agent_section.get("boundary", "default")

        # Step 3: Validate tool files exist on disk
        missing_tools: list[str] = []
        for namespaced_key in composed.tools:
            # Key format: "{skill-name}.{tool-name}"
            parts = namespaced_key.split(".", 1)
            if len(parts) != 2:
                missing_tools.append(f"{namespaced_key} (invalid key format)")
                continue
            skill_name, tool_name = parts
            tool_file = skill_dir / skill_name / "tools" / f"{tool_name}.py"
            if not tool_file.exists():
                missing_tools.append(f"{namespaced_key} (missing: {tool_file})")

        if missing_tools:
            tool_list = "\n  ".join(missing_tools)
            raise ConfigBuildError(f"tool files not found on disk — cannot build config:\n  {tool_list}")

        # Step 4: Assemble config dict
        #   - Model comes ONLY from agent_config (locked decision)
        #   - Resource limits come from agent_config (locked decision)
        #   - Capabilities, tools, deps, egress from ComposedSkillSet
        config: dict[str, Any] = {
            "agent": {
                "id": agent_id,
                "boundary": boundary,
                "capabilities": list(composed.capabilities),
                "skills": list(composed.ordered_skill_names),
            },
            "model": dict(agent_config.get("model", {})),
            "tools": {k: {"name": v.name, "description": v.description} for k, v in composed.tools.items()},
            "dependencies": {
                "pip": list(composed.pip_deps),
                "system": list(composed.system_deps),
            },
            "egress_domains": list(composed.egress_domains),
        }

        # Carry over additional top-level keys from agent_config (providers, policy, budget, etc.)
        for key in ("providers", "policy", "budget", "resource_limits"):
            if key in agent_config:
                config[key] = agent_config[key]

        # Step 5: Apply overrides last (deep merge at top level)
        overrides = agent_config.get("overrides", {})
        if overrides:
            config = self._apply_overrides(config, overrides)

        # Step 6: Write config to disk
        output_dir.mkdir(parents=True, exist_ok=True)
        config_path = output_dir / f"{agent_id}.yaml"
        config_path.write_text(yaml.dump(config, default_flow_style=False), encoding="utf-8")

        return config_path

    @staticmethod
    def _apply_overrides(config: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
        """Apply overrides to the config dict (top-level merge, not deep merge).

        Override values replace the corresponding top-level keys in config.
        """
        result = dict(config)
        for key, value in overrides.items():
            result[key] = value
        return result
