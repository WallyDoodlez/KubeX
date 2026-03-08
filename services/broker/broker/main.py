"""Kubex Broker — Redis Streams message routing between Kubexes."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from kubex_common.errors import ErrorResponse, TaskNotFoundError
from kubex_common.schemas.routing import TaskDelivery
from kubex_common.service import KubexService

from .streams import BrokerStreams

router = APIRouter(tags=["messages"])


class PublishRequest(BaseModel):
    """Request body for publishing a task delivery."""

    delivery: TaskDelivery


class AckRequest(BaseModel):
    """Request body for acknowledging a message.

    Fields:
    - message_id: the stream message ID to acknowledge
    - group: the consumer group (agent_id) that consumed this message
    """

    message_id: str
    group: str


class ResultStoreRequest(BaseModel):
    """Request body for storing a task result."""

    result: dict[str, Any]


def _get_streams(request: Request) -> BrokerStreams:
    """Get the BrokerStreams instance, or raise 503 if Redis unavailable."""
    streams = request.app.state.streams
    if streams is None:
        raise HTTPException(status_code=503, detail="Broker Redis not connected")
    return streams


@router.post("/messages", status_code=202)
async def publish_message(body: PublishRequest, request: Request) -> dict[str, str]:
    """Publish a TaskDelivery to the appropriate stream."""
    streams = _get_streams(request)
    message_id = await streams.publish(body.delivery)
    return {"message_id": message_id, "task_id": body.delivery.task_id}


@router.get("/messages/consume/{agent_id}")
async def consume_messages(
    agent_id: str,
    request: Request,
    count: int = 10,
    block_ms: int = 0,
) -> list[dict[str, Any]]:
    """Consume messages from the agent's consumer group.

    Query params:
    - count: max messages to return (default 10)
    - block_ms: how long to block waiting for messages (0 = non-blocking)
    """
    streams = _get_streams(request)
    return await streams.consume(agent_id, count=count, block_ms=block_ms)


@router.post("/messages/{message_id}/ack", status_code=204)
async def ack_message(message_id: str, body: AckRequest, request: Request) -> None:
    """Acknowledge successful processing of a message.

    Path param message_id matches the body message_id for clarity.
    """
    streams = _get_streams(request)
    await streams.acknowledge(body.group, body.message_id)


@router.post("/tasks/{task_id}/result", status_code=204)
async def store_task_result(
    task_id: str,
    body: ResultStoreRequest,
    request: Request,
) -> None:
    """Store a completed task result."""
    streams = _get_streams(request)
    await streams.store_result(task_id, body.result)


@router.get("/tasks/{task_id}/result")
async def get_task_result(task_id: str, request: Request) -> dict[str, Any]:
    """Read result stored against task_id."""
    streams = _get_streams(request)
    result = await streams.get_result(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Result not found for task: {task_id}")
    return result


class BrokerService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="kubex-broker",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=0,  # Broker streams DB
        )
        self.app.include_router(router)
        self.app.state.streams = None  # Will be set on startup if Redis available

    async def on_startup(self) -> None:
        if self.redis:
            self.app.state.streams = BrokerStreams(self.redis.client)

    async def on_shutdown(self) -> None:
        pass  # Redis client disconnect handled by KubexService base


service = BrokerService()
app = service.app
