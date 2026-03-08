"""Kubex Manager — Docker lifecycle management for agent containers."""

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from kubex_common.errors import ErrorResponse
from kubex_common.service import KubexService

router = APIRouter(tags=["lifecycle"])


@router.post("/kubexes")
async def create_kubex() -> JSONResponse:
    """Create a new Kubex container. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex creation not yet implemented",
        ).model_dump(),
    )


@router.get("/kubexes")
async def list_kubexes() -> JSONResponse:
    """List all managed Kubex containers. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex listing not yet implemented",
        ).model_dump(),
    )


@router.get("/kubexes/{kubex_id}")
async def get_kubex(kubex_id: str) -> JSONResponse:
    """Get Kubex details. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex retrieval not yet implemented",
        ).model_dump(),
    )


@router.post("/kubexes/{kubex_id}/start")
async def start_kubex(kubex_id: str) -> JSONResponse:
    """Start a Kubex container. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex start not yet implemented",
        ).model_dump(),
    )


@router.post("/kubexes/{kubex_id}/stop")
async def stop_kubex(kubex_id: str) -> JSONResponse:
    """Stop a Kubex container. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex stop not yet implemented",
        ).model_dump(),
    )


@router.post("/kubexes/{kubex_id}/kill")
async def kill_kubex(kubex_id: str) -> JSONResponse:
    """Kill a Kubex container + rotate secrets. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex kill not yet implemented",
        ).model_dump(),
    )


@router.post("/kubexes/{kubex_id}/restart")
async def restart_kubex(kubex_id: str) -> JSONResponse:
    """Restart a Kubex container. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Kubex restart not yet implemented",
        ).model_dump(),
    )


class ManagerService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="kubex-manager",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=3,  # Lifecycle events DB
        )
        self.app.include_router(router)

    async def on_startup(self) -> None:
        pass  # Will init Docker SDK client, verify socket access

    async def on_shutdown(self) -> None:
        pass  # Will drain lifecycle events


service = ManagerService()
app = service.app
