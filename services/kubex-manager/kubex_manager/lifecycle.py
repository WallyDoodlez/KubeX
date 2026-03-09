"""Kubex Manager lifecycle module — Docker SDK integration for agent containers.

Implements Stream 4A: container creation, start/stop/kill/restart,
Registry integration, and lifecycle event publishing.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import docker  # type: ignore[import]
import docker.errors  # type: ignore[import]
import httpx

from kubex_common.constants import NETWORK_INTERNAL
from kubex_common.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GATEWAY_URL_DEFAULT = "http://gateway:8080"
REGISTRY_URL_DEFAULT = "http://registry:8070"
KUBEX_LIFECYCLE_STREAM = "kubex:lifecycle"

# Default harness environment variables injected into every container
HARNESS_ENV_DEFAULTS: dict[str, str] = {
    "KUBEX_PROGRESS_BUFFER_MS": "500",
    "KUBEX_PROGRESS_MAX_CHUNK_KB": "16",
    "KUBEX_ABORT_KEYSTROKE": "\x03",  # Ctrl+C
    "KUBEX_ABORT_GRACE_PERIOD_S": "30",
}

# Resource limit defaults
DEFAULT_MEM_LIMIT = "1g"
DEFAULT_NANO_CPUS = 500_000_000  # 0.5 CPUs in nano-CPUs


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class KubexState(str, Enum):
    """Possible states of a managed Kubex container."""

    CREATED = "created"
    RUNNING = "running"
    STOPPED = "stopped"
    EXITED = "exited"
    UNHEALTHY = "unhealthy"
    DEAD = "dead"


@dataclass
class CreateKubexRequest:
    """Request body for creating a new Kubex container."""

    config: dict[str, Any]
    resource_limits: dict[str, Any] = field(default_factory=dict)
    image: str = "kubexclaw-base:latest"
    gateway_url: str = GATEWAY_URL_DEFAULT
    registry_url: str = REGISTRY_URL_DEFAULT


@dataclass
class KubexRecord:
    """In-memory record of a managed Kubex."""

    kubex_id: str
    agent_id: str
    boundary: str
    container_id: str
    status: str
    config: dict[str, Any]
    image: str


# ---------------------------------------------------------------------------
# Lifecycle manager
# ---------------------------------------------------------------------------


class KubexLifecycle:
    """Manages the Docker lifecycle of KubexClaw agent containers.

    Responsibilities:
    - Create containers with correct labels, env vars, network, resource limits
    - Register / deregister with the Registry on start / stop / kill
    - Publish lifecycle events to Redis db3 stream
    - Maintain an in-memory index of managed Kubexes
    """

    def __init__(
        self,
        gateway_url: str = GATEWAY_URL_DEFAULT,
        registry_url: str = REGISTRY_URL_DEFAULT,
        redis_client: Any | None = None,
    ) -> None:
        self.gateway_url = gateway_url
        self.registry_url = registry_url
        self._redis = redis_client
        # In-memory store: kubex_id -> KubexRecord
        self._kubexes: dict[str, KubexRecord] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_kubex(self, request: CreateKubexRequest) -> KubexRecord:
        """Create a Docker container for the given agent config.

        Sets Docker labels, env vars, network, and resource limits.
        Does NOT start the container.

        Args:
            request: CreateKubexRequest with agent config and options.

        Returns:
            KubexRecord describing the created container.

        Raises:
            ValueError: If the config is missing required fields.
            docker.errors.DockerException: If Docker is unavailable.
        """
        config = request.config
        agent_cfg = config.get("agent", {})
        agent_id = agent_cfg.get("id")
        boundary = agent_cfg.get("boundary", "default")

        if not agent_id:
            raise ValueError("Config missing required field: agent.id")

        providers: list[str] = agent_cfg.get("providers", [])

        # Build labels
        labels: dict[str, str] = {
            "kubex.agent_id": agent_id,
            "kubex.boundary": boundary,
            "kubex.managed": "true",
        }

        # Build environment variables
        env: dict[str, str] = {**HARNESS_ENV_DEFAULTS}

        # Inject Gateway URL (used by harness for progress posting)
        env["GATEWAY_URL"] = request.gateway_url

        # Inject provider BASE_URLs pointing at the Gateway proxy.
        # Containers MUST NOT receive raw API keys — they go through the proxy.
        if "anthropic" in providers:
            env["ANTHROPIC_BASE_URL"] = f"{request.gateway_url}/v1/proxy/anthropic"
        if "openai" in providers:
            env["OPENAI_BASE_URL"] = f"{request.gateway_url}/v1/proxy/openai"

        # Inject agent identity for the harness
        env["KUBEX_AGENT_ID"] = agent_id
        env["KUBEX_BOUNDARY"] = boundary

        # Inject Broker URL for standalone harness task consumption
        env["BROKER_URL"] = os.environ.get("BROKER_URL", "http://kubex-broker:8060")

        # Inject capabilities for the standalone harness consumer groups
        capabilities = agent_cfg.get("capabilities", [])
        if capabilities:
            env["KUBEX_CAPABILITIES"] = ",".join(capabilities)

        # Resource limits
        resource_limits = request.resource_limits
        mem_limit = resource_limits.get("memory", DEFAULT_MEM_LIMIT)
        cpus = resource_limits.get("cpus", 0.5)
        nano_cpus = int(float(cpus) * 1_000_000_000)

        # Credential volumes (bind-mount read-only for each provider)
        volumes: dict[str, dict[str, str]] = {}
        credentials_base = os.environ.get("KUBEX_CREDENTIALS_PATH", "/app/secrets/cli-credentials")
        for provider in providers:
            host_path = os.path.join(credentials_base, provider)
            container_path = f"/run/secrets/{provider}"
            if os.path.isdir(host_path):
                volumes[host_path] = {"bind": container_path, "mode": "ro"}

        # Create container via Docker SDK
        docker_client = docker.from_env()
        container = docker_client.containers.create(
            image=request.image,
            labels=labels,
            environment=env,
            network=os.environ.get("KUBEX_DOCKER_NETWORK", NETWORK_INTERNAL),
            mem_limit=mem_limit,
            nano_cpus=nano_cpus,
            volumes=volumes,
            detach=True,
        )

        kubex_id = str(uuid.uuid4())
        record = KubexRecord(
            kubex_id=kubex_id,
            agent_id=agent_id,
            boundary=boundary,
            container_id=container.id,
            status=KubexState.CREATED.value,
            config=config,
            image=request.image,
        )
        self._kubexes[kubex_id] = record

        logger.info(
            "kubex_created",
            kubex_id=kubex_id,
            agent_id=agent_id,
            container_id=container.id,
        )
        return record

    async def start_kubex(self, kubex_id: str) -> KubexRecord:
        """Start a created Kubex container and register with the Registry.

        Args:
            kubex_id: The kubex_id returned by create_kubex.

        Returns:
            Updated KubexRecord.

        Raises:
            KeyError: If kubex_id not found.
            docker.errors.DockerException: If Docker call fails.
        """
        record = self._get_record(kubex_id)
        docker_client = docker.from_env()
        container = docker_client.containers.get(record.container_id)
        container.start()

        record.status = KubexState.RUNNING.value

        # Register with Registry
        await self._register_with_registry(record)

        # Publish lifecycle event
        await self._publish_lifecycle_event(record, action="started")

        logger.info("kubex_started", kubex_id=kubex_id, agent_id=record.agent_id)
        return record

    async def stop_kubex(self, kubex_id: str) -> KubexRecord:
        """Gracefully stop a running Kubex container and deregister from Registry.

        Args:
            kubex_id: The kubex_id to stop.

        Returns:
            Updated KubexRecord.
        """
        record = self._get_record(kubex_id)
        docker_client = docker.from_env()
        container = docker_client.containers.get(record.container_id)
        container.stop()

        record.status = KubexState.STOPPED.value

        # Deregister from Registry
        await self._deregister_from_registry(record.agent_id)

        # Publish lifecycle event
        await self._publish_lifecycle_event(record, action="stopped")

        logger.info("kubex_stopped", kubex_id=kubex_id, agent_id=record.agent_id)
        return record

    async def kill_kubex(self, kubex_id: str) -> KubexRecord:
        """Force-kill a Kubex container and deregister from Registry.

        Args:
            kubex_id: The kubex_id to kill.

        Returns:
            Updated KubexRecord.
        """
        record = self._get_record(kubex_id)
        docker_client = docker.from_env()
        container = docker_client.containers.get(record.container_id)

        try:
            container.kill()
        except docker.errors.APIError:
            # Already exited or container doesn't support kill — try stop
            try:
                container.stop(timeout=0)
            except Exception:
                pass

        record.status = KubexState.DEAD.value

        # Deregister from Registry
        await self._deregister_from_registry(record.agent_id)

        # Publish lifecycle event
        await self._publish_lifecycle_event(record, action="killed")

        logger.info("kubex_killed", kubex_id=kubex_id, agent_id=record.agent_id)
        return record

    async def restart_kubex(self, kubex_id: str) -> KubexRecord:
        """Restart a Kubex container.

        Args:
            kubex_id: The kubex_id to restart.

        Returns:
            Updated KubexRecord.
        """
        record = self._get_record(kubex_id)
        docker_client = docker.from_env()
        container = docker_client.containers.get(record.container_id)
        container.restart()

        record.status = KubexState.RUNNING.value

        # Publish lifecycle event
        await self._publish_lifecycle_event(record, action="restarted")

        logger.info("kubex_restarted", kubex_id=kubex_id, agent_id=record.agent_id)
        return record

    def get_kubex(self, kubex_id: str) -> KubexRecord:
        """Get the current state of a Kubex.

        Refreshes status from Docker if available.

        Args:
            kubex_id: The kubex_id to look up.

        Returns:
            KubexRecord with current status.

        Raises:
            KeyError: If kubex_id not found.
        """
        record = self._get_record(kubex_id)
        # Try to refresh status from Docker
        try:
            docker_client = docker.from_env()
            container = docker_client.containers.get(record.container_id)
            docker_status = container.status
            # Map Docker status to KubexState
            if docker_status == "exited":
                record.status = KubexState.EXITED.value
            elif docker_status == "running":
                record.status = KubexState.RUNNING.value
            elif docker_status == "created":
                record.status = KubexState.CREATED.value
            else:
                record.status = docker_status
        except Exception:
            pass
        return record

    def list_kubexes(self) -> list[KubexRecord]:
        """List all managed Kubex containers.

        Returns:
            List of KubexRecord objects.
        """
        return list(self._kubexes.values())

    def remove_kubex(self, kubex_id: str) -> None:
        """Remove a Kubex record from the in-memory store.

        Args:
            kubex_id: The kubex_id to remove.
        """
        if kubex_id not in self._kubexes:
            raise KeyError(f"Kubex not found: {kubex_id}")
        del self._kubexes[kubex_id]

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_record(self, kubex_id: str) -> KubexRecord:
        """Retrieve a KubexRecord or raise KeyError."""
        if kubex_id not in self._kubexes:
            raise KeyError(f"Kubex not found: {kubex_id}")
        return self._kubexes[kubex_id]

    async def _register_with_registry(self, record: KubexRecord) -> None:
        """POST /agents to the Registry to register the agent."""
        agent_cfg = record.config.get("agent", {})
        capabilities: list[str] = agent_cfg.get("skills", [])

        payload = {
            "agent_id": record.agent_id,
            "boundary": record.boundary,
            "capabilities": capabilities,
            "status": "running",
            "accepts_from": [],
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self.registry_url}/agents",
                    json=payload,
                )
                if resp.status_code not in (200, 201, 409):
                    logger.warning(
                        "registry_register_failed",
                        agent_id=record.agent_id,
                        status=resp.status_code,
                    )
        except Exception as exc:
            logger.warning(
                "registry_register_error",
                agent_id=record.agent_id,
                error=str(exc),
            )

    async def _deregister_from_registry(self, agent_id: str) -> None:
        """DELETE /agents/{agent_id} from the Registry."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.delete(f"{self.registry_url}/agents/{agent_id}")
        except Exception as exc:
            logger.warning(
                "registry_deregister_error",
                agent_id=agent_id,
                error=str(exc),
            )

    async def _publish_lifecycle_event(self, record: KubexRecord, action: str) -> None:
        """Publish a lifecycle event to the Redis db3 stream."""
        if self._redis is None:
            return

        payload = {
            "agent_id": record.agent_id,
            "kubex_id": record.kubex_id,
            "action": action,
            "status": record.status,
            "boundary": record.boundary,
        }

        try:
            await self._redis.xadd(
                KUBEX_LIFECYCLE_STREAM,
                {"payload": json.dumps(payload)},
            )
        except Exception as exc:
            logger.warning(
                "lifecycle_event_publish_failed",
                kubex_id=record.kubex_id,
                action=action,
                error=str(exc),
            )
