---
status: awaiting_human_verify
trigger: "capability name mismatch - orchestrator dispatches instagram-scraper but worker consumes scrape_instagram"
created: 2026-03-08T00:00:00Z
updated: 2026-03-08T23:45:00Z
---

## Current Focus

hypothesis: CONFIRMED - kubex-manager _register_with_registry reads "skills" instead of "capabilities"
test: fixed code, re-registered agent, ran unit tests
expecting: user verifies multi-agent coordination works end-to-end
next_action: awaiting human verification

## Symptoms

expected: dispatch_task with capability scrape_instagram -> broker -> instagram-scraper consumes -> result stored
actual: orchestrator uses capability "instagram-scraper" (agent name), nobody consumes from that stream
errors: wait_for_result returns 404 forever
reproduction: kclaw ask scrape_instagram "any message" - times out
started: multi-agent coordination attempt

## Eliminated

## Evidence

- timestamp: 2026-03-08
  checked: agents/instagram-scraper/config.yaml
  found: capabilities are ["scrape_instagram", "extract_metrics"]
  implication: config file is correct; issue is in registration

- timestamp: 2026-03-08
  checked: kclaw.py cmd_spawn
  found: code reads capabilities from config.yaml correctly (line 366)
  implication: spawn code looks correct

- timestamp: 2026-03-08
  checked: broker streams.py publish/consume
  found: publish creates consumer group for delivery.capability; consume filters by capability matching agent_id
  implication: consumer must call consume with the CAPABILITY name (scrape_instagram), not agent_id

- timestamp: 2026-03-08
  checked: registry GET /agents
  found: instagram-scraper had "capabilities":[] (empty list)
  implication: registration was done without capabilities

- timestamp: 2026-03-08
  checked: kubex-manager lifecycle.py _register_with_registry (line 396)
  found: reads agent_cfg.get("skills", []) instead of agent_cfg.get("capabilities", [])
  implication: ROOT CAUSE - manager registers agents with skills list instead of capabilities list

- timestamp: 2026-03-08
  checked: kclaw.py spawn flow
  found: kclaw registers correctly first (line 380), but manager start_kubex overwrites with wrong data
  implication: even correct kclaw registration gets overwritten by manager's buggy _register_with_registry

- timestamp: 2026-03-08
  checked: re-registered instagram-scraper via curl DELETE + POST
  found: now shows capabilities: ["scrape_instagram", "extract_metrics"]
  implication: immediate fix applied to live registry

- timestamp: 2026-03-08
  checked: gateway -> broker result proxy path
  found: gateway proxies to broker at http://kubex-broker:8060, broker stores at task:result:{task_id}, path is correct
  implication: result retrieval works fine; issue was purely that no result was ever stored

- timestamp: 2026-03-08
  checked: unit tests after fix
  found: 43/43 kubex manager unit tests pass (1 pre-existing failure unrelated), registry helper tests all pass
  implication: fix is safe

## Resolution

root_cause: In services/kubex-manager/kubex_manager/lifecycle.py line 396, _register_with_registry reads agent_cfg.get("skills", []) instead of agent_cfg.get("capabilities", []). This causes the manager to register agents with their skills list (or empty) instead of their actual capabilities. When kclaw spawn registers correctly first, the manager's start_kubex overwrites with incorrect data.

fix: Changed "skills" to "capabilities" in lifecycle.py line 396. Updated test to use "capabilities" key and assert correct capabilities are POSTed. Also re-registered instagram-scraper in the live registry with correct capabilities.

verification: 43 kubex-manager unit tests pass, including strengthened test_register_posts_to_registry that now asserts capabilities == ["cap-a"]. Live registry verified via curl.

files_changed:
  - services/kubex-manager/kubex_manager/lifecycle.py
  - tests/unit/test_kubex_manager_unit.py
