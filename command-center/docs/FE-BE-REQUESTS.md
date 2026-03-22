# Frontend → Backend API Requests

> Tracking document for backend API endpoints and features needed by the Command Center frontend.
> The backend team should review each item and implement or confirm availability.
>
> Generated: 2026-03-22
> Source files: `command-center/src/api.ts`, `command-center/src/types.ts`, all `src/components/*.tsx`

---

## Status Legend

- 🟢 CONFIRMED — endpoint exists and works
- 🟡 PARTIAL — endpoint exists but missing features
- 🔴 MISSING — endpoint does not exist yet
- ⚪ UNKNOWN — needs verification

---

## Endpoints

### 🟢 GET /health — Gateway health check

- **Frontend file:** `src/api.ts` line 109
- **Used by:** `Dashboard.tsx` (`getGatewayHealth`), polled every 10s
- **Expected response:** `{ service: string, status: string, [key: string]: unknown }`
- **Backend status:** Implemented in `kubex_common/service/health.py` via `create_health_router`. Returns `{ service, version, status, uptime_seconds, redis: { connected } }`.
- **Action needed:** None. Response is a superset of what the frontend expects.

---

### 🟢 GET /health — Registry health check

- **Frontend file:** `src/api.ts` line 113
- **Used by:** `Dashboard.tsx` (`getRegistryHealth`), polled every 10s
- **Service:** Registry (`http://localhost:8070`)
- **Expected response:** `{ service: string, status: string, [key: string]: unknown }`
- **Backend status:** Implemented via the shared `KubexService` base class health router.
- **Action needed:** None.

---

### 🟢 GET /health — Manager health check

- **Frontend file:** `src/api.ts` line 117
- **Used by:** `Dashboard.tsx` (`getManagerHealth`), polled every 10s
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Sends `Authorization: Bearer <MANAGER_TOKEN>` header. The `/health` endpoint does **not** require auth (auth is only enforced on `/kubexes` routes), so the token is harmlessly ignored.
- **Expected response:** `{ service: string, status: string, [key: string]: unknown }`
- **Backend status:** Implemented via shared health router.
- **Action needed:** None.

---

### ⚪ GET /health — Broker health check (inferred)

- **Frontend file:** `src/api.ts` line 123
- **Used by:** `Dashboard.tsx` (`getBrokerHealth`)
- **Note:** The frontend does **not** call the Broker directly. It calls `GET /health` on the Gateway and synthesises a fake `{ service: 'kubex-broker', status: 'healthy' }` response if the Gateway is up. The Broker has no externally exposed port.
- **Backend status:** No direct check needed. The inference logic is intentional.
- **Action needed:** If the team ever wants accurate Broker status, the Gateway's `/health` response should include a `dependencies.broker` field populated from an internal probe. Currently not done.

---

### 🟢 GET /agents — List all registered agents

- **Frontend file:** `src/api.ts` line 136
- **Used by:** `AgentsPanel.tsx`, `Dashboard.tsx`, `OrchestratorChat.tsx` (for capability autocomplete), `AgentDetailPage.tsx`
- **Service:** Registry (`http://localhost:8070`)
- **Expected response:** `Agent[]` — array of `{ agent_id, capabilities, status, boundary, registered_at?, metadata? }`
- **Backend status:** Implemented at `GET /agents` in `services/registry/registry/main.py` line 39. Returns a list of `AgentRegistration` Pydantic models.
- **Schema gap:** `AgentRegistration` includes `accepts_from` and `updated_at` fields that the frontend `Agent` type does not declare — these are silently ignored, which is fine. However, `AgentRegistration.status` is typed as the `AgentStatus` enum (`running | stopped | busy | unknown`) while the frontend `Agent.status` type additionally expects `idle | booting | credential_wait | ready`. The enum values on the backend do not include `idle`, `booting`, `credential_wait`, or `ready`. Any agent that reports one of those status strings will not match any backend enum value and will fail validation or default to `unknown` in the registry store.
- **Action needed:** Align `AgentStatus` enum in `services/registry/registry/store.py` with the full set of status strings the frontend renders: add `idle`, `booting`, `credential_wait`, `ready`.

---

### 🟢 GET /capabilities/{capability} — Resolve agents by capability

