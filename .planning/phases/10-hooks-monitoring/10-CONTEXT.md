# Phase 10: Hooks Monitoring - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Claude Code tool invocations, turn completions, subagent completions, and session ends are passively captured at the harness HTTP endpoint with no prompt token cost and a tamper-proof hook config. Hook events feed an audit trail (queryable per task_id) and task_progress lifecycle events on Redis pub/sub. This phase covers Claude Code hooks only — Gemini CLI hooks are future scope (OBS-03).

</domain>

<decisions>
## Implementation Decisions

### HTTP Endpoint Design
- **D-01:** Single catch-all route: `POST /hooks` — event_type field in payload discriminates between PostToolUse, Stop, SessionEnd, SubagentStop. One endpoint, fewer routes.
- **D-02:** FastAPI + uvicorn powers the endpoint — already in the project's dependency tree (Gateway uses it). Async-native, Pydantic validation built in.
- **D-03:** Strict Pydantic models for each event type. Reject malformed payloads with 422. Prevents crafted hook payloads from triggering unintended actions (Pitfall 5 mitigation).
- **D-04:** Unknown event_type values are accepted (200), logged at WARNING, and discarded. Claude Code may add new hook types in future — endpoint must not break on unknown types.
- **D-05:** Hook server runs in the same process as CLIRuntime as an asyncio task. Shares the event loop. Hook events can directly call CLIRuntime methods to emit lifecycle events.
- **D-06:** Hook endpoint runs ONLY when `config.runtime != "openai-api"`. API-based agents don't have CLI hooks.
- **D-07:** Bind to `127.0.0.1:8099` — localhost only, no auth token required. Network isolation is the auth boundary. Port 8099 is never exposed externally (no port mapping in docker-compose).

### Hook Config Injection
- **D-08:** Kubex Manager generates `.claude/settings.json` with hook config at spawn time and mounts it read-only into the container. Container process cannot modify it. Aligns with stem cell philosophy — Manager injects config, container just runs.
- **D-09:** ~~(SUPERSEDED by research)~~ Native `type: "http"` hooks in settings.json — Claude Code directly POSTs event JSON to `http://localhost:8099/hooks` without any shell script. No relay script needed. Eliminates the shell attack surface entirely (CVE-2025-59536 / CVE-2026-21852 fully mitigated — no shell commands in hook config at all).
- **D-10:** Subscribe to all four hook events: PostToolUse, Stop, SessionEnd, SubagentStop. Full visibility into Claude Code's lifecycle.

### Audit Trail Storage
- **D-11:** Dual storage: Redis sorted set (`audit:{task_id}`) for fast in-session queries + structured JSON to stdout for future Fluent Bit → OpenSearch pipeline. Redis is the hot cache, stdout is the durable trail.
- **D-12:** Redis audit data expires after 24 hours (TTL). Structured stdout logs provide the permanent trail once OpenSearch is deployed.
- **D-13:** Gateway exposes `GET /tasks/{task_id}/audit` — returns tool invocation trail from Redis. Command Center can query it. Follows Gateway-as-ingress pattern.
- **D-14:** Each audit entry captures: tool_name, timestamp, success/failure boolean. Minimal footprint — no tool input/output content stored (can be very large).

### Lifecycle Event Mapping
- **D-15:** Stop hook events emit `task_progress` on existing Redis pub/sub channel. Includes turn count, cost_usd if available. Orchestrator/Command Center already subscribe to progress events from Phase 9.
- **D-16:** SessionEnd is a metadata enrichment signal, NOT the completion trigger. Exit code path remains authoritative for task success/failure. SessionEnd adds metadata (total tokens, cost, session duration) to the task result if available.
- **D-17:** SubagentStop events are logged to audit trail only — not propagated as Redis events. Subagent internals are Claude Code's business; orchestrator only cares about top-level task result.
- **D-18:** All hook events are tagged with `task_id` correlation. The harness knows which task_id is active when events arrive. Essential for per-task audit queries (HOOK-04).

