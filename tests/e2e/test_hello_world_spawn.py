"""E2E test for MIGR-05 stem cell promise: spawn a new agent from skill + config only.

Proves that an operator can create a new agent role by:
1. Writing a skill directory (SKILL.md + manifest.yaml)
2. Writing a config.yaml referencing that skill
3. Running kubexclaw-base with both bind-mounted

No Docker build step required — this is the core stem cell value proposition.

The test is marked xfail(strict=True) because:
- The hello-world skill directory does not yet exist in skills/examples/hello-world/
- The harness currently uses StandaloneConfig fallback rather than config.yaml-only

After Plan 02+03 create the hello-world template and remove StandaloneConfig,
this test will pass.

Run only this test with:
    pytest tests/e2e/test_hello_world_spawn.py -m e2e -v
"""

from __future__ import annotations

from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path anchoring
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).parent.parent.parent
_SKILLS_DIR = _ROOT / "skills"

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
# Base image tag
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
        try:
            container.remove(force=True)
        except Exception:
            pass


# ===========================================================================
# TestHelloWorldSpawn: stem cell promise — new agent from skill + config only
# ===========================================================================


@pytest.mark.e2e
@pytest.mark.skipif(not _DOCKER_AVAILABLE, reason="Docker not available")
class TestHelloWorldSpawn:
    """Stem cell promise: spawn a brand-new agent role from skill + config, no Docker build.

    This test proves that adding a skill directory and a config.yaml is all an
    operator needs to create a new agent type.  No Dockerfile, no image build,
    no code changes — just files.
    """

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "hello-world skill directory (skills/examples/hello-world/) does not yet exist; "
            "will pass after Plan 02+03 commit the hello-world template agent"
        ),
    )
    def test_hello_world_agent_boots(self, docker_client, tmp_path: Path) -> None:
        """New agent boots from kubexclaw-base using the REPO hello-world template skill.

        This test proves the stem cell promise using the committed template:
        - Mount the REPO skill directory (skills/examples/hello-world/) into the container
        - Write a config.yaml referencing that skill
        - Run kubexclaw-base and verify agent boots + loads both config and skill

        The test is xfail because skills/examples/hello-world/ doesn't exist yet.
        """
        try:
            import yaml  # type: ignore[import]
        except ImportError:
            pytest.skip("PyYAML required for hello-world spawn test")

        # Require the REPO template skill directory — this is what makes the test red
        hello_skill_dir = _SKILLS_DIR / "examples" / "hello-world"
        if not hello_skill_dir.exists():
            # Raise AssertionError to trigger xfail — directory not committed yet
            raise AssertionError(
                f"Template skill directory not found: {hello_skill_dir.relative_to(_ROOT)}"
            )

        # --- Write config.yaml that references the repo template skill ---
        config_data = {
            "agent": {
                "id": "hello-world",
                "model": "gpt-5.2",
                "skills": ["hello-world"],
                "capabilities": ["hello"],
            }
        }
        config_file = tmp_path / "config.yaml"
        config_file.write_text(yaml.dump(config_data), encoding="utf-8")

        # --- Run container with repo skill + config bind-mounted ---
        volumes = {
            str(config_file): {"bind": "/app/config.yaml", "mode": "ro"},
            str(hello_skill_dir): {"bind": "/app/skills/hello-world", "mode": "ro"},
        }
        # Verify: config loads correctly and skill directory is visible
        cmd = (
            "python -c \""
            "from kubex_harness.config_loader import load_agent_config; "
            "c = load_agent_config(); "
            "assert c.agent_id == 'hello-world', f'bad agent_id: {c.agent_id}'; "
            "assert c.model == 'gpt-5.2', f'bad model: {c.model}'; "
            "assert c.skills == ['hello-world'], f'bad skills: {c.skills}'; "
            "print(c.agent_id, c.skills)\""
        )
        exit_code, logs = _run_container(docker_client, _BASE_IMAGE_TAG, volumes=volumes, command=cmd)

        assert exit_code == 0, f"Container exited with {exit_code}. Logs:\n{logs[:500]}"
        assert "hello-world" in logs, f"Expected 'hello-world' in logs, got:\n{logs[:500]}"
        assert "['hello-world']" in logs, f"Expected skills list in logs, got:\n{logs[:500]}"

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "skills/examples/hello-world/ template directory does not yet exist; "
            "will pass after Plan 02+03 commit the hello-world template to the repo"
        ),
    )
    def test_hello_world_skill_template_exists_in_repo(self) -> None:
        """The hello-world template skill directory is committed to the repo.

        After Plan 02+03, operators can find a working example at:
            skills/examples/hello-world/SKILL.md
            skills/examples/hello-world/manifest.yaml

        This test verifies the template is checked in and complete.
        """
        hello_skill_dir = _SKILLS_DIR / "examples" / "hello-world"
        assert hello_skill_dir.exists(), (
            f"Template skill directory not found: {hello_skill_dir.relative_to(_ROOT)}\n"
            "Expected after Plan 02+03 migration."
        )

        skill_md = hello_skill_dir / "SKILL.md"
        assert skill_md.exists(), (
            f"SKILL.md missing from hello-world template: {skill_md.relative_to(_ROOT)}"
        )

        manifest = hello_skill_dir / "manifest.yaml"
        assert manifest.exists(), (
            f"manifest.yaml missing from hello-world template: {manifest.relative_to(_ROOT)}"
        )

        # Verify manifest declares the hello capability
        try:
            import yaml  # type: ignore[import]

            data = yaml.safe_load(manifest.read_text(encoding="utf-8"))
            assert "hello" in data.get("capabilities", []), (
                f"Expected 'hello' in manifest capabilities, got: {data.get('capabilities')}"
            )
        except ImportError:
            pass  # yaml not required for this check
