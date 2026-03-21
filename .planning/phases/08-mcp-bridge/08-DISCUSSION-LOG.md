# Phase 8: MCP Bridge - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-21
**Phase:** 08-mcp-bridge
**Areas discussed:** Vault write policy gate, Worker need_info protocol, Migration strategy, MCP transport choice

---

## Vault Write Policy Gate

| Option | Description | Selected |
|--------|-------------|----------|
| Gateway route | All vault writes go through Gateway POST /vault/write | |
| Inline scan in bridge | MCP bridge runs injection scan locally | |
| Reads direct, writes through Gateway | vault_search/get in-process, vault_create/update via Gateway | ✓ |

**User's choice:** Reads direct, writes through Gateway (Recommended)
**Notes:** User confirmed after clarification of what the vault is (Obsidian-style shared knowledge base).

### Follow-up: API design

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse POST /actions | vault_create/vault_update as action types | ✓ |
| New POST /vault/write | Dedicated vault endpoint | |

**User's choice:** Reuse POST /actions

### Follow-up: Audit logging

| Option | Description | Selected |
|--------|-------------|----------|
| Log reads too | Every vault access logged for forensics | |
| Writes only | Only log policy-gated writes | ✓ |
| Claude's discretion | Let Claude decide | |

**User's choice:** Writes only

### Follow-up: Rejection behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Clear error with reason | Tell LLM why write was rejected | |
| Silent failure | Generic error, don't help evasion | |
| Escalate to human | ESCALATE flow — human reviews | ✓ |

**User's choice:** Escalate to human

---

## Worker Need_Info Protocol

| Option | Description | Selected |
|--------|-------------|----------|
| Structured result status | Worker returns {status: 'need_info', request, data} | ✓ |
| Explicit tool call | Worker has request_cross_kubex_help tool | |
| Defer to v1.3 | Workers can't request cross-agent help yet | |

**User's choice:** Structured result status

### Follow-up: Data inclusion

| Option | Description | Selected |
|--------|-------------|----------|
| Description only | Worker describes what it needs | |
| Include data | Worker attaches data in result | ✓ |
| Claude's discretion | Let Claude decide | |

**User's choice:** Include data

### Follow-up: Chain depth

| Option | Description | Selected |
|--------|-------------|----------|
| Max 1 level | Hard limit at 1 | |
| Orchestrator manages depth | No hard limit, LLM decides | |
| Configurable limit | Default max, configurable per agent | ✓ (via free text) |

**User's choice:** Keep track of steps to prevent loops. Agreed on configurable max (default 3) with orchestrator tracking chain context.

---

## Migration Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Config switch | Change config.yaml, one restart, rollback = change back | ✓ |
| Feature flag | Env var toggles mode at runtime | |
| Separate containers | Two orchestrator containers side by side | |

**User's choice:** Config switch (Recommended)

### Follow-up: Parity verification

| Option | Description | Selected |
|--------|-------------|----------|
| Full E2E suite against both modes | Run all 789 tests against both | ✓ |
| Golden prompt tests | Specific orchestration scenario tests | |
| Both | Golden prompts + full E2E | |

**User's choice:** Full E2E suite against both modes

### Follow-up: Code deletion

| Option | Description | Selected |
|--------|-------------|----------|
| End of Phase 8 | Delete after parity passes | ✓ |
| After Phase 9 | Keep through CLI Runtime phase | |
| Never delete | Keep as fallback forever | |

**User's choice:** End of Phase 8

### Follow-up: Worker changes

| Option | Description | Selected |
|--------|-------------|----------|
| Zero worker changes | Only add description to config.yaml | |
| Add description + tool metadata | Register with description AND tool definitions | ✓ |

**User's choice:** Add description + tool metadata

### Follow-up: Worker future

| Option | Description | Selected |
|--------|-------------|----------|
| Workers stay standalone | Only orchestrator uses MCP bridge | |
| Workers get MCP option later | v1.2 standalone, future all-MCP | ✓ (via free text) |

**User's choice:** "I would rather everything to be MCP" — long-term vision is all agents on MCP. Captured as deferred idea for future milestone.

---

## MCP Transport Choice

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory for API, stdio for CLI | Two transports, each optimal for its mode | ✓ |
| stdio always | Consistent across modes | |
| SSE/HTTP | Bridge as HTTP server on localhost | |

**User's choice:** In-memory for API, stdio for CLI

### Follow-up: Phase 8 scope

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory only in Phase 8 | stdio deferred to Phase 9 | |
| Both in Phase 8 | Implement both transports now | ✓ |

**User's choice:** Both in Phase 8

---

## Claude's Discretion

- MCP tool timeout values
- asyncio.gather() implementation for concurrent dispatch
- Meta-tool response formats
- Registry pub/sub message format
- Error handling and retry behavior

## Deferred Ideas

- All agents on MCP (workers too) — future milestone
