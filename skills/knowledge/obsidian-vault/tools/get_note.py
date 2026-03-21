"""get_note tool — wrapper for vault_ops.get_note."""

from __future__ import annotations

import os
from typing import Any

import httpx

import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from vault_ops import get_note as _get_note


async def get_note(
    client: httpx.AsyncClient,
    args: dict[str, Any],
    **_kwargs: Any,
) -> dict[str, Any]:
    vault_path = os.environ.get("VAULT_PATH", "/app/vault")
    return _get_note(vault_path=vault_path, path=args["path"])
