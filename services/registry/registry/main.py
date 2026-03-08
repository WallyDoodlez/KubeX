"""Kubex Registry — Agent capability discovery service."""

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from kubex_common.errors import ErrorResponse
from kubex_common.service import KubexService

router = APIRouter(tags=["agents"])


@router.post("/agents")
async def register_agent() -> JSONResponse:
    """Register an agent with capabilities. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Agent registration not yet implemented",
        ).model_dump(),
    )


@router.get("/agents")
async def list_agents() -> JSONResponse:
    """List all registered agents. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Agent listing not yet implemented",
        ).model_dump(),
    )


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str) -> JSONResponse:
    """Get agent details. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Agent retrieval not yet implemented",
        ).model_dump(),
    )


@router.delete("/agents/{agent_id}")
async def deregister_agent(agent_id: str) -> JSONResponse:
    """Deregister an agent. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Agent deregistration not yet implemented",
        ).model_dump(),
    )


@router.get("/capabilities/{capability}")
async def resolve_capability(capability: str) -> JSONResponse:
    """Resolve a capability to agent(s). Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Capability resolution not yet implemented",
        ).model_dump(),
    )


@router.patch("/agents/{agent_id}/status")
async def update_agent_status(agent_id: str) -> JSONResponse:
    """Update agent status. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Agent status update not yet implemented",
        ).model_dump(),
    )


class RegistryService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="kubex-registry",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=2,  # Registry cache DB
        )
        self.app.include_router(router)

    async def on_startup(self) -> None:
        pass  # Will load existing registrations from Redis

    async def on_shutdown(self) -> None:
        pass


service = RegistryService()
app = service.app
