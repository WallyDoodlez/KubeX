"""Health endpoint factory for KubexClaw services."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter

if TYPE_CHECKING:
    from kubex_common.service.base import KubexService


def create_health_router(service: KubexService) -> APIRouter:
    """Create a /health endpoint router for the given service."""
    router = APIRouter(tags=["health"])

    @router.get("/health")
    async def health_check() -> dict[str, Any]:
        redis_ok = False
        if service.redis:
            redis_ok = await service.redis.health_check()

        return {
            "service": service.service_name,
            "version": service.version,
            "status": "healthy",
            "uptime_seconds": round(service.uptime_seconds, 2),
            "redis": {"connected": redis_ok},
        }

    return router
