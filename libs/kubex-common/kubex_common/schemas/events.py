"""Event schemas for streaming, lifecycle, and control messages."""

from __future__ import annotations

import enum
from datetime import datetime

from pydantic import BaseModel, Field


class ProgressEventType(str, enum.Enum):
    DISPATCHED = "dispatched"
    ACCEPTED = "accepted"
    PROGRESS = "progress"
    COMPLETE = "complete"
    FAILED = "failed"
    NEEDS_CLARIFICATION = "needs_clarification"
    CANCELLED = "cancelled"


class ProgressUpdate(BaseModel):
    """Progress chunk from a worker harness."""

    task_id: str
    action: str = "progress_update"
    chunk_type: str = "stdout"
    content: str = ""
    sequence: int = 0
    progress_pct: float | None = None
    final: bool = False
    exit_reason: str | None = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class SSEEvent(BaseModel):
    """Server-Sent Event for task progress streaming."""

    event_type: ProgressEventType
    task_id: str
    data: dict = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class LifecycleAction(str, enum.Enum):
    CREATED = "created"
    STARTED = "started"
    STOPPED = "stopped"
    KILLED = "killed"
    RESTARTED = "restarted"
    REGISTERED = "registered"
    DEREGISTERED = "deregistered"


class LifecycleEvent(BaseModel):
    """Kubex lifecycle event published to Redis db3."""

    agent_id: str
    action: LifecycleAction
    boundary: str = "default"
    details: dict = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ControlCommand(str, enum.Enum):
    CANCEL = "cancel"
    SHUTDOWN = "shutdown"
    RESTART = "restart"


class ControlMessage(BaseModel):
    """Control message sent via Redis pub/sub to agent harness."""

    command: ControlCommand
    agent_id: str
    task_id: str | None = None
    reason: str | None = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
