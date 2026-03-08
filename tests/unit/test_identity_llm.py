"""Unit tests for Gateway identity.py and llm_proxy.py (Layer 1, Sections 1.1 and 1.2).

Covers:
  - IdentityResolver: Docker label resolution, cache behavior, error handling
  - LLMProxy: token counting, header stripping, key injection, forward validation
"""

from __future__ import annotations

import os
import sys
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/gateway"))

from gateway.identity import IDENTITY_CACHE_TTL, LABEL_AGENT_ID, LABEL_BOUNDARY, IdentityResolver
from gateway.llm_proxy import LLMProxy, PROVIDER_URLS, _load_api_keys
from kubex_common.errors import IdentityResolutionError


# ─────────────────────────────────────────────
# 1.1 IdentityResolver Tests
# ─────────────────────────────────────────────


def make_docker_container(ip: str, agent_id: str, boundary: str = "default") -> dict:
    """Helper: construct a fake Docker container attrs dict."""
    return {
        "NetworkSettings": {
            "Networks": {
                "kubex-net": {
                    "IPAddress": ip,
                }
            }
        },
        "Labels": {
            LABEL_AGENT_ID: agent_id,
            LABEL_BOUNDARY: boundary,
        },
    }


def make_docker_client(containers: list[dict]) -> MagicMock:
    """Create a mock Docker SDK client whose containers.list() returns the given dicts.

    The IdentityResolver._list_containers() iterates container objects and reads
    c.attrs and c.labels. We mirror that shape here.
    """
    mock_client = MagicMock()
    mock_containers = []
    for c in containers:
        container = MagicMock()
        container.attrs = c
        container.labels = c.get("Labels", {})
        mock_containers.append(container)
    mock_client.containers.list.return_value = mock_containers
    return mock_client


class TestIdentityResolverNoDocker:
    """Tests for IdentityResolver when no Docker client is available."""

    @pytest.mark.asyncio
    async def test_resolve_raises_when_no_docker_client(self) -> None:
        """UT-ID-01: resolve() without Docker client raises IdentityResolutionError."""
        resolver = IdentityResolver(docker_client=None)
        with pytest.raises(IdentityResolutionError):
            await resolver.resolve("1.2.3.4")


class TestIdentityResolverWithDocker:
    """Tests for IdentityResolver with a mock Docker client."""

    def setup_method(self) -> None:
        self.container_data = make_docker_container("10.0.0.5", "scraper", "default")
        self.docker_client = make_docker_client([self.container_data])
        self.resolver = IdentityResolver(docker_client=self.docker_client)

    @pytest.mark.asyncio
    async def test_resolve_returns_agent_id_from_docker_labels(self) -> None:
        """UT-ID-02: resolve() returns (agent_id, boundary) from Docker labels."""
        agent_id, boundary = await self.resolver.resolve("10.0.0.5")
        assert agent_id == "scraper"
        assert boundary == "default"

    @pytest.mark.asyncio
    async def test_resolve_uses_cache_on_second_call(self) -> None:
        """UT-ID-03: Second call for same IP uses cached result; Docker API called once."""
        await self.resolver.resolve("10.0.0.5")
        await self.resolver.resolve("10.0.0.5")
        # containers.list() should only be called once
        self.docker_client.containers.list.assert_called_once()

    @pytest.mark.asyncio
    async def test_cache_expires_after_ttl(self) -> None:
        """UT-ID-04: Stale cache entry (past TTL) causes Docker API to be re-called."""
        # Inject stale entry manually (timestamp = now - (TTL + 5))
        stale_ts = time.time() - (IDENTITY_CACHE_TTL + 5)
        self.resolver._cache["10.0.0.5"] = ("old-agent", "old-boundary", stale_ts)

        agent_id, boundary = await self.resolver.resolve("10.0.0.5")
        # Should have called Docker API to refresh
        self.docker_client.containers.list.assert_called_once()
        assert agent_id == "scraper"

    @pytest.mark.asyncio
    async def test_resolve_raises_when_no_matching_container(self) -> None:
        """UT-ID-05: raises IdentityResolutionError when no container matches source IP."""
        with pytest.raises(IdentityResolutionError):
            await self.resolver.resolve("192.168.99.99")

    @pytest.mark.asyncio
    async def test_resolve_uses_default_boundary_when_label_missing(self) -> None:
        """UT-ID-06: Container with agent_id but no boundary label defaults to 'default'."""
        container = {
            "NetworkSettings": {"Networks": {"kubex-net": {"IPAddress": "10.0.0.7"}}},
            "Labels": {LABEL_AGENT_ID: "reviewer"},  # No LABEL_BOUNDARY
        }
        docker_client = make_docker_client([container])
        resolver = IdentityResolver(docker_client=docker_client)
        agent_id, boundary = await resolver.resolve("10.0.0.7")
        assert agent_id == "reviewer"
        assert boundary == "default"

    @pytest.mark.asyncio
    async def test_resolve_raises_on_docker_api_exception(self) -> None:
        """UT-ID-09: Docker API raises RuntimeError — wrapped in IdentityResolutionError."""
        self.docker_client.containers.list.side_effect = RuntimeError("Docker daemon gone")
        with pytest.raises(IdentityResolutionError):
            await self.resolver.resolve("10.0.0.5")


