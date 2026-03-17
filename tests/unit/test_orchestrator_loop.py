"""Unit tests for the orchestrator tool-use loop.

After Phase 7 migration, the orchestrator loop is no longer in a separate
orchestrator_loop.py module.  The multi-turn tool-use functionality lives
in StandaloneAgent._call_llm_with_tools (standalone.py).

Tool definitions are now loaded from skill manifests at runtime.

Tests cover:
  - StandaloneAgent multi-turn tool-use loop (_call_llm_with_tools)
  - Max iteration limit behavior
  - Error handling in tool execution
  - Tool handler discovery via _get_tool_handler
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# ---------------------------------------------------------------------------
# Path setup — same pattern as test_harness_unit.py
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "agents", "_base"))
sys.path.insert(0, os.path.join(_ROOT, "libs", "kubex-common", "src"))


from kubex_harness.config_loader import AgentConfig  # noqa: E402
from kubex_harness.standalone import StandaloneAgent  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_response(status_code: int = 200, json_data: Any = None, text: str = "") -> httpx.Response:
    """Create a mock httpx Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = text or json.dumps(json_data if json_data is not None else {})
    return resp


def _llm_text_response(content: str) -> httpx.Response:
    """Mock LLM response with text only (no tool calls)."""
    return _mock_response(
        200,
        {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": content,
                    }
                }
            ]
        },
    )


def _llm_tool_response(tool_calls: list[dict]) -> httpx.Response:
    """Mock LLM response with tool calls."""
    return _mock_response(
        200,
        {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": tool_calls,
                    }
                }
            ]
        },
    )


def _tool_call(name: str, args: dict, call_id: str = "call_1") -> dict:
    """Create a tool_call dict in OpenAI format."""
    return {
        "id": call_id,
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(args),
        },
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def agent_config() -> AgentConfig:
    return AgentConfig(
        agent_id="orchestrator",
        model="gpt-5.2",
        skills=["task-management"],
        capabilities=["task_orchestration", "task_management"],
        gateway_url="http://gateway:8080",
        broker_url="http://broker:8060",
    )


@pytest.fixture
def agent(agent_config, tmp_path) -> StandaloneAgent:
    """Create a StandaloneAgent with tool definitions loaded from a temp skill manifest."""
    import yaml

    # Create a minimal skill manifest with 8 tools
    manifest = {
        "name": "task-management",
        "tools": [
            {
                "name": "dispatch_task",
                "description": "Dispatch task",
                "parameters": {
                    "capability": {"type": "string", "required": True},
                    "context_message": {"type": "string", "required": True},
                },
            },
            {
                "name": "check_task_status",
                "description": "Check status",
                "parameters": {"task_id": {"type": "string", "required": True}},
            },
            {
                "name": "cancel_task",
                "description": "Cancel task",
                "parameters": {"task_id": {"type": "string", "required": True}},
            },
            {"name": "list_agents", "description": "List agents", "parameters": {}},
            {
                "name": "query_registry",
                "description": "Query registry",
                "parameters": {"capability": {"type": "string", "required": True}},
            },
            {
                "name": "wait_for_result",
                "description": "Wait for result",
                "parameters": {"task_id": {"type": "string", "required": True}},
            },
            {
                "name": "query_knowledge",
                "description": "Query knowledge",
                "parameters": {"query": {"type": "string", "required": True}},
            },
            {
                "name": "store_knowledge",
                "description": "Store knowledge",
                "parameters": {
                    "content": {"type": "string", "required": True},
                    "summary": {"type": "string", "required": True},
                },
            },
        ],
    }

    # Write manifest
    (tmp_path / "manifest.yaml").write_text(yaml.dump(manifest), encoding="utf-8")

    env = {
        "KUBEX_SKILLS_DIR": str(tmp_path),
        "OPENAI_BASE_URL": "http://gateway:8080/v1/proxy/openai",
        "REGISTRY_URL": "http://registry:8070",
        "KUBEX_MAX_ITERATIONS": "5",
        "KUBEX_POLL_TIMEOUT": "10",
    }
    with patch.dict(os.environ, env, clear=False):
        a = StandaloneAgent(agent_config)
    # Manually set max_iterations for tests
    a.max_iterations = 5
    a.poll_timeout = 10
    return a


