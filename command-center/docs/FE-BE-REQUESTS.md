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

## Skills API — Dynamic Skill Management

> The stem cell Kubex model requires skills to be the primary configuration unit. Currently skills are static markdown files on disk (`skills/` directory), which means adding new skills requires a code change. The FE needs a Skills API to:
> 1. List available skills in the Spawn Wizard (replacing capability-only selection)
> 2. Enable dynamic skill creation/editing via the Command Center UI
> 3. Allow the Manager to resolve skills from a store (Redis/DB) in addition to filesystem

### 🔴 GET /skills — List all available skills

- **Frontend need:** Spawn Wizard step 2 should show a skills picker (not just capabilities). Each skill includes name, category, description, and the capabilities it provides.
- **Service:** Manager (`http://localhost:8090`) or new Skills service
- **Expected response:**
  ```json
  [
    {
      "id": "knowledge/recall",
      "name": "Recall",
      "category": "knowledge",
      "description": "Memory and recall capabilities for knowledge management",
      "capabilities": ["knowledge_management", "recall"],
      "source": "filesystem"
    }
  ]
  ```
- **Implementation suggestion:** Scan `skills/` directory tree for `SKILL.md` files. Parse metadata from frontmatter or directory structure. Merge with any dynamically created skills stored in Redis.
- **Action needed:** Implement endpoint. The FE Spawn Wizard will switch from capability-only picker to skill picker once available.

---

### 🔴 GET /skills/{id} — Get skill content

- **Frontend need:** Skill editor/viewer — show the full markdown content of a skill.
- **Service:** Manager
- **Expected response:**
  ```json
  {
    "id": "knowledge/recall",
    "name": "Recall",
    "category": "knowledge",
    "content": "You are an agent with recall capabilities...",
    "capabilities": ["knowledge_management", "recall"],
    "source": "filesystem",
    "created_at": "2026-03-01T00:00:00Z",
    "updated_at": "2026-03-20T10:30:00Z"
  }
  ```
- **Action needed:** Implement endpoint. Read SKILL.md content from filesystem or Redis store.

---

### 🔴 POST /skills — Create a new skill dynamically

- **Frontend need:** Skill creation wizard — write markdown, define metadata, instantly available to any Kubex without code changes.
- **Service:** Manager
- **Request body:**
  ```json
  {
    "id": "custom/my-skill",
    "name": "My Custom Skill",
    "category": "custom",
    "content": "You are an agent that...",
    "capabilities": ["my_capability"]
  }
  ```
- **Expected response:** 201 with the created skill object.
- **Storage:** Redis hash or dedicated store. The Manager's `SkillResolver` should check this store in addition to the filesystem.
- **Action needed:** Implement endpoint + update `SkillResolver` to merge filesystem and dynamic skills.

---

### 🔴 PUT /skills/{id} — Update a skill

