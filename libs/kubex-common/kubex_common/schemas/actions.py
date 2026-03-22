"""Action type vocabulary and core request/response schemas."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ActionType(StrEnum):
    """Global action vocabulary. Every action a Kubex can emit."""

    # External HTTP
    HTTP_GET = "http_get"
    HTTP_POST = "http_post"
    HTTP_PUT = "http_put"
    HTTP_DELETE = "http_delete"

    # Communication
    SEND_EMAIL = "send_email"

    # File I/O
    READ_INPUT = "read_input"
    WRITE_OUTPUT = "write_output"
    READ_FILE = "read_file"
    WRITE_FILE = "write_file"

    # Data processing
    EXECUTE_CODE = "execute_code"
    PARSE_JSON = "parse_json"
    PARSE_HTML = "parse_html"
    SEARCH_WEB = "search_web"

    # Inter-agent coordination
    DISPATCH_TASK = "dispatch_task"
    CHECK_TASK_STATUS = "check_task_status"
    CANCEL_TASK = "cancel_task"
    REPORT_RESULT = "report_result"
    PROGRESS_UPDATE = "progress_update"
    QUERY_REGISTRY = "query_registry"
    ACTIVATE_KUBEX = "activate_kubex"

    # Knowledge
    QUERY_KNOWLEDGE = "query_knowledge"
    STORE_KNOWLEDGE = "store_knowledge"
    SEARCH_CORPUS = "search_corpus"

    # Vault operations (MCP Bridge Phase 8)
    VAULT_CREATE = "vault_create"
    VAULT_UPDATE = "vault_update"

    # User interaction
    REQUEST_USER_INPUT = "request_user_input"
    NEEDS_CLARIFICATION = "needs_clarification"

    # Task progress (MCP tools)
    SUBSCRIBE_TASK_PROGRESS = "subscribe_task_progress"
    GET_TASK_PROGRESS = "get_task_progress"

    # Runtime dependency management (PSEC-02)
    INSTALL_DEPENDENCY = "install_dependency"


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class RequestContext(BaseModel):
    """Context metadata attached to every ActionRequest."""

    workflow_id: str | None = None
    task_id: str | None = None
    originating_request_id: str | None = None
    chain_depth: int = Field(default=1, ge=1)


class ActionRequest(BaseModel):
    """Canonical action request schema. Every Kubex action passes through this."""

    request_id: str = Field(..., description="Unique request identifier (e.g., ar-20260301-a1b2c3d4)")
    agent_id: str = Field(..., description="Kubex agent ID (overwritten by Gateway from Docker labels)")
    action: ActionType = Field(..., description="Action type from the global vocabulary")
    target: str | None = Field(default=None, description="Target URL, path, or agent ID")
    parameters: dict[str, Any] = Field(default_factory=dict, description="Action-specific parameters")
    context: RequestContext = Field(default_factory=RequestContext)
    priority: Priority = Field(default=Priority.NORMAL)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ResultStatus(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"
    NEEDS_CLARIFICATION = "needs_clarification"


class ActionResponse(BaseModel):
    """Response from a completed action or task."""

    task_id: str | None = None
    workflow_id: str | None = None
    from_agent: str | None = None
    status: ResultStatus
    result: dict[str, Any] | None = None
    question: str | None = Field(default=None, description="Clarification question when status=needs_clarification")
    error: str | None = Field(default=None, description="Error message when status=failure")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
