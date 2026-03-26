# Backend Pipeline Audit — 2026-03-26

> Comprehensive audit of the entire KubexClaw backend pipeline.
> 4 parallel agents examined: Dispatch→Broker, Broker→Agent, Agent→Result, Lifecycle/Registry.

## Totals

| Severity | Count |
|----------|-------|
| **P0 — Critical** | 12 |
| **P1 — High** | 25 |
| **P2 — Medium** | 18 |
| **P3 — Low** | 10 |
| **Total** | **65** |

---

## P0 — Critical (data loss, silent failure, security)

| # | Area | Issue | File:Line |
|---|------|-------|-----------|
| 1 | Broker | `handle_pending()` is dead code — crashed tasks never retried, PEL grows forever | `streams.py:151` |
| 2 | Broker | `boundary:dlq` write-only — nothing reads it, no alerting | `streams.py:21` |
| 3 | Broker | `ensure_stream_and_group` swallows non-BUSYGROUP errors → silent task loss | `streams.py:55-60` |
| 4 | Gateway | No capability validation against Registry before publish — any string accepted | `gateway/main.py:294-320` |
| 5 | Gateway | Reviewer path uses raw dict, broker-down masked as security denial | `gateway/main.py:430-445` |
| 6 | Agent | CLI Runtime posts results to Gateway (no such endpoint) — results silently lost | `cli_runtime.py:594,611` |
| 7 | Agent | Harness posts results to Gateway (same wrong endpoint) — results silently lost | `harness.py:467` |
| 8 | Agent | Standalone/MCP Bridge always store `status: "completed"` on LLM errors | `standalone.py:558`, `mcp_bridge.py:674` |
| 9 | Agent | Broker result store never publishes to SSE pub/sub — active SSE clients get nothing if progress POST fails | `streams.py:245`, `gateway/main.py:809` |
| 10 | Registry | No heartbeat/TTL — ghost registrations accumulate forever | `store.py` (entire) |
| 11 | Registry | Agent crash (SIGKILL/OOM) skips finally block — no deregistration | `cli_runtime.py:239-246` |
| 12 | Agent boot | CLIRuntime registers/deregisters via Gateway `/registry/agents` — route doesn't exist, always 404 | `cli_runtime.py:426,448` |

---

## P1 — High (incorrect behavior, race conditions, silent failures)

| # | Area | Issue | File:Line |
|---|------|-------|-----------|
| 13 | Broker | `ensure_stream_and_group` uses `id="0"` — new groups replay all historical messages | `streams.py:48-53` |
| 14 | Broker | `filter_by_capability` ACKs unmatched messages — broken fan-out on shared stream | `streams.py:133-141` |
| 15 | Broker | Multiple agents same capability share `consumername` — PEL tracking collapses | `streams.py:119-124` |
| 16 | Broker | `xclaim` re-claims to same consumer — retry loop never re-delivers | `streams.py:188-194` |
| 17 | Broker | ACK endpoint ignores path param, uses body only | `broker/main.py:78-85` |
| 18 | Gateway | Originator stored before Broker call — orphaned on 502 | `gateway/main.py:298-349` |
| 19 | Gateway | `xadd` unhandled exception — 500 with stack trace on Redis full | `streams.py:80-85` |
| 20 | Gateway | 30s identity cache enables IP-recycling spoofing | `identity.py:27,50-54` |
| 21 | Gateway | Reviewer poll: 60 Redis GETs per review, no backoff | `gateway/main.py:450-456` |
| 22 | Gateway | `KUBEX_STRICT_IDENTITY` defaults off — agent_id spoofing in prod | `gateway/main.py:92-100` |
| 23 | Gateway | Rate limiter TOCTOU race — zcard+zadd not atomic | `ratelimit.py:97-123` |
| 24 | Agent | ACK sent even when result store failed — permanent task loss | `cli_runtime.py:501`, `standalone.py:298`, `mcp_bridge.py:485` |
| 25 | Agent | All result/progress POST failures silently swallowed — no retry | All agent files |
| 26 | Agent | No `final=True` progress event from CLI Runtime — SSE hangs forever | `cli_runtime.py:592-625` |
| 27 | Agent | Inconsistent SSE termination fields (`type` vs `final`); no `event:` prefix | `gateway/main.py:739-744` |
| 28 | Agent | Progress/cancel silently no-ops if Redis DB 1 unavailable | `gateway/main.py:807,834` |
| 29 | Agent | Harness creates new Redis client per task, never closed — connection leak | `harness.py:297` |
| 30 | Agent | `asyncio.get_event_loop()` deprecated — broken on Python 3.12+ | `cli_runtime.py:725` |
| 31 | Agent | Truncation/early-break masks non-zero exit as 0 | `cli_runtime.py:740`, `harness.py:740` |
| 32 | Agent | Blocking `httpx.get()` in MCP Bridge async handler — blocks event loop 5s | `mcp_bridge.py:527` |
| 33 | Registry | `resolve_capability()` trusts status field, no liveness check | `store.py:157-170` |
| 34 | Registry | Duplicate `agent_id` silently overwrites, no 409 | `store.py:63-75` |
| 35 | Manager | `restart_kubex()` doesn't deregister/re-register | `lifecycle.py:680-700` |
| 36 | Manager | `respawn_kubex()` doesn't deregister old agent | `main.py:291-347` |
| 37 | Manager | `remove_kubex()` doesn't stop container or deregister | `main.py:608-622` |
| 38 | Manager | `load_from_redis()` never called on startup — forgets all after restart | `lifecycle.py:261-289` |
| 39 | Manager | Docker unavailable: rollback also calls `docker.from_env()` — masks error | `lifecycle.py:520,573` |
| 40 | Boot | pip install failure halts container — Manager marks it RUNNING | `entrypoint.sh:36-40` |
| 41 | Boot | CLAUDE.md written twice; second write zeros it if skills dir empty | `entrypoint.sh:106`, `cli_runtime.py:275` |

