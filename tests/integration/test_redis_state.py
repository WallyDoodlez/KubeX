"""Integration tests for KubexRecord Redis round-trip (Phase 6 — KMGR-04).

Uses fakeredis so no live Redis daemon is required.

All tests in this file SKIP when the `kubex_manager.redis_store` module
does not yet exist (plan 06-01 = red tests only; implementation lands in 06-02).
"""

from __future__ import annotations

import os
import sys
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "services/kubex-manager"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common"))

# ---------------------------------------------------------------------------
# Implementation guard — skip entire module until redis_store exists.
# ---------------------------------------------------------------------------
redis_store_mod = pytest.importorskip(
    "kubex_manager.redis_store",
    reason="KMGR-04: redis_store not yet implemented (plan 06-02)",
)

KubexRecordStore = redis_store_mod.KubexRecordStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_RECORD_DATA: dict[str, Any] = {
    "kubex_id": "k-integration-001",
    "agent_id": "test-agent",
    "boundary": "test-boundary",
    "container_id": "deadbeef001",
    "status": "running",
    "config": {
        "agent": {
            "id": "test-agent",
            "boundary": "test-boundary",
            "skills": ["web-scraping"],
        },
        "model": {"provider": "openai", "name": "gpt-4o"},
    },
    "image": "kubexclaw-base:latest",
    "skills": ["web-scraping"],
    "config_path": "/var/kubex/configs/test-agent.yaml",
    "runtime_deps": [],
    "composed_capabilities": ["scrape_web"],
}


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


class TestKubexRecordRedisRoundTrip:
    """KMGR-04: KubexRecord persists to and loads from Redis correctly."""

    def test_kubex_record_redis_round_trip(self) -> None:
        """Write KubexRecord via KubexRecordStore.save(), read via load_all(),
        verify all fields match the original record."""
        fakeredis = pytest.importorskip(
            "fakeredis", reason="fakeredis not installed — install with: pip install fakeredis"
        )

        # Create an in-memory Redis instance
        fake_redis = fakeredis.FakeRedis(decode_responses=True)
        store = KubexRecordStore(redis_client=fake_redis)

        # Import KubexRecord from lifecycle to create a real record object
        from kubex_manager.lifecycle import KubexRecord

        record = KubexRecord(**SAMPLE_RECORD_DATA)

        # Save
        store.save(record)

        # Load all records back
        loaded_records = store.load_all()

        assert len(loaded_records) >= 1
        loaded = next(
            (r for r in loaded_records if r.kubex_id == record.kubex_id), None
        )
        assert loaded is not None, (
            f"Record with kubex_id={record.kubex_id} not found after save()"
        )

        # Verify fields
        assert loaded.kubex_id == record.kubex_id
        assert loaded.agent_id == record.agent_id
        assert loaded.boundary == record.boundary
        assert loaded.container_id == record.container_id
        assert loaded.status == record.status
        assert loaded.image == record.image

    def test_save_overwrites_existing_record(self) -> None:
        """Calling save() twice with the same kubex_id overwrites the record."""
        fakeredis = pytest.importorskip(
            "fakeredis", reason="fakeredis not installed"
        )

        fake_redis = fakeredis.FakeRedis(decode_responses=True)
        store = KubexRecordStore(redis_client=fake_redis)

        from kubex_manager.lifecycle import KubexRecord

        record = KubexRecord(**SAMPLE_RECORD_DATA)
        store.save(record)

        # Update status and save again
        record.status = "stopped"
        store.save(record)

        loaded_records = store.load_all()
        matching = [r for r in loaded_records if r.kubex_id == record.kubex_id]
        assert len(matching) == 1, "Should have exactly one record (no duplicates)"
        assert matching[0].status == "stopped"

    def test_delete_removes_record(self) -> None:
        """KubexRecordStore.delete(kubex_id) removes the record from Redis."""
        fakeredis = pytest.importorskip(
            "fakeredis", reason="fakeredis not installed"
        )

        fake_redis = fakeredis.FakeRedis(decode_responses=True)
        store = KubexRecordStore(redis_client=fake_redis)

        from kubex_manager.lifecycle import KubexRecord

        record = KubexRecord(**SAMPLE_RECORD_DATA)
        store.save(record)

        # Verify it's there
        loaded = store.load_all()
        assert any(r.kubex_id == record.kubex_id for r in loaded)

        # Delete
        store.delete(record.kubex_id)

        # Verify it's gone
        loaded_after = store.load_all()
        assert not any(r.kubex_id == record.kubex_id for r in loaded_after)
