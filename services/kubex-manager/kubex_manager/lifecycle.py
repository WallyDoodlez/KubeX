"""Kubex Manager lifecycle module — Docker SDK integration for agent containers.

Implements Stream 4A: container creation, start/stop/kill/restart,
Registry integration, and lifecycle event publishing.
"""

from __future__ import annotations

import contextlib
import json
import os
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

import docker  # type: ignore[import]
import docker.errors  # type: ignore[import]
import httpx
from kubex_common.logging import get_logger

from .skill_validator import SkillValidator

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Host path translation
# ---------------------------------------------------------------------------


def _to_host_path(container_path: str) -> str:
    """Translate a Manager-internal /app/... path to a host-side path.

    The Manager container mounts the project root at /app/. When creating
    child containers, bind mount sources must reference the HOST filesystem,
    not the Manager's internal filesystem. KUBEX_HOST_PROJECT_DIR maps /app
    to the host project root.

    Falls back to the container path if env var is not set (works on Linux
    when paths happen to match).
    """
    host_root = os.environ.get("KUBEX_HOST_PROJECT_DIR", "")
    if not host_root:
        return container_path
    # Replace /app/ prefix with host root
    if container_path.startswith("/app/"):
        return os.path.join(host_root, container_path[5:])  # skip "/app/"
    return container_path


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

# Credential mount paths per CLI runtime type (CLI-06)
CLI_CREDENTIAL_MOUNTS: dict[str, str] = {
    "claude-code": "/root/.claude",
    "codex-cli": "/root/.codex",
    "gemini-cli": "/root/.config/gemini",
}


# ---------------------------------------------------------------------------
# Hook config helpers
# ---------------------------------------------------------------------------


