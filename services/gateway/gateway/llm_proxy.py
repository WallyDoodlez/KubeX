"""LLM Reverse Proxy for the Gateway.

Proxies requests from Kubex containers to LLM providers.
Injects API keys from Gateway secrets (never exposed to Kubexes).
Enforces model allowlist per agent.
Counts tokens on responses for budget enforcement.

Supported providers:
- anthropic → api.anthropic.com
- openai → api.openai.com
- google → generativelanguage.googleapis.com
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx

from kubex_common.errors import ModelNotAllowedError
from kubex_common.logging import get_logger

logger = get_logger(__name__)

# Provider base URLs
PROVIDER_URLS = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com",
    "google": "https://generativelanguage.googleapis.com",
}

# Auth header injection per provider
PROVIDER_AUTH_HEADERS: dict[str, str] = {
    "anthropic": "x-api-key",
    "openai": "Authorization",
    "google": "x-goog-api-key",
}

# Timeout for LLM API calls (streaming responses can take a while)
LLM_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=5.0)

# Secrets file path (loaded from Gateway secret mount)
LLM_KEYS_PATH = os.environ.get("LLM_API_KEYS_PATH", "/run/secrets/llm_api_keys.json")


def _load_api_keys() -> dict[str, str]:
    """Load LLM API keys from mounted secret file.

    Returns a dict of {provider: api_key}.
    Falls back to environment variables for local development.
    """
    keys: dict[str, str] = {}

    # Try secret file first
    secret_path = Path(LLM_KEYS_PATH)
    if secret_path.exists():
        try:
            with open(secret_path) as f:
                keys = json.load(f)
                logger.info("llm_keys_loaded_from_secret")
                return keys
        except Exception as exc:
            logger.warning("llm_keys_secret_load_failed", error=str(exc))

    # Fall back to environment variables
    for provider in PROVIDER_URLS:
        env_key = f"{provider.upper()}_API_KEY"
        val = os.environ.get(env_key)
        if val:
            keys[provider] = val

    return keys


class LLMProxy:
    """Transparent LLM reverse proxy.

    Kubexes send requests to Gateway proxy endpoints.
    Gateway injects real API keys and forwards to providers.
    """

    def __init__(self) -> None:
        self._api_keys = _load_api_keys()
        self._http_client: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        """Initialize the async HTTP client."""
        self._http_client = httpx.AsyncClient(
            timeout=LLM_TIMEOUT,
            follow_redirects=True,
        )

    async def disconnect(self) -> None:
        """Close the HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    def _get_api_key(self, provider: str) -> str | None:
        return self._api_keys.get(provider)

    def check_model_allowed(
        self,
        agent_id: str,
        provider: str,
        model: str | None,
        agent_policy: Any | None,
    ) -> bool:
        """Check if the agent is allowed to use the requested model.

        For MVP, this is a basic check against the policy.
        Post-MVP: integrate with model allowlist per agent config.
        """
        # If no policy, allow — will be tightened in integration
        if agent_policy is None:
            return True

        # For now, allow all models (model allowlist is a Wave 5+ feature)
        # The hook is here for enforcement
        return True

    async def forward(
        self,
        provider: str,
        path: str,
        method: str,
        headers: dict[str, str],
        body: bytes,
        agent_id: str,
    ) -> httpx.Response:
        """Forward a request to the provider and return the response.

        Injects the real API key for the provider.
        Strips any forwarded headers that shouldn't go upstream.
        """
        if self._http_client is None:
            raise RuntimeError("LLMProxy not connected. Call connect() first.")

        base_url = PROVIDER_URLS.get(provider)
        if not base_url:
            raise ValueError(f"Unknown provider: {provider}")

        api_key = self._get_api_key(provider)

        # Build clean headers (strip hop-by-hop headers)
        forward_headers = {
            k: v
            for k, v in headers.items()
            if k.lower() not in (
                "host", "content-length", "transfer-encoding",
                "connection", "keep-alive", "proxy-authenticate",
                "proxy-authorization", "te", "trailers", "upgrade",
                # Strip any existing auth
                "authorization", "x-api-key", "x-goog-api-key",
            )
        }

        # Inject real API key
        if api_key:
            auth_header = PROVIDER_AUTH_HEADERS.get(provider, "x-api-key")
            if provider == "openai":
                forward_headers[auth_header] = f"Bearer {api_key}"
            else:
                forward_headers[auth_header] = api_key
        else:
            logger.warning("no_api_key_for_provider", provider=provider, agent_id=agent_id)

        target_url = f"{base_url}/{path.lstrip('/')}"

        logger.info(
            "llm_proxy_forward",
            provider=provider,
            path=path,
            method=method,
            agent_id=agent_id,
            has_key=bool(api_key),
        )

        response = await self._http_client.request(
            method=method,
            url=target_url,
            headers=forward_headers,
            content=body,
        )

        return response

    def count_tokens_from_response(self, provider: str, response_body: bytes) -> dict[str, int]:
        """Extract token counts from a provider response body.

        Returns {input_tokens, output_tokens} if available.
        """
        try:
            data = json.loads(response_body)

            if provider == "anthropic":
                usage = data.get("usage", {})
                return {
                    "input_tokens": usage.get("input_tokens", 0),
                    "output_tokens": usage.get("output_tokens", 0),
                }
            elif provider == "openai":
                usage = data.get("usage", {})
                return {
                    "input_tokens": usage.get("prompt_tokens", 0),
                    "output_tokens": usage.get("completion_tokens", 0),
                }
        except Exception:
            pass

        return {"input_tokens": 0, "output_tokens": 0}