---

## P2 — Medium

| # | Area | Issue | File:Line |
|---|------|-------|-----------|
| 42 | Broker | Publisher creates consumer group at publish-time — wrong actor, wrong `id` | `streams.py:68` |
| 43 | Broker | PEL entries for trimmed messages become ghost entries | `streams.py:214-216` |
| 44 | Broker | `audit:messages` stream unbounded — no MAXLEN | `streams.py:238` |
| 45 | Broker | `ensure_stream_and_group` called per-publish — wasteful roundtrip | `streams.py:62-68` |
| 46 | Broker | `TaskDelivery` schema lacks `published_at` field present in wire format | `streams.py:77` |
| 47 | Broker | CLI Runtime ACK after full execution — crash mid-task = permanent loss | `cli_runtime.py:501` |
| 48 | Broker | `_delegation_depth` dict grows unbounded — memory leak | `mcp_bridge.py:867` |
| 49 | Gateway | `context_message` unbounded size — Redis OOM risk | `gateway/main.py:316` |
| 50 | Gateway | Rate limiter fail-open on Redis error | `ratelimit.py:68-71` |
| 51 | Gateway | Budget tracker: None=skip, Redis error=500 — asymmetric | `gateway/main.py:113-115` |
| 52 | Gateway | Insecure default `KUBEX_MGMT_TOKEN` | `gateway/main.py:46` |
| 53 | Gateway | Audit endpoint swallows Redis error with no log | `gateway/main.py:934` |
| 54 | Gateway | BUG-007 fix emits empty output for Harness tasks | `gateway/main.py:719-728` |
| 55 | Gateway | Second SSE subscriber for completing task hangs | `gateway/main.py:737-744` |
| 56 | Agent | CLI Runtime uses different progress schema (`content`/`action`) — SSE never closes | `cli_runtime.py:886` |
| 57 | Registry | Capability Redis sets not rebuilt on restore — divergence risk | `store.py:84-89` |
| 58 | Manager | Credential injection uses private `._sock` — fragile | `main.py:567-571` |
| 59 | Boot | Unknown runtimes (e.g. `codex-cli`) not in CREDENTIAL_PATHS — 1hr silent hang | `cli_runtime.py:352-364` |

---

## P3 — Low

| # | Area | Issue | File:Line |
|---|------|-------|-----------|
| 60 | All | `datetime.utcnow()` deprecated — multiple files | `cli_runtime.py:859`, `actions.py:91,110` |
| 61 | Broker | `kubex__cancel_task` calls non-existent Broker endpoint | `mcp_bridge.py:362-369` |
| 62 | Gateway | `action_allowed` logged before dispatch outcome — misleading audit trail | `gateway/main.py:244-252` |
| 63 | Gateway | Dead comment "Resolve capability via Registry" | `gateway/main.py:309` |
| 64 | Gateway | Budget and rate-limit share DB1 despite docstring claiming DB4 | `gateway/main.py:1192` |
| 65 | Gateway | Policy loaded twice on cold start | `gateway/main.py:1160` |
| 66 | Agent | Harness cancel listener ignores `task_id` — cancels on any message | `harness.py:323` |
| 67 | Agent | Standalone sends LLM response as progress chunk, not result event | `standalone.py:289,292` |
| 68 | Agent | MCP Bridge uses `assert` as guard — wrong pattern | `mcp_bridge.py:654` |
| 69 | Boot | Hook server no readiness wait — early hooks dropped | `hook_server.py:186` |

---

## Top 5 Root Causes (most issues trace back to these)

1. **Wrong URL targets** — CLI Runtime uses `gateway_url` for result storage and registration, but Gateway has no such endpoints. Should use `broker_url` for results and `registry_url` for registration. (P0-6, P0-7, P0-12)

2. **No cleanup on failure** — handle_pending is dead code, no heartbeat, no TTL on registrations, no deregistration on crash. Dead agents and stuck tasks accumulate forever. (P0-1, P0-2, P0-10, P0-11, P1-35 through P1-38)

3. **Shared stream with per-capability consumer groups** — The single `boundary:default` stream forces every consumer group to read and filter every message. New groups replay history. Old groups pile up pending messages. The architecture doesn't scale. (P0-3, P1-13, P1-14, P1-15)

4. **Silent error swallowing** — Bare `except: pass` or `except: logger.debug()` on critical paths (result posting, progress posting, registration, deregistration). Failures are invisible. (P0-5, P0-8, P0-9, P1-24, P1-25)

5. **Inconsistent event schemas** — Each agent type uses different field names for progress events. SSE termination checks for `type` or `final` or both. CLI Runtime never sends `final=True`. FE expects event types that backend never emits. (P1-26, P1-27, P2-56, P3-67)

---

*Audited: 2026-03-26 by 4 parallel agents*
*Files examined: gateway/main.py, broker/streams.py, broker/main.py, cli_runtime.py, standalone.py, mcp_bridge.py, harness.py, store.py, lifecycle.py, identity.py, ratelimit.py, budget.py, config_loader.py, entrypoint.sh, hook_server.py*
