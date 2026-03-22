---
phase: 09-cli-runtime-claude-code
plan: "03"
subsystem: kubex-harness
tags: [cli-runtime, main-py, unit-tests, named-volumes, signal-handling]
dependency_graph:
  requires: [09-00, 09-01, 09-02]
  provides: [CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08]
  affects: [agents/_base/kubex_harness/main.py, tests/unit/test_cli_runtime.py, tests/unit/test_kubex_manager_unit.py]
tech_stack:
  added: []
  patterns:
    - "runtime field routing: config.runtime != 'openai-api' check before harness_mode routing in main.py"
    - "named Docker volumes for CLI credential persistence: kubex-creds-{agent_id}"
key_files:
  created: []
  modified:
    - agents/_base/kubex_harness/main.py
    - tests/unit/test_kubex_manager_unit.py
decisions:
  - "CLI runtime routing placed BEFORE harness_mode routing in main.py — CLI agents use harness_mode='standalone' but must bypass StandaloneAgent"
  - "Named volume tests added to TestCliRuntimeNamedVolumes class in test_kubex_manager_unit.py"
metrics:
  duration: "~10 minutes"
  completed: "2026-03-22"
  tasks_completed: 2
  files_modified: 2
---

# Phase 9 Plan 3: CLIRuntime Wiring + Named Volume Tests Summary

**One-liner:** Wired CLIRuntime into main.py with SIGTERM/SIGINT forwarding and added named Docker volume unit tests covering CLI-06.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire CLIRuntime into main.py | a424124 | agents/_base/kubex_harness/main.py |
| 2 | Named volume tests for CLI runtime | 95e8b28 | tests/unit/test_kubex_manager_unit.py |

## What Was Built

### Task 1: CLIRuntime Routing in main.py

Added a CLI runtime routing block to `_run()` in `agents/_base/kubex_harness/main.py`. The block executes BEFORE the `harness_mode` routing because CLI agents use `harness_mode="standalone"` but must route to `CLIRuntime` instead of `StandaloneAgent`.

Key additions:
- `if config.runtime != "openai-api":` routing block
- Lazy import: `from kubex_harness.cli_runtime import CLIRuntime`
- SIGTERM/SIGINT wired to `runtime.stop()` via `loop.add_signal_handler`
- `await runtime.run()` followed by `return` (exits `_run()` after CLI completes)
- Module docstring updated with `cli-runtime` mode description
- Error message in else-branch updated to mention CLI mode

### Task 2: Named Volume Tests

Added `TestCliRuntimeNamedVolumes` class to `tests/unit/test_kubex_manager_unit.py` with two tests:

- `test_named_volume_for_cli_runtime`: Verifies that when `config.agent.runtime == "claude-code"`, `create_kubex()` adds a `kubex-creds-{agent_id}` named volume with `bind="/root/.claude"` and `mode="rw"` to the Docker SDK call.
- `test_no_volume_for_openai_api`: Verifies that no `kubex-creds-*` named volumes appear for standard `openai-api` runtime agents.

Both tests mock the Docker SDK (no real Docker daemon required) and follow the existing `make_mock_docker()` + `make_lifecycle()` fixture patterns.

## Test Results

```
571 passed, 4 skipped (pexpect Windows skip — expected), 90 warnings
```

The 4 skipped tests in `test_cli_runtime.py` are `pexpect`-dependent (PTY spawn tests) — `pexpect` is a Unix-only library and is unavailable on Windows. These skips are expected and noted in the plan.

## Verification

All plan acceptance criteria met:
- `grep -q "CLIRuntime" agents/_base/kubex_harness/main.py` — PASS
- `pytest tests/unit/test_cli_runtime.py -x -q` — 87 passed, 4 skipped
- `pytest tests/unit/test_kubex_manager_unit.py -x -q` — 61 passed
- `pytest tests/ --ignore=tests/e2e --ignore=tests/chaos --ignore=tests/integration -x -q` — 571 passed, 4 skipped

## Deviations from Plan

None — plan executed exactly as written.

The test file `test_cli_runtime.py` already had 87 full test implementations from Plan 02 (not stubs from Plan 00 as mentioned in Plan 03 context). The Wave 0 stubs had already been replaced. Plan 03 only needed the named volume tests in `test_kubex_manager_unit.py` (which were missing), and the main.py wiring.

## Self-Check: PASSED

- `agents/_base/kubex_harness/main.py` — modified and committed (a424124)
- `tests/unit/test_kubex_manager_unit.py` — modified and committed (95e8b28)
- Both commits exist in git log
- Full unit test suite: 571 passed, 0 failures
