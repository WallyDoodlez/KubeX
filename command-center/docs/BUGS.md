# Bug Tracker

> Tracked bugs for the Command Center frontend. Each bug has a severity, status, and reproduction steps.
> Fix bugs in priority order: P0 (critical) → P1 (high) → P2 (medium) → P3 (low).

## Status Legend
- **OPEN** — confirmed, not yet fixed
- **IN PROGRESS** — actively being worked on
- **FIXED** — fix committed (include commit hash)
- **WONT FIX** — intentional behavior or out of scope
- **BLOCKED** — waiting on backend or external dependency

## Severity
- **P0** — app crashes, data loss, security issue
- **P1** — major feature broken, no workaround
- **P2** — feature partially broken, workaround exists
- **P3** — cosmetic, minor UX annoyance

## Open Bugs

### BUG-007: Chat stuck on "Streaming" — SSE race condition on fast tasks
- **Severity:** P1
- **Status:** OPEN
- **Found:** 2026-03-25
- **Component:** `src/components/OrchestratorChat.tsx` + Backend SSE design
- **Description:** Tasks that complete in < 3 seconds appear stuck on "Streaming..." forever. The task actually completes successfully on the backend — the result is stored and retrievable via `GET /tasks/{id}/result`. The FE eventually polls the result (BUG-001 retry fallback fires) and gets `status: "completed"` back, but still doesn't render the response.
- **Root cause:** Two issues:
  1. **SSE race condition:** The FE dispatches the task (`POST /actions` → 202), receives the task ID, then opens the SSE stream (`GET /tasks/{id}/stream`). But the orchestrator processes fast tasks in ~2 seconds — by the time the FE opens the SSE stream, the progress events have already been published to Redis pub/sub and are gone (pub/sub is fire-and-forget). The SSE stream sees nothing.
  2. **Fallback poll not rendering:** The BUG-001 retry fallback (`handleSSEComplete`) does poll `GET /tasks/{id}/result` and gets a 200 with `status: "completed"`, but the result is not being rendered in the chat. The poll succeeds silently without updating the UI.
- **Evidence:**
  ```
  05:10:52 — POST /actions → 202 (task dispatched)
  05:10:54 — POST /tasks/{id}/progress × 2 (agent publishes progress + result)
  05:10:56 — GET /tasks/{id}/stream (FE opens SSE — 2 seconds too late, events already gone)
  05:14:58 — GET /tasks/{id}/result → 200 (FE fallback poll gets the result but doesn't render it)
  ```
- **Fix needed (two parts):**
  1. **Backend:** Gateway SSE endpoint should check for an existing result in Redis when a client connects. If the task is already complete, immediately emit the result as the first SSE event instead of waiting for a pub/sub message that already fired. This eliminates the race condition.
  2. **Frontend:** `handleSSEComplete` fallback must actually render the result when it gets a `status: "completed"` response from the poll. Currently the result is fetched but not displayed.
- **Workaround:** Send a longer/complex task that takes > 5 seconds to process. The SSE stream opens in time and events arrive normally.

---

## Fixed Bugs

### BUG-006: Tasks dispatch but never complete — Redis disconnected
- **Severity:** P0 — entire task pipeline is broken, no tasks can be processed
- **Status:** FIXED (2026-03-25)
- **Found:** 2026-03-25
- **Fixed:** 2026-03-25
- **Component:** Backend — Gateway / Broker / Redis
- **Description:** Tasks dispatch successfully (HTTP 200 from `POST /actions`) but never reach agents. The SSE stream connects but receives no progress events. Tasks hang forever at "Connecting..." state. The Command Center is unusable for dispatching any work.
- **Root cause:** Gateway health endpoint reports `"redis": {"connected": false}`. The Broker relies on Redis pub/sub to route tasks from the Gateway to agents. With Redis down, published tasks go nowhere. Agents are registered and polling but never receive work. The root cause was a stale Gateway container that had been running for 24 hours and lost Redis connectivity — not a config issue.
- **Discovery:** Found via live E2E test (`E2E_MODE=live`) — `dispatch-response.spec.ts` test 1 dispatched to capability `task_orchestration` (orchestrator agent is registered and running) but no result bubble appeared within 30s timeout. Page snapshot confirmed task was dispatched (real task ID assigned) and SSE connected, but stuck at "Connecting..." with "Waiting for output..."
- **Evidence:**
  ```
  GET http://localhost:8080/health (before fix)
  → {"service":"gateway","version":"0.1.0","status":"healthy","uptime_seconds":85743.9,"redis":{"connected":false}}

  GET http://localhost:8070/agents
  → orchestrator: ['task_orchestration', 'task_management'] (running)  ← agent is registered and healthy
  ```
