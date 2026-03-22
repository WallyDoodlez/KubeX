---
created: 2026-03-22T03:02:00.000Z
title: Improve kubex system prompts for all agents
area: general
files:
  - agents/orchestrator/config.yaml
  - agents/knowledge/config.yaml
  - agents/instagram-scraper/config.yaml
  - agents/reviewer/config.yaml
  - agents/_base/kubex_harness/mcp_bridge.py:_load_system_prompt
  - agents/_base/kubex_harness/standalone.py:_load_skill_files
---

## Problem

Each kubex agent currently has minimal or default system prompts. The orchestrator falls back to a generic "You are a KubexClaw orchestrator agent" prompt, and workers use whatever is in their skill .md files (if any). These prompts need to be much more detailed to get quality output — each agent needs clear instructions about its role, available tools, expected output format, error handling behavior, and domain expertise.

Key agents needing improved prompts:
- **Orchestrator**: How to decompose tasks, when to delegate vs answer directly, how to use poll_task effectively, need_info protocol behavior
- **Knowledge**: How to search/create/update vault notes, formatting standards, when to create vs update
- **Instagram-scraper**: What data to extract, output format, rate limiting awareness
- **Reviewer**: Security review criteria, ALLOW/DENY/ESCALATE decision framework, what to flag

## Solution

Create detailed skill .md files for each agent under their respective skill directories. These get injected as system prompts at boot time via `_load_skill_files()`. No code changes needed — just better prompt engineering in the skill files.
