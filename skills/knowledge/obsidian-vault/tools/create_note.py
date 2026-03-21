"""create_note tool — wrapper for vault_ops.create_note."""

from __future__ import annotations

import os
from typing import Any

import httpx

import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from vault_ops import create_note as _create_note


async def create_note(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    **_kwargs: Any,
) -> dict[str, Any]:
    vault_path = os.environ.get("VAULT_PATH", "/app/vault")
    return _create_note(
        vault_path=vault_path,
        title=args["title"],
        content=args["content"],
        folder=args["folder"],
        tags=args.get("tags", []),
        links=args.get("links"),
        source=args.get("source"),
        note_type=args.get("note_type"),
    )