- **Fix applied:** Executed `docker compose down && docker compose up -d --force-recreate` to recreate all services. Post-fix health check:
  ```
  GET http://localhost:8080/health (after fix)
  → {"service":"gateway","version":"0.1.0","status":"healthy","uptime_seconds":22.49,"redis":{"connected":true}}

  docker compose ps
  → All 10 services healthy (redis, gateway, broker, registry, manager, orchestrator, reviewer, knowledge, instagram-scraper, command-center)
  ```
- **Lesson:** Long-running containers can silently lose connectivity. Regular health monitoring and container restarts are essential for production stability.
- **Fixed in:** Container restart via `docker compose --force-recreate`

---

### BUG-005: Task recovery can permanently lock chat input
- **Severity:** P1
- **Status:** FIXED
- **Found:** 2026-03-24
- **Fixed:** 2026-03-24
- **Component:** `src/components/OrchestratorChat.tsx`
- **Description:** The BUG-004 fix persists `kubex-active-task` to localStorage on dispatch. On remount, the recovery logic sets `sending=true` and attempts to reconnect SSE or poll for the result. If the backend is unreachable, the SSE stream fails, or the task result is in a non-terminal state, `sending` stays `true` forever — the textarea is disabled and the user cannot type.
- **Root cause:** No timeout on the recovery path. If SSE reconnection fails silently (e.g., backend down, CORS error, task ID no longer valid), `handleSSEComplete` fallback may not fire or may also fail, leaving `sending=true` permanently.
- **Fix:**
  1. **Recovery timeout (30s):** The recovery `useEffect` now sets a `setTimeout` of 30 seconds. If `sending` is still `true` after the timeout (no result arrived), the timeout forcibly clears `kubex-active-task`, `streamUrl`, `livePhases`, `terminalLines`, sets `sending=false`, and surfaces an error bubble: "Could not reconnect to previous task."
  2. **Invalid/expired task ID (404):** In the stale-task poll path, if `getTaskResult` returns `!rr.ok` (e.g., 404 Task Not Found), everything is cleared immediately (no attempt to reconnect SSE) and an error bubble is shown.
  3. **SSE exhaustion:** `handleSSEComplete` already clears `kubex-active-task` when retries exhaust (unchanged from BUG-004).
- **Fixed in:** 38dc2ba

### BUG-004: Pending task state lost on navigation
- **Severity:** P2
- **Status:** FIXED
- **Found:** 2026-03-24
- **Fixed:** 2026-03-24
- **Component:** `src/components/OrchestratorChat.tsx`
- **Description:** When a task is in-flight (streaming/pending), navigating away from the chat page and coming back loses all pending state — the typing indicator, SSE connection, and task tracking disappear.
- **Root cause:** `sending`, `streamUrl`, `activeTaskIdRef`, `terminalLines`, and the SSE connection are all ephemeral React state/refs. Component unmount kills the SSE EventSource and clears all state. On remount there is no record of the in-flight task.
- **Fix:** Persist active task context (`taskId`, `capability`, `message`, `startedAt`) to `kubex-active-task` in localStorage on dispatch. On component mount, check for a stored task. If younger than 5 minutes, reconnect the SSE stream; if older, poll `getTaskResult` for a completed result and fall back to SSE if still running. Clear `kubex-active-task` on every terminal event (result/completed/failed/cancelled) in `handleSSEMessage` and `handleSSEComplete`. Added `[data-testid="task-recovery-indicator"]` element shown while reconnecting.
- **Fixed in:** b7d4560

### BUG-003: OrchestratorChat dispatches to wrong capability name
- **Severity:** P1
- **Status:** FIXED
- **Found:** 2026-03-24
- **Fixed:** 2026-03-24
- **Component:** `src/components/OrchestratorChat.tsx`
- **Description:** Messages sent from the orchestrator chat dispatch to capability `orchestrate`, but the orchestrator agent listens on `task_orchestration`. Tasks are published to the Broker under the wrong stream key and never consumed. The chat shows "Streaming..." indefinitely.
- **Root cause:** `OrchestratorChat.tsx` uses `orchestrate` as the default/fallback capability (see `retryCapability` logic), but the orchestrator agent registers with capabilities `['task_orchestration', 'task_management']`. The Broker publishes to a stream keyed by the capability name, so the message lands in `orchestrate` (which nobody reads) instead of `task_orchestration`.
- **Reproduction:**
  1. Open Command Center → Orchestrator Chat
  2. Send any message (e.g. "hello")
  3. Observe: "Streaming..." forever
  4. Check Broker logs: `capability: "orchestrate"` published
  5. Check orchestrator logs: polling `task_orchestration` — never picks up the task
