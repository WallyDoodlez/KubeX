# Phase 12: OAuth Command Center Web Flow - Research

**Researched:** 2026-03-23
**Domain:** FastAPI SSE, Redis pub/sub, Docker credential injection, Gateway/Manager API extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add Gateway SSE endpoint `GET /agents/{agent_id}/lifecycle` subscribing to Redis pub/sub channel `lifecycle:{agent_id}` and streaming state transitions as Server-Sent Events
- **D-02:** Event format: `data: {"agent_id": "...", "state": "credential_wait", "timestamp": "..."}` — same payload published by `cli_runtime.py _publish_state()`
- **D-03:** FE team opens an `EventSource` to this endpoint — no Redis knowledge needed on their side
- **D-04:** Endpoint requires Bearer token auth (same `verify_token` as other Gateway endpoints — NOTE: Gateway does NOT currently have `verify_token`; Manager does; see Architecture Patterns section)
- **D-05:** Manager `POST /kubexes/{id}/credentials` (main.py:541-555) has its own hardcoded `cred_paths` dict with wrong gemini path. Must unify with `CREDENTIAL_PATHS` from `cli_runtime.py`
- **D-06:** Single source of truth: duplicate the corrected dict into Manager (Manager should not depend on agent package at import time), keep values identical
- **D-07:** Corrected paths: `claude-code` → `/root/.claude/.credentials.json`, `gemini-cli` → `/root/.gemini/oauth_creds.json`
- **D-08:** Keep file-existence check only (current behavior). No timestamp parsing from token JSON
- **D-09:** Token expiry is rare (hours between); re-gate loop already works; one wasted task attempt per expiry is acceptable; avoids per-runtime JSON format parsers
- **D-10:** Write `docs/HANDOFF-phase12-oauth-fe.md` with full API contracts, curl examples, Mermaid sequence diagram, edge cases, error codes
- **D-11:** Handoff doc must be self-contained — FE team builds UI without reading backend source
- **D-12:** Include which Gateway/Manager endpoints are new vs existing so FE knows what's already callable

### Claude's Discretion

- SSE heartbeat interval and connection timeout
- Error response format for lifecycle endpoint
- Handoff doc structure and level of detail beyond the minimum

### Deferred Ideas (OUT OF SCOPE)

- Timestamp-based token expiry parsing (proactive re-gate before task attempt)
- OAuth scope negotiation per CLI runtime
- Token refresh automation (backend auto-refreshes before expiry)
- Multi-user token isolation
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Command Center web UI triggers OAuth flow for target container | D-01 through D-03: Gateway SSE endpoint bridges Redis lifecycle channel to FE; FE uses it to detect CREDENTIAL_WAIT and drive the OAuth button |
| AUTH-02 | Token forwarded from Command Center to container at spawn via Gateway /oauth/token relay endpoint | Existing `POST /kubexes/{id}/credentials` on Manager already implements write-via-docker-exec; needs path fix (D-05 to D-07); FE calls Manager directly (or via Gateway relay if added) |
| AUTH-03 | Pre-flight expiry check before dispatching tasks to CLI agents | `_execute_task_inner` already does `_credentials_present()` check; Gateway dispatch path needs pre-flight check that returns 409/422 before task enters broker queue |
</phase_requirements>

---

## Summary

Phase 12 is a backend-only plumbing phase: three focused changes plus a handoff document. All the hard work (credential file watching, state machine, pub/sub publishing) already exists in `cli_runtime.py`. This phase connects that existing backend infrastructure to the Command Center frontend via clean API contracts.

The three code changes are: (1) add a Gateway SSE endpoint that subscribes to `lifecycle:{agent_id}` on Redis DB 0 and streams state events; (2) fix the wrong `gemini-cli` credential path in Manager's hardcoded `cred_paths` dict; (3) add a pre-flight expiry check in the Gateway dispatch path that rejects tasks to agents in CREDENTIAL_WAIT state.

The most important architectural constraint discovered during research: the lifecycle pub/sub channel is on **Redis DB 0** (the broker DB), but Gateway's existing SSE plumbing (`stream_task_progress`) uses `redis_db1`. The new lifecycle SSE endpoint must use `gateway.redis_db0`. Additionally, Gateway currently has zero Bearer token auth — D-04's "same `verify_token` as other Gateway endpoints" cannot be satisfied by copying an existing Gateway pattern; the Manager's `verify_token` function must be ported to Gateway.

