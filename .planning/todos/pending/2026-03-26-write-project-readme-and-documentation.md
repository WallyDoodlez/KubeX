---
created: 2026-03-26T06:01:53.351Z
title: Write project README and documentation
area: docs
files:
  - KubexClaw.md
  - docs/
---

## Problem

The project has no README.md. KubexClaw.md serves as an internal index but is not newcomer-friendly — it assumes familiarity with the architecture. A person discovering the repo has no way to understand what KubexClaw is, what it does, or how the pieces fit together.

## Solution

Write a proper `README.md` with:
- Elevator pitch (2-3 sentences: what is KubexClaw, who is it for)
- Architecture overview diagram (Mermaid — Gateway, Broker, Registry, Manager, Agents)
- Tech stack summary (Python, FastAPI, Redis Streams, Docker, MCP protocol)
- Repository structure guide (services/, agents/, libs/, skills/, configs/, command-center/)
- Link to detailed docs in docs/ directory
- License and contributing sections

Keep KubexClaw.md as the detailed internal index. README.md is the public face.
