"""Root conftest — shared pytest fixtures for all test levels."""

import asyncio
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from kubex_common.clients.redis import RedisClient

# ---------------------------------------------------------------------------
# Path setup — ensure kubex_harness is importable for config patching
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "agents/_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs/kubex-common/src"))


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def default_agent_config(tmp_path_factory) -> str:
    """Write a minimal config.yaml to a temp directory and return its path.

    Session-scoped so the file is created once and reused across all tests.
    Tests that call load_agent_config() with no arguments will use this path
    via the _patch_default_config_path autouse fixture below.

    Per locked decision: write a real file to tmp_path so the real file-reading
    code path is exercised (not mocked).
    """
    import yaml  # type: ignore[import]

    config_dir = tmp_path_factory.mktemp("agent_config")
    config_file = config_dir / "config.yaml"
    config_data = {
        "agent": {
            "id": "test-agent",
            "model": "gpt-5.2",
            "capabilities": [],
            "skills": [],
        }
    }
    config_file.write_text(yaml.dump(config_data), encoding="utf-8")
    return str(config_file)


@pytest.fixture(scope="session", autouse=True)
def _patch_default_config_path(default_agent_config: str) -> None:
    """Patch load_agent_config's default path to point at the test config.

    Autouse session-scoped — active for all tests automatically.
    Any test that calls load_agent_config() with no args gets the test config
    instead of /app/config.yaml.  Tests that pass an explicit path are unaffected.
    """
    try:
        import kubex_harness.config_loader as _cl

        original_defaults = _cl.load_agent_config.__defaults__
        _cl.load_agent_config.__defaults__ = (default_agent_config,)
        yield
        _cl.load_agent_config.__defaults__ = original_defaults
    except ImportError:
        # kubex_harness not importable yet — no-op
        yield


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