# ---------------------------------------------------------------------------
# Tool definition tests
# ---------------------------------------------------------------------------


class TestToolDefinitions:

    def test_all_tools_have_function_type(self, agent):
        for tool in agent.tool_definitions:
            assert tool["type"] == "function"
            assert "function" in tool
            assert "name" in tool["function"]
            assert "description" in tool["function"]
            assert "parameters" in tool["function"]

    def test_required_tools_present(self, agent):
        names = {t["function"]["name"] for t in agent.tool_definitions}
        expected = {
            "dispatch_task",
            "check_task_status",
            "cancel_task",
            "list_agents",
            "query_registry",
            "wait_for_result",
            "query_knowledge",
            "store_knowledge",
        }
        assert expected == names

    def test_dispatch_task_required_params(self, agent):
        tool = next(t for t in agent.tool_definitions if t["function"]["name"] == "dispatch_task")
        required = tool["function"]["parameters"]["required"]
        assert "capability" in required
        assert "context_message" in required

    def test_tool_count(self, agent):
        assert len(agent.tool_definitions) == 8


# ---------------------------------------------------------------------------
# Tool-use loop tests
# ---------------------------------------------------------------------------


class TestToolUseLoop:

    @pytest.mark.asyncio
    async def test_simple_text_response(self, agent):
        """LLM returns text immediately — no tool calls."""
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _llm_text_response("Hello, I'm the orchestrator.")

        result = await agent._call_llm_with_tools(client, "Say hello", "task-1")
        assert result == "Hello, I'm the orchestrator."
        assert client.post.call_count == 1

    @pytest.mark.asyncio
    async def test_single_tool_call_then_text(self, agent):
        """LLM calls one tool, then returns text."""
        client = AsyncMock(spec=httpx.AsyncClient)

        # First LLM call: wants to call list_agents
        tool_resp = _llm_tool_response(
            [
                _tool_call("list_agents", {}, "call_1"),
            ]
        )
        # list_agents GET to registry returns agents
        agents_resp = _mock_response(200, [{"agent_id": "worker-1"}])
        # Second LLM call: final text
        text_resp = _llm_text_response("Found 1 worker agent.")

        # post calls: LLM #1, progress update, LLM #2
        client.post.side_effect = [tool_resp, None, text_resp]
        # get calls: list_agents
        client.get.return_value = agents_resp

        # Patch _get_tool_handler to return None (unknown tool) so progress mock works
        with patch.object(agent, "_get_tool_handler", return_value=None):
            result = await agent._call_llm_with_tools(client, "List agents", "task-1")
        assert result == "Found 1 worker agent."

    @pytest.mark.asyncio
    async def test_max_iterations_produces_summary(self, agent):
        """Hitting max iterations forces a final summary."""
        agent.max_iterations = 2
        client = AsyncMock(spec=httpx.AsyncClient)

        # Every LLM call returns a tool call
        tool_resp = _llm_tool_response([_tool_call("list_agents", {}, "call_x")])
        summary_resp = _llm_text_response("Summary: no results found.")

        # post: tool_resp, progress, tool_resp, progress, summary_resp
        client.post.side_effect = [tool_resp, None, tool_resp, None, summary_resp]

        with patch.object(agent, "_get_tool_handler", return_value=None):
            result = await agent._call_llm_with_tools(client, "Do something", "task-1")
        assert "Summary" in result

    @pytest.mark.asyncio
    async def test_multiple_tool_calls_in_one_response(self, agent):
        """LLM returns multiple tool calls in a single response."""
        client = AsyncMock(spec=httpx.AsyncClient)

        tool_resp = _llm_tool_response(
            [
                _tool_call("list_agents", {}, "call_1"),
                _tool_call("query_registry", {"capability": "scrape"}, "call_2"),
            ]
        )
        text_resp = _llm_text_response("Done.")

        # post: LLM #1, progress1, progress2, LLM #2
        client.post.side_effect = [tool_resp, None, None, text_resp]

        with patch.object(agent, "_get_tool_handler", return_value=None):
            result = await agent._call_llm_with_tools(client, "Check agents", "task-1")
        assert result == "Done."

    @pytest.mark.asyncio
    async def test_empty_content_returns_empty_string(self, agent):
        """LLM returns message with no content field."""
        client = AsyncMock(spec=httpx.AsyncClient)
        resp = _mock_response(200, {"choices": [{"message": {"role": "assistant"}}]})
        client.post.return_value = resp

        result = await agent._call_llm_with_tools(client, "test", "task-1")
        assert result == ""

    @pytest.mark.asyncio
    async def test_tool_result_added_to_messages(self, agent):
        """Tool results are appended as 'tool' role messages."""
        client = AsyncMock(spec=httpx.AsyncClient)

        tool_resp = _llm_tool_response([_tool_call("list_agents", {}, "call_1")])
        text_resp = _llm_text_response("No agents.")

        client.post.side_effect = [tool_resp, None, text_resp]

        with patch.object(agent, "_get_tool_handler", return_value=None):
            await agent._call_llm_with_tools(client, "test", "task-1")

        # The second post call (LLM #2) should have tool messages in its payload
        second_llm_call = client.post.call_args_list[2]
        payload = second_llm_call.kwargs.get("json") or second_llm_call[1].get("json")
        messages = payload["messages"]
        tool_msgs = [m for m in messages if m.get("role") == "tool"]
        assert len(tool_msgs) == 1
        assert tool_msgs[0]["tool_call_id"] == "call_1"


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------


