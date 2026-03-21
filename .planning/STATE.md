---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: MCP Bridge + CLI Runtime
status: defining_requirements
stopped_at: Milestone v1.2 started — defining requirements
last_updated: "2026-03-21"
last_activity: "2026-03-21 — Milestone v1.2 started"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Any Kubex can become any agent — new capabilities are skill files, not Docker builds.
**Current focus:** Defining requirements for v1.2 (MCP Bridge + CLI Runtime)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-21 — Milestone v1.2 started

## Accumulated Context

### Decisions

- MCP Bridge: workers as MCP servers, orchestrator as MCP client, full replacement of custom tool loop
- CLI Runtime: PTY-based, any CLI runs as-is, harness is process supervisor
- Monitoring: hooks preferred (Claude Code, Gemini CLI), MCP reporting fallback (Codex), process monitoring always
- Bidirectional MCP: harness is MCP client (calls workers) AND MCP server (receives CLI reports)
- OAuth: web-based flow via Command Center, not docker exec
- aider: out of scope (no hooks, no MCP)

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-21
Stopped at: Defining requirements for v1.2
Resume file: None
