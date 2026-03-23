# Phase 12: OAuth Command Center Web Flow - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can provision CLI agent OAuth tokens through the Command Center web UI without docker exec, and tasks dispatched to CLI agents are pre-flight checked for token expiry.

**Scope for this repo (backend only):** Build the Gateway/Manager APIs and fix credential path inconsistencies so the FE team has clean endpoints to call. Write a handoff doc with API contracts, payloads, sequence diagrams, and edge cases. The Command Center frontend is handled by a separate team/repo.

</domain>

<decisions>
## Implementation Decisions

### Lifecycle event streaming
- **D-01:** Add Gateway SSE endpoint `GET /agents/{agent_id}/lifecycle` that subscribes to Redis pub/sub channel `lifecycle:{agent_id}` and streams state transitions as Server-Sent Events
- **D-02:** Event format: `data: {"agent_id": "...", "state": "credential_wait", "timestamp": "..."}` — same payload already published by cli_runtime.py `_publish_state()`
- **D-03:** FE team just opens an EventSource to this endpoint — no Redis knowledge needed on their side
- **D-04:** Endpoint requires Bearer token auth (same `verify_token` as other Gateway endpoints)

### Credential injection path fix
- **D-05:** Manager credential injection endpoint (`POST /kubexes/{id}/credentials`, main.py:541-555) has its own hardcoded `cred_paths` dict with wrong gemini path (`/root/.config/gemini/credentials.json`). Must unify with `CREDENTIAL_PATHS` from cli_runtime.py
- **D-06:** Single source of truth: import `CREDENTIAL_PATHS` from `kubex_harness.cli_runtime` into Manager, or duplicate the corrected dict. Preference: duplicate (Manager shouldn't depend on agent package at import time), but keep values identical
- **D-07:** Corrected paths: `claude-code` → `/root/.claude/.credentials.json`, `gemini-cli` → `/root/.gemini/oauth_creds.json`

### Token expiry detection
- **D-08:** Keep file-existence check only (current behavior). No timestamp parsing from token JSON
- **D-09:** Rationale: token expiry is rare (hours between), re-gate loop already works, one wasted task attempt per expiry is a non-issue. Avoids per-runtime JSON format parsers

### FE handoff document
- **D-10:** Write `docs/HANDOFF-phase12-oauth-fe.md` with: full API contracts (request/response schemas), example curl commands, Mermaid sequence diagram of the full OAuth provisioning flow, edge cases (token expiry mid-session, container restart, multiple agents), error codes and how to handle them
- **D-11:** Handoff doc should be self-contained — FE team builds the UI without reading backend source code
- **D-12:** Include which Gateway/Manager endpoints are new vs existing, so FE team knows what's already callable

### Claude's Discretion
- SSE heartbeat interval and connection timeout
- Error response format for lifecycle endpoint
- Handoff doc structure and level of detail beyond the minimum

</decisions>

<specifics>
## Specific Ideas

- "Make this easy for the FE" — backend does the heavy lifting, FE gets clean APIs
- Existing `POST /kubexes/{id}/credentials` endpoint already works — just needs path fix
- Existing lifecycle pub/sub already works — just needs Gateway SSE bridge

</specifics>

<canonical_refs>
## Canonical References

### OAuth runtime design
- `docs/design-oauth-runtime.md` — Original OAuth runtime design decisions, flow diagrams, credential lifecycle

### Existing credential flow
- `agents/_base/kubex_harness/cli_runtime.py` §52-55 — `CREDENTIAL_PATHS` dict (source of truth for credential file paths)
- `agents/_base/kubex_harness/cli_runtime.py` §313-415 — `_credential_gate()`, `_credentials_present()`, `_wait_for_credentials()`
- `agents/_base/kubex_harness/cli_runtime.py` §466-532 — Per-task preflight credential check
- `agents/_base/kubex_harness/cli_runtime.py` §822-842 — `_publish_state()` lifecycle pub/sub

### Manager credential injection
- `services/kubex-manager/kubex_manager/main.py` §509-603 — `POST /kubexes/{id}/credentials` endpoint (needs path fix)
- `services/kubex-manager/kubex_manager/lifecycle.py` §74-78 — `CLI_CREDENTIAL_MOUNTS` volume creation

### Gateway
- `services/gateway/gateway/main.py` — Existing routes, auth pattern, SSE pattern (task progress streaming at §729-769 is a reference for new lifecycle SSE)

### Existing handoff doc
- `docs/HANDOFF-oauth-command-center.md` — Earlier handoff doc (may need updating or replacing)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **SSE pattern:** Gateway already has `stream_task_progress` (main.py §729-769) — same pattern for lifecycle SSE
- **Redis pub/sub:** cli_runtime.py already publishes to `lifecycle:{agent_id}` channel — Gateway just subscribes and forwards
- **Auth middleware:** `verify_token` dependency already used on all Manager/Gateway endpoints
- **Credential injection:** `POST /kubexes/{id}/credentials` already implemented — just needs path correction

### Established Patterns
- Gateway SSE uses `sse_starlette.sse.EventSourceResponse`
- Redis subscriptions use `aioredis` pub/sub with `subscribe()` and `listen()`
- All endpoints follow FastAPI dependency injection for auth

### Integration Points
- New Gateway SSE endpoint → subscribes to Redis `lifecycle:{agent_id}` pub/sub
- Manager credential endpoint → corrected `cred_paths` dict matching cli_runtime.py `CREDENTIAL_PATHS`
- FE team → calls Gateway SSE + Manager credential injection (documented in handoff)

</code_context>

<deferred>
## Deferred Ideas

- Timestamp-based token expiry parsing (proactive re-gate before task attempt) — decided against for simplicity
- OAuth scope negotiation per CLI runtime — not needed yet, generic tokens work
- Token refresh automation (backend auto-refreshes before expiry) — future enhancement
- Multi-user token isolation — out of scope, single-operator system for now

</deferred>

---

*Phase: 12-oauth-command-center-web-flow*
*Context gathered: 2026-03-23*
