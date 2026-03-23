---
phase: 11
slug: gemini-cli-runtime
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pyproject.toml` at project root |
| **Quick run command** | `pytest tests/unit/test_cli_runtime.py -x -q` |
| **Full suite command** | `pytest tests/ -x -q` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/unit/test_cli_runtime.py -x -q`
- **After every plan wave:** Run `pytest tests/ -x -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | CLI-10 | unit | `pytest tests/unit/test_cli_runtime.py::TestCredentialPaths -x` | Partial | ⬜ pending |
| 11-01-02 | 01 | 1 | CLI-10 | unit | `pytest tests/unit/test_cli_runtime.py::TestCliSkillFiles -x` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | CLI-10 | unit | `pytest tests/unit/test_cli_runtime.py::TestBuildCommand -x` | Partial | ⬜ pending |
| 11-01-04 | 01 | 1 | CLI-10 | unit | `pytest tests/unit/test_cli_runtime.py::TestWriteSkillFile -x` | ❌ W0 | ⬜ pending |
| 11-01-05 | 01 | 1 | CLI-10 | unit | `pytest tests/unit/test_cli_runtime.py::TestClassifyFailure -x` | Partial | ⬜ pending |
| 11-01-06 | 01 | 1 | CLI-10 | unit | `pytest tests/unit/test_cli_runtime.py::TestHookServerGate -x` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | CLI-10 | unit | `pytest tests/unit/test_kubex_manager_unit.py -x -k gemini` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | CLI-10 | unit | `pytest tests/unit/test_kubex_manager_unit.py -x -k gemini_cred` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_cli_runtime.py` — add `TestCliSkillFiles`, `TestWriteSkillFile`, `TestHookServerGate`, `TestGeminiBuildCommand`, `TestGeminiCredentialPath` classes
- [ ] `tests/unit/test_kubex_manager_unit.py` — add `TestGeminiCredentialMount`, `TestGeminiNoHookSettings` test classes

*Existing test file covers Claude Code paths — new classes extend without breaking existing tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker OAuth flow for Gemini CLI | CLI-10 | Requires browser interaction | `docker exec -it <container> gemini`, select "Login with Google", verify `~/.gemini/oauth_creds.json` exists |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