class TestIdentityResolverCache:
    """Tests for cache invalidation."""

    def setup_method(self) -> None:
        container_a = make_docker_container("10.0.0.1", "agent-a")
        container_b = make_docker_container("10.0.0.2", "agent-b")
        self.docker_client = make_docker_client([container_a, container_b])
        self.resolver = IdentityResolver(docker_client=self.docker_client)
        # Pre-populate cache
        now = time.time()
        self.resolver._cache["10.0.0.1"] = ("agent-a", "default", now)
        self.resolver._cache["10.0.0.2"] = ("agent-b", "default", now)

    def test_invalidate_cache_clears_single_ip(self) -> None:
        """UT-ID-07: invalidate_cache('10.0.0.1') removes only that IP."""
        self.resolver.invalidate_cache("10.0.0.1")
        assert "10.0.0.1" not in self.resolver._cache
        assert "10.0.0.2" in self.resolver._cache

    def test_invalidate_cache_clears_all(self) -> None:
        """UT-ID-08: invalidate_cache() with no argument clears entire cache."""
        self.resolver.invalidate_cache()
        assert len(self.resolver._cache) == 0


# ─────────────────────────────────────────────
# 1.2 LLMProxy Tests
# ─────────────────────────────────────────────


class TestLLMProxyModelCheck:
    def test_check_model_allowed_no_policy_returns_true(self) -> None:
        """UT-LLM-01: No policy = allow all models."""
        proxy = LLMProxy()
        result = proxy.check_model_allowed("agent-1", "anthropic", "claude-3-sonnet", None)
        assert result is True

    def test_check_model_allowed_with_policy_returns_true(self) -> None:
        """With policy present, current MVP implementation also returns True."""
        proxy = LLMProxy()
        mock_policy = MagicMock()
        result = proxy.check_model_allowed("agent-1", "anthropic", "claude-3-sonnet", mock_policy)
        assert result is True


class TestLLMProxyTokenCounting:
    def setup_method(self) -> None:
        self.proxy = LLMProxy()

    def test_count_tokens_anthropic_response(self) -> None:
        """UT-LLM-02: Parses Anthropic-format usage.input_tokens / usage.output_tokens."""
        import json
        body = json.dumps({
            "id": "msg_01",
            "usage": {"input_tokens": 123, "output_tokens": 456},
        }).encode()
        result = self.proxy.count_tokens_from_response("anthropic", body)
        assert result["input_tokens"] == 123
        assert result["output_tokens"] == 456

    def test_count_tokens_openai_response(self) -> None:
        """UT-LLM-03: Parses OpenAI-format usage.prompt_tokens / usage.completion_tokens."""
        import json
        body = json.dumps({
            "id": "chatcmpl-01",
            "usage": {"prompt_tokens": 80, "completion_tokens": 120},
        }).encode()
        result = self.proxy.count_tokens_from_response("openai", body)
        assert result["input_tokens"] == 80
        assert result["output_tokens"] == 120

    def test_count_tokens_malformed_json_returns_zeros(self) -> None:
        """UT-LLM-04: Malformed JSON returns zeros without raising."""
        result = self.proxy.count_tokens_from_response("anthropic", b"not json at all !!!!")
        assert result["input_tokens"] == 0
        assert result["output_tokens"] == 0

    def test_count_tokens_missing_usage_key_returns_zeros(self) -> None:
        """UT-LLM-05: Valid JSON without 'usage' key returns zeros."""
        import json
        body = json.dumps({"id": "msg_01", "content": "hello"}).encode()
        result = self.proxy.count_tokens_from_response("anthropic", body)
        assert result["input_tokens"] == 0
        assert result["output_tokens"] == 0

    def test_count_tokens_partial_usage_returns_partial(self) -> None:
        """Partial usage fields (only input_tokens set) return correct partial values."""
        import json
        body = json.dumps({"usage": {"input_tokens": 50}}).encode()
        result = self.proxy.count_tokens_from_response("anthropic", body)
        assert result["input_tokens"] == 50
        assert result["output_tokens"] == 0


