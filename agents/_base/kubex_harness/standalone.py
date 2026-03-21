"""Standalone agent loop — runs without OpenClaw CLI.

Instead of spawning 'openclaw agent', this module implements a minimal
agent loop that:
  1. Polls the Broker for messages matching this agent's capabilities
  2. Calls the LLM via the Gateway's OpenAI-compatible proxy
     - For agents with tool definitions in their skill manifest, uses a
       multi-turn function-calling loop until LLM produces a final answer
     - For agents without tools, uses a single-shot LLM call
  3. Posts progress updates to the Gateway
  4. Stores the final result via the Broker
  5. Acknowledges the message

This is the unified agent runtime for all Kubex containers.
Configuration is loaded from /app/config.yaml via load_agent_config().
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Any

import httpx

from kubex_harness.config_loader import AgentConfig

logger = logging.getLogger("kubex_harness.standalone")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_POLL_INTERVAL = 2  # seconds
DEFAULT_SYSTEM_PROMPT = (
    "You are a KubexClaw worker agent. Complete the task described in the user message. "
    "Be concise and return structured results when possible."
)
DEFAULT_MAX_ITERATIONS = 20


def _parse_capabilities(raw: str) -> list[str]:
    """Parse comma-separated capability list."""
    return [c.strip() for c in raw.split(",") if c.strip()]


def _load_skill_files(skills_dir: str = "/app/skills") -> str:
    """Scan skills_dir recursively for *.md files and return their concatenated content.

    Each skill file is separated by a header showing its relative path.
    Returns an empty string if the directory doesn't exist or contains no .md files.
    """
    skills_path = Path(skills_dir)
    if not skills_path.is_dir():
        logger.debug("Skills directory not found: %s", skills_dir)
        return ""

    md_files = sorted(skills_path.rglob("*.md"))
    if not md_files:
        logger.debug("No skill .md files found in %s", skills_dir)
        return ""

    parts: list[str] = []
    for md_file in md_files:
        rel = md_file.relative_to(skills_path)
        try:
            content = md_file.read_text(encoding="utf-8")
            parts.append(f"\n--- Skill: {rel} ---\n{content}")
            logger.info("Loaded skill file: %s", rel)
        except OSError:
            logger.warning("Failed to read skill file: %s", md_file)

    if not parts:
        return ""

    return "\n\n## Loaded Skills\n" + "\n".join(parts)


def _load_tool_definitions(skills_dir: str = "/app/skills") -> list[dict[str, Any]]:
    """Load OpenAI-format tool definitions from skill manifest.yaml files.

    Scans skills_dir for manifest.yaml files and converts declared tools
    into the OpenAI function-calling format.

    Returns an empty list if no tools are declared.
    """
    import yaml  # noqa: PLC0415

    skills_path = Path(skills_dir)
    if not skills_path.is_dir():
        return []

    tools: list[dict[str, Any]] = []
    for manifest_file in sorted(skills_path.rglob("manifest.yaml")):
        try:
            manifest = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict):
                continue
            for tool_def in manifest.get("tools", []) or []:
                if not isinstance(tool_def, dict) or not tool_def.get("name"):
                    continue
                # Build OpenAI function schema from manifest tool definition
                params = tool_def.get("parameters") or {}
                properties: dict[str, Any] = {}
                required: list[str] = []
                for param_name, param_info in params.items():
                    if not isinstance(param_info, dict):
                        continue
                    prop: dict[str, Any] = {
                        "type": param_info.get("type", "string"),
                    }
                    if param_info.get("description"):
                        prop["description"] = param_info["description"]
                    if param_info.get("items"):
                        prop["items"] = param_info["items"]
                    properties[param_name] = prop
                    if param_info.get("required", False):
                        required.append(param_name)

                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool_def["name"],
                            "description": tool_def.get("description", ""),
                            "parameters": {
                                "type": "object",
                                "properties": properties,
                                "required": required,
                            },
                        },
                    }
                )
        except Exception:
            logger.warning("Failed to load tool definitions from %s", manifest_file)

    return tools


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


class StandaloneAgent:
    """Agent loop: consume -> LLM call (single-shot or multi-turn) -> result -> ack.

    Accepts AgentConfig (loaded from config.yaml via load_agent_config).
    For agents whose skill manifests declare tools, the LLM call becomes a
    multi-turn function-calling loop using the standard OpenAI tool_calls pattern.
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self._running = True
        self._http: httpx.AsyncClient | None = None

        # Resolve runtime values
        self.openai_base_url = os.environ.get(
            "OPENAI_BASE_URL",
            f"{config.gateway_url}/v1/proxy/openai",
        )
        self.poll_interval = float(os.environ.get("KUBEX_POLL_INTERVAL", str(DEFAULT_POLL_INTERVAL)))
        self.max_iterations = int(os.environ.get("KUBEX_MAX_ITERATIONS", str(DEFAULT_MAX_ITERATIONS)))
        self.poll_timeout = int(os.environ.get("KUBEX_POLL_TIMEOUT", "30"))
        self.registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")

        # Build system prompt: load from skill SKILL.md files
        skills_dir = os.environ.get("KUBEX_SKILLS_DIR", "/app/skills")
        skill_content = _load_skill_files(skills_dir)
        if skill_content:
            # Skill SKILL.md content becomes the system prompt
            self.system_prompt = skill_content
        else:
            self.system_prompt = DEFAULT_SYSTEM_PROMPT

        # Load tool definitions from skill manifests
        self.tool_definitions = _load_tool_definitions(skills_dir)

    async def _register_in_registry(self, client: httpx.AsyncClient) -> None:
        """Register this agent in the Registry so it appears in the dashboard.

        Retries up to 5 times with 3s delay — the registry may not be ready
        immediately when the agent container starts.
        """
        for attempt in range(5):
            try:
                resp = await client.post(
                    f"{self.registry_url}/agents",
                    json={
                        "agent_id": self.config.agent_id,
                        "capabilities": self.config.capabilities,
                        "status": "running",
                        "boundary": self.config.boundary,
                    },
                )
                if resp.status_code in (200, 201):
                    logger.info("Registered in registry: agent_id=%s", self.config.agent_id)
                    return
                elif resp.status_code == 422:
                    logger.info("Already registered in registry: agent_id=%s", self.config.agent_id)
                    return
                else:
                    logger.warning("Registry returned %d: %s", resp.status_code, resp.text)
            except Exception:
                logger.info(
                    "Registry not ready (attempt %d/5), retrying in 3s...",
                    attempt + 1,
                )
            await asyncio.sleep(3)
        logger.warning("Could not register in registry after 5 attempts")

    async def run(self) -> None:
        """Main loop — register, then poll broker, process messages, repeat."""
        logger.info(
            "Starting standalone agent loop: agent_id=%s capabilities=%s model=%s tools=%d",
            self.config.agent_id,
            self.config.capabilities,
            self.config.model,
            len(self.tool_definitions),
        )

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            self._http = client
            await self._register_in_registry(client)
            while self._running:
                try:
                    await self._poll_and_process(client)
                except Exception:
                    logger.exception("Error in agent loop iteration")
                await asyncio.sleep(self.poll_interval)

        logger.info("Standalone agent loop stopped")

    async def _poll_and_process(self, client: httpx.AsyncClient) -> None:
        """Poll broker for messages using each capability as consumer group."""
        for capability in self.config.capabilities:
            messages = await self._consume(client, capability)
            for msg in messages:
                await self._handle_message(client, msg, capability)

    async def _consume(self, client: httpx.AsyncClient, capability: str) -> list[dict[str, Any]]:
        """GET /messages/consume/{capability} from the Broker."""
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
        await self._post_progress(client, task_id, f"Agent {self.config.agent_id} starting task...\n", final=False)

        # Call LLM (single-shot or multi-turn depending on tool definitions)
        try:
            if self.tool_definitions:
                llm_response = await self._call_llm_with_tools(client, context_message, task_id)
            else:
                llm_response = await self._call_llm(client, context_message, task_id)
        except Exception as exc:
            logger.error("LLM call failed for task %s: %s", task_id, exc)
            llm_response = f"Error: LLM call failed — {exc}"

        # Post progress with the LLM response
        await self._post_progress(client, task_id, llm_response, final=False)

        # Post final progress
        await self._post_progress(client, task_id, "", final=True, exit_reason="completed")

        # Store result via broker
        await self._store_result(client, task_id, llm_response)

        # Acknowledge message
        if message_id:
            await self._ack(client, message_id, consumer_group)

        logger.info("Task %s completed", task_id)

    async def _call_llm(self, client: httpx.AsyncClient, user_message: str, task_id: str) -> str:
        """Call the OpenAI-compatible chat completions endpoint (single-shot).

        Used for agents without tool definitions.
        """
        url = f"{self.openai_base_url}/chat/completions"
        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": self.system_prompt},
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
        choices = data.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return json.dumps(data)

    async def _call_llm_with_tools(self, client: httpx.AsyncClient, user_message: str, task_id: str) -> str:
        """Multi-turn tool-use loop.

        Maintains a conversation history, sending it to the LLM with tool
        definitions loaded from the skill manifest.  When the LLM responds with
        tool_calls, executes them via HTTP to Gateway/Broker/Registry, appends
        the results, and calls the LLM again.  The loop ends when the LLM
        responds with a text message (no tool_calls) or we hit the iteration limit.
        """
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message},
        ]

        for iteration in range(self.max_iterations):
            logger.info(
                "Task %s: tool-use iteration %d/%d",
                task_id,
                iteration + 1,
                self.max_iterations,
            )

            response_message = await self._chat_completion(client, messages, task_id, use_tools=True)

            # Append the assistant message to history
            messages.append(response_message)

            # Check if LLM wants to call tools
            tool_calls = response_message.get("tool_calls")
            if not tool_calls:
                # Final text response — we're done
                content = response_message.get("content", "")
                logger.info(
                    "Task %s: LLM returned final response after %d iterations",
                    task_id,
                    iteration + 1,
                )
                return content or ""

            # Execute each tool call and append results
            for tool_call in tool_calls:
                tool_name = tool_call["function"]["name"]
                tool_call_id = tool_call["id"]

                # Parse arguments
                try:
                    tool_args = json.loads(tool_call["function"]["arguments"])
                except (json.JSONDecodeError, KeyError):
                    tool_args = {}

                logger.info(
                    "Task %s: executing tool %s(%s)",
                    task_id,
                    tool_name,
                    json.dumps(tool_args)[:200],
                )

                # Execute the tool
                tool_result = await self._execute_tool(client, tool_name, tool_args, task_id)

                # Post progress update showing tool activity
                await self._post_progress(
                    client,
                    task_id,
                    f"[tool:{tool_name}] {json.dumps(tool_result)[:500]}\n",
                    final=False,
                )

                # Append tool result to conversation
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(tool_result) if not isinstance(tool_result, str) else tool_result,
                    }
                )

        # Hit iteration limit — ask LLM for a final summary without tools
        logger.warning(
            "Task %s: hit max iterations (%d), requesting final summary",
            task_id,
            self.max_iterations,
        )
        messages.append(
            {
                "role": "user",
                "content": (
                    "You have reached the maximum number of tool-call iterations. "
                    "Please provide your final answer now based on the information gathered so far."
                ),
            }
        )
        response_message = await self._chat_completion(client, messages, task_id, use_tools=False)
        return response_message.get("content", "") or ""

    async def _chat_completion(
        self,
        client: httpx.AsyncClient,
        messages: list[dict[str, Any]],
        task_id: str,
        *,
        use_tools: bool = True,
    ) -> dict[str, Any]:
        """Call the OpenAI chat completions endpoint.

        Returns the assistant message dict from choices[0].message.
        """
        url = f"{self.openai_base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_completion_tokens": 4096,
        }
        if use_tools and self.tool_definitions:
            payload["tools"] = self.tool_definitions
            payload["tool_choice"] = "auto"

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
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("LLM returned no choices")

        return choices[0].get("message", {})

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------

    async def _execute_tool(
        self,
        client: httpx.AsyncClient,
        tool_name: str,
        args: dict[str, Any],
        task_id: str,
    ) -> Any:
        """Execute a tool call by dispatching to the appropriate handler.

        Looks up the tool handler from the skill tools/ directory.
        All errors are caught and returned as error strings — never raised.
        This lets the LLM see the error and decide how to proceed.
        """
        try:
            handler = self._get_tool_handler(tool_name)
            if handler is None:
                return f"error: unknown tool '{tool_name}'"
            return await handler(
                client,
                args,
                agent_id=self.config.agent_id,
                gateway_url=self.config.gateway_url,
                registry_url=self.registry_url,
                poll_timeout=self.poll_timeout,
            )
        except httpx.ConnectError as exc:
            return f"error: service unavailable — {exc}"
        except httpx.HTTPStatusError as exc:
            return f"error: HTTP {exc.response.status_code} — {exc.response.text[:200]}"
        except Exception as exc:
            logger.exception("Tool %s execution failed", tool_name)
            return f"error: {tool_name} failed — {exc}"

    def _get_tool_handler(self, name: str) -> Any:
        """Dynamically import and return the tool handler function from skills tools/."""
        skills_dir = os.environ.get("KUBEX_SKILLS_DIR", "/app/skills")
        skills_path = Path(skills_dir)

        # Search for tools/{name}.py in any skill subdirectory
        for tool_file in skills_path.rglob(f"tools/{name}.py"):
            try:
                import importlib.util  # noqa: PLC0415

                spec = importlib.util.spec_from_file_location(name, tool_file)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)  # type: ignore[union-attr]
                    handler = getattr(module, name, None)
                    if callable(handler):
                        return handler
            except Exception:
                logger.warning("Failed to load tool handler %s from %s", name, tool_file)

        return None

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

    async def _store_result(self, client: httpx.AsyncClient, task_id: str, result_text: str) -> None:
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

    async def _ack(self, client: httpx.AsyncClient, message_id: str, group: str) -> None:
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
    from kubex_harness.config_loader import load_agent_config  # noqa: PLC0415

    config = load_agent_config()
    agent = StandaloneAgent(config)

    # Graceful shutdown on SIGTERM/SIGINT
    import contextlib  # noqa: PLC0415

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            # Windows doesn't support add_signal_handler
            loop.add_signal_handler(sig, agent.stop)

    await agent.run()


def main() -> None:
    """Entry point for 'python -m kubex_harness.standalone'."""
    _setup_logging()
    asyncio.run(_run())


if __name__ == "__main__":
    main()
