"""Root conftest — shared pytest fixtures for all test levels."""

import asyncio
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from kubex_common.clients.redis import RedisClient


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_redis_client() -> RedisClient:
    """Create a mock Redis client for unit tests."""
    client = RedisClient(url="redis://localhost", db=0)
    mock = AsyncMock()
    mock.ping.return_value = True
    client._client = mock
    client._pool = MagicMock()
    return client


@pytest.fixture
def sample_action_request_data() -> dict[str, Any]:
    """Sample ActionRequest data for testing."""
    return {
        "request_id": "ar-test-001",
        "agent_id": "test-agent",
        "action": "http_get",
        "target": "https://example.com",
        "parameters": {"key": "value"},
        "priority": "normal",
    }


@pytest.fixture
def sample_envelope_data(sample_action_request_data: dict[str, Any]) -> dict[str, Any]:
    """Sample GatekeeperEnvelope data for testing."""
    return {
        "envelope_id": "ge-test-001",
        "request": sample_action_request_data,
        "enrichment": {
            "boundary": "default",
            "model_used": "claude-haiku-4-5",
            "model_tier": "light",
        },
        "evaluation": {
            "decision": "ALLOW",
            "tier": "low",
            "evaluated_by": "policy_engine",
        },
    }
