"""System prompt builder — assembles preamble + skills into a complete system prompt.

Reads PREAMBLE.md template from the same directory, fills config values,
and prepends to skill content. Used by both standalone.py and mcp_bridge.py.

Usage:
    from kubex_harness.prompt_builder import build_system_prompt
    prompt = build_system_prompt(config, skill_content, worker_descriptions=None)
"""

from __future__ import annotations

import logging
from pathlib import Path

from kubex_harness.config_loader import AgentConfig

logger = logging.getLogger("kubex_harness.prompt_builder")

_PREAMBLE_PATH = Path(__file__).parent / "PREAMBLE.md"


def _format_policy_summary(config: AgentConfig) -> str:
    """Build human-readable policy summary from config."""
    lines: list[str] = []
    if config.policy.allowed_actions:
        lines.append(f"**Allowed actions:** {', '.join(config.policy.allowed_actions)}")
    if config.policy.blocked_actions:
        lines.append(f"**Blocked actions:** {', '.join(config.policy.blocked_actions)}")
    if not lines:
        return (
            "No explicit policy constraints configured. "
            "Actions not recognized by the Gateway will be ESCALATED for review."
        )
    lines.append("")
    lines.append("Any action not listed above will be ESCALATED to the reviewer agent for approval.")
    return "\n".join(lines)


def _format_budget_summary(config: AgentConfig) -> str:
    """Build human-readable budget summary from config."""
    lines: list[str] = []
    if config.budget.per_task_token_limit > 0:
        lines.append(f"**Token limit per task:** {config.budget.per_task_token_limit:,} tokens")
    if config.budget.daily_cost_limit_usd > 0:
        lines.append(f"**Daily cost limit:** ${config.budget.daily_cost_limit_usd:.2f}")
    if not lines:
        return "No budget constraints configured."
    return "\n".join(lines)


def _format_worker_list(worker_descriptions: list[dict[str, str]] | None) -> str:
    """Build orchestrator-specific worker list section.

    Each worker dict has keys: agent_id, description, capabilities (comma-separated string).
    Returns empty string for non-orchestrator agents (worker_descriptions is None or empty).
    """
    if not worker_descriptions:
        return ""
    lines = ["# Available Workers", ""]
    for w in worker_descriptions:
        lines.append(
            f"- **{w['agent_id']}**: {w.get('description', 'No description')} "
            f"(capabilities: {w.get('capabilities', 'none')})"
        )
    lines.append("")
    lines.append("Use kubex__list_agents for runtime discovery of currently available agents.")
    return "\n".join(lines)


def build_system_prompt(
    config: AgentConfig,
    skill_content: str = "",
    worker_descriptions: list[dict[str, str]] | None = None,
) -> str:
    """Build a complete system prompt from preamble template + skill content.

    Args:
        config: Agent configuration with identity, policy, budget fields.
        skill_content: Concatenated skill file content (from skill_loader or _load_skill_files).
        worker_descriptions: List of worker agent dicts for orchestrator only.
            Each dict: {"agent_id": "...", "description": "...", "capabilities": "cap1, cap2"}.
            Pass None for worker agents.

    Returns:
        Complete system prompt string: filled preamble + skill content.
    """
    # Load preamble template
    try:
        template = _PREAMBLE_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("PREAMBLE.md not found at %s — using skill content only", _PREAMBLE_PATH)
        return skill_content or "You are a KubexClaw agent. Complete the assigned task."

    # Fill template variables
    filled = template.format_map(
        {
            "agent_id": config.agent_id,
            "description": config.description or f"Agent {config.agent_id}",
            "capabilities": ", ".join(config.capabilities) if config.capabilities else "general",
            "boundary": config.boundary,
            "policy_summary": _format_policy_summary(config),
            "budget_summary": _format_budget_summary(config),
            "worker_list_section": _format_worker_list(worker_descriptions),
        }
    )

    # Combine preamble + skill content
    parts = [filled.strip()]
    if skill_content:
        parts.append(skill_content.strip())

    return "\n\n".join(parts)