- **Frontend file:** `src/api.ts` line 140
- **Used by:** `api.ts` only — exported as `getAgentsByCapability()` but no component currently calls this function. It is available for future use.
- **Service:** Registry (`http://localhost:8070`)
- **Expected response:** `Agent[]`
- **Backend status:** Implemented at `GET /capabilities/{capability}` in `services/registry/registry/main.py` line 67. Returns 404 if no agents support the capability.
- **Action needed:** None. No active consumer; available when needed.

---

### 🟢 DELETE /agents/{agent_id} — Deregister an agent

- **Frontend file:** `src/api.ts` line 144
- **Used by:** `AgentsPanel.tsx` (Deregister button on each agent row)
- **Service:** Registry (`http://localhost:8070`)
- **Expected response:** 204 No Content on success, 404 on not found
- **Backend status:** Implemented at `DELETE /agents/{agent_id}` in `services/registry/registry/main.py` line 56.
- **Action needed:** None.

---

### 🟢 GET /kubexes — List all Kubex containers

- **Frontend file:** `src/api.ts` line 150
- **Used by:** `ContainersPanel.tsx`, `Dashboard.tsx` (count only), `QuickActionsMenu.tsx`
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <MANAGER_TOKEN>`
- **Expected response:** `Kubex[]` — array of `{ kubex_id, agent_id?, status, image?, created_at?, started_at?, container_name?, config? }`
- **Backend status:** Implemented at `GET /kubexes` in `services/kubex-manager/kubex_manager/main.py` line 162. The `_record_to_dict` serialiser (line 87–96) returns: `{ kubex_id, agent_id, boundary, container_id, status, image }`.
- **Schema gap — missing fields:** The frontend `Kubex` type expects `created_at`, `started_at`, and `container_name`. None of these fields exist in `KubexRecord` or are serialised by `_record_to_dict`. The frontend gracefully falls back (`?? '—'`) for missing optional fields, so no crash — but the Containers panel will display `—` for image-related timestamps and the QuickActionsMenu will fall back to the `kubex_id` prefix instead of a container name.
- **Schema gap — extra fields:** The backend returns `boundary` and `container_id` which the frontend `Kubex` type does not declare. They are ignored.
- **Action needed:** Add `container_name`, `created_at`, and `started_at` fields to `KubexRecord` and populate them from the Docker container object during `create_kubex` and `start_kubex`. Update `_record_to_dict` to include them.

---

### 🟢 POST /kubexes/{kubex_id}/kill — Force-kill a Kubex container

- **Frontend file:** `src/api.ts` line 154
- **Used by:** `ContainersPanel.tsx`, `QuickActionsMenu.tsx`
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <MANAGER_TOKEN>`
- **Expected response:** Any 2xx (frontend ignores response body)
- **Backend status:** Implemented at `POST /kubexes/{kubex_id}/kill` in `services/kubex-manager/kubex_manager/main.py` line 240.
- **Action needed:** None.

---

### 🟢 POST /kubexes/{kubex_id}/start — Start a Kubex container

- **Frontend file:** `src/api.ts` line 163
- **Used by:** `ContainersPanel.tsx`, `QuickActionsMenu.tsx`
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <MANAGER_TOKEN>`
- **Expected response:** Any 2xx
- **Backend status:** Implemented at `POST /kubexes/{kubex_id}/start` in `services/kubex-manager/kubex_manager/main.py` line 190.
- **Action needed:** None.

---

### 🔴 POST /kubexes/kill-all — Kill all running Kubexes

- **Frontend file:** `src/api.ts` line 172
- **Used by:** `KillAllDialog.tsx` (exported as `killAllKubexes()`)
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <MANAGER_TOKEN>`
- **Expected response:** Any 2xx
- **Backend status:** This route does **not exist** in `services/kubex-manager/kubex_manager/main.py`. The manager has `kill`, `stop`, `restart`, `respawn`, `start` per-kubex routes but no bulk-kill endpoint.
- **Action needed:** Implement `POST /kubexes/kill-all` in the Manager. It should iterate all kubexes with `status == running`, call `lifecycle.kill_kubex()` on each, and return a summary `{ killed: [ids], errors: [ids] }`. Note the route must be registered **before** `GET /kubexes/{kubex_id}` to avoid FastAPI matching `kill-all` as a `kubex_id` parameter — use a dedicated router prefix or ensure ordering is correct.

