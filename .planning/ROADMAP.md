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

### 🚧 v1.2 MCP Bridge + CLI Runtime (In Progress)

**Milestone Goal:** Replace the orchestrator's custom tool loop with MCP protocol and enable any CLI agent (Claude Code, Codex, Gemini CLI) to run inside Kubex containers via PTY subprocess with hooks-based monitoring and OAuth provisioning.

- [ ] **Phase 8: MCP Bridge** — Orchestrator coordination via MCP protocol, replacing custom 8-tool OpenAI loop
- [ ] **Phase 9: CLI Runtime — Claude Code** — PTY supervisor and credential management, Claude Code as first runtime
- [ ] **Phase 10: Hooks Monitoring** — Zero-token passive observability via Claude Code hooks HTTP endpoint
- [ ] **Phase 11: Codex + Gemini Runtimes** — Extend CLI runtime to Codex CLI and Gemini CLI via PTY
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
**Plans:** 1/4 plans executed

Plans:
- [x] 08-01-PLAN.md — Foundation: AgentConfig extension, Registry pub/sub, worker config descriptions
- [ ] 08-02-PLAN.md — Core MCPBridgeServer with worker delegation, poll tool, pub/sub subscription
- [ ] 08-03-PLAN.md — Vault tools (reads in-process, writes via Gateway), meta-tools, concurrent dispatch
- [ ] 08-04-PLAN.md — Dual transport, integration tests, parity verification, orchestrator migration

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
**Plans**: TBD

### Phase 10: Hooks Monitoring
**Goal**: Claude Code tool invocations, turn completions, and session ends are passively captured at the harness HTTP endpoint with no prompt token cost and a tamper-proof hook config
**Depends on**: Phase 9
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04
**Success Criteria** (what must be TRUE):
  1. PostToolUse, Stop, and SessionEnd hook events are received at the harness HTTP endpoint (localhost:8099) and can be observed in logs without any code running inside the Claude Code session
  2. The hook config file is mounted read-only; any attempt by a running container process to modify hook scripts is rejected by the filesystem
  3. Each Stop hook event emits a task_progress lifecycle event via Redis pub/sub that the orchestrator or Command Center can observe
  4. An audit trail of CLI tool invocations from PostToolUse events is persisted and queryable per task_id
**Plans**: TBD

### Phase 11: Codex + Gemini Runtimes
**Goal**: Codex CLI and Gemini CLI can run as Kubex runtimes via PTY subprocess, with per-CLI credential paths and failure pattern detection
**Depends on**: Phase 9
**Requirements**: CLI-09, CLI-10
**Success Criteria** (what must be TRUE):
  1. A Kubex container configured with `runtime: codex-cli` launches Codex CLI via PTY subprocess, accepts tasks, and returns results with typed failure reasons (subscription_limit, auth_expired, cli_crash) in the task_failed payload
  2. A Kubex container configured with `runtime: gemini-cli` launches Gemini CLI via PTY subprocess with the same credential gate, graceful shutdown, and lifecycle state machine as the Claude Code runtime
**Plans**: TBD

### Phase 12: OAuth Command Center Web Flow
**Goal**: Users can provision CLI agent OAuth tokens through the Command Center web UI without docker exec, and tasks dispatched to CLI agents are pre-flight checked for token expiry
**Depends on**: Phase 9
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):
  1. The Command Center web UI provides an OAuth flow for a target container; completing the flow provisions the token without the user running any CLI commands
  2. A container spawned with a pre-provisioned token from the web flow starts in READY state, bypassing CREDENTIAL_WAIT entirely
  3. Attempting to dispatch a task to a CLI agent with an expired token is rejected with a clear error before the task enters the broker queue
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4. MVP | v1.0 | — | Complete | 2026-03-09 |
| 5. Base Image and Skill Schema | v1.1 | 4/4 | Complete | 2026-03-14 |
| 6. Manager Spawn Logic and Policy Gates | v1.1 | 3/3 | Complete | 2026-03-16 |
| 7. Agent Migration and Dockerfile Removal | v1.1 | 3/3 | Complete | 2026-03-17 |
| 8. MCP Bridge | v1.2 | 1/4 | In Progress|  |
| 9. CLI Runtime — Claude Code | v1.2 | 0/? | Not started | - |
| 10. Hooks Monitoring | v1.2 | 0/? | Not started | - |
| 11. Codex + Gemini Runtimes | v1.2 | 0/? | Not started | - |
| 12. OAuth Command Center Web Flow | v1.2 | 0/? | Not started | - |
