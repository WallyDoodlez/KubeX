"""Async HTTP client wrapper with retry policy and timeout defaults."""

from __future__ import annotations

from typing import Any

import httpx

from kubex_common.constants import DEFAULT_CONNECT_TIMEOUT, DEFAULT_READ_TIMEOUT
from kubex_common.logging import get_logger

logger = get_logger(__name__)

_DEFAULT_TIMEOUT = httpx.Timeout(
    connect=DEFAULT_CONNECT_TIMEOUT,
    read=DEFAULT_READ_TIMEOUT,
    write=DEFAULT_READ_TIMEOUT,
    pool=DEFAULT_CONNECT_TIMEOUT,
)

_DEFAULT_MAX_RETRIES = 3
_DEFAULT_BACKOFF_BASE = 0.5


class HttpClient:
    """Async HTTP client with retry, timeout defaults, and request ID injection."""

    def __init__(
        self,
        base_url: str = "",
        timeout: httpx.Timeout | None = None,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout or _DEFAULT_TIMEOUT
        self._max_retries = max_retries
        self._default_headers = headers or {}
        self._client: httpx.AsyncClient | None = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            transport = httpx.AsyncHTTPTransport(retries=self._max_retries)
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                headers=self._default_headers,
                transport=transport,
            )
        return self._client

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        client = await self._ensure_client()
        return await client.get(url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        client = await self._ensure_client()
        return await client.post(url, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> httpx.Response:
        client = await self._ensure_client()
        return await client.put(url, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        client = await self._ensure_client()
        return await client.delete(url, **kwargs)

    async def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        client = await self._ensure_client()
        return await client.patch(url, **kwargs)

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> HttpClient:
        await self._ensure_client()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()


def create_http_client(
    base_url: str = "",
    timeout: httpx.Timeout | None = None,
    max_retries: int = _DEFAULT_MAX_RETRIES,
    headers: dict[str, str] | None = None,
) -> HttpClient:
    """Factory for creating an HttpClient with standard defaults."""
    return HttpClient(base_url=base_url, timeout=timeout, max_retries=max_retries, headers=headers)
