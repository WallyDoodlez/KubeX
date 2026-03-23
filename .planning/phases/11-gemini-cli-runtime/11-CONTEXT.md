# Phase 11: Gemini CLI Runtime - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend CLIRuntime to support Gemini CLI as a second PTY-based runtime. A Kubex container configured with `runtime: gemini-cli` launches Gemini CLI via PTY subprocess with the same credential gate, graceful shutdown, lifecycle state machine, and failure detection as Claude Code. Gemini CLI hooks monitoring is explicitly deferred (OBS-03).

</domain>

<decisions>
## Implementation Decisions

### Gemini CLI Invocation
- **D-01:** Gemini CLI command format must be researched — exact flags for non-interactive task execution, structured output, and model selection. Researcher must determine the `gemini` CLI equivalent of `claude -p "task" --output-format json`.
- **D-02:** `_build_command()` refactored to dispatch per runtime type. Each runtime provides its own command builder (not a single method with if/else chains). Pattern: `CLI_COMMAND_BUILDERS: dict[str, Callable]` mapping runtime name to builder function.
- **D-03:** Gemini CLI working directory is `/app` (same as Claude Code). GEMINI.md is placed there for skill pickup.

### Skill Injection
- **D-04:** `_write_claude_md()` generalized to `_write_skill_file()` — writes `CLAUDE.md` for claude-code, `GEMINI.md` for gemini-cli. File name and format per runtime type via `CLI_SKILL_FILES: dict[str, str]` constant.
- **D-05:** GEMINI.md content is identical concatenation of SKILL.md files (same as CLAUDE.md). Gemini CLI picks up instructions from its working directory config file. If Gemini CLI uses a different mechanism (e.g. `~/.gemini/instructions.md`), researcher must identify the correct path.
- **D-06:** Entrypoint.sh already handles skill injection for CLI runtimes. Only the Python-side `_write_skill_file()` needs the runtime-to-filename mapping.

### Credential Detection
- **D-07:** Add `gemini-cli` to `CREDENTIAL_PATHS` dict: `Path.home() / ".config" / "gemini" / "credentials.json"`. This matches the Manager's existing `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` = `/root/.config/gemini`.
- **D-08:** HITL re-auth message for Gemini: `docker exec -it <container> gemini auth login` (or equivalent — researcher must confirm Gemini CLI auth command).
- **D-09:** Credential volume mount already configured in Manager lifecycle.py (`CLI_CREDENTIAL_MOUNTS` has `gemini-cli` entry). No Manager changes needed for credential paths.

### Failure Patterns
- **D-10:** Add gemini-specific entries to `FAILURE_PATTERNS` dict. Researcher must identify Gemini CLI error output strings for: authentication failures, quota/rate limits, CLI crashes, and command-not-found scenarios.
- **D-11:** Same classification strategy as Claude Code (D-13/D-14 from Phase 9): check exit code first, scan last 50 lines on non-zero exit. No architectural change needed.
- **D-12:** `auth_expired` bypass retry applies to Gemini too — same logic, different pattern strings.

### Monitoring (without hooks)
- **D-13:** No hook server for gemini-cli runtimes. Hook server startup in `CLIRuntime.run()` must be gated on `config.runtime == "claude-code"` (not just `!= "openai-api"`). Gemini CLI hooks are OBS-03 (deferred).
- **D-14:** Gemini agents get stdout-only monitoring via existing time-batched progress chunks (Phase 9 D-09/D-10). This provides basic observability without hooks.
- **D-15:** Manager must NOT generate Claude settings.json for gemini-cli containers. `_generate_hook_settings()` is Claude Code-specific. Gate on runtime type.

### Refactoring Strategy
- **D-16:** CLIRuntime stays as one class — no GeminiRuntime subclass. Runtime-specific behavior is dispatched via config-driven dicts (`CREDENTIAL_PATHS`, `FAILURE_PATTERNS`, `CLI_COMMAND_BUILDERS`, `CLI_SKILL_FILES`). Keeps the stem cell philosophy — one universal runtime, specialized by config.
- **D-17:** All existing Claude Code tests must continue passing after refactoring. New Gemini-specific tests added alongside.

### Claude's Discretion
- Exact Gemini CLI flag syntax (pending research)
- Gemini-specific failure pattern strings (pending research)
- Whether GEMINI.md path is working directory or a config-specific location
- Test fixture design for Gemini-specific paths

</decisions>

<specifics>
## Specific Ideas

