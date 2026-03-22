---
created: 2026-03-22T06:31:42.478Z
title: Auto-optimize vault organization on write
area: agents
files:
  - agents/knowledge/config.yaml
  - agents/_base/kubex_harness/standalone.py
  - agents/knowledge/skills/obsidian-vault/SKILL.md
---

## Problem

When the knowledge kubex writes new notes to the Obsidian vault, files accumulate without any structural optimization. Over time the vault becomes disorganized — notes lack backlinks, related content isn't grouped, and duplicate/overlapping notes aren't merged. The agent currently does a "write and forget" — it creates or updates a note but doesn't consider the vault's overall coherence.

## Solution

Add a post-write optimization step to the knowledge agent's vault operations:

1. **Auto-linking** — After writing a note, scan existing notes for related content and insert bidirectional backlinks (Obsidian `[[wikilink]]` style)
2. **Folder reorganization** — Periodically re-evaluate folder structure based on note topics/tags and move notes to more appropriate locations
3. **Deduplication** — Detect notes with overlapping content and suggest/perform merges (combine into a single canonical note with redirects)
4. **Tag normalization** — Standardize tags across notes (e.g., merge `#api` and `#API` and `#api-design`)

This could be implemented as:
- A new skill file (`vault-optimizer`) with optimization strategies
- A post-write hook in the vault skill that triggers lightweight optimization (linking only)
- A periodic full-optimization pass triggered by the orchestrator or on a schedule
- Budget-aware — skip optimization if remaining token budget is too low