---

### 🔴 POST /kubexes/{kubex_id}/pause — Pause a Kubex container

- **Frontend file:** `src/api.ts` line 176
- **Used by:** Not currently called by any visible component, but exported from `api.ts` as `pauseKubex()`
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <MANAGER_TOKEN>`
- **Expected response:** Any 2xx
- **Backend status:** Route does **not exist**. Manager has no `/pause` endpoint.
- **Action needed:** Implement `POST /kubexes/{kubex_id}/pause` using Docker SDK `container.pause()`. Note: Docker pause uses SIGSTOP and is distinct from stop. Add corresponding `/resume` at the same time.

---

### 🔴 POST /kubexes/{kubex_id}/resume — Resume a paused Kubex container

- **Frontend file:** `src/api.ts` line 184
- **Used by:** Not currently called by any visible component, but exported from `api.ts` as `resumeKubex()`
- **Service:** Kubex Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <MANAGER_TOKEN>`
- **Expected response:** Any 2xx
- **Backend status:** Route does **not exist**. Manager has no `/resume` endpoint.
- **Action needed:** Implement alongside `/pause` above using Docker SDK `container.unpause()`.

---

### 🟢 POST /actions — Dispatch a task to the orchestrator

- **Frontend file:** `src/api.ts` line 214
- **Used by:** `OrchestratorChat.tsx` (`dispatchTask()`)
- **Service:** Gateway (`http://localhost:8080`)
- **Request body:**
  ```json
  {
    "request_id": "<uuid>",
    "agent_id": "command-center",
    "action": "dispatch_task",
    "parameters": { "capability": "...", "context_message": "..." },
    "context": { "task_id": null, "workflow_id": "cc-<timestamp>" },
    "priority": "normal"
  }
  ```
- **Expected response:** `{ task_id: string, status?: string, message?: string }`
- **Backend status:** Implemented at `POST /actions` in `services/gateway/gateway/main.py` line 47. On `dispatch_task` action, returns `{ task_id, status: "dispatched", capability }` (HTTP 202).
- **Schema note:** The frontend reads `res.data.task_id` directly. The backend returns this correctly. The `request_id` field in the body is accepted but not used by the backend — the backend generates its own `task_id`. This is acceptable.
- **Action needed:** None.

---

### 🟢 GET /tasks/{task_id}/result — Poll for task result

- **Frontend file:** `src/api.ts` line 218
- **Used by:** `OrchestratorChat.tsx` (fallback when SSE stream closes without a terminal event)
- **Service:** Gateway (`http://localhost:8080`)
- **Expected response:** `{ task_id: string, status: string, result?: unknown, error?: string, completed_at?: string }`
- **Backend status:** Implemented at `GET /tasks/{task_id}/result` in `services/gateway/gateway/main.py` line 769. Reads `task:result:{task_id}` key from Redis DB0. Returns 404 if not found, 503 if Redis is down.
- **Schema gap:** The backend returns whatever JSON was stored in Redis by the worker harness. The frontend `TaskResult` type has `task_id`, `status`, `result`, `error`, `completed_at` as optional fields plus `[key: string]: unknown` — flexible enough to handle any worker-written payload. The critical field `task_id` may be absent if the worker stores only the result payload without re-wrapping it. This depends on worker harness behaviour; should be verified.
- **Action needed:** Verify that the worker harness always stores results with `task_id` in the Redis payload at key `task:result:{task_id}`.

---

### 🟢 GET /tasks/{task_id}/stream — SSE stream of task progress

- **Frontend file:** `src/api.ts` line 229 (`getTaskStreamUrl`)
- **Used by:** `OrchestratorChat.tsx` via `useSSE` hook
- **Service:** Gateway (`http://localhost:8080`)
- **Expected SSE events:**
  ```
  data: { "type": "stdout"|"stderr"|"hitl_request"|"result"|"completed"|"failed"|"cancelled", ... }
  ```
