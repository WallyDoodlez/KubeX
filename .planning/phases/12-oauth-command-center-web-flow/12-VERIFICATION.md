---
phase: 12-oauth-command-center-web-flow
verified: 2026-03-23T00:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 12: OAuth Command Center Web Flow — Verification Report

**Phase Goal:** Users can provision CLI agent OAuth tokens through the Command Center web UI without docker exec, and tasks dispatched to CLI agents are pre-flight checked for token expiry (at the agent level)
**Verified:** 2026-03-23
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Gateway SSE endpoint streams lifecycle state transitions for a given agent | VERIFIED | `stream_agent_lifecycle` at line 742 of `services/gateway/gateway/main.py`; subscribes to `lifecycle:{agent_id}` on Redis DB 0; yields `data: {message}\n\n` |
| 2 | Gateway SSE endpoint rejects unauthenticated requests with 401 | VERIFIED | `Depends(verify_token)` on line 740; `verify_token` raises HTTP 401 for missing/wrong Bearer token; test `test_auth_required_no_header_returns_401` and `test_auth_required_wrong_token_returns_401` both PASS |
| 3 | Manager credential injection writes to the correct filesystem path for all runtimes | VERIFIED | `cred_paths` dict at lines 544-548 of `services/kubex-manager/kubex_manager/main.py` has: `claude-code` → `/root/.claude/.credentials.json`, `codex-cli` → `/root/.codex/.credentials.json`, `gemini-cli` → `/root/.gemini/oauth_creds.json`; the previously incorrect `/root/.config/gemini/credentials.json` is absent |
| 4 | A CLI agent with no credentials rejects dispatched tasks and transitions to CREDENTIAL_WAIT state | VERIFIED | `_execute_task_inner` lines 467-471 of `cli_runtime.py` call `_credentials_present()` and transition to `CliState.CREDENTIAL_WAIT` then `_credential_gate()` when credentials missing; 22 credential pre-flight tests PASS |
| 5 | FE team can build the OAuth provisioning UI from the handoff doc alone | VERIFIED | `docs/HANDOFF-phase12-oauth-fe.md` (452 lines) contains all API contracts, curl examples, JS fetch() code example, Mermaid sequence diagram, edge cases, and error code reference |
| 6 | Pre-flight credential check behavior is documented for FE | VERIFIED | Handoff doc explicitly describes AUTH-03 agent-side behavior: "one task may fail before `credential_wait` state transition is visible" |
| 7 | All API contracts are documented with request/response schemas and curl examples | VERIFIED | Handoff doc contains contracts for `GET /agents/{agent_id}/lifecycle`, `POST /kubexes/{kubex_id}/credentials`, `GET /kubexes`, `GET /kubexes/{kubex_id}`, `POST /kubexes`; all include method, path, schema, curl, errors |

**Score:** 7/7 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/gateway/gateway/main.py` | `stream_agent_lifecycle` SSE endpoint | VERIFIED | Function exists at line 742; subscribes to Redis DB 0 `lifecycle:{agent_id}` channel; returns `StreamingResponse` with `text/event-stream` |
| `services/gateway/gateway/main.py` | `verify_token` Bearer auth dependency | VERIFIED | Function exists at line 49; uses `_BEARER_SCHEME` (HTTPBearer) and `_MGMT_TOKEN` from `KUBEX_MGMT_TOKEN` env var; raises 401 on failure |
| `services/kubex-manager/kubex_manager/main.py` | Corrected gemini-cli credential path | VERIFIED | Line 547: `"gemini-cli": "/root/.gemini/oauth_creds.json"` with comment confirming correction; `/root/.config/gemini/credentials.json` absent |
| `tests/unit/test_gateway_endpoints.py` | `TestLifecycleSSE` class with SSE and auth tests | VERIFIED | Class at line 353; 5 tests covering: no-auth 401, wrong-token 401, valid-auth event-stream 200, Redis unavailable error event, Redis message streaming — all PASS |
| `tests/unit/test_kubex_manager_unit.py` | `TestCredentialInjectionPaths` class | VERIFIED | Class at line 1533; 4 tests: gemini-cli correct path, claude-code correct path, codex-cli correct path, unknown runtime 422 — all PASS |
| `docs/HANDOFF-phase12-oauth-fe.md` | Complete FE handoff document | VERIFIED | File exists, 452 lines; contains `## API Contracts`, Mermaid sequence diagram, `New in Phase 12` endpoint table, EventSource limitation note, AUTH-03 edge case |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `services/gateway/gateway/main.py` | Redis DB 0 | `gateway.redis_db0.pubsub()` subscribe `lifecycle:{agent_id}` | WIRED | Line 759: `pubsub = gateway.redis_db0.pubsub()`; line 758: `channel = f"lifecycle:{agent_id}"` |
| `services/gateway/gateway/main.py` | `KUBEX_MGMT_TOKEN` | `verify_token` dependency on SSE endpoint | WIRED | Line 740: `dependencies=[Depends(verify_token)]`; `verify_token` reads `_MGMT_TOKEN = os.environ.get("KUBEX_MGMT_TOKEN", "kubex-mgmt-token")` |
| `agents/_base/kubex_harness/cli_runtime.py` | `CliState.CREDENTIAL_WAIT` | `_execute_task_inner` pre-flight credential check | WIRED | Lines 467-471: `if not self._credentials_present(...)` → `self._state = CliState.CREDENTIAL_WAIT` → `await self._publish_state(CliState.CREDENTIAL_WAIT)` → `await self._credential_gate()` |
| `docs/HANDOFF-phase12-oauth-fe.md` | `services/gateway/gateway/main.py` | Documents `GET /agents/{agent_id}/lifecycle` | WIRED | Handoff doc line 27: `GET /agents/{agent_id}/lifecycle` marked "New in Phase 12"; line 60 full contract section present |
| `docs/HANDOFF-phase12-oauth-fe.md` | `services/kubex-manager/kubex_manager/main.py` | Documents `POST /kubexes/{id}/credentials` | WIRED | Handoff doc line 28: `POST /kubexes/{kubex_id}/credentials` with corrected path schemas documented |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUTH-01 | 12-01, 12-02 | Command Center web UI triggers OAuth flow for target container | SATISFIED | Gateway SSE endpoint `GET /agents/{agent_id}/lifecycle` allows UI to observe lifecycle state; FE handoff doc provides complete integration guide |
| AUTH-02 | 12-01, 12-02 | Token forwarded from Command Center to container via Manager POST /kubexes/{id}/credentials with corrected credential paths | SATISFIED | Manager `cred_paths` dict corrected; gemini-cli now `/root/.gemini/oauth_creds.json`; all 3 runtime paths unit-tested and verified correct |
| AUTH-03 | 12-01 | Agent-side pre-flight credential check rejects tasks when credentials are missing or expired, transitioning to CREDENTIAL_WAIT | SATISFIED | `_execute_task_inner` pre-flight check at lines 467-471; 22 credential pre-flight tests pass; AUTH-03 behavior documented in handoff doc |

