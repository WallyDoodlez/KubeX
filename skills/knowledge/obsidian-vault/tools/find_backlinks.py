"""find_backlinks tool — wrapper for vault_ops.find_backlinks."""

from __future__ import annotations

import os
from typing import Any

import httpx

import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from vault_ops import find_backlinks as _find_backlinks


async def find_backlinks(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    **_kwargs: Any,
) -> list[dict[str, Any]]:
    vault_path = os.environ.get("VAULT_PATH", "/app/vault")
    return _find_backlinks(vault_path=vault_path, note_name=args["note_name"])
