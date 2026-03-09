"""Orchestrator agent loop — multi-turn tool-use harness.

Extends the standalone agent pattern with OpenAI function-calling:
  1. Polls the Broker for messages matching orchestrator capabilities
  2. Calls the LLM with tool definitions (OpenAI function calling format)
  3. When LLM returns tool_calls, executes them via HTTP to Gateway/Broker/Registry
  4. Feeds tool results back to the conversation and calls LLM again
  5. Continues until the LLM returns a final text response (no more tool calls)
  6. Stores the final result and acknowledges the message

This replaces the single-shot _call_llm() of StandaloneAgent with an agentic loop.

Required env vars (same as StandaloneAgent):
  KUBEX_AGENT_ID       — agent identity (default: orchestrator)
  GATEWAY_URL          — gateway base URL
  BROKER_URL           — broker base URL (defaults to http://broker:8060)
  OPENAI_BASE_URL      — OpenAI-compatible proxy URL

Additional env vars:
  REGISTRY_URL         — registry base URL (defaults to http://registry:8070)
  KUBEX_MAX_ITERATIONS — max tool-call rounds per task (default 20)
  KUBEX_POLL_TIMEOUT   — seconds to wait when polling for task results (default 30)
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

from kubex_harness.standalone import (
    StandaloneAgent,
    StandaloneConfig,
    _setup_logging,
)

logger = logging.getLogger("kubex_harness.orchestrator")

# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function calling format)
# ---------------------------------------------------------------------------

ORCHESTRATOR_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "dispatch_task",
            "description": (
                "Dispatch a subtask to a worker Kubex by capability. "
                "Returns task_id and status once the task is queued."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "capability": {
                        "type": "string",
                        "description": "The capability identifier to resolve (e.g. 'scrape_instagram')",
                    },
                    "context_message": {
                        "type": "string",
                        "description": "The task instruction for the worker agent",
                    },
                    "workflow_id": {
                        "type": "string",
                        "description": "Optional workflow ID for task grouping",
                    },
                },
                "required": ["capability", "context_message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_task_status",
            "description": (
                "Check the status/result of a dispatched task by task_id. "
                "Returns status: pending, running, completed, failed, or cancelled."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "The task ID to query"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_task",
            "description": (
                "Cancel a running task. Only the originating agent can cancel."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "The task ID to cancel"},
                    "reason": {"type": "string", "description": "Reason for cancellation"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_agents",
            "description": "List all registered agent Kubexes and their capabilities.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_registry",
            "description": (
                "Resolve a capability to available agent Kubexes. "
                "Use this to discover which agents can handle a specific task type."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "capability": {
                        "type": "string",
                        "description": "The capability to resolve (e.g. 'scrape_instagram')",
                    },
                },
                "required": ["capability"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wait_for_result",
            "description": (
                "Poll for a task result with a timeout. "
                "Blocks until the task completes or the timeout is reached. "
                "Use this after dispatch_task to wait for worker completion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The task ID to wait for",
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Maximum seconds to wait (default: 30)",
                    },
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_knowledge",
            "description": (
                "Search the KubexClaw knowledge graph for relevant information. "
                "Supports natural language queries."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language query to search the knowledge graph",
                    },
                    "entity_types": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional entity type filters (e.g. ['Organization', 'Person'])",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "store_knowledge",
            "description": (
                "Persist new knowledge to the knowledge graph and document corpus."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The content to store",
                    },
                    "summary": {
                        "type": "string",
                        "description": "Brief summary for indexing",
                    },
                },
                "required": ["content", "summary"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Default system prompt for the orchestrator
# ---------------------------------------------------------------------------

ORCHESTRATOR_SYSTEM_PROMPT = """\
You are the KubexClaw orchestrator agent. You receive tasks from human operators \
and coordinate worker agents to complete them. You NEVER perform tasks directly — \
you always delegate to the appropriate worker agents.

Your workflow:
1. Analyze the incoming task request
2. Use list_agents or query_registry to discover available worker agents
3. Use dispatch_task to send subtasks to workers by capability
4. Use wait_for_result or check_task_status to monitor progress
5. Synthesize results from workers into a final answer
6. Optionally store important findings via store_knowledge