**Orphaned requirements check:** REQUIREMENTS.md maps only AUTH-01, AUTH-02, AUTH-03 to Phase 12. Both plans declare these same IDs. No orphaned requirements.

---

## Anti-Patterns Found

No anti-patterns detected in modified files. Scanned: `services/gateway/gateway/main.py`, `services/kubex-manager/kubex_manager/main.py`, `tests/unit/test_gateway_endpoints.py`, `tests/unit/test_kubex_manager_unit.py`, `docs/HANDOFF-phase12-oauth-fe.md`.

No TODOs, FIXMEs, placeholders, stub returns, or hardcoded empty data structures found in any modified file.

---

## Test Suite Results

Full unit suite run as regression check:

```
649 passed, 4 skipped, 0 failed
```

The 4 skips are `pexpect`-dependent PTY tests that require a Unix PTY — expected on the Windows dev machine, unrelated to Phase 12 work.

Targeted suite results:
- `TestLifecycleSSE`: 5/5 passed
- `TestCredentialInjectionPaths`: 4/4 passed
- `test_cli_runtime.py -k credential`: 22/22 passed

---

## Human Verification Required

### 1. End-to-end OAuth provisioning via Command Center UI

**Test:** Using the Command Center UI, click "Authorize Agent" for a running CLI agent, complete the OAuth flow in the browser popup, and confirm the agent transitions from `credential_wait` to `ready` state visible in the UI.
**Expected:** The SSE stream shows `credential_wait` → `ready` state transition; the agent accepts subsequent task dispatches.
**Why human:** Browser-side `fetch()` + `ReadableStream` SSE integration requires a running browser, running container, and live OAuth provider — cannot be verified from the codebase alone.

### 2. Token expiry re-auth cycle

**Test:** Let a CLI agent's OAuth token expire in a running container, then dispatch a task to it. Observe the UI shows `credential_wait`. Re-inject credentials via the Command Center. Observe the agent resumes.
**Expected:** One task fails with `credential_wait` transition visible in SSE (per D-09 one-failure allowance), then agent returns to `ready` after credential re-injection.
**Why human:** Requires a running container with a live expired token; the timing of credential expiry and re-auth cannot be simulated in unit tests.

---

## Summary

Phase 12 goal is fully achieved. The codebase contains:

1. A working Gateway SSE endpoint (`GET /agents/{agent_id}/lifecycle`) that streams lifecycle state transitions from Redis DB 0 pub/sub, protected by Bearer auth — satisfying AUTH-01.
2. Corrected credential injection paths in the Manager for all three runtimes (claude-code, codex-cli, gemini-cli) — satisfying AUTH-02. The previously incorrect gemini-cli path (`/root/.config/gemini/credentials.json`) is fixed to `/root/.gemini/oauth_creds.json`, matching `CREDENTIAL_PATHS` in `cli_runtime.py`.
3. An existing, tested agent-side pre-flight in `_execute_task_inner` that blocks task execution when credentials are absent and transitions the agent to `CREDENTIAL_WAIT` — satisfying AUTH-03 per the D-09 decision (agent-side check is sufficient; no Gateway dispatch-time check needed).
4. A complete FE handoff document (`docs/HANDOFF-phase12-oauth-fe.md`) with all API contracts, Mermaid flow diagram, EventSource limitation note with working JS code example, and edge case documentation.

All 5 phase commits are present (39f814f, 28aab1d, 0c588cc, 4f5c7a7, 10e6523). No regressions. No stubs. Zero failing tests.

---

_Verified: 2026-03-23_
_Verifier: Claude (gsd-verifier)_
