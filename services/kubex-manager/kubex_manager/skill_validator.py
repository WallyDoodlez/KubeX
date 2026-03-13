"""Skill content validator — regex + LM dual-layer injection defense (SKIL-04).

Validates skill markdown content for prompt injection patterns.
Clean skills receive a ValidationStamp. Dirty skills return a verdict with
detected patterns and no stamp.

CLI usage:
    python -m kubex_manager.skill_validator skills/
"""

from __future__ import annotations

import hashlib
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

VALIDATOR_VERSION = "1.0.0"


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class LMVerdict(BaseModel):
    """Result from an LM-based content analysis."""

    is_clean: bool
    issues: list[str] = []
    analysis: str = ""


class ValidationStamp(BaseModel):
    """Cryptographic stamp applied to skill content that passed validation."""

    content_hash: str
    validated_at: str
    validator_version: str
    verdict: str


class ValidationVerdict(BaseModel):
    """Full validation result for a single skill."""

    is_clean: bool
    detected_patterns: list[str] = []
    lm_analysis: LMVerdict | None = None
    stamp: ValidationStamp | None = None


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


class SkillValidator:
    """Two-layer skill content validator: regex blocklist + optional LM analysis.

    Args:
        blocklist_path: Path to a blocklist file. Each non-empty, non-comment
            line is treated as a case-insensitive substring pattern to detect.
        lm_client: Optional LM client with an ``analyze(content: str) -> LMVerdict``
            method. When provided, content that passes regex is also evaluated
            by the LM for subtle injection patterns.
    """

    def __init__(self, blocklist_path: Path, lm_client: Any | None = None) -> None:
        self._lm_client = lm_client
        self._patterns: list[str] = self._load_blocklist(blocklist_path)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate_skill_md(self, skill_name: str, content: str) -> ValidationVerdict:
        """Validate a skill's markdown content.

        Args:
            skill_name: Human-readable skill identifier (for logging).
            content: Raw skill markdown text.

        Returns:
            ValidationVerdict — is_clean, detected_patterns, lm_analysis, stamp.
        """
        # Step 1: regex scan
        detected = self._regex_check(content)
        if detected:
            return ValidationVerdict(
                is_clean=False,
                detected_patterns=detected,
                lm_analysis=None,
                stamp=None,
            )

        # Step 2: LM analysis (only when regex passes and client is provided)
        lm_analysis: LMVerdict | None = None
        if self._lm_client is not None:
            lm_analysis = self._lm_check(content)
            if not lm_analysis.is_clean:
                return ValidationVerdict(
                    is_clean=False,
                    detected_patterns=[],
                    lm_analysis=lm_analysis,
                    stamp=None,
                )

        # Step 3: stamp clean content
        stamp = self._create_stamp(content)
        return ValidationVerdict(
            is_clean=True,
            detected_patterns=[],
            lm_analysis=lm_analysis,
            stamp=stamp,
        )

    def validate_catalog(self, skills_dir: Path) -> list[ValidationVerdict]:
        """Validate all skills in a catalog directory.

        Scans ``skills_dir`` for immediate subdirectories containing a
        ``SKILL.md`` file. Returns one ValidationVerdict per skill found.

        Args:
            skills_dir: Root directory of the skill catalog.

        Returns:
            List of ValidationVerdict objects (one per skill directory found).
        """
        verdicts: list[ValidationVerdict] = []
        if not skills_dir.is_dir():
            return verdicts

        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            try:
                content = skill_md.read_text(encoding="utf-8")
            except OSError:
                continue
            verdict = self.validate_skill_md(skill_dir.name, content)
            verdicts.append(verdict)

        return verdicts

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_blocklist(blocklist_path: Path) -> list[str]:
        """Load patterns from the blocklist file.

        Each non-empty, non-comment line is a pattern (case-insensitive substring).
        YAML format is also supported: lines starting with ``-`` have the prefix stripped.
        """
        patterns: list[str] = []
        try:
            text = blocklist_path.read_text(encoding="utf-8")
        except OSError:
            return patterns

        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Strip leading YAML list marker
            if line.startswith("- "):
                line = line[2:].strip()
            if line:
                patterns.append(line)

        return patterns

    def _regex_check(self, content: str) -> list[str]:
        """Scan content against the blocklist patterns.

        Returns a list of matched pattern strings (empty if clean).
        """
        content_lower = content.lower()
        matched: list[str] = []
        for pattern in self._patterns:
            # Case-insensitive substring match
            if pattern.lower() in content_lower:
                matched.append(pattern)
        return matched

    def _lm_check(self, content: str) -> LMVerdict:
        """Delegate content analysis to the LM client.

        Expects the client to have an ``analyze(content: str) -> LMVerdict`` method.
        """
        return self._lm_client.analyze(content)  # type: ignore[no-any-return]

    def _create_stamp(self, content: str) -> ValidationStamp:
        """Create a ValidationStamp for content that passed all checks."""
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        validated_at = datetime.now(tz=UTC).isoformat()
        return ValidationStamp(
            content_hash=content_hash,
            validated_at=validated_at,
            validator_version=VALIDATOR_VERSION,
            verdict="clean",
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _main(argv: list[str]) -> int:
    """CLI: validate all skills in a directory.

    Usage:
        python -m kubex_manager.skill_validator <skills_dir>

    Exits 0 if all skills are clean, 1 if any are dirty.
    """
    if len(argv) < 2:
        sys.stderr.write("Usage: python -m kubex_manager.skill_validator <skills_dir>\n")
        return 2

    skills_dir = Path(argv[1])

    # Use the default blocklist shipped with the package
    default_blocklist = Path(__file__).parent / "blocklist.yaml"
    if not default_blocklist.exists():
        sys.stderr.write(f"[skill_validator] WARNING: blocklist not found at {default_blocklist}\n")
        # Create empty temp blocklist so validator can still run
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as tmp:
            default_blocklist = Path(tmp.name)

    validator = SkillValidator(blocklist_path=default_blocklist)
    verdicts = validator.validate_catalog(skills_dir)

    if not verdicts:
        sys.stdout.write(f"[skill_validator] No skills found in {skills_dir}\n")
        return 0

    all_clean = True
    for verdict in verdicts:
        status = "CLEAN" if verdict.is_clean else "DIRTY"
        sys.stdout.write(f"[skill_validator] {status}\n")
        if not verdict.is_clean:
            all_clean = False
            for pattern in verdict.detected_patterns:
                sys.stdout.write(f"  - matched: {pattern!r}\n")
            if verdict.lm_analysis:
                for issue in verdict.lm_analysis.issues:
                    sys.stdout.write(f"  - lm: {issue}\n")

    if all_clean:
        sys.stdout.write(f"[skill_validator] All {len(verdicts)} skill(s) clean.\n")
        return 0
    else:
        sys.stdout.write("[skill_validator] FAILED: one or more skills contain injection patterns.\n")
        return 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
