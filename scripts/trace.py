#!/usr/bin/env python3
"""trace — Live pipeline trace for KubexClaw.

Subscribes to all Redis pub/sub channels and polls streams to show a unified
timeline of everything happening in the pipeline.

Usage:
    python scripts/trace.py              # Trace all events
    python scripts/trace.py --task ID    # Trace a specific task only
    python scripts/trace.py --agent ID   # Trace a specific agent only

Channels monitored:
    progress:{task_id}    (DB 1) — task stdout/progress chunks
    control:{agent_id}    (DB 1) — cancel commands
    lifecycle:{agent_id}  (DB 0) — agent state transitions (BOOTING/READY/BUSY/CREDENTIAL_WAIT)

Also polls:
    GET /health           — Gateway health
    GET /agents           — Registry agent list
    GET /kubexes          — Manager container list
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

# ── Load .env ──────────────────────────────────────────────────────────
def _load_env() -> dict[str, str]:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    env = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

ENV = _load_env()
REDIS_PW = ENV.get("REDIS_PASSWORD", "")
REDIS_URL = f"redis://default:{REDIS_PW}@localhost:6379"

# ── ANSI colors ────────────────────────────────────────────────────────
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
CYAN = "\033[96m"
WHITE = "\033[97m"
GRAY = "\033[90m"

# Event type → color
COLOR_MAP = {
    "lifecycle": CYAN,
    "progress": GREEN,
    "control": YELLOW,
    "dispatch": BLUE,
    "result": MAGENTA,
    "error": RED,
    "health": GRAY,
    "broker": WHITE,
}

# ── Helpers ────────────────────────────────────────────────────────────
def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

def _print_event(category: str, source: str, detail: str, data: str = ""):
    color = COLOR_MAP.get(category, WHITE)
    ts = _ts()
    line = f"{DIM}{ts}{RESET} {color}{BOLD}[{category:>10}]{RESET} {color}{source:<30}{RESET} {detail}"
    print(line)
    if data:
        # Truncate long data
        if len(data) > 200:
            data = data[:200] + "..."
        print(f"{'':>13} {DIM}{data}{RESET}")
    sys.stdout.flush()

def _print_header(text: str):
    print(f"\n{BOLD}{CYAN}{'─' * 60}{RESET}")
    print(f"{BOLD}{CYAN}  {text}{RESET}")
    print(f"{BOLD}{CYAN}{'─' * 60}{RESET}\n")

def _print_separator():
    print(f"{DIM}{'─' * 60}{RESET}")


# ── Redis pub/sub listener ─────────────────────────────────────────────
def _listen_pubsub(db: int, pattern: str, category: str, task_filter: str | None, agent_filter: str | None):
    """Subscribe to a Redis pub/sub pattern and print events."""
    try:
        import redis
    except ImportError:
        print(f"{RED}pip install redis{RESET}")
        return

    r = redis.from_url(REDIS_URL, db=db, decode_responses=True)
    ps = r.pubsub()
    ps.psubscribe(pattern)

    for msg in ps.listen():
        if msg["type"] not in ("pmessage",):
            continue

        channel = msg["channel"]
        raw = msg["data"]

        # Parse channel name
        parts = channel.split(":", 1)
        chan_type = parts[0] if parts else "?"
        chan_id = parts[1] if len(parts) > 1 else "?"

        # Apply filters
        if task_filter and chan_id != task_filter:
            continue
        if agent_filter and chan_id != agent_filter:
            continue

        # Parse JSON payload
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            data = {"raw": raw}

        # Format based on category
        if category == "lifecycle":
            state = data.get("state", "?")
            agent_id = data.get("agent_id", chan_id)
            state_color = {
                "booting": YELLOW,
                "credential_wait": RED,
                "ready": GREEN,
                "busy": BLUE,
            }.get(state, WHITE)
            _print_event(category, f"agent:{agent_id}", f"→ {state_color}{BOLD}{state}{RESET}")

        elif category == "progress":
            task_id = chan_id
            chunk = data.get("chunk", "")
            final = data.get("final", False)
            exit_reason = data.get("exit_reason", "")
            chunk_type = data.get("type", data.get("chunk_type", ""))

            if final:
                reason_str = f" ({exit_reason})" if exit_reason else ""
                _print_event(category, f"task:{task_id}", f"{BOLD}FINAL{reason_str}{RESET}")
            elif chunk_type == "hitl_request":
                _print_event(category, f"task:{task_id}", f"{YELLOW}HITL REQUEST{RESET}", str(chunk)[:200])
            elif chunk_type in ("stdout", "stderr"):
                _print_event(category, f"task:{task_id}", f"{chunk_type}", str(chunk)[:200])
            else:
                detail = chunk_type or "chunk"
                _print_event(category, f"task:{task_id}", detail, str(chunk)[:200] if chunk else "")

        elif category == "control":
            agent_id = chan_id
            command = data.get("command", "?")
            _print_event(category, f"agent:{agent_id}", f"{YELLOW}{command}{RESET}", json.dumps(data))

        else:
            _print_event(category, channel, "", json.dumps(data)[:200])


# ── HTTP polling ───────────────────────────────────────────────────────
def _poll_health():
    """Periodically check service health."""
    import urllib.request
    import urllib.error

    services = {
        "Gateway": "http://localhost:8080/health",
        "Broker": "http://localhost:8060/health",
        "Registry": "http://localhost:8070/health",
        "Manager": "http://localhost:8090/health",
    }

    last_status: dict[str, str] = {}

    while True:
        for name, url in services.items():
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read())
                    status = data.get("status", "?")
                    redis_ok = data.get("redis", {}).get("connected", None)

                    status_str = f"{GREEN}healthy{RESET}" if status == "healthy" else f"{RED}{status}{RESET}"
                    if redis_ok is False:
                        status_str += f" {RED}(redis: disconnected){RESET}"

                    key = f"{name}:{status}:{redis_ok}"
                    if key != last_status.get(name):
                        _print_event("health", name, status_str)
                        last_status[name] = key

            except Exception as e:
                key = f"{name}:error"
                if key != last_status.get(name):
                    _print_event("error", name, f"{RED}unreachable{RESET}", str(e)[:100])
                    last_status[name] = key

        time.sleep(10)


# ── Broker stream poller ───────────────────────────────────────────────
def _poll_broker_stream(task_filter: str | None, agent_filter: str | None):
    """Poll the broker's Redis stream for new task dispatches."""
    try:
        import redis
    except ImportError:
        return

    r = redis.from_url(REDIS_URL, db=0, decode_responses=True)
    last_id = "$"  # Start from now

    while True:
        try:
            results = r.xread({"boundary:default": last_id}, count=10, block=2000)
            for stream_name, messages in results:
                for msg_id, fields in messages:
                    last_id = msg_id
                    task_id = fields.get("task_id", "?")
                    capability = fields.get("capability", "?")

                    if task_filter and task_id != task_filter:
                        continue

                    _print_event("dispatch", f"task:{task_id}", f"→ {BOLD}{capability}{RESET}", f"stream_id={msg_id}")
        except Exception:
            time.sleep(2)


