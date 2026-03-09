"""Unit tests for the orchestrator tool-use loop.

Tests cover:
  - OrchestratorConfig defaults and env var overrides
  - Tool definition structure and completeness
  - Multi-turn tool-use loop (_call_llm)
  - Individual tool handlers
  - Max iteration limit behavior
  - Error handling in tool execution
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

# ---------------------------------------------------------------------------
# Path setup — same pattern as test_harness_unit.py
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "agents", "_base"))
sys.path.insert(0, os.path.join(_ROOT, "agents", "orchestrator"))
sys.path.insert(0, os.path.join(_ROOT, "libs", "kubex-common", "src"))


from orchestrator_loop import (
    ORCHESTRATOR_TOOLS,
    OrchestratorAgent,
    OrchestratorConfig,
)


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
    return _mock_response(200, {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": content,
            }
        }]
    })


def _llm_tool_response(tool_calls: list[dict]) -> httpx.Response:
    """Mock LLM response with tool calls."""
    return _mock_response(200, {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": tool_calls,
            }
        }]
    })


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


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    """Set required env vars for all tests."""
    monkeypatch.setenv("KUBEX_AGENT_ID", "orchestrator")
    monkeypatch.setenv("GATEWAY_URL", "http://gateway:8080")
    monkeypatch.setenv("BROKER_URL", "http://broker:8060")
    monkeypatch.setenv("REGISTRY_URL", "http://registry:8070")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://gateway:8080/v1/proxy/openai")
    monkeypatch.setenv("KUBEX_MAX_ITERATIONS", "5")
    monkeypatch.setenv("KUBEX_POLL_TIMEOUT", "10")


@pytest.fixture
def config() -> OrchestratorConfig:
    return OrchestratorConfig()


@pytest.fixture
def agent(config) -> OrchestratorAgent:
    return OrchestratorAgent(config)


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


class TestOrchestratorConfig:

    def test_defaults(self, config):
        assert config.agent_id == "orchestrator"
        assert config.registry_url == "http://registry:8070"
        assert config.max_iterations == 5
        assert config.poll_timeout == 10
        assert "task_orchestration" in config.capabilities
        assert "task_management" in config.capabilities

    def test_custom_max_iterations(self, monkeypatch):
        monkeypatch.setenv("KUBEX_MAX_ITERATIONS", "50")
        cfg = OrchestratorConfig()
        assert cfg.max_iterations == 50

    def test_system_prompt_contains_orchestrator(self, config):
        assert "orchestrator" in config.system_prompt.lower()

    def test_default_agent_id_set_when_missing(self, monkeypatch):
        monkeypatch.delenv("KUBEX_AGENT_ID", raising=False)
        # OrchestratorConfig sets KUBEX_AGENT_ID=orchestrator if missing
        cfg = OrchestratorConfig()
        assert cfg.agent_id == "orchestrator"


# ---------------------------------------------------------------------------
# Tool definition tests
# ---------------------------------------------------------------------------


class TestToolDefinitions:

    def test_all_tools_have_function_type(self):
        for tool in ORCHESTRATOR_TOOLS:
            assert tool["type"] == "function"
            assert "function" in tool
            assert "name" in tool["function"]
            assert "description" in tool["function"]
            assert "parameters" in tool["function"]

    def test_required_tools_present(self):
        names = {t["function"]["name"] for t in ORCHESTRATOR_TOOLS}
        expected = {
            "dispatch_task", "check_task_status", "cancel_task",
            "list_agents", "query_registry", "wait_for_result",
            "query_knowledge", "store_knowledge",
        }
        assert expected == names

    def test_dispatch_task_required_params(self):
        tool = next(t for t in ORCHESTRATOR_TOOLS if t["function"]["name"] == "dispatch_task")
        required = tool["function"]["parameters"]["required"]
        assert "capability" in required
        assert "context_message" in required

    def test_wait_for_result_has_timeout_param(self):
        tool = next(t for t in ORCHESTRATOR_TOOLS if t["function"]["name"] == "wait_for_result")
        props = tool["function"]["parameters"]["properties"]
        assert "timeout_seconds" in props

    def test_tool_count(self):
        assert len(ORCHESTRATOR_TOOLS) == 8


# ---------------------------------------------------------------------------
# Tool-use loop tests
# ---------------------------------------------------------------------------


class TestToolUseLoop:

    @pytest.mark.asyncio
    async def test_simple_text_response(self, agent):
        """LLM returns text immediately — no tool calls."""
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _llm_text_response("Hello, I'm the orchestrator.")

        result = await agent._call_llm(client, "Say hello", "task-1")
        assert result == "Hello, I'm the orchestrator."
        assert client.post.call_count == 1

    @pytest.mark.asyncio
    async def test_single_tool_call_then_text(self, agent):
        """LLM calls one tool, then returns text."""
        client = AsyncMock(spec=httpx.AsyncClient)

        # First LLM call: wants to call list_agents
        tool_resp = _llm_tool_response([
            _tool_call("list_agents", {}, "call_1"),
        ])
        # list_agents GET to registry returns agents
        agents_resp = _mock_response(200, [{"agent_id": "worker-1"}])
        # Second LLM call: final text
        text_resp = _llm_text_response("Found 1 worker agent.")

        # post calls: LLM #1, progress update, LLM #2
        client.post.side_effect = [tool_resp, None, text_resp]
        # get calls: list_agents
        client.get.return_value = agents_resp

        result = await agent._call_llm(client, "List agents", "task-1")
        assert result == "Found 1 worker agent."

    @pytest.mark.asyncio
    async def test_max_iterations_produces_summary(self, agent):
        """Hitting max iterations forces a final summary."""
        agent.orc_config.max_iterations = 2
        client = AsyncMock(spec=httpx.AsyncClient)

        # Every LLM call returns a tool call
        tool_resp = _llm_tool_response([_tool_call("list_agents", {}, "call_x")])
        agents_resp = _mock_response(200, [])
        summary_resp = _llm_text_response("Summary: no results found.")

        # post: tool_resp, progress, tool_resp, progress, summary_resp
        client.post.side_effect = [tool_resp, None, tool_resp, None, summary_resp]
        client.get.return_value = agents_resp

        result = await agent._call_llm(client, "Do something", "task-1")
        assert "Summary" in result

    @pytest.mark.asyncio
    async def test_multiple_tool_calls_in_one_response(self, agent):
        """LLM returns multiple tool calls in a single response."""
        client = AsyncMock(spec=httpx.AsyncClient)

        tool_resp = _llm_tool_response([
            _tool_call("list_agents", {}, "call_1"),
            _tool_call("query_registry", {"capability": "scrape"}, "call_2"),
        ])
        agents_resp = _mock_response(200, [{"agent_id": "w1"}])
        text_resp = _llm_text_response("Done.")

        # post: LLM #1, progress1, progress2, LLM #2
        client.post.side_effect = [tool_resp, None, None, text_resp]
        client.get.return_value = agents_resp

        result = await agent._call_llm(client, "Check agents", "task-1")
        assert result == "Done."

    @pytest.mark.asyncio
    async def test_empty_content_returns_empty_string(self, agent):
        """LLM returns message with no content field."""
        client = AsyncMock(spec=httpx.AsyncClient)
        resp = _mock_response(200, {"choices": [{"message": {"role": "assistant"}}]})
        client.post.return_value = resp

        result = await agent._call_llm(client, "test", "task-1")
        assert result == ""

    @pytest.mark.asyncio
    async def test_tool_result_added_to_messages(self, agent):
        """Tool results are appended as 'tool' role messages."""
        client = AsyncMock(spec=httpx.AsyncClient)

        tool_resp = _llm_tool_response([_tool_call("list_agents", {}, "call_1")])
        agents_resp = _mock_response(200, [])
        text_resp = _llm_text_response("No agents.")

        client.post.side_effect = [tool_resp, None, text_resp]
        client.get.return_value = agents_resp

        await agent._call_llm(client, "test", "task-1")

        # The second post call (LLM #2) should have tool messages in its payload
        second_llm_call = client.post.call_args_list[2]
        payload = second_llm_call.kwargs.get("json") or second_llm_call[1].get("json")
        messages = payload["messages"]
        tool_msgs = [m for m in messages if m.get("role") == "tool"]
        assert len(tool_msgs) == 1
        assert tool_msgs[0]["tool_call_id"] == "call_1"


# ---------------------------------------------------------------------------
# Individual tool handler tests
# ---------------------------------------------------------------------------


class TestToolHandlers:

    @pytest.mark.asyncio
    async def test_dispatch_task(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"task_id": "new-task-1", "status": "queued"})

        result = await agent._tool_dispatch_task(
            client,
            {"capability": "scrape_instagram", "context_message": "Scrape @test"},
            "parent-task",
        )
        assert result["task_id"] == "new-task-1"

    @pytest.mark.asyncio
    async def test_dispatch_task_with_workflow_id(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"task_id": "t2", "status": "queued"})

        await agent._tool_dispatch_task(
            client,
            {"capability": "scrape", "context_message": "go", "workflow_id": "wf-1"},
            "parent-task",
        )
        call_args = client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json")
        assert payload["parameters"]["workflow_id"] == "wf-1"
        assert payload["context"]["workflow_id"] == "wf-1"

    @pytest.mark.asyncio
    async def test_dispatch_task_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(500, text="Server Error")

        result = await agent._tool_dispatch_task(
            client, {"capability": "x", "context_message": "y"}, "t"
        )
        assert "error" in result

    @pytest.mark.asyncio
    async def test_check_task_status_completed(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(200, {"status": "completed", "output": "done"})

        result = await agent._tool_check_task_status(client, {"task_id": "t1"}, "parent")
        assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_check_task_status_pending(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(404)

        result = await agent._tool_check_task_status(client, {"task_id": "t1"}, "parent")
        assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_cancel_task(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"status": "cancelled"})

        result = await agent._tool_cancel_task(
            client, {"task_id": "t1", "reason": "no longer needed"}, "parent"
        )
        assert result["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_list_agents_list_response(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(200, [{"agent_id": "w1"}, {"agent_id": "w2"}])

        result = await agent._tool_list_agents(client, {}, "parent")
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_list_agents_dict_response(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(200, {"agents": [{"agent_id": "w1"}]})

        result = await agent._tool_list_agents(client, {}, "parent")
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_list_agents_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(500)

        result = await agent._tool_list_agents(client, {}, "parent")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_query_registry(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(200, [{"agent_id": "scraper"}])

        result = await agent._tool_query_registry(
            client, {"capability": "scrape"}, "parent"
        )
        assert result[0]["agent_id"] == "scraper"

    @pytest.mark.asyncio
    async def test_wait_for_result_immediate(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(200, {"status": "completed", "output": "result"})

        result = await agent._tool_wait_for_result(
            client, {"task_id": "t1", "timeout_seconds": 5}, "parent"
        )
        assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_wait_for_result_timeout(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(404)

        result = await agent._tool_wait_for_result(
            client, {"task_id": "t1", "timeout_seconds": 1}, "parent"
        )
        assert result["status"] == "timeout"

    @pytest.mark.asyncio
    async def test_wait_for_result_poll_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mock_response(500)

        result = await agent._tool_wait_for_result(
            client, {"task_id": "t1", "timeout_seconds": 5}, "parent"
        )
        assert "error" in result

    @pytest.mark.asyncio
    async def test_query_knowledge(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"results": [{"text": "knowledge"}]})

        result = await agent._tool_query_knowledge(
            client, {"query": "test query"}, "parent"
        )
        assert "results" in result

    @pytest.mark.asyncio
    async def test_query_knowledge_with_entity_types(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"results": []})

        await agent._tool_query_knowledge(
            client, {"query": "test", "entity_types": ["Person"]}, "parent"
        )
        call_args = client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json")
        assert payload["parameters"]["entity_types"] == ["Person"]

    @pytest.mark.asyncio
    async def test_store_knowledge(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"status": "stored"})

        result = await agent._tool_store_knowledge(
            client, {"content": "data", "summary": "summary"}, "parent"
        )
        assert result["status"] == "stored"


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
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.side_effect = httpx.ConnectError("connection refused")

        result = await agent._execute_tool(client, "list_agents", {}, "t1")
        assert "error" in result
        assert "unavailable" in result

    @pytest.mark.asyncio
    async def test_generic_exception_returns_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.side_effect = ValueError("unexpected")

        result = await agent._execute_tool(client, "list_agents", {}, "t1")
        assert "error" in result
        assert "failed" in result

    @pytest.mark.asyncio
    async def test_llm_500_raises_runtime_error(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(500, text="LLM down")

        with pytest.raises(RuntimeError, match="LLM returned 500"):
            await agent._call_llm(client, "test", "task-1")

    @pytest.mark.asyncio
    async def test_llm_no_choices_raises(self, agent):
        client = AsyncMock(spec=httpx.AsyncClient)
        client.post.return_value = _mock_response(200, {"choices": []})

        with pytest.raises(RuntimeError, match="no choices"):
            await agent._call_llm(client, "test", "task-1")

    @pytest.mark.asyncio
    async def test_tool_handler_mapping_complete(self, agent):
        """Every tool in ORCHESTRATOR_TOOLS has a handler."""
        for tool in ORCHESTRATOR_TOOLS:
            name = tool["function"]["name"]
            handler = agent._get_tool_handler(name)
            assert handler is not None, f"No handler for tool '{name}'"

    @pytest.mark.asyncio
    async def test_malformed_tool_args_handled(self, agent):
        """Malformed JSON in tool arguments doesn't crash the loop."""
        client = AsyncMock(spec=httpx.AsyncClient)

        # LLM returns tool call with invalid JSON
        bad_tool_resp = _mock_response(200, {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_bad",
                        "type": "function",
                        "function": {
                            "name": "list_agents",
                            "arguments": "not valid json{{{",
                        },
                    }],
                }
            }]
        })
        agents_resp = _mock_response(200, [])
        text_resp = _llm_text_response("Recovered.")

        client.post.side_effect = [bad_tool_resp, None, text_resp]
        client.get.return_value = agents_resp

        result = await agent._call_llm(client, "test", "task-1")
        assert result == "Recovered."
