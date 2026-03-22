---
created: 2026-03-22T04:00:00.000Z
title: Sprint plan — prompts, vault persistence, context reset
area: general
files: []
---

## Sprint Order

1. **Improve kubex system prompts** (todo #3) — instagram-scraper prompt needs detail. Orchestrator + reviewer already done. Knowledge vault skill already detailed. Test all prompts against policy defense regression suite after changes.

2. **Wire live persistence** (todo #1) — vault ops are wired to filesystem. Remaining: ensure knowledge agent's standalone loop can call vault_ops directly (not just orchestrator via MCP bridge). Verify knowledge worker handles vault tasks E2E.

3. **Orchestrator context window clear/reset** (todo #2) — add kubex__clear_context meta-tool or automatic summarize+truncate at token threshold.

4. **Vault remote git sync** (todo #4) — configurable remote repo, auto commit+push on writes, pull on boot, git attribution per agent.
