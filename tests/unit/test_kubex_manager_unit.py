"""Unit tests for the Kubex Manager lifecycle module (Wave 4A).

Tests mock the Docker SDK so no real Docker daemon is required.
Coverage target: >=90% on services/kubex-manager/kubex_manager/lifecycle.py
"""

from __future__ import annotations

import json
import sys
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))

from kubex_manager.lifecycle import (
    KubexLifecycle,
    KubexRecord,
    KubexState,
    CreateKubexRequest,
    KUBEX_LIFECYCLE_STREAM,
    HARNESS_ENV_DEFAULTS,
)


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

SAMPLE_CONFIG: dict[str, Any] = {
    "agent": {
        "id": "test-agent",
        "boundary": "test-boundary",
        "providers": ["anthropic"],
        "skills": ["do_thing"],
    }
}

SCRAPER_CONFIG: dict[str, Any] = {
    "agent": {
        "id": "scraper",
        "boundary": "data-collection",
        "providers": ["anthropic", "openai"],
        "skills": ["scrape_profile"],
    }
}


def make_mock_docker() -> tuple[MagicMock, MagicMock]:
    """Return (mock_docker_client, mock_container)."""
    mock_container = MagicMock()
    mock_container.id = "deadbeef001"
    mock_container.status = "created"
    mock_docker = MagicMock()
    mock_docker.containers.create.return_value = mock_container
    mock_docker.containers.get.return_value = mock_container
    return mock_docker, mock_container


def make_lifecycle(**kwargs: Any) -> KubexLifecycle:
    """Create a KubexLifecycle instance with test defaults."""
    return KubexLifecycle(
        gateway_url="http://gateway:8080",
        registry_url="http://registry:8070",
        **kwargs,
    )


# ===========================================================================
# CreateKubexRequest
# ===========================================================================


class TestCreateKubexRequest:
    """Tests for the CreateKubexRequest dataclass."""

    def test_defaults(self) -> None:
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        assert req.image == "kubexclaw-base:latest"
        assert req.resource_limits == {}
        assert req.gateway_url == "http://gateway:8080"

    def test_custom_image(self) -> None:
        req = CreateKubexRequest(config=SAMPLE_CONFIG, image="custom:v1")
        assert req.image == "custom:v1"

    def test_resource_limits(self) -> None:
        req = CreateKubexRequest(config=SAMPLE_CONFIG, resource_limits={"memory": "2g"})
        assert req.resource_limits["memory"] == "2g"


# ===========================================================================
# KubexState
# ===========================================================================


class TestKubexState:
    """KubexState enum values match expected Docker status strings."""

    def test_state_values(self) -> None:
        assert KubexState.CREATED.value == "created"
        assert KubexState.RUNNING.value == "running"
        assert KubexState.STOPPED.value == "stopped"
        assert KubexState.EXITED.value == "exited"
        assert KubexState.UNHEALTHY.value == "unhealthy"
        assert KubexState.DEAD.value == "dead"


# ===========================================================================
# KubexLifecycle.create_kubex
# ===========================================================================


