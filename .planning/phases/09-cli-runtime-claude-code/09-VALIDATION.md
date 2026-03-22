---
phase: 9
slug: cli-runtime-claude-code
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| TBD | TBD | TBD | CLI-01 | unit | `pytest tests/unit/test_cli_runtime.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-02 | unit | `pytest tests/unit/test_cli_runtime.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-03 | unit | `pytest tests/unit/test_credential_flow.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-04 | unit | `pytest tests/unit/test_signal_handling.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-05 | unit | `pytest tests/unit/test_skill_injection.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-06 | unit | `pytest tests/unit/test_progress_streaming.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-07 | unit | `pytest tests/unit/test_failure_detection.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-08 | integration | `pytest tests/integration/test_cli_e2e.py` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_cli_runtime.py` — stubs for CLI-01, CLI-02 (PTY spawn, task delivery)
- [ ] `tests/unit/test_credential_flow.py` — stubs for CLI-03 (credential detection, HITL flow)
- [ ] `tests/unit/test_signal_handling.py` — stubs for CLI-04 (SIGTERM forwarding, grace period)
- [ ] `tests/unit/test_skill_injection.py` — stubs for CLI-05 (CLAUDE.md generation)
- [ ] `tests/unit/test_progress_streaming.py` — stubs for CLI-06 (stdout chunking, progress API)
- [ ] `tests/unit/test_failure_detection.py` — stubs for CLI-07 (exit code + output scan)
- [ ] `tests/integration/test_cli_e2e.py` — stubs for CLI-08 (full lifecycle)
- [ ] `tests/conftest.py` — shared fixtures (mock pexpect, fake CLI process)

*Existing pytest infrastructure covers framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OAuth web flow in browser | CLI-03 | Requires real browser + Anthropic OAuth server | `docker exec -it` into container, run `claude auth login`, complete browser flow |
| Real Claude Code output quality | CLI-08 | Requires live API key + Claude Code binary | Run full E2E with real credentials, verify task completion |
| ANSI color rendering in Command Center | CLI-06 | Requires visual inspection of xterm.js | Send colored output, verify render in browser |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
