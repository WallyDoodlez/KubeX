"""vault_ops.py — Obsidian vault operations for the KubexClaw knowledge agent.

Provides pure file-I/O functions for managing an Obsidian-style markdown vault.
No database, no search index — just files and grep-style scanning.

All paths are vault-relative (e.g. ``facts/openai-rate-limits.md``).
The vault root is resolved from the ``vault_path`` argument passed to each
function (callers typically read it from ``os.environ["VAULT_PATH"]``).

Git operations are optional — functions degrade gracefully when no git repo
is present.
"""

from __future__ import annotations

import os
import re
import subprocess
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_VALID_FOLDERS = {"facts", "entities", "events", "decisions", "logs"}

_FOLDER_TYPE_MAP = {
    "facts": "fact",
    "entities": "entity",
    "events": "event",
    "decisions": "decision",
    "logs": "log",
}


def _vault_root(vault_path: str) -> Path:
    """Return the vault root as a ``Path``, raising if it does not exist."""
    p = Path(vault_path)
    if not p.exists():
        raise FileNotFoundError(f"Vault path does not exist: {vault_path}")
    return p


def _slugify(title: str) -> str:
    """Convert a title to a kebab-case filename slug (without extension)."""
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug.strip())
    slug = re.sub(r"-{2,}", "-", slug)
    return slug


def _build_frontmatter(
    title: str,
    note_type: str,
    tags: list[str],
    source: str | None,
    today: str | None = None,
) -> str:
    """Return a YAML frontmatter block as a string."""
    today = today or date.today().isoformat()
    fm: dict[str, Any] = {
        "title": title,
        "type": note_type,
        "tags": tags,
        "created": today,
        "modified": today,
    }
    if source:
        fm["source"] = source
    return "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True) + "---\n"


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a note into ``(frontmatter_dict, body_text)``.

    Returns an empty dict and the full text if no valid frontmatter is found.
    """
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm_yaml = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    try:
        fm = yaml.safe_load(fm_yaml) or {}
    except yaml.YAMLError:
        fm = {}
    return fm, body


def _build_related_section(links: list[str]) -> str:
    """Return a ``## Related`` section string for the given link names."""
    if not links:
        return ""
    lines = ["\n## Related\n"]
    for link in links:
        lines.append(f"- [[{link}]]\n")
    return "".join(lines)


def _auto_commit_and_push(vault_path: str, message: str) -> None:
    """Silently commit and push vault changes after a write operation.

    Every write to the vault is automatically committed and pushed to the
    remote (if one is configured).  Degrades gracefully — does nothing when
    the vault is not a git repo, git is unavailable, or no remote exists.
    Never raises.
    """
    try:
        _run = lambda cmd: subprocess.run(
            cmd, cwd=vault_path, capture_output=True, text=True, timeout=30,
        )
        check = _run(["git", "rev-parse", "--is-inside-work-tree"])
        if check.returncode != 0:
            return
        _run(["git", "add", "-A"])
        status = _run(["git", "status", "--porcelain"])
        if not status.stdout.strip():
            return
        _run(["git", "commit", "-m", message])
        _run(["git", "push"])
    except Exception:
        pass  # Git is optional — vault works without it


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_note(
    vault_path: str,
    title: str,
    content: str,
    folder: str,
    tags: list[str],
    links: list[str] | None = None,
    source: str | None = None,
    note_type: str | None = None,
    today: str | None = None,
) -> dict[str, Any]:
    """Create a new markdown note in the vault.

    Args:
        vault_path: Absolute path to the vault root directory.
        title: Human-readable title for the note.
        content: Full markdown body (frontmatter is auto-generated).
        folder: Vault subfolder — one of ``facts``, ``entities``, ``events``,
            ``decisions``, ``logs``.
        tags: List of lowercase kebab-case tag strings.
        links: Optional list of note names to include in a ``## Related``
            section.
        source: Optional source identifier (task ID, workflow ID, or URL).
        note_type: Override note type; defaults to the folder-derived type.
        today: Override today's date string (``YYYY-MM-DD``); used in tests.

    Returns:
        ``{"path": vault_relative_path, "created": True}``

    Raises:
        ValueError: If *folder* is not one of the valid vault folders.
        FileExistsError: If a note with the derived slug already exists.
    """
    if folder not in _VALID_FOLDERS:
        raise ValueError(f"Invalid folder '{folder}'. Must be one of: {sorted(_VALID_FOLDERS)}")

    root = _vault_root(vault_path)
    folder_path = root / folder
    folder_path.mkdir(parents=True, exist_ok=True)

    resolved_type = note_type or _FOLDER_TYPE_MAP[folder]
    slug = _slugify(title)
    filename = f"{slug}.md"
    note_path = folder_path / filename
    rel_path = f"{folder}/{filename}"

    if note_path.exists():
        raise FileExistsError(f"Note already exists: {rel_path}. Use update_note instead.")

    today_str = today or date.today().isoformat()
    frontmatter = _build_frontmatter(title, resolved_type, tags, source, today_str)
    related = _build_related_section(links or [])
    full_text = frontmatter + "\n" + content.rstrip("\n") + "\n" + related

    note_path.write_text(full_text, encoding="utf-8")
    _auto_commit_and_push(vault_path, f"knowledge: create {rel_path}")
    return {"path": rel_path, "created": True}