### Claude's Discretion
- Exact FastAPI app structure and route handler implementation
- Pydantic model field definitions (based on Claude Code's actual hook event schemas)
- uvicorn startup config (workers, log level, etc.)
- curl script exact syntax and error handling
- Manager settings.json generation implementation details
- Redis sorted set score strategy (timestamp-based)
- Structured log format for stdout audit events
- How metadata from SessionEnd is attached to task result (in-memory state vs Redis)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hook Security
- `.planning/research/PITFALLS.md` lines 101-117 — Pitfall 5: Hook Scripts as Prompt Injection Amplifier. CVE-2025-59536, CVE-2026-21852. Read-only mount mandatory, no string interpolation in hook scripts.

### CLIRuntime (extends this)
- `agents/_base/kubex_harness/cli_runtime.py` — Full CLIRuntime module. Hook server runs as asyncio task alongside `run()`. `_post_progress()` and `_publish_state()` are the existing event patterns to follow.
- `agents/_base/kubex_harness/main.py` lines 72-91 — CLI runtime routing. Hook server must start here or inside CLIRuntime.run().

### Manager Spawn (generates hook config)
- `services/kubex-manager/kubex_manager/lifecycle.py` — Container spawning, volume mounts. Add settings.json + hook script generation and read-only mount.

### Existing Event Infrastructure
- `libs/kubex-common/kubex_common/schemas/events.py` — ProgressUpdate and LifecycleEvent schemas. Reuse for hook-derived events.
- `services/gateway/gateway/main.py` — Gateway routes. Add `GET /tasks/{task_id}/audit` endpoint here.

### Logging Architecture (future integration)
- `docs/infrastructure.md` Section 9 — Central Logging with OpenSearch + Fluent Bit pipeline (not yet deployed). Structured JSON stdout from audit events will automatically flow into `logs-audit` index when Fluent Bit is deployed.

### Phase 9 Context (prior decisions)
- `.planning/phases/09-cli-runtime-claude-code/09-CONTEXT.md` — D-09 (stdout streaming), D-10 (time-batched chunks), D-12 (lifecycle state on Redis pub/sub). Phase 10 builds on all of these.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cli_runtime.py:CLIRuntime._post_progress()` — Progress chunk posting pattern. Hook events use the same Gateway endpoint.
- `cli_runtime.py:CLIRuntime._publish_state()` — Redis pub/sub lifecycle event publishing. Hook-derived events follow same pattern.
- `cli_runtime.py:CLIRuntime._task_loop()` — READY/BUSY state tracking. Provides the current `task_id` for hook event correlation (D-18).
- `main.py` lines 72-91 — CLI runtime startup block. Hook server asyncio task launches here or inside CLIRuntime.run().
- `libs/kubex-common/kubex_common/schemas/events.py` — ProgressUpdate(chunk_type, content, sequence) and LifecycleEvent schemas.

### Established Patterns
- FastAPI for HTTP endpoints (Gateway uses it everywhere)
- Pydantic models for request/response validation (all services)
- Redis sorted sets for time-series data (not yet used but Redis is in the stack)
- Gateway-as-ingress for all query endpoints
- Structured JSON logging to stdout (all services)
- Manager generates config at spawn time, mounts read-only (skills, config.yaml)

### Integration Points
- `cli_runtime.py:CLIRuntime.run()` — Start uvicorn hook server as asyncio.create_task() before entering task_loop
- `cli_runtime.py:CLIRuntime._execute_task()` — Set current task_id so hook events can correlate
- `services/kubex-manager/kubex_manager/lifecycle.py` — Generate settings.json + hook relay script, mount read-only
- `services/gateway/gateway/main.py` — Add GET /tasks/{task_id}/audit route
- `docker-compose.yml` — No port mapping for 8099 (localhost-only by design)

</code_context>

<specifics>
## Specific Ideas

- The hook relay script is a one-liner: `#!/bin/sh\ncurl -s -X POST -H 'Content-Type: application/json' -d @- http://localhost:8099/hooks` — reads JSON from stdin (piped by Claude Code), POSTs to harness endpoint. Static, no interpolation, mounted read-only.
- settings.json hook config format uses Claude Code's documented structure: `hooks: { PostToolUse: [{type: "command", command: "/app/hooks/relay.sh"}], ... }` for all four event types.
- The audit trail Gateway endpoint (`GET /tasks/{task_id}/audit`) returns a JSON array of `{tool_name, timestamp, success}` entries sorted by timestamp. Simple, queryable, no pagination needed for 24h-TTL data.
- FastAPI hook server can be a separate `hook_server.py` module that CLIRuntime imports and launches. Keeps the hook HTTP logic separate from the runtime lifecycle logic.

</specifics>

<deferred>
## Deferred Ideas

- **Gemini CLI hooks monitoring** — OBS-03 in REQUIREMENTS.md (Future). Same pattern (AfterTool, AfterAgent, SessionEnd) but different config format. Phase 11 or later.
- **Bidirectional MCP for Codex** — COLLAB-02. Codex CLI lacks hooks; uses MCP server fallback for monitoring parity. Phase 11.
- **OpenSearch deployment** — Infrastructure.md Section 9. Structured stdout logs from this phase will automatically flow to OpenSearch once Fluent Bit is deployed. Not this phase.
- **SSE streaming of hook events to Command Center** — OBS-01. Currently hook events land in Redis pub/sub; Command Center polls or subscribes. Real-time SSE is deferred.

</deferred>

---

*Phase: 10-hooks-monitoring*
*Context gathered: 2026-03-22*
