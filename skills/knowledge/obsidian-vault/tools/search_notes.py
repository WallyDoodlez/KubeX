"""search_notes tool — wrapper for vault_ops.search_notes."""

from __future__ import annotations

import os
from typing import Any

import httpx

import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from vault_ops import search_notes as _search_notes


async def search_notes(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    **_kwargs: Any,
) -> list[dict[str, Any]]:
    vault_path = os.environ.get("VAULT_PATH", "/app/vault")
    return _search_notes(
        vault_path=vault_path,
        query=args["query"],
        folder=args.get("folder"),
        tag=args.get("tag"),
        limit=args.get("limit", 10),
    )
