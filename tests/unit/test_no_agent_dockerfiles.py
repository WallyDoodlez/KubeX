"""Unit test for MIGR-04: No per-agent Dockerfiles in agents/ subdirectories.

After Phase 7 migration, agents/ should contain only config.yaml and
policies/ per-agent directory — no Dockerfiles.  The _base/ subdirectory
is the only permitted location for a Dockerfile (it builds kubexclaw-base).
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Path anchoring
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).parent.parent.parent
_AGENTS_DIR = _ROOT / "agents"


class TestNoAgentDockerfiles:
    """MIGR-04: No Dockerfile exists in any agent directory except _base/."""

    def test_no_agent_dockerfiles(self) -> None:
        """Scan agents/ subdirectories (excluding _base) — assert no Dockerfile found.

        After migration, each agent directory should contain only config.yaml
        and (optionally) policies/policy.yaml.  Dockerfiles are forbidden.
        """
        assert _AGENTS_DIR.exists(), f"agents/ directory not found at {_AGENTS_DIR}"

        offending: list[Path] = []
        for agent_dir in _AGENTS_DIR.iterdir():
            if not agent_dir.is_dir():
                continue
            if agent_dir.name == "_base":
                # _base/ Dockerfile is expected — it builds the universal image
                continue
            dockerfile = agent_dir / "Dockerfile"
            if dockerfile.exists():
                offending.append(dockerfile)

        assert offending == [], (
            "Found per-agent Dockerfiles that should have been deleted during migration:\n"
            + "\n".join(f"  {p.relative_to(_ROOT)}" for p in offending)
        )
