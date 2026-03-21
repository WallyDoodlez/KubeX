"""Vault operations -- in-process read functions for knowledge vault.

These functions are called directly by MCPBridgeServer vault read tools (D-01).
Vault writes go through Gateway POST /actions instead (D-02).

NOTE: These are stub implementations for Phase 8. The knowledge agent's
actual vault operations live in the knowledge agent's skill handlers.
These stubs provide the interface contract; full implementation will be
wired when the vault backend (Obsidian/filesystem) is integrated into
the harness directly.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("kubex_harness.vault_ops")

# Vault root path -- configurable via environment
VAULT_PATH = os.environ.get("VAULT_PATH", "/app/vault")


def search_notes(query: str, folder: str = "") -> list[dict[str, Any]]:
    """Search notes in the vault by query string.

    Args:
        query: Search query string.
        folder: Optional folder to restrict search to.

    Returns:
        List of matching note dicts with 'path', 'title', 'snippet' keys.
    """
    logger.info("vault_ops.search_notes: query=%r folder=%r", query, folder)
    # Stub: return empty results until vault backend is wired
    return []


def get_note(path: str) -> dict[str, Any]:
    """Get a specific note by path.

    Args:
        path: Path to the note file relative to vault root.

    Returns:
        Dict with 'path', 'title', 'content', 'metadata' keys.
    """
    logger.info("vault_ops.get_note: path=%r", path)
    # Stub: return not-found until vault backend is wired
    return {"error": "not_found", "path": path, "message": "Vault backend not yet wired"}


def list_notes(folder: str = "") -> list[dict[str, Any]]:
    """List all notes, optionally filtered by folder.

    Args:
        folder: Optional folder to list. Empty string = root.

    Returns:
        List of note dicts with 'path', 'title' keys.
    """
    logger.info("vault_ops.list_notes: folder=%r", folder)
    # Stub: return empty list until vault backend is wired
    return []


def find_backlinks(path: str) -> list[dict[str, Any]]:
    """Find notes that link to the specified note.

    Args:
        path: Path of the target note.

    Returns:
        List of note dicts that contain links to the target.
    """
    logger.info("vault_ops.find_backlinks: path=%r", path)
    # Stub: return empty list until vault backend is wired
    return []
