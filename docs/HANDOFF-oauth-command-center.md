# OAuth Credential Provisioning — Frontend Handoff

**From:** Backend (Phase 9: CLI Runtime)
**To:** Command Center frontend agent
**Date:** 2026-03-23

## What's Built

Phase 9 built the full backend lifecycle for CLI-based agents (Claude Code first). The container handles everything — credential detection, state machine, file watching, graceful shutdown. **The frontend just needs to get the OAuth token into the right place.**

## The Flow You're Building

```mermaid
sequenceDiagram
    participant CC as Command Center
    participant GW as Gateway
    participant Redis
    participant Container as Kubex Container

    Container->>Redis: publish lifecycle:agent_id {state: "credential_wait"}
    Redis-->>CC: SSE subscription detects CREDENTIAL_WAIT
    CC->>CC: Show "Agent needs auth" button to user
    CC->>CC: User clicks → open Anthropic OAuth URL
    CC->>CC: User authorizes → receives token
    CC->>GW: POST /kubexes/{id}/credentials {token}
    GW->>Container: Write token to named volume
    Container->>Container: watchfiles detects .credentials.json
    Container->>Redis: publish lifecycle:agent_id {state: "ready"}
    Redis-->>CC: SSE detects READY
    CC->>CC: Show "Agent ready" status
```

## Backend Endpoints & Channels (Already Working)

### 1. Lifecycle State — Redis Pub/Sub

**Channel:** `lifecycle:{agent_id}` (e.g., `lifecycle:claude-test`)
**Redis DB:** 0

**Payload when agent needs auth:**
```json
{
  "agent_id": "claude-test",
  "state": "credential_wait",
  "timestamp": "2026-03-22T15:30:45.123456"
}
```

**States:** `booting` → `credential_wait` → `ready` → `busy`

Subscribe to this channel to know when an agent needs credentials and when it transitions to ready.

### 2. SSE Progress Stream

**Endpoint:** `GET /tasks/{task_id}/stream` on Gateway (port 8080)
**Format:** Server-Sent Events

```
data: {"type":"progress","task_id":"...","content":"...","sequence":1}
```

The Gateway subscribes to `progress:{task_id}` on Redis and relays via SSE. Already works for task output streaming.

### 3. HITL Action (Currently 422 — See Gap Below)

**What the container sends:**
```json
POST http://gateway:8080/actions
{
  "action": "request_user_input",
  "agent_id": "claude-test",
  "payload": {
    "message": "Agent 'claude-test' needs CLI authentication. Please run: docker exec -it <container> claude auth login"
  }
}
```

The existing `/actions` endpoint expects the full orchestrator format (`request_id`, `parameters`, `context`). The CLI runtime sends a simpler payload → **422**. See gap below.

### 4. Manager API

**Base URL:** `http://kubex-manager:8090` (port 8090 on host)
**Auth:** `Authorization: Bearer kbx-mgmt-b4d8e5f2a1c7` (from `KUBEX_MGMT_TOKEN`)

**Existing endpoints:**
| Method | Path | What it does |
|--------|------|--------------|
| POST | /kubexes | Create agent container |
| GET | /kubexes | List all agents |
| GET | /kubexes/{id} | Get agent details |
| POST | /kubexes/{id}/start | Start container |
| POST | /kubexes/{id}/stop | Stop container |
| POST | /kubexes/{id}/restart | Restart container |
| POST | /kubexes/{id}/respawn | Kill + recreate |
| DELETE | /kubexes/{id} | Remove container |

### 5. Credential File Details

**Container path:** `/root/.claude/.credentials.json`
**Named volume:** `kubex-creds-{agent_id}` mounted at `/root/.claude`

**Detection logic:** File must exist AND be non-empty (size > 0). No content validation — just presence check.

**Volume mount mapping per runtime:**
```
claude-code  → /root/.claude
codex-cli    → /root/.codex
gemini-cli   → /root/.config/gemini
```

## The Gap — What Needs Building

### Backend: Credential injection endpoint

**No Manager endpoint exists to write files into a container's volume.** You need one of:

**Option A (Recommended):** New Manager endpoint
```
POST /kubexes/{kubex_id}/credentials
Content-Type: application/json
Authorization: Bearer {KUBEX_MGMT_TOKEN}

{
  "runtime": "claude-code",
  "credential_data": { ... token from OAuth ... }
}
```

Manager writes the JSON to the named volume via Docker API:
```python
# Docker SDK can exec into container to write the file
container.exec_run(f"sh -c 'cat > /root/.claude/.credentials.json'", stdin=True)
```

Or use `docker cp` equivalent via the SDK.

**Option B:** Gateway relay
```
POST /agents/{agent_id}/oauth/token
```
Gateway forwards to Manager, Manager writes to volume.

### Backend: Fix HITL action format for CLI agents

The Gateway `/actions` endpoint rejects the simplified payload from CLI agents (422). Either:
- Update Gateway to accept the simpler format
- Or update CLIRuntime to send the full format with `request_id`, `parameters`, `context`

This is minor — the credential watcher works regardless of whether the HITL message reaches Command Center. But for the UI to show "Agent needs auth", it needs either:
- The HITL action to go through, OR
- Command Center subscribes directly to `lifecycle:{agent_id}` Redis channel and watches for `credential_wait` state (simpler, recommended)

## Recommended Frontend Approach

1. **Subscribe to `lifecycle:*`** Redis channels (or add a Gateway SSE endpoint for lifecycle events)
2. **When `credential_wait` detected:** Show auth button for that agent
3. **On click:** Open Anthropic OAuth URL (`https://claude.ai/oauth/authorize?...`)
4. **On callback:** POST token to the new Manager credential endpoint
5. **Watch for `ready` state** on the same lifecycle channel → update UI

## Files to Read

| File | What it tells you |
|------|-------------------|
| `agents/_base/kubex_harness/cli_runtime.py` | Full credential flow, state machine, watcher |
| `services/kubex-manager/kubex_manager/lifecycle.py` | Volume creation, `CLI_CREDENTIAL_MOUNTS` |
| `services/gateway/gateway/main.py` | SSE endpoint, action handling |
| `libs/kubex-common/kubex_common/schemas/events.py` | LifecycleEvent schema |
| `docs/design-oauth-runtime.md` | Full OAuth architecture design doc |

## Test It Yourself

```bash
# 1. Spawn a claude-code agent (manual — Manager API has a config path bug on Windows)
docker create --name test-agent \
  -e KUBEX_AGENT_ID=test-agent \
  -e GATEWAY_URL=http://gateway:8080 \
  -e BROKER_URL=http://kubex-broker:8060 \
  -e "REDIS_URL=redis://default:kbx-r3d1s-f7a2c9e1@redis:6379/0" \
  -e "KUBEX_PIP_DEPS=pexpect watchfiles" \
  -v "path/to/config.yaml:/app/config.yaml:ro" \
  -v kubex-creds-test-agent:/root/.claude:rw \
  --network openclaw_kubex-internal \
  kubexclaw-base:latest

# 2. Start it — watch logs for "credential_wait"
docker start test-agent && docker logs -f test-agent

# 3. Write a credential file → watcher transitions to READY
docker cp ~/.claude/.credentials.json test-agent:/root/.claude/.credentials.json

# 4. Check logs — should see "Credentials appeared"
```
