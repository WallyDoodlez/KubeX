"""Standalone agent loop — runs without OpenClaw CLI.

Instead of spawning 'openclaw agent', this module implements a minimal
agent loop that:
  1. Polls the Broker for messages matching this agent's capabilities
  2. Calls the LLM via the Gateway's OpenAI-compatible proxy
  3. Posts progress updates to the Gateway
  4. Stores the final result via the Broker
  5. Acknowledges the message

This is the MVP agent runtime for containers where the OpenClaw CLI
is not available.

Required env vars (set by Kubex Manager):
  KUBEX_AGENT_ID       — agent identity
  GATEWAY_URL          — gateway base URL
  BROKER_URL           — broker base URL (defaults to http://broker:8060)
  OPENAI_BASE_URL      — OpenAI-compatible proxy URL (set by manager)

Optional env vars:
  KUBEX_AGENT_PROMPT   — system prompt for the LLM (from config.yaml)
  KUBEX_CAPABILITIES   — comma-separated capability list to consume
  KUBEX_POLL_INTERVAL  — seconds between broker polls (default 2)
  KUBEX_MODEL          — model to request (default gpt-4o)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
from typing import Any

import httpx

logger = logging.getLogger("kubex_harness.standalone")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_POLL_INTERVAL = 2  # seconds
DEFAULT_MODEL = "gpt-5.2"
DEFAULT_SYSTEM_PROMPT = (
    "You are a KubexClaw worker agent. Complete the task described in the user message. "
    "Be concise and return structured results when possible."
)


class StandaloneConfig:
    """Configuration for the standalone agent loop, driven by env vars."""

    def __init__(self) -> None:
        self.agent_id = _require_env("KUBEX_AGENT_ID")
        self.gateway_url = _require_env("GATEWAY_URL")
        self.broker_url = os.environ.get("BROKER_URL", "http://broker:8060")
        self.openai_base_url = os.environ.get(
            "OPENAI_BASE_URL",
            f"{self.gateway_url}/v1/proxy/openai",
        )
        self.system_prompt = os.environ.get("KUBEX_AGENT_PROMPT", DEFAULT_SYSTEM_PROMPT)
        self.capabilities = _parse_capabilities(
            os.environ.get("KUBEX_CAPABILITIES", self.agent_id)
        )
        self.poll_interval = float(os.environ.get("KUBEX_POLL_INTERVAL", str(DEFAULT_POLL_INTERVAL)))
        self.model = os.environ.get("KUBEX_MODEL", DEFAULT_MODEL)


def _require_env(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise ValueError(f"Required environment variable not set: {key}")
    return value


def _parse_capabilities(raw: str) -> list[str]:
    """Parse comma-separated capability list."""
    return [c.strip() for c in raw.split(",") if c.strip()]


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


class StandaloneAgent:
    """Minimal agent loop: consume -> LLM call -> result -> ack."""

    def __init__(self, config: StandaloneConfig) -> None:
        self.config = config
        self._running = True
        self._http: httpx.AsyncClient | None = None

    async def run(self) -> None:
        """Main loop — poll broker, process messages, repeat."""
        logger.info(
            "Starting standalone agent loop: agent_id=%s capabilities=%s model=%s",
            self.config.agent_id,
            self.config.capabilities,
            self.config.model,
        )

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            self._http = client
            while self._running:
                try:
                    await self._poll_and_process(client)
                except Exception:
                    logger.exception("Error in agent loop iteration")
                await asyncio.sleep(self.config.poll_interval)

        logger.info("Standalone agent loop stopped")

    async def _poll_and_process(self, client: httpx.AsyncClient) -> None:
        """Poll broker for messages using each capability as consumer group."""
        for capability in self.config.capabilities:
            messages = await self._consume(client, capability)
            for msg in messages:
                await self._handle_message(client, msg, capability)

    async def _consume(
        self, client: httpx.AsyncClient, capability: str
    ) -> list[dict[str, Any]]:
        """GET /messages/consume/{capability} from the Broker.

        The broker creates consumer groups by capability name.
        filter_by_capability=True ensures only matching messages are returned.
        """
        url = f"{self.config.broker_url}/messages/consume/{capability}"
        try:
            resp = await client.get(url, params={"count": 5, "block_ms": 0})
            if resp.status_code == 200:
                return resp.json()
            logger.warning("Broker consume returned %d: %s", resp.status_code, resp.text)
        except httpx.ConnectError:
            logger.debug("Broker not reachable at %s", self.config.broker_url)
        except Exception:
            logger.exception("Broker consume error")
        return []

    async def _handle_message(
        self,
        client: httpx.AsyncClient,
        msg: dict[str, Any],
        consumer_group: str,
    ) -> None:
        """Process a single task message: call LLM, post result, ack."""
        task_id = msg.get("task_id", "unknown")
        context_message = msg.get("context_message", "")
        message_id = msg.get("message_id", "")

        logger.info("Processing task %s: %s", task_id, context_message[:100])

        # Post initial progress
        await self._post_progress(
            client, task_id, f"Agent {self.config.agent_id} starting task...\n", final=False
        )

        # Call LLM
        try:
            llm_response = await self._call_llm(client, context_message, task_id)
        except Exception as exc:
            logger.error("LLM call failed for task %s: %s", task_id, exc)
            llm_response = f"Error: LLM call failed — {exc}"

        # Post progress with the LLM response
        await self._post_progress(client, task_id, llm_response, final=False)

        # Post final progress
        await self._post_progress(
            client, task_id, "", final=True, exit_reason="completed"
        )

        # Store result via broker
        await self._store_result(client, task_id, llm_response)

        # Acknowledge message
        if message_id:
            await self._ack(client, message_id, consumer_group)

        logger.info("Task %s completed", task_id)

    async def _call_llm(
        self, client: httpx.AsyncClient, user_message: str, task_id: str
    ) -> str:
        """Call the OpenAI-compatible chat completions endpoint via the Gateway proxy."""
        url = f"{self.config.openai_base_url}/chat/completions"
        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": self.config.system_prompt},
                {"role": "user", "content": user_message},
            ],
            "max_completion_tokens": 4096,
        }
        headers = {
            "Content-Type": "application/json",
            "X-Kubex-Agent-Id": self.config.agent_id,
            "X-Kubex-Task-Id": task_id,
        }

        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            error_text = resp.text
            logger.error("LLM API error %d: %s", resp.status_code, error_text[:500])
            raise RuntimeError(f"LLM returned {resp.status_code}: {error_text[:200]}")

        data = resp.json()
        # Standard OpenAI response format
        choices = data.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return json.dumps(data)

    async def _post_progress(
        self,
        client: httpx.AsyncClient,
        task_id: str,
        chunk: str,
        *,
        final: bool = False,
        exit_reason: str | None = None,
    ) -> None:
        """POST progress chunk to Gateway."""
        url = f"{self.config.gateway_url}/tasks/{task_id}/progress"
        payload: dict[str, Any] = {
            "task_id": task_id,
            "agent_id": self.config.agent_id,
            "chunk": chunk,
            "final": final,
        }
        if exit_reason is not None:
            payload["exit_reason"] = exit_reason
        try:
            await client.post(url, json=payload)
        except Exception:
            logger.debug("Failed to post progress for task %s", task_id)

    async def _store_result(
        self, client: httpx.AsyncClient, task_id: str, result_text: str
    ) -> None:
        """Store task result via Broker POST /tasks/{task_id}/result."""
        url = f"{self.config.broker_url}/tasks/{task_id}/result"
        payload = {
            "result": {
                "status": "completed",
                "agent_id": self.config.agent_id,
                "output": result_text,
            }
        }
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code not in (200, 201, 204):
                logger.warning("Result store returned %d for task %s", resp.status_code, task_id)
        except Exception:
            logger.debug("Failed to store result for task %s", task_id)

    async def _ack(
        self, client: httpx.AsyncClient, message_id: str, group: str
    ) -> None:
        """Acknowledge a message on the Broker."""
        url = f"{self.config.broker_url}/messages/{message_id}/ack"
        payload = {"message_id": message_id, "group": group}
        try:
            await client.post(url, json=payload)
        except Exception:
            logger.debug("Failed to ack message %s", message_id)

    def stop(self) -> None:
        """Signal the agent loop to stop."""
        self._running = False


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
        stream=sys.stdout,
    )


async def _run() -> None:
    config = StandaloneConfig()
    agent = StandaloneAgent(config)

    # Graceful shutdown on SIGTERM/SIGINT
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, agent.stop)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    await agent.run()


def main() -> None:
    """Entry point for 'python -m kubex_harness.standalone'."""
    _setup_logging()
    asyncio.run(_run())


if __name__ == "__main__":
    main()
