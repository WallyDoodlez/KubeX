---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: MCP Bridge + CLI Runtime
status: unknown
stopped_at: Completed 14-01-PLAN.md
last_updated: "2026-03-27T02:44:02.994Z"
progress:
  total_phases: 12
  completed_phases: 6
  total_plans: 19
  completed_plans: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Any Kubex can become any agent — new capabilities are skill files, not Docker builds.
**Current focus:** Phase 14 — orchestrator-participant-events

## Current Position

Phase: 14 (orchestrator-participant-events) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**Velocity (v1.1 reference):**

- Total plans completed: 10 (Phases 5-7)
- Phases completed: 7 (1-4 via v1.0, 5-7 via v1.1)

**By Phase (v1.1):**

| Phase | Plans | Status |
|-------|-------|--------|
| 5. Base Image + Skill Schema | 4 | Complete 2026-03-14 |
| 6. Manager Spawn Logic | 3 | Complete 2026-03-16 |
| 7. Agent Migration | 3 | Complete 2026-03-17 |

*Updated after each plan completion*
| Phase 08-mcp-bridge P01 | 2 | 2 tasks | 9 files |
| Phase 08-mcp-bridge P02 | 260 | 3 tasks | 3 files |
| Phase 08-mcp-bridge P03 | 3 | 2 tasks | 3 files |
| Phase 08-mcp-bridge P04 | 35 | 3 tasks | 7 files |
| Phase 08.1-agent-system-prompts P01 | 2 | 2 tasks | 3 files |
| Phase 08.1-agent-system-prompts P02 | 8 | 2 tasks | 4 files |
| Phase 09 P00 | 3 | 1 tasks | 1 files |
| Phase 09-cli-runtime-claude-code P01 | 135s | 2 tasks | 5 files |
| Phase 09 P02 | 429 | 1 tasks | 2 files |
| Phase 09-cli-runtime-claude-code P03 | 10 | 2 tasks | 2 files |
| Phase 10-hooks-monitoring P00 | 4 | 1 tasks | 2 files |
| Phase 10-hooks-monitoring P01 | 394 | 2 tasks | 3 files |
| Phase 10-hooks-monitoring P02 | 509 | 2 tasks | 3 files |
| Phase 11-gemini-cli-runtime P01 | 358 | 3 tasks | 5 files |
| Phase 12-oauth-command-center-web-flow P01 | 237 | 3 tasks | 4 files |
| Phase 12 P02 | 121 | 1 tasks | 1 files |
| Phase 14-orchestrator-participant-events P01 | 155 | 1 tasks | 2 files |

## Accumulated Context

### Roadmap Evolution

