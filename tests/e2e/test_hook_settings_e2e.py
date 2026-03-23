"""Phase 10 UAT → E2E: Hook settings.json mount verification.

Converts UAT Test 1 (read-only settings.json mount) into automated E2E tests.
UAT result: PASS — manually verified 2026-03-23.

These tests verify that:
  1. The Manager generates correct hook settings and mounts them read-only
     for claude-code runtime containers (HOOK-02, D-08).
  2. The settings.json contains all four required hook types.
  3. openai-api runtime containers do NOT receive a settings.json mount.

Tests use mocked Docker SDK — no real Docker daemon required.
They exercise `lifecycle.py` directly via the FastAPI TestClient (same pattern
as test_kubex_manager.py) and also unit-test the helper function directly.

Phase ref: .planning/phases/10-hooks-monitoring/
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup — mirrors pattern used throughout tests/e2e/
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

# ---------------------------------------------------------------------------
# Conditional import guard — skip if lifecycle module is unavailable.
# ---------------------------------------------------------------------------
_IMPLEMENTED = False
try:
    from kubex_manager.lifecycle import (  # type: ignore[import]
        KubexLifecycle,
        CreateKubexRequest,
        _generate_hook_settings,
    )
    from kubex_manager.main import app as manager_app  # type: ignore[import]
    from fastapi.testclient import TestClient

    _IMPLEMENTED = True
except ImportError:
    pass

_skip = pytest.mark.skipif(
    not _IMPLEMENTED,
    reason="kubex_manager.lifecycle not importable — service not on sys.path",
)

# ---------------------------------------------------------------------------
# Shared config fixtures
# ---------------------------------------------------------------------------

CLAUDE_CODE_CONFIG: dict[str, Any] = {
    "agent": {
        "id": "test-claude-code-agent",
        "boundary": "platform",
        "prompt": "You are a test agent.",
        "runtime": "claude-code",
        "capabilities": ["test"],
        "models": {
            "allowed": [{"id": "claude-sonnet-4-6", "tier": "standard"}],
            "default": "claude-sonnet-4-6",
        },
        "providers": ["anthropic"],
    }
}

OPENAI_API_CONFIG: dict[str, Any] = {
    "agent": {
        "id": "test-openai-api-agent",
        "boundary": "platform",
        "prompt": "You are a test agent.",
        "runtime": "openai-api",
        "capabilities": ["test"],
        "models": {
            "allowed": [{"id": "gpt-4o", "tier": "standard"}],
            "default": "gpt-4o",
        },
        "providers": ["openai"],
    }
}


# ---------------------------------------------------------------------------
# Shared mock builder
# ---------------------------------------------------------------------------


def _make_mock_docker() -> MagicMock:
    """Return a fully-wired mock Docker client matching manager expectations."""
    mock_docker = MagicMock()
    mock_container = MagicMock()
    mock_container.id = "deadbeef123456"
    mock_container.status = "created"
    mock_docker.containers.create.return_value = mock_container

    mock_network = MagicMock()
    mock_network.name = "openclaw_kubex-internal"
    mock_docker.networks.list.return_value = [mock_network]

    return mock_docker


# ===========================================================================
# Unit tests: _generate_hook_settings helper
# ===========================================================================


@_skip
class TestGenerateHookSettings:
    """Unit tests for the _generate_hook_settings() helper (HOOK-02).

    These do NOT need Docker — they test the pure file-generation logic.
    """

    def test_generates_file_in_output_dir(self) -> None:
        """_generate_hook_settings writes a file in the provided output dir."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "hook-settings"
            path = _generate_hook_settings("test-agent-001", output_dir)

            assert path.exists(), f"settings file not created at {path}"
            assert path.parent == output_dir

    def test_filename_includes_agent_id(self) -> None:
        """Generated filename contains the agent_id for uniqueness."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "hook-settings"
            path = _generate_hook_settings("my-unique-agent", output_dir)

            assert "my-unique-agent" in path.name

    def test_contains_all_four_hook_types(self) -> None:
        """settings.json must declare PostToolUse, Stop, SessionEnd, SubagentStop hooks.

        UAT Test 1 manually verified these four types present — this automates it.
        Ref: .planning/phases/10-hooks-monitoring/10-HUMAN-UAT.md Test 1
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "hook-settings"
            path = _generate_hook_settings("hook-type-test", output_dir)

            content = json.loads(path.read_text(encoding="utf-8"))
            hooks = content.get("hooks", {})

            for hook_type in ("PostToolUse", "Stop", "SessionEnd", "SubagentStop"):
                assert hook_type in hooks, f"Missing hook type: {hook_type}"

    def test_all_hooks_point_at_harness_url(self) -> None:
        """Every hook entry must use type 'http' and url 'http://127.0.0.1:8099/hooks'.

        The harness hook server listens at 127.0.0.1:8099 inside the container.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "hook-settings"
            path = _generate_hook_settings("url-verify-agent", output_dir)

            content = json.loads(path.read_text(encoding="utf-8"))
            hooks = content.get("hooks", {})

            for hook_type, entries in hooks.items():
                for entry in entries:
                    for hook in entry.get("hooks", []):
                        assert hook.get("type") == "http", (
                            f"{hook_type} hook has type '{hook.get('type')}', expected 'http'"
                        )
                        assert hook.get("url") == "http://127.0.0.1:8099/hooks", (
                            f"{hook_type} hook url mismatch: {hook.get('url')}"
                        )

    def test_creates_output_dir_if_missing(self) -> None:
        """output_dir is created automatically even if it does not exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "nested" / "hook-settings"
            assert not output_dir.exists()

            _generate_hook_settings("dir-create-agent", output_dir)

            assert output_dir.exists()