class TestKubexLifecycleCreate:
    """Unit tests for KubexLifecycle.create_kubex."""

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_returns_record(self, mock_docker_env: MagicMock) -> None:
        """create_kubex returns a KubexRecord with correct agent_id and boundary."""
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        record = lifecycle.create_kubex(req)

        assert isinstance(record, KubexRecord)
        assert record.agent_id == "test-agent"
        assert record.boundary == "test-boundary"
        assert record.status == KubexState.CREATED.value

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_raises_on_missing_agent_id(self, mock_docker_env: MagicMock) -> None:
        """create_kubex raises ValueError when agent.id is missing."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config={"agent": {}})
        with pytest.raises(ValueError, match="agent.id"):
            lifecycle.create_kubex(req)

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_sets_kubex_labels(self, mock_docker_env: MagicMock) -> None:
        """Created container has kubex.agent_id and kubex.boundary labels."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        labels = call_kwargs.kwargs.get("labels") or call_kwargs[1].get("labels", {})
        assert labels["kubex.agent_id"] == "test-agent"
        assert labels["kubex.boundary"] == "test-boundary"
        assert labels["kubex.managed"] == "true"

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_injects_anthropic_base_url(self, mock_docker_env: MagicMock) -> None:
        """Anthropic provider gets ANTHROPIC_BASE_URL pointing to Gateway proxy."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG, gateway_url="http://gateway:8080")
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        env = call_kwargs.kwargs.get("environment") or call_kwargs[1].get("environment", {})
        assert "ANTHROPIC_BASE_URL" in env
        assert "proxy/anthropic" in env["ANTHROPIC_BASE_URL"]
        assert "ANTHROPIC_API_KEY" not in env  # No raw keys in containers

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_injects_openai_base_url(self, mock_docker_env: MagicMock) -> None:
        """OpenAI provider gets OPENAI_BASE_URL pointing to Gateway proxy."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SCRAPER_CONFIG)
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        env = call_kwargs.kwargs.get("environment") or call_kwargs[1].get("environment", {})
        assert "OPENAI_BASE_URL" in env
        assert "proxy/openai" in env["OPENAI_BASE_URL"]

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_injects_harness_env_defaults(self, mock_docker_env: MagicMock) -> None:
        """All required harness env vars are injected into the container."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        env = call_kwargs.kwargs.get("environment") or call_kwargs[1].get("environment", {})
        for var in HARNESS_ENV_DEFAULTS:
            assert var in env, f"Missing harness env var: {var}"
        assert "GATEWAY_URL" in env
        assert "KUBEX_AGENT_ID" in env
        assert "KUBEX_BOUNDARY" in env

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_uses_kubex_internal_network(self, mock_docker_env: MagicMock) -> None:
        """Container is attached to the kubex-internal network."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        network = call_kwargs.kwargs.get("network") or call_kwargs[1].get("network", "")
        assert "kubex" in network.lower()

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_applies_default_resource_limits(self, mock_docker_env: MagicMock) -> None:
        """Default resource limits (mem_limit, nano_cpus) are applied."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        kwargs = call_kwargs.kwargs or call_kwargs[1]
        assert "mem_limit" in kwargs
        assert "nano_cpus" in kwargs

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_applies_custom_resource_limits(self, mock_docker_env: MagicMock) -> None:
        """Custom resource limits override defaults."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(
            config=SAMPLE_CONFIG,
            resource_limits={"memory": "4g", "cpus": 2.0},
        )
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        kwargs = call_kwargs.kwargs or call_kwargs[1]
        assert kwargs.get("mem_limit") == "4g"
        assert kwargs.get("nano_cpus") == 2_000_000_000

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_mounts_provider_credentials_read_only(self, mock_docker_env: MagicMock) -> None:
        """CLI credential directories are bind-mounted read-only."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        volumes = call_kwargs.kwargs.get("volumes") or call_kwargs[1].get("volumes", {})
        has_readonly = any(
            "ro" in str(v) or (isinstance(v, dict) and v.get("mode") == "ro")
            for v in (volumes.values() if isinstance(volumes, dict) else volumes)
        )
        assert has_readonly

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_adds_to_internal_registry(self, mock_docker_env: MagicMock) -> None:
        """Created kubex is added to the in-memory store."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        record = lifecycle.create_kubex(req)

        assert record.kubex_id in lifecycle._kubexes
        assert lifecycle._kubexes[record.kubex_id] is record

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_multiple_kubexes_have_distinct_ids(self, mock_docker_env: MagicMock) -> None:
        """Multiple create calls produce unique kubex_ids."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req1 = CreateKubexRequest(config=SAMPLE_CONFIG)
        req2 = CreateKubexRequest(config=SCRAPER_CONFIG)

        r1 = lifecycle.create_kubex(req1)
        r2 = lifecycle.create_kubex(req2)

        assert r1.kubex_id != r2.kubex_id

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_create_raises_docker_exception_propagates(self, mock_docker_env: MagicMock) -> None:
        """DockerException from containers.create propagates to caller."""
        import docker.errors

        mock_docker, _ = make_mock_docker()
        mock_docker.containers.create.side_effect = docker.errors.DockerException("daemon gone")
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        req = CreateKubexRequest(config=SAMPLE_CONFIG)
        with pytest.raises(docker.errors.DockerException):
            lifecycle.create_kubex(req)


# ===========================================================================
# KubexLifecycle.start_kubex
# ===========================================================================


class TestKubexLifecycleStart:
    """Unit tests for KubexLifecycle.start_kubex."""

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_start_calls_container_start(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """start_kubex calls container.start() on the Docker container object."""
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        await lifecycle.start_kubex(record.kubex_id)

        mock_container.start.assert_called_once()

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_start_updates_status_to_running(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """start_kubex updates the record status to 'running'."""
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        updated = await lifecycle.start_kubex(record.kubex_id)

        assert updated.status == KubexState.RUNNING.value

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_start_posts_to_registry(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """start_kubex POSTs to the Registry /agents endpoint."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        await lifecycle.start_kubex(record.kubex_id)

        post_calls = mock_http_client.post.call_args_list
        registry_calls = [c for c in post_calls if "/agents" in str(c)]
        assert len(registry_calls) >= 1

    @pytest.mark.asyncio
    async def test_start_raises_key_error_for_unknown_id(self) -> None:
        """start_kubex raises KeyError for an unknown kubex_id."""
        lifecycle = make_lifecycle()
        with pytest.raises(KeyError):
            await lifecycle.start_kubex("nonexistent-id")


