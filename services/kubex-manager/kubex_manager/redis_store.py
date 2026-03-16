"""KubexRecordStore — Redis write-through persistence for KubexRecords.

Phase 6 — KMGR-04: Persists KubexRecords to Redis so the Manager can recover
state after a restart without losing track of running containers.

Key pattern: ``kubex:record:{kubex_id}``
No TTL — records persist until explicit delete (locked decision).

Usage::

    store = KubexRecordStore(redis_client=redis_sync_client)
    store.save(record)
    records = store.load_all()   # returns list[KubexRecord]
    store.delete(record.kubex_id)
"""

from __future__ import annotations

import json
from typing import Any

from .lifecycle import KubexRecord

# Redis key prefix for kubex records
_KEY_PREFIX = "kubex:record:"


class KubexRecordStore:
    """Synchronous Redis write-through store for KubexRecord objects.

    Args:
        redis_client: A synchronous Redis client (e.g., ``redis.Redis`` or
            ``fakeredis.FakeRedis``) with ``set``, ``get``, ``delete``, and
            ``scan_iter`` methods.
    """

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    def _key(self, kubex_id: str) -> str:
        return f"{_KEY_PREFIX}{kubex_id}"

    def save(self, record: KubexRecord) -> None:
        """Persist a KubexRecord to Redis.

        Overwrites any existing record with the same kubex_id.

        Args:
            record: The KubexRecord to persist.
        """
        key = self._key(record.kubex_id)
        value = json.dumps(record.to_dict())
        self._redis.set(key, value)

    def delete(self, kubex_id: str) -> None:
        """Remove a KubexRecord from Redis.

        Args:
            kubex_id: The kubex_id of the record to remove.
        """
        self._redis.delete(self._key(kubex_id))

    def load_all(self) -> list[KubexRecord]:
        """Load all KubexRecords from Redis.

        Uses ``scan_iter`` to iterate over keys matching the kubex:record:* pattern.

        Returns:
            List of KubexRecord objects. May be empty if no records are stored.
        """
        records: list[KubexRecord] = []
        for key in self._redis.scan_iter(f"{_KEY_PREFIX}*"):
            raw = self._redis.get(key)
            if raw is None:
                continue
            try:
                data = json.loads(raw)
                records.append(KubexRecord.from_dict(data))
            except (json.JSONDecodeError, KeyError, TypeError):
                # Skip corrupt records — log in production; silent here for simplicity
                pass
        return records
