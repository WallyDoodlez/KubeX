# Pipeline Fix Plan — Make Command Center → Orchestrator Work E2E

> **Goal:** The Command Center can dispatch a task to the orchestrator, see progress, get the result back, and handle errors — reliably, every time.
>
> **Source:** `docs/PIPELINE-AUDIT.md` (65 issues from 4-agent audit)
> **Prerequisite reading:** This file + `docs/PIPELINE-AUDIT.md`

---

## What Works Today

- Gateway accepts dispatch (POST /actions → 202) ✓
- Broker publishes to Redis stream ✓
- Orchestrator (MCP Bridge) consumes from correct endpoint ✓
- Orchestrator calls LLM via Gateway proxy ✓
- Orchestrator posts progress to Gateway ✓
- Orchestrator stores result in Broker (correct URL) ✓
- Gateway SSE has BUG-007 cached result fix ✓
- Redis pool bumped to 50 ✓

## What Breaks

1. **LLM proxy 500s** — Gateway Redis pool exhaustion crashes budget tracking mid-proxy (MaxConnectionsError). Pool was bumped to 50 but budget tracker errors should be non-fatal.
2. **SSE race condition** — Fast tasks (<3s) complete before FE opens SSE. BUG-007 fix helps but only for late-connecting clients.
3. **Consumer group stale messages** — New groups start at id="0", replaying thousands of old messages before reaching new ones.
4. **LLM errors stored as "completed"** — MCP Bridge/Standalone always write `status: completed` even when LLM returns 500.
5. **Silent error swallowing** — Result/progress POST failures eaten by bare `except: pass`.
6. **CLI Runtime results go to wrong URL** — Posts to Gateway instead of Broker. Results never stored. (Blocks CLI agents, not orchestrator.)
7. **CLI Runtime registers via wrong URL** — Posts to Gateway `/registry/agents` which doesn't exist. (Blocks CLI agents, not orchestrator.)
8. **No capability validation** — Any capability string accepted. Dead capabilities silently queue forever.
9. **handle_pending() dead code** — Stuck messages never retried or DLQ'd.
10. **Ghost registrations** — No heartbeat, no TTL, crashed agents stay RUNNING forever.

## Prioritized Fix Waves

### Wave 1: Make Orchestrator Flow Work (Critical Path)

These fixes unblock the Command Center → Orchestrator → Result → UI flow.

**1.1 — Budget tracker error should not crash the LLM proxy**
- File: `services/gateway/gateway/main.py` ~line 1075
- Fix: Wrap `budget_tracker.increment_tokens()` in try/except — log warning, don't crash the proxy response. The LLM call already succeeded at that point.
- Audit ref: Gateway Redis pool exhaustion

**1.2 — MCP Bridge: store `status: "failed"` on LLM errors**
- File: `agents/_base/kubex_harness/mcp_bridge.py` ~line 674
- Fix: When `_call_llm()` raises, store `status: "failed"` with the error message, not `status: "completed"`.
- Audit ref: P0-8

**1.3 — Standalone: store `status: "failed"` on LLM errors**
- File: `agents/_base/kubex_harness/standalone.py` ~line 558
- Fix: Same as 1.2.
- Audit ref: P0-8

**1.4 — Consumer group creation: use `id="$"` not `id="0"`**
- File: `services/broker/broker/streams.py` ~line 48
- Fix: Change `id="0"` to `id="$"` in `ensure_stream_and_group`. New consumer groups only see future messages.
- Audit ref: P1-13

**1.5 — Trim existing stream and reset consumer groups**
- One-time script: trim `boundary:default` to last 100 messages, reset all consumer group cursors to `$`.
- Prevents old message backlog from blocking new tasks.

**1.6 — SSE: ensure `final=True` progress event is always emitted**
- File: `agents/_base/kubex_harness/mcp_bridge.py` ~line 655-660
- Verify: MCP Bridge already sends `final=True` on completion. Confirm this reaches the SSE stream correctly.
- The SSE close condition checks `data.get("final") is True` — this should work for MCP Bridge. Verify with trace.

### Wave 2: Fix CLI Agent Pipeline (Unblocks claude-test kubex)

**2.1 — CLI Runtime: post results to Broker, not Gateway**
- File: `agents/_base/kubex_harness/cli_runtime.py` ~line 594, 611
- Fix: Change `self.config.gateway_url` to `self.config.broker_url` in `_post_result_success` and `_post_result_failed`.
- Audit ref: P0-6

**2.2 — CLI Runtime: register/deregister via Registry, not Gateway**
- File: `agents/_base/kubex_harness/cli_runtime.py` ~line 426, 448
- Fix: Use `self.config.registry_url` (or add it to config) instead of `self.config.gateway_url`. The endpoint is `POST /agents` on Registry port 8070.
- Check: Does `AgentConfig` have a `registry_url` field? If not, add it. Standalone already uses it correctly.
- Audit ref: P0-12

**2.3 — CLI Runtime: emit `final=True` progress event on task completion**
- File: `agents/_base/kubex_harness/cli_runtime.py`
- Fix: After `_post_result_success/failed`, call `_post_progress(task_id, "", final=True, exit_reason=...)` so SSE stream closes.
- Audit ref: P1-26