# ── Broker result poller ───────────────────────────────────────────────
def _poll_results(task_filter: str | None):
    """Watch for task results appearing in Redis."""
    try:
        import redis
    except ImportError:
        return

    r = redis.from_url(REDIS_URL, db=0, decode_responses=True)
    seen: set[str] = set()

    while True:
        try:
            keys = r.keys("task:result:*")
            for key in keys:
                if key in seen:
                    continue
                seen.add(key)

                task_id = key.replace("task:result:", "")
                if task_filter and task_id != task_filter:
                    continue

                raw = r.get(key)
                if raw:
                    try:
                        data = json.loads(raw)
                        status = data.get("status", "?")
                        agent_id = data.get("agent_id", "?")
                        output = data.get("output", "")[:150]

                        status_color = GREEN if status == "completed" else RED
                        _print_event("result", f"task:{task_id}", f"{status_color}{status}{RESET} by {agent_id}", output)
                    except json.JSONDecodeError:
                        _print_event("result", f"task:{task_id}", "raw", raw[:150])
        except Exception:
            pass
        time.sleep(2)


# ── Initial state dump ─────────────────────────────────────────────────
def _dump_initial_state():
    """Print current pipeline state on startup."""
    import urllib.request
    import urllib.error

    _print_header("PIPELINE STATE")

    # Agents
    try:
        req = urllib.request.Request("http://localhost:8070/agents")
        with urllib.request.urlopen(req, timeout=3) as resp:
            agents = json.loads(resp.read())
            for a in agents:
                status = a["status"]
                caps = ", ".join(a.get("capabilities", []))
                color = GREEN if status == "running" else RED
                print(f"  {color}●{RESET} {a['agent_id']:<25} {color}{status:<12}{RESET} [{caps}]")
    except Exception as e:
        print(f"  {RED}Registry unreachable: {e}{RESET}")

    print()

    # Kubexes
    try:
        headers = {"Authorization": f"Bearer {ENV.get('MANAGER_TOKEN', 'kubex-mgmt-token')}"}
        req = urllib.request.Request("http://localhost:8090/kubexes", headers=headers)
        with urllib.request.urlopen(req, timeout=3) as resp:
            kubexes = json.loads(resp.read())
            if kubexes:
                for k in kubexes:
                    print(f"  {BLUE}◆{RESET} {k.get('agent_id', '?'):<25} kubex={k.get('kubex_id', '?')[:8]}... {k.get('status', '?')}")
            else:
                print(f"  {DIM}No kubexes running{RESET}")
    except Exception as e:
        print(f"  {RED}Manager unreachable: {e}{RESET}")

    print()

    # Gateway health
    try:
        req = urllib.request.Request("http://localhost:8080/health")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            redis_ok = data.get("redis", {}).get("connected", False)
            redis_color = GREEN if redis_ok else RED
            print(f"  Gateway: {GREEN}up{RESET}  Redis: {redis_color}{'connected' if redis_ok else 'DISCONNECTED'}{RESET}")
    except Exception as e:
        print(f"  {RED}Gateway unreachable: {e}{RESET}")

    _print_header("LIVE TRACE (Ctrl+C to stop)")
    print(f"  {DIM}Listening on: progress:* (DB1), lifecycle:* (DB0), control:* (DB1), boundary:default (DB0){RESET}")
    print(f"  {DIM}Polling: health (10s), results (2s){RESET}")
    print()


# ── Main ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Live pipeline trace for KubexClaw")
    parser.add_argument("--task", help="Filter to a specific task ID")
    parser.add_argument("--agent", help="Filter to a specific agent ID")
    args = parser.parse_args()

    _dump_initial_state()

    # Start listener threads
    threads = [
        # Lifecycle events (DB 0)
        threading.Thread(target=_listen_pubsub, args=(0, "lifecycle:*", "lifecycle", args.task, args.agent), daemon=True),
        # Progress events (DB 1)
        threading.Thread(target=_listen_pubsub, args=(1, "progress:*", "progress", args.task, args.agent), daemon=True),
        # Control events (DB 1)
        threading.Thread(target=_listen_pubsub, args=(1, "control:*", "control", args.task, args.agent), daemon=True),
        # Health polling
        threading.Thread(target=_poll_health, daemon=True),
        # Broker stream (new dispatches)
        threading.Thread(target=_poll_broker_stream, args=(args.task, args.agent), daemon=True),
        # Result polling
        threading.Thread(target=_poll_results, args=(args.task,), daemon=True),
    ]

    for t in threads:
        t.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n{DIM}Trace stopped.{RESET}")


if __name__ == "__main__":
    main()
