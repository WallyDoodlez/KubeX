# KubexClaw Knowledge Vault

This vault is managed by the **KubexClaw knowledge agent** using the
`obsidian-vault` skill. Notes are created, updated, and linked automatically
as the agent swarm processes information.

## Browsing

Open this directory in [Obsidian](https://obsidian.md) to explore the
knowledge graph visually. Use **Graph View** (Ctrl+G / Cmd+G) to see how
notes connect via `[[wiki-links]]`.

## Structure

| Folder       | Contents                                          |
|--------------|---------------------------------------------------|
| `facts/`     | Discrete facts, figures, measurements, API specs  |
| `entities/`  | Named entities: companies, people, products       |
| `events/`    | Timestamped occurrences: incidents, launches      |
| `decisions/` | Architectural choices with rationale              |
| `logs/`      | Workflow run logs, scrape results, task summaries |
| `templates/` | Note templates (not indexed as knowledge)         |

## Note Format

Every note has YAML frontmatter:

```yaml
---
title: "Example Note"
type: fact
tags: [example, demo]
created: 2026-03-20
modified: 2026-03-20
source: "task-abc123"
---
```

## Editing

You can edit notes directly in Obsidian. The agent will merge its changes on
the next vault commit. Use git to resolve any conflicts.
