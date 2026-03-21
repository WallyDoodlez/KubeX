# Phase 8: MCP Bridge - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the orchestrator's custom 8-tool OpenAI function-calling loop with a standard MCP Bridge server. Workers become MCP tools (one per agent), vault tools are exposed as MCP tools with policy gating, agent discovery happens via Registry pub/sub. The existing standalone mode stays for workers. Old orchestrator tool loop is deleted after E2E parity verification.

</domain>

<decisions>
## Implementation Decisions

### Vault Write Policy Gate
- **D-01:** Vault reads (search, get, list, find_backlinks) are in-process direct calls — fast, no security concern
- **D-02:** Vault writes (create_note, update_note) route through Gateway POST /actions as vault_create / vault_update action types — same injection scan pipeline as all other actions
- **D-03:** Audit logging for writes only — reads are high-frequency and logging them adds noise
- **D-04:** Rejected vault writes trigger ESCALATE flow — human reviews flagged content and approves/denies, consistent with existing policy model

### Worker Need_Info Protocol
- **D-05:** Workers signal need_info via structured result status: `{status: "need_info", request: "natural language ask", data: {...}}` — uses existing result pipeline, orchestrator LLM interprets and re-delegates
- **D-06:** Need_info results include raw data — worker attaches the data it needs processed, orchestrator passes to next worker. Fewer round trips.
- **D-07:** Orchestrator tracks delegation depth with configurable max (default 3) to prevent infinite chains. Orchestrator LLM sees chain context.
- **D-08:** Workers register with description + tool metadata in registration payload — MCP bridge uses description as tool description, tool metadata for orchestrator LLM context

### Migration Strategy
- **D-09:** Config switch migration — change orchestrator config.yaml `harness_mode` from "standalone" to "mcp-bridge". One restart. Rollback = change config back.
- **D-10:** Parity verification: run full E2E suite against both standalone and mcp-bridge modes. Both must pass identically.
- **D-11:** Old standalone orchestrator tool loop deleted at end of Phase 8, after parity passes. Clean cut.
- **D-12:** Workers stay on standalone mode for v1.2. All-MCP workers is a future milestone.

### MCP Transport
- **D-13:** Dual transport: in-memory for API mode (openai-api runtime — bridge and LLM client share same process), stdio for CLI mode (CLI agents connect as MCP clients)
- **D-14:** Both transports implemented in Phase 8 — stdio ready for Phase 9 CLI runtime without additional transport work

### Claude's Discretion
- MCP tool timeout values (research suggests 300s minimum)
- Exact asyncio.gather() implementation for concurrent dispatch
- Meta-tool response formats (kubex__list_agents, kubex__agent_status, kubex__cancel_task)
- Registry pub/sub message format and subscription lifecycle
- Error handling and retry behavior for failed dispatches

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP Bridge Design
- `docs/design-mcp-bridge.md` — Full architecture: worker delegation tools, vault direct tools, meta-tools, agent discovery via pub/sub, data flow diagrams, config changes, file change list
- `.planning/research/SUMMARY.md` — Research synthesis: stack choices, pitfalls (MCP timeout crash, policy bypass, tool schema breakage), phase ordering rationale
- `.planning/research/ARCHITECTURE.md` — Integration points, new vs modified files, build order

### Pitfalls and Security
- `.planning/research/PITFALLS.md` — 10 critical pitfalls: MCP timeout (async task_id mandatory), hook RCE (CVE-2025-59536), vault policy bypass, PID 1 signal blindness, parity gate
- `.planning/research/STACK.md` — Library versions: mcp[cli]>=1.26, ptyprocess>=0.7, watchfiles>=1.1.1

### Existing Code
- `agents/_base/kubex_harness/main.py` — Entry point with harness_mode routing (add mcp-bridge branch)
- `agents/_base/kubex_harness/standalone.py` — Current tool-use loop (reference for parity testing)
- `agents/_base/kubex_harness/config_loader.py` — AgentConfig model (add description, boundary fields)
- `services/registry/registry/store.py` — Register/deregister (add PUBLISH for pub/sub)
- `agents/orchestrator/config.yaml` — Current orchestrator config (change harness_mode, add description)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `standalone.py:StandaloneAgent._call_llm_with_tools()` — Multi-turn tool-use loop with OpenAI function calling. Reference implementation for parity testing. 8 tools defined.
- `config_loader.py:AgentConfig` — Pydantic model with harness_mode routing. Already supports "standalone" and "openclaw". Add "mcp-bridge" as third mode.
- `main.py:_run()` — Entry point routing by harness_mode. Pattern established: import-and-instantiate per mode with signal handlers.
- `services/registry/registry/store.py` — Redis HSET/HDEL for agent state. No PUBLISH yet — single addition needed.

### Established Patterns
- harness_mode routing in main.py (import-and-instantiate per mode)
- config.yaml as sole source of truth (no env var overrides)
- Gateway as sole ingress for all actions (POST /actions)
- Broker dispatch by capability name (not agent_id)
- Registration includes metadata dict (already exists in payload schema)

### Integration Points
- `main.py` line 86: else clause for unknown harness_mode — add mcp-bridge before this
- `config_loader.py:AgentConfig`: add `description: str = ""` and ensure `boundary` field exists
- `services/registry/store.py`: add `await redis_client.publish("registry:agent_changed", agent_id)` after hset/hdel
- `agents/orchestrator/config.yaml`: change harness_mode, add description, adjust skills list
- All worker config.yaml files: add description field

</code_context>

<specifics>
## Specific Ideas

- Design doc (`docs/design-mcp-bridge.md`) is the primary architecture reference — it has Mermaid diagrams for all data flows
- Long-term vision: ALL agents on MCP (workers too), not just orchestrator. v1.2 starts with orchestrator only.
- The async task_id dispatch pattern is mandatory from day one — research confirmed MCP timeout crash (SDK Issue #212) kills bridge on long-running policy escalations

</specifics>

<deferred>
## Deferred Ideas

- **All-MCP workers** — Workers expose their domain tools as MCP servers, orchestrator connects to them directly instead of through Broker. Transforms the whole system into an MCP mesh. Future milestone.
- **Worker "need_info" cross-Kubex collaboration** — Defined in this phase's context (D-05 through D-07) but the full protocol (response format, chain tracking, timeout behavior) may need refinement after real-world use.
- **SSE transport** — Design doc mentions SSE as alternative MCP transport. Not needed for v1.2 (in-memory + stdio covers both modes).

</deferred>

---

*Phase: 08-mcp-bridge*
*Context gathered: 2026-03-21*
