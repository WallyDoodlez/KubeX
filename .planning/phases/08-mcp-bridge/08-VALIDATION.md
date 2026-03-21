---
phase: 8
slug: mcp-bridge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `pytest.ini` |
| **Quick run command** | `pytest tests/unit/ -x -q` |
| **Full suite command** | `pytest tests/ -x -q` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/unit/ -x -q`
- **After every plan wave:** Run `pytest tests/ -x -q`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MCP-01 | unit | `pytest tests/unit/test_mcp_bridge.py -x -q` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | MCP-02 | unit | `pytest tests/unit/test_mcp_bridge.py -x -q` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | MCP-03 | unit | `pytest tests/unit/test_vault_tools.py -x -q` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | MCP-04 | unit | `pytest tests/unit/test_vault_tools.py -x -q` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | MCP-05 | unit | `pytest tests/unit/test_agent_discovery.py -x -q` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 2 | MCP-06 | integration | `pytest tests/integration/test_mcp_parity.py -x -q` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 3 | MCP-07 | integration | `pytest tests/integration/test_mcp_e2e.py -x -q` | ❌ W0 | ⬜ pending |
| 08-04-02 | 04 | 3 | MCP-08 | e2e | `pytest tests/e2e/test_mcp_bridge_e2e.py -x -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test_mcp_bridge.py` — stubs for MCP-01, MCP-02
- [ ] `tests/unit/test_vault_tools.py` — stubs for MCP-03, MCP-04
- [ ] `tests/unit/test_agent_discovery.py` — stubs for MCP-05
- [ ] `tests/integration/test_mcp_parity.py` — stubs for MCP-06
- [ ] `tests/integration/test_mcp_e2e.py` — stubs for MCP-07
- [ ] `tests/e2e/test_mcp_bridge_e2e.py` — stubs for MCP-08

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Docker MCP dispatch | MCP-08 | Requires running Docker services | Start full stack, send task via gateway, verify MCP dispatch in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
