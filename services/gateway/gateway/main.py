"""Gateway service — Policy Engine, Egress Proxy, LLM Proxy, Inbound Gate."""

import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from kubex_common.errors import ErrorResponse
from kubex_common.service import KubexService

router = APIRouter(tags=["actions"])


@router.post("/actions")
async def handle_action(request: Request) -> JSONResponse:
    """Evaluate and route an ActionRequest. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Gateway action handling not yet implemented",
        ).model_dump(),
    )


@router.get("/tasks/{task_id}/result")
async def get_task_result(task_id: str) -> JSONResponse:
    """Poll for task result. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Task result retrieval not yet implemented",
        ).model_dump(),
    )


@router.get("/tasks/{task_id}/stream")
async def stream_task_progress(task_id: str) -> JSONResponse:
    """SSE stream of task progress events. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Task progress streaming not yet implemented",
        ).model_dump(),
    )


@router.post("/tasks/{task_id}/progress")
async def receive_progress(task_id: str) -> JSONResponse:
    """Receive progress chunks from worker harness. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Progress reception not yet implemented",
        ).model_dump(),
    )


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> JSONResponse:
    """Cancel a running task. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Task cancellation not yet implemented",
        ).model_dump(),
    )


proxy_router = APIRouter(tags=["proxy"])


@proxy_router.api_route("/v1/proxy/{provider}/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def llm_proxy(provider: str, path: str) -> JSONResponse:
    """LLM reverse proxy — forwards to provider API. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message=f"LLM proxy for {provider} not yet implemented",
        ).model_dump(),
    )


class GatewayService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="gateway",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=1,  # Rate limits DB
        )
        self.app.include_router(router)
        self.app.include_router(proxy_router)

    async def on_startup(self) -> None:
        pass  # Will load policies, init Docker client for identity resolution

    async def on_shutdown(self) -> None:
        pass


service = GatewayService()
app = service.app
