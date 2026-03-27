"""KubexRecordStore — Redis write-through persistence for KubexRecords.

Phase 6 — KMGR-04: Persists KubexRecords to Redis so the Manager can recover
state after a restart without losing track of running containers.

Key pattern: ``kubex:record:{kubex_id}``
No TTL — records persist until explicit delete (locked decision).

Usage::

    store = KubexRecordStore(redis_client=async_redis_client)
    await store.save(record)
    records = await store.load_all()
    await store.delete(record.kubex_id)
"""

from __future__ import annotations

import json
from typing import Any

from .lifecycle import KubexRecord

# Redis key prefix for kubex records
_KEY_PREFIX = "kubex:record:"


class KubexRecordStore:
    """Async Redis write-through store for KubexRecord objects.

    Args:
        redis_client: An async Redis client (``redis.asyncio.Redis``)
            with ``set``, ``get``, ``delete``, and ``keys`` methods.
    """

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    def _key(self, kubex_id: str) -> str:
        return f"{_KEY_PREFIX}{kubex_id}"

    async def save(self, record: KubexRecord) -> None:
        """Persist a KubexRecord to Redis.

        Overwrites any existing record with the same kubex_id.

        Args:
            record: The KubexRecord to persist.
        """
        key = self._key(record.kubex_id)
        value = json.dumps(record.to_dict())
        await self._redis.set(key, value)

    async def delete(self, kubex_id: str) -> None:
        """Remove a KubexRecord from Redis.

        Args:
            kubex_id: The kubex_id of the record to remove.
        """
        await self._redis.delete(self._key(kubex_id))

    async def load_all(self) -> list[KubexRecord]:
        """Load all KubexRecords from Redis.

        Returns:
            List of KubexRecord objects. May be empty if no records are stored.
        """
        records: list[KubexRecord] = []
        keys = await self._redis.keys(f"{_KEY_PREFIX}*")
        for key in keys:
            raw = await self._redis.get(key)
            if raw is None:
                continue
            try:
                data = json.loads(raw)
                records.append(KubexRecord.from_dict(data))
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
        return records
