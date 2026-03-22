---
phase: 9
slug: cli-runtime-claude-code
status: active
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-22
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pytest.ini` (project root) |
| **Quick run command** | `python -m pytest tests/unit/ -x -q --timeout=30` |
| **Full suite command** | `python -m pytest tests/ --timeout=60` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/unit/ -x -q --timeout=30`
- **After every plan wave:** Run `python -m pytest tests/ --timeout=60`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 00-T1 | 09-00 | 0 | CLI-01..08 | stub | `pytest tests/unit/test_cli_runtime.py --collect-only -q` | 09-00 creates | pending |
| 01-T1 | 09-01 | 1 | CLI-04, CLI-05 | grep | `grep -q "tini" agents/_base/Dockerfile && grep -q "CLAUDE.md" agents/_base/entrypoint.sh` | N/A (infra) | pending |
| 01-T2 | 09-01 | 1 | CLI-06 | grep+unit | `grep -q "kubex-creds" docker-compose.yml && pytest tests/unit/test_kubex_manager_unit.py -x -q` | N/A (infra) | pending |
| 02-T1 | 09-02 | 1 | CLI-01..03,07,08 | import | `cd agents/_base && PYTHONPATH=. python -c "from kubex_harness.cli_runtime import CLIRuntime, CliState"` | 09-02 creates | pending |
| 03-T1 | 09-03 | 2 | CLI-01..08 | grep | `grep -q "CLIRuntime" agents/_base/kubex_harness/main.py` | N/A (modify) | pending |
| 03-T2 | 09-03 | 2 | CLI-01..08 | unit | `pytest tests/unit/test_cli_runtime.py -x -q && pytest tests/ -x -q` | 09-00 stubs, 09-03 fills | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/test_cli_runtime.py` — skeletal stubs for all 24 CLIRuntime behaviors (Plan 09-00 creates)

All tests consolidated into a single test file `tests/unit/test_cli_runtime.py`. The RESEARCH.md test map functions are all present:
- `test_pty_spawn_success` (CLI-01)
- `test_large_output_no_deadlock` (CLI-01)
- `test_hitl_triggered_on_missing_creds` (CLI-02)
- `test_credential_watcher_detects_file` (CLI-02)
- `test_claude_md_written` (CLI-05)
- `test_task_loop_state_transitions` (CLI-07)
- Plus 18 additional tests covering CLI-02..08

Named volume tests (`test_named_volume_for_cli_runtime`, `test_no_volume_for_openai_api`) are added to the existing `tests/unit/test_kubex_manager_unit.py` in Plan 03 Task 2.

*Existing pytest infrastructure covers framework install.*

---

## Nyquist Compliance

**3-consecutive-task rule check:**

| Sequence | Task | Has pytest? | Notes |
|----------|------|-------------|-------|
| 1 | 00-T1 (Wave 0) | collect-only | Creates stub file |
| 2 | 01-T1 (Wave 1) | grep only | Infrastructure (Dockerfile/entrypoint) |
| 3 | 01-T2 (Wave 1) | pytest manager | `pytest tests/unit/test_kubex_manager_unit.py` |
| 4 | 02-T1 (Wave 1) | import check | Python import verification |
| 5 | 03-T1 (Wave 2) | grep only | main.py wiring |
| 6 | 03-T2 (Wave 2) | full pytest | All 24+ tests run |

No 3 consecutive tasks without automated pytest coverage. Tasks 01-T2 (pytest manager) and 02-T1 (import check) break any potential gap. Task 03-T2 runs the full suite.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OAuth web flow in browser | CLI-02 | Requires real browser + Anthropic OAuth server | `docker exec -it` into container, run `claude auth login`, complete browser flow |
| Real Claude Code output quality | CLI-08 | Requires live API key + Claude Code binary | Run full E2E with real credentials, verify task completion |
| ANSI color rendering in Command Center | CLI-09 (deferred) | Requires visual inspection of xterm.js | Send colored output, verify render in browser |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 45s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
