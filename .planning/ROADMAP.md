# Roadmap: KubexClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-03-09)
- ✅ **v1.1 Stem Cell Kubex** — Phases 5-7 (shipped 2026-03-21)
- 🚧 **v1.2 MCP Bridge + CLI Runtime** — Phases 8-12 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-03-09</summary>

Phases 1-4 delivered the full KubexClaw MVP: gateway with policy engine, broker with Redis task queue, registry, kubex-manager, base agent harness, skill injection, multi-agent orchestration, reviewer escalation routing, knowledge base wiring, kill switch, and human-in-the-loop. 703+ tests passing across unit, integration, and E2E suites.

</details>

<details>
<summary>✅ v1.1 Stem Cell Kubex (Phases 5-7) — SHIPPED 2026-03-21</summary>

- [x] Phase 5: Base Image and Skill Schema (4/4 plans) — completed 2026-03-14
- [x] Phase 6: Manager Spawn Logic and Policy Gates (3/3 plans) — completed 2026-03-16
- [x] Phase 7: Agent Migration and Dockerfile Removal (3/3 plans) — completed 2026-03-17

Universal kubexclaw-base image, skill system with injection defense, Manager atomic spawn pipeline, all 4 agents migrated, per-agent Dockerfiles removed. 789 tests passing. Full E2E pipeline live.

