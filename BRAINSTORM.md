# BRAINSTORM.md — Archived

> **This file has been archived.** The original 8400-line brainstorm document has been preserved at [`archive/BRAINSTORM-v1.md`](archive/BRAINSTORM-v1.md) for historical reference. All content has been extracted into standalone docs/ files and the authoritative documentation now lives there.

---

## Current Documentation

- **[KubexClaw.md](KubexClaw.md)** — Project index with architecture decisions, status, and links to all docs
- **[MVP.md](MVP.md)** — Implementation-ready MVP outline with docker-compose skeleton and phased checklist
- **[ARCHITECTURE-DIAGRAMS.md](ARCHITECTURE-DIAGRAMS.md)** — Visual reference: 16 Mermaid diagrams
- **[docs/](docs/)** — All architecture and design documentation (see mapping below)

---

## Section-to-Doc Mapping

Every section from the original BRAINSTORM.md has been extracted into the docs/ files listed below. Use this table to find where old section content now lives.

| Original Section | Title | Current Location | Status |
|-----------------|-------|-----------------|--------|
| 0 | Prerequisites | [docs/infrastructure.md](docs/infrastructure.md) | Extracted |
| 1 | Isolation Architecture | [docs/architecture.md](docs/architecture.md) | Extracted |
| 2 | Reviewer Agent / Approval Gateway | [docs/gateway.md](docs/gateway.md) | Extracted |
| 3 | Input/Output Gating | [docs/architecture.md](docs/architecture.md) | Extracted |
| 4 | Infrastructure & Operations | [docs/infrastructure.md](docs/infrastructure.md) | Extracted |
| 5 | Architecture Overview — End-to-End | [docs/architecture.md](docs/architecture.md) | Extracted |
| 6 | Inter-Agent Communication & Service Discovery | [docs/broker.md](docs/broker.md) | Extracted |
| 7 | Admin Layer — Mission Control | [docs/kubex-manager.md](docs/kubex-manager.md), [docs/command-center.md](docs/command-center.md) | Extracted |
| 8 | Secrets Management Strategy | [docs/infrastructure.md](docs/infrastructure.md) | Extracted |
| 9 | Central Logging — OpenSearch | [docs/infrastructure.md](docs/infrastructure.md) | Extracted |
| 10 | KubexClaw Command Center | [docs/command-center.md](docs/command-center.md) | Extracted |
| 11 | Kubex Boundaries — Group Policy & Trust Zones | [docs/boundaries.md](docs/boundaries.md) | Extracted |
| 12 | Repository Structure | [docs/architecture.md](docs/architecture.md) | Extracted |
| 13.1 | MVP Agents | [docs/agents.md](docs/agents.md) | Extracted |
| 13.2–13.3 | Gateway Internals | [docs/gateway.md](docs/gateway.md) | Extracted |
| 13.4 | Model Pricing | [docs/agents.md](docs/agents.md) | Extracted |
| 13.5 | Host Specs & Resource Budget | [docs/infrastructure.md](docs/infrastructure.md) | Extracted |
| 13.6 | OpenClaw Versioning & Security Audit | [docs/agents.md](docs/agents.md) | Extracted |
| 13.7 | Monorepo Layout | [docs/architecture.md](docs/architecture.md) | Extracted |
| 13.8 | MVP Deployment Model | [docs/infrastructure.md](docs/infrastructure.md) | Extracted |
| 13.9 | Unified Gateway Architecture | [docs/gateway.md](docs/gateway.md) | Extracted |
| 14 | ClawControl Evaluation | [docs/gaps.md](docs/gaps.md), [docs/command-center.md](docs/command-center.md) | Extracted |
| 15 | Identified Gaps | [docs/gaps.md](docs/gaps.md) | Extracted |
| 15.11–15.18 | Medium Gaps (ops topics) | [docs/operations.md](docs/operations.md) | Extracted |
| 16 | Canonical Schema & Identity Model | [docs/schemas.md](docs/schemas.md) | Extracted |
| 17 | OpenClaw Security Audit | [docs/agents.md](docs/agents.md) | Extracted |
| 18 | Kubex Broker Technology Decision | [docs/broker.md](docs/broker.md) | Extracted |
| 19 | Kubex Manager REST API | [docs/kubex-manager.md](docs/kubex-manager.md) | Extracted |
| 20 | Output Validation | [docs/gateway.md](docs/gateway.md) | Extracted |
| 21 | Error Handling & Failure Modes | [docs/operations.md](docs/operations.md) | Extracted |
| 22 | CI/CD Pipeline | [docs/operations.md](docs/operations.md) | Extracted |
| 23 | Testing Strategy | [docs/operations.md](docs/operations.md) | Extracted |
| 24 | Data Retention & GDPR Compliance | [docs/operations.md](docs/operations.md) | Extracted |
| 25 | Disaster Recovery | [docs/operations.md](docs/operations.md) | Extracted |
| 26 | Human-to-Swarm Interface | [docs/user-interaction.md](docs/user-interaction.md) | Extracted |
| 27 | Swarm Knowledge Base — Graphiti + OpenSearch | [docs/knowledge-base.md](docs/knowledge-base.md) | Extracted |
| 28 | Gateway Prompt Caching | [docs/prompt-caching.md](docs/prompt-caching.md) | Extracted |
| 29 | Prompt Caching Implementation Strategy | [docs/prompt-caching.md](docs/prompt-caching.md) | Extracted |
| 30 | User Interaction Model | [docs/user-interaction.md](docs/user-interaction.md) | Extracted |
| — | CLI Design | [docs/cli.md](docs/cli.md) | New (no original section) |
| — | Skill Catalog | [docs/skill-catalog.md](docs/skill-catalog.md) | New (no original section) |
| — | Management API Layer | [docs/api-layer.md](docs/api-layer.md) | New (no original section) |
| — | Technology Stack & kubex-common API | [docs/tech-stack.md](docs/tech-stack.md) | New (no original section) |

All 31 original sections (0–30) have been fully extracted. No sections remain unaccounted for.

---

## Action Item Protocol

Per the conversation protocol in [CLAUDE.md](CLAUDE.md), action items are tracked as checkbox task lists. Now that docs/ is the source of truth:

- **New action items** should be recorded in the relevant `docs/` file under its own task list section.
- **Open gaps** are tracked in [docs/gaps.md](docs/gaps.md).
- **MVP implementation tasks** are tracked in [MVP.md](MVP.md).
- This file no longer holds active action items.

---

## Archive

The original BRAINSTORM.md (v1, 8410 lines, 31 sections) is preserved at:

**[`archive/BRAINSTORM-v1.md`](archive/BRAINSTORM-v1.md)**

This archive is read-only reference material. Do not edit it — make all changes in the corresponding `docs/` file instead.
