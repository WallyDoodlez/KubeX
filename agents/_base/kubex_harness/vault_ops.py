"""Vault operations -- in-process read/write functions for Obsidian-style knowledge vault.

These functions operate directly on the filesystem at VAULT_PATH. The vault is a
directory of markdown files with YAML frontmatter and [[wiki-links]], organized
into folders: facts/, entities/, events/, decisions/, logs/.

Read functions are called by MCPBridgeServer vault tools in-process (D-01).
Write functions are also available for direct use by the knowledge agent.
Vault writes from the orchestrator go through Gateway POST /actions (D-02).
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("kubex_harness.vault_ops")

# Vault root path -- configurable via environment
VAULT_PATH = os.environ.get("VAULT_PATH", "/app/vault")


def _vault_root() -> Path:
    """Return the vault root path, creating it if needed."""
    root = Path(VAULT_PATH)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from markdown content.

    Returns (frontmatter_dict, body_content).
    """
    if not content.startswith("---"):
        return {}, content

    end = content.find("---", 3)
    if end == -1:
        return {}, content

    fm_text = content[3:end].strip()
    body = content[end + 3:].strip()

    # Simple YAML parsing (avoid yaml dependency in harness)
    frontmatter: dict[str, Any] = {}
    for line in fm_text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            # Handle lists like [tag1, tag2]
            if value.startswith("[") and value.endswith("]"):
                items = value[1:-1].split(",")
                frontmatter[key] = [item.strip().strip("'\"") for item in items if item.strip()]
            elif value.startswith('"') and value.endswith('"'):
                frontmatter[key] = value[1:-1]
            elif value.startswith("'") and value.endswith("'"):
                frontmatter[key] = value[1:-1]
            elif value.lower() in ("true", "false"):
                frontmatter[key] = value.lower() == "true"
            else:
                frontmatter[key] = value

    return frontmatter, body


def _note_to_dict(path: Path, root: Path) -> dict[str, Any]:
    """Convert a note file to a summary dict."""
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return {"path": str(path.relative_to(root)), "error": "unreadable"}

    fm, body = _parse_frontmatter(content)
    rel_path = str(path.relative_to(root)).replace("\\", "/")

    return {
        "path": rel_path,
        "title": fm.get("title", path.stem.replace("-", " ").title()),
        "type": fm.get("type", "unknown"),
        "tags": fm.get("tags", []),
        "modified": fm.get("modified", ""),
        "created": fm.get("created", ""),
    }


