# Requirements: KubexClaw v1.2

**Defined:** 2026-03-21
**Core Value:** Any Kubex can become any agent — new capabilities are skill files, not Docker builds.

## v1.2 Requirements

Requirements for MCP Bridge + CLI Runtime milestone. Each maps to roadmap phases.

### MCP Bridge

- [x] **MCP-01**: Orchestrator exposes one MCP tool per registered worker agent (capability = tool name, description from config.yaml)
- [x] **MCP-02**: All worker delegations route through Gateway POST /actions — no policy bypass
- [x] **MCP-03**: Async task_id dispatch pattern — tool call returns task_id immediately, kubex__poll_task checks status
- [x] **MCP-04**: Vault tools exposed as in-process MCP tools with policy gate enforced (Gateway endpoint or inline injection scan)
- [x] **MCP-05**: Tool cache invalidated on agent registration/deregistration via Registry pub/sub (registry:agent_changed)
- [x] **MCP-06**: Old custom tool loop kept alive until MCP bridge passes full E2E parity against all existing tests
- [x] **MCP-07**: Concurrent worker dispatch via asyncio.gather() for parallel tool calls
- [x] **MCP-08**: Meta-tools: kubex__list_agents, kubex__agent_status, kubex__cancel_task

### CLI Runtime

- [x] **CLI-01**: PTY-based subprocess launch for any configured CLI agent (runtime field in config.yaml)
- [x] **CLI-02**: Credential check at startup with HITL re-auth via existing request_user_input action
- [x] **CLI-03**: Failure pattern detection per CLI type with typed reason in task_failed payload (subscription_limit, auth_expired, cli_crash, runtime_not_available)
- [x] **CLI-04**: SIGTERM handler: forward to PTY child → wait 5s → SIGKILL → exit harness; tini as PID 1; exec-form CMD
- [x] **CLI-05**: Skills injected as CLAUDE.md / AGENTS.md / GEMINI.md at spawn time (extends stem cell skill injection)
- [x] **CLI-06**: Named Docker volumes for OAuth token persistence across container restarts (one volume per agent_id)
- [x] **CLI-07**: Container lifecycle state machine: BOOTING → CREDENTIAL_WAIT → READY ↔ BUSY with events via Redis pub/sub
- [x] **CLI-08**: Claude Code runtime via PTY subprocess
- [ ] **CLI-09**: Codex CLI runtime via PTY subprocess
- [x] **CLI-10**: Gemini CLI runtime via PTY subprocess

### Hooks Monitoring

- [x] **HOOK-01**: PostToolUse / Stop / SessionEnd hooks received at harness HTTP endpoint (localhost:8099)
- [x] **HOOK-02**: Hook config mounted read-only — no runtime modification possible (security: CVE-2025-59536, CVE-2026-21852)
- [x] **HOOK-03**: task_progress lifecycle events emitted from hook data via Redis pub/sub
- [x] **HOOK-04**: Audit trail of CLI tool invocations from PostToolUse hooks

### OAuth Provisioning

- [ ] **AUTH-01**: Command Center web UI triggers OAuth flow for target container
- [ ] **AUTH-02**: Token forwarded from Command Center to container at spawn via Gateway /oauth/token relay endpoint
- [ ] **AUTH-03**: Pre-flight expiry check before dispatching tasks to CLI agents

## Future Requirements

Deferred to v1.3+. Tracked but not in current roadmap.

### Cross-Agent Collaboration

- **COLLAB-01**: Worker "need_info" cross-Kubex protocol for agent-to-agent queries
- **COLLAB-02**: Bidirectional MCP for Codex CLI (harness as concurrent MCP server + PTY supervisor)

### Observability

- **OBS-01**: SSE streaming of CLI stdout to Command Center (real-time output)
- **OBS-02**: Tool output outputSchema validation in MCP bridge
- **OBS-03**: Gemini CLI hooks monitoring (same pattern as Claude Code)

## Out of Scope

| Feature | Reason |
|---------|--------|
| aider CLI support | No hooks, no MCP client — would need custom wrapper; low priority |
| claude-agent-sdk as interface | Anthropic ToS bans subscription OAuth in third-party automated systems; using raw PTY instead. User handling legal separately. |
| Hot-swap CLI runtime on running container | Same prompt injection concern as hot-swap skills; restart instead |
| SSE streaming of CLI stdout | Explicitly deferred — polling works for current needs |
| Real-time PTY output forwarding | ANSI parsing is fragile and version-dependent; hooks + MCP reporting preferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MCP-01 | Phase 8 | Complete |
| MCP-02 | Phase 8 | Complete |
| MCP-03 | Phase 8 | Complete |
| MCP-04 | Phase 8 | Complete |
| MCP-05 | Phase 8 | Complete |
| MCP-06 | Phase 8 | Complete |
| MCP-07 | Phase 8 | Complete |
| MCP-08 | Phase 8 | Complete |
| CLI-01 | Phase 9 | Complete |
| CLI-02 | Phase 9 | Complete |
| CLI-03 | Phase 9 | Complete |
| CLI-04 | Phase 9 | Complete |
| CLI-05 | Phase 9 | Complete |
| CLI-06 | Phase 9 | Complete |
| CLI-07 | Phase 9 | Complete |
| CLI-08 | Phase 9 | Complete |
| CLI-09 | Backlog (999.2) | Deferred |
| CLI-10 | Phase 11 | Complete |
| HOOK-01 | Phase 10 | Complete |
| HOOK-02 | Phase 10 | Complete |
| HOOK-03 | Phase 10 | Complete |
| HOOK-04 | Phase 10 | Complete |
| AUTH-01 | Phase 12 | Pending |
| AUTH-02 | Phase 12 | Pending |
| AUTH-03 | Phase 12 | Pending |

**Coverage:**
- v1.2 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 — traceability completed after roadmap creation*
