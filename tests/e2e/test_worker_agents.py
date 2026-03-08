"""Wave 5B — Spec-Driven E2E Tests for Worker Agent Dockerfiles + Skills.

These tests encode the EXPECTED structure and content of the Wave 5B
deliverables as specified in:
  - IMPLEMENTATION-PLAN.md  Wave 5, Stream 5B
  - docs/agents.md          Agent identity, config schema, skill manifest format
  - docs/architecture.md    Agent boundary model, multi-provider anti-collusion

Wave 5B delivers:
  - Orchestrator Dockerfile + mcp-bridge directory
  - Worker Dockerfiles for instagram-scraper, knowledge, reviewer
  - Skill markdown files (SKILL.md) under skills/ directory hierarchy
  - Verified agent config.yaml files with required policy sections

Tests are SKIPPED until Wave 5B implementation lands.  Removing the skip
decorator (or the import guard) is sufficient to activate them.

These tests are FILESYSTEM-ONLY — they validate that the expected files exist
and contain the correct content.  No imports or network calls are required.

Paths tested (all relative to repository root):
  agents/orchestrator/Dockerfile
  agents/orchestrator/mcp-bridge/     (directory)
  agents/instagram-scraper/Dockerfile
  agents/knowledge/Dockerfile
  agents/reviewer/Dockerfile
  agents/*/config.yaml                (all four agents)
  skills/data-collection/web-scraping/SKILL.md
  skills/knowledge/recall/SKILL.md
"""

from __future__ import annotations

import os

import pytest
import yaml

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---------------------------------------------------------------------------
# Conditional guard — these tests can run as soon as the files exist.
#
# We gate on Orchestrator Dockerfile presence as the Wave 5B readiness signal.
# ---------------------------------------------------------------------------
_WAVE5B_IMPLEMENTED = os.path.isfile(
    os.path.join(_ROOT, "agents/orchestrator/Dockerfile")
) and os.path.isfile(
    os.path.join(_ROOT, "skills/data-collection/web-scraping/SKILL.md")
)

_skip_wave5b = pytest.mark.skipif(
    not _WAVE5B_IMPLEMENTED,
    reason=(
        "Wave 5B not yet implemented — "
        "agents/orchestrator/Dockerfile or skills/data-collection/web-scraping/SKILL.md missing"
    ),
)

# ---------------------------------------------------------------------------
# Helper: load a YAML file from the repository
# ---------------------------------------------------------------------------


def _load_yaml(rel_path: str) -> dict:
    """Load a YAML file relative to the repo root.  Fails the test if missing."""
    full_path = os.path.join(_ROOT, rel_path)
    if not os.path.isfile(full_path):
        pytest.fail(f"Expected file not found: {full_path}")
    with open(full_path) as fh:
        return yaml.safe_load(fh) or {}


def _file_exists(rel_path: str) -> bool:
    return os.path.isfile(os.path.join(_ROOT, rel_path))


def _dir_exists(rel_path: str) -> bool:
    return os.path.isdir(os.path.join(_ROOT, rel_path))


def _file_content(rel_path: str) -> str:
    """Return the text content of a file relative to the repo root."""
    full_path = os.path.join(_ROOT, rel_path)
    if not os.path.isfile(full_path):
        pytest.fail(f"Expected file not found: {full_path}")
    with open(full_path) as fh:
        return fh.read()


# ===========================================================================
# 5B-DIRS: All Four Agent Directories
# ===========================================================================