def update_note(
    vault_path: str,
    path: str,
    content: str,
    mode: str = "append",
    today: str | None = None,
) -> dict[str, Any]:
    """Update an existing vault note.

    Args:
        vault_path: Absolute path to the vault root.
        path: Vault-relative path of the note (e.g. ``facts/openai-rate-limits.md``).
        content: New markdown content.
        mode: ``"append"`` (default) — adds content under a dated heading.
            ``"replace"`` — replaces the full body, preserving frontmatter.
        today: Override today's date string; used in tests.

    Returns:
        ``{"path": path, "updated": True}``

    Raises:
        FileNotFoundError: If the note does not exist.
        ValueError: If *mode* is invalid.
    """
    if mode not in ("append", "replace"):
        raise ValueError(f"Invalid mode '{mode}'. Must be 'append' or 'replace'.")

    root = _vault_root(vault_path)
    note_path = root / path

    if not note_path.exists():
        raise FileNotFoundError(f"Note not found: {path}")

    today_str = today or date.today().isoformat()
    existing = note_path.read_text(encoding="utf-8")
    fm, body = _parse_frontmatter(existing)

    # Update the modified date in frontmatter
    fm["modified"] = today_str
    fm_yaml = "---\n" + yaml.dump(fm, default_flow_style=False, allow_unicode=True) + "---\n"

    if mode == "replace":
        new_text = fm_yaml + "\n" + content.rstrip("\n") + "\n"
    else:
        update_heading = f"\n## Update: {today_str}\n\n"
        new_text = fm_yaml + "\n" + body.rstrip("\n") + "\n" + update_heading + content.rstrip("\n") + "\n"

    note_path.write_text(new_text, encoding="utf-8")
    _auto_commit_and_push(vault_path, f"knowledge: update {path}")
    return {"path": path, "updated": True}


