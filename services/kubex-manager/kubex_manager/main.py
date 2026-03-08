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

Auth: Bearer token required for all /kubexes endpoints.
"""

from __future__ import annotations

import os
from typing import Any

import docker.errors  # type: ignore[import]
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from kubex_common.errors import ErrorResponse
from kubex_common.logging import get_logger
from kubex_common.service import KubexService

from .lifecycle import CreateKubexRequest, KubexLifecycle, KubexRecord

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

_BEARER_SCHEME = HTTPBearer(auto_error=False)
_MGMT_TOKEN = os.environ.get("KUBEX_MGMT_TOKEN", "kubex-mgmt-token")


def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_BEARER_SCHEME),
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
