---
phase: 09-cli-runtime-claude-code
verified: 2026-03-22T12:00:00Z
status: passed
score: 5/5 must-haves verified
gaps: []
human_verification:
  - test: "Start a container with runtime: claude-code and no ~/.claude/.credentials.json present"
    expected: "Container transitions to CREDENTIAL_WAIT, surfaces a request_user_input HITL prompt asking the user to run docker exec ... claude auth login"
    why_human: "Requires a live Docker environment with the kubexclaw-base image built from the updated Dockerfile. Cannot simulate OAuth credential absence or the HITL dispatch chain with unit tests alone."
  - test: "After OAuth credential via docker exec, verify container transitions to READY and picks up tasks from the broker"
    expected: "Container publishes READY on lifecycle:{agent_id} Redis channel, begins polling broker, executes a task via claude -p"
    why_human: "Requires a running Redis, gateway, and broker. The credential watcher (watchfiles awatch) triggers on the real filesystem. Cannot unit test the live PTY-to-Claude-Code path on Windows."
  - test: "Send SIGTERM to a running claude-code container that has an active PTY child"
    expected: "PTY child receives SIGTERM, container waits up to 5 seconds, then exits cleanly with no orphaned processes"
    why_human: "PTY signal forwarding requires tini as PID 1 in a real container. Signal propagation through tini -> entrypoint -> python harness -> pexpect child cannot be verified without a running container."
  - test: "Restart a claude-code container that already has a valid ~/.claude/.credentials.json"
    expected: "Container goes directly to READY without triggering HITL re-auth (token persisted via named Docker volume)"
    why_human: "Named Docker volume persistence across container restarts is an infrastructure concern — the lifecycle.py code is verified, but round-trip persistence requires a live Docker daemon and named volume."
---

# Phase 9: CLI Runtime — Claude Code Verification Report

