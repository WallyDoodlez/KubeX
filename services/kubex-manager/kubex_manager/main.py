"""Kubex Manager — Docker lifecycle management for agent containers.

Implements Stream 4A REST API:
  POST   /kubexes              — create and start a new Kubex
  GET    /kubexes              — list all Kubexes
  GET    /kubexes/{kubex_id}   — get specific Kubex status
  POST   /kubexes/{kubex_id}/start    — start
  POST   /kubexes/{kubex_id}/stop     — stop
  POST   /kubexes/{kubex_id}/kill     — kill
  POST   /kubexes/{kubex_id}/restart  — restart
  DELETE /kubexes/{kubex_id}          — remove
  POST   /kubexes/{kubex_id}/credentials — inject OAuth token into container

Auth: Bearer token required for all /kubexes endpoints.
"""

from __future__ import annotations

import os
from typing import Any

import docker.errors  # type: ignore[import]
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from kubex_common.errors import ErrorResponse
from kubex_common.logging import get_logger
from kubex_common.service import KubexService
from pydantic import BaseModel

from .lifecycle import CreateKubexRequest, KubexLifecycle, KubexRecord

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

_BEARER_SCHEME = HTTPBearer(auto_error=False)
_MGMT_TOKEN = os.environ.get("KUBEX_MGMT_TOKEN", "kubex-mgmt-token")


def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_BEARER_SCHEME),  # noqa: B008 — FastAPI DI pattern
) -> None:
    """Verify Bearer token for management API endpoints."""
    if credentials is None or credentials.credentials != _MGMT_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class CreateKubexBody(BaseModel):
    """Request body for POST /kubexes."""

    config: dict[str, Any]
    resource_limits: dict[str, Any] = {}
    image: str = "kubexclaw-base:latest"
    skill_mounts: list[str] = []


class InstallDepBody(BaseModel):
    """Request body for POST /kubexes/{id}/install-dep."""

    package: str
    type: str = "pip"  # "pip" or "cli"


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["lifecycle"])


def _get_lifecycle(request: Request) -> KubexLifecycle:
    """Extract KubexLifecycle from app state."""
    return request.app.state.lifecycle  # type: ignore[return-value]


def _record_to_dict(record: KubexRecord) -> dict[str, Any]:
    """Serialize a KubexRecord to a JSON-serializable dict."""
    return {
        "kubex_id": record.kubex_id,
        "agent_id": record.agent_id,
        "boundary": record.boundary,
        "container_id": record.container_id,
        "status": record.status,
        "image": record.image,
    }


@router.post("/kubexes", status_code=201, dependencies=[Depends(verify_token)])
async def create_kubex(body: CreateKubexBody, request: Request) -> JSONResponse:
    """Create a new Kubex container.

    Validates config, creates the Docker container with proper labels and env vars,
    and returns a kubex_id for subsequent lifecycle calls.
    """
    lifecycle = _get_lifecycle(request)

    agent_cfg = body.config.get("agent", {})
    if not agent_cfg.get("id"):
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(
                error="InvalidConfig",
                message="Config missing required field: agent.id",
            ).model_dump(),
        )

    gateway_url = os.environ.get("GATEWAY_URL", "http://gateway:8080")
    registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")

    create_req = CreateKubexRequest(
        config=body.config,
        resource_limits=body.resource_limits,
        image=body.image,
        gateway_url=gateway_url,
        registry_url=registry_url,
        skill_mounts=body.skill_mounts,
    )

    try:
        record = lifecycle.create_kubex(create_req)
    except ValueError as exc:
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(
                error="InvalidConfig",
                message=str(exc),
            ).model_dump(),
        )
    except docker.errors.DockerException as exc:
        logger.error("docker_create_failed", error=str(exc))
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="DockerUnavailable",
                message=f"Docker daemon error: {exc}",
            ).model_dump(),
        )

    # Publish creation lifecycle event (best-effort)
    redis = getattr(request.app.state, "redis_db3", None)
    if redis is not None:
        lifecycle._redis = redis
        await lifecycle._publish_lifecycle_event(record, action="created")

    return JSONResponse(
        status_code=201,
        content=_record_to_dict(record),
    )


