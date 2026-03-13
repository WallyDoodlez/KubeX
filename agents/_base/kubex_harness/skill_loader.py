"""Skill loader for the kubex harness (BASE-01, BASE-02).

Wraps ``_load_skill_files`` from standalone.py to provide ordered skill loading
when a ``skill_order`` list is provided from config.yaml.

Usage:
    from kubex_harness.skill_loader import load_skills_from_config

    prompt_section = load_skills_from_config(
        skills_dir="/app/skills",
        skill_order=["web-scraping", "recall"],
    )
"""

from __future__ import annotations

import logging
from pathlib import Path

from kubex_harness.standalone import _load_skill_files

logger = logging.getLogger("kubex_harness.skill_loader")


def load_skills_from_config(
    skills_dir: str = "/app/skills",
    skill_order: list[str] | None = None,
) -> str:
    """Load skill markdown files and return a composed prompt section.

    When ``skill_order`` is provided, skills are loaded in that order from
    their individual directories under ``skills_dir``. Skills listed first
    get priority in the prompt.

    When ``skill_order`` is None or empty, all .md files in ``skills_dir``
    are loaded alphabetically (legacy behavior via ``_load_skill_files``).

    Args:
        skills_dir: Root directory containing skill subdirectories.
        skill_order: Ordered list of skill directory names to load.
            Skills are expected as immediate subdirectories of ``skills_dir``.

    Returns:
        Composed prompt string with labeled skill sections, or empty string
        if no skills are found.
    """
    skills_path = Path(skills_dir)

    if not skill_order:
        # Legacy behavior: load all .md files in skills_dir recursively
        return _load_skill_files(skills_dir)

    parts: list[str] = []
    for skill_name in skill_order:
        skill_subdir = skills_path / skill_name
        if not skill_subdir.is_dir():
            logger.warning("Skill directory not found: %s — skipping", skill_subdir)
            continue

        # Load all .md files within this skill directory
        md_files = sorted(skill_subdir.rglob("*.md"))
        for md_file in md_files:
            rel = md_file.relative_to(skills_path)
            try:
                content = md_file.read_text(encoding="utf-8")
                parts.append(f"\n--- Skill: {rel} ---\n{content}")
                logger.info("Loaded skill file: %s", rel)
            except OSError:
                logger.warning("Failed to read skill file: %s", md_file)

    if not parts:
        return ""

    return "\n\n## Loaded Skills\n" + "\n".join(parts)
