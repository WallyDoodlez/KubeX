"""In-memory agent capability store backed by Redis db2."""

from __future__ import annotations

import json
from enum import Enum
from typing import Any

from datetime import datetime, UTC

from pydantic import BaseModel, Field

from kubex_common.errors import AgentNotFoundError, CapabilityNotFoundError
from kubex_common.logging import get_logger

logger = get_logger(__name__)

AGENTS_HASH_KEY = "registry:agents"
CAPABILITY_SET_PREFIX = "registry:capability:"


class AgentStatus(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    BUSY = "busy"
    UNKNOWN = "unknown"


class AgentRegistration(BaseModel):
    """Registration record for an agent in the Registry."""

    agent_id: str = Field(..., description="Unique agent identifier")
    capabilities: list[str] = Field(default_factory=list, description="List of capabilities this agent supports")
    status: AgentStatus = Field(default=AgentStatus.UNKNOWN)
    boundary: str = Field(default="default", description="Boundary this agent belongs to")
    accepts_from: list[str] = Field(default_factory=list, description="Agent IDs this agent accepts tasks from")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    registered_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class CapabilityStore:
    """In-memory + Redis-backed agent capability store.

    In-memory dict is authoritative during runtime.
    Redis provides persistence across restarts.
    """

    def __init__(self) -> None:
        self._agents: dict[str, AgentRegistration] = {}

    async def restore_from_redis(self, redis_client: Any) -> None:
        """Load all agents from Redis into memory on startup."""
        try:
            raw = await redis_client.hgetall(AGENTS_HASH_KEY)
            for agent_id, data in raw.items():
                agent = AgentRegistration.model_validate_json(data)
                self._agents[agent_id] = agent
            logger.info("registry_restored", count=len(self._agents))
        except Exception as exc:
            logger.warning("registry_restore_failed", error=str(exc))

    async def register(self, registration: AgentRegistration, redis_client: Any | None = None) -> AgentRegistration:
        """Register or update an agent."""
        registration.updated_at = datetime.now(UTC)
        if registration.agent_id not in self._agents:
            registration.registered_at = datetime.now(UTC)
            logger.info("agent_registered", agent_id=registration.agent_id, capabilities=registration.capabilities)
        else:
            # Preserve original registered_at
            existing = self._agents[registration.agent_id]
            registration.registered_at = existing.registered_at
            logger.info("agent_updated", agent_id=registration.agent_id)

        self._agents[registration.agent_id] = registration

        if redis_client is not None:
            try:
                await redis_client.hset(
                    AGENTS_HASH_KEY,
                    registration.agent_id,
                    registration.model_dump_json(),
                )
                # Update capability sets
                for cap in registration.capabilities:
                    await redis_client.sadd(
                        f"{CAPABILITY_SET_PREFIX}{cap}",
                        registration.agent_id,
                    )
            except Exception as exc:
                logger.warning("registry_redis_write_failed", error=str(exc))

            # Notify subscribers of agent change (MCP-05)
            try:
                await redis_client.publish("registry:agent_changed", registration.agent_id)
            except Exception as exc:
                logger.warning("registry_publish_failed", error=str(exc))

        return registration

    def get(self, agent_id: str) -> AgentRegistration:
        """Get agent by ID. Raises AgentNotFoundError if not found."""
        if agent_id not in self._agents:
            raise AgentNotFoundError(agent_id)
        return self._agents[agent_id]

    def list_all(self) -> list[AgentRegistration]:
        """Return all registered agents."""
        return list(self._agents.values())

    async def deregister(self, agent_id: str, redis_client: Any | None = None) -> None:
        """Remove an agent from the store."""
        if agent_id not in self._agents:
            raise AgentNotFoundError(agent_id)

        registration = self._agents.pop(agent_id)
        logger.info("agent_deregistered", agent_id=agent_id)

        if redis_client is not None:
            try:
                await redis_client.hdel(AGENTS_HASH_KEY, agent_id)
                for cap in registration.capabilities:
                    await redis_client.srem(f"{CAPABILITY_SET_PREFIX}{cap}", agent_id)
            except Exception as exc:
                logger.warning("registry_redis_delete_failed", error=str(exc))

            # Notify subscribers of agent change (MCP-05)
            try:
                await redis_client.publish("registry:agent_changed", agent_id)
            except Exception as exc:
                logger.warning("registry_publish_failed", error=str(exc))

    async def update_status(
        self, agent_id: str, status: AgentStatus, redis_client: Any | None = None
    ) -> AgentRegistration:
        """Update the status of a registered agent."""
        if agent_id not in self._agents:
            raise AgentNotFoundError(agent_id)

        registration = self._agents[agent_id]
        registration.status = status
        registration.updated_at = datetime.now(UTC)
        logger.info("agent_status_updated", agent_id=agent_id, status=status)

        if redis_client is not None:
            try:
                await redis_client.hset(
                    AGENTS_HASH_KEY,
                    agent_id,
                    registration.model_dump_json(),
                )
            except Exception as exc:
                logger.warning("registry_redis_status_update_failed", error=str(exc))

        return registration

    def resolve_capability(self, capability: str) -> list[AgentRegistration]:
        """Resolve a capability to all agents that support it.

        Returns only agents in RUNNING or BUSY status.
        Raises CapabilityNotFoundError if no suitable agent found.
        """
        candidates = [
            agent
            for agent in self._agents.values()
            if capability in agent.capabilities and agent.status in (AgentStatus.RUNNING, AgentStatus.BUSY)
        ]
        if not candidates:
            raise CapabilityNotFoundError(capability)
        return candidates