class TestErrorHandling:

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        result = await agent._execute_tool(client, "nonexistent_tool", {}, "t1")
        assert "error" in result
        assert "unknown tool" in result

    @pytest.mark.asyncio
    async def test_connection_error_returns_error(self, agent):
        """ConnectError is caught and returned as error string."""
        client = AsyncMock(spec=httpx.AsyncClient)

        async def _raise_connect(*args, **kwargs):
            raise httpx.ConnectError("connection refused")

        mock_handler = AsyncMock(side_effect=httpx.ConnectError("connection refused"))
        with patch.object(agent, "_get_tool_handler", return_value=mock_handler):
            result = await agent._execute_tool(client, "list_agents", {}, "t1")
        assert "error" in result
        assert "unavailable" in result

    @pytest.mark.asyncio
    async def test_generic_exception_returns_error(self, agent):
        """Generic exceptions are caught and returned as error string."""
        mock_handler = AsyncMock(side_effect=ValueError("unexpected"))
        with patch.object(agent, "_get_tool_handler", return_value=mock_handler):
            result = await agent._execute_tool(client=AsyncMock(), tool_name="list_agents", args={}, task_id="t1")
        assert "error" in result
        assert "failed" in result

    @pytest.mark.asyncio
    async def test_llm_500_raises_runtime_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(500, text="LLM down")

        with pytest.raises(RuntimeError, match="LLM returned 500"):
            await agent._call_llm_with_tools(client, "test", "task-1")

    @pytest.mark.asyncio
    async def test_llm_no_choices_raises(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"choices": []})

        with pytest.raises(RuntimeError, match="no choices"):
            await agent._call_llm_with_tools(client, "test", "task-1")

    @pytest.mark.asyncio
    async def test_malformed_tool_args_handled(self, agent):
        """Malformed JSON in tool arguments doesn't crash the loop."""
        client = AsyncMock(spec=httpx.AsyncClient)

        # LLM returns tool call with invalid JSON
        bad_tool_resp = _mock_response(
            200,
            {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_bad",
                                    "type": "function",
                                    "function": {
                                        "name": "list_agents",
                                        "arguments": "not valid json{{{",
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )
        text_resp = _llm_text_response("Recovered.")

        client.post.side_effect = [bad_tool_resp, None, text_resp]

        with patch.object(agent, "_get_tool_handler", return_value=None):
            result = await agent._call_llm_with_tools(client, "test", "task-1")
        assert result == "Recovered."