@router.get("/kubexes", dependencies=[Depends(verify_token)])
async def list_kubexes(request: Request) -> JSONResponse:
    """List all managed Kubex containers."""
    lifecycle = _get_lifecycle(request)
    kubexes = lifecycle.list_kubexes()
    return JSONResponse(
        status_code=200,
        content=[_record_to_dict(r) for r in kubexes],
    )


@router.get("/kubexes/{kubex_id}", dependencies=[Depends(verify_token)])
async def get_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Get the current state of a specific Kubex."""
    lifecycle = _get_lifecycle(request)
    try:
        record = lifecycle.get_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )
    return JSONResponse(status_code=200, content=_record_to_dict(record))


@router.post("/kubexes/{kubex_id}/start", dependencies=[Depends(verify_token)])
async def start_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Start a created Kubex container and register with Registry."""
    lifecycle = _get_lifecycle(request)
    try:
        record = await lifecycle.start_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )
    except docker.errors.DockerException as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="DockerError",
                message=str(exc),
            ).model_dump(),
        )
    return JSONResponse(status_code=200, content=_record_to_dict(record))


@router.post("/kubexes/{kubex_id}/stop", dependencies=[Depends(verify_token)])
async def stop_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Gracefully stop a Kubex container and deregister from Registry."""
    lifecycle = _get_lifecycle(request)
    try:
        record = await lifecycle.stop_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )
    except docker.errors.DockerException as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="DockerError",
                message=str(exc),
            ).model_dump(),
        )
    return JSONResponse(status_code=200, content=_record_to_dict(record))


@router.post("/kubexes/{kubex_id}/kill", dependencies=[Depends(verify_token)])
async def kill_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Force-kill a Kubex container and deregister from Registry."""
    lifecycle = _get_lifecycle(request)
    try:
        record = await lifecycle.kill_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )
    except docker.errors.DockerException as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="DockerError",
                message=str(exc),
            ).model_dump(),
        )
    return JSONResponse(status_code=200, content=_record_to_dict(record))


@router.post("/kubexes/{kubex_id}/restart", dependencies=[Depends(verify_token)])
async def restart_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Restart a Kubex container."""
    lifecycle = _get_lifecycle(request)
    try:
        record = await lifecycle.restart_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )
    except docker.errors.DockerException as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="DockerError",
                message=str(exc),
            ).model_dump(),
        )
    return JSONResponse(status_code=200, content=_record_to_dict(record))


@router.post("/kubexes/{kubex_id}/respawn", dependencies=[Depends(verify_token)])
async def respawn_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Respawn a Kubex: kill current container and create a new one from persisted config.

    The persisted config is loaded from the KubexRecord in the in-memory store.
    """
    lifecycle = _get_lifecycle(request)
    try:
        record = lifecycle.get_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )

    # Kill existing container (best-effort)
    try:
        import docker as _docker

        docker_client = _docker.from_env()
        container = docker_client.containers.get(record.container_id)
        try:
            container.kill()
        except Exception:
            with __import__("contextlib").suppress(Exception):
                container.stop(timeout=0)
    except Exception as exc:
        logger.warning("respawn_kill_failed", kubex_id=kubex_id, error=str(exc))

    # Re-create using persisted config
    gateway_url = os.environ.get("GATEWAY_URL", "http://gateway:8080")
    registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")

    create_req = CreateKubexRequest(
        config=record.config,
        image=record.image,
        gateway_url=gateway_url,
        registry_url=registry_url,
        skill_mounts=record.skills,
    )

    try:
        new_record = lifecycle.create_kubex(create_req)
    except Exception as exc:
        logger.error("respawn_create_failed", kubex_id=kubex_id, error=str(exc))
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="RespawnFailed",
                message=f"Failed to respawn Kubex: {exc}",
            ).model_dump(),
        )

    return JSONResponse(status_code=200, content=_record_to_dict(new_record))