# ===========================================================================
# KubexLifecycle.stop_kubex
# ===========================================================================


class TestKubexLifecycleStop:
    """Unit tests for KubexLifecycle.stop_kubex."""

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_stop_calls_container_stop(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """stop_kubex calls container.stop() on the Docker container object."""
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        await lifecycle.stop_kubex(record.kubex_id)

        mock_container.stop.assert_called_once()

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_stop_updates_status_to_stopped(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """stop_kubex updates the record status to 'stopped'."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        updated = await lifecycle.stop_kubex(record.kubex_id)

        assert updated.status == KubexState.STOPPED.value

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_stop_calls_registry_delete(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """stop_kubex DELETEs the agent from the Registry."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        await lifecycle.stop_kubex(record.kubex_id)

        delete_calls = mock_http_client.delete.call_args_list
        assert any("/agents/" in str(c) for c in delete_calls)


# ===========================================================================
# KubexLifecycle.kill_kubex
# ===========================================================================


class TestKubexLifecycleKill:
    """Unit tests for KubexLifecycle.kill_kubex."""

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_kill_calls_container_kill(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """kill_kubex calls container.kill() or container.stop()."""
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        await lifecycle.kill_kubex(record.kubex_id)

        assert mock_container.kill.called or mock_container.stop.called

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_kill_sets_status_dead(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """kill_kubex sets the record status to 'dead'."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        updated = await lifecycle.kill_kubex(record.kubex_id)

        assert updated.status == KubexState.DEAD.value

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_kill_falls_back_on_api_error(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """kill_kubex falls back to stop() if container.kill() raises APIError."""
        import docker.errors

        mock_docker, mock_container = make_mock_docker()
        mock_container.kill.side_effect = docker.errors.APIError("already stopped")
        mock_docker_env.return_value = mock_docker

        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        updated = await lifecycle.kill_kubex(record.kubex_id)

        # Should not raise; stop() was called as fallback
        assert updated.status == KubexState.DEAD.value
        mock_container.stop.assert_called()


# ===========================================================================
# KubexLifecycle.restart_kubex
# ===========================================================================


class TestKubexLifecycleRestart:
    """Unit tests for KubexLifecycle.restart_kubex."""

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_restart_calls_container_restart(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """restart_kubex calls container.restart()."""
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_http_client = AsyncMock()
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        await lifecycle.restart_kubex(record.kubex_id)

        mock_container.restart.assert_called_once()

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @patch("kubex_manager.lifecycle.docker.from_env")
    @pytest.mark.asyncio
    async def test_restart_status_becomes_running(
        self, mock_docker_env: MagicMock, mock_httpx: MagicMock
    ) -> None:
        """restart_kubex sets status to 'running'."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        mock_http_client = AsyncMock()
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        updated = await lifecycle.restart_kubex(record.kubex_id)

        assert updated.status == KubexState.RUNNING.value


# ===========================================================================
# KubexLifecycle.get_kubex / list_kubexes / remove_kubex
# ===========================================================================


class TestKubexLifecycleQuery:
    """Unit tests for get_kubex, list_kubexes, and remove_kubex."""

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_get_kubex_returns_record(self, mock_docker_env: MagicMock) -> None:
        """get_kubex returns the KubexRecord for a known kubex_id."""
        mock_docker, mock_container = make_mock_docker()
        mock_container.status = "running"
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        fetched = lifecycle.get_kubex(record.kubex_id)

        assert fetched.kubex_id == record.kubex_id
        assert fetched.agent_id == "test-agent"

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_get_kubex_refreshes_status_from_docker(self, mock_docker_env: MagicMock) -> None:
        """get_kubex refreshes status from Docker container state."""
        mock_docker, mock_container = make_mock_docker()
        mock_container.status = "exited"  # container has exited
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        fetched = lifecycle.get_kubex(record.kubex_id)

        assert fetched.status == KubexState.EXITED.value

    def test_get_kubex_raises_key_error_for_unknown(self) -> None:
        """get_kubex raises KeyError for an unknown kubex_id."""
        lifecycle = make_lifecycle()
        with pytest.raises(KeyError):
            lifecycle.get_kubex("bogus-id")

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_list_kubexes_empty(self, mock_docker_env: MagicMock) -> None:
        """list_kubexes returns empty list when no kubexes created."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        assert lifecycle.list_kubexes() == []

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_list_kubexes_returns_all(self, mock_docker_env: MagicMock) -> None:
        """list_kubexes returns all created kubexes."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        r1 = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        r2 = lifecycle.create_kubex(CreateKubexRequest(config=SCRAPER_CONFIG))

        all_kubexes = lifecycle.list_kubexes()
        assert len(all_kubexes) == 2
        ids = {r.kubex_id for r in all_kubexes}
        assert r1.kubex_id in ids
        assert r2.kubex_id in ids

    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_remove_kubex_deletes_from_store(self, mock_docker_env: MagicMock) -> None:
        """remove_kubex removes the record from the internal store."""
        mock_docker, _ = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()
        record = lifecycle.create_kubex(CreateKubexRequest(config=SAMPLE_CONFIG))
        lifecycle.remove_kubex(record.kubex_id)

        assert len(lifecycle.list_kubexes()) == 0

    def test_remove_kubex_raises_key_error_for_unknown(self) -> None:
        """remove_kubex raises KeyError for an unknown kubex_id."""
        lifecycle = make_lifecycle()
        with pytest.raises(KeyError):
            lifecycle.remove_kubex("bogus-id")


# ===========================================================================
# KubexLifecycle._publish_lifecycle_event
# ===========================================================================


class TestKubexLifecycleEvents:
    """Unit tests for lifecycle event publishing."""

    @pytest.mark.asyncio
    async def test_publish_event_skipped_without_redis(self) -> None:
        """_publish_lifecycle_event is a no-op when no Redis client is configured."""
        lifecycle = make_lifecycle()
        record = KubexRecord(
            kubex_id="k1",
            agent_id="agent",
            boundary="test",
            container_id="c1",
            status="created",
            config={},
            image="test:latest",
        )
        # Should not raise
        await lifecycle._publish_lifecycle_event(record, action="created")

    @pytest.mark.asyncio
    async def test_publish_event_calls_xadd(self) -> None:
        """_publish_lifecycle_event calls redis.xadd with correct stream name."""
        mock_redis = AsyncMock()
        lifecycle = make_lifecycle(redis_client=mock_redis)
        record = KubexRecord(
            kubex_id="k1",
            agent_id="my-agent",
            boundary="test",
            container_id="c1",
            status="created",
            config={},
            image="test:latest",
        )

        await lifecycle._publish_lifecycle_event(record, action="created")

        mock_redis.xadd.assert_called_once()
        call_args = mock_redis.xadd.call_args
        stream_name = call_args.args[0] if call_args.args else call_args[0][0]
        assert stream_name == KUBEX_LIFECYCLE_STREAM

    @pytest.mark.asyncio
    async def test_publish_event_payload_contains_agent_id(self) -> None:
        """Event payload contains agent_id, action, and kubex_id."""
        mock_redis = AsyncMock()
        lifecycle = make_lifecycle(redis_client=mock_redis)
        record = KubexRecord(
            kubex_id="k1",
            agent_id="my-agent",
            boundary="test",
            container_id="c1",
            status="created",
            config={},
            image="test:latest",
        )

        await lifecycle._publish_lifecycle_event(record, action="created")

        call_args = mock_redis.xadd.call_args
        fields = call_args.args[1] if len(call_args.args) > 1 else call_args[0][1]
        payload = json.loads(fields["payload"])
        assert payload["agent_id"] == "my-agent"
        assert payload["action"] == "created"
        assert payload["kubex_id"] == "k1"

    @pytest.mark.asyncio
    async def test_publish_event_handles_redis_error_gracefully(self) -> None:
        """If Redis xadd raises, the error is swallowed (best-effort)."""
        mock_redis = AsyncMock()
        mock_redis.xadd.side_effect = Exception("redis connection refused")
        lifecycle = make_lifecycle(redis_client=mock_redis)
        record = KubexRecord(
            kubex_id="k1",
            agent_id="agent",
            boundary="test",
            container_id="c1",
            status="created",
            config={},
            image="test:latest",
        )
        # Should not raise
        await lifecycle._publish_lifecycle_event(record, action="created")


# ===========================================================================
# Registry helper methods
# ===========================================================================


class TestKubexRegistryHelpers:
    """Unit tests for _register_with_registry and _deregister_from_registry."""

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @pytest.mark.asyncio
    async def test_register_posts_to_registry(self, mock_httpx: MagicMock) -> None:
        """_register_with_registry POSTs agent_id, capabilities, and status."""
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = KubexRecord(
            kubex_id="k1",
            agent_id="my-agent",
            boundary="default",
            container_id="c1",
            status="running",
            config={"agent": {"capabilities": ["cap-a"]}},
            image="test:latest",
        )

        await lifecycle._register_with_registry(record)

        post_calls = mock_http_client.post.call_args_list
        assert len(post_calls) == 1
        call_body = post_calls[0].kwargs.get("json") or post_calls[0][1].get("json", {})
        assert call_body["agent_id"] == "my-agent"
        assert call_body["capabilities"] == ["cap-a"]
        assert "running" in str(call_body)

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @pytest.mark.asyncio
    async def test_register_handles_network_error_gracefully(self, mock_httpx: MagicMock) -> None:
        """_register_with_registry swallows network errors (best-effort)."""
        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        record = KubexRecord(
            kubex_id="k1",
            agent_id="agent",
            boundary="default",
            container_id="c1",
            status="running",
            config={},
            image="test:latest",
        )
        # Should not raise
        await lifecycle._register_with_registry(record)

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @pytest.mark.asyncio
    async def test_deregister_deletes_from_registry(self, mock_httpx: MagicMock) -> None:
        """_deregister_from_registry DELETEs the agent from the Registry."""
        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        await lifecycle._deregister_from_registry("my-agent")

        delete_calls = mock_http_client.delete.call_args_list
        assert len(delete_calls) == 1
        url = delete_calls[0].args[0] if delete_calls[0].args else delete_calls[0][0][0]
        assert "/agents/my-agent" in url

    @patch("kubex_manager.lifecycle.httpx.AsyncClient")
    @pytest.mark.asyncio
    async def test_deregister_handles_network_error_gracefully(self, mock_httpx: MagicMock) -> None:
        """_deregister_from_registry swallows network errors (best-effort)."""
        mock_http_client = AsyncMock()
        mock_http_client.delete = AsyncMock(side_effect=Exception("connection refused"))
        mock_httpx.return_value.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_httpx.return_value.__aexit__ = AsyncMock(return_value=None)

        lifecycle = make_lifecycle()
        # Should not raise
        await lifecycle._deregister_from_registry("agent")


# ===========================================================================
# Phase 5 — Skill bind mounts (SKIL-02)
# ===========================================================================


class TestSkillBindMounts:
    """SKIL-02: create_kubex() bind-mounts skill directories into the container."""

    @pytest.mark.xfail(
        reason=(
            "SKIL-02: skill bind mount not yet implemented in create_kubex() — "
            "CreateKubexRequest does not yet accept skill_mounts; lands in plan 05-02"
        )
    )
    @patch("kubex_manager.lifecycle.docker.from_env")
    def test_bind_mounts_skills(self, mock_docker_env: MagicMock) -> None:
        """create_kubex() adds read-only bind mounts for each skill directory.

        Expected Docker SDK volumes dict pattern:
            {
                "/path/to/skills/web-scraping": {
                    "bind": "/app/skills/web-scraping",
                    "mode": "ro",
                },
                "/path/to/skills/recall": {
                    "bind": "/app/skills/recall",
                    "mode": "ro",
                },
            }
        """
        mock_docker, mock_container = make_mock_docker()
        mock_docker_env.return_value = mock_docker

        lifecycle = make_lifecycle()

        # CreateKubexRequest will gain a skill_mounts field in 05-02.
        # Pass skill names; the lifecycle resolves them to host paths via a
        # configured skills_base_dir (e.g. /var/kubex/skills).
        req = CreateKubexRequest(
            config=SAMPLE_CONFIG,
            skill_mounts=["web-scraping", "recall"],
        )
        lifecycle.create_kubex(req)

        call_kwargs = mock_docker.containers.create.call_args
        volumes = call_kwargs.kwargs.get("volumes") or call_kwargs[1].get("volumes", {})

        # Verify each skill gets its own bind mount at /app/skills/{skill-name}
        container_paths = []
        if isinstance(volumes, dict):
            for _host_path, spec in volumes.items():
                if isinstance(spec, dict) and spec.get("bind", "").startswith("/app/skills/"):
                    container_paths.append(spec["bind"])
                    assert spec.get("mode") == "ro", (
                        f"Skill mount {spec['bind']} must be read-only"
                    )

        assert "/app/skills/web-scraping" in container_paths, (
            "Expected /app/skills/web-scraping bind mount not found in Docker volumes"
        )
        assert "/app/skills/recall" in container_paths, (
            "Expected /app/skills/recall bind mount not found in Docker volumes"
        )
