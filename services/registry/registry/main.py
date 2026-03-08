"""Kubex Registry — Agent capability discovery service."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from kubex_common.errors import AgentNotFoundError, CapabilityNotFoundError, ErrorResponse
from kubex_common.service import KubexService

from .store import AgentRegistration, AgentStatus, CapabilityStore

router = APIRouter(tags=["agents"])


class StatusUpdateBody(BaseModel):
    status: AgentStatus


def get_store(request: Request) -> CapabilityStore:
    return request.app.state.store


@router.post("/agents", status_code=201)
async def register_agent(
    body: AgentRegistration,
    request: Request,
) -> AgentRegistration:
    """Register an agent with its capabilities and status."""
    store: CapabilityStore = request.app.state.store
    redis_client = getattr(request.app.state, "redis_client", None)
    return await store.register(body, redis_client=redis_client)


@router.get("/agents")
async def list_agents(request: Request) -> list[AgentRegistration]:
    """List all registered agents."""
    store: CapabilityStore = request.app.state.store
    return store.list_all()


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, request: Request) -> AgentRegistration:
    """Get details for a specific agent."""
    store: CapabilityStore = request.app.state.store
    try:
        return store.get(agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc


@router.delete("/agents/{agent_id}", status_code=204)
async def deregister_agent(agent_id: str, request: Request) -> None:
    """Deregister an agent."""
    store: CapabilityStore = request.app.state.store
    redis_client = getattr(request.app.state, "redis_client", None)
    try:
        await store.deregister(agent_id, redis_client=redis_client)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc


@router.get("/capabilities/{capability}")
async def resolve_capability(capability: str, request: Request) -> list[AgentRegistration]:
    """Resolve a capability to the agents that support it."""
    store: CapabilityStore = request.app.state.store
    try:
        return store.resolve_capability(capability)
    except CapabilityNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc


@router.patch("/agents/{agent_id}/status")
async def update_agent_status(
    agent_id: str,
    body: StatusUpdateBody,
    request: Request,
) -> AgentRegistration:
    """Update the status of a registered agent."""
    store: CapabilityStore = request.app.state.store
    redis_client = getattr(request.app.state, "redis_client", None)
    try:
        return await store.update_status(agent_id, body.status, redis_client=redis_client)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc


class RegistryService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="kubex-registry",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=2,  # Registry cache DB
        )
        self.app.include_router(router)
        self.app.state.store = CapabilityStore()

    async def on_startup(self) -> None:
        if self.redis:
            self.app.state.redis_client = self.redis.client
            await self.app.state.store.restore_from_redis(self.redis.client)

    async def on_shutdown(self) -> None:
        pass


service = RegistryService()
app = service.app
