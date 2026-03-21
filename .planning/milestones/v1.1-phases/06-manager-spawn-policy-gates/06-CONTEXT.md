# Phase 6: Manager Spawn Logic and Policy Gates - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

The Kubex Manager can resolve skills for an agent, validate them through the policy engine, and assemble all container create parameters from config — as independently testable Python units, before any Docker integration. This phase delivers SkillResolver enhancements, ConfigBuilder, skill-check Gateway endpoint, Redis state persistence, dynamic network resolution, and runtime dependency support. It does NOT deliver agent migration (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### ConfigBuilder Merge Rules
- **Skills are model-agnostic** — model choice comes exclusively from agent config, never from skill manifests
- **Resource limits come from agent config** — skills do not declare hardware requirements; the operator sets resources knowing what skills the kubex has
- **Skills provide:** capabilities, dependencies, tools, egress domains
- **Agent config provides:** identity, model, resources, policy, budget, overrides — everything else
- **Egress domains:** union from all skills, but the build process performs conflict validation
- **Conflicts fail the spawn** — ConfigBuilder raises an error listing all conflicts; operator must fix agent config or skill manifests before spawning
- **Output is a config.yaml file written to disk** — persistent directory so configs can be reused for respawn/duplication
- **ConfigBuilder merges tools into config.yaml** — tools from all skills are namespaced and written into the config; harness reads tools from config, not from skill directories
- **Tool existence validated** — ConfigBuilder checks that each declared tool has a corresponding Python file in the skill's tools/ directory; missing tool = spawn fails
- **Agent config can override skill fields** — an 'overrides' section in agent config can modify skill contributions for fine-tuning without editing skill manifests

### Skill-check API Contract
- **Caller:** Manager only — called as part of the spawn pipeline before container creation
- **Check scope:** Allowlist check only — Gateway maintains an `allowed_skills` field in agent policy YAML (`agents/{agent_id}/policies/policy.yaml`)
- **Not-on-allowlist behavior:** ESCALATE — consistent with policy philosophy ("not explicitly allowed = review, not hard deny"); reviewer can approve novel skill assignments
- **Response format:** Same as existing action-gating endpoints (PolicyResult with ALLOW/DENY/ESCALATE + reason)

### Redis State Persistence
- **Redis is source of truth** — Manager persists KubexRecords to Redis on every state change; on restart, load all records from Redis
- **Orphaned Docker containers are ignored** — Manager only manages containers it knows about from Redis; unknown containers are not adopted
- **Full config stored in Redis** — each KubexRecord includes the entire agent config + composed skill set for respawn capability
- **No TTL** — records persist until explicitly removed via DELETE /kubexes/{id}; operator controls cleanup
- **Runtime deps tracked in Redis state** — each KubexRecord includes a list of runtime-installed packages for debugging and auditing

### Runtime Dependency Request Flow
- **New action type: install_dependency** — agent sends ActionRequest with action=install_dependency, parameters={package, type}; Gateway evaluates through policy engine
- **Manager executes via Docker exec** — Gateway approves, then calls Manager API directly (POST /kubexes/{id}/install-dep); Manager runs docker exec inside the container
- **Pip only for runtime installs** — start with pip packages only; system packages via apt at boot only
- **Pip + named CLI tools supported** — support both pip packages AND a curated set of CLI tools (ffmpeg, git, curl, etc.) that Manager can install; all policy-gated
- **Boot-time deps from config.yaml are trusted** — no policy gate during initial setup; "it came from config.yaml" = sufficient trust
- **Reviewer-approved packages auto-added to config** — when reviewer approves a runtime dep, it gets added to the persistent config.yaml for future boots
- **Hard package blocklist** — Gateway maintains a blocklist of forbidden packages (like skill injection blocklist) in policies/global.yaml; blocked = DENY, never ESCALATE
- **Soft install limit** — exceeding a configurable per-agent limit triggers ESCALATE to human, not hard deny
- **Exit code verification only** — Manager checks docker exec exit code; 0 = success, non-zero = report failure

### Dynamic Network Resolution
- **Docker label lookup** — Manager searches for Docker networks with label `kubex.network=internal`; works regardless of Compose project name prefix
- **Fail startup if not found** — Manager refuses to start without a labeled network; clear error message with setup instructions
- **Look up every container create** — resolve network name on each call, not cached at startup; handles dynamic network changes
- **docker-compose.yml updated** — add `labels: kubex.network: internal` to the network definition; clean, documented, version-controlled
- **Network only for now** — only network resolution by label; volumes and other resources stay as-is

### Spawn Pipeline
- **Pipeline order:** (1) Validate agent config → (2) SkillResolver.resolve() → (3) ConfigBuilder.build() → (4) POST /policy/skill-check → (5) Write config.yaml to disk → (6) Create Docker container → (7) Persist to Redis → (8) Return
- **Full rollback on failure** — if any step fails, clean up all artifacts from earlier steps (delete config.yaml, remove Docker container, etc.)
- **Atomic — all or nothing** — spawn either fully succeeds or fully rolls back; no partial state, no resumable steps
- **Auto-start after creation** — POST /kubexes creates AND starts the container in one call; separate start_kubex call becomes optional

### Manager API Extensions
- **POST /kubexes/{id}/respawn** — kills current container and creates a new one using the same persisted config
- **POST /kubexes/{id}/install-dep** — installs a package in a running container (called by Gateway after policy approval)
- **GET /kubexes/{id}/config** — returns the full merged config.yaml content for debugging/auditing
- **GET /configs** — lists saved config.yaml files with metadata (agent_id, skills, created_at) for browsing/respawn
- **Enriched GET /kubexes responses** — existing responses include new fields: skill list, config path, runtime deps, composed capabilities
- **No separate /deps endpoint** — boot deps visible in config endpoint, runtime deps in Redis state record

### Claude's Discretion
- Persistent config directory path on host
- Redis key naming scheme for KubexRecords
- Package blocklist seed contents
- Exact label key/value for Docker network
- install_dependency ActionType enum value
- Soft limit default value

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kubex_manager/skill_resolver.py`: SkillResolver + ComposedSkillSet already implement skill composition (SKIL-03). Needs extension to accept agent config objects, not just skill name lists
- `kubex_manager/lifecycle.py`: KubexLifecycle.create_kubex() already handles Docker container creation with skill_mounts and SkillValidator integration. Pipeline steps will be inserted before the Docker create call
- `gateway/policy.py`: PolicyEngine + PolicyLoader already implement the ALLOW/DENY/ESCALATE cascade. PolicyLoader reads per-agent policy YAML — `allowed_skills` field will be added here
- `kubex_manager/main.py`: FastAPI router with /kubexes CRUD endpoints. New endpoints (respawn, install-dep, config inspect) will be added to this router
- `kubex_manager/skill_validator.py`: SkillValidator with regex blocklist + validation. Already integrated into create_kubex()

### Established Patterns
- Per-agent policy YAML at `agents/{agent_id}/policies/policy.yaml` — skill allowlist goes here
- Redis db3 for lifecycle events (Manager already has this connection)
- `KubexRecord` dataclass for in-memory state — needs Redis serialization
- `CreateKubexRequest` dataclass as spawn input — will be extended with new pipeline steps
- Bearer token auth on all /kubexes endpoints — new endpoints follow same pattern

### Integration Points
- Gateway `POST /policy/skill-check` endpoint — new route on the Gateway service, consumed by Manager
- Gateway `POST /actions` handler — needs `install_dependency` ActionType added to routing
- Gateway → Manager communication — direct HTTP calls for install-dep execution
- `NETWORK_INTERNAL` constant in kubex_common — will be replaced by dynamic label lookup
- `docker-compose.yml` network definition — needs label addition

</code_context>

<specifics>
## Specific Ideas

- ConfigBuilder's config.yaml output should be reusable — "if we decide to respawn or duplicate a kubex, we can simply reuse the saved config"
- Runtime dep approval flow is self-improving: reviewer-approved packages auto-add to config, so the agent becomes more capable over time without operator intervention
- Soft limit on runtime installs prevents abuse while keeping the system flexible — "too many deps prompts human escalate, not hard deny"
- The spawn pipeline should be fully atomic with rollback — no orphan containers, no partial state
- Config inspection via API is important for debugging and auditing running agents

</specifics>

<deferred>
## Deferred Ideas

- System packages (apt) for runtime install — Phase 6 does pip only at runtime; apt packages only at boot via config.yaml
- Volume resolution by Docker labels — only network uses label lookup for now
- Resumable spawn pipeline — atomic for now; resumable is more complex and not needed yet
- Config versioning / diff between saved configs — useful for auditing config drift

</deferred>

---

*Phase: 06-manager-spawn-policy-gates*
*Context gathered: 2026-03-15*


Current Flow (With MCP Bridge, No Fix)

  When the orchestrator LLM wants to call a worker's tool, the request passes through two separate LLM reasoning cycles:

  sequenceDiagram
      participant OrcLLM as Orchestrator LLM
      participant MCP as MCP Bridge
      participant Broker as Broker
      participant Worker as Worker Harness
      participant WorkerLLM as Worker LLM (GPT-5.2)
      participant Tool as create_note()

      Note over OrcLLM: LLM Call #1 (orchestrator)
      OrcLLM->>MCP: tools/call("knowledge__create_note", {title: "Boot Day", content: "We booted today"})
      MCP->>Broker: dispatch to knowledge_management capability
      Note over MCP,Broker: context_message = "Use create_note with {title: 'Boot Day', content: 'We booted today'}"
      Broker->>Worker: task delivered via Redis stream

      Note over WorkerLLM: LLM Call #2 (worker) — REDUNDANT
      Worker->>WorkerLLM: system_prompt + context_message
      Note over WorkerLLM: LLM reads the message,<br/>reasons about it,<br/>decides to call create_note,<br/>generates function call JSON
      WorkerLLM->>Worker: tool_calls: [{name: "create_note", args: {title: "Boot Day", content: "We booted today"}}]
      Worker->>Tool: execute create_note(title, content)
      Tool-->>Worker: {status: "created", path: "events/boot-day.md"}

      Note over WorkerLLM: LLM Call #3 (worker summarizes)
      Worker->>WorkerLLM: tool result
      WorkerLLM->>Worker: "I've created the note at events/boot-day.md"
      Worker-->>Broker: store result
      Broker-->>MCP: poll returns result
      MCP-->>OrcLLM: "I've created the note at events/boot-day.md"

  The problem: The orchestrator already knows exactly which tool to call with exactly which arguments. But the worker LLM gets a natural language message, has to reason
  about it, decide which tool to call, reconstruct the same arguments, then summarize the result. That's 2-3 extra LLM calls that add:

  - Latency: ~3-10 seconds per LLM call × 2-3 calls = 6-30s wasted
  - Cost: Worker LLM tokens are burned just to parrot back the same tool call
  - Risk: The worker LLM might misinterpret and call the wrong tool, or modify the arguments

  ---
  After Fix: Direct Execution Mode

  The worker harness recognizes a structured payload and skips its LLM entirely, calling the tool function directly:

  sequenceDiagram
      participant OrcLLM as Orchestrator LLM
      participant MCP as MCP Bridge
      participant Broker as Broker
      participant Worker as Worker Harness
      participant Tool as create_note()

      Note over OrcLLM: LLM Call #1 (orchestrator) — ONLY LLM CALL
      OrcLLM->>MCP: tools/call("knowledge__create_note", {title: "Boot Day", content: "We booted today"})
      MCP->>Broker: dispatch to knowledge_management capability
      Note over MCP,Broker: context_message = {"_mcp_direct": true,<br/>"tool": "create_note",<br/>"arguments": {title: "Boot Day", content: "We booted today"}}

      Broker->>Worker: task delivered via Redis stream

      Note over Worker: Detects _mcp_direct flag<br/>Skips LLM entirely
      Worker->>Tool: _execute_tool("create_note", {title, content})
      Tool-->>Worker: {status: "created", path: "events/boot-day.md"}

      Worker-->>Broker: store raw tool result
      Broker-->>MCP: poll returns result
      MCP-->>OrcLLM: {status: "created", path: "events/boot-day.md"}

  What changes in the worker harness (_handle_message in standalone.py):

  async def _handle_message(self, client, msg, consumer_group):
      task_id = msg.get("task_id")
      context_message = msg.get("context_message", "")

      # Try to parse as direct MCP tool call
      try:
          parsed = json.loads(context_message)
          if parsed.get("_mcp_direct"):
              # Skip LLM — execute tool directly
              result = await self._execute_tool(
                  client, parsed["tool"], parsed["arguments"], task_id
              )
              await self._store_result(client, task_id, json.dumps(result))
              await self._ack(client, message_id, consumer_group)
              return
      except (json.JSONDecodeError, KeyError):
          pass

      # Normal flow — send to LLM
      llm_response = await self._call_llm_with_tools(client, context_message, task_id)
      # ... rest unchanged

  Both modes coexist. Natural language tasks ("research trending AI posts and write a summary") still go through the worker LLM. Direct tool calls skip it. The MCP bridge
  always uses direct mode. The orchestrator in standalone mode (without MCP) still uses natural language dispatch.

  ---
  Comparison

  ┌────────────────────────┬─────────────────────────────────────────────────────┬─────────────────────────────────────────┐
  │                        │                     Without Fix                     │                With Fix                 │
  ├────────────────────────┼─────────────────────────────────────────────────────┼─────────────────────────────────────────┤
  │ LLM calls per tool     │ 3 (orchestrator + worker reason + worker summarize) │ 1 (orchestrator only)                   │
  ├────────────────────────┼─────────────────────────────────────────────────────┼─────────────────────────────────────────┤
  │ Latency                │ 10-30s                                              │ 2-5s                                    │
  ├────────────────────────┼─────────────────────────────────────────────────────┼─────────────────────────────────────────┤
  │ Cost                   │ 3× token usage                                      │ 1× token usage                          │
  ├────────────────────────┼─────────────────────────────────────────────────────┼─────────────────────────────────────────┤
  │ Accuracy               │ Worker LLM might call wrong tool                    │ Deterministic — exact tool + exact args │
  ├────────────────────────┼─────────────────────────────────────────────────────┼─────────────────────────────────────────┤
  │ Result format          │ LLM natural language summary                        │ Raw structured tool output              │
  ├────────────────────────┼─────────────────────────────────────────────────────┼─────────────────────────────────────────┤
  │ Natural language tasks │ Works                                               │ Still works (falls through to LLM path) │
  └────────────────────────┴─────────────────────────────────────────────────────┴─────────────────────────────────────────┘