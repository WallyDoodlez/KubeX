---
created: 2026-03-22T03:15:00.000Z
title: Vault remote git sync — configurable repo push
area: general
files:
  - agents/knowledge/config.yaml
  - agents/_base/kubex_harness/vault_ops.py
  - skills/knowledge/obsidian-vault/SKILL.md
  - docker-compose.yml
---

## Problem

The knowledge vault is a local directory of markdown files inside the container. There's no mechanism to:
- Configure a remote git repository for the vault
- Auto-commit and push vault changes to that remote
- Pull from remote on container startup (sync state)
- Handle merge conflicts when multiple agents or humans edit the vault

The SKILL.md already tells the agent "persistence is fully automatic" and "every write automatically commits and pushes" — but none of that is implemented yet.

## Solution

Design considerations:
- **Config-driven**: remote repo URL, branch, auth (SSH key or token) configured in config.yaml or env vars
- **On-write commit+push**: every `create_note` / `update_note` triggers `git add + commit + push` to remote
- **On-boot pull**: container startup pulls latest from remote before accepting tasks
- **Conflict strategy**: agent writes are always append-based (dated update headings), so conflicts should be rare. If conflict occurs, prefer remote (human edits win) and re-apply agent changes.
- **Git attribution**: commits authored as the agent (e.g., `knowledge-kubex <knowledge@kubexclaw.local>`) so vault history shows who wrote what
- **Volume mount**: vault directory is a named Docker volume so it survives container restarts; git clone happens only on first boot