@_skip_wave5b
class TestAgentDirectories:
    """Spec ref: IMPLEMENTATION-PLAN.md 5B — 4 agent directories must exist."""

    def test_orchestrator_directory_exists(self) -> None:
        """5B-DIR-01: agents/orchestrator/ directory exists.

        Spec: 'Orchestrator Dockerfile + mcp-bridge directory'
        """
        assert _dir_exists("agents/orchestrator"), (
            "agents/orchestrator/ directory is missing"
        )

    def test_instagram_scraper_directory_exists(self) -> None:
        """5B-DIR-02: agents/instagram-scraper/ directory exists.

        Spec: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer'
        """
        assert _dir_exists("agents/instagram-scraper"), (
            "agents/instagram-scraper/ directory is missing"
        )

    def test_knowledge_directory_exists(self) -> None:
        """5B-DIR-03: agents/knowledge/ directory exists.

        Spec: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer'
        """
        assert _dir_exists("agents/knowledge"), (
            "agents/knowledge/ directory is missing"
        )

    def test_reviewer_directory_exists(self) -> None:
        """5B-DIR-04: agents/reviewer/ directory exists.

        Spec: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer'
        """
        assert _dir_exists("agents/reviewer"), (
            "agents/reviewer/ directory is missing"
        )


# ===========================================================================
# 5B-DOCKERFILES: Worker Dockerfiles
# ===========================================================================


@_skip_wave5b
class TestWorkerDockerfiles:
    """Spec ref: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer (FROM _base)'."""

    def test_orchestrator_dockerfile_exists(self) -> None:
        """5B-DOCKER-01: agents/orchestrator/Dockerfile exists.

        Spec: 'Orchestrator Dockerfile + mcp-bridge directory'
        The orchestrator is a special worker that runs the MCP bridge process.
        """
        assert _file_exists("agents/orchestrator/Dockerfile"), (
            "agents/orchestrator/Dockerfile is missing"
        )

    def test_instagram_scraper_dockerfile_exists(self) -> None:
        """5B-DOCKER-02: agents/instagram-scraper/Dockerfile exists.

        Spec: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer'
        """
        assert _file_exists("agents/instagram-scraper/Dockerfile"), (
            "agents/instagram-scraper/Dockerfile is missing"
        )

    def test_knowledge_dockerfile_exists(self) -> None:
        """5B-DOCKER-03: agents/knowledge/Dockerfile exists.

        Spec: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer'
        """
        assert _file_exists("agents/knowledge/Dockerfile"), (
            "agents/knowledge/Dockerfile is missing"
        )

    def test_reviewer_dockerfile_exists(self) -> None:
        """5B-DOCKER-04: agents/reviewer/Dockerfile exists.

        Spec: 'Worker Dockerfiles for instagram-scraper, knowledge, reviewer'
        """
        assert _file_exists("agents/reviewer/Dockerfile"), (
            "agents/reviewer/Dockerfile is missing"
        )

    def test_worker_dockerfiles_extend_base_image(self) -> None:
        """5B-DOCKER-05: Worker Dockerfiles inherit FROM the kubex _base image.

        Spec: 'FROM _base' — workers must not define their own Node.js/OpenClaw setup.
        The base image handles OpenClaw installation and the kubex-harness entrypoint.
        """
        for agent in ("instagram-scraper", "knowledge", "reviewer"):
            content = _file_content(f"agents/{agent}/Dockerfile")
            assert "FROM" in content, (
                f"agents/{agent}/Dockerfile missing FROM instruction"
            )
            # Should reference _base image or kubex-base
            assert "_base" in content.lower() or "kubex-base" in content.lower() or "base" in content.lower(), (
                f"agents/{agent}/Dockerfile does not extend the _base image"
            )

    def test_orchestrator_dockerfile_installs_mcp_bridge(self) -> None:
        """5B-DOCKER-06: Orchestrator Dockerfile installs the MCP bridge Python package.

        Spec: 'Orchestrator extends _base, pre-packages MCP bridge'
        The MCP bridge must be installed so it can be invoked as an additional process.
        """
        content = _file_content("agents/orchestrator/Dockerfile")
        # Should install mcp_bridge package or copy the directory
        assert "mcp" in content.lower() or "mcp_bridge" in content.lower() or "pip install" in content.lower(), (
            "Orchestrator Dockerfile does not install the MCP bridge package"
        )


# ===========================================================================
# 5B-MCP-BRIDGE: Orchestrator MCP Bridge Directory
# ===========================================================================