- Phase 08.1 inserted after Phase 8: Agent System Prompts (INSERTED) — detailed prompts for all agents, regression tested
- Phase 08.2 inserted after Phase 8: Vault Persistence (INSERTED) — knowledge worker E2E vault ops, standalone agent vault wiring
- Phase 08.3 inserted after Phase 8: Orchestrator Context Reset (INSERTED) — meta-tool or auto-truncate for context window management
- Phase 08.4 inserted after Phase 8: Vault Git Sync (INSERTED) — configurable remote repo, auto commit+push, pull on boot
- Phase 13 added: Error Observability Pipeline — unified error detection, propagation, and UI-consumable reporting across Gateway/Broker/Agent boundaries
- Phase 14 added: Orchestrator Participant Events — agent_joined/agent_left progress events from MCP Bridge, unblocks FE Iteration 96

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.2]: MCP Bridge uses async task_id pattern — tool call returns ID immediately, kubex__poll_task checks status (prevents bridge crash on long-running escalations, SDK Issue #212)
- [v1.2]: Vault writes must route through Gateway endpoint or inline injection scan — explicit choice required at Phase 8 planning start, not mid-implementation
- [v1.2]: Hook config mounted read-only — static pipe-relay hook scripts only, no string interpolation (CVE-2025-59536, CVE-2026-21852)
- [v1.2]: CLI Runtime uses claude-agent-sdk for Claude Code (not raw PTY), ptyprocess for Codex/Gemini
- [v1.2]: Old custom tool loop kept alive in parallel until MCP bridge passes full E2E parity against 789 tests; deletion is final step
- [Phase 08-mcp-bridge]: Pub/sub publish placed in own try/except outside hset try/except — publish failure must never block registration success
- [Phase 08-mcp-bridge]: Extracted _handle_poll_task and _handle_worker_dispatch as testable methods (closures delegate to them) to enable unit testing without MCP protocol
- [Phase 08-mcp-bridge]: MagicMock (not AsyncMock) for redis pubsub fixture -- redis client.pubsub() is synchronous in redis-py
- [Phase 08-mcp-bridge]: Vault reads call vault_ops in-process (D-01); vault writes route through Gateway POST /actions with action vault_create/vault_update (D-02) enabling Gateway audit logging (D-03)
- [Phase 08-mcp-bridge]: dispatch_concurrent uses asyncio.gather with return_exceptions=True for partial-failure-safe concurrent worker dispatch (MCP-07)
- [Phase 08-mcp-bridge]: D-13 transport selection: openai-api runtime uses inmemory transport (bridge and LLM share same asyncio loop); any CLI runtime uses stdio for CLI MCP client connections
- [Phase 08-mcp-bridge]: D-12 preserved: standalone.py tool loop methods retained — workers stay on standalone mode; orchestrator config-switched to mcp-bridge without code deletion
- [Phase 08-mcp-bridge]: kubexclaw-base image rebuild required after any kubex_harness code change — E2E tests run against Docker image, not source tree
- [Phase 08.1-agent-system-prompts]: Double-brace escaping used in PREAMBLE.md JSON examples so str.format_map() does not misinterpret JSON curly braces as template variables
- [Phase 08.1-agent-system-prompts]: worker_list_section renders as empty string for worker agents; only filled when orchestrator passes worker_descriptions list
- [Phase 08.1-agent-system-prompts]: Policy and budget parse defensively: configs with no policy/budget stanza produce safe defaults, not an error
- [Phase 08.1-agent-system-prompts]: Sync httpx.get used in _fetch_worker_descriptions — _load_system_prompt runs at startup before asyncio loop, sync call is safe in this one-time path
- [Phase 08.1-agent-system-prompts]: Orchestrator filters self from worker list by comparing agent_id — prevents self-delegation via worker list section
- [Phase 09]: Test stubs use pytest.skip() (not xfail) so they are collected but never count as failures until Plan 03 fills them in
- [Phase 09-cli-runtime-claude-code]: tini installed via apt-get as PID 1 for correct SIGTERM forwarding to Python harness in all kubexclaw-base containers
- [Phase 09-cli-runtime-claude-code]: CLI_CREDENTIAL_MOUNTS dict maps runtime type to container credential path; named volume kubex-creds-{agent_id} auto-created by Docker SDK on spawn
- [Phase 09-cli-runtime-claude-code]: CLAUDE.md generated at /app/CLAUDE.md from all SKILL.md files when runtime != openai-api; skipped for LLM-harness agents
- [Phase 09]: SIGTERM always sent unconditionally in graceful_shutdown (no isalive() pre-check) so shutdown protocol is deterministic
- [Phase 09]: _execute_task does not publish BUSY — task_loop owns READY/BUSY state transitions; _execute_task handles pre-flight credential check
- [Phase 09-03]: CLI runtime routing placed BEFORE harness_mode routing in main.py so CLI agents bypass StandaloneAgent even when harness_mode is standalone
- [Phase 10-hooks-monitoring]: Test stubs use pytest.skip() (not xfail) so they are collected but never count as failures until Plan 01/02 fills them in
- [Phase 10-hooks-monitoring]: Gateway audit tests placed in separate file (test_gateway_audit.py) since they test a different service boundary from harness-side hook server
- [Phase 10-hooks-monitoring]: Annotated discriminated union validated via TypeAdapter.validate_python() not model_validate() — Annotated types are not BaseModel subclasses in pydantic v2
- [Phase 10-hooks-monitoring]: _execute_task refactored into outer+inner pattern for try/finally _current_task_id cleanup while preserving all retry/auth early-return paths
- [Phase 10-hooks-monitoring]: settings.json bind mount placed AFTER named credential volume to shadow named volume for that specific path (Pitfall 5)
- [Phase 10-hooks-monitoring]: Gateway audit endpoint returns 200 with empty list for unknown tasks (not 404) — missing Redis key is normal state
- [Phase 11-gemini-cli-runtime]: CLI_COMMAND_BUILDERS dispatch dict used for multi-runtime command building (D-02)
- [Phase 11-gemini-cli-runtime]: Hook server gate changed from != openai-api to == claude-code (D-13)
- [Phase 11-gemini-cli-runtime]: CLI_CREDENTIAL_MOUNTS[gemini-cli] corrected from /root/.config/gemini to /root/.gemini (actual Gemini CLI path)
- [Phase 12-oauth-command-center-web-flow]: D-04 ported: verify_token Bearer auth added to Gateway using same KUBEX_MGMT_TOKEN env var as Manager
- [Phase 12-oauth-command-center-web-flow]: AUTH-03 resolved by D-09: agent-side pre-flight in _execute_task_inner is sufficient; no Gateway dispatch-time check needed
- [Phase 12]: Handoff doc supersedes docs/HANDOFF-oauth-command-center.md (Phase 9) — Phase 9 doc described gaps; Phase 12 doc is the authoritative post-implementation reference
- [Phase 12]: FE must use fetch() + ReadableStream instead of native EventSource for lifecycle SSE — EventSource API does not support custom headers required for Bearer auth
- [Phase 14-orchestrator-participant-events]: _joined_sub_tasks set used for agent_joined dedup (D-14); _active_task_id cleared in finally block in _handle_message for safe cleanup; _post_progress failures in need_info block caught per-call so poll return is never blocked

### Pending Todos

None.

### Blockers/Concerns

- [Phase 8]: Vault write policy gate — two options (Gateway endpoint vs inline scan) must be decided before Phase 8 implementation starts
- [Phase 11]: Codex deferred to backlog (999.2) — hooks are "experimental" per OpenAI docs. Phase 11 is now Gemini-only.
- [Phase 12]: Command Center OAuth web UI is project-specific — run /gsd:research-phase before planning Phase 12

## Session Continuity

Last session: 2026-03-27T02:44:02.991Z
Stopped at: Completed 14-01-PLAN.md
Resume file: None