def search_notes(query: str, folder: str = "") -> list[dict[str, Any]]:
    """Search notes in the vault by query string.

    Searches both filenames and content. Case-insensitive.

    Args:
        query: Search query string.
        folder: Optional folder to restrict search to.

    Returns:
        List of matching note dicts with 'path', 'title', 'snippet', 'tags' keys.
    """
    root = _vault_root()
    search_dir = root / folder if folder else root

    if not search_dir.is_dir():
        return []

    query_lower = query.lower()
    query_terms = query_lower.split()
    results: list[dict[str, Any]] = []

    for md_file in sorted(search_dir.rglob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except OSError:
            continue

        content_lower = content.lower()
        filename_lower = md_file.stem.lower()

        # Match if all query terms appear in content or filename
        if all(term in content_lower or term in filename_lower for term in query_terms):
            fm, body = _parse_frontmatter(content)
            rel_path = str(md_file.relative_to(root)).replace("\\", "/")

            # Extract snippet around first match
            snippet = ""
            for term in query_terms:
                idx = content_lower.find(term)
                if idx >= 0:
                    start = max(0, idx - 60)
                    end = min(len(content), idx + len(term) + 60)
                    snippet = content[start:end].replace("\n", " ").strip()
                    if start > 0:
                        snippet = "..." + snippet
                    if end < len(content):
                        snippet = snippet + "..."
                    break

            results.append({
                "path": rel_path,
                "title": fm.get("title", md_file.stem.replace("-", " ").title()),
                "snippet": snippet,
                "tags": fm.get("tags", []),
            })

    logger.info("vault_ops.search_notes: query=%r folder=%r results=%d", query, folder, len(results))
    return results[:20]  # Limit results


def get_note(path: str) -> dict[str, Any]:
    """Get a specific note by path.

    Args:
        path: Path to the note file relative to vault root.

    Returns:
        Dict with 'path', 'frontmatter', 'content' keys.
    """
    root = _vault_root()
    note_path = root / path

    if not note_path.is_file():
        logger.info("vault_ops.get_note: not found path=%r", path)
        return {"error": "not_found", "path": path}

    try:
        raw = note_path.read_text(encoding="utf-8")
    except OSError as exc:
        return {"error": "read_failed", "path": path, "message": str(exc)}

    fm, body = _parse_frontmatter(raw)
    logger.info("vault_ops.get_note: path=%r title=%r", path, fm.get("title", ""))

    return {
        "path": path,
        "frontmatter": fm,
        "content": body,
    }


def list_notes(folder: str = "") -> list[dict[str, Any]]:
    """List all notes, optionally filtered by folder.

    Args:
        folder: Optional folder to list. Empty string = all notes.

    Returns:
        List of note summary dicts.
    """
    root = _vault_root()
    search_dir = root / folder if folder else root

    if not search_dir.is_dir():
        logger.info("vault_ops.list_notes: folder=%r not found", folder)
        return []

    results = []
    for md_file in sorted(search_dir.rglob("*.md")):
        results.append(_note_to_dict(md_file, root))

    logger.info("vault_ops.list_notes: folder=%r count=%d", folder, len(results))
    return results


def find_backlinks(path: str) -> list[dict[str, Any]]:
    """Find notes that contain a [[wiki-link]] to the specified note.

    Args:
        path: Path or note name to search for backlinks to.

    Returns:
        List of note dicts that link to the target.
    """
    root = _vault_root()

    # Extract note name from path (e.g., "facts/api-limits.md" -> "api-limits")
    note_name = Path(path).stem

    # Pattern: [[note-name]] or [[note-name|display text]]
    pattern = re.compile(r"\[\[" + re.escape(note_name) + r"(?:\|[^\]]+)?\]\]", re.IGNORECASE)

    results: list[dict[str, Any]] = []
    for md_file in sorted(root.rglob("*.md")):
        # Don't include the note itself
        rel = str(md_file.relative_to(root)).replace("\\", "/")
        if rel == path or md_file.stem == note_name:
            continue

        try:
            content = md_file.read_text(encoding="utf-8")
        except OSError:
            continue

        match = pattern.search(content)
        if match:
            fm, body = _parse_frontmatter(content)
            # Get snippet around the link
            start = max(0, match.start() - 40)
            end = min(len(content), match.end() + 40)
            snippet = content[start:end].replace("\n", " ").strip()

            results.append({
                "path": rel,
                "title": fm.get("title", md_file.stem.replace("-", " ").title()),
                "snippet": snippet,
            })

    logger.info("vault_ops.find_backlinks: path=%r backlinks=%d", path, len(results))
    return results


def create_note(
    title: str,
    content: str,
    folder: str = "facts",
    tags: list[str] | None = None,
    note_type: str | None = None,
    source: str = "",
) -> dict[str, Any]:
    """Create a new note in the vault.

    Args:
        title: Human-readable title.
        content: Markdown body (without frontmatter).
        folder: Target folder (facts, entities, events, decisions, logs).
        tags: List of tags.
        note_type: Note type (defaults to folder name singular).
        source: Source task ID or URL.

    Returns:
        Dict with 'status' and 'path' of created file.
    """
    root = _vault_root()
    target_dir = root / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    # Generate filename from title
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    filename = f"{slug}.md"
    note_path = target_dir / filename

    # Derive type from folder if not specified
    if not note_type:
        folder_to_type = {
            "facts": "fact", "entities": "entity", "events": "event",
            "decisions": "decision", "logs": "log",
        }
        note_type = folder_to_type.get(folder, "fact")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tag_list = tags or []
    tag_str = "[" + ", ".join(tag_list) + "]"

    frontmatter = f"""---
title: "{title}"
type: {note_type}
tags: {tag_str}
created: {today}
modified: {today}
source: "{source}"
---"""

    full_content = f"{frontmatter}\n\n{content}\n"

    try:
        note_path.write_text(full_content, encoding="utf-8")
        rel_path = str(note_path.relative_to(root)).replace("\\", "/")
        logger.info("vault_ops.create_note: created %s", rel_path)
        return {"status": "created", "path": rel_path}
    except OSError as exc:
        logger.error("vault_ops.create_note: failed %s", exc)
        return {"status": "error", "message": str(exc)}


def update_note(path: str, content: str, mode: str = "append") -> dict[str, Any]:
    """Update an existing note.

    Args:
        path: Vault-relative path.
        content: New content to add or replace.
        mode: 'append' to add under dated heading, 'replace' to replace body.

    Returns:
        Dict with 'status' and 'path'.
    """
    root = _vault_root()
    note_path = root / path

    if not note_path.is_file():
        return {"status": "error", "message": f"Note not found: {path}"}

    try:
        existing = note_path.read_text(encoding="utf-8")
    except OSError as exc:
        return {"status": "error", "message": str(exc)}

    fm, body = _parse_frontmatter(existing)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if mode == "append":
        new_body = body + f"\n\n## Update: {today}\n\n{content}"
    else:
        new_body = content

    # Update modified date in frontmatter
    fm["modified"] = today

    # Reconstruct frontmatter
    fm_lines = ["---"]
    for key, value in fm.items():
        if isinstance(value, list):
            fm_lines.append(f"{key}: [{', '.join(str(v) for v in value)}]")
        elif isinstance(value, bool):
            fm_lines.append(f"{key}: {'true' if value else 'false'}")
        else:
            fm_lines.append(f'{key}: "{value}"' if " " in str(value) or not str(value) else f"{key}: {value}")
    fm_lines.append("---")

    full_content = "\n".join(fm_lines) + "\n\n" + new_body + "\n"

    try:
        note_path.write_text(full_content, encoding="utf-8")
        logger.info("vault_ops.update_note: updated %s (mode=%s)", path, mode)
        return {"status": "updated", "path": path}
    except OSError as exc:
        logger.error("vault_ops.update_note: failed %s", exc)
        return {"status": "error", "message": str(exc)}
