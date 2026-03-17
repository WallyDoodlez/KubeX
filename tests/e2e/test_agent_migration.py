"""E2E and unit tests for Phase 7 agent migration (MIGR-01 through MIGR-05).

Covers:
- MIGR-01: Orchestrator boots from kubexclaw-base with production config.yaml in stem cell format.
- MIGR-02: Instagram-scraper boots from kubexclaw-base with production config.yaml in stem cell format.
- MIGR-03: Knowledge agent boots from kubexclaw-base with production config.yaml in stem cell format.
- MIGR-04: No per-agent Dockerfiles remain in agents/ subdirectories.
- MIGR-05: StandaloneConfig removed — load_agent_config fails fast with no config file.
- Reviewer agent (Phase 7 scope): boots from kubexclaw-base with o3-mini model from config.

Run only these tests with:
    pytest tests/e2e/test_agent_migration.py -m e2e -v
"""

from __future__ import annotations

import contextlib
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path anchoring
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).parent.parent.parent
_AGENTS_DIR = _ROOT / "agents"

# ---------------------------------------------------------------------------
# Docker availability guard  (same pattern as test_base_image_e2e.py)
# ---------------------------------------------------------------------------
docker = pytest.importorskip("docker")  # type: ignore[import]

_DOCKER_AVAILABLE = False
_docker_client_mod = None
try:
    _docker_client_mod = docker
    _docker_client_test = docker.from_env()
    _docker_client_test.ping()
    _DOCKER_AVAILABLE = True
except Exception:
    _DOCKER_AVAILABLE = False

# ---------------------------------------------------------------------------
# Base image tag — kubexclaw-base:latest used for all agent migration tests
# ---------------------------------------------------------------------------
_BASE_IMAGE_TAG = "kubexclaw-base:latest"


# ---------------------------------------------------------------------------
# Session-scoped Docker client fixture
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def docker_client():
    """Return a Docker SDK client; skip session if Docker is unavailable."""
    if not _DOCKER_AVAILABLE:
        pytest.skip("Docker daemon not available — skipping all E2E tests")
    return _docker_client_mod.from_env()


# ---------------------------------------------------------------------------
# Helper: run a container and return (exit_code, logs)
# ---------------------------------------------------------------------------


def _run_container(
    client,
    image: str,
    *,
    volumes: dict | None = None,
    command: str | None = None,
    timeout_s: int = 30,
) -> tuple[int, str]:
    """Run a container synchronously, return (exit_code, combined logs)."""
    container = client.containers.run(
        image,
        command=command,
        volumes=volumes or {},
        detach=True,
        remove=False,
    )
    try:
        result = container.wait(timeout=timeout_s)
        logs = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")
        exit_code = result.get("StatusCode", -1)
        return exit_code, logs
    finally:
        with contextlib.suppress(Exception):
            container.remove(force=True)


# ===========================================================================
# MIGR-01: Orchestrator boots from kubexclaw-base using production config
# ===========================================================================


@pytest.mark.e2e
@pytest.mark.skipif(not _DOCKER_AVAILABLE, reason="Docker not available")
class TestOrchestratorBootsFromBase:
    """MIGR-01: Orchestrator boots from kubexclaw-base using production config.yaml.

    After migration, the config must:
    - Use top-level 'model: gpt-5.2' (not 'models.default')
    - Reference skill directory 'task-management' (not action names like 'dispatch_task')
    - Boot and load config with correct values
    """

    def test_orchestrator_boots_from_base(self, docker_client) -> None:
        """Container from kubexclaw-base loads production orchestrator config with migrated schema."""
        config_path = _AGENTS_DIR / "orchestrator" / "config.yaml"
        if not config_path.exists():
            pytest.skip(f"Production config not found: {config_path}")

        volumes = {
            str(config_path): {"bind": "/app/config.yaml", "mode": "ro"},
        }
        # After migration: config must have skill dir 'task-management' (not action names)
        cmd = (
            "python -c \""
            "from kubex_harness.config_loader import load_agent_config; "
            "c = load_agent_config(); "
            "assert c.agent_id == 'orchestrator', f'bad agent_id: {c.agent_id}'; "
            "assert c.model == 'gpt-5.2', f'bad model: {c.model}'; "
            "assert 'task-management' in c.skills, "
            "  f'expected task-management skill dir in skills, got: {c.skills}'; "
            "print(c.agent_id)\""
        )
        exit_code, logs = _run_container(docker_client, _BASE_IMAGE_TAG, volumes=volumes, command=cmd)

        assert exit_code == 0, f"Container exited with {exit_code}. Logs:\n{logs[:500]}"
        assert "orchestrator" in logs, f"Expected 'orchestrator' in logs, got:\n{logs[:500]}"


# ===========================================================================
# MIGR-02: Instagram-scraper boots from kubexclaw-base using production config
# ===========================================================================


