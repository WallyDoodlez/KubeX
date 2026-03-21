"""KubexService base class — FastAPI app factory with shared boilerplate."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kubex_common.clients.redis import RedisClient, create_redis_client
from kubex_common.logging import configure_logging, get_logger
from kubex_common.service.health import create_health_router
from kubex_common.service.middleware import LoggingMiddleware, RequestIDMiddleware

logger = get_logger(__name__)


class KubexService:
    """Base class for all KubexClaw services.

    Handles config loading, structlog init, Redis connection pool,
    /health endpoint, and graceful shutdown.
    """

    def __init__(
        self,
        service_name: str,
        version: str = "0.1.0",
        config_path: str | None = None,
        redis_url: str | None = None,
        redis_db: int = 0,
    ) -> None:
        self.service_name = service_name
        self.version = version
        self.start_time = time.time()
        self.config: dict[str, Any] = {}
        self._config_path = config_path
        self._redis_url = redis_url
        self._redis_db = redis_db
        self.redis: RedisClient | None = None
        self.app = self._create_app()

    def _create_app(self) -> FastAPI:
        app = FastAPI(title=self.service_name, version=self.version)

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        app.add_middleware(LoggingMiddleware)
        app.add_middleware(RequestIDMiddleware)

        health_router = create_health_router(self)
        app.include_router(health_router)

        app.add_event_handler("startup", self._startup)
        app.add_event_handler("shutdown", self._shutdown)

        return app

    async def _startup(self) -> None:
        configure_logging(self.service_name)
        logger.info("service_starting", service=self.service_name, version=self.version)

        if self._config_path:
            self.config = self._load_config(self._config_path)

        if self._redis_url:
            self.redis = create_redis_client(host="")  # We'll use URL directly
            self.redis._url = self._redis_url
            self.redis._db = self._redis_db
            await self.redis.connect()

        await self.on_startup()

    async def _shutdown(self) -> None:
        logger.info("service_shutting_down", service=self.service_name)
        await self.on_shutdown()
        if self.redis:
            await self.redis.disconnect()
        logger.info("service_stopped", service=self.service_name)

    def _load_config(self, path: str) -> dict[str, Any]:
        config_file = Path(path)
        if config_file.exists():
            with open(config_file) as f:
                return yaml.safe_load(f) or {}
        logger.warning("config_not_found", path=path)
        return {}

    async def on_startup(self) -> None:
        """Override in subclasses for custom startup logic."""

    async def on_shutdown(self) -> None:
        """Override in subclasses for custom shutdown logic."""

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self.start_time