- **Frontend need:** Skill editor — modify content/metadata of dynamic skills. Filesystem skills should be read-only (or warn that changes won't persist across deploys).
- **Service:** Manager
- **Request body:** Same as POST, partial updates allowed.
- **Expected response:** 200 with updated skill object.
- **Action needed:** Implement alongside POST. Only dynamic (Redis-stored) skills should be editable. Filesystem skills return 403 or a warning.

---

### 🔴 DELETE /skills/{id} — Remove a dynamic skill

- **Frontend need:** Skill management — remove skills that are no longer needed.
- **Service:** Manager
- **Expected response:** 204 on success. Filesystem skills return 403.
- **Action needed:** Implement alongside POST/PUT. Only dynamic skills can be deleted.

---

## Portable Skill Packages — Import/Export

> Skills need to be portable so they can be shared between stacks, teams, and environments. The repo's `skills/` directory provides defaults, but custom skills should be importable at runtime without code changes or redeployment.

### Skill Package Format (proposed)

A single YAML manifest (`.kubex-skill.yaml`):

```yaml
apiVersion: kubex/v1
kind: Skill
metadata:
  name: web-scraping
  category: data-collection
  version: 1.0.0
  author: team-x
  capabilities:
    - web_scraping
    - data_extraction
spec:
  prompt: |
    You are an agent specialized in web scraping.
    Use BeautifulSoup to parse HTML...
  dependencies:
    pip: [beautifulsoup4, requests]
  config:
    timeout_seconds: 30
```

### Boot-time behavior

On stack startup, the Manager should auto-import all `skills/*/SKILL.md` files from the repo filesystem into the skills store (Redis) as **read-only defaults** with `source: "filesystem"`. Dynamic skills created via API get `source: "dynamic"` and are fully editable.

### 🔴 POST /skills/import — Import a portable skill package

- **Frontend need:** "Import Skill" button in the skills management page. User uploads a `.kubex-skill.yaml` file or pastes YAML content.
- **Service:** Manager (`http://localhost:8090`)
- **Request body:** `Content-Type: application/yaml` or `multipart/form-data` with the YAML file.
- **Expected behavior:**
  1. Validate the YAML against the `kubex/v1` Skill schema (reject malformed packages).
  2. Store in Redis (or DB) — immediately available for Kubex spawning.
  3. If a skill with the same `metadata.name` + `metadata.category` exists and is `source: "dynamic"`, overwrite it. If `source: "filesystem"`, reject with 409 (cannot overwrite defaults via import).
- **Expected response:** 201 with the imported skill object.
- **Action needed:** Define and implement the `kubex/v1` Skill schema. Add YAML parsing + validation. Store in Redis hash `skills:{category}/{name}`.

---

### 🔴 GET /skills/{id}/export — Export a skill as portable YAML

- **Frontend need:** "Export" button on each skill in the management page. Downloads a `.kubex-skill.yaml` file.
- **Service:** Manager
- **Expected response:** `Content-Type: application/yaml` — the full skill package YAML.
- **Action needed:** Serialize the skill record (including prompt content, metadata, dependencies, config) into the `kubex/v1` YAML format.

---

### 🔴 POST /skills/import-bundle — Import multiple skills at once

- **Frontend need:** Bulk import — user uploads a zip containing multiple `.kubex-skill.yaml` files.
- **Service:** Manager
- **Request body:** `Content-Type: multipart/form-data` with a `.zip` file.
- **Expected response:** 200 with `{ imported: [...], failed: [...], skipped: [...] }`.
- **Action needed:** Implement after single import is stable. Lower priority.

---

## Agent Credential Injection — OAuth Paste-Code Flow (Added 2026-03-26)

> The Command Center needs backend support for a guided "paste auth code" flow so users can
> provision CLI agent credentials without docker exec. The existing `POST /kubexes/{id}/credentials`
> endpoint handles the final injection step, but the UI needs additional endpoints to build a
> proper guided experience.

### 🔴 GET /agents/{agent_id}/state — Current agent lifecycle state (REST)

- **Frontend need:** On page load, the UI must know if an agent is in `credential_wait` state to show the auth banner. The SSE lifecycle stream (`GET /agents/{agent_id}/lifecycle`) does NOT replay history — if the UI connects after the agent entered `credential_wait`, it has no way to know until the next state change.
- **Service:** Gateway (`http://localhost:8080`)
- **Auth:** Requires `Authorization: Bearer <KUBEX_MGMT_TOKEN>`
- **Expected response:**
  ```json
  {
    "agent_id": "my-agent",
    "state": "credential_wait",
    "last_updated": "2026-03-26T12:00:00Z"
  }
  ```
- **Possible `state` values:** `booting`, `credential_wait`, `ready`, `busy`
- **Backend implementation:** The agent's `_publish_state()` in `cli_runtime.py` already publishes to Redis pub/sub `lifecycle:{agent_id}`. Add a side-write: `SET agent:state:{agent_id} <json>` alongside each `PUBLISH`. The Gateway endpoint reads this key from Redis DB0.
- **Returns 404 if:** No state has been published yet (agent hasn't booted).
- **Action needed:** Modify `_publish_state()` to write to Redis key; add Gateway endpoint to read it.
- **Blocker?** Yes — without this, the UI cannot detect `credential_wait` on page load.

---

### 🔴 GET /auth/runtimes — List supported CLI runtimes with auth instructions

- **Frontend need:** The credential panel should show per-runtime auth instructions (what command to run, what file to copy, expected credential format). Currently hardcoded in the FE textarea placeholder.
- **Service:** Gateway (`http://localhost:8080`) or Manager (`http://localhost:8090`)
- **Auth:** Requires `Authorization: Bearer <KUBEX_MGMT_TOKEN>`
- **Expected response:**
  ```json
  [
    {
      "runtime": "claude-code",
      "display_name": "Claude Code",
      "auth_command": "claude auth login",
      "credential_source": "~/.claude/.credentials.json",
      "container_path": "/root/.claude/.credentials.json",
      "instructions": [
        "Open a terminal on your machine",
        "Run: claude auth login",
        "Complete the authentication in your browser",
        "Copy the contents of ~/.claude/.credentials.json",
        "Paste the JSON below"
      ],
      "credential_example": {
        "accessToken": "sk-ant-...",
        "refreshToken": "...",
        "expiresAt": "2026-04-26T00:00:00Z"
      }
    },
    {
      "runtime": "gemini-cli",
      "display_name": "Gemini CLI",
      "auth_command": "gemini auth login",
      "credential_source": "~/.gemini/oauth_creds.json",
      "container_path": "/root/.gemini/oauth_creds.json",
      "instructions": [
        "Open a terminal on your machine",
        "Run: gemini auth login",
        "Complete the Google OAuth in your browser",
        "Copy the contents of ~/.gemini/oauth_creds.json",
        "Paste the JSON below"
      ],
      "credential_example": {
        "access_token": "ya29...",
        "refresh_token": "...",
        "token_uri": "https://oauth2.googleapis.com/token"
      }
    },
    {
      "runtime": "codex-cli",
      "display_name": "Codex CLI",
      "auth_command": "codex auth login",
      "credential_source": "~/.codex/.credentials.json",
      "container_path": "/root/.codex/.credentials.json",
      "instructions": [
        "Open a terminal on your machine",
        "Run: codex auth login",
        "Complete the authentication in your browser",
        "Copy the contents of ~/.codex/.credentials.json",
        "Paste the JSON below"
      ],
      "credential_example": {
        "api_key": "sk-...",
        "organization": "org-..."
      }
    }
  ]
  ```
- **Backend implementation:** Static data — no external calls needed. Define the runtime info as a constant dict in the Gateway or Manager and serve it.
- **Action needed:** Implement endpoint. Low complexity.
- **Blocker?** No — FE can hardcode instructions as fallback, but this is cleaner.

---

### 🔴 GET /auth/runtimes/{runtime} — Single runtime auth info

- **Same as above, filtered to one runtime.**
- **Returns 404 if runtime not recognized.**
- **Action needed:** Implement alongside `GET /auth/runtimes`.

---

### 🟡 Agent status enum — `credential_wait` not accepted by Registry

- **Cross-reference:** Already tracked in "Type Shape Mismatches" section above.
- **Impact on OAuth flow:** When an agent self-reports `credential_wait` via `PATCH /agents/{id}/status`, the Registry rejects it with 422 because `AgentStatus` enum only has `running | stopped | busy | unknown`. This means the Registry never shows `credential_wait` — the UI can only detect it via the SSE lifecycle stream or the proposed `GET /agents/{id}/state` endpoint.
- **Action needed:** Add `booting`, `credential_wait`, `ready`, `idle` to `AgentStatus` enum in `services/registry/registry/store.py`.
- **Blocker?** Yes — blocks the UI from showing credential state in agent lists.

---

### 🟡 codex-cli missing from agent-side CREDENTIAL_PATHS

- **File:** `agents/_base/kubex_harness/cli_runtime.py` line 53
- **Issue:** Manager supports `codex-cli` credential injection (writes to `/root/.codex/.credentials.json`), but the agent's `CREDENTIAL_PATHS` dict only has `claude-code` and `gemini-cli`. The agent never enters `credential_wait` for codex-cli.
- **Action needed:** Add `"codex-cli": Path.home() / ".codex" / ".credentials.json"` to `CREDENTIAL_PATHS` and a HITL auth message for codex-cli.
- **Blocker?** No — codex-cli is deferred (no subscription available).

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
| 25 | `GET /skills` | Manager | 🔴 MISSING | Yes (Spawn Wizard skill picker) |
| 26 | `GET /skills/{id}` | Manager | 🔴 MISSING | Yes (skill viewer/editor) |
| 27 | `POST /skills` | Manager | 🔴 MISSING | Yes (dynamic skill creation) |
| 28 | `PUT /skills/{id}` | Manager | 🔴 MISSING | No (skill editing) |
| 29 | `DELETE /skills/{id}` | Manager | 🔴 MISSING | No (skill removal) |
| 30 | `POST /skills/import` | Manager | 🔴 MISSING | Yes (skill import) |
| 31 | `GET /skills/{id}/export` | Manager | 🔴 MISSING | No (skill export) |
| 32 | `POST /skills/import-bundle` | Manager | 🔴 MISSING | No (bulk import) |
| 33 | `GET /agents/{id}/state` | Gateway | 🔴 MISSING | Yes (credential_wait detection on page load) |
| 34 | `GET /auth/runtimes` | Gateway/Manager | 🔴 MISSING | No (auth instructions, FE can hardcode) |
| 35 | `GET /auth/runtimes/{runtime}` | Gateway/Manager | 🔴 MISSING | No (single runtime auth info) |
| 36 | `POST /tasks/{id}/input` | Gateway | 🔴 MISSING | Yes (HITL response delivery) |
| 37 | `POST /tasks/{id}/append` | Gateway | 🔴 MISSING | Yes (CLI context injection) |

---

## HITL + Context Routing — Orchestrator Chat Flow (Added 2026-03-26)

> **REQUIRES FE + BE JOINT PLANNING.** This section describes a significant feature that
> changes how the orchestrator chat works. The backend team will implement the plumbing,
> but the FE UX design must be agreed with the product manager first. See
> `docs/design-orchestrator-chat-hitl.md` for the full architecture.

### Overview

The orchestrator chat is conversational, but workers are task-based. When a worker needs
human input (HITL) or the user wants to inject context into a running task, the orchestrator
acts as a **lightweight router** between the user and workers.

**Key principle:** The user never talks directly to a worker. The orchestrator mediates all
communication. It uses a lightweight model (cheap, fast) for routing decisions only.

### Three Interaction Patterns

#### Pattern 1: Worker asks human a question (HITL)

Worker → Orchestrator → UI → User responds → Orchestrator routes response:
- If answering the worker's question → forward to worker
- If "cancel" / "never mind" → orchestrator cancels worker, handles directly
- If new instruction → orchestrator dispatches new work

**FE impact:** The `HITLPrompt` component already handles this. The chat shows the worker's
question attributed to the orchestrator (user doesn't see worker identity unless we design
for it). User responds in the normal chat input. No "mode switch" needed — the orchestrator
decides what the response means.

**FE design question:** Should the UI show which worker asked the question? e.g.,
"instagram-scraper is asking: Which account?" vs just "Which account?" This affects the
chat bubble design.

#### Pattern 2: User injects context into a running CLI task

User sends new info → Orchestrator checks worker type:
- **CLI agent** → `POST /tasks/{id}/append` pipes context into the running PTY session
- **Non-CLI agent** → Cancel + re-dispatch with enriched context

**FE impact:** Transparent to the user. They just type in the chat. The orchestrator handles
the routing. No UI change needed for the basic flow.

**FE design question:** Should the UI show a visual indicator that a task was cancelled and
re-dispatched (for non-CLI agents)? Or should this be invisible?

#### Pattern 3: Parallel tasks with context sharing

User dispatches to kubex A, then dispatches to kubex B, then says "pass B's result to A."
The orchestrator holds context from both and routes accordingly.

**FE impact:** The chat shows a natural conversation. The orchestrator manages the complexity.
The UI may want to show which tasks are active (task status indicators in the chat).

**FE design question:** Should the chat show active task badges/pills? e.g.,
"[instagram-scraper: running] [knowledge: completed]" as a status bar above the input?

### New Backend Endpoints

#### 🔴 POST /tasks/{task_id}/input — Deliver HITL response to a waiting agent

- **Frontend file:** `src/api.ts` line 344 (already coded as `provideInput`)
- **Used by:** `OrchestratorChat.tsx` via `HITLPrompt.tsx`
- **Service:** Gateway (`http://localhost:8080`)
- **Request body:** `{ "input": "string" }`
- **Expected response:** `202 { "status": "delivered" }`
- **Backend mechanism:** Publishes to Redis channel `hitl:{task_id}` (DB 1). The waiting agent is subscribed to this channel and resumes on receipt.
- **Error responses:**
  - `404` — task not found or not in `awaiting_input` state
  - `408` — agent timed out waiting (HITL window expired)
- **Replaces:** Row 18 in the summary table above (same endpoint, now with full spec)
- **Blocker?** Yes — `HITLPrompt.tsx` calls this but it doesn't exist.

#### 🔴 POST /tasks/{task_id}/append — Inject context into a running CLI task

- **Frontend need:** Not directly called by FE — the orchestrator calls this internally when routing context to a CLI worker. However, FE may want a "send to agent" action in the future.
- **Service:** Gateway (`http://localhost:8080`)
- **Request body:** `{ "content": "string", "from_agent": "orchestrator" }`
- **Expected response:** `202 { "status": "appended" }`
- **Backend mechanism:** Publishes to Redis channel `append:{task_id}` (DB 1). The CLI Runtime subscribes to this channel and writes content to the PTY stdin.
- **Error responses:**
  - `404` — task not found
  - `409` — agent is not a CLI runtime (cannot append to non-CLI task)
- **Blocker?** Yes — required for context injection into running CLI agents.

### SSE Event Types — HITL (Clarification)

The SSE stream (`GET /tasks/{task_id}/stream`) will carry these HITL-related events:

```json
// Worker asking a question (surfaces in chat as a prompt)
{"type": "hitl_request", "prompt": "Which Nike account?", "source_agent": "instagram-scraper"}

// Task paused waiting for input
{"type": "status", "status": "awaiting_input"}

// Task resumed after input received
{"type": "status", "status": "running"}
```

**FE handling:** `OrchestratorChat.tsx` already handles `hitl_request` (line 247). The
`source_agent` field is new — FE can use it to show attribution if desired.

### FE Design Decisions Needed (Discuss with PM)

These UX questions must be resolved before implementation:

1. **HITL attribution:** Show which worker asked the question, or keep it abstract?
2. **Task status indicators:** Show active task badges in the chat UI?
3. **Cancel + re-dispatch visibility:** Show when a non-CLI task was restarted with new context?
4. **Concurrent HITL:** If two workers ask questions at the same time, how does the UI queue them? (Backend will handle sequentially for v1, but UI needs to decide on presentation.)
5. **HITL timeout:** What does the UI show if the user doesn't respond within the timeout window? A "question expired" message?
6. **Context injection confirmation:** When user says "pass that to the scraper," should the UI confirm the action before the orchestrator does it?

---

### 🔴 Conversation Participant Events — agent_joined / agent_left

- **Requested:** 2026-03-26
- **Feature:** Structured SSE progress events that tell the FE which worker kubexes are involved in an orchestrator task
- **Why:** The FE wants to show the orchestrator chat as a group conversation — kubexes "join" when dispatched and "leave" when their sub-task resolves. Currently impossible because the orchestrator stamps its own `agent_id` on all progress events (`mcp_bridge.py:663`, `cli_runtime.py:904`), losing the worker's identity.

**What the orchestrator sends today:**

All progress events have `"agent_id": "orchestrator"`. The worker's agent_id is only inside the free-text `output` string — unreliable for FE parsing.

**What the FE needs:**

Two new progress event types emitted by the orchestrator on its own progress channel (`progress:{orchestrator_task_id}`):

```json
{"type": "agent_joined", "agent_id": "instagram-scraper", "sub_task_id": "task-xxx", "capability": "scrape_instagram"}
```

```json
{"type": "agent_left", "agent_id": "instagram-scraper", "sub_task_id": "task-xxx", "status": "completed", "duration_ms": 4200}
```

**Where to emit in BE code:**

| Event | Trigger | File |
|-------|---------|------|
| `agent_joined` | `kubex__dispatch_task` tool call returns successfully | `mcp_bridge.py` — inside `_call_tool` or equivalent dispatch handler |
| `agent_left` | `kubex__check_task_status` / `kubex__get_task_result` returns a terminal status (`completed`/`failed`/`cancelled`) | `mcp_bridge.py` — inside tool result handler |

These are calls to the existing `_post_progress()` method — no new endpoints needed. The orchestrator already knows the target `agent_id` and `sub_task_id` from the tool call arguments/response.

**For CLI-based orchestrators** (`cli_runtime.py`): The orchestrator runs as a CLI subprocess (Claude Code, Gemini CLI). It doesn't call MCP tools — it writes to stdout. The FE cannot get structured participant events from a CLI orchestrator without a new mechanism (e.g., hook events for dispatch/completion). This is a harder problem and may be deferred.

**FE fallback (works today, no BE change):** The FE already extracts `agent_id` from the result payload via `extractResultContent()`. If the inner JSON contains a non-orchestrator `agent_id`, the FE can show it. This is fragile but covers the common case.

- **Blocker?** Yes — blocks Iteration 96 (conversation participant model)
- **Priority:** Medium — FE has a degraded fallback via result extraction
- **Complexity:** Low for MCP Bridge orchestrators (add 2 `_post_progress` calls). Higher for CLI orchestrators.

---

### 🟡 HITL source_agent Attribution — Not Yet Implemented

- **Requested:** 2026-03-26
- **Feature:** The `hitl_request` SSE event should include `source_agent` field identifying which worker asked the question
- **Design doc:** `docs/design-orchestrator-chat-hitl.md` line 63 specifies this:
  ```json
  {"type": "hitl_request", "prompt": "Which account?", "source_agent": "instagram-scraper"}
  ```
- **Current state:** The HITL forwarding path in `mcp_bridge.py` does not detect worker HITL requests or forward them with `source_agent`. The design is written but not implemented.
- **FE use:** Show which kubex is asking the user a question in the chat UI
- **Blocker?** No — FE can show HITL prompts without attribution (current behavior). But needed for the conversation participant model.
- **Priority:** Medium — tied to Iteration 96