def search_notes(
    vault_path: str,
    query: str,
    folder: str | None = None,
    tag: str | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Search note titles and content for the given query string.

    Case-insensitive substring match across filenames and file bodies.

    Args:
        vault_path: Absolute path to the vault root.
        query: Search keywords (space-separated; all words must appear).
        folder: Optional folder to restrict search to.
        tag: Optional tag filter (note must have this tag in frontmatter).
        limit: Maximum number of results to return.

    Returns:
        List of ``{"path", "title", "snippet", "tags"}`` dicts, ordered by
        filename.
    """
    root = _vault_root(vault_path)
    search_root = root / folder if folder else root

    keywords = [kw.lower() for kw in query.split() if kw]
    results: list[dict[str, Any]] = []

    for note_file in sorted(search_root.rglob("*.md")):
        if note_file.name.startswith("."):
            continue
        try:
            text = note_file.read_text(encoding="utf-8")
        except OSError:
            continue

        text_lower = text.lower()
        if not all(kw in text_lower for kw in keywords):
            continue

        fm, body = _parse_frontmatter(text)
        note_tags: list[str] = fm.get("tags") or []

        if tag and tag not in note_tags:
            continue

        # Build a short snippet around the first keyword hit
        idx = text_lower.find(keywords[0]) if keywords else 0
        start = max(0, idx - 40)
        snippet = text[start : start + 120].replace("\n", " ").strip()

        rel_path = str(note_file.relative_to(root)).replace("\\", "/")
        results.append(
            {
                "path": rel_path,
                "title": fm.get("title", note_file.stem),
                "snippet": snippet,
                "tags": note_tags,
            }
        )

        if len(results) >= limit:
            break

    return results


def get_note(vault_path: str, path: str) -> dict[str, Any]:
    """Read a single vault note.

    Args:
        vault_path: Absolute path to the vault root.
        path: Vault-relative path (e.g. ``facts/openai-rate-limits.md``).

    Returns:
        ``{"path", "frontmatter", "content"}``

    Raises:
        FileNotFoundError: If the note does not exist.
    """
    root = _vault_root(vault_path)
    note_path = root / path

    if not note_path.exists():
        raise FileNotFoundError(f"Note not found: {path}")

    text = note_path.read_text(encoding="utf-8")
    fm, body = _parse_frontmatter(text)
    return {"path": path, "frontmatter": fm, "content": body}


def list_notes(vault_path: str, folder: str | None = None) -> list[dict[str, Any]]:
    """List notes in the vault, optionally filtered to a folder.

    Args:
        vault_path: Absolute path to the vault root.
        folder: Optional folder name to list. If omitted, all notes are listed.

    Returns:
        List of ``{"path", "title", "type", "tags", "modified"}`` dicts.
    """
    root = _vault_root(vault_path)
    search_root = root / folder if folder else root

    notes: list[dict[str, Any]] = []

    for note_file in sorted(search_root.rglob("*.md")):
        if note_file.name.startswith(".") or note_file.parent.name == ".obsidian":
            continue
        try:
            text = note_file.read_text(encoding="utf-8")
        except OSError:
            continue

        fm, _ = _parse_frontmatter(text)
        rel_path = str(note_file.relative_to(root)).replace("\\", "/")
        notes.append(
            {
                "path": rel_path,
                "title": fm.get("title", note_file.stem),
                "type": fm.get("type", "unknown"),
                "tags": fm.get("tags") or [],
                "modified": fm.get("modified", ""),
            }
        )

    return notes


def find_backlinks(vault_path: str, note_name: str) -> list[dict[str, Any]]:
    """Find all vault notes that contain a ``[[wiki-link]]`` to *note_name*.

    Args:
        vault_path: Absolute path to the vault root.
        note_name: The note name to search for (without ``.md`` extension).

    Returns:
        List of ``{"path", "title", "snippet"}`` dicts for each linking note.
    """
    root = _vault_root(vault_path)
    # Match [[note-name]] or [[note-name|display text]]
    pattern = re.compile(r"\[\[" + re.escape(note_name) + r"(\|[^\]]+)?\]\]")

    results: list[dict[str, Any]] = []

    for note_file in sorted(root.rglob("*.md")):
        if note_file.name.startswith("."):
            continue
        try:
            text = note_file.read_text(encoding="utf-8")
        except OSError:
            continue

        match = pattern.search(text)
        if not match:
            continue

        fm, _ = _parse_frontmatter(text)
        start = max(0, match.start() - 40)
        snippet = text[start : start + 120].replace("\n", " ").strip()

        rel_path = str(note_file.relative_to(root)).replace("\\", "/")
        results.append(
            {
                "path": rel_path,
                "title": fm.get("title", note_file.stem),
                "snippet": snippet,
            }
        )

    return results