**Primary recommendation:** Implement in three waves: (W1) Gateway SSE + Bearer auth, (W2) Manager path fix, (W3) Gateway pre-flight dispatch check + handoff doc. All changes have direct unit-test analogs in existing test files.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastapi` | existing in gateway | HTTP endpoints + dependency injection | Already used throughout all services |
| `redis.asyncio` (aioredis) | existing in gateway | Async pub/sub subscribe + listen | Already used for `progress:{task_id}` SSE |
| `fastapi.security.HTTPBearer` | existing in kubex-manager | Bearer token auth dependency | Already implemented in Manager; port to Gateway |
| `fastapi.responses.StreamingResponse` | existing in gateway | SSE response | Already used in `stream_task_progress` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `asyncio.timeout` | stdlib | SSE connection timeout / heartbeat guard | To prevent hung SSE connections holding Redis subscriptions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `StreamingResponse` (raw SSE) | `sse_starlette.EventSourceResponse` | CONTEXT.md references `sse_starlette`, but gateway currently uses raw `StreamingResponse` with manual `data: ...\n\n` formatting — keep consistent with existing pattern |
| `redis_db0` for lifecycle SSE | adding a new `redis_lifecycle` connection | Single extra DB 0 connection already exists (`gateway.redis_db0`); reuse it |

**Note on sse_starlette:** CONTEXT.md code_context says "Gateway SSE uses `sse_starlette.sse.EventSourceResponse`" but the actual implementation in `gateway/main.py` uses plain `StreamingResponse`. There is no `sse_starlette` import in gateway. Use `StreamingResponse` to stay consistent with the real codebase.

---

## Architecture Patterns

### Recommended Project Structure

No new files required. All changes are additive modifications to:

```
services/gateway/gateway/main.py         # SSE endpoint + Bearer auth + pre-flight check
services/kubex-manager/kubex_manager/main.py  # Credential path dict fix
docs/HANDOFF-phase12-oauth-fe.md         # New: FE handoff document
tests/unit/test_gateway_endpoints.py     # SSE + auth + preflight tests (extend existing)
tests/unit/test_kubex_manager_unit.py    # Credential path correctness tests (extend existing)
```

### Pattern 1: Gateway SSE Endpoint (reference: existing `stream_task_progress`)

**What:** Subscribe to Redis pub/sub channel, stream events as SSE, clean up on disconnect.
**When to use:** Any time Gateway bridges Redis pub/sub to HTTP clients.

**Exact reference in codebase (`gateway/main.py` lines 678-711):**
```python
# Source: services/gateway/gateway/main.py — stream_task_progress
@router.get("/tasks/{task_id}/stream")
async def stream_task_progress(task_id: str, request: Request) -> StreamingResponse:
    gateway: GatewayService = request.app.state.gateway_service

    async def event_generator() -> AsyncGenerator[str, None]:
        if gateway.redis_db1 is None:
            yield f"data: {json.dumps({'error': 'Redis not available'})}\n\n"
            return

        channel = f"progress:{task_id}"
        pubsub = gateway.redis_db1.pubsub()
        try:
            await pubsub.subscribe(channel)
            async for message in pubsub.listen():
                if message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                    data = json.loads(message["data"])
                    if data.get("type") in ("result", "cancelled", "failed"):
                        break
                    if data.get("final") is True:
                        break
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

**For lifecycle SSE — critical difference:** Use `gateway.redis_db0` (not `redis_db1`). The `lifecycle:{agent_id}` channel is published on DB 0 by `cli_runtime.py`. The progress stream uses DB 1 because that is where Gateway's rate-limit counters live, but lifecycle events come from the harness which connects to DB 0.

