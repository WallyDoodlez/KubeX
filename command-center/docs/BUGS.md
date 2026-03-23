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

### BUG-001: OrchestratorChat shows no response after task dispatch
- **Severity:** P1
- **Status:** OPEN
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
- **Fix still needed (frontend):** The retry loop in `handleSSEComplete` is still recommended as a safety net — if SSE disconnects before the final event (network hiccup, timeout), the frontend should retry `getTaskResult` 3-5 times at 2s intervals before giving up.
- **Workaround:** Refresh the page and check traffic log — the dispatch entry is recorded

---

## Fixed Bugs

_(None yet — move bugs here when fixed, include commit hash)_

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