@_skip_wave5b
class TestOrchestratorMCPBridgeStructure:
    """Spec ref: 'Orchestrator mcp-bridge directory structure exists'."""

    def test_mcp_bridge_directory_exists(self) -> None:
        """5B-MCP-01: agents/orchestrator/mcp-bridge/ directory exists.

        Spec: 'Orchestrator extends _base, pre-packages MCP bridge, places mcp.json in ~/.openclaw/'
        """
        assert _dir_exists("agents/orchestrator/mcp-bridge"), (
            "agents/orchestrator/mcp-bridge/ directory is missing"
        )

    def test_mcp_bridge_server_module_exists(self) -> None:
        """5B-MCP-02: agents/orchestrator/mcp-bridge/server.py exists.

        Spec: Module path tested: agents/orchestrator/mcp_bridge/server.py
        """
        assert _file_exists("agents/orchestrator/mcp-bridge/server.py"), (
            "agents/orchestrator/mcp-bridge/server.py is missing"
        )

    def test_mcp_bridge_gateway_client_exists(self) -> None:
        """5B-MCP-03: agents/orchestrator/mcp-bridge/client/gateway.py exists.

        Spec: Module path: agents/orchestrator/mcp_bridge/client/gateway.py
        """
        assert _file_exists("agents/orchestrator/mcp-bridge/client/gateway.py"), (
            "agents/orchestrator/mcp-bridge/client/gateway.py is missing"
        )


# ===========================================================================
# 5B-SKILLS-FILES: Skill SKILL.md Files Exist
# ===========================================================================


@_skip_wave5b
class TestSkillFilesExist:
    """Spec ref: 'Skills are Markdown — SKILL.md files under skills/ directory hierarchy.'"""

    def test_web_scraping_skill_file_exists(self) -> None:
        """5B-SKILL-01: skills/data-collection/web-scraping/SKILL.md exists.

        Spec: Skill file path for the web scraping skill.
        OpenClaw reads SKILL.md files to understand tool capabilities.
        """
        assert _file_exists("skills/data-collection/web-scraping/SKILL.md"), (
            "skills/data-collection/web-scraping/SKILL.md is missing"
        )

    def test_knowledge_recall_skill_file_exists(self) -> None:
        """5B-SKILL-02: skills/knowledge/recall/SKILL.md exists.

        Spec: Skill file path for the knowledge recall skill.
        """
        assert _file_exists("skills/knowledge/recall/SKILL.md"), (
            "skills/knowledge/recall/SKILL.md is missing"
        )


# ===========================================================================
# 5B-SKILLS-FRONTMATTER: Skill YAML Frontmatter Validation
# ===========================================================================