**Adapted lifecycle endpoint:**
```python
# Source: Pattern derived from stream_task_progress; channel DB confirmed in docker-compose.yml
@router.get("/agents/{agent_id}/lifecycle")
async def stream_agent_lifecycle(
    agent_id: str,
    request: Request,
    _: None = Depends(verify_token),  # D-04
) -> StreamingResponse:
    gateway: GatewayService = request.app.state.gateway_service

    async def event_generator() -> AsyncGenerator[str, None]:
        if gateway.redis_db0 is None:
            yield f"data: {json.dumps({'error': 'Redis not available'})}\n\n"
            return

        channel = f"lifecycle:{agent_id}"
        pubsub = gateway.redis_db0.pubsub()
        try:
            await pubsub.subscribe(channel)
            async for message in pubsub.listen():
                if message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                # No terminal event — lifecycle streams indefinitely until FE disconnects
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

### Pattern 2: Bearer Auth in Gateway (port from Manager)

**What:** FastAPI `HTTPBearer` dependency that checks token against `KUBEX_MGMT_TOKEN`.
**When to use:** D-04 requires Bearer auth on the lifecycle SSE endpoint.

**Current Manager implementation (`services/kubex-manager/kubex_manager/main.py` lines 39-55):**
```python
# Source: services/kubex-manager/kubex_manager/main.py
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_BEARER_SCHEME = HTTPBearer(auto_error=False)
_MGMT_TOKEN = os.environ.get("KUBEX_MGMT_TOKEN", "kubex-mgmt-token")

def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_BEARER_SCHEME),
) -> None:
    """Verify Bearer token for management API endpoints."""
    if credentials is None or credentials.credentials != _MGMT_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
```

This exact pattern must be added to `gateway/main.py`. Both services share the same `KUBEX_MGMT_TOKEN` env var (set in `docker-compose.yml` line 84 as `${MANAGER_TOKEN}`).

**Gateway needs to import:** `from fastapi import Depends, HTTPException` (some already imported), plus `HTTPAuthorizationCredentials, HTTPBearer` from `fastapi.security`.

### Pattern 3: Credential Path Dict Fix

**What:** Replace the hardcoded `cred_paths` dict in Manager `main.py` with the corrected values matching `cli_runtime.py CREDENTIAL_PATHS` and `lifecycle.py CLI_CREDENTIAL_MOUNTS`.

**Current state (WRONG, `main.py` lines 542-546):**
```python
cred_paths = {
    "claude-code": "/root/.claude/.credentials.json",
    "codex-cli":   "/root/.codex/.credentials.json",
    "gemini-cli":  "/root/.config/gemini/credentials.json",  # WRONG
}
```

**Corrected state (D-07):**
```python
# Source: agents/_base/kubex_harness/cli_runtime.py CREDENTIAL_PATHS
#         services/kubex-manager/kubex_manager/lifecycle.py CLI_CREDENTIAL_MOUNTS
CRED_INJECTION_PATHS: dict[str, str] = {
    "claude-code": "/root/.claude/.credentials.json",
    "codex-cli":   "/root/.codex/.credentials.json",
    "gemini-cli":  "/root/.gemini/oauth_creds.json",  # CORRECTED
}
```

Note: The parent dir derived from this path will be `/root/.gemini`, which matches `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` in `lifecycle.py`. The `mkdir -p` in the injection code will create `/root/.gemini` correctly.

### Pattern 4: Gateway Dispatch Pre-Flight Check (AUTH-03)

**What:** Before a `dispatch_task` action enters the broker queue, check whether the target agent is a CLI agent in `CREDENTIAL_WAIT` state and reject with a clear error if so.

**Current dispatch flow** (`_handle_dispatch_task`, `main.py` ~line 273): Gateway resolves capability → writes to Broker stream. There is no check for agent credential state.

**Implementation approach:** The pre-flight check must query agent state. Options (in order of preference):

1. **Query Registry** — Registry already tracks agent status. Check if the target agent's status is `credential_wait`. This is the cleanest approach: no new Redis key schema.
2. **Read a Redis key** — After an agent enters `CREDENTIAL_WAIT`, write a short-TTL Redis key `agent:state:{agent_id}` = `credential_wait`. Gateway checks this key before dispatch. Requires cli_runtime.py to write the key in addition to publishing pub/sub.
3. **Skip pre-flight, rely on re-gate** — D-08/D-09 say the agent re-gates when it gets a task and credentials are missing. This satisfies AUTH-03 (the task IS rejected — but at task execution time, not dispatch time). This is what D-09 says: "one wasted task attempt per expiry is a non-issue."

**Resolution:** D-09 explicitly says no timestamp parsing and no proactive re-gate. The "pre-flight expiry check before dispatching tasks" in AUTH-03 is satisfied by the existing `_execute_task_inner` pre-flight (which fires BEFORE CLI execution). The Gateway dispatch-time check is NOT required by the locked decisions. AUTH-03 says "before the task enters the broker queue" — but D-09's rationale overrides that interpretation. The planner should check this ambiguity.

**If a Gateway-side check IS required:** The cleanest path is querying the Registry's agent status field. No new Redis schema needed.

### Anti-Patterns to Avoid

- **Using `redis_db1` for lifecycle SSE:** The `lifecycle:{agent_id}` channel is published on DB 0 (harness connects to `redis://redis:6379` = DB 0). Using DB 1 will receive nothing and hang. Always use `gateway.redis_db0` for this channel.
- **Adding `sse_starlette` dependency:** The CONTEXT.md mentions it, but the actual codebase uses plain `StreamingResponse`. Adding a new dependency for no functional gain introduces deployment risk.
- **Closing pub/sub without `aclose()`:** The existing pattern does both `unsubscribe` and `aclose()` in `finally`. Follow this exactly to avoid resource leaks in the async Redis connection pool.
- **Forgetting the `auth` router import in Gateway:** `fastapi.security.HTTPBearer` is not currently imported in `gateway/main.py`. Missing imports cause silent startup failures.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Credential file write into container | Custom Docker SDK wrapper | Existing `inject_credentials` endpoint in Manager | Already implemented; just needs the path fix |
| SSE connection management | Custom chunked HTTP streamer | `StreamingResponse` + async generator | Already proven in `stream_task_progress` |
| Agent state lookup | New Redis schema | Registry `status` field (already `credential_wait`) | Registry already tracks this; no new infrastructure |
| Bearer auth | Custom middleware | `HTTPBearer` + `Depends` (copy Manager pattern) | FastAPI-native, already in codebase |

