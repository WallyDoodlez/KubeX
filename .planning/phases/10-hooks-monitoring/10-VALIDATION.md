---
phase: 10
slug: hooks-monitoring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | pyproject.toml |
| **Quick run command** | `python -m pytest tests/unit/test_hook_server.py tests/unit/test_hook_audit.py -x -q` |
| **Full suite command** | `python -m pytest tests/ -x -q` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/unit/test_hook_server.py tests/unit/test_hook_audit.py -x -q`
- **After every plan wave:** Run `python -m pytest tests/ -x -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | HOOK-01 | unit | `pytest tests/unit/test_hook_server.py -k post_hooks` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | HOOK-01 | unit | `pytest tests/unit/test_hook_server.py -k pydantic_validation` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | HOOK-02 | unit | `pytest tests/unit/test_hook_config.py -k settings_json` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | HOOK-02 | unit | `pytest tests/unit/test_hook_config.py -k read_only_mount` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 2 | HOOK-03 | unit | `pytest tests/unit/test_hook_lifecycle.py -k task_progress` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 2 | HOOK-04 | unit | `pytest tests/unit/test_hook_audit.py -k audit_trail` | ❌ W0 | ⬜ pending |
| 10-04-01 | 04 | 2 | HOOK-04 | unit | `pytest tests/unit/test_hook_audit.py -k gateway_audit_endpoint` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_hook_server.py` — stubs for HOOK-01 (endpoint, validation)
- [ ] `tests/unit/test_hook_config.py` — stubs for HOOK-02 (settings.json generation, read-only mount)
- [ ] `tests/unit/test_hook_lifecycle.py` — stubs for HOOK-03 (task_progress events)
- [ ] `tests/unit/test_hook_audit.py` — stubs for HOOK-04 (audit trail storage, Gateway endpoint)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Read-only mount enforcement in Docker | HOOK-02 | Requires running Docker container | `docker exec <container> sh -c 'echo test > /root/.claude/settings.json'` should fail with read-only filesystem error |
| Hook events arrive from live Claude Code | HOOK-01 | Requires actual Claude Code CLI | Run Claude Code in container, verify events appear in harness logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