**Phase Goal:** Any Kubex container can run Claude Code as its LLM via PTY subprocess, with credential management, graceful shutdown, and skills injected as CLAUDE.md
**Verified:** 2026-03-22
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A container configured with `runtime: claude-code` launches Claude Code via PTY and picks up tasks from the broker without additional manual steps | VERIFIED | `main.py` routes to `CLIRuntime` when `config.runtime != "openai-api"` (line 72). `CLIRuntime._task_loop()` polls broker at `/tasks/next`. `_build_command()` produces `["claude", "-p", ...]`. |
| 2 | On first launch with no OAuth token, the container surfaces a re-auth prompt via `request_user_input` HITL and transitions to READY once credentials confirmed | VERIFIED | `_credential_gate()` calls `_request_hitl()` which POSTs to `/actions` with `request_user_input` (line 718). `_wait_for_credentials()` uses watchfiles with polling fallback. State published: CREDENTIAL_WAIT then READY. |
| 3 | OAuth tokens survive container restarts via named Docker volumes; restarted container with valid token goes directly to READY | VERIFIED | `lifecycle.py` adds `kubex-creds-{agent_id}` volume bound to `/root/.claude` with `mode=rw` (lines 431-434). `CLI_CREDENTIAL_MOUNTS` maps `"claude-code"` to `/root/.claude`. `_credentials_present()` checks file existence + non-zero size. |
| 4 | Sending SIGTERM to the container forwards the signal to the PTY child, waits up to 5 seconds, issues SIGKILL if needed, exits cleanly | VERIFIED | `main.py` wires `SIGTERM`/`SIGINT` to `runtime.stop()` via `loop.add_signal_handler` (lines 86-88). `_graceful_shutdown()` calls `child.terminate(force=False)`, waits 5s in 0.1s increments, then `child.terminate(force=True)`. tini is PID 1 in Dockerfile (line 49: `ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]`). |
| 5 | Skill files injected at spawn appear as CLAUDE.md inside the container and are picked up by Claude Code at session start | VERIFIED | `entrypoint.sh` step 4b generates `/app/CLAUDE.md` from skill files when `RUNTIME != "openai-api"` (lines 93-123). `_run_cli_process` spawns with `cwd="/app"` so Claude Code sees CLAUDE.md. `pexpect watchfiles` injected as boot-time pip deps in `lifecycle.py`. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `agents/_base/kubex_harness/cli_runtime.py` | CLIRuntime class with full state machine, PTY spawn, credential gate, failure detection, signal forwarding | VERIFIED | 765 lines. All required methods present. Exports `CLIRuntime`, `CliState`, `CREDENTIAL_PATHS`, `FAILURE_PATTERNS`, `MAX_OUTPUT_BYTES`. |
| `agents/_base/kubex_harness/main.py` | CLI runtime routing branch before harness_mode routing | VERIFIED | `if config.runtime != "openai-api":` at line 72, before `harness_mode == "standalone"` at line 93. Signal handlers wired. `await runtime.run()` + `return`. |
| `agents/_base/Dockerfile` | tini as PID 1, exec-form ENTRYPOINT | VERIFIED | `tini` in apt-get install (line 9). `ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]` (line 49). `LABEL kubex.stop_grace_period="30s"` (line 47). |
| `agents/_base/entrypoint.sh` | CLAUDE.md generation from skill files for CLI runtimes | VERIFIED | Step 4b (lines 93-123). Reads `runtime` from config.yaml. Generates `/app/CLAUDE.md` by concatenating SKILL.md files when `RUNTIME != "openai-api"`. |
| `services/kubex-manager/kubex_manager/lifecycle.py` | Named volume mounting for CLI runtimes + pip deps injection | VERIFIED | `CLI_CREDENTIAL_MOUNTS` dict at line 48. `volumes[volume_name] = {"bind": cred_mount, "mode": "rw"}` at line 434. `KUBEX_PIP_DEPS` set to `"pexpect watchfiles"` for non-openai-api runtimes (lines 381-386). |
| `docker-compose.yml` | Named volume declaration comment for dynamically-created CLI credential volumes | VERIFIED | Lines 16-20 contain operator comment about `kubex-creds-{agent_id}` dynamic volumes. |
| `.gitignore` | Credential path exclusion | VERIFIED | Contains `.credentials.json` (line 48), `.claude/` (line 50), `.codex/` (line 51), `.config/gemini/` (line 52). |
| `tests/unit/test_cli_runtime.py` | Full unit test coverage for CLIRuntime (24+ tests) | VERIFIED | 943 lines. 16 top-level test functions + 12 test classes with 48 class-based methods = 87 total tests collected, all passing. |
| `tests/unit/test_kubex_manager_unit.py` | Named volume test for CLI runtimes | VERIFIED | `TestCliRuntimeNamedVolumes` class (line 1338) with `test_named_volume_for_cli_runtime` and `test_no_volume_for_openai_api`. Both pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `main.py` | `cli_runtime.py` | `from kubex_harness.cli_runtime import CLIRuntime` when `runtime != "openai-api"` | WIRED | Lazy import at line 73. Routing block precedes harness_mode dispatch. |
| `cli_runtime.py` | `redis pub/sub lifecycle:{agent_id}` | `_publish_state` method | WIRED | `channel = f"lifecycle:{self.config.agent_id}"` at line 667. Publishes JSON with agent_id, state, timestamp. Exception-swallowed. |
| `cli_runtime.py` | `Gateway POST /actions` | `_request_hitl` method for credential HITL | WIRED | `url = f"{self.config.gateway_url}/actions"` at line 718. Posts `request_user_input` action. |
| `cli_runtime.py` | `Gateway POST /tasks/{task_id}/progress` | `_post_progress` method | WIRED | `url = f"{self.config.gateway_url}/tasks/{task_id}/progress"` at line 691. |
| `cli_runtime.py` | `Broker GET /tasks/next` | `_poll_broker` / `_task_loop` method | WIRED | `poll_url = f"{self.config.broker_url}/tasks/next"` at line 364. |
| `lifecycle.py` | `agents/_base/Dockerfile` | Named volume mounts to `/root/.claude` in container built from Dockerfile | WIRED | `volumes["kubex-creds-{agent_id}"] = {"bind": "/root/.claude", "mode": "rw"}` maps to the directory tini-protected container uses. |
| `tests/unit/test_cli_runtime.py` | `cli_runtime.py` | `from kubex_harness.cli_runtime import CLIRuntime, CliState, CREDENTIAL_PATHS, FAILURE_PATTERNS, MAX_OUTPUT_BYTES` | WIRED | All public symbols imported and exercised in tests. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| CLI-01 | 09-00, 09-02, 09-03 | PTY-based subprocess launch for any configured CLI agent (runtime field in config.yaml) | SATISFIED | `_run_cli_process()` uses `pexpect.spawn()`. `_build_command()` constructs `claude -p` invocation. `main.py` routes on `config.runtime`. |
| CLI-02 | 09-00, 09-02, 09-03 | Credential check at startup with HITL re-auth via `request_user_input` | SATISFIED | `_credentials_present()` checks file existence + size. `_credential_gate()` triggers `_request_hitl()`. `_wait_for_credentials()` with watchfiles + polling fallback. |
| CLI-03 | 09-00, 09-02, 09-03 | Failure pattern detection with typed reason in task_failed payload | SATISFIED | `FAILURE_PATTERNS` dict covers `auth_expired`, `subscription_limit`, `runtime_not_available`. `_classify_failure()` returns typed reason or `cli_crash`. `_execute_task()` includes reason in failure result payload. |
| CLI-04 | 09-01, 09-03 | SIGTERM handler: forward to PTY child, wait 5s, SIGKILL, exit; tini as PID 1 | SATISFIED | tini in Dockerfile at line 49. Signal handlers in `main.py` (line 86-88). `_graceful_shutdown()` implements two-phase termination with 5s grace period. |
| CLI-05 | 09-01 | Skills injected as CLAUDE.md at spawn time | SATISFIED | `entrypoint.sh` step 4b generates `/app/CLAUDE.md` from skill files for non-openai-api runtimes. `pexpect watchfiles` boot-time pip deps injected by lifecycle.py. |
| CLI-06 | 09-01, 09-03 | Named Docker volumes for OAuth token persistence across restarts | SATISFIED | `CLI_CREDENTIAL_MOUNTS` + `kubex-creds-{agent_id}` in `lifecycle.py`. Both named volume tests pass in `TestCliRuntimeNamedVolumes`. |
| CLI-07 | 09-00, 09-02, 09-03 | Container lifecycle state machine: BOOTING -> CREDENTIAL_WAIT -> READY <-> BUSY with Redis pub/sub events | SATISFIED | `CliState` enum has all 4 states. `_publish_state()` publishes to `lifecycle:{agent_id}`. State transitions in `run()`, `_credential_gate()`, `_task_loop()`. |
| CLI-08 | 09-00, 09-02, 09-03 | Claude Code runtime via PTY subprocess | SATISFIED | `_build_command()` produces `["claude", "-p", ..., "--output-format", "json", "--dangerously-skip-permissions", "--no-session-persistence"]`. `CREDENTIAL_PATHS` maps `"claude-code"` to `~/.claude/.credentials.json`. |