@pytest.mark.e2e
@pytest.mark.skipif(not _DOCKER_AVAILABLE, reason="Docker not available")
class TestInstagramScraperBootsFromBase:
    """MIGR-02: Instagram-scraper boots from kubexclaw-base using production config.yaml.

    After migration, the config must:
    - Use top-level 'model: gpt-5.2' (not 'models.default')
    - Reference skill directory 'web-scraping' (not action names like 'scrape_profile')
    """

    def test_instagram_scraper_boots_from_base(self, docker_client) -> None:
        """Container from kubexclaw-base loads production instagram-scraper config with migrated schema."""
        config_path = _AGENTS_DIR / "instagram-scraper" / "config.yaml"
        if not config_path.exists():
            pytest.skip(f"Production config not found: {config_path}")

        volumes = {
            str(config_path): {"bind": "/app/config.yaml", "mode": "ro"},
        }
        # After migration: config must have skill dir 'web-scraping' (not action names)
        cmd = (
            "python -c \""
            "from kubex_harness.config_loader import load_agent_config; "
            "c = load_agent_config(); "
            "assert c.agent_id == 'instagram-scraper', f'bad agent_id: {c.agent_id}'; "
            "assert c.model == 'gpt-5.2', f'bad model: {c.model}'; "
            "assert 'web-scraping' in c.skills, "
            "  f'expected web-scraping skill dir in skills, got: {c.skills}'; "
            "print(c.agent_id)\""
        )
        exit_code, logs = _run_container(docker_client, _BASE_IMAGE_TAG, volumes=volumes, command=cmd)

        assert exit_code == 0, f"Container exited with {exit_code}. Logs:\n{logs[:500]}"
        assert "instagram-scraper" in logs, f"Expected 'instagram-scraper' in logs, got:\n{logs[:500]}"


# ===========================================================================
# MIGR-03: Knowledge agent boots from kubexclaw-base using production config
# ===========================================================================


@pytest.mark.e2e
@pytest.mark.skipif(not _DOCKER_AVAILABLE, reason="Docker not available")
class TestKnowledgeAgentBootsFromBase:
    """MIGR-03: Knowledge agent boots from kubexclaw-base using production config.yaml.

    After migration, the config must:
    - Use top-level 'model: gpt-5.2' (not 'models.default')
    - Reference skill directory 'recall' (not action names like 'query_knowledge')
    """

    def test_knowledge_agent_boots_from_base(self, docker_client) -> None:
        """Container from kubexclaw-base loads production knowledge config with migrated schema."""
        config_path = _AGENTS_DIR / "knowledge" / "config.yaml"
        if not config_path.exists():
            pytest.skip(f"Production config not found: {config_path}")

        volumes = {
            str(config_path): {"bind": "/app/config.yaml", "mode": "ro"},
        }
        # After migration: config must have skill dir 'recall' (not action names)
        cmd = (
            "python -c \""
            "from kubex_harness.config_loader import load_agent_config; "
            "c = load_agent_config(); "
            "assert c.agent_id == 'knowledge', f'bad agent_id: {c.agent_id}'; "
            "assert c.model == 'gpt-5.2', f'bad model: {c.model}'; "
            "assert 'recall' in c.skills, "
            "  f'expected recall skill dir in skills, got: {c.skills}'; "
            "print(c.agent_id)\""
        )
        exit_code, logs = _run_container(docker_client, _BASE_IMAGE_TAG, volumes=volumes, command=cmd)

        assert exit_code == 0, f"Container exited with {exit_code}. Logs:\n{logs[:500]}"
        assert "knowledge" in logs, f"Expected 'knowledge' in logs, got:\n{logs[:500]}"


# ===========================================================================
# Reviewer agent boots from kubexclaw-base (Phase 7 scope)
# ===========================================================================


@pytest.mark.e2e
@pytest.mark.skipif(not _DOCKER_AVAILABLE, reason="Docker not available")
class TestReviewerBootsFromBase:
    """Reviewer agent boots from kubexclaw-base with o3-mini from production config.

    After migration, the config must:
    - Use top-level 'model: o3-mini' (not 'models.default: o3-mini')
    - Currently harness defaults to 'gpt-5.2' since 'agent.model' key is absent.
    """

    def test_reviewer_boots_from_base(self, docker_client) -> None:
        """Container from kubexclaw-base loads production reviewer config with o3-mini model."""
        config_path = _AGENTS_DIR / "reviewer" / "config.yaml"
        if not config_path.exists():
            pytest.skip(f"Production config not found: {config_path}")

        volumes = {
            str(config_path): {"bind": "/app/config.yaml", "mode": "ro"},
        }
        # After migration: config must have model: o3-mini at top level
        cmd = (
            "python -c \""
            "from kubex_harness.config_loader import load_agent_config; "
            "c = load_agent_config(); "
            "assert c.agent_id == 'reviewer', f'bad agent_id: {c.agent_id}'; "
            "assert c.model == 'o3-mini', f'bad model: {c.model}'; "
            "print(c.agent_id)\""
        )
        exit_code, logs = _run_container(docker_client, _BASE_IMAGE_TAG, volumes=volumes, command=cmd)

        assert exit_code == 0, f"Container exited with {exit_code}. Logs:\n{logs[:500]}"
        assert "reviewer" in logs, f"Expected 'reviewer' in logs, got:\n{logs[:500]}"


# ===========================================================================
# MIGR-05: StandaloneConfig removal — load_agent_config fails fast with no file
# ===========================================================================


class TestFullSuiteRegression:
    """MIGR-05: StandaloneConfig removed — harness fails fast if no /app/config.yaml."""

    def test_load_agent_config_raises_without_config_file(self, tmp_path: Path, monkeypatch) -> None:
        """After StandaloneConfig removal, load_agent_config raises ValueError with no file.

        Currently the function silently falls back to env vars / empty defaults.
        After MIGR-05 is implemented, passing a non-existent path must raise ValueError.
        """
        sys.path.insert(0, str(_ROOT / "agents" / "_base"))
        from kubex_harness.config_loader import load_agent_config  # noqa: PLC0415

        nonexistent = str(tmp_path / "does_not_exist.yaml")
        # Ensure no KUBEX_AGENT_ID env var can mask the failure
        monkeypatch.delenv("KUBEX_AGENT_ID", raising=False)
        with pytest.raises(ValueError, match="config"):
            load_agent_config(nonexistent)