See: `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

### v1.2 MCP Bridge + CLI Runtime (In Progress)

**Milestone Goal:** Replace the orchestrator's custom tool loop with MCP protocol and enable any CLI agent (Claude Code, Codex, Gemini CLI) to run inside Kubex containers via PTY subprocess with hooks-based monitoring and OAuth provisioning.

- [x] **Phase 8: MCP Bridge** — Orchestrator coordination via MCP protocol, replacing custom 8-tool OpenAI loop (completed 2026-03-22)
- [x] **Phase 9: CLI Runtime — Claude Code** — PTY supervisor and credential management, Claude Code as first runtime (completed 2026-03-22)
- [x] **Phase 10: Hooks Monitoring** — Zero-token passive observability via Claude Code hooks HTTP endpoint (completed 2026-03-23)
- [x] **Phase 11: Gemini CLI Runtime** — Extend CLI runtime to Gemini CLI via PTY subprocess (completed 2026-03-23)
- [ ] **Phase 12: OAuth Command Center Web Flow** — Web-based OAuth provisioning, replacing docker-exec HITL

## Phase Details

### Phase 8: MCP Bridge
**Goal**: Orchestrator can coordinate all worker agents through standard MCP protocol with policy-gated vault tools and live agent discovery
**Depends on**: Phase 7 (v1.1 base image and harness)
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08
**Success Criteria** (what must be TRUE):
  1. Orchestrator running `harness_mode: mcp-bridge` dispatches tasks to any registered worker via MCP tool call, with all delegations routing through Gateway POST /actions
  2. Worker tool calls return a task_id immediately; separate kubex__poll_task tool resolves the result — no open connections during long-running or escalated tasks
  3. Vault read and write tools are available as MCP tools with Gateway policy gate enforced on writes; in-process vault bypass is not possible
  4. Registering or deregistering a worker agent refreshes the available MCP tool set without restarting the orchestrator
  5. Full 789-test E2E suite passes against the mcp-bridge code path before the old custom tool loop is deleted
**Plans:** 4/4 plans complete

Plans:
- [x] 08-01-PLAN.md — Foundation: AgentConfig extension, Registry pub/sub, worker config descriptions
- [x] 08-02-PLAN.md — Core MCPBridgeServer with worker delegation, poll tool, pub/sub subscription
- [x] 08-03-PLAN.md — Vault tools (reads in-process, writes via Gateway), meta-tools, concurrent dispatch
- [x] 08-04-PLAN.md — Dual transport, integration tests, parity verification, orchestrator migration

### Phase 08.1: Agent System Prompts (INSERTED)

**Goal:** Structured system prompts for all agents with shared preamble, capability-bounded behavior, security directives, and standard output contract
**Requirements**: PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04, PROMPT-05, PROMPT-06, PROMPT-07
**Depends on:** Phase 8
**Plans:** 2/2 plans complete

Plans:
- [x] 08.1-01-PLAN.md — PREAMBLE.md template, prompt_builder.py module, AgentConfig policy/budget extension
- [x] 08.1-02-PLAN.md — Wire into standalone + mcp-bridge harness paths, unit tests, regression verification

### Phase 9: CLI Runtime — Claude Code
**Goal**: Any Kubex container can run Claude Code as its LLM via PTY subprocess, with credential management, graceful shutdown, and skills injected as CLAUDE.md
**Depends on**: Phase 8
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08
**Success Criteria** (what must be TRUE):
  1. A Kubex container configured with `runtime: claude-code` launches Claude Code via PTY and picks up tasks from the broker without additional manual steps
  2. On first launch with no OAuth token, the container surfaces a re-auth prompt via the existing request_user_input HITL action and transitions to READY state once credentials are confirmed
  3. OAuth tokens survive container restarts via named Docker volumes; a restarted container with a valid token goes directly to READY without triggering re-auth
  4. Sending SIGTERM to the container forwards the signal to the PTY child, waits up to 5 seconds, issues SIGKILL if needed, and exits cleanly with no orphaned processes
  5. Skill files injected at spawn appear as CLAUDE.md inside the container and are picked up by Claude Code at session start
**Plans:** 4/4 plans complete

Plans:
- [x] 09-00-PLAN.md — Wave 0: test stub scaffolding for Nyquist compliance
- [x] 09-01-PLAN.md — Infrastructure: tini PID 1, named Docker volumes, docker-compose.yml, CLAUDE.md skill injection in entrypoint
- [x] 09-02-PLAN.md — CLIRuntime core module: state machine, PTY spawn, credential gate, failure detection
- [x] 09-03-PLAN.md — Wiring into main.py, full unit tests, integration verification

### Phase 10: Hooks Monitoring
**Goal**: Claude Code tool invocations, turn completions, and session ends are passively captured at the harness HTTP endpoint with no prompt token cost and a tamper-proof hook config
**Depends on**: Phase 9
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04
**Success Criteria** (what must be TRUE):
  1. PostToolUse, Stop, and SessionEnd hook events are received at the harness HTTP endpoint (localhost:8099) and can be observed in logs without any code running inside the Claude Code session
  2. The hook config file is mounted read-only; any attempt by a running container process to modify hook scripts is rejected by the filesystem
  3. Each Stop hook event emits a task_progress lifecycle event via Redis pub/sub that the orchestrator or Command Center can observe
  4. An audit trail of CLI tool invocations from PostToolUse events is persisted and queryable per task_id
**Plans:** 3/3 plans complete

Plans:
- [x] 10-00-PLAN.md — Wave 0: test stub scaffolding for Nyquist compliance
- [x] 10-01-PLAN.md — Hook server module, CLIRuntime integration, event handlers, audit write
- [x] 10-02-PLAN.md — Manager settings.json generation, read-only mount, Gateway audit endpoint

### Phase 11: Gemini CLI Runtime
**Goal**: Gemini CLI can run as a Kubex runtime via PTY subprocess, with credential gate, graceful shutdown, lifecycle state machine, and failure pattern detection matching the Claude Code runtime
**Depends on**: Phase 9, Phase 10
**Requirements**: CLI-10
**Success Criteria** (what must be TRUE):
  1. A Kubex container configured with `runtime: gemini-cli` launches Gemini CLI via PTY subprocess with the same credential gate, graceful shutdown, and lifecycle state machine as the Claude Code runtime
  2. Gemini CLI failure patterns (auth_expired, cli_crash, quota_exceeded) are detected and reported as typed failure reasons in the task_failed payload
  3. Skills injected at spawn appear as GEMINI.md inside the container and are picked up by Gemini CLI at session start
**Plans:** 1/1 plans complete

Plans:
- [x] 11-01-PLAN.md — Generalize CLIRuntime for multi-runtime dispatch, add Gemini CLI support, correct Manager credential path

### Phase 12: OAuth Command Center Web Flow
**Goal**: Users can provision CLI agent OAuth tokens through the Command Center web UI without docker exec, and tasks dispatched to CLI agents are pre-flight checked for token expiry at the agent level
**Depends on**: Phase 9
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):
  1. The Command Center web UI provides an OAuth flow for a target container; completing the flow provisions the token without the user running any CLI commands
  2. A container spawned with a pre-provisioned token from the web flow starts in READY state, bypassing CREDENTIAL_WAIT entirely
  3. A CLI agent with missing or expired credentials rejects the dispatched task at execution time and transitions to CREDENTIAL_WAIT state with a clear error (per D-09: agent-side pre-flight in _execute_task_inner; no Gateway dispatch-time check needed)
**Plans:** 1/2 plans executed

Plans:
- [x] 12-01-PLAN.md — Gateway lifecycle SSE endpoint with Bearer auth, Manager credential path fix, AUTH-03 confirmation
- [ ] 12-02-PLAN.md — FE handoff document with API contracts, sequence diagrams, edge cases

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4. MVP | v1.0 | — | Complete | 2026-03-09 |
| 5. Base Image and Skill Schema | v1.1 | 4/4 | Complete | 2026-03-14 |
| 6. Manager Spawn Logic and Policy Gates | v1.1 | 3/3 | Complete | 2026-03-16 |
| 7. Agent Migration and Dockerfile Removal | v1.1 | 3/3 | Complete | 2026-03-17 |
| 8. MCP Bridge | v1.2 | 4/4 | Complete   | 2026-03-22 |
| 8.1 Agent System Prompts | v1.2 | 0/2 | In progress | - |
| 9. CLI Runtime — Claude Code | v1.2 | 4/4 | Complete   | 2026-03-22 |
| 10. Hooks Monitoring | v1.2 | 3/3 | Complete    | 2026-03-23 |
| 11. Gemini CLI Runtime | v1.2 | 1/1 | Complete    | 2026-03-23 |
| 12. OAuth Command Center Web Flow | v1.2 | 1/2 | In Progress|  |

## Backlog

### Phase 999.1: MCP Server Gateway (BACKLOG)

**Goal:** Expose the entire Kubex architecture as an MCP server so any LLM harness (Claude Code, Cursor, Windsurf, Cline, etc.) can interact with Kubex directly — without going through the internal orchestrator. Users connect their preferred LLM client via MCP and get access to Kubex capabilities (spawn agents, dispatch tasks, query results, view audit trails). Democratizes access to the agent infrastructure beyond the orchestrator.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.2: Codex CLI Runtime (BACKLOG)

**Goal:** Codex CLI runtime via PTY subprocess with per-CLI credential paths and failure pattern detection. Deferred — Codex CLI hooks are "experimental" per OpenAI docs, needs research before planning.
**Requirements:** CLI-09
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.3: Research ruflo (BACKLOG)

**Goal:** Analyze the ruflo project (github.com/ruvnet/ruflo) — study their agent orchestration architecture, patterns, and design decisions to identify ideas and lessons applicable to KubexClaw. Compare approaches to agent lifecycle, task routing, monitoring, and MCP integration.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
