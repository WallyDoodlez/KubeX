---
created: 2026-03-22T03:00:23.835Z
title: Add orchestrator context window clear/reset
area: general
files:
  - agents/_base/kubex_harness/mcp_bridge.py:_call_llm_with_mcp_tools
---

## Problem

The orchestrator's LLM context grows indefinitely within a task — every tool call and result appends to the `messages` list. There's no way to clear or reset the context window mid-session without killing the task loop. For long-running orchestration tasks with many worker delegations, this will eventually hit token limits or degrade quality.

Need a mechanism to:
- Clear/reset the orchestrator's conversation history on demand (e.g., via a meta-tool or API call)
- Optionally preserve a summary of prior context when resetting
- Keep the task loop and MCP bridge running — only the LLM messages list resets

## Solution

Options to explore:
- Add a `kubex__clear_context` meta-tool that the LLM can call to reset its own messages list (with optional summary injection)
- External API endpoint (e.g., POST /tasks/{id}/reset-context) that triggers a reset from outside
- Automatic context management when messages exceed a token threshold (summarize + truncate)
