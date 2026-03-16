---
created: 2026-03-16T14:39:46.622Z
title: Wire live persistence/memory layer
area: database
files:
  - docker-compose.yml
  - services/gateway/gateway/main.py
---

## Problem

The knowledge base backends (Graphiti+Neo4j, OpenSearch) are currently mocked in tests and not wired to live services. The Neo4j container in docker-compose.yml is unhealthy — it exists but hasn't been configured or validated for the current stack.

Additionally, **Obsidian** should be evaluated as an alternative memory/knowledge backend alongside Graphiti and OpenSearch. The user wants to discuss options before scoping.

Current state:
- `query_knowledge` and `store_knowledge` actions in Gateway proxy to Graphiti/OpenSearch URLs but hit mocked endpoints in tests
- Neo4j container defined in docker-compose.yml but unhealthy on startup
- No live integration tests against real backends
- Graphiti/OpenSearch live wiring listed as "out of scope" for v1.1

## Solution

Scope as a post-v1.1 milestone (v1.2 or later):
1. Fix Neo4j container health (config, memory limits, auth setup)
2. Wire Graphiti to live Neo4j for graph-based knowledge retrieval
3. Wire OpenSearch for full-text corpus search
4. Evaluate Obsidian as alternative/complementary memory layer — discuss architecture implications (file-based vs graph-based vs search-based)
5. Integration tests against real backends
6. User decides which backends to activate per deployment
