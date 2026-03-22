---
phase: 09-cli-runtime-claude-code
plan: "01"
subsystem: infrastructure
tags: [tini, docker, cli-runtime, credentials, gitignore, entrypoint]
dependency_graph:
  requires: [09-00]
  provides: [CLI-04, CLI-05, CLI-06]
  affects: [agents/_base/Dockerfile, agents/_base/entrypoint.sh, services/kubex-manager/kubex_manager/lifecycle.py, docker-compose.yml, .gitignore]
tech_stack:
  added: [tini]
  patterns: [named-docker-volumes, cli-credential-persistence, pid1-signal-forwarding, skill-to-CLAUDE.md-injection]
key_files:
  created: []
  modified:
    - agents/_base/Dockerfile
    - agents/_base/entrypoint.sh
    - services/kubex-manager/kubex_manager/lifecycle.py
    - docker-compose.yml
    - .gitignore
decisions:
  - tini installed via apt-get, not downloaded binary — simpler, no curl dependency for install
  - runtime variable read from agent_cfg (not config root) — consistent with AgentConfig model
  - CLI_CREDENTIAL_MOUNTS.get(runtime) guard — safe for future unknown runtimes without explicit error
  - CLAUDE.md placed at /app/CLAUDE.md — Claude Code reads project CLAUDE.md at working directory root
metrics:
  duration: "135s"
  completed: "2026-03-22"
  tasks_completed: 2
  files_modified: 5
  commits: 2
---

# Phase 09 Plan 01: CLI Runtime Infrastructure Foundation Summary

Infrastructure foundation for CLI runtime support: tini as PID 1 for correct signal forwarding, named Docker volumes for OAuth credential persistence per agent, credential path gitignore rules, and CLAUDE.md skill injection in entrypoint.sh for CLI runtimes.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Dockerfile tini + entrypoint.sh CLAUDE.md generation | 0491fee |
| 2 | Named volumes in lifecycle.py + docker-compose.yml + credential .gitignore | 2f397a7 |

## What Was Built

### Task 1 — Dockerfile + entrypoint.sh

**Dockerfile changes:**
- Added `tini` to the `apt-get install` line
- Changed `ENTRYPOINT` from `["/app/entrypoint.sh"]` to `["/usr/bin/tini", "--", "/app/entrypoint.sh"]` — tini is now PID 1, correctly forwarding SIGTERM to the Python harness
- Added `LABEL kubex.stop_grace_period="30s"` for operator reference

**entrypoint.sh changes:**
- Added Step 4b between skill loading and CMD invocation
- Reads `runtime:` field from `/app/config.yaml` using `grep`+`sed` (no jq/yq dependency)
- When `runtime != "openai-api"` and `/app/skills` exists, generates `/app/CLAUDE.md` by concatenating all `SKILL.md` files from each skill subdirectory
- CLI agents (claude-code, codex-cli, gemini-cli) automatically get skill context in the format Claude Code reads as project instructions
- `exec "$@"` remains the final command — unchanged

### Task 2 — lifecycle.py + docker-compose.yml + .gitignore

**lifecycle.py changes:**
- Added `CLI_CREDENTIAL_MOUNTS: dict[str, str]` constant mapping `claude-code → /root/.claude`, `codex-cli → /root/.codex`, `gemini-cli → /root/.config/gemini`
- Added CLI pip deps injection: when `runtime != "openai-api"`, `KUBEX_PIP_DEPS` gets `pexpect watchfiles` appended (boot-time trusted install, no policy gate)
- Added named Docker volume logic: `CLI_CREDENTIAL_MOUNTS.get(runtime)` returns the credential path (or None for unknown runtimes), creates `kubex-creds-{agent_id}` volume mounted read-write — Docker SDK auto-creates the volume on first use

**docker-compose.yml changes:**
- Added operator comment in `volumes:` section documenting that `kubex-creds-{agent_id}` volumes are created dynamically by lifecycle.py, with `docker volume ls` and `docker volume rm` commands for management

**.gitignore changes:**
- Added `.credentials.json`, `**/.*credentials*`, `.claude/`, `.codex/`, `.config/gemini/` to prevent OAuth credentials from ever being committed

## Deviations from Plan

None — plan executed exactly as written.

## Test Results

```
59 passed in 0.71s
```

All 59 existing `tests/unit/test_kubex_manager_unit.py` tests pass. No regressions introduced.

## Self-Check

**Files exist:**
- `agents/_base/Dockerfile` — FOUND
- `agents/_base/entrypoint.sh` — FOUND
- `services/kubex-manager/kubex_manager/lifecycle.py` — FOUND
- `docker-compose.yml` — FOUND
- `.gitignore` — FOUND

**Commits exist:**
- `0491fee` — feat(09-01): tini as PID 1 + CLAUDE.md skill injection for CLI runtimes
- `2f397a7` — feat(09-01): named volumes + gitignore for CLI runtime credential persistence

## Self-Check: PASSED
