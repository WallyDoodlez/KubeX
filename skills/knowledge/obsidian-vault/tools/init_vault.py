"""init_vault.py — Initialize a fresh Obsidian knowledge vault.

Idempotent: safe to run on an existing vault — existing files are not
overwritten.  Missing directories and template files are created on each call.

Usage (CLI):
    python init_vault.py /path/to/vault

Usage (import):
    from init_vault import init_vault
    init_vault("/path/to/vault")
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Vault structure
# ---------------------------------------------------------------------------

_FOLDERS = [
    "facts",
    "entities",
    "events",
    "decisions",
    "logs",
    "templates",
]

# Minimal Obsidian app.json — enough for Obsidian to open the vault correctly
_OBSIDIAN_APP_JSON: dict = {
    "useMarkdownLinks": False,  # use [[wiki-links]]
    "newFileLocation": "folder",
    "newFileFolderPath": "facts",
}

# Minimal Obsidian workspace.json — empty canvas, valid format
_OBSIDIAN_WORKSPACE_JSON: dict = {
    "main": {
        "id": "main",
        "type": "split",
        "children": [],
        "direction": "vertical",
    },
    "left": {"id": "left", "type": "split", "children": [], "direction": "horizontal", "width": 300},
    "right": {"id": "right", "type": "split", "children": [], "direction": "horizontal", "width": 300},
    "active": "main",
    "lastOpenFiles": [],
}

_README = """\
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
"""

_TEMPLATE_FACT = """\
---
title: "{{title}}"
type: fact
tags: []
created: {{date}}
modified: {{date}}
source: ""
---

# {{title}}

<!-- Add the key fact or measurement here -->

## Related
<!-- Add [[wiki-links]] to connected notes -->
"""

_TEMPLATE_ENTITY = """\
---
title: "{{title}}"
type: entity
tags: []
created: {{date}}
modified: {{date}}
source: ""
---

# {{title}}

<!-- Describe this entity: what it is, who it is, why it matters -->

## Properties

| Property | Value |
|----------|-------|
|          |       |

## Related
<!-- Add [[wiki-links]] to connected notes -->
"""

_TEMPLATE_EVENT = """\
---
title: "{{title}}"
type: event
tags: []
created: {{date}}
modified: {{date}}
occurred: {{date}}
source: ""
---

# {{title}}

<!-- Describe what happened and its significance -->

## Timeline

- **{{date}}**: Event occurred

## Impact
<!-- What did this event affect? -->

## Related
<!-- Add [[wiki-links]] to connected notes -->
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def init_vault(vault_path: str) -> dict[str, list[str]]:
    """Initialize the Obsidian vault directory structure.

    Creates all required folders, the ``.obsidian/`` config directory,
    ``README.md``, and note templates. Existing files are **not** overwritten.

    Args:
        vault_path: Absolute path where the vault should be created.

    Returns:
        ``{"created": [...paths created...], "skipped": [...paths that already existed...]}``
    """
    root = Path(vault_path)
    root.mkdir(parents=True, exist_ok=True)

    created: list[str] = []
    skipped: list[str] = []

    def _write_if_missing(path: Path, text: str) -> None:
        if path.exists():
            skipped.append(str(path.relative_to(root)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            created.append(str(path.relative_to(root)))

    def _write_json_if_missing(path: Path, data: dict) -> None:
        _write_if_missing(path, json.dumps(data, indent=2) + "\n")

    # Create content folders
    for folder in _FOLDERS:
        folder_path = root / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        # Track folder creation only if it was new
        gitkeep = folder_path / ".gitkeep"
        _write_if_missing(gitkeep, "")

    # .obsidian config
    obsidian_dir = root / ".obsidian"
    obsidian_dir.mkdir(parents=True, exist_ok=True)
    _write_json_if_missing(obsidian_dir / "app.json", _OBSIDIAN_APP_JSON)
    _write_json_if_missing(obsidian_dir / "workspace.json", _OBSIDIAN_WORKSPACE_JSON)

    # README
    _write_if_missing(root / "README.md", _README)

    # Templates
    _write_if_missing(root / "templates" / "fact.md", _TEMPLATE_FACT)
    _write_if_missing(root / "templates" / "entity.md", _TEMPLATE_ENTITY)
    _write_if_missing(root / "templates" / "event.md", _TEMPLATE_EVENT)

    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python init_vault.py <vault_path>", file=sys.stderr)
        sys.exit(1)

    result = init_vault(sys.argv[1])
    print(f"Vault initialized at: {sys.argv[1]}")
    if result["created"]:
        print(f"  Created ({len(result['created'])}): {', '.join(result['created'][:5])}" +
              (" ..." if len(result["created"]) > 5 else ""))
    if result["skipped"]:
        print(f"  Skipped (already exist): {len(result['skipped'])} files")