All 8 CLI requirements satisfied. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/unit/test_cli_runtime.py` | 679-688 | `test_pty_spawn_success` in legacy section only checks that `_build_command` returns a list containing "claude" — not an actual PTY spawn test | Info | Low. The class-based `TestDrainToBuffer` (lines 562-633) provides substantive pexpect drain testing. The legacy stub name is misleading but the behavior is covered by higher-quality class-based tests above. |
| `agents/_base/kubex_harness/cli_runtime.py` | 665 | `datetime.utcnow()` deprecated in Python 3.12+ (7 deprecation warnings in test run) | Warning | Non-blocking. Will become an error in a future Python version. Should use `datetime.now(timezone.utc)`. |

No blocker anti-patterns found.

### Human Verification Required

#### 1. First-launch HITL credential flow

**Test:** Start a kubexclaw-base container with `config.yaml` containing `runtime: claude-code`, with no `~/.claude/.credentials.json` mounted.
**Expected:** Container logs show BOOTING -> CREDENTIAL_WAIT state transitions. A `request_user_input` action appears in the gateway logs asking the operator to run `docker exec -it <container> claude auth login`. After completing auth, container transitions to READY and begins polling the broker.
**Why human:** Requires a live Docker environment with the updated base image built, a running gateway+broker+Redis, and real OAuth interaction with Anthropic's auth servers.

#### 2. Credential persistence across restarts

**Test:** After successful OAuth login in test 1, stop and remove the container (but not the `kubex-creds-<agent_id>` named volume). Restart the container with the same `agent_id`.
**Expected:** Container goes directly to READY state without triggering HITL — `_credentials_present()` returns True, `_credential_gate()` completes without publishing CREDENTIAL_WAIT.
**Why human:** Named Docker volume round-trip persistence requires a live Docker daemon. The lifecycle.py code is verified; Docker itself must be tested.

#### 3. SIGTERM forwarding to PTY child

**Test:** Dispatch a long-running task to a running claude-code container. Send `docker stop <container>` (which sends SIGTERM).
**Expected:** Container logs show "forwarding SIGTERM to PTY child". Process exits within 5 seconds. No orphaned `claude` processes remain on the host (verify with `ps aux | grep claude`).
**Why human:** PTY signal propagation through tini -> Python harness -> pexpect child is an OS-level concern that cannot be mocked.

#### 4. CLAUDE.md skill pickup by Claude Code

**Test:** Deploy a container with skills configured (e.g., `skills: [code-review]`). Check `/app/CLAUDE.md` inside the container.
**Expected:** File exists and contains concatenated SKILL.md content. When Claude Code spawns, it reads CLAUDE.md from its working directory `/app`.
**Why human:** Requires the entrypoint.sh to have executed in a real container with skills mounted at `/app/skills/`. The script logic is verified but end-to-end skill injection into Claude Code's context cannot be asserted from outside the container.

### Gaps Summary

No gaps found. All automated checks passed:

- 571 unit tests pass, 4 skipped (pexpect Unix-only, expected on Windows dev machines)
- All 8 CLI requirements (CLI-01 through CLI-08) have implementation evidence
- All 9 artifacts exist, are substantive (not stubs), and are wired
- All 7 key links verified
- No blocker anti-patterns
- 4 human verification items identified for live-system validation (all are infrastructure/OS concerns that cannot be automated)

The `datetime.utcnow()` deprecation warning is a minor quality item, not a blocker.

---

_Verified: 2026-03-22_
_Verifier: Claude (gsd-verifier)_