- The refactoring is primarily additive — extending dicts and adding one builder function. The CLIRuntime class structure and lifecycle state machine don't change.
- Codex CLI was explicitly deferred to backlog (999.2) due to experimental hooks. Phase 11 is Gemini-only.
- Phase 10's hook server gating currently checks `config.runtime != "openai-api"` which would incorrectly start the Claude hook server for Gemini agents. This must be narrowed to `config.runtime == "claude-code"`.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### CLIRuntime (extend this)
- `agents/_base/kubex_harness/cli_runtime.py` — Full CLIRuntime module. Credential paths (line 52), failure patterns (line 57), `_build_command()` (line 649), `_write_claude_md()` (line 210), hook server startup (line 162)
- `agents/_base/kubex_harness/main.py` lines 70-91 — CLI runtime routing (already handles any non-openai-api runtime)

### Hook Server (gate runtime type)
- `agents/_base/kubex_harness/hook_server.py` — Hook server started in CLIRuntime.run(). Must be gated to claude-code only.
- `agents/_base/kubex_harness/cli_runtime.py` line 162 — Current hook server startup check (`config.runtime != "openai-api"` → needs narrowing)

### Manager (already configured)
- `services/kubex-manager/kubex_manager/lifecycle.py` lines 74-78 — `CLI_CREDENTIAL_MOUNTS` already has gemini-cli entry
- `services/kubex-manager/kubex_manager/lifecycle.py` lines 86-108 — `_generate_hook_settings()` is Claude-specific, must be gated
- `services/kubex-manager/kubex_manager/main.py` lines 542-546 — Credential injection paths already include gemini-cli

### Config & Transport (already configured)
- `libs/kubex-common/kubex_common/schemas/config.py` — AgentConfig.runtime field accepts any string
- `agents/_base/kubex_harness/mcp_bridge.py` line 68 — Transport selection already routes gemini-cli to stdio
- `agents/_base/kubex_harness/config_loader.py` line 73 — Config loader docs already reference gemini-cli

### Phase 9 Context (prior decisions)
- `.planning/phases/09-cli-runtime-claude-code/09-CONTEXT.md` — D-01 through D-17: all CLIRuntime design decisions. Phase 11 extends, not replaces.

### Phase 10 Context (hook gating)
- `.planning/phases/10-hooks-monitoring/10-CONTEXT.md` — D-06: hook endpoint runs only for CLI runtimes. Must be narrowed to claude-code only.

### Design Doc
- `docs/design-oauth-runtime.md` — Full CLI runtime architecture, credential flow, failure handling

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CLIRuntime` class: Full lifecycle state machine, credential gate, task loop, progress streaming — all runtime-agnostic except 4 hardcoded Claude references
- `CLI_CREDENTIAL_MOUNTS` in lifecycle.py: Already maps gemini-cli → `/root/.config/gemini`
- MCP bridge transport selection: Already routes gemini-cli to stdio
- Manager credential injection endpoint: Already handles gemini-cli

### Established Patterns
- Config-driven dispatch via dicts (not subclasses) — matches stem cell philosophy
- `harness_mode` / `runtime` routing in main.py
- Gateway-as-ingress for all external communication
- Lifecycle events on `lifecycle:{agent_id}` Redis pub/sub

### Integration Points
- `cli_runtime.py:CREDENTIAL_PATHS` — Add gemini-cli entry
- `cli_runtime.py:FAILURE_PATTERNS` — Add gemini-specific patterns
- `cli_runtime.py:_build_command()` — Dispatch per runtime type
- `cli_runtime.py:_write_claude_md()` — Generalize to `_write_skill_file()`
- `cli_runtime.py:run()` line 162 — Narrow hook server gate to claude-code
- `lifecycle.py:_generate_hook_settings()` call site — Gate to claude-code only
- `docker-compose.yml` — Add gemini agent service definition (optional, for E2E testing)

</code_context>

<deferred>
## Deferred Ideas

- **Gemini CLI hooks monitoring** — OBS-03 in REQUIREMENTS.md (Future). Same hook pattern but different config format. Separate phase.
- **Codex CLI runtime** — Backlog 999.2. Hooks are experimental per OpenAI docs.
- **Bidirectional MCP for non-Claude CLIs** — COLLAB-02. Not in scope.
- **Hot-swap CLI runtime** — Out of scope per REQUIREMENTS.md.

</deferred>

---

*Phase: 11-gemini-cli-runtime*
*Context gathered: 2026-03-23*