- **Backend status:** Implemented at `GET /tasks/{task_id}/stream` in `services/gateway/gateway/main.py` line 678. Subscribes to Redis pub/sub channel `progress:{task_id}` and streams messages as SSE `data:` lines. Closes on `result`, `cancelled`, or `failed` events.
- **SSE event gaps:**
  1. The frontend `OrchestratorChat.tsx` handles `stdout`, `stderr`, `hitl_request`, `result`, `completed`, `failed`, `cancelled` event types (lines 67–150). The backend publishes whatever the worker pushes to `POST /tasks/{task_id}/progress` — there is no schema enforcement at the Gateway level. The SSE event shape is entirely determined by the worker harness, which is not audited here.
  2. The `useSSE` hook only closes the stream on `result`, `cancelled`, `failed` (line 69 of `useSSE.ts`). The backend also closes on `result | cancelled | failed`. These align.
  3. The `hitl_request` event type is handled by the frontend but the Gateway does not define this event — it passes through from the worker harness.
- **Action needed:** Document the SSE event contract in the worker harness. Confirm that `hitl_request` events include a `prompt` field.

---

### 🟢 GET /agents — Gateway agents proxy

- **Frontend file:** `src/api.ts` line 224
- **Used by:** Exported as `getGatewayAgents()` but **no component currently calls this function**.
- **Service:** Gateway (`http://localhost:8080`)
- **Expected response:** `Agent[]`
- **Backend status:** The Gateway does **not** have a `GET /agents` route. The only registered routes on the Gateway router are `/actions`, `/tasks/*`, `/policy/skill-check`, and the LLM proxy. The Registry has `GET /agents` but the Gateway does not proxy it.
- **Actual status: 🔴 MISSING** — but no component calls this so it is not currently blocking.
- **Action needed:** Either implement `GET /agents` on the Gateway as a proxy to the Registry, or remove `getGatewayAgents()` from `api.ts` if it will never be needed. If the intent is to have the frontend talk to only one backend service (the Gateway), the Gateway should proxy Registry queries.

---

### 🔴 POST /tasks/{task_id}/input — Provide HITL input to a running task

- **Frontend file:** `src/api.ts` line 239
- **Used by:** `OrchestratorChat.tsx` via `HITLPrompt.tsx` (`provideInput()`)
- **Service:** Gateway (`http://localhost:8080`)
- **Request body:** `{ input: string }`
- **Expected response:** Any 2xx
- **Backend status:** This route does **not exist** in the Gateway. The Gateway has `POST /tasks/{task_id}/progress` (for workers to push updates) and `POST /tasks/{task_id}/cancel` (for cancellation) but **no `/input` endpoint** for HITL responses.
- **Action needed:** Implement `POST /tasks/{task_id}/input` on the Gateway. The endpoint should publish the user's input to Redis so the waiting worker harness can receive it. A reasonable channel is `hitl:{task_id}` (or `control:{agent_id}` with a `hitl_response` command type). The worker harness must also be updated to subscribe to this channel when it emits a `hitl_request` SSE event.

---

### 🔴 GET /escalations — List pending escalation requests

- **Frontend file:** `src/api.ts` line 244
- **Used by:** `ApprovalQueue.tsx` — but the component currently uses **mock data** and does NOT call this function (see `ApprovalQueue.tsx` line 7–9 comment: "Mock data since the Gateway doesn't have a dedicated escalations endpoint yet").
- **Service:** Gateway (`http://localhost:8080`)
- **Expected response:** `ApprovalRequest[]` — array of `{ id, task_id, agent_id, action, capability?, reason, policy_rule?, timestamp, status }`
- **Backend status:** Route does **not exist**. The Gateway escalates actions to its internal reviewer agent pipeline (automated LLM review) but does not persist human-facing escalation records or expose them via API.
- **Action needed:** Implement `GET /escalations` on the Gateway. This requires:
  1. A persistence layer (Redis hash or sorted set) where escalation records are stored when `PolicyDecision.ESCALATE` reaches the human-review path (HTTP 423 branch in `_handle_action`).
  2. The `GET /escalations` endpoint to read and return pending records.
  3. The `POST /escalations/{id}/resolve` endpoint (see below).

---

### 🔴 POST /escalations/{escalation_id}/resolve — Approve or reject an escalation

