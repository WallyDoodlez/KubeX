"""list_notes tool — wrapper for vault_ops.list_notes."""

from __future__ import annotations

import os
from typing import Any

import httpx

import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from vault_ops import list_notes as _list_notes


async def list_notes(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    **_kwargs: Any,
) -> list[dict[str, Any]]:
    vault_path = os.environ.get("VAULT_PATH", "/app/vault")
    return _list_notes(vault_path=vault_path, folder=args.get("folder"))
