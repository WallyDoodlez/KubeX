"""Kubex Broker — Redis Streams message routing between Kubexes."""

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from kubex_common.errors import ErrorResponse
from kubex_common.service import KubexService

router = APIRouter(tags=["messages"])


@router.post("/messages")
async def publish_message() -> JSONResponse:
    """Publish a TaskDelivery to the appropriate stream. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Message publishing not yet implemented",
        ).model_dump(),
    )


@router.get("/messages/consume/{agent_id}")
async def consume_messages(agent_id: str) -> JSONResponse:
    """Consume messages from the agent's consumer group. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Message consumption not yet implemented",
        ).model_dump(),
    )


@router.post("/messages/{message_id}/ack")
async def ack_message(message_id: str) -> JSONResponse:
    """Acknowledge a consumed message. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Message acknowledgment not yet implemented",
        ).model_dump(),
    )


@router.get("/tasks/{task_id}/result")
async def get_task_result(task_id: str) -> JSONResponse:
    """Read result stored against task_id. Stub — returns 501."""
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(
            error="NotImplemented",
            message="Task result retrieval not yet implemented",
        ).model_dump(),
    )


class BrokerService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="kubex-broker",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=0,  # Broker streams DB
        )
        self.app.include_router(router)

    async def on_startup(self) -> None:
        pass  # Will initialize consumer groups, stream trimming

    async def on_shutdown(self) -> None:
        pass  # Will drain pending messages


service = BrokerService()
app = service.app
