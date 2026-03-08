"""Async Redis client helper with DB-number awareness and connection pooling."""

from __future__ import annotations

from typing import Any

import redis.asyncio as aioredis

from kubex_common.constants import REDIS_PORT
from kubex_common.logging import get_logger

logger = get_logger(__name__)


class RedisClient:
    """Async Redis client wrapper with connection pool and health check."""

    def __init__(
        self,
        url: str = "redis://localhost",
        db: int = 0,
        password: str | None = None,
        max_connections: int = 10,
        decode_responses: bool = True,
    ) -> None:
        self._url = url
        self._db = db
        self._password = password
        self._max_connections = max_connections
        self._decode_responses = decode_responses
        self._pool: aioredis.ConnectionPool | None = None
        self._client: aioredis.Redis | None = None

    async def connect(self) -> None:
        """Initialize connection pool and client."""
        self._pool = aioredis.ConnectionPool.from_url(
            self._url,
            db=self._db,
            password=self._password,
            max_connections=self._max_connections,
            decode_responses=self._decode_responses,
        )
        self._client = aioredis.Redis(connection_pool=self._pool)
        logger.info("redis_connected", url=self._url, db=self._db)

    async def disconnect(self) -> None:
        """Close connection pool."""
        if self._client:
            await self._client.aclose()
            self._client = None
        if self._pool:
            await self._pool.disconnect()
            self._pool = None
        logger.info("redis_disconnected", db=self._db)

    async def health_check(self) -> bool:
        """Check Redis connectivity."""
        try:
            if self._client is None:
                return False
            result = await self._client.ping()
            return result is True
        except Exception:
            return False

    @property
    def client(self) -> aioredis.Redis:
        """Get the underlying Redis client. Raises if not connected."""
        if self._client is None:
            raise RuntimeError("Redis client not connected. Call connect() first.")
        return self._client

    async def __aenter__(self) -> RedisClient:
        await self.connect()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.disconnect()


def create_redis_client(
    host: str = "localhost",
    port: int = REDIS_PORT,
    db: int = 0,
    password: str | None = None,
    max_connections: int = 10,
) -> RedisClient:
    """Factory for creating a RedisClient with standard defaults."""
    url = f"redis://{host}:{port}"
    return RedisClient(url=url, db=db, password=password, max_connections=max_connections)