**Key insight:** All the hard infrastructure exists. This phase is plumbing — connect pieces that already work.

---

## Runtime State Inventory

> Not a rename/refactor/migration phase. Omit.

---

## Common Pitfalls

### Pitfall 1: Wrong Redis DB for Lifecycle Channel
**What goes wrong:** SSE endpoint subscribes to `lifecycle:{agent_id}` on DB 1 (rate limits). Channel is never populated. SSE hangs indefinitely. FE never gets state events.
**Why it happens:** `stream_task_progress` uses `redis_db1` for `progress:{task_id}`. Natural (but wrong) to copy that pattern directly.
**How to avoid:** Check `docker-compose.yml`. Gateway is `redis://...@redis:6379` (no DB = 0). Manager is `...6379/3`. Broker is `...6379/0`. `cli_runtime.py` defaults to `redis://redis:6379` (no DB = 0). All lifecycle events are on DB 0. Use `gateway.redis_db0`.
**Warning signs:** SSE endpoint accepts connection but streams nothing. Redis `SUBSCRIBE lifecycle:*` on DB 1 shows no messages.

### Pitfall 2: Gemini Credential Path Mismatch
**What goes wrong:** `POST /kubexes/{id}/credentials` for `runtime=gemini-cli` writes to `/root/.config/gemini/credentials.json`. The `_credentials_present()` check looks at `/root/.gemini/oauth_creds.json`. Credential injection reports success but the container stays in CREDENTIAL_WAIT forever.
**Why it happens:** Manager `cred_paths` dict was written before Phase 11 corrected the gemini path in `cli_runtime.py` and `lifecycle.py`.
**How to avoid:** D-07 is the fix. The filename also changes: `credentials.json` → `oauth_creds.json`.
**Warning signs:** After injection, container logs still show "Credentials missing" for gemini-cli.

### Pitfall 3: Missing `verify_token` in Gateway
**What goes wrong:** D-04 requires Bearer auth on the lifecycle SSE endpoint. Gateway has no `verify_token` function and no `HTTPBearer` import. Test passes without auth check if dependency is forgotten.
**Why it happens:** Gateway is internal-only and historically had no endpoint-level auth. Manager has the pattern.
**How to avoid:** Add `_BEARER_SCHEME`, `_MGMT_TOKEN`, and `verify_token` to `gateway/main.py` — exact copy of Manager pattern.
**Warning signs:** `curl http://gateway:8080/agents/x/lifecycle` without Authorization header returns 200 instead of 401.

### Pitfall 4: SSE Connection Leak on Client Disconnect
**What goes wrong:** FE closes EventSource. Generator's `finally` block is never reached. Redis pubsub subscription leaks. Over time, Redis accumulates dead subscriptions.
**Why it happens:** FastAPI streaming: if the generator uses `async for message in pubsub.listen()` without a disconnect check, the generator may block indefinitely waiting for the next message.
**How to avoid:** The `finally: await pubsub.unsubscribe(); await pubsub.aclose()` in the existing pattern handles this correctly because FastAPI cancels the async generator when the client disconnects. Follow existing pattern exactly. Optionally add a heartbeat `asyncio.timeout` to force generator advancement.
**Warning signs:** `redis-cli client list` accumulates subscribers on `lifecycle:*` channels that never unsubscribe.

