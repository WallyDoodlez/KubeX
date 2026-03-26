---
created: 2026-03-26T06:01:53.351Z
title: Design developer onboarding quick-start guide
area: docs
files:
  - docker-compose.yml
  - scripts/kclaw.py
  - .env
---

## Problem

There is no documented path from "I cloned this repo" to "I have agents running and can send them tasks." A new developer would need to reverse-engineer docker-compose.yml, figure out .env setup, understand the service topology, and discover scripts/kclaw.py — all without guidance.

## Solution

Create a `docs/GETTING-STARTED.md` (or a section in README.md) covering the exact steps:

1. **Prerequisites** — Docker, Python 3.12+, Redis (or just Docker Compose)
2. **Clone and configure** — `git clone`, copy `.env.example` → `.env`, set `REDIS_PASSWORD`, `KUBEX_MGMT_TOKEN`, `OPENAI_API_KEY`
3. **Build base image** — `docker compose build kubexclaw-base`
4. **Start the stack** — `docker compose up -d` (what comes up: gateway, broker, registry, manager, redis)
5. **Verify** — `python scripts/kclaw.py status` or curl health endpoints
6. **Send your first task** — curl example dispatching to orchestrator via POST /actions
7. **Open Command Center** — `http://localhost:3001`, what you see, how to use it
8. **Spawn a new agent** — via Manager API or Command Center
9. **Add credentials** — for CLI agents (Claude Code, etc.) via credential panel
10. **Monitor** — `python scripts/trace.py` for live event tracing

Also document common troubleshooting: Redis connection refused, Docker network issues, policy denials.
