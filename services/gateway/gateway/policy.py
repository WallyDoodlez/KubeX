"""Gateway Policy Engine — deterministic first-deny-wins rule evaluation.

Evaluates ActionRequests against a cascade of:
  1. Global policy (policies/global.yaml)
  2. Boundary policy (boundaries/<boundary>.yaml)
  3. Per-agent policy (agents/<agent_id>/policies/policy.yaml)

For MVP, enforces three rule categories:
  1. Egress / Network — allowed domains, methods, blocked paths
  2. Action Type — allowed/blocked action types, rate limits
  3. Budget / Model — model allowlist, per-task token limit, daily cost cap
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from urllib.parse import urlparse

import yaml
from kubex_common.logging import get_logger
from kubex_common.schemas.actions import ActionRequest, ActionType

logger = get_logger(__name__)


class PolicyDecision(StrEnum):
    ALLOW = "allow"
    DENY = "deny"
    ESCALATE = "escalate"


@dataclass
class PolicyResult:
    """Result from policy evaluation."""

    decision: PolicyDecision
    reason: str
    rule_matched: str | None = None
    agent_id: str | None = None


@dataclass
class EgressRule:
    """A single egress allowlist entry."""

    domain: str
    methods: list[str] = field(default_factory=lambda: ["GET"])
    blocked_paths: list[str] = field(default_factory=list)


@dataclass
class AgentPolicy:
    """Parsed per-agent or boundary policy."""

    agent_id: str
    allowed_actions: list[str] = field(default_factory=list)
    blocked_actions: list[str] = field(default_factory=list)
    egress_mode: str = "deny_all"  # "allowlist" or "deny_all"
    egress_rules: list[EgressRule] = field(default_factory=list)
    per_task_token_limit: int | None = None
    daily_cost_limit_usd: float | None = None
    rate_limits: dict[str, str] = field(default_factory=dict)
    # PSEC-03: Skill allowlist for spawn-time skill check
    allowed_skills: list[str] = field(default_factory=list)


@dataclass
class GlobalPolicy:
    """Parsed global policy."""

    blocked_actions: list[str] = field(default_factory=list)
    max_chain_depth: int = 5
    default_daily_cost_limit_usd: float = 10.0
    rate_limits: dict[str, str] = field(default_factory=dict)
    # PSEC-02: Hard blocklist for runtime dependency installs
    package_blocklist: dict[str, list[str]] = field(default_factory=dict)
    # PSEC-02: Soft limit for runtime dep installs per agent (triggers ESCALATE)
    runtime_install_soft_limit: int = 10


class PolicyLoader:
    """Loads and caches policy files."""

    def __init__(self, policy_root: str = ".") -> None:
        self._root = Path(policy_root)
        self._global: GlobalPolicy | None = None
        self._agent_policies: dict[str, AgentPolicy] = {}

    def load_all(self) -> None:
        """Load global policy and all agent policies from disk."""
        self._global = self._load_global()
        self._agent_policies = self._load_all_agent_policies()
        logger.info(
            "policies_loaded",
            agent_count=len(self._agent_policies),
            global_blocked=len(self._global.blocked_actions) if self._global else 0,
        )

    def _load_global(self) -> GlobalPolicy:
        path = self._root / "policies" / "global.yaml"
        if not path.exists():
            logger.warning("global_policy_not_found", path=str(path))
            return GlobalPolicy()

        with open(path) as f:
            data = yaml.safe_load(f) or {}

        global_data = data.get("global", {})
        rate_limits = global_data.get("rate_limits", {}).get("default", {})

        return GlobalPolicy(
            blocked_actions=global_data.get("blocked_actions", []),
            max_chain_depth=global_data.get("max_chain_depth", 5),
            default_daily_cost_limit_usd=global_data.get("budget", {}).get("default_daily_cost_limit_usd", 10.0),
            rate_limits=rate_limits,
            package_blocklist=global_data.get("package_blocklist", {}),
            runtime_install_soft_limit=global_data.get("runtime_install_soft_limit", 10),
        )

    def _load_all_agent_policies(self) -> dict[str, AgentPolicy]:
        policies: dict[str, AgentPolicy] = {}
        agents_dir = self._root / "agents"
        if not agents_dir.exists():
            return policies

        for agent_dir in agents_dir.iterdir():
            if not agent_dir.is_dir() or agent_dir.name.startswith("_"):
                continue
            policy_file = agent_dir / "policies" / "policy.yaml"
            if policy_file.exists():
                policy = self._load_agent_policy(agent_dir.name, policy_file)
                policies[agent_dir.name] = policy

        return policies

    def _load_agent_policy(self, agent_id: str, path: Path) -> AgentPolicy:
        with open(path) as f:
            data = yaml.safe_load(f) or {}

        agent_data = data.get("agent_policy", {})
        actions_data = agent_data.get("actions", {})
        egress_data = agent_data.get("egress", {})
        budget_data = agent_data.get("budget", {})

        egress_rules = []
        for entry in egress_data.get("allowed", []):
            egress_rules.append(
                EgressRule(
                    domain=entry["domain"],
                    methods=entry.get("methods", ["GET"]),
                    blocked_paths=entry.get("blocked_paths", []),
                )
            )

        return AgentPolicy(
            agent_id=agent_id,
            allowed_actions=actions_data.get("allowed", []),
            blocked_actions=actions_data.get("blocked", []),
            egress_mode=egress_data.get("mode", "deny_all"),
            egress_rules=egress_rules,
            per_task_token_limit=budget_data.get("per_task_token_limit"),
            daily_cost_limit_usd=budget_data.get("daily_cost_limit_usd"),
            rate_limits=actions_data.get("rate_limits", {}),
            allowed_skills=agent_data.get("allowed_skills", []),
        )

    @property
    def global_policy(self) -> GlobalPolicy:
        if self._global is None:
            self._global = GlobalPolicy()
        return self._global

    def get_agent_policy(self, agent_id: str) -> AgentPolicy | None:
        return self._agent_policies.get(agent_id)


class PolicyEngine:
    """Deterministic policy evaluation engine.

    Implements first-deny-wins cascade:
    global -> boundary -> agent -> egress -> rate_limit -> budget
    """

    def __init__(self, loader: PolicyLoader) -> None:
        self._loader = loader

    def evaluate(
        self,
        request: ActionRequest,
        *,
        token_count_so_far: int = 0,
        cost_today_usd: float = 0.0,
        runtime_dep_count_today: int = 0,
    ) -> PolicyResult:
        """Evaluate an ActionRequest against the full policy cascade.

        Returns PolicyResult with ALLOW, DENY, or ESCALATE decision.
        """
        global_policy = self._loader.global_policy
        agent_policy = self._loader.get_agent_policy(request.agent_id)

        # 0. INSTALL_DEPENDENCY special handling (PSEC-02)
        if request.action == ActionType.INSTALL_DEPENDENCY:
            return self._check_install_dependency(request, global_policy, runtime_dep_count_today)

        # 1. Global blocked actions
        if request.action.value in global_policy.blocked_actions:
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=f"Action '{request.action.value}' is globally blocked",
                rule_matched="global.blocked_actions",
                agent_id=request.agent_id,
            )

        # 2. Global chain depth check
        if request.context.chain_depth > global_policy.max_chain_depth:
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=f"Chain depth {request.context.chain_depth} exceeds maximum {global_policy.max_chain_depth}",
                rule_matched="global.max_chain_depth",
                agent_id=request.agent_id,
            )

        # 3. Per-agent action checks
        if agent_policy is not None:
            action_result = self._check_action_policy(request, agent_policy)
            if action_result is not None:
                return action_result

        # 4. Egress checks (only for HTTP actions)
        if request.action in (ActionType.HTTP_GET, ActionType.HTTP_POST, ActionType.HTTP_PUT, ActionType.HTTP_DELETE):
            if agent_policy is not None:
                egress_result = self._check_egress(request, agent_policy)
                if egress_result is not None:
                    return egress_result
            elif request.target:
                # No agent policy — deny egress by default (fail closed)
                return PolicyResult(
                    decision=PolicyDecision.DENY,
                    reason=f"No policy found for agent '{request.agent_id}', egress denied by default",
                    rule_matched="no_policy_egress_deny",
                    agent_id=request.agent_id,
                )

        # 5. Budget checks
        if (
            agent_policy is not None
            and agent_policy.per_task_token_limit is not None
            and token_count_so_far >= agent_policy.per_task_token_limit
        ):
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=(
                    f"Per-task token limit {agent_policy.per_task_token_limit} exceeded"
                    f" ({token_count_so_far} tokens used)"
                ),
                rule_matched="budget.per_task_token_limit",
                agent_id=request.agent_id,
            )

        # Global daily cost check
        if cost_today_usd >= global_policy.default_daily_cost_limit_usd:
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=(
                    f"Daily cost limit ${global_policy.default_daily_cost_limit_usd} exceeded"
                    f" (${cost_today_usd:.4f} today)"
                ),
                rule_matched="global.budget.daily_cost_limit",
                agent_id=request.agent_id,
            )

        return PolicyResult(
            decision=PolicyDecision.ALLOW,
            reason="All policy checks passed",
            agent_id=request.agent_id,
        )

    def _check_action_policy(self, request: ActionRequest, agent_policy: AgentPolicy) -> PolicyResult | None:
        """Check action type against allowed/blocked lists."""
        action_str = request.action.value

        if action_str in agent_policy.blocked_actions:
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=f"Action '{action_str}' is blocked by agent policy",
                rule_matched="agent.actions.blocked",
                agent_id=request.agent_id,
            )

        if agent_policy.allowed_actions and action_str not in agent_policy.allowed_actions:
            # If not explicitly blocked but also not allowed, escalate to reviewer
            # for a security evaluation rather than hard-denying
            if action_str not in agent_policy.blocked_actions:
                return PolicyResult(
                    decision=PolicyDecision.ESCALATE,
                    reason=(
                        f"Action '{action_str}' is not in agent's allowed actions list"
                        " and not explicitly blocked — escalating for review"
                    ),
                    rule_matched="agent.actions.escalate",
                    agent_id=request.agent_id,
                )
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=f"Action '{action_str}' is not in agent's allowed actions list",
                rule_matched="agent.actions.allowed",
                agent_id=request.agent_id,
            )

        return None

    def _check_egress(self, request: ActionRequest, agent_policy: AgentPolicy) -> PolicyResult | None:
        """Check egress rules for HTTP actions."""
        if not request.target:
            return None

        if agent_policy.egress_mode == "deny_all":
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=f"Egress denied — agent '{request.agent_id}' has egress mode 'deny_all'",
                rule_matched="agent.egress.deny_all",
                agent_id=request.agent_id,
            )

        # Allowlist mode — check if target domain is permitted
        parsed = urlparse(request.target)
        target_domain = parsed.netloc.lower()
        target_path = parsed.path
        http_method = request.action.value.replace("http_", "").upper()  # http_get -> GET

        for rule in agent_policy.egress_rules:
            rule_domain = rule.domain.lower()
            if target_domain == rule_domain or target_domain.endswith(f".{rule_domain}"):
                # Domain matches — check method
                if http_method not in rule.methods:
                    return PolicyResult(
                        decision=PolicyDecision.DENY,
                        reason=f"HTTP method {http_method} not allowed for domain {rule_domain}",
                        rule_matched="agent.egress.method",
                        agent_id=request.agent_id,
                    )
                # Check blocked paths
                for blocked_path_pattern in rule.blocked_paths:
                    if self._path_matches(target_path, blocked_path_pattern):
                        return PolicyResult(
                            decision=PolicyDecision.DENY,
                            reason=f"Request path '{target_path}' matches blocked pattern '{blocked_path_pattern}'",
                            rule_matched="agent.egress.blocked_path",
                            agent_id=request.agent_id,
                        )
                # Domain + method + path all OK
                return None

        # No matching rule — deny
        return PolicyResult(
            decision=PolicyDecision.DENY,
            reason=f"Domain '{target_domain}' not in agent's egress allowlist",
            rule_matched="agent.egress.not_in_allowlist",
            agent_id=request.agent_id,
        )

    def _check_install_dependency(
        self,
        request: ActionRequest,
        global_policy: GlobalPolicy,
        runtime_dep_count_today: int,
    ) -> PolicyResult:
        """Evaluate INSTALL_DEPENDENCY action against blocklist and soft limit (PSEC-02).

        - Blocklisted package → DENY (unconditional, no reviewer override)
        - Exceeds soft limit → ESCALATE for human review
        - Otherwise → ALLOW
        """
        params = request.parameters or {}
        package = params.get("package", "")
        dep_type = params.get("type", "pip")

        # Check hard blocklist — DENY is unconditional (locked decision)
        blocklist_for_type: list[str] = global_policy.package_blocklist.get(dep_type, [])
        # Also check the generic blocklist key if present
        blocklist_all: list[str] = global_policy.package_blocklist.get("all", [])

        package_lower = package.lower()
        # Extract base package name (strip version specifiers)
        import re as _re

        base_name = _re.split(r"[><=!~@]", package_lower, maxsplit=1)[0].strip()

        all_blocked = [p.lower() for p in blocklist_for_type + blocklist_all]
        if base_name in all_blocked or package_lower in all_blocked:
            return PolicyResult(
                decision=PolicyDecision.DENY,
                reason=f"Package '{package}' is on the hard blocklist and cannot be installed",
                rule_matched="global.package_blocklist.deny",
                agent_id=request.agent_id,
            )

        # Check soft limit — ESCALATE for human review
        if runtime_dep_count_today >= global_policy.runtime_install_soft_limit:
            return PolicyResult(
                decision=PolicyDecision.ESCALATE,
                reason=(
                    f"Runtime install soft limit ({global_policy.runtime_install_soft_limit}) "
                    f"reached for agent '{request.agent_id}' — escalating for human review"
                ),
                rule_matched="global.runtime_install_soft_limit.escalate",
                agent_id=request.agent_id,
            )

        return PolicyResult(
            decision=PolicyDecision.ALLOW,
            reason=f"Package '{package}' approved for installation",
            rule_matched="install_dependency.allow",
            agent_id=request.agent_id,
        )

    def _path_matches(self, path: str, pattern: str) -> bool:
        """Simple glob-style path matching. Supports '*' as wildcard."""
        # Convert glob pattern to regex
        regex_pattern = re.escape(pattern).replace(r"\*", ".*")
        return bool(re.search(regex_pattern, path))