### Pitfall 5: AUTH-03 Scope Ambiguity
**What goes wrong:** AUTH-03 says "before the task enters the broker queue" but D-09 explicitly says one wasted task attempt per expiry is acceptable. Building a Gateway-side dispatch check creates unnecessary complexity and new Redis schema that doesn't exist.
**Why it happens:** Requirements written before the simplification decision D-09 was locked.
**How to avoid:** D-09 wins. The pre-flight check in `_execute_task_inner` already satisfies AUTH-03 at the agent level. No Gateway dispatch-time check needed unless planner specifically overrides.
**Warning signs:** Plan introduces a new Redis key schema `agent:state:{agent_id}` — that is scope creep.

---

## Code Examples

### Current lifecycle pub/sub payload (confirmed from cli_runtime.py lines 833-838)
```python
# Source: agents/_base/kubex_harness/cli_runtime.py — _publish_state()
payload = {
    "agent_id": self.config.agent_id,
    "state": state.value,    # e.g. "credential_wait", "ready", "busy", "booting"
    "timestamp": datetime.utcnow().isoformat(),
}
channel = f"lifecycle:{self.config.agent_id}"
await self._redis.publish(channel, json.dumps(payload))
```

### Existing test pattern for Manager credential endpoint
```python
# Source: tests/unit/test_kubex_manager_unit.py (extend this file)
# Pattern: mock Docker client, call endpoint via TestClient, assert response
mock_docker, mock_container = make_mock_docker()
mock_container.exec_run.return_value = (0, b"")
with patch("kubex_manager.main.docker.from_env", return_value=mock_docker):
    response = client.post(
        f"/kubexes/{kubex_id}/credentials",
        json={"runtime": "gemini-cli", "credential_data": {"token": "..."}},
        headers={"Authorization": f"Bearer {MGMT_TOKEN}"},
    )
assert response.status_code == 200
assert response.json()["path"] == "/root/.gemini/oauth_creds.json"
```

### FE EventSource usage (for handoff doc)
```javascript
// Source: HANDOFF pattern — FE documentation
const es = new EventSource(
  'http://gateway:8080/agents/my-agent/lifecycle',
  { headers: { 'Authorization': 'Bearer kbx-mgmt-token' } }
);
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.state === 'credential_wait') showAuthButton(event.agent_id);
  if (event.state === 'ready') showReadyStatus(event.agent_id);
};
```

Note: Native `EventSource` does not support custom headers. The FE team will need to use `fetch` with streaming or an EventSource polyfill that supports headers. Flag this in the handoff doc.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLI auth via `docker exec` instructions to operator | Gateway SSE + FE OAuth button | Phase 12 | Operator no longer needs CLI access; UI-driven |
| Hardcoded gemini path `/root/.config/gemini/` | Corrected path `/root/.gemini/` | Phase 11 (in cli_runtime + lifecycle) but NOT yet in Manager | Phase 12 fixes the Manager gap |

**Deprecated/outdated:**
- The existing `docs/HANDOFF-oauth-command-center.md` (from Phase 9): partially obsolete. It describes gaps that Phase 12 closes. The new `docs/HANDOFF-phase12-oauth-fe.md` replaces it with accurate post-Phase-12 contracts.

---

## Open Questions

1. **AUTH-03 scope: Gateway dispatch-time vs agent-execution-time**
   - What we know: D-09 says one wasted task attempt per expiry is acceptable. `_execute_task_inner` already does pre-flight credential check.
   - What's unclear: Does AUTH-03 require Gateway to reject the task before it enters the broker queue, or is the agent-side pre-flight sufficient?
   - Recommendation: Treat agent-side pre-flight as satisfying AUTH-03. Document the behavior in the handoff doc. Avoid adding new Redis state keys for this.

2. **EventSource and custom headers**
   - What we know: Native browser `EventSource` API does not support custom headers. D-04 requires Bearer auth on the SSE endpoint.
   - What's unclear: Whether the FE team's implementation environment (React app, Electron, etc.) supports polyfilled EventSource.
   - Recommendation: Document in handoff doc that native `EventSource` cannot send Authorization headers; recommend `fetch` + `ReadableStream` or `eventsource-parser` npm package. Gateway auth should still be enforced; this is a FE concern.