**2.4 — CLI Runtime: use consistent progress schema**
- File: `agents/_base/kubex_harness/cli_runtime.py` ~line 886
- Fix: Use `{"chunk": content, "final": false}` instead of `{"action": "progress_update", "content": content}`. Match Standalone/MCP Bridge format.
- Audit ref: P2-56

**2.5 — Harness: post results to Broker, not Gateway**
- File: `agents/_base/kubex_harness/harness.py` ~line 467
- Fix: Same as 2.1 for the legacy harness.
- Audit ref: P0-7

**2.6 — Inject REGISTRY_URL into spawned containers**
- File: `services/kubex-manager/kubex_manager/lifecycle.py`
- Fix: Add `env["REGISTRY_URL"]` from Manager's env, similar to how BROKER_URL and GATEWAY_URL are already injected.

### Wave 3: Reliability & Cleanup

**3.1 — Activate handle_pending() as periodic reaper**
- File: `services/broker/broker/main.py`
- Fix: Add an `on_startup` background task that calls `handle_pending()` for all known consumer groups every 60 seconds.
- Audit ref: P0-1

**3.2 — Fix xclaim to re-deliver properly**
- File: `services/broker/broker/streams.py` ~line 188
- Fix: After xclaim, the re-delivered message should be consumed via `xreadgroup` with id `0` (pending entries), not `>` (new only). Or use `xautoclaim` which handles this correctly.
- Audit ref: P1-16

**3.3 — Add MAXLEN to audit:messages stream**
- File: `services/broker/broker/streams.py` ~line 238
- Fix: Add `maxlen=10000, approximate=True` to the `xadd` call.
- Audit ref: P2-44

**3.4 — Gateway: validate capability against Registry before dispatch**
- File: `services/gateway/gateway/main.py` ~line 294-320
- Fix: Before publishing to Broker, call Registry to check if any agent has the capability. Return 404 if none. (Per Phase 13 D-01 decision.)
- Audit ref: P0-4

**3.5 — Stop silently swallowing result/progress POST failures**
- Files: All agent files
- Fix: Replace `except Exception: pass` / `logger.debug()` on result/progress POSTs with `logger.warning()`. Don't retry (avoid blocking), but make failures visible.
- Audit ref: P1-25

**3.6 — Budget tracker: non-fatal on error**
- File: `services/gateway/gateway/main.py` ~line 113-115
- Fix: When `budget_tracker` is not None but the Redis call fails, catch the exception and log a warning instead of crashing the request with 500.
- Audit ref: P2-51

### Wave 4: Agent Lifecycle Hardening

**4.1 — Manager: call load_from_redis() on startup**
- File: `services/kubex-manager/kubex_manager/main.py` ~line 652-667
- Fix: Call `lifecycle.load_from_redis()` in `on_startup()`.
- Audit ref: P1-38

**4.2 — Manager: deregister on remove/restart/respawn**
- Files: `lifecycle.py`, `main.py`
- Fix: `remove_kubex()` should stop the container and deregister. `restart_kubex()` should deregister before restart. `respawn_kubex()` should deregister old agent.
- Audit ref: P1-35, P1-36, P1-37

**4.3 — Harness: fix Redis connection leak**
- File: `agents/_base/kubex_harness/harness.py` ~line 297
- Fix: Add `await redis_client.aclose()` in the finally block of `_listen_for_cancel`.
- Audit ref: P1-29

---

## Out of Scope (Phase 13 proper or future)

- Heartbeat/TTL on registrations (Phase 13 D-08)
- `/errors` endpoint and error event model (Phase 13 D-04 through D-07)
- Enhanced `/health` with degraded states (Phase 13 D-12)
- Per-capability streams (architectural rework — too big for this pass)
- Unique consumername per agent instance (correct fix needs config change)
- Rate limiter atomic fix (Lua script — low priority)
- Identity cache spoofing window (security hardening — separate phase)

---

## How to Execute

1. Read this file + `docs/PIPELINE-AUDIT.md` for full context
2. Execute waves 1-4 sequentially (wave 1 first — unblocks orchestrator)
3. After each wave: run `python -m pytest tests/ -x -q`, rebuild affected images, test with trace tool
4. After wave 2: test CLI agent (test-cli-claude) end-to-end
5. After all waves: push, update BUGS.md (close BUG-007), update Phase 13 context

---

## Verification

After all waves, these scenarios must work:

1. **Orchestrator happy path:** Send message in Command Center → orchestrator responds → result visible in chat (no "Streaming" hang)
2. **Orchestrator LLM error:** Gateway proxy returns 500 → result shows as failed (not "completed")
3. **CLI agent happy path:** Dispatch to claude-test → agent picks up → executes → result visible
4. **Fast task race:** Task completes in <2s → SSE cached result delivers immediately
5. **Stale messages:** New consumer group doesn't replay old messages
6. **Agent crash:** Kill an agent container → task doesn't hang forever (reaper moves to DLQ)

Run `python scripts/trace.py` during all tests to verify events flow correctly.
