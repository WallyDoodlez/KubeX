#!/usr/bin/env python3
"""kclaw — KubexClaw CLI for service management and task dispatch.

Usage:
    python scripts/kclaw.py up                          # Start core services
    python scripts/kclaw.py down                        # Stop all services
    python scripts/kclaw.py agents                      # List registered agents
    python scripts/kclaw.py spawn <agent>               # Register + create + start agent
    python scripts/kclaw.py kill <agent>                # Stop + deregister agent
    python scripts/kclaw.py ask <capability> "<msg>"    # Dispatch task and wait for result
    python scripts/kclaw.py status                      # Health check all services
    python scripts/kclaw.py result <task_id>            # Fetch a task result
    python scripts/kclaw.py logs <agent>                # Tail agent container logs
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

# -- Constants -------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent

GATEWAY_URL = "http://localhost:8080"
REGISTRY_URL = "http://localhost:8070"
MANAGER_URL = "http://localhost:8090"
BROKER_URL = "http://localhost:8060"

CORE_SERVICES = ["redis", "gateway", "kubex-broker", "kubex-registry", "kubex-manager"]

POLL_INTERVAL = 2  # seconds
POLL_TIMEOUT = 60  # seconds

# -- ANSI colors -----------------------------------------------------

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def _ok(msg: str) -> None:
    print(f"  {GREEN}[OK]{RESET} {msg}")


def _fail(msg: str) -> None:
    print(f"  {RED}[FAIL]{RESET} {msg}")


def _info(msg: str) -> None:
    print(f"  {CYAN}[..]{RESET} {msg}")


def _warn(msg: str) -> None:
    print(f"  {YELLOW}[!!]{RESET} {msg}")


def _header(msg: str) -> None:
    print(f"\n{BOLD}{msg}{RESET}")


# -- .env loading ----------------------------------------------------


def _load_env() -> dict[str, str]:
    """Load key=value pairs from .env file."""
    env: dict[str, str] = {}
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    return env


def _get_manager_token() -> str:
    env = _load_env()
    return os.environ.get("MANAGER_TOKEN", env.get("MANAGER_TOKEN", "changeme-manager-token"))


# -- HTTP helpers (stdlib only) --------------------------------------


def _http(
    method: str,
    url: str,
    data: dict | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> tuple[int, dict | list | str]:
    """Make an HTTP request. Returns (status_code, parsed_body)."""
    hdrs = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)

    body_bytes = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body_bytes, headers=hdrs, method=method)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw


def _http_safe(
    method: str,
    url: str,
    data: dict | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 5.0,
) -> tuple[int, dict | list | str] | None:
    """Like _http but returns None on connection errors instead of raising."""
    try:
        return _http(method, url, data=data, headers=headers, timeout=timeout)
    except (urllib.error.URLError, OSError, TimeoutError):
        return None


def _manager_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_get_manager_token()}"}


# -- Agent config loading --------------------------------------------


def _load_agent_config(agent_name: str) -> dict:
    """Load and parse an agent's config.yaml.

    Uses a simple YAML subset parser (no PyYAML dependency).
    """
    config_path = PROJECT_ROOT / "agents" / agent_name / "config.yaml"
    if not config_path.exists():
        _fail(f"Agent config not found: {config_path}")
        sys.exit(1)

    # Simple YAML parser for our config format
    return _parse_simple_yaml(config_path.read_text())


def _parse_simple_yaml(text: str) -> dict:
    """Parse a simple YAML document (enough for our agent configs).

    Handles: mappings, lists (- items), multiline strings (|), quoted strings.
    NOT a full YAML parser — just enough for agent config files.
    """
    import re

    lines = text.split("\n")
    result: dict = {}
    stack: list[tuple[int, dict]] = [(-1, result)]
    current_key: str | None = None
    multiline_indent: int | None = None
    multiline_lines: list[str] = []

    for line in lines:
        stripped = line.rstrip()

        # Handle multiline string continuation
        if multiline_indent is not None:
            line_indent = len(line) - len(line.lstrip()) if line.strip() else multiline_indent + 2
            if line.strip() == "" or line_indent >= multiline_indent:
                multiline_lines.append(line[multiline_indent:] if len(line) > multiline_indent else "")
                continue
            else:
                # End of multiline block
                _dict_set(stack, current_key, "\n".join(multiline_lines).rstrip() + "\n")
                multiline_indent = None
                multiline_lines = []

        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip())

        # Pop stack to find parent
        while len(stack) > 1 and stack[-1][0] >= indent:
            stack.pop()

        # List item
        list_match = re.match(r"^(\s*)- (.+)$", line)
        if list_match:
            item_indent = len(list_match.group(1))
            value = list_match.group(2).strip().strip('"').strip("'")
            # Find the parent dict that contains current_key.
            # If an empty dict was speculatively created for a "key:" line,
            # we need to look one level up and replace that dict with a list.
            target_parent = None
            for _, d in reversed(stack):
                if current_key and current_key in d:
                    target_parent = d
                    break
            if target_parent is None:
                target_parent = stack[-1][1]

            if current_key and current_key in target_parent:
                if isinstance(target_parent[current_key], list):
                    target_parent[current_key].append(_coerce(value))
                elif isinstance(target_parent[current_key], dict) and not target_parent[current_key]:
                    # Replace speculatively-created empty dict with list
                    # Also pop it from the stack since it's no longer a mapping
                    if len(stack) > 1 and stack[-1][1] is target_parent[current_key]:
                        stack.pop()
                    target_parent[current_key] = [_coerce(value)]
                else:
                    target_parent[current_key] = [_coerce(value)]
            elif current_key:
                target_parent[current_key] = [_coerce(value)]
            continue

        # Key: value pair
        kv_match = re.match(r"^(\s*)(\S+)\s*:\s*(.*)$", line)
        if kv_match:
            key = kv_match.group(2)
            value_str = kv_match.group(3).strip()

            if value_str == "|":
                # Multiline string
                current_key = key
                multiline_indent = indent + 2
                multiline_lines = []
                parent = stack[-1][1]
                parent[key] = ""
                continue
            elif value_str == "" or value_str == "":
                # Nested mapping (may turn out to be a list — see list handler)
                new_dict: dict = {}
                parent = stack[-1][1]
                parent[key] = new_dict
                stack.append((indent, new_dict))
                current_key = key
                continue
            else:
                # Simple value
                value_str = value_str.strip('"').strip("'")
                parent = stack[-1][1]
                parent[key] = _coerce(value_str)
                current_key = key

    # Handle trailing multiline
    if multiline_indent is not None and current_key:
        _dict_set(stack, current_key, "\n".join(multiline_lines).rstrip() + "\n")

    return result


def _dict_set(stack: list, key: str | None, value: object) -> None:
    if key and len(stack) > 0:
        stack[-1][1][key] = value


def _coerce(value: str) -> str | int | float | bool:
    """Coerce string to appropriate Python type."""
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


# -- Commands --------------------------------------------------------


def cmd_up(args: argparse.Namespace) -> None:
    """Start core services via docker compose."""
    _header("Starting KubexClaw core services...")
    services_str = " ".join(CORE_SERVICES)
    cmd = f"docker compose up -d {services_str}"
    _info(f"Running: {cmd}")
    result = subprocess.run(
        cmd, shell=True, cwd=str(PROJECT_ROOT), capture_output=False,
    )
    if result.returncode == 0:
        _ok("Core services started")
        print(f"\n  {DIM}Tip: run 'python scripts/kclaw.py status' to check health{RESET}")
    else:
        _fail(f"docker compose up failed (exit code {result.returncode})")
        sys.exit(1)


def cmd_down(args: argparse.Namespace) -> None:
    """Stop all services via docker compose."""
    _header("Stopping KubexClaw services...")
    result = subprocess.run(
        "docker compose down", shell=True, cwd=str(PROJECT_ROOT), capture_output=False,
    )
    if result.returncode == 0:
        _ok("All services stopped")
    else:
        _fail(f"docker compose down failed (exit code {result.returncode})")
        sys.exit(1)


def cmd_agents(args: argparse.Namespace) -> None:
    """List all registered agents."""
    _header("Registered Agents")
    resp = _http_safe("GET", f"{REGISTRY_URL}/agents")
    if resp is None:
        _fail("Cannot reach Registry at " + REGISTRY_URL)
        sys.exit(1)

    status_code, body = resp
    if status_code != 200:
        _fail(f"Registry returned {status_code}: {body}")
        sys.exit(1)

    if not body:
        _warn("No agents registered")
        print(f"\n  {DIM}Tip: run 'python scripts/kclaw.py spawn <agent>' to register one{RESET}")
        return

    # Table header
    print(f"\n  {'ID':<25} {'Status':<12} {'Capabilities':<40} {'Boundary'}")
    print(f"  {'-'*25} {'-'*12} {'-'*40} {'-'*10}")
    for agent in body:
        agent_id = agent.get("agent_id", "?")
        status = agent.get("status", "?")
        caps = ", ".join(agent.get("capabilities", []))
        boundary = agent.get("boundary", "?")
        color = GREEN if status == "running" else (YELLOW if status == "busy" else DIM)
        print(f"  {agent_id:<25} {color}{status:<12}{RESET} {caps:<40} {boundary}")


def cmd_spawn(args: argparse.Namespace) -> None:
    """Register agent + create kubex + start it."""
    agent_name = args.agent
    _header(f"Spawning agent: {agent_name}")

    # 1. Load config
    _info(f"Loading config from agents/{agent_name}/config.yaml")
    config = _load_agent_config(agent_name)
    agent_cfg = config.get("agent", {})
    agent_id = agent_cfg.get("id", agent_name)
    capabilities = agent_cfg.get("capabilities", [])
    boundary = agent_cfg.get("boundary", "default")

    if isinstance(capabilities, str):
        capabilities = [capabilities]

    # 2. Register in Registry
    _info(f"Registering agent '{agent_id}' with capabilities: {capabilities}")
    reg_body = {
        "agent_id": agent_id,
        "capabilities": capabilities,
        "status": "running",
        "boundary": boundary,
    }
    resp = _http_safe("POST", f"{REGISTRY_URL}/agents", data=reg_body)
    if resp is None:
        _fail("Cannot reach Registry at " + REGISTRY_URL)
        sys.exit(1)

    status_code, body = resp
    if status_code in (200, 201):
        _ok(f"Agent registered in Registry")
    elif status_code == 422:
        _warn(f"Agent may already be registered (422). Continuing...")
    else:
        _fail(f"Registry returned {status_code}: {body}")
        sys.exit(1)

    # 3. Create Kubex via Manager
    _info("Creating Kubex container via Manager...")
    kubex_body = {
        "config": config,
        "image": f"kubexclaw-{agent_name}:latest",
    }
    resp = _http_safe("POST", f"{MANAGER_URL}/kubexes", data=kubex_body, headers=_manager_headers())
    if resp is None:
        _fail("Cannot reach Kubex Manager at " + MANAGER_URL)
        sys.exit(1)

    status_code, body = resp
    if status_code not in (200, 201):
        _fail(f"Manager returned {status_code}: {body}")
        sys.exit(1)

    kubex_id = body.get("kubex_id") if isinstance(body, dict) else None
    _ok(f"Kubex created: {kubex_id}")

    # 4. Start the Kubex
    if kubex_id:
        _info("Starting Kubex...")
        resp = _http_safe("POST", f"{MANAGER_URL}/kubexes/{kubex_id}/start", headers=_manager_headers())
        if resp is None:
            _fail("Cannot reach Kubex Manager for start")
            sys.exit(1)

        status_code, body = resp
        if status_code == 200:
            _ok(f"Kubex started")
        else:
            _warn(f"Start returned {status_code}: {body}")

    print(f"\n  {GREEN}{BOLD}Agent '{agent_id}' is ready{RESET}")
    print(f"  {DIM}Kubex ID: {kubex_id}{RESET}")


def cmd_kill(args: argparse.Namespace) -> None:
    """Stop a kubex and deregister the agent."""
    agent_name = args.agent
    _header(f"Killing agent: {agent_name}")

    # Load config to get agent_id
    config = _load_agent_config(agent_name)
    agent_cfg = config.get("agent", {})
    agent_id = agent_cfg.get("id", agent_name)

    # Find the kubex for this agent
    _info("Looking up Kubex for agent...")
    resp = _http_safe("GET", f"{MANAGER_URL}/kubexes", headers=_manager_headers())
    kubex_id = None
    if resp:
        status_code, body = resp
        if status_code == 200 and isinstance(body, list):
            for k in body:
                if k.get("agent_id") == agent_id:
                    kubex_id = k.get("kubex_id")
                    break

    # Stop/kill the kubex if found
    if kubex_id:
        _info(f"Stopping Kubex {kubex_id}...")
        resp = _http_safe("POST", f"{MANAGER_URL}/kubexes/{kubex_id}/kill", headers=_manager_headers())
        if resp:
            status_code, body = resp
            if status_code == 200:
                _ok("Kubex stopped")
            else:
                _warn(f"Kill returned {status_code}: {body}")

        # Remove kubex record
        _http_safe("DELETE", f"{MANAGER_URL}/kubexes/{kubex_id}", headers=_manager_headers())
    else:
        _warn("No Kubex found for this agent (may not be running via Manager)")

    # Deregister from Registry
    _info(f"Deregistering agent '{agent_id}' from Registry...")
    resp = _http_safe("DELETE", f"{REGISTRY_URL}/agents/{agent_id}")
    if resp:
        status_code, body = resp
        if status_code == 204:
            _ok("Agent deregistered")
        elif status_code == 404:
            _warn("Agent was not registered")
        else:
            _warn(f"Deregister returned {status_code}: {body}")
    else:
        _warn("Cannot reach Registry")

    print(f"\n  {DIM}Agent '{agent_id}' has been stopped and deregistered{RESET}")


def cmd_ask(args: argparse.Namespace) -> None:
    """Dispatch a task by capability and wait for the result."""
    capability = args.capability
    message = args.message
    _header(f"Dispatching task: {capability}")
    print(f"  {DIM}Message: {message}{RESET}")

    # Dispatch via Gateway /actions endpoint
    action_body = {
        "request_id": str(uuid.uuid4()),
        "agent_id": "cli-user",
        "action": "dispatch_task",
        "parameters": {
            "capability": capability,
            "context_message": message,
        },
        "context": {
            "task_id": None,
            "workflow_id": f"cli-{int(time.time())}",
        },
        "priority": "normal",
    }

    resp = _http_safe("POST", f"{GATEWAY_URL}/actions", data=action_body, timeout=15.0)
    if resp is None:
        _fail("Cannot reach Gateway at " + GATEWAY_URL)
        sys.exit(1)

    status_code, body = resp
    if status_code not in (200, 201, 202):
        _fail(f"Gateway returned {status_code}: {body}")
        sys.exit(1)

    task_id = body.get("task_id") if isinstance(body, dict) else None
    if not task_id:
        _fail(f"No task_id in response: {body}")
        sys.exit(1)

    _ok(f"Task dispatched: {task_id}")

    # Poll for result
    _info("Waiting for result...")
    start = time.time()
    spinner = ["|", "/", "-", "\\"]
    tick = 0

    while time.time() - start < POLL_TIMEOUT:
        # Poll Gateway (proxies to Broker internally)
        resp = _http_safe("GET", f"{GATEWAY_URL}/tasks/{task_id}/result")
        if resp:
            sc, result_body = resp
            if sc == 200:
                print(f"\r  {GREEN}[OK]{RESET} Result received!          ")
                print()
                if isinstance(result_body, dict):
                    print(json.dumps(result_body, indent=2))
                else:
                    print(result_body)
                return

        elapsed = int(time.time() - start)
        s = spinner[tick % len(spinner)]
        print(f"\r  {CYAN}[{s}]{RESET} Waiting for result... ({elapsed}s)", end="", flush=True)
        tick += 1
        time.sleep(POLL_INTERVAL)

    print(f"\r  {YELLOW}[!!]{RESET} Timed out after {POLL_TIMEOUT}s          ")
    print(f"\n  {DIM}Task ID: {task_id}")
    print(f"  Check later with: python scripts/kclaw.py result {task_id}{RESET}")


def cmd_status(args: argparse.Namespace) -> None:
    """Show health status for all services and running kubexes."""
    _header("Service Health")

    services = [
        ("Gateway", GATEWAY_URL),
        ("Registry", REGISTRY_URL),
        ("Kubex Manager", MANAGER_URL),
    ]

    for name, url in services:
        resp = _http_safe("GET", f"{url}/health", timeout=3.0)
        if resp:
            sc, body = resp
            if sc == 200:
                _ok(f"{name:<20} {url}")
            else:
                _warn(f"{name:<20} {url} (HTTP {sc})")
        else:
            _fail(f"{name:<20} {url} (unreachable)")

    # Broker is internal-only (no host port), check via docker exec
    broker_result = subprocess.run(
        'docker exec kubexclaw-broker curl -sf http://localhost:8060/health',
        shell=True, capture_output=True, text=True,
    )
    if broker_result.returncode == 0:
        _ok(f"{'Broker':<20} internal (healthy)")
    else:
        _fail(f"{'Broker':<20} internal (unreachable)")

    # Check Redis
    env = _load_env()
    redis_pw = env.get("REDIS_PASSWORD", "changeme-redis-password")
    redis_result = subprocess.run(
        f'docker exec kubexclaw-redis redis-cli -a "{redis_pw}" ping',
        shell=True, capture_output=True, text=True,
    )
    if redis_result.returncode == 0 and "PONG" in redis_result.stdout:
        _ok(f"{'Redis':<20} localhost:6379")
    else:
        _fail(f"{'Redis':<20} localhost:6379 (not responding)")

    # Show running kubexes
    _header("Running Kubexes")
    resp = _http_safe("GET", f"{MANAGER_URL}/kubexes", headers=_manager_headers())
    if resp:
        sc, body = resp
        if sc == 200 and isinstance(body, list) and body:
            print(f"\n  {'Kubex ID':<30} {'Agent':<20} {'Status':<12} {'Image'}")
            print(f"  {'-'*30} {'-'*20} {'-'*12} {'-'*25}")
            for k in body:
                kid = k.get("kubex_id", "?")
                aid = k.get("agent_id", "?")
                st = k.get("status", "?")
                img = k.get("image", "?")
                color = GREEN if st in ("running", "created") else DIM
                print(f"  {kid:<30} {aid:<20} {color}{st:<12}{RESET} {img}")
        elif sc == 200:
            _warn("No kubexes running")
        else:
            _warn(f"Manager returned {sc}")
    else:
        _warn("Cannot reach Kubex Manager")


def cmd_result(args: argparse.Namespace) -> None:
    """Fetch a task result by ID."""
    task_id = args.task_id
    _header(f"Fetching result: {task_id}")

    # Fetch via Gateway (proxies to Broker internally)
    resp = _http_safe("GET", f"{GATEWAY_URL}/tasks/{task_id}/result")
    if resp:
        sc, body = resp
        if sc == 200:
            _ok("Result found")
            print()
            if isinstance(body, dict):
                print(json.dumps(body, indent=2))
            else:
                print(body)
            return
        elif sc == 404:
            _warn("No result found for this task ID")
            print(f"\n  {DIM}The task may still be running or the ID may be incorrect.{RESET}")
            return
        else:
            _warn(f"Gateway returned {sc}: {body}")

    _fail("Cannot reach Gateway to fetch result")
    sys.exit(1)


def cmd_logs(args: argparse.Namespace) -> None:
    """Tail logs for an agent's container."""
    agent_name = args.agent
    config = _load_agent_config(agent_name)
    agent_cfg = config.get("agent", {})
    agent_id = agent_cfg.get("id", agent_name)

    # Try standard container name pattern
    container_names = [
        f"kubexclaw-{agent_id}",
        f"kubex-{agent_id}",
        agent_id,
    ]

    _header(f"Logs for agent: {agent_id}")

    for cname in container_names:
        result = subprocess.run(
            f"docker logs --tail 50 -f {cname}",
            shell=True,
            cwd=str(PROJECT_ROOT),
        )
        if result.returncode == 0:
            return

    # If none of the standard names worked, try finding by label
    _info(f"Trying to find container by label kubex.agent_id={agent_id}...")
    result = subprocess.run(
        f'docker ps --filter "label=kubex.agent_id={agent_id}" --format "{{{{.Names}}}}"',
        shell=True, capture_output=True, text=True,
    )
    if result.stdout.strip():
        cname = result.stdout.strip().split("\n")[0]
        _info(f"Found container: {cname}")
        subprocess.run(f"docker logs --tail 50 -f {cname}", shell=True)
    else:
        _fail(f"No container found for agent '{agent_id}'")
        sys.exit(1)