@router.post("/kubexes/{kubex_id}/install-dep", dependencies=[Depends(verify_token)])
async def install_dep(kubex_id: str, body: InstallDepBody, request: Request) -> JSONResponse:
    """Install a runtime dependency into a running Kubex container.

    Runs pip install (or appropriate CLI) inside the container and records
    the installed package in the KubexRecord.runtime_deps list.
    """
    lifecycle = _get_lifecycle(request)
    try:
        record = lifecycle.get_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )

    try:
        import docker as _docker

        docker_client = _docker.from_env()
        container = docker_client.containers.get(record.container_id)

        if body.type == "pip":
            cmd = ["pip", "install", body.package]
        elif body.type == "cli":
            cmd = ["apt-get", "install", "-y", body.package]
        else:
            return JSONResponse(
                status_code=422,
                content=ErrorResponse(
                    error="UnknownDepType",
                    message=f"Unknown dependency type: {body.type!r}. Use 'pip' or 'cli'.",
                ).model_dump(),
            )

        exit_code, output = container.exec_run(cmd)

        if exit_code != 0:
            return JSONResponse(
                status_code=422,
                content=ErrorResponse(
                    error="InstallFailed",
                    message=f"Package install failed (exit {exit_code}): {output.decode(errors='replace')[:500]}",
                ).model_dump(),
            )

        # Record installed package in record
        dep_entry = f"{body.package} (type={body.type})"
        if dep_entry not in record.runtime_deps:
            record.runtime_deps.append(dep_entry)

        # Persist updated record to Redis
        if lifecycle._redis is not None:
            from .redis_store import KubexRecordStore

            store = KubexRecordStore(lifecycle._redis)
            store.save(record)

        return JSONResponse(
            status_code=200,
            content={
                "kubex_id": kubex_id,
                "package": body.package,
                "type": body.type,
                "status": "installed",
                "runtime_deps": record.runtime_deps,
            },
        )

    except docker.errors.DockerException as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                error="DockerError",
                message=str(exc),
            ).model_dump(),
        )


@router.get("/kubexes/{kubex_id}/config", dependencies=[Depends(verify_token)])
async def get_kubex_config(kubex_id: str, request: Request) -> JSONResponse:
    """Return the full merged config.yaml content for a Kubex (for debugging/auditing)."""
    lifecycle = _get_lifecycle(request)
    try:
        record = lifecycle.get_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )

    if record.config_path:
        from pathlib import Path

        config_file = Path(record.config_path)
        if config_file.exists():
            import yaml as _yaml

            try:
                content = _yaml.safe_load(config_file.read_text(encoding="utf-8"))
                return JSONResponse(
                    status_code=200,
                    content={
                        "kubex_id": kubex_id,
                        "config_path": record.config_path,
                        "config": content,
                    },
                )
            except Exception as exc:
                logger.warning("config_file_read_failed", path=record.config_path, error=str(exc))

    # Fallback: return the in-memory config dict
    return JSONResponse(
        status_code=200,
        content={
            "kubex_id": kubex_id,
            "config_path": record.config_path,
            "config": record.config,
        },
    )


configs_router = APIRouter(tags=["configs"])


@configs_router.get("/configs", dependencies=[Depends(verify_token)])
async def list_configs(request: Request) -> JSONResponse:
    """List saved config.yaml files with metadata."""
    import yaml as _yaml

    lifecycle = _get_lifecycle(request)
    config_dir = lifecycle._config_dir

    configs = []
    if config_dir.is_dir():
        for config_file in sorted(config_dir.glob("*.yaml")):
            try:
                content = _yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
                agent_section = content.get("agent", {})
                configs.append(
                    {
                        "agent_id": agent_section.get("id", config_file.stem),
                        "file": config_file.name,
                        "skills": agent_section.get("skills", content.get("skills", [])),
                        "capabilities": agent_section.get("capabilities", content.get("capabilities", [])),
                    }
                )
            except Exception:
                configs.append({"file": config_file.name, "agent_id": config_file.stem})

    return JSONResponse(status_code=200, content={"configs": configs})


class InjectCredentialBody(BaseModel):
    """Payload for credential injection."""

    runtime: str  # e.g. "claude-code"
    credential_data: dict[str, Any]  # Token JSON to write


