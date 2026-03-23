"""FastAPI hook server for receiving Claude Code hook events.

Claude Code fires hooks (PostToolUse, Stop, SessionEnd, SubagentStop) and POSTs
the event JSON to http://127.0.0.1:8099/hooks via native `type: "http"` hook config.

Design decisions:
  - D-01: Single catch-all POST /hooks route
  - D-02: FastAPI + uvicorn, async-native
  - D-03: Strict Pydantic models per event type
  - D-04: Unknown/malformed event_names return 200 (logged at WARNING, not rejected)
  - D-05: Runs in same asyncio loop as CLIRuntime — no cross-thread calls
  - D-07: Bound to 127.0.0.1:8099 — localhost only

Security: Hook events with shell injection in fields are parsed as plain strings.
No shell execution occurs — data flows to CLIRuntime handlers where it is stored.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated, Any, Union

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

try:
    from typing import Literal
except ImportError:
    from typing_extensions import Literal  # type: ignore[assignment]

logger = logging.getLogger("kubex_harness.hook_server")

# ---------------------------------------------------------------------------
# Pydantic event models (D-03)
# ---------------------------------------------------------------------------


class PostToolUseEvent(BaseModel):
    """Claude Code PostToolUse hook — fired after every tool call completes."""

    hook_event_name: Literal["PostToolUse"]
    session_id: str
    tool_name: str
    tool_use_id: str = ""
    tool_input: dict = Field(default_factory=dict)
    tool_response: dict = Field(default_factory=dict)
    cwd: str = ""
    permission_mode: str = ""
    transcript_path: str = ""


class StopEvent(BaseModel):
    """Claude Code Stop hook — fired when Claude finishes a turn."""

    hook_event_name: Literal["Stop"]
    session_id: str
    stop_hook_active: bool = False
    last_assistant_message: str = ""
    cwd: str = ""
    permission_mode: str = ""
    transcript_path: str = ""


class SubagentStopEvent(BaseModel):
    """Claude Code SubagentStop hook — fired when a subagent completes."""

    hook_event_name: Literal["SubagentStop"]
    session_id: str
    stop_hook_active: bool = False
    agent_id: str = ""
    agent_type: str = ""
    agent_transcript_path: str = ""
    last_assistant_message: str = ""
    cwd: str = ""
    permission_mode: str = ""
    transcript_path: str = ""


class SessionEndEvent(BaseModel):
    """Claude Code SessionEnd hook — fired when a session terminates."""

    hook_event_name: Literal["SessionEnd"]
    session_id: str
    reason: str = ""
    cwd: str = ""
    transcript_path: str = ""


# Discriminated union on hook_event_name (D-03)
HookEvent = Annotated[
    Union[PostToolUseEvent, StopEvent, SubagentStopEvent, SessionEndEvent],
    Field(discriminator="hook_event_name"),
]

# TypeAdapter for validating the discriminated union (pydantic v2)
_hook_event_adapter: TypeAdapter[Any] = TypeAdapter(HookEvent)

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_hook_app(cli_runtime: Any) -> FastAPI:
    """Create the FastAPI app for receiving Claude Code hook events.

    Args:
        cli_runtime: CLIRuntime instance whose handler methods are called.

    Returns:
        Configured FastAPI application.
    """
    app = FastAPI(title="kubex-hook-server", docs_url=None, redoc_url=None)

    @app.post("/hooks")
    async def receive_hook(request: Request) -> JSONResponse:
        """Single catch-all hook endpoint (D-01).

        Accepts all hook_event_name values. Unknown or malformed payloads
        are logged at WARNING and discarded — never rejected with 422 (D-04).
        """
        try:
            raw = await request.json()
        except Exception as exc:
            logger.warning("hook_parse_error: could not parse JSON body: %s", exc)
            return JSONResponse(status_code=200, content={"ok": True})

        try:
            event = _hook_event_adapter.validate_python(raw)
        except (ValidationError, Exception) as exc:
            event_name = raw.get("hook_event_name", "<unknown>") if isinstance(raw, dict) else "<unknown>"
            logger.warning(
                "hook_unknown_or_malformed event_name=%s error=%s",
                event_name,
                str(exc)[:120],
            )
            return JSONResponse(status_code=200, content={"ok": True})

        # Route to type-specific handler
        try:
            if isinstance(event, PostToolUseEvent):
                await cli_runtime._on_post_tool_use(event)
            elif isinstance(event, StopEvent):
                await cli_runtime._on_stop(event)
            elif isinstance(event, SubagentStopEvent):
                await cli_runtime._on_subagent_stop(event)
            elif isinstance(event, SessionEndEvent):
                await cli_runtime._on_session_end(event)
        except Exception as exc:
            logger.warning("hook_handler_error event=%s error=%s", type(event).__name__, exc)

        return JSONResponse(status_code=200, content={"ok": True})

    return app


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------


async def start_hook_server(cli_runtime: Any) -> uvicorn.Server:
    """Start the hook server as an asyncio background task (D-05, D-07).

    Binds to 127.0.0.1:8099 (localhost only — no external exposure).
    Runs as asyncio.create_task() — shares the event loop with CLIRuntime.
    Does NOT call uvicorn.run() which would block the loop (Pitfall 2).

    Args:
        cli_runtime: CLIRuntime instance passed to create_hook_app.

    Returns:
        uvicorn.Server instance (caller stores for shutdown via should_exit).
    """
    app = create_hook_app(cli_runtime)
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=8099,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    asyncio.create_task(server.serve())
    logger.info("Hook server started on 127.0.0.1:8099")
    return server