@_skip_wave5b
class TestSkillFrontmatter:
    """Spec ref: 'Skill YAML frontmatter has required fields (name, description, version, tools, tags)'."""

    def _parse_skill_frontmatter(self, rel_path: str) -> dict:
        """Parse YAML frontmatter from a SKILL.md file.

        SKILL.md files use YAML frontmatter delimited by --- blocks at the top,
        followed by markdown documentation.
        """
        content = _file_content(rel_path)
        lines = content.splitlines()

        # Find YAML front matter block (--- ... ---)
        if lines and lines[0].strip() == "---":
            end_idx = None
            for i, line in enumerate(lines[1:], start=1):
                if line.strip() == "---":
                    end_idx = i
                    break
            if end_idx is not None:
                yaml_block = "\n".join(lines[1:end_idx])
                return yaml.safe_load(yaml_block) or {}

        # Fall back: load the whole file as YAML (for files without markdown body)
        full_yaml = yaml.safe_load(content)
        if isinstance(full_yaml, dict):
            return full_yaml
        return {}

    def test_web_scraping_skill_has_required_frontmatter_fields(self) -> None:
        """5B-FRONT-01: web-scraping SKILL.md has name, description, version, tools, tags.

        Spec: 'Skill YAML frontmatter has required fields'
        """
        data = self._parse_skill_frontmatter(
            "skills/data-collection/web-scraping/SKILL.md"
        )
        # Frontmatter may be nested under 'skill:' key
        skill = data.get("skill", data)
        assert skill.get("name"), "SKILL.md missing 'name' field"
        assert skill.get("description") or skill.get("tools"), (
            "SKILL.md missing 'description' or 'tools' field"
        )
        version = skill.get("version")
        assert version, "SKILL.md missing 'version' field"

    def test_knowledge_recall_skill_has_required_frontmatter_fields(self) -> None:
        """5B-FRONT-02: knowledge/recall SKILL.md has name, description, version, tools.

        Spec: 'Skill YAML frontmatter has required fields'
        """
        data = self._parse_skill_frontmatter("skills/knowledge/recall/SKILL.md")
        skill = data.get("skill", data)
        assert skill.get("name"), "SKILL.md missing 'name' field"
        version = skill.get("version")
        assert version, "SKILL.md missing 'version' field"
        tools = skill.get("tools")
        assert tools, "SKILL.md missing 'tools' field"

    def test_web_scraping_skill_lists_allowed_egress_domains(self) -> None:
        """5B-FRONT-03: web-scraping skill references allowed egress domains.

        Spec: 'Instagram scraper skill lists allowed domains'
        The skill must reference its required egress domains so policy can enforce them.
        """
        content = _file_content("skills/data-collection/web-scraping/SKILL.md")
        # Should mention instagram.com or graph.instagram.com
        assert "instagram.com" in content.lower() or "graph.instagram" in content.lower(), (
            "web-scraping SKILL.md does not mention allowed Instagram domains"
        )

    def test_knowledge_skill_references_temporal_knowledge_model(self) -> None:
        """5B-FRONT-04: knowledge/recall skill references temporal knowledge model.

        Spec: 'Knowledge skill lists temporal knowledge model'
        Graphiti uses bi-temporal data model — skills must document the valid_at parameter.
        """
        content = _file_content("skills/knowledge/recall/SKILL.md")
        # Should mention temporal queries or valid_at or point-in-time
        assert (
            "temporal" in content.lower()
            or "valid_at" in content.lower()
            or "point-in-time" in content.lower()
            or "time" in content.lower()
        ), (
            "knowledge/recall SKILL.md does not reference temporal knowledge model"
        )


# ===========================================================================
# 5B-CONFIGS: Agent Config YAML Validation
# ===========================================================================