# -- Main ------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="kclaw",
        description="KubexClaw CLI — manage services, agents, and tasks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  kclaw up                                  Start core services
  kclaw spawn instagram-scraper             Register + start the Instagram scraper
  kclaw ask scrape_instagram "Get @openai"  Dispatch a scraping task
  kclaw status                              Check health of all services
  kclaw kill instagram-scraper              Stop + deregister the agent
  kclaw down                                Stop everything
""",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # up
    subparsers.add_parser("up", help="Start core services (docker compose up)")

    # down
    subparsers.add_parser("down", help="Stop all services (docker compose down)")

    # agents
    subparsers.add_parser("agents", help="List all registered agents")

    # spawn
    sp_spawn = subparsers.add_parser("spawn", help="Register + create + start an agent")
    sp_spawn.add_argument("agent", help="Agent name (directory under agents/)")

    # kill
    sp_kill = subparsers.add_parser("kill", help="Stop kubex + deregister agent")
    sp_kill.add_argument("agent", help="Agent name (directory under agents/)")

    # ask
    sp_ask = subparsers.add_parser("ask", help="Dispatch a task and wait for result")
    sp_ask.add_argument("capability", help="Capability to invoke (e.g. scrape_instagram)")
    sp_ask.add_argument("message", help="Task message/instructions")

    # status
    subparsers.add_parser("status", help="Health check all services + running kubexes")

    # result
    sp_result = subparsers.add_parser("result", help="Fetch a task result")
    sp_result.add_argument("task_id", help="Task ID to look up")

    # logs
    sp_logs = subparsers.add_parser("logs", help="Tail logs for an agent container")
    sp_logs.add_argument("agent", help="Agent name (directory under agents/)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "up": cmd_up,
        "down": cmd_down,
        "agents": cmd_agents,
        "spawn": cmd_spawn,
        "kill": cmd_kill,
        "ask": cmd_ask,
        "status": cmd_status,
        "result": cmd_result,
        "logs": cmd_logs,
    }

    cmd_func = commands.get(args.command)
    if cmd_func:
        cmd_func(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