- **Frontend file:** `src/api.ts` line 249
- **Used by:** `ApprovalQueue.tsx` — currently uses local mock state and does NOT call this function.
- **Service:** Gateway (`http://localhost:8080`)
- **Request body:** `{ decision: "approve" | "reject", reason?: string }`
- **Expected response:** Any 2xx
- **Backend status:** Route does **not exist**. See `GET /escalations` above — the entire human-in-the-loop escalation review API is unimplemented.
- **Action needed:** Implement alongside `GET /escalations`. When `decision == "approve"`, the Gateway should resume the paused action (republish to the broker). When `decision == "reject"`, publish a `failed` event to the task's SSE stream and record the outcome.

---

## Type Shape Mismatches

### Agent status enum mismatch

- **Frontend type:** `src/types.ts` line 23 — `status: 'running' | 'busy' | 'idle' | 'stopped' | 'booting' | 'credential_wait' | 'ready' | string`
- **Backend enum:** `services/registry/registry/store.py` `AgentStatus` — only `running | stopped | busy | unknown`
- **Impact:** Agents that self-report `idle`, `booting`, `credential_wait`, or `ready` via `PATCH /agents/{id}/status` will be rejected by Pydantic validation on the Registry (FastAPI returns 422). The `StatusBadge` component renders these values with distinct colors, implying they were expected to appear.
- **Action needed:** Add the missing values to `AgentStatus` in the registry store, or confirm these statuses are never used and remove them from the frontend type.

---

### Kubex shape missing fields

- **Frontend type:** `src/types.ts` lines 31–40 — expects `created_at?`, `started_at?`, `container_name?`, `config?`
- **Backend serialiser:** `services/kubex-manager/kubex_manager/main.py` `_record_to_dict` lines 87–96 — returns only `kubex_id, agent_id, boundary, container_id, status, image`
- **Impact:** `container_name` falls back to `kubex_id.slice(0, 16)` in `QuickActionsMenu.tsx` (no crash). `created_at` and `started_at` are unused in the current UI. `config` is not rendered anywhere.
- **Action needed:** Populate and return `container_name`, `created_at`, `started_at` from the Docker container object. Document whether `config` should be exposed.

---

### AgentDetail extended fields never populated

- **Frontend type:** `src/types.ts` lines 134–139 — `AgentDetail extends Agent` with `tasks_completed?`, `tasks_failed?`, `uptime?`, `last_active?`
- **Backend:** No endpoint returns these fields. `AgentDetailPage.tsx` calls `GET /agents` and filters by `agent_id` — it receives a plain `Agent`, not an `AgentDetail`.
- **Impact:** The Detail page tabs "Actions" and "Live Output" display static placeholder text ("will appear here once task tracking is enabled"). No runtime error.
- **Action needed:** When per-agent task history tracking is implemented, add these fields to the Registry's agent record or serve them from a separate stats endpoint (e.g. `GET /agents/{agent_id}/stats`).

---

## Missing Backend Capabilities (Non-Endpoint)

### Traffic Log — no backend source

- **Used by:** `TrafficLog.tsx`, `AppContext.tsx`
- **Detail:** The traffic log is 100% client-side. Entries are synthesised locally in `OrchestratorChat.tsx` based on dispatch responses and SSE events, then stored in `localStorage` (capped at 500 entries). There is no backend endpoint to fetch historical traffic. The log is lost on browser clear.
- **Action needed:** If persistent traffic history is required, implement `GET /traffic` on the Gateway that reads from a Redis stream or structured log. This is not blocking current functionality.

---

### SSE stream — no authentication

- **Used by:** `OrchestratorChat.tsx` → `useSSE` hook → `EventSource`
- **Detail:** The browser's native `EventSource` API does not support custom request headers, so the SSE endpoint `GET /tasks/{task_id}/stream` receives no `Authorization` header. Any client that knows a `task_id` can subscribe to its stream. The Gateway currently enforces no auth on task stream endpoints.
- **Action needed:** Consider using a short-lived stream token (issued by `POST /actions` response, then passed as a query param `?token=...`) for stream authentication. This is a security gap in multi-tenant scenarios.

---

### Broker health — no direct probe

