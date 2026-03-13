"""Skill resolver — compose multiple skills into a ComposedSkillSet (SKIL-03).

Reads skill manifests from disk, unions capabilities/deps, namespaces tools,
and detects version pin conflicts between skills.

Usage:
    from kubex_manager.skill_resolver import SkillResolver, ComposedSkillSet, SkillResolutionError

    resolver = SkillResolver()
    composed = resolver.resolve(["web-scraping", "recall"], skill_dir=Path("/app/skills"))
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from kubex_common.schemas.config import SkillManifest, SkillTool

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SkillResolutionError(Exception):
    """Raised when skill resolution fails (e.g., unknown skill, version conflict)."""


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class ComposedSkillSet:
    """Result of resolving and composing multiple skills.

    Attributes:
        capabilities: Deduplicated union of all skill capabilities.
        pip_deps: Deduplicated union of all pip dependencies.
        system_deps: Deduplicated union of all system dependencies.
        egress_domains: Deduplicated union of all egress domains.
        tools: Dict of namespaced tools: ``"{skill-name}.{tool-name}"`` -> SkillTool.
        ordered_skill_names: Skill names in the order they were requested.
        version_conflicts: Human-readable descriptions of detected version conflicts.
    """

    capabilities: list[str] = field(default_factory=list)
    pip_deps: list[str] = field(default_factory=list)
    system_deps: list[str] = field(default_factory=list)
    egress_domains: list[str] = field(default_factory=list)
    tools: dict[str, SkillTool] = field(default_factory=dict)
    ordered_skill_names: list[str] = field(default_factory=list)
    version_conflicts: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------


class SkillResolver:
    """Resolves and composes skill manifests into a unified ComposedSkillSet.

    Skills are located by name as immediate subdirectories of the given
    ``skill_dir``. Each skill directory must contain a ``manifest.yaml``
    (or ``skill.yaml``) file that validates against the SkillManifest schema.
    """

    def resolve(self, skill_names: list[str], skill_dir: Path) -> ComposedSkillSet:
        """Resolve and compose a list of skills.

        Args:
            skill_names: Ordered list of skill directory names to resolve.
            skill_dir: Root directory containing skill subdirectories.

        Returns:
            ComposedSkillSet with unioned capabilities, deps, namespaced tools, etc.

        Raises:
            SkillResolutionError: If a skill name is not found on disk.
        """
        manifests: list[tuple[str, SkillManifest]] = []
        for name in skill_names:
            manifest = self._load_manifest(name, skill_dir)
            manifests.append((name, manifest))

        return self._compose(skill_names, manifests)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _load_manifest(self, skill_name: str, skill_dir: Path) -> SkillManifest:
        """Load and validate a SkillManifest from disk.

        Looks for ``manifest.yaml`` first, then ``skill.yaml`` in the skill's
        subdirectory under ``skill_dir``.

        Args:
            skill_name: Name of the skill (directory name).
            skill_dir: Root directory containing skill subdirectories.

        Returns:
            Validated SkillManifest.

        Raises:
            SkillResolutionError: If the skill directory or manifest file is not found.
        """
        skill_path = skill_dir / skill_name
        if not skill_path.is_dir():
            available = [d.name for d in skill_dir.iterdir() if d.is_dir()] if skill_dir.is_dir() else []
            raise SkillResolutionError(
                f"Skill directory not found: {skill_path}. " f"Available skills in {skill_dir}: {available}"
            )

        # Try manifest.yaml first, then skill.yaml
        for filename in ("manifest.yaml", "skill.yaml"):
            manifest_file = skill_path / filename
            if manifest_file.exists():
                try:
                    raw = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))
                except (yaml.YAMLError, OSError) as exc:
                    raise SkillResolutionError(f"Failed to parse manifest for skill {skill_name!r}: {exc}") from exc

                if not isinstance(raw, dict):
                    raise SkillResolutionError(f"Manifest for skill {skill_name!r} is not a YAML mapping.")

                try:
                    return SkillManifest.model_validate(raw)
                except Exception as exc:
                    raise SkillResolutionError(
                        f"Manifest for skill {skill_name!r} failed schema validation: {exc}"
                    ) from exc

        raise SkillResolutionError(f"No manifest.yaml or skill.yaml found in skill directory: {skill_path}")

    @staticmethod
    def _compose(ordered_names: list[str], manifests: list[tuple[str, SkillManifest]]) -> ComposedSkillSet:
        """Compose multiple skill manifests into a single ComposedSkillSet."""
        capabilities: list[str] = []
        pip_deps: list[str] = []
        system_deps: list[str] = []
        egress_domains: list[str] = []
        tools: dict[str, SkillTool] = {}
        version_conflicts: list[str] = []

        # Track pinned package versions for conflict detection
        # Maps: package_name -> (pinned_version, skill_name_that_set_it)
        pinned_versions: dict[str, tuple[str, str]] = {}

        seen_capabilities: set[str] = set()
        seen_pip: set[str] = set()
        seen_system: set[str] = set()
        seen_egress: set[str] = set()

        for skill_name, manifest in manifests:
            # Union capabilities (deduplicated)
            for cap in manifest.capabilities:
                if cap not in seen_capabilities:
                    capabilities.append(cap)
                    seen_capabilities.add(cap)

            # Union pip deps (with version conflict detection)
            for dep in manifest.dependencies.pip:
                pkg_name = _extract_package_name(dep)
                pinned_ver = _extract_pinned_version(dep)

                if pinned_ver and pkg_name in pinned_versions:
                    existing_ver, existing_skill = pinned_versions[pkg_name]
                    if existing_ver != pinned_ver:
                        conflict_msg = (
                            f"{pkg_name}: {existing_skill} requires =={existing_ver}, "
                            f"{skill_name} requires =={pinned_ver}"
                        )
                        version_conflicts.append(conflict_msg)

                if pinned_ver and pkg_name not in pinned_versions:
                    pinned_versions[pkg_name] = (pinned_ver, skill_name)

                if dep not in seen_pip:
                    pip_deps.append(dep)
                    seen_pip.add(dep)

            # Union system deps (deduplicated)
            for dep in manifest.dependencies.system:
                if dep not in seen_system:
                    system_deps.append(dep)
                    seen_system.add(dep)

            # Union egress domains (deduplicated)
            for domain in manifest.egress_domains:
                if domain not in seen_egress:
                    egress_domains.append(domain)
                    seen_egress.add(domain)

            # Namespace tools as "{skill-name}.{tool-name}"
            for tool in manifest.tools:
                namespaced_key = f"{skill_name}.{tool.name}"
                tools[namespaced_key] = tool

        return ComposedSkillSet(
            capabilities=capabilities,
            pip_deps=pip_deps,
            system_deps=system_deps,
            egress_domains=egress_domains,
            tools=tools,
            ordered_skill_names=list(ordered_names),
            version_conflicts=version_conflicts,
        )


# ---------------------------------------------------------------------------
# Package version parsing helpers
# ---------------------------------------------------------------------------


def _extract_package_name(dep: str) -> str:
    """Extract the base package name from a pip dependency string.

    Examples:
        "requests>=2.31"  -> "requests"
        "requests==2.31.0" -> "requests"
        "beautifulsoup4"  -> "beautifulsoup4"
    """
    # Split on version specifier operators
    match = re.split(r"[><=!~@]", dep, maxsplit=1)
    return match[0].strip().lower()


def _extract_pinned_version(dep: str) -> str | None:
    """Extract the pinned version if the dep uses == specifier.

    Returns None for non-pinned specifiers (>=, <=, ~=, etc.).

    Examples:
        "requests==2.31.0"  -> "2.31.0"
        "requests>=2.31"    -> None
        "beautifulsoup4"    -> None
    """
    match = re.search(r"==([^\s,;]+)", dep)
    if match:
        return match.group(1)
    return None