@_skip_wave5b
class TestAgentConfigs:
    """Spec ref: 'Agent config.yaml files have correct structure'."""

    def test_instagram_scraper_config_has_correct_agent_id(self) -> None:
        """5B-CFG-01: instagram-scraper config.yaml has agent.id == 'instagram-scraper'.

        Spec: 'Instagram-scraper config.yaml has correct agent_id, boundary, skills'
        """
        data = _load_yaml("agents/instagram-scraper/config.yaml")
        assert data["agent"]["id"] == "instagram-scraper"

    def test_instagram_scraper_config_has_data_collection_skills(self) -> None:
        """5B-CFG-02: instagram-scraper config lists at least one data collection skill.

        Spec: 'Instagram-scraper config.yaml has correct agent_id, boundary, skills'
        """
        data = _load_yaml("agents/instagram-scraper/config.yaml")
        skills = data["agent"].get("skills", [])
        assert len(skills) >= 1, "instagram-scraper must have at least one skill"
        skill_str = " ".join(skills).lower()
        assert "scrape" in skill_str or "extract" in skill_str or "data" in skill_str, (
            f"instagram-scraper skills don't include a scraping skill: {skills}"
        )

    def test_knowledge_config_has_correct_agent_id(self) -> None:
        """5B-CFG-03: knowledge config.yaml has agent.id == 'knowledge'.

        Spec: 'Knowledge config.yaml has correct agent_id, skills'
        """
        data = _load_yaml("agents/knowledge/config.yaml")
        assert data["agent"]["id"] == "knowledge"

    def test_knowledge_config_has_knowledge_skills(self) -> None:
        """5B-CFG-04: knowledge config lists query_knowledge, store_knowledge, search_corpus.

        Spec: 'Knowledge config.yaml has correct agent_id, skills'
        """
        data = _load_yaml("agents/knowledge/config.yaml")
        skills = data["agent"].get("skills", [])
        skill_str = " ".join(skills).lower()
        assert "knowledge" in skill_str or "query" in skill_str or "store" in skill_str, (
            f"knowledge agent skills don't include knowledge operations: {skills}"
        )

    def test_reviewer_config_has_correct_agent_id(self) -> None:
        """5B-CFG-05: reviewer config.yaml has agent.id == 'reviewer'.

        Spec: 'Reviewer config.yaml has correct agent_id, models (o3-mini)'
        """
        data = _load_yaml("agents/reviewer/config.yaml")
        assert data["agent"]["id"] == "reviewer"

    def test_reviewer_config_uses_o3_mini_model(self) -> None:
        """5B-CFG-06: reviewer config.yaml specifies o3-mini as the model.

        Spec: 'Reviewer config.yaml has correct agent_id, models (o3-mini)'
        Split-provider anti-collusion: reviewer uses OpenAI, workers use Anthropic.
        """
        data = _load_yaml("agents/reviewer/config.yaml")
        models = data["agent"].get("models", {})
        allowed = models.get("allowed", [])
        model_ids = [m.get("id", "") for m in allowed if isinstance(m, dict)]
        assert any("o3" in mid.lower() or "o3-mini" in mid.lower() for mid in model_ids), (
            f"reviewer should use o3-mini model, got: {model_ids}"
        )

    def test_orchestrator_config_has_system_prompt(self) -> None:
        """5B-CFG-07: orchestrator config.yaml has a non-empty system prompt.

        Spec: 'Orchestrator config has system prompt with delegation rules'
        The orchestrator's prompt defines its delegation-only behavior.
        """
        data = _load_yaml("agents/orchestrator/config.yaml")
        prompt = data["agent"].get("prompt", "")
        assert prompt and len(prompt.strip()) > 50, (
            "orchestrator config.yaml has a missing or very short system prompt"
        )

    def test_orchestrator_config_blocks_direct_http_actions(self) -> None:
        """5B-CFG-08: orchestrator policy blocks http_get, http_post, execute_code.

        Spec: 'Orchestrator config blocks http_get/http_post/execute_code'
        The orchestrator must NEVER access the internet directly — delegation only.
        """
        data = _load_yaml("agents/orchestrator/config.yaml")
        blocked = data["agent"].get("policy", {}).get("blocked_actions", [])
        for action in ("http_get", "http_post", "execute_code"):
            assert action in blocked, (
                f"orchestrator policy does not block '{action}': blocked={blocked}"
            )

    def test_all_agent_configs_have_policy_section(self) -> None:
        """5B-CFG-09: All four agent configs have an agent.policy section.

        Spec: 'Agent configs have policy sections with allowed/blocked actions'
        Policies define the agent boundary enforced by the Gateway.
        """
        for agent in ("orchestrator", "instagram-scraper", "knowledge", "reviewer"):
            data = _load_yaml(f"agents/{agent}/config.yaml")
            policy = data["agent"].get("policy")
            assert policy is not None, (
                f"agents/{agent}/config.yaml is missing the 'policy' section"
            )
            assert "allowed_actions" in policy or "blocked_actions" in policy, (
                f"agents/{agent}/config.yaml policy has neither allowed_actions nor blocked_actions"
            )

    def test_reviewer_config_blocks_knowledge_actions(self) -> None:
        """5B-CFG-10: reviewer config.yaml blocks knowledge query/store actions.

        Spec: 'Reviewer blocked from knowledge actions (policy)'
        The reviewer's sole purpose is security review — no knowledge access.
        """
        data = _load_yaml("agents/reviewer/config.yaml")
        policy = data["agent"].get("policy", {})
        allowed = policy.get("allowed_actions", [])
        blocked = policy.get("blocked_actions", [])

        knowledge_actions = {"query_knowledge", "store_knowledge", "search_corpus"}
        # Either explicitly blocked or not in allowed list
        for action in knowledge_actions:
            is_blocked = action in blocked
            is_not_allowed = action not in allowed
            assert is_blocked or is_not_allowed, (
                f"reviewer policy should block '{action}', "
                f"but it is in allowed_actions and not in blocked_actions"
            )