- **Detail:** Dashboard shows a "Broker" service card but the health is inferred from Gateway status (`getBrokerHealth` in `api.ts`). If the Broker crashes while the Gateway is healthy, the dashboard will incorrectly show Broker as healthy.
- **Action needed:** Add a `/health` endpoint to the Broker service and expose it (at least internally so the Gateway can probe it and include Broker status in its own health response).

---

### Pagination — all client-side

- **Used by:** `AgentsPanel.tsx`, `ContainersPanel.tsx`, `TrafficLog.tsx`
- **Detail:** All pagination (`usePagination` hook) is performed client-side after fetching the full list. The Registry and Manager both return entire collections with no `page`, `limit`, or `offset` query parameter support.
- **Impact:** For small deployments (tens of agents/kubexes) this is fine. At scale (hundreds+), fetching the full list every 10 seconds will become a performance concern.
- **Action needed:** Low priority. When agent/kubex count exceeds ~100, add `?page=&limit=` query params to `GET /agents` and `GET /kubexes` endpoints, and update the frontend to pass pagination params.

---

## OAuth Endpoints (Iteration 32 — Required from Backend)

> The Command Center frontend has OAuth scaffolding ready (see `src/services/auth.ts`).
> These endpoints are needed from the backend identity / auth service before OAuth can be enabled.
> Set `VITE_OAUTH_AUTHORITY` to activate the OAuth code path in the frontend.

### 🔴 POST /authorize — OAuth Authorization endpoint

- **Frontend file:** `src/services/auth.ts` — `login()` redirects to `{VITE_OAUTH_AUTHORITY}/authorize`
- **Protocol:** OAuth 2.0 Authorization Code + PKCE (RFC 7636)
- **Required query params the frontend will send:**
  ```
  response_type=code
  client_id={VITE_OAUTH_CLIENT_ID}
  redirect_uri={VITE_OAUTH_REDIRECT_URI}   (default: {origin}/auth/callback)
  scope=openid profile email
  state={random_state}
  code_challenge={pkce_challenge}
  code_challenge_method=S256
  ```
- **Expected response:** 302 redirect to `redirect_uri?code=...&state=...` on success, or `redirect_uri?error=...&error_description=...` on failure.
- **Backend status:** NOT IMPLEMENTED. Only static bearer token auth exists today.
- **Action needed:** Implement an OAuth 2.0 Authorization Server (or integrate with an existing IdP such as Keycloak, Auth0, Okta). The frontend is IdP-agnostic — it uses standard PKCE endpoints.

---

### 🔴 POST /token — Token endpoint

- **Frontend file:** `src/services/auth.ts` — `handleCallback()` posts to `{VITE_OAUTH_AUTHORITY}/token`
- **Used for:** Authorization code exchange AND refresh token grant
- **Authorization Code exchange body (application/x-www-form-urlencoded):**
  ```
  grant_type=authorization_code
  client_id={VITE_OAUTH_CLIENT_ID}
  redirect_uri={VITE_OAUTH_REDIRECT_URI}
  code={authorization_code}
  code_verifier={pkce_verifier}
  ```
- **Refresh token body:**
  ```
  grant_type=refresh_token
  client_id={VITE_OAUTH_CLIENT_ID}
  refresh_token={stored_refresh_token}
  ```
- **Expected response:**
  ```json
  {
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 3600,
    "token_type": "Bearer",
    "scope": "openid profile email"
  }
  ```
- **Backend status:** NOT IMPLEMENTED.
- **Action needed:** Implement token endpoint per RFC 6749 with PKCE support (RFC 7636). Access tokens should be JWTs acceptable by the Gateway and Manager as Bearer tokens (replacing the current static `VITE_MANAGER_TOKEN`).

---

### 🔴 GET /userinfo — OIDC UserInfo endpoint

- **Frontend file:** `src/services/auth.ts` — `fetchUserProfile()` calls `{VITE_OAUTH_AUTHORITY}/userinfo`
- **Auth:** `Authorization: Bearer {access_token}`
- **Expected response (OpenID Connect standard):**
  ```json
  {
    "sub": "user-id",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "picture": "https://..."
  }
  ```
