"""Data shapes for the request pipeline: ActionRequest -> RoutedRequest -> BrokeredRequest -> TaskDelivery."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .actions import ActionRequest, Priority


class RoutedRequest(BaseModel):
    """ActionRequest after Gateway routing decision."""

    request: ActionRequest
    resolved_agent_id: str
    resolved_boundary: str = "default"
    routing_timestamp: datetime = Field(default_factory=datetime.utcnow)


class BrokeredRequest(BaseModel):
    """Message shape written to Redis Streams by the Broker."""

    stream_id: str | None = None
    task_id: str
    workflow_id: str | None = None
    capability: str
    context_message: str = Field(..., description="Natural language task description for the worker LLM")
    from_agent: str
    priority: Priority = Priority.NORMAL
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class TaskDelivery(BaseModel):
    """What the target Kubex receives from the Broker."""

    task_id: str
    workflow_id: str | None = None
    capability: str
    context_message: str
    from_agent: str
    priority: Priority = Priority.NORMAL