- **Fix:** Changed default capability in `OrchestratorChat.tsx` from `"orchestrate"` to `"task_orchestration"` in `handleSend`, `retryCapability` guards (×2), and the Advanced panel placeholder. Updated corresponding E2E test helpers and comments across 7 test files.

### BUG-001: OrchestratorChat shows no response after task dispatch
- **Severity:** P1
- **Status:** FIXED
- **Found:** 2026-03-23
- **Component:** `src/components/OrchestratorChat.tsx`
- **Description:** When dispatching a task (e.g. `knowledge_management` + "test"), the chat shows "Streaming..." but never displays the result. The task actually completes on the backend but the frontend misses it.
- **Root cause:** Two issues:
  1. ~~The SSE stream (`/tasks/{id}/stream`) returns empty — the agent writes its result directly to Redis without publishing progress events to the `progress:{task_id}` pub/sub channel. So EventSource gets no `data:` frames.~~ **WRONG — agents DO publish progress events.** The real issue: agents send `{final: true}` on completion, but the SSE endpoint only checked for `{type: "result"}` which agents never send. So progress chunks arrived fine but the stream never terminated.
  2. The fallback in `handleSSEComplete` does only **one** `getTaskResult` fetch. If the task hasn't completed by that moment, the result is lost. No retry loop.
- **Reproduction:**
  1. Go to /chat
  2. Enter capability: `knowledge_management`, message: "test"
  3. Click Send
  4. Observe: spinner shows "Streaming..." then "Waiting for result..." then nothing
  5. Meanwhile, `curl http://localhost:8080/tasks/{id}/result` returns the completed result
- **Backend fix (DONE):** Gateway SSE endpoint `stream_task_progress` now also breaks on `final: true` in addition to `type: "result"`. This means the SSE stream properly closes when an agent finishes its task. File: `services/gateway/gateway/main.py` line 701.
- **Frontend fix (DONE):** Replaced single `getTaskResult` fetch in `handleSSEComplete` with a 4-attempt retry loop at 2-second intervals. Loop exits early when task reaches a terminal status (`completed`/`failed`/`cancelled`); surfaces error message only after all retries are exhausted.
- **Workaround:** N/A — fixed
- **Fixed in:** 16bdd8b

### BUG-002: Manager bind-mount paths use container-internal paths instead of host paths
- **Severity:** P0 — prevents all spawned containers from booting on Windows/Mac
- **Status:** FIXED (2026-03-23)
- **Found:** 2026-03-23
- **Component:** `services/kubex-manager/lifecycle.py`
- **Description:** Containers spawned by the Manager crash immediately on Windows/Mac with `IsADirectoryError: [Errno 21] Is a directory: '/app/config.yaml'`. Docker creates empty directories when a bind-mount source path does not exist on the host.
- **Root cause:** The Manager runs inside Docker at `/app/`. When calling `docker.containers.create()`, it passed its own container-internal paths (e.g., `/app/configs/agent.yaml`) as bind-mount source paths. Docker needs HOST paths — on Windows/Mac the host filesystem does not have an `/app/` hierarchy, so Docker silently creates empty mount directories instead of mounting the intended files.
- **Affected locations:** All 4 bind-mount locations in `lifecycle.py`: config YAML mount, credentials mount, skill mounts, and hook settings mount.
- **Fix:** Added `_to_host_path()` helper function and `KUBEX_HOST_PROJECT_DIR` environment variable. At spawn time, any bind-mount source starting with `/app/` is translated to `${KUBEX_HOST_PROJECT_DIR}/...` so Docker receives the correct host-side absolute path.
- **Reproduction:**
  1. Run the stack on Windows or Mac
  2. Dispatch a task to any capability
  3. Observe: Manager spawns a container that immediately exits
  4. `docker logs <container>` shows `IsADirectoryError: [Errno 21] Is a directory: '/app/config.yaml'`
- **Workaround:** None — all agent spawns fail without this fix on non-Linux hosts.
- **Fixed in:** See `git log --oneline --grep="host path"` for relevant commits

---

## Template

```markdown
### BUG-XXX: Short description
- **Severity:** P0/P1/P2/P3
- **Status:** OPEN / IN PROGRESS / FIXED / WONT FIX / BLOCKED
- **Found:** YYYY-MM-DD
- **Component:** file path
- **Description:** What happens vs what should happen
- **Root cause:** Why it happens (if known)
- **Reproduction:** Steps to reproduce
- **Fix needed:** What needs to change
- **Workaround:** Any temporary workaround
- **Fixed in:** commit hash (when resolved)
```