Important rules:
- Always check which agents are available before dispatching
- If no agent has the needed capability, report that clearly
- If a worker fails, you may retry once or report the failure
- Keep your final answer concise and structured
- You have a maximum of 20 tool-call iterations — plan efficiently
"""


# ---------------------------------------------------------------------------
# OrchestratorConfig
# ---------------------------------------------------------------------------


class OrchestratorConfig(StandaloneConfig):
    """Extended config for the orchestrator agent."""

    def __init__(self) -> None:
        # Set orchestrator defaults before parent init
        if "KUBEX_AGENT_ID" not in os.environ:
            os.environ["KUBEX_AGENT_ID"] = "orchestrator"
        if "KUBEX_CAPABILITIES" not in os.environ:
            os.environ["KUBEX_CAPABILITIES"] = "task_orchestration,task_management"
        if "KUBEX_AGENT_PROMPT" not in os.environ:
            os.environ["KUBEX_AGENT_PROMPT"] = ORCHESTRATOR_SYSTEM_PROMPT

        super().__init__()

        self.registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")
        self.max_iterations = int(os.environ.get("KUBEX_MAX_ITERATIONS", "20"))
        self.poll_timeout = int(os.environ.get("KUBEX_POLL_TIMEOUT", "30"))


# ---------------------------------------------------------------------------
# OrchestratorAgent
# ---------------------------------------------------------------------------


class OrchestratorAgent(StandaloneAgent):
    """Orchestrator agent with OpenAI function-calling tool loop.

    Overrides _call_llm() to implement a multi-turn tool-use loop:
    - Sends messages with tool definitions to the LLM
    - When the LLM returns tool_calls, executes them via HTTP
    - Feeds tool results back and calls the LLM again
    - Continues until the LLM produces a final text response
    """

    def __init__(self, config: OrchestratorConfig) -> None:
        super().__init__(config)
        self.orc_config = config

    async def _call_llm(
        self, client: httpx.AsyncClient, user_message: str, task_id: str
    ) -> str:
        """Multi-turn tool-use loop.

        Maintains a conversation history, sending it to the LLM with tool
        definitions. When the LLM responds with tool_calls, we execute them,
        append the results, and call the LLM again. The loop ends when the
        LLM responds with a text message (no tool_calls) or we hit the
        iteration limit.
        """
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.config.system_prompt},
            {"role": "user", "content": user_message},
        ]

        for iteration in range(self.orc_config.max_iterations):
            logger.info(
                "Task %s: tool-use iteration %d/%d",
                task_id, iteration + 1, self.orc_config.max_iterations,
            )

            response_message = await self._chat_completion(
                client, messages, task_id, use_tools=True
            )

            # Append the assistant message to history
            messages.append(response_message)

            # Check if LLM wants to call tools
            tool_calls = response_message.get("tool_calls")
            if not tool_calls:
                # Final text response — we're done
                content = response_message.get("content", "")
                logger.info(
                    "Task %s: LLM returned final response after %d iterations",
                    task_id, iteration + 1,
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
                    task_id, tool_name, json.dumps(tool_args)[:200],
                )

                # Execute the tool
                tool_result = await self._execute_tool(
                    client, tool_name, tool_args, task_id
                )

                # Post progress update showing tool activity
                await self._post_progress(
                    client,
                    task_id,
                    f"[tool:{tool_name}] {json.dumps(tool_result)[:500]}\n",
                    final=False,
                )

                # Append tool result to conversation
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": json.dumps(tool_result) if not isinstance(tool_result, str) else tool_result,
                })

        # Hit iteration limit — ask LLM for a final summary without tools
        logger.warning(
            "Task %s: hit max iterations (%d), requesting final summary",
            task_id, self.orc_config.max_iterations,
        )
        messages.append({
            "role": "user",
            "content": (
                "You have reached the maximum number of tool-call iterations. "
                "Please provide your final answer now based on the information gathered so far."
            ),
        })
        response_message = await self._chat_completion(
            client, messages, task_id, use_tools=False
        )
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
        url = f"{self.config.openai_base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_completion_tokens": 4096,
        }
        if use_tools:
            payload["tools"] = ORCHESTRATOR_TOOLS
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
        """Execute a tool call by dispatching to the appropriate HTTP endpoint.

        All errors are caught and returned as error strings — never raised.
        This lets the LLM see the error and decide how to proceed.
        """
        try:
            handler = self._get_tool_handler(tool_name)
            if handler is None:
                return f"error: unknown tool '{tool_name}'"
            return await handler(client, args, task_id)
        except httpx.ConnectError as exc:
            return f"error: service unavailable — {exc}"
        except httpx.HTTPStatusError as exc:
            return f"error: HTTP {exc.response.status_code} — {exc.response.text[:200]}"
        except Exception as exc:
            logger.exception("Tool %s execution failed", tool_name)
            return f"error: {tool_name} failed — {exc}"

    def _get_tool_handler(self, name: str):  # noqa: ANN202
        """Map tool name to handler coroutine."""
        return {
            "dispatch_task": self._tool_dispatch_task,
            "check_task_status": self._tool_check_task_status,
            "cancel_task": self._tool_cancel_task,
            "list_agents": self._tool_list_agents,
            "query_registry": self._tool_query_registry,
            "wait_for_result": self._tool_wait_for_result,
            "query_knowledge": self._tool_query_knowledge,
            "store_knowledge": self._tool_store_knowledge,
        }.get(name)

    # ------------------------------------------------------------------
    # Individual tool handlers
    # ------------------------------------------------------------------

    async def _tool_dispatch_task(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> dict[str, Any]:
        """POST /actions to dispatch a task to a worker agent."""
        import uuid as _uuid

        gateway_url = self.config.gateway_url
        sub_task_id = f"sub-{_uuid.uuid4().hex[:12]}"
        payload = {
            "request_id": str(_uuid.uuid4()),
            "agent_id": self.config.agent_id,
            "action": "dispatch_task",
            "parameters": {
                "capability": args["capability"],
                "context_message": args["context_message"],
            },
            "context": {"task_id": sub_task_id, "workflow_id": task_id},
            "priority": "normal",
        }
        if args.get("workflow_id"):
            payload["context"]["workflow_id"] = args["workflow_id"]

        resp = await client.post(
            f"{gateway_url}/actions",
            json=payload,
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code >= 400:
            return {"error": f"dispatch failed: {resp.status_code}", "detail": resp.text[:300]}
        return resp.json()

    async def _tool_check_task_status(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> dict[str, Any]:
        """GET /tasks/{id}/result to check task status."""
        target_task_id = args["task_id"]
        gateway_url = self.config.gateway_url
        resp = await client.get(
            f"{gateway_url}/tasks/{target_task_id}/result",
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code == 404:
            return {"task_id": target_task_id, "status": "pending"}
        if resp.status_code >= 400:
            return {"error": f"status check failed: {resp.status_code}"}
        return resp.json()

    async def _tool_cancel_task(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> dict[str, Any]:
        """POST /tasks/{id}/cancel to cancel a task."""
        target_task_id = args["task_id"]
        gateway_url = self.config.gateway_url
        payload = {
            "agent_id": self.config.agent_id,
            "reason": args.get("reason", ""),
        }
        resp = await client.post(
            f"{gateway_url}/tasks/{target_task_id}/cancel",
            json=payload,
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code >= 400:
            return {"error": f"cancel failed: {resp.status_code}", "detail": resp.text[:300]}
        return resp.json()

    async def _tool_list_agents(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> Any:
        """GET /agents from Registry to list all agents."""
        registry_url = self.orc_config.registry_url
        resp = await client.get(
            f"{registry_url}/agents",
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code >= 400:
            return {"error": f"list_agents failed: {resp.status_code}"}
        data = resp.json()
        return data if isinstance(data, list) else data.get("agents", [])

    async def _tool_query_registry(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> Any:
        """GET /agents?capability={cap} from Registry."""
        registry_url = self.orc_config.registry_url
        resp = await client.get(
            f"{registry_url}/agents",
            params={"capability": args["capability"]},
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code >= 400:
            return {"error": f"query_registry failed: {resp.status_code}"}
        data = resp.json()
        return data if isinstance(data, list) else data.get("agents", [])

    async def _tool_wait_for_result(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> dict[str, Any]:
        """Poll GET /tasks/{id}/result until completed or timeout."""
        target_task_id = args["task_id"]
        timeout = args.get("timeout_seconds", self.orc_config.poll_timeout)
        gateway_url = self.config.gateway_url
        poll_interval = 2  # seconds

        elapsed = 0
        while elapsed < timeout:
            resp = await client.get(
                f"{gateway_url}/tasks/{target_task_id}/result",
                headers={"X-Kubex-Agent-Id": self.config.agent_id},
            )
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", data.get("result", {}).get("status", ""))
                if status in ("completed", "failed", "cancelled"):
                    return data
            elif resp.status_code != 404:
                return {"error": f"poll failed: {resp.status_code}"}

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        return {
            "task_id": target_task_id,
            "status": "timeout",
            "message": f"Task did not complete within {timeout}s",
        }

    async def _tool_query_knowledge(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> dict[str, Any]:
        """POST /actions with query_knowledge action."""
        gateway_url = self.config.gateway_url
        params: dict[str, Any] = {"query": args["query"]}
        if args.get("entity_types"):
            params["entity_types"] = args["entity_types"]
        payload = {
            "agent_id": self.config.agent_id,
            "action": "query_knowledge",
            "parameters": params,
            "context": {},
        }
        resp = await client.post(
            f"{gateway_url}/actions",
            json=payload,
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code >= 400:
            return {"error": f"query_knowledge failed: {resp.status_code}"}
        return resp.json()

    async def _tool_store_knowledge(
        self, client: httpx.AsyncClient, args: dict[str, Any], task_id: str
    ) -> dict[str, Any]:
        """POST /actions with store_knowledge action."""
        gateway_url = self.config.gateway_url
        payload = {
            "agent_id": self.config.agent_id,
            "action": "store_knowledge",
            "parameters": {
                "content": args["content"],
                "summary": args.get("summary", ""),
            },
            "context": {},
        }
        resp = await client.post(
            f"{gateway_url}/actions",
            json=payload,
            headers={"X-Kubex-Agent-Id": self.config.agent_id},
        )
        if resp.status_code >= 400:
            return {"error": f"store_knowledge failed: {resp.status_code}"}
        return resp.json()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def _run() -> None:
    config = OrchestratorConfig()
    agent = OrchestratorAgent(config)

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
    """Entry point for 'python -m orchestrator_loop'."""
    _setup_logging()
    asyncio.run(_run())


if __name__ == "__main__":
    main()
