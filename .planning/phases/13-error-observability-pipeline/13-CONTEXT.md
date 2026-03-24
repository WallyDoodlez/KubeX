# Phase 13: Error Observability Pipeline - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Unified error detection, propagation, and UI-consumable reporting across Gateway/Broker/Agent boundaries. Pipeline failures become visible in the Command Center instead of silently hanging. Covers: dispatch-time capability validation, Broker task reaper, agent crash detection via heartbeat, structured error events on SSE streams, and a health/error API for the Command Center.

**Scope for this repo (backend only):** Build the Gateway/Broker/Registry/Harness changes. Write a handoff doc with error API contracts for the FE team. The Command Center UI for error visualization is handled by the FE team.

</domain>

<decisions>
## Implementation Decisions

### Dispatch-time capability validation
- **D-01:** Gateway checks Registry for a registered agent with the requested capability BEFORE publishing to Broker. If no agent is registered, return HTTP 404 immediately with `{"error": "NoAgentAvailable", "message": "No agent registered for capability '{cap}'", "capability": "{cap}", "registered_capabilities": [...]}`
- **D-02:** Registry check only — no container health ping at dispatch time. Rely on dead agent detection (heartbeat) and Broker reaper as safety nets for zombie registrations
- **D-03:** New dispatches only — no retroactive TTL on already-queued tasks. The Broker reaper (activated in this phase) handles old unclaimed messages via `handle_pending()`

### Error event model
- **D-04:** Use existing per-task SSE stream (`GET /tasks/{task_id}/stream`) with properly typed events. Wire the existing `ProgressEventType` enum from `kubex_common.schemas.events` into all publishers (Gateway, Broker, harness code). Stop emitting raw dicts
- **D-05:** Add two new event types to `ProgressEventType`: `EXPIRED` (task TTL exceeded, no agent claimed it) and `ERROR` (infrastructure failure — Redis down, Broker unreachable)
- **D-06:** Expose structured failure reasons from agents (`auth_expired`, `cli_crash`, `subscription_limit`, `runtime_not_available`) in the FAILED event payload so the UI can show actionable messages like "Agent authentication expired" instead of generic "Task failed"
- **D-07:** Wire existing dead-code schemas (`ProgressUpdate`, `SSEEvent`, `LifecycleEvent`) from `kubex_common.schemas.events` into actual runtime code. Extend with new fields (`failure_reason`, `request_id`) rather than building fresh schemas

