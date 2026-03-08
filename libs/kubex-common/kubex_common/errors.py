"""Shared error types and standardized error response format."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """Standardized error response returned by all services."""

    error: str = Field(..., description="Error type identifier")
    message: str = Field(..., description="Human-readable error message")
    details: dict[str, Any] | None = Field(default=None, description="Additional error context")
    request_id: str | None = Field(default=None, description="Request ID for correlation")


class KubexError(Exception):
    """Base exception for all KubexClaw errors."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)

    def to_response(self, request_id: str | None = None) -> ErrorResponse:
        return ErrorResponse(
            error=self.__class__.__name__,
            message=self.message,
            details=self.details,
            request_id=request_id,
        )


class PolicyDeniedError(KubexError):
    """Action denied by the Policy Engine."""

    def __init__(self, message: str = "Action denied by policy", *, rule: str | None = None, **kwargs: Any) -> None:
        details = kwargs
        if rule:
            details["rule_matched"] = rule
        super().__init__(message, details)


class BudgetExceededError(KubexError):
    """Token or cost budget exceeded."""

    def __init__(
        self,
        message: str = "Budget exceeded",
        *,
        limit: float | None = None,
        current: float | None = None,
        unit: str = "tokens",
    ) -> None:
        details: dict[str, Any] = {"unit": unit}
        if limit is not None:
            details["limit"] = limit
        if current is not None:
            details["current"] = current
        super().__init__(message, details)


class RateLimitError(KubexError):
    """Rate limit exceeded for an action."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        *,
        action: str | None = None,
        limit: int | None = None,
        window_seconds: int = 60,
    ) -> None:
        details: dict[str, Any] = {"window_seconds": window_seconds}
        if action:
            details["action"] = action
        if limit is not None:
            details["limit"] = limit
        super().__init__(message, details)


class AgentNotFoundError(KubexError):
    """Agent not found in Registry."""

    def __init__(self, agent_id: str) -> None:
        super().__init__(f"Agent not found: {agent_id}", {"agent_id": agent_id})


class CapabilityNotFoundError(KubexError):
    """No agent found with the requested capability."""

    def __init__(self, capability: str) -> None:
        super().__init__(f"No agent found with capability: {capability}", {"capability": capability})


class ActionNotAllowedError(KubexError):
    """Action type not in the agent's allowed actions list."""

    def __init__(self, action: str, agent_id: str) -> None:
        super().__init__(
            f"Action '{action}' not allowed for agent '{agent_id}'",
            {"action": action, "agent_id": agent_id},
        )


class IdentityResolutionError(KubexError):
    """Failed to resolve agent identity from Docker labels."""

    def __init__(self, source_ip: str | None = None) -> None:
        details: dict[str, Any] = {}
        if source_ip:
            details["source_ip"] = source_ip
        super().__init__("Failed to resolve agent identity", details)


class TaskNotFoundError(KubexError):
    """Task not found."""

    def __init__(self, task_id: str) -> None:
        super().__init__(f"Task not found: {task_id}", {"task_id": task_id})


class EgressDeniedError(KubexError):
    """Egress request to a blocked domain."""

    def __init__(self, domain: str, agent_id: str | None = None) -> None:
        details: dict[str, Any] = {"domain": domain}
        if agent_id:
            details["agent_id"] = agent_id
        super().__init__(f"Egress denied to domain: {domain}", details)


class ModelNotAllowedError(KubexError):
    """Model not in the agent's model allowlist."""

    def __init__(self, model: str, agent_id: str | None = None) -> None:
        details: dict[str, Any] = {"model": model}
        if agent_id:
            details["agent_id"] = agent_id
        super().__init__(f"Model not allowed: {model}", details)