# ===========================================================================
# E2E tests: Docker volume inspection via mocked SDK
# ===========================================================================


@_skip
class TestHookSettingsMountReadonly:
    """HOOK-MOUNT-01: claude-code containers receive a read-only settings.json mount.

    Phase 10 UAT Test 1 → automated E2E.
    UAT verified: `echo "tampered" > /root/.claude/settings.json` returned
    "Read-only file system" inside a running claude-code container.
    """

    def setup_method(self) -> None:
        self.mock_docker = _make_mock_docker()
        self.client = TestClient(manager_app, raise_server_exceptions=False)

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_hook_settings_mounted_readonly(self, mock_docker_env: MagicMock) -> None:
        """Spawn a claude-code container — settings.json mount has mode 'ro'.

        Verifies docker.containers.create() is called with a volume entry
        binding to /root/.claude/settings.json with mode='ro'.

        This is the programmatic equivalent of UAT Test 1:
          docker inspect <container> — Mounts array contains settings.json with RW=false.
        """
        mock_docker_env.return_value = self.mock_docker

        resp = self.client.post(
            "/kubexes",
            json={"config": CLAUDE_CODE_CONFIG},
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert resp.status_code == 201, f"Spawn failed: {resp.status_code} — {resp.text}"

        call_kwargs = self.mock_docker.containers.create.call_args
        volumes: dict[str, dict[str, str]] = (
            call_kwargs.kwargs.get("volumes") or call_kwargs[1].get("volumes", {})
        )

        # Find the entry bound to /root/.claude/settings.json
        settings_mount = None
        for _host_path, mount_spec in volumes.items():
            if mount_spec.get("bind") == "/root/.claude/settings.json":
                settings_mount = mount_spec
                break

        assert settings_mount is not None, (
            "No volume binding found for /root/.claude/settings.json. "
            f"Volumes present: {list(volumes.values())}"
        )
        assert settings_mount.get("mode") == "ro", (
            f"settings.json mount mode is '{settings_mount.get('mode')}', expected 'ro'. "
            "A writable mount would allow the agent to tamper with hook config."
        )

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_hook_settings_bind_target_is_correct_path(self, mock_docker_env: MagicMock) -> None:
        """settings.json is mounted at exactly /root/.claude/settings.json.

        Claude Code reads hook config from this path. Any other path would be
        silently ignored, so the exact bind target matters.
        """
        mock_docker_env.return_value = self.mock_docker

        self.client.post(
            "/kubexes",
            json={"config": CLAUDE_CODE_CONFIG},
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )

        call_kwargs = self.mock_docker.containers.create.call_args
        volumes: dict[str, dict[str, str]] = (
            call_kwargs.kwargs.get("volumes") or call_kwargs[1].get("volumes", {})
        )

        bind_targets = [spec.get("bind") for spec in volumes.values()]
        assert "/root/.claude/settings.json" in bind_targets, (
            f"Expected /root/.claude/settings.json in bind targets. Got: {bind_targets}"
        )


# ===========================================================================
# E2E tests: Hook content verification via lifecycle direct call
# ===========================================================================


@_skip
class TestHookSettingsContent:
    """HOOK-CONTENT-01: Generated settings.json contains all required hook types.

    Tests that the file actually written and mounted contains valid hook config,
    not just that the mount exists.
    """

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_hook_settings_contains_all_hook_types(self, mock_docker_env: MagicMock) -> None:
        """settings.json file written by lifecycle contains all four hook event types.

        Verifies PostToolUse, Stop, SessionEnd, SubagentStop are present with
        type='http' and the correct harness URL.

        This is the file-content half of UAT Test 1:
          "Contents verified intact with all 4 hook types (PostToolUse, Stop,
           SessionEnd, SubagentStop) pointing at http://127.0.0.1:8099/hooks."
        """
        mock_docker = _make_mock_docker()
        mock_docker_env.return_value = mock_docker

        # Intercept _generate_hook_settings to capture the host path it returns,
        # then let the real function run so we can inspect the generated file.
        captured: dict[str, Any] = {}

        real_generate = _generate_hook_settings

        def _spy_generate(agent_id: str, output_dir: Path) -> Path:
            path = real_generate(agent_id, output_dir)
            captured["settings_path"] = path
            return path

        with tempfile.TemporaryDirectory() as tmpdir:
            # Override config dir so lifecycle writes into our temp dir
            lifecycle = KubexLifecycle()
            lifecycle._config_dir = Path(tmpdir) / "configs"

            with patch("kubex_manager.lifecycle._generate_hook_settings", side_effect=_spy_generate):
                request = CreateKubexRequest(config=CLAUDE_CODE_CONFIG)
                record = lifecycle.create_kubex(request)

            assert record is not None

            # File assertions must happen inside the tmpdir context (before cleanup)
            settings_path: Path | None = captured.get("settings_path")
            assert settings_path is not None, (
                "_generate_hook_settings was not called for claude-code runtime"
            )
            assert settings_path.exists(), f"settings.json host file not found at {settings_path}"

            content = json.loads(settings_path.read_text(encoding="utf-8"))
            hooks = content.get("hooks", {})

            required_types = ("PostToolUse", "Stop", "SessionEnd", "SubagentStop")
            for hook_type in required_types:
                assert hook_type in hooks, (
                    f"Missing hook type '{hook_type}' in generated settings.json. "
                    f"Present types: {list(hooks.keys())}"
                )

            # Verify every hook entry points at the harness
            for hook_type in required_types:
                for entry in hooks[hook_type]:
                    for hook in entry.get("hooks", []):
                        assert hook.get("type") == "http", (
                            f"{hook_type} hook type mismatch: got '{hook.get('type')}'"
                        )
                        assert hook.get("url") == "http://127.0.0.1:8099/hooks", (
                            f"{hook_type} hook URL mismatch: got '{hook.get('url')}'"
                        )


# ===========================================================================
# E2E tests: openai-api runtime does NOT receive settings.json mount
# ===========================================================================


@_skip
class TestNoHookSettingsForOpenAIRuntime:
    """HOOK-MOUNT-02: openai-api containers must NOT receive a settings.json mount.

    Claude Code settings.json is claude-code-specific. Mounting it on an
    openai-api container would be a no-op at best and misleading at worst.
    """

    def setup_method(self) -> None:
        self.mock_docker = _make_mock_docker()
        self.client = TestClient(manager_app, raise_server_exceptions=False)

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_hook_settings_not_mounted_for_openai_api(self, mock_docker_env: MagicMock) -> None:
        """Spawn an openai-api container — no settings.json bind mount present.

        Verifies the conditional runtime check in lifecycle.py correctly
        gates the hook mount on `runtime == 'claude-code'` only.
        """
        mock_docker_env.return_value = self.mock_docker

        resp = self.client.post(
            "/kubexes",
            json={"config": OPENAI_API_CONFIG},
            headers={"Authorization": "Bearer kubex-mgmt-token"},
        )
        assert resp.status_code == 201, f"Spawn failed: {resp.status_code} — {resp.text}"

        call_kwargs = self.mock_docker.containers.create.call_args
        volumes: dict[str, dict[str, str]] = (
            call_kwargs.kwargs.get("volumes") or call_kwargs[1].get("volumes", {})
        )

        # No bind target should be /root/.claude/settings.json
        settings_mounts = [
            (host, spec)
            for host, spec in volumes.items()
            if spec.get("bind") == "/root/.claude/settings.json"
        ]
        assert len(settings_mounts) == 0, (
            f"openai-api container received unexpected settings.json mount: {settings_mounts}"
        )

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_hook_settings_not_generated_for_openai_api(self, mock_docker_env: MagicMock) -> None:
        """_generate_hook_settings is not called when runtime is openai-api.

        Ensures no stale settings files are written for non-claude-code runtimes.
        """
        mock_docker_env.return_value = self.mock_docker

        with patch("kubex_manager.lifecycle._generate_hook_settings") as mock_gen:
            resp = self.client.post(
                "/kubexes",
                json={"config": OPENAI_API_CONFIG},
                headers={"Authorization": "Bearer kubex-mgmt-token"},
            )
            assert resp.status_code == 201

            mock_gen.assert_not_called()