### Dead agent detection
- **D-08:** Agent heartbeat: agents re-register with Registry every 30 seconds. Registry sets a TTL on each registration. After 3 missed heartbeats (90s of silence), the agent is marked `UNKNOWN` and evicted from capability routing
- **D-09:** When an agent is declared dead: publish a FAILED event to the SSE stream for any in-flight task, then requeue the task to Broker for another agent to pick up
- **D-10:** Max 1 requeue per task. If the requeued task fails again (second agent also crashes), send it to DLQ with a FAILED event. Prevents poison-pill tasks from killing agents in a loop
- **D-11:** Activate the existing `handle_pending()` method in Broker as a periodic reaper (it's currently dead code). Runs on an interval, catches unclaimed/unacknowledged messages, promotes to DLQ after max retries

### Health/error API for UI
- **D-12:** Upgrade `/health` endpoint to report per-dependency status: Redis connectivity, Broker reachability, Registry reachability. Return HTTP 503 with `"status": "unhealthy"` when any critical dependency is down, HTTP 200 with `"status": "healthy"` or `"status": "degraded"` otherwise
- **D-13:** New `GET /errors?type=dispatch_reject,task_expired,agent_dead&since=10m&limit=50` endpoint. Returns `[{type, timestamp, details, task_id?, agent_id?, capability?}]`. FE can filter by error type, time window, and paginate
- **D-14:** Error events stored in a Redis stream with 24h TTL. Survives service restarts. Consistent with existing Redis stream usage for audit

### Claude's Discretion
- Heartbeat implementation mechanism (HTTP re-register vs Redis key with TTL vs pub/sub keepalive)
- Reaper interval for `handle_pending()` (10s? 30s? 60s?)
- Exact degraded vs unhealthy threshold (which deps are critical vs non-critical)
- Error stream Redis key naming and structure
- `request_id` generation strategy (UUID? trace-id? propagated from client?)
- Whether to populate `request_id` on all existing ErrorResponse paths or only new ones

</decisions>

<specifics>
## Specific Ideas

- Triggered by BUG-003: Command Center dispatched to capability `orchestrate` but orchestrator listens on `task_orchestration` — task hung forever with no feedback
- "We need a way to allow errors to be consumed by the UI to visualize the problem in the plumbing"
- The existing `kubex_common.schemas.events` module has well-designed schemas that nobody uses — wire them in rather than rebuilding
- `handle_pending()` in Broker is fully implemented and tested but never called — activate it as the reaper
- StandaloneAgent always stores `status: "completed"` even when the LLM fails — fix this to store `status: "failed"` with the error

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Error schemas (existing, unused — wire these in)
- `libs/kubex-common/src/kubex_common/schemas/events.py` — `ProgressEventType`, `ProgressUpdate`, `SSEEvent`, `LifecycleEvent`, `ControlMessage` (all currently dead code)
- `libs/kubex-common/src/kubex_common/errors.py` — `ErrorResponse` schema, `KubexError` subclasses (many unused)

### Gateway error handling
- `services/gateway/gateway/main.py` — All error response paths, SSE progress stream (`stream_task_progress`), SSE lifecycle stream (`stream_agent_lifecycle`), health endpoint

### Broker task lifecycle
- `services/broker/broker/streams.py` — `handle_pending()` (dead code reaper), `RETRY_AFTER_MS`, `MAX_RETRIES`, DLQ stream (`boundary:dlq`), result TTL
- `services/broker/broker/main.py` — Message publish/consume endpoints

### Agent failure reporting
- `agents/_base/kubex_harness/cli_runtime.py` §58-65 — `FAILURE_PATTERNS` dict (auth_expired, cli_crash, etc.)
- `agents/_base/kubex_harness/cli_runtime.py` §822-842 — `_publish_state()` lifecycle events
- `agents/_base/kubex_harness/harness.py` — `ExitReason` enum, result posting, bare `except: pass` on failures
- `agents/_base/kubex_harness/standalone.py` — `_store_result()` always writes `status: "completed"`

### Registry
- `services/registry/registry/store.py` — `AgentStatus` enum, `resolve_capability()`, no heartbeat/TTL logic currently

### Health endpoint
- `libs/kubex-common/src/kubex_common/service/health.py` — Hardcoded `"status": "healthy"`, Redis-only check

### Command Center error handling (FE reference)
- `command-center/src/lib/api.ts` — `doFetch` wrapper, 8s timeout, error shape
- `command-center/src/components/OrchestratorChat.tsx` — SSE message handling, expects `type: "failed"/"result"/"cancelled"`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **ProgressEventType enum**: DISPATCHED, ACCEPTED, PROGRESS, COMPLETE, FAILED, NEEDS_CLARIFICATION, CANCELLED — add EXPIRED and ERROR
- **ProgressUpdate schema**: Has `exit_reason`, `final`, `chunk_type` fields — extend with `failure_reason`
- **ErrorResponse schema**: Has `error`, `message`, `details`, `request_id` — wire `request_id` population
- **KubexError subclasses**: `CapabilityNotFoundError` exists but is never used for dispatch validation — wire it in
- **handle_pending()**: Fully implemented DLQ/retry logic in Broker — just needs to be called on an interval
- **FAILURE_PATTERNS**: CLIRuntime already classifies failures — just need to propagate the classification to the result store

### Established Patterns
- Redis pub/sub for per-task progress (`progress:{task_id}` on DB 1)
- Redis pub/sub for lifecycle events (`lifecycle:{agent_id}` on DB 0)
- Redis streams for audit trail (`audit:messages` on DB 0)
- Gateway SSE using `sse_starlette.sse.EventSourceResponse`
- FastAPI dependency injection for auth (`verify_token`)

### Integration Points
- Gateway `/actions` handler → add Registry capability check before Broker publish
- Broker `handle_pending()` → activate as periodic background task
- Registry store → add TTL-based registration with heartbeat refresh
- All harness types → switch from raw dict posting to `ProgressUpdate` schema
- CLIRuntime `_publish_state` → propagate `failure_reason` to result store
- StandaloneAgent `_store_result` → fix to use `"status": "failed"` on LLM errors
- Health endpoint → add Broker/Registry reachability checks, return 503 on failure

</code_context>

<deferred>
## Deferred Ideas

- System-wide SSE error stream (GET /errors/stream) for real-time dashboard push — per-task SSE covers this phase; system stream is a future dashboard enhancement
- Error aggregation/summary endpoint (GET /errors/summary with counts by type) — useful for dashboards, not needed for initial error visibility
- DLQ inspector UI in Command Center — FE team can build this from the /errors API
- Alert/notification system for critical errors (Slack webhook, email) — separate concern
- Distributed tracing with request_id propagation across all services — this phase populates request_id on new error paths; full propagation is a future phase

</deferred>

---

*Phase: 13-error-observability-pipeline*
*Context gathered: 2026-03-24*