class TestLLMProxyForward:
    def setup_method(self) -> None:
        self.proxy = LLMProxy()

    @pytest.mark.asyncio
    async def test_forward_raises_when_not_connected(self) -> None:
        """UT-LLM-06: forward() before connect() raises RuntimeError."""
        with pytest.raises(RuntimeError, match="not connected"):
            await self.proxy.forward(
                provider="anthropic",
                path="/v1/messages",
                method="POST",
                headers={},
                body=b"{}",
                agent_id="test-agent",
            )

    @pytest.mark.asyncio
    async def test_forward_raises_on_unknown_provider(self) -> None:
        """UT-LLM-07: Unknown provider raises ValueError."""
        # Connect the proxy (set the client)
        self.proxy._http_client = AsyncMock()
        with pytest.raises(ValueError, match="Unknown provider"):
            await self.proxy.forward(
                provider="xyzzy",
                path="/v1/messages",
                method="POST",
                headers={},
                body=b"{}",
                agent_id="test-agent",
            )

    @pytest.mark.asyncio
    async def test_forward_injects_anthropic_api_key(self) -> None:
        """UT-LLM-08: Forwarded request to api.anthropic.com has x-api-key header."""
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_http.request = AsyncMock(return_value=mock_response)
        self.proxy._http_client = mock_http
        self.proxy._api_keys = {"anthropic": "sk-ant-test123"}

        await self.proxy.forward(
            provider="anthropic",
            path="/v1/messages",
            method="POST",
            headers={"content-type": "application/json"},
            body=b'{"model":"claude-3-sonnet"}',
            agent_id="test-agent",
        )

        call_args = mock_http.request.call_args
        sent_headers = call_args.kwargs.get("headers") or call_args[1].get("headers") or call_args[0][2]
        assert sent_headers.get("x-api-key") == "sk-ant-test123"

    @pytest.mark.asyncio
    async def test_forward_injects_openai_bearer_token(self) -> None:
        """UT-LLM-09: Forwarded request has Authorization: Bearer <key> for openai."""
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_http.request = AsyncMock(return_value=mock_response)
        self.proxy._http_client = mock_http
        self.proxy._api_keys = {"openai": "sk-openai-test456"}

        await self.proxy.forward(
            provider="openai",
            path="/v1/chat/completions",
            method="POST",
            headers={"content-type": "application/json"},
            body=b'{"model":"gpt-4"}',
            agent_id="test-agent",
        )

        call_args = mock_http.request.call_args
        sent_headers = call_args.kwargs.get("headers") or call_args[1].get("headers") or call_args[0][2]
        assert sent_headers.get("Authorization") == "Bearer sk-openai-test456"

    @pytest.mark.asyncio
    async def test_forward_strips_existing_auth_headers(self) -> None:
        """UT-LLM-10: Incoming auth headers are NOT forwarded — only injected key is used."""
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_http.request = AsyncMock(return_value=mock_response)
        self.proxy._http_client = mock_http
        self.proxy._api_keys = {"anthropic": "sk-real-key"}

        incoming_headers = {
            "content-type": "application/json",
            "authorization": "Bearer SPOOFED_KEY",
            "x-api-key": "SPOOFED_ANTHROPIC_KEY",
        }

        await self.proxy.forward(
            provider="anthropic",
            path="/v1/messages",
            method="POST",
            headers=incoming_headers,
            body=b"{}",
            agent_id="test-agent",
        )

        call_args = mock_http.request.call_args
        sent_headers = call_args.kwargs.get("headers") or call_args[1].get("headers") or call_args[0][2]

        # Spoofed auth must NOT appear
        assert sent_headers.get("authorization") != "Bearer SPOOFED_KEY"
        # Real injected key must be present
        assert sent_headers.get("x-api-key") == "sk-real-key"

    @pytest.mark.asyncio
    async def test_forward_strips_hop_by_hop_headers(self) -> None:
        """UT-LLM-11: connection, transfer-encoding, keep-alive are stripped."""
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_http.request = AsyncMock(return_value=mock_response)
        self.proxy._http_client = mock_http
        self.proxy._api_keys = {"anthropic": "sk-key"}

        incoming_headers = {
            "content-type": "application/json",
            "connection": "keep-alive",
            "transfer-encoding": "chunked",
            "keep-alive": "timeout=30",
        }

        await self.proxy.forward(
            provider="anthropic",
            path="/v1/messages",
            method="POST",
            headers=incoming_headers,
            body=b"{}",
            agent_id="test-agent",
        )

        call_args = mock_http.request.call_args
        sent_headers = call_args.kwargs.get("headers") or call_args[1].get("headers") or call_args[0][2]

        assert "connection" not in sent_headers
        assert "transfer-encoding" not in sent_headers
        assert "keep-alive" not in sent_headers


class TestLLMProxyKeyLoading:
    def test_load_api_keys_falls_back_to_env_when_no_secret_file(self) -> None:
        """UT-LLM-12: Env var ANTHROPIC_API_KEY used when secret file doesn't exist."""
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test123"}, clear=False):
            with patch("gateway.llm_proxy.LLM_KEYS_PATH", "/nonexistent/path/llm_keys.json"):
                keys = _load_api_keys()
        assert keys.get("anthropic") == "test123"

    def test_load_api_keys_all_providers_from_env(self) -> None:
        """All provider env vars loaded correctly."""
        env_overrides = {
            "ANTHROPIC_API_KEY": "ant-key",
            "OPENAI_API_KEY": "openai-key",
            "GOOGLE_API_KEY": "google-key",
        }
        with patch.dict(os.environ, env_overrides, clear=False):
            with patch("gateway.llm_proxy.LLM_KEYS_PATH", "/nonexistent/path/llm_keys.json"):
                keys = _load_api_keys()
        assert keys.get("anthropic") == "ant-key"
        assert keys.get("openai") == "openai-key"