@router.post("/kubexes/{kubex_id}/credentials", dependencies=[Depends(verify_token)])
async def inject_credentials(
    kubex_id: str, body: InjectCredentialBody, request: Request
) -> JSONResponse:
    """Write OAuth credentials into a running container's credential volume.

    Used by Command Center to provision CLI agent auth tokens after
    the user completes an OAuth flow in the browser.
    """
    import json as _json

    import docker  # type: ignore[import]

    lifecycle = _get_lifecycle(request)
    try:
        record = lifecycle.get_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )

    # Resolve credential path from runtime type
    cred_paths = {
        "claude-code": "/root/.claude/.credentials.json",
        "codex-cli": "/root/.codex/.credentials.json",
        "gemini-cli": "/root/.config/gemini/credentials.json",
    }
    cred_path = cred_paths.get(body.runtime)
    if cred_path is None:
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(
                error="UnknownRuntime",
                message=f"No credential path for runtime: {body.runtime}",
            ).model_dump(),
        )

    # Write credential file into the container via docker exec
    try:
        docker_client = docker.from_env()
        container = docker_client.containers.get(record.container_id)

        cred_json = _json.dumps(body.credential_data)
        parent_dir = "/".join(cred_path.split("/")[:-1])
        cmd = f"sh -c 'mkdir -p {parent_dir} && cat > {cred_path}'"
        exit_code, output = container.exec_run(cmd, stdin=True, socket=True)

        # exec_run with socket=True returns a socket — write data and close
        sock = output._sock  # type: ignore[union-attr]
        sock.sendall(cred_json.encode("utf-8"))
        sock.close()

        logger.info(
            "credentials_injected",
            kubex_id=kubex_id,
            runtime=body.runtime,
            path=cred_path,
        )
        return JSONResponse(
            status_code=200,
            content={
                "status": "injected",
                "kubex_id": kubex_id,
                "runtime": body.runtime,
                "path": cred_path,
            },
        )
    except docker.errors.NotFound:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="ContainerNotFound",
                message=f"Container not running for kubex: {kubex_id}",
            ).model_dump(),
        )
    except Exception as exc:
        logger.error("credential_injection_failed", kubex_id=kubex_id, error=str(exc))
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error="InjectionFailed",
                message=f"Failed to inject credentials: {exc}",
            ).model_dump(),
        )


@router.delete("/kubexes/{kubex_id}", status_code=204, dependencies=[Depends(verify_token)])
async def remove_kubex(kubex_id: str, request: Request) -> JSONResponse:
    """Remove a Kubex record (does not stop the container)."""
    lifecycle = _get_lifecycle(request)
    try:
        lifecycle.remove_kubex(kubex_id)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content=ErrorResponse(
                error="KubexNotFound",
                message=f"Kubex not found: {kubex_id}",
            ).model_dump(),
        )
    return JSONResponse(status_code=204, content=None)


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------


class ManagerService(KubexService):
    """Kubex Manager FastAPI service."""

    def __init__(self) -> None:
        super().__init__(
            service_name="kubex-manager",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=3,  # Lifecycle events DB
        )
        gateway_url = os.environ.get("GATEWAY_URL", "http://gateway:8080")
        registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")

        # Create lifecycle manager; redis client attached on startup
        lifecycle = KubexLifecycle(
            gateway_url=gateway_url,
            registry_url=registry_url,
        )
        self.app.state.lifecycle = lifecycle

        self.app.include_router(router)
        self.app.include_router(configs_router)

    async def on_startup(self) -> None:
        """Attach Redis client to lifecycle manager and verify Docker access."""
        if self.redis:
            self.app.state.lifecycle._redis = self.redis.client

        try:
            import docker

            docker.from_env()
            logger.info("docker_client_verified")
        except Exception as exc:
            logger.warning("docker_not_available", reason=str(exc))

    async def on_shutdown(self) -> None:
        """Drain pending lifecycle events."""
        logger.info("manager_shutdown")


service = ManagerService()
app = service.app
