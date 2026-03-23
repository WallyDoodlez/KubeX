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

---

## Open Bugs

_(None — all known bugs fixed)_

---

## Fixed Bugs

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
