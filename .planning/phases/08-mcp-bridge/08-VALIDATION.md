---
phase: 8
slug: mcp-bridge
status: draft
nyquist_compliant: true
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Test File | Status |
|---------|------|------|-------------|-----------|-------------------|-----------|--------|
| 08-01-01 | 01 | 1 | MCP-05 | unit | `pytest tests/unit/test_config_loader.py -x -q` | tests/unit/test_config_loader.py | ⬜ pending |
| 08-01-02 | 01 | 1 | MCP-05 | unit | `pytest tests/unit/test_registry.py -x -q` | tests/unit/test_registry.py | ⬜ pending |
| 08-02-01 | 02 | 2 | MCP-01, MCP-02, MCP-03 | unit | `pytest tests/unit/test_mcp_bridge.py -x -q` | tests/unit/test_mcp_bridge.py | ⬜ W0 |
| 08-02-02 | 02 | 2 | MCP-05 | unit | `pytest tests/unit/test_harness_unit.py tests/unit/test_mcp_bridge.py -x -q` | tests/unit/test_mcp_bridge.py | ⬜ pending |
| 08-02-03 | 02 | 2 | D-05, D-06, D-07 | unit | `pytest tests/unit/test_mcp_bridge.py -k "need_info or delegation" -x -q` | tests/unit/test_mcp_bridge.py | ⬜ W0 |
| 08-03-01 | 03 | 3 | MCP-04 | unit | `pytest tests/unit/test_mcp_bridge.py -k "vault" -x -q` | tests/unit/test_mcp_bridge.py | ⬜ W0 |
| 08-03-02 | 03 | 3 | MCP-07, MCP-08 | unit | `pytest tests/unit/test_mcp_bridge.py -x -q` | tests/unit/test_mcp_bridge.py | ⬜ W0 |
| 08-04-01 | 04 | 4 | MCP-03, D-13 | unit+integration | `pytest tests/unit/test_mcp_bridge.py tests/integration/test_mcp_bridge_integration.py -x -q` | tests/unit/test_mcp_bridge.py, tests/integration/test_mcp_bridge_integration.py | ⬜ W0 |
| 08-04-02 | 04 | 4 | MCP-06 | e2e | `pytest tests/ -x -q` | Full suite (parity gate) | ⬜ pending |
| 08-04-03 | 04 | 4 | MCP-06 | unit | `pytest tests/ -x -q` | Full suite (post-migration) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files created by tasks during execution:

- [ ] `tests/unit/test_mcp_bridge.py` — Primary unit tests for MCPBridgeServer: worker delegation (MCP-01, MCP-02), poll_task (MCP-03), need_info protocol (D-05/D-06/D-07), vault tools (MCP-04), meta-tools (MCP-08), concurrent dispatch (MCP-07), transport selection (D-13)
- [ ] `tests/integration/test_mcp_bridge_integration.py` — Integration tests: pub/sub cache invalidation (MCP-05), long-running task pattern (MCP-03), cold boot agent fetch

Existing test files used for regression verification:
- `tests/unit/test_config_loader.py` — Extended with description, boundary, runtime field tests
- `tests/unit/test_registry.py` — Extended with pub/sub publish tests
- `tests/unit/test_harness_unit.py` — Existing harness tests (regression check)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Docker MCP dispatch | MCP-06 | Requires running Docker services | Start full stack, send task via gateway, verify MCP dispatch in logs |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 45s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