def _generate_hook_settings(agent_id: str, output_dir: Path) -> Path:
    """Generate ~/.claude/settings.json with HTTP hook config (HOOK-02, D-08).

    Creates a settings.json file with type:http hooks for PostToolUse, Stop,
    SessionEnd, and SubagentStop, all pointing at the harness hook server at
    http://127.0.0.1:8099/hooks.

    Returns the host-side path to the generated file. This file is bind-mounted
    read-only at /root/.claude/settings.json inside the container.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    hook_entry = [{"hooks": [{"type": "http", "url": "http://127.0.0.1:8099/hooks", "timeout": 10}]}]
    settings = {
        "hooks": {
            "PostToolUse": hook_entry,
            "Stop": [{"hooks": [{"type": "http", "url": "http://127.0.0.1:8099/hooks", "timeout": 10}]}],
            "SessionEnd": [{"hooks": [{"type": "http", "url": "http://127.0.0.1:8099/hooks", "timeout": 10}]}],
            "SubagentStop": [{"hooks": [{"type": "http", "url": "http://127.0.0.1:8099/hooks", "timeout": 10}]}],
        }
    }
    settings_path = output_dir / f"{agent_id}-claude-settings.json"
    settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings_path


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class KubexState(StrEnum):
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
    skill_mounts: list[str] = field(default_factory=list)


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
    # Phase 6 extended fields (KMGR-04)
    skills: list[str] = field(default_factory=list)
    config_path: str | None = None
    runtime_deps: list[str] = field(default_factory=list)
    composed_capabilities: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialize KubexRecord to a JSON-serializable dict."""
        return {
            "kubex_id": self.kubex_id,
            "agent_id": self.agent_id,
            "boundary": self.boundary,
            "container_id": self.container_id,
            "status": self.status,
            "config": self.config,
            "image": self.image,
            "skills": self.skills,
            "config_path": self.config_path,
            "runtime_deps": self.runtime_deps,
            "composed_capabilities": self.composed_capabilities,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> KubexRecord:
        """Reconstruct a KubexRecord from a serialized dict."""
        return cls(
            kubex_id=data["kubex_id"],
            agent_id=data["agent_id"],
            boundary=data["boundary"],
            container_id=data["container_id"],
            status=data["status"],
            config=data.get("config", {}),
            image=data["image"],
            skills=data.get("skills", []),
            config_path=data.get("config_path"),
            runtime_deps=data.get("runtime_deps", []),
            composed_capabilities=data.get("composed_capabilities", []),
        )


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
        # Persistent config directory (overridable for tests)
        self._config_dir: Path = Path(os.environ.get("KUBEX_CONFIG_DIR", "/app/configs"))
        # Track the last config path written during spawn (used for rollback inspection)
        self._pending_config_path: Path | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _resolve_internal_network(self, docker_client: Any) -> str:
        """Resolve the internal Docker network name via label lookup (KMGR-05).

        Looks for a network with label ``kubex.network=internal``. This avoids
        hardcoding the network name or relying on an env var that may be stale.

        Args:
            docker_client: A Docker SDK client with ``networks.list()`` support.

        Returns:
            The name of the first network matching the label.

        Raises:
            RuntimeError: If no network with the label is found. Run
                ``docker network create --label kubex.network=internal <name>``
                or ensure docker-compose.yml labels the kubex-internal network.
        """
        networks = docker_client.networks.list(filters={"label": "kubex.network=internal"})
        if not networks:
            raise RuntimeError(
                "No Docker network with label 'kubex.network=internal' found. "
                "Ensure the kubex-internal network is labelled in docker-compose.yml: "
                "labels: { kubex.network: internal }"
            )
        return networks[0].name

    def load_from_redis(self) -> None:
        """Load KubexRecords from Redis into the in-memory store on Manager restart (KMGR-04).

        Uses synchronous Redis keys() / get() to recover state without requiring
        the Manager to re-create containers it already knows about.
        """
        if self._redis is None:
            return

        try:
            keys = self._redis.keys("kubex:record:*")
        except Exception as exc:
            logger.warning("redis_load_failed", error=str(exc))
            return

        for key in keys:
            try:
                raw = self._redis.get(key)
                if raw is None:
                    continue
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8")
                data = json.loads(raw)
                record = KubexRecord.from_dict(data)
                self._kubexes[record.kubex_id] = record
            except Exception as exc:
                logger.warning("redis_record_load_failed", key=str(key), error=str(exc))

        logger.info("kubex_records_loaded_from_redis", count=len(self._kubexes))

    def create_kubex(self, request: CreateKubexRequest) -> KubexRecord:
        """Create a Docker container for the given agent config.

        Implements an 8-step atomic spawn pipeline with full rollback on failure.

        Pipeline:
            1. Validate agent config
            2. SkillResolver.resolve_from_config() (if skills in config)
            3. ConfigBuilder.build() — writes config.yaml to disk
            4. POST /policy/skill-check to Gateway (skipped when gateway unreachable in test mode)
            5. config.yaml already written by step 3
            6. Docker container create (config.yaml bind-mounted + skill mounts)
            7. Persist KubexRecord to Redis (if redis client available)
            8. Return record

        On any failure: remove container + config file (rollback).

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

        # Step 1: Validate agent config
        if not agent_id:
            raise ValueError("Config missing required field: agent.id")

        providers: list[str] = agent_cfg.get("providers", [])

        # Rollback state tracking
        config_path: Path | None = None
        container_id: str | None = None

        try:
            # Step 2: SkillResolver.resolve_from_config() (optional if no skills in config)
            skill_names: list[str] = agent_cfg.get("skills", []) or config.get("skills", [])
            composed_capabilities: list[str] = list(agent_cfg.get("capabilities", []))
            skills_resolved: list[str] = skill_names
            skills_built: bool = False  # True only when ConfigBuilder ran successfully

            # Step 2+3: Skill resolution and config build (when skills are available)
            if skill_names:
                skills_base = Path(os.environ.get("KUBEX_SKILLS_PATH", "/app/skills"))
                # Attempt full skill resolution + ConfigBuilder only when all skill dirs exist
                if skills_base.is_dir() and all((skills_base / s).is_dir() for s in skill_names):
                    try:
                        from .skill_resolver import SkillResolver

                        resolver = SkillResolver()
                        composed = resolver.resolve_from_config(
                            {**config, "skills": skill_names},
                            skills_base,
                        )
                        composed_capabilities = list(composed.capabilities)
                        skills_resolved = list(composed.ordered_skill_names)

                        from .config_builder import ConfigBuilder

                        config_dir = self._config_dir
                        builder = ConfigBuilder()
                        config_path = builder.build(
                            agent_config=config,
                            composed=composed,
                            skill_dir=skills_base,
                            output_dir=config_dir,
                        )
                        skills_built = True
                    except Exception as exc:
                        if "ConfigBuildError" in type(exc).__name__:
                            raise
                        logger.warning("skill_config_build_skipped", error=str(exc))
                else:
                    logger.info(
                        "skill_config_build_skipped_missing_dirs",
                        skills_base=str(skills_base),
                        skills=skill_names,
                    )

            # Always write a config.yaml for the container (KMGR-03)
            # If ConfigBuilder didn't write one above, write the raw config dict.
            if config_path is None:
                import tempfile

                import yaml as _yaml

                config_dir = self._config_dir
                try:
                    config_dir.mkdir(parents=True, exist_ok=True)
                    config_path = config_dir / f"{agent_id}.yaml"
                    config_path.write_text(_yaml.dump(config, default_flow_style=False), encoding="utf-8")
                except Exception:
                    # Fall back to system temp dir (for test environments without /app/configs)
                    try:
                        tmp_dir = Path(tempfile.gettempdir()) / "kubex_configs"
                        tmp_dir.mkdir(parents=True, exist_ok=True)
                        config_path = tmp_dir / f"{agent_id}.yaml"
                        config_path.write_text(_yaml.dump(config, default_flow_style=False), encoding="utf-8")
                    except Exception as exc2:
                        logger.warning("config_yaml_write_failed", error=str(exc2))
                        config_path = None

            # Step 4: POST /policy/skill-check to Gateway (only when skills were fully resolved)
            # Skipped in test environments or when skills dir was not found.
            if skills_built and skill_names and config_path is not None:
                try:
                    with httpx.Client(timeout=2.0) as client:
                        resp = client.post(
                            f"{self.gateway_url}/policy/skill-check",
                            json={"agent_id": agent_id, "skills": skill_names},
                        )
                        if resp.status_code == 200:
                            result = resp.json()
                            if result.get("decision") == "escalate":
                                logger.warning(
                                    "skill_check_escalated",
                                    agent_id=agent_id,
                                    skills=skill_names,
                                    reason=result.get("reason"),
                                )
                except Exception as exc:
                    # Gateway unreachable — log and continue (test environments, etc.)
                    logger.warning("skill_check_gateway_unreachable", error=str(exc))

            # Step 5: config.yaml already written by ConfigBuilder in step 3

            # Build labels
            labels: dict[str, str] = {
                "kubex.agent_id": agent_id,
                "kubex.boundary": boundary,
                "kubex.managed": "true",
            }

            # Build environment variables
            env: dict[str, str] = {**HARNESS_ENV_DEFAULTS}
            env["GATEWAY_URL"] = request.gateway_url
            if "anthropic" in providers:
                env["ANTHROPIC_BASE_URL"] = f"{request.gateway_url}/v1/proxy/anthropic"
            if "openai" in providers:
                env["OPENAI_BASE_URL"] = f"{request.gateway_url}/v1/proxy/openai"
            env["KUBEX_AGENT_ID"] = agent_id
            env["KUBEX_BOUNDARY"] = boundary
            env["BROKER_URL"] = os.environ.get("BROKER_URL", "http://kubex-broker:8060")

            capabilities = agent_cfg.get("capabilities", [])
            if capabilities:
                env["KUBEX_CAPABILITIES"] = ",".join(capabilities)

            # Boot-time pip deps for CLI runtimes (pexpect for PTY, watchfiles for credential watch)
            runtime = agent_cfg.get("runtime", "openai-api")
            if runtime != "openai-api":
                existing_pip_deps = env.get("KUBEX_PIP_DEPS", "")
                cli_deps = "pexpect watchfiles"
                env["KUBEX_PIP_DEPS"] = f"{existing_pip_deps} {cli_deps}".strip()

            # Resource limits
            resource_limits = request.resource_limits
            mem_limit = resource_limits.get("memory", DEFAULT_MEM_LIMIT)
            cpus = resource_limits.get("cpus", 0.5)
            nano_cpus = int(float(cpus) * 1_000_000_000)

            # Volumes
            volumes: dict[str, dict[str, str]] = {}
            credentials_base = os.environ.get("KUBEX_CREDENTIALS_PATH", "/app/secrets/cli-credentials")
            for provider in providers:
                host_path = _to_host_path(os.path.join(credentials_base, provider))
                container_path = f"/run/secrets/{provider}"
                volumes[host_path] = {"bind": container_path, "mode": "ro"}

            # Bind-mount config.yaml at /app/config.yaml (KMGR-03)
            if config_path is not None and config_path.exists():
                volumes[_to_host_path(str(config_path))] = {"bind": "/app/config.yaml", "mode": "ro"}

            # Skill volumes (SKIL-02): bind-mount skill directories read-only
            if request.skill_mounts:
                skills_base_path = os.environ.get("KUBEX_SKILLS_PATH", "/app/skills")

                # Skill content validation (SKIL-04)
                blocklist_path = Path(__file__).parent / "blocklist.yaml"
                validator = SkillValidator(blocklist_path=blocklist_path)
                for skill_name in request.skill_mounts:
                    host_skill_path = os.path.join(skills_base_path, skill_name)
                    skill_md_path = Path(host_skill_path) / "SKILL.md"
                    if not skill_md_path.exists():
                        raise ValueError(f"Skill directory not found or missing SKILL.md: {host_skill_path}")
                    content = skill_md_path.read_text(encoding="utf-8")
                    verdict = validator.validate_skill_md(skill_name, content)
                    if not verdict.is_clean:
                        raise ValueError(f"Skill '{skill_name}' failed validation: {verdict.detected_patterns}")

                for skill_name in request.skill_mounts:
                    host_skill_path = os.path.join(skills_base_path, skill_name)
                    container_skill_path = f"/app/skills/{skill_name}"
                    volumes[_to_host_path(host_skill_path)] = {"bind": container_skill_path, "mode": "ro"}

            # Named Docker volume for CLI runtime credential persistence (CLI-06)
            # Named volumes use the volume name as key (not a host path).
            # Docker SDK creates the volume automatically if it doesn't exist.
            cred_mount = CLI_CREDENTIAL_MOUNTS.get(runtime)
            if cred_mount is not None:
                volume_name = f"kubex-creds-{agent_id}"
                volumes[volume_name] = {"bind": cred_mount, "mode": "rw"}

            # Hook config: read-only settings.json for CLI runtimes (HOOK-02, D-08)
            # Bind mount AFTER credential volume — Docker overlays bind mount on top of
            # named volume, so settings.json shadows the volume entry for that file path.
            if runtime == "claude-code":
                hook_settings_dir = self._config_dir / "hook-settings"
                settings_host_path = _generate_hook_settings(agent_id, hook_settings_dir)
                volumes[_to_host_path(str(settings_host_path))] = {
                    "bind": "/root/.claude/settings.json",
                    "mode": "ro",
                }

            # Step 6: Create container via Docker SDK
            docker_client = docker.from_env()

            # Network resolved by label lookup — not env var (KMGR-05, locked decision)
            network = self._resolve_internal_network(docker_client)

            container = docker_client.containers.create(
                image=request.image,
                labels=labels,
                environment=env,
                network=network,
                mem_limit=mem_limit,
                nano_cpus=nano_cpus,
                volumes=volumes,
                detach=True,
            )
            container_id = container.id

            kubex_id = str(uuid.uuid4())
            record = KubexRecord(
                kubex_id=kubex_id,
                agent_id=agent_id,
                boundary=boundary,
                container_id=container_id,
                status=KubexState.CREATED.value,
                config=config,
                image=request.image,
                skills=skills_resolved,
                config_path=str(config_path) if config_path else None,
                runtime_deps=[],
                composed_capabilities=composed_capabilities,
            )

            # Step 7: Persist KubexRecord to Redis (KMGR-04)
            if self._redis is not None:
                from .redis_store import KubexRecordStore

                store = KubexRecordStore(self._redis)
                store.save(record)

            # Step 8: Add to in-memory store and return
            self._kubexes[kubex_id] = record

            logger.info(
                "kubex_created",
                kubex_id=kubex_id,
                agent_id=agent_id,
                container_id=container_id,
            )
            return record

        except Exception:
            # Rollback: remove container if created
            if container_id is not None:
                try:
                    docker_client = docker.from_env()
                    c = docker_client.containers.get(container_id)
                    c.remove(force=True)
                except Exception as rollback_exc:
                    logger.warning(
                        "rollback_container_remove_failed",
                        container_id=container_id,
                        error=str(rollback_exc),
                    )
            # Rollback: delete config file if written
            if config_path is not None and config_path.exists():
                try:
                    config_path.unlink()
                except Exception as rollback_exc:
                    logger.warning(
                        "rollback_config_delete_failed",
                        config_path=str(config_path),
                        error=str(rollback_exc),
                    )
            raise

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
            with contextlib.suppress(Exception):
                container.stop(timeout=0)

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
        capabilities: list[str] = agent_cfg.get("capabilities", [])

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