- **Used by:** `UserMenu.tsx` to display the logged-in user's name, email, and avatar in the top bar.
- **Backend status:** NOT IMPLEMENTED.
- **Action needed:** Implement the OIDC UserInfo endpoint (RFC 9068 / OIDC Core 1.0 §5.3). Return at minimum `sub`, `name`, `email`. `picture` (avatar URL) is optional but will appear in the top bar if provided.

---

### 🔴 GET /logout — RP-Initiated Logout (optional)

- **Frontend file:** `src/services/auth.ts` — `logout()` redirects to `{VITE_OAUTH_AUTHORITY}/logout`
- **Query params sent:**
  ```
  client_id={VITE_OAUTH_CLIENT_ID}
  post_logout_redirect_uri={window.location.origin}
  ```
- **Expected behaviour:** Invalidate the server-side session and redirect the browser to `post_logout_redirect_uri`.
- **Backend status:** NOT IMPLEMENTED.
- **Action needed:** Implement RP-Initiated Logout per OIDC Session Management spec. If not implemented, the frontend degrades gracefully — it clears local tokens and reloads; the provider session remains active until it expires naturally.

---

### Notes on JWT Bearer token compatibility

Once OAuth is live, `access_token` values issued by the IdP will be sent as `Authorization: Bearer {access_token}` to the Gateway and Manager (via `src/api.ts` `managerHeaders()`). The backend services must:

1. Accept and validate JWTs (not just the static `VITE_MANAGER_TOKEN` string).
2. Verify the token signature against the IdP's JWKS endpoint.
3. Check `exp`, `iss`, `aud` claims.

This is a **breaking change** to the Manager's auth model — the static bearer token can remain as a fallback for local dev, but production deployments must move to JWT validation.

---

## Summary Table

| # | Endpoint | Service | Status | Blocker? |
|---|----------|---------|--------|----------|
| 1 | `GET /health` | Gateway | 🟢 CONFIRMED | No |
| 2 | `GET /health` | Registry | 🟢 CONFIRMED | No |
| 3 | `GET /health` | Manager | 🟢 CONFIRMED | No |
| 4 | `GET /health` | Broker (inferred) | ⚪ UNKNOWN | No |
| 5 | `GET /agents` | Registry | 🟢 CONFIRMED | No |
| 6 | `GET /capabilities/{cap}` | Registry | 🟢 CONFIRMED | No |
| 7 | `DELETE /agents/{id}` | Registry | 🟢 CONFIRMED | No |
| 8 | `GET /kubexes` | Manager | 🟡 PARTIAL (missing fields) | No |
| 9 | `POST /kubexes/{id}/kill` | Manager | 🟢 CONFIRMED | No |
| 10 | `POST /kubexes/{id}/start` | Manager | 🟢 CONFIRMED | No |
| 11 | `POST /kubexes/kill-all` | Manager | 🔴 MISSING | Yes (KillAllDialog) |
| 12 | `POST /kubexes/{id}/pause` | Manager | 🔴 MISSING | No (not yet called) |
| 13 | `POST /kubexes/{id}/resume` | Manager | 🔴 MISSING | No (not yet called) |
| 14 | `POST /actions` | Gateway | 🟢 CONFIRMED | No |
| 15 | `GET /tasks/{id}/result` | Gateway | 🟢 CONFIRMED | No |
| 16 | `GET /tasks/{id}/stream` | Gateway | 🟢 CONFIRMED | No |
| 17 | `GET /agents` | Gateway (proxy) | 🔴 MISSING | No (not yet called) |
| 18 | `POST /tasks/{id}/input` | Gateway | 🔴 MISSING | Yes (HITL) |
| 19 | `GET /escalations` | Gateway | 🔴 MISSING | No (mock active) |
| 20 | `POST /escalations/{id}/resolve` | Gateway | 🔴 MISSING | No (mock active) |
| 21 | `POST /authorize` | Auth Service | 🔴 MISSING | Yes (OAuth login) |
| 22 | `POST /token` | Auth Service | 🔴 MISSING | Yes (OAuth token exchange) |
| 23 | `GET /userinfo` | Auth Service | 🔴 MISSING | No (user profile display) |
| 24 | `GET /logout` | Auth Service | 🔴 MISSING | No (logout redirect, degrades gracefully) |