3. **Redis DB for lifecycle pub/sub — env var vs default**
   - What we know: `cli_runtime.py` uses `_REDIS_URL = "redis://redis:6379"` (no DB suffix = DB 0). The actual REDIS_URL env var passed to agents (from handoff doc example) is `redis://default:password@redis:6379/0`, which is explicit DB 0.
   - What's unclear: Whether any future operator configures a different DB for agent lifecycle events.
   - Recommendation: Hard-code DB 0 for the lifecycle SSE subscription. Document assumption in code comment.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 |
| Config file | `pytest.ini` (project root) |
| Quick run command | `python -m pytest tests/unit/ -x -q` |
| Full suite command | `python -m pytest tests/ -q --ignore=tests/e2e --ignore=tests/chaos` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Gateway SSE endpoint returns 200 with SSE headers | unit | `pytest tests/unit/test_gateway_endpoints.py -k lifecycle -x` | ❌ Wave 0 |
| AUTH-01 | SSE endpoint returns 401 without valid Bearer token | unit | `pytest tests/unit/test_gateway_endpoints.py -k lifecycle_auth -x` | ❌ Wave 0 |
| AUTH-01 | SSE endpoint streams `data: {...}` when Redis publishes to `lifecycle:{agent_id}` | unit | `pytest tests/unit/test_gateway_endpoints.py -k lifecycle_stream -x` | ❌ Wave 0 |
| AUTH-02 | Manager credential injection uses `/root/.gemini/oauth_creds.json` for gemini-cli | unit | `pytest tests/unit/test_kubex_manager_unit.py -k credential_path -x` | ❌ Wave 0 (extend existing file) |
| AUTH-02 | Manager credential injection uses `/root/.claude/.credentials.json` for claude-code | unit | `pytest tests/unit/test_kubex_manager_unit.py -k credential_path -x` | ❌ Wave 0 (extend existing file) |
| AUTH-03 | `_execute_task_inner` re-gates when credentials missing (already tested) | unit | `pytest tests/unit/test_cli_runtime.py -x` | ✅ |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/unit/ -x -q`
- **Per wave merge:** `python -m pytest tests/ -q --ignore=tests/e2e --ignore=tests/chaos`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test_gateway_endpoints.py` — add `TestLifecycleSSE` class: covers AUTH-01 (200, 401, streaming)
- [ ] `tests/unit/test_kubex_manager_unit.py` — extend with `TestCredentialInjectionPaths` class: covers AUTH-02 path correctness

*(Existing `test_cli_runtime.py` already covers AUTH-03 agent-side pre-flight — no gap.)*

---

## Sources

### Primary (HIGH confidence)
- `agents/_base/kubex_harness/cli_runtime.py` — CREDENTIAL_PATHS dict (lines 52-55), `_publish_state()` (lines 822-842), `_credentials_present()` (lines 351-363), `_execute_task_inner` credential pre-flight (lines 523-532)
- `services/gateway/gateway/main.py` — `stream_task_progress` SSE pattern (lines 679-711), `GatewayService` Redis init (lines 1056-1130)
- `services/kubex-manager/kubex_manager/main.py` — `inject_credentials` endpoint (lines 509-603), `verify_token` pattern (lines 43-55)
- `services/kubex-manager/kubex_manager/lifecycle.py` — `CLI_CREDENTIAL_MOUNTS` (lines 74-78)
- `libs/kubex-common/kubex_common/constants.py` — Redis DB assignments
- `docker-compose.yml` — Authoritative Redis URL per service (lines 45, 81, 111, 138)

### Secondary (MEDIUM confidence)
- `docs/HANDOFF-oauth-command-center.md` — Phase 9 handoff doc; gap list and flow diagram still accurate for the credential injection flow

### Tertiary (LOW confidence)
- Browser EventSource API custom headers limitation — common knowledge, verify against MDN for FE handoff doc

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use in the codebase; no new dependencies
- Architecture: HIGH — all patterns verified against actual source code
- Pitfalls: HIGH — all pitfalls derived from direct code inspection (wrong DB, wrong path, missing import)
- AUTH-03 scope: MEDIUM — ambiguity between requirement text and decision D-09; planner must resolve

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable domain; no fast-moving libraries)
