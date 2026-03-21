# KubexClaw Retrospective

## Milestone: v1.1 — Stem Cell Kubex

**Shipped:** 2026-03-21
**Phases:** 3 | **Plans:** 10 | **Commits:** 68

### What Was Built

- Universal `kubexclaw-base` Docker image — all agents run from one image
- Skill system: SkillManifest schema, SkillValidator injection defense, SkillResolver composition
- Manager 8-step atomic spawn pipeline with ConfigBuilder, Redis persistence, network label resolution
- All 4 agents migrated to base image, per-agent Dockerfiles deleted
- Obsidian-style knowledge vault replacing Neo4j/Graphiti/OpenSearch
- Command Center web dashboard (service health, orchestrator chat)
- Hello world E2E tests for all 4 agents
- Full E2E pipeline verified live: Command Center → Gateway → Broker → Agent → GPT-5.2 → Result

### What Worked

- **Red-green-verify pattern**: Writing failing tests first (Phase X-01), implementing (X-02), verifying regressions (X-03) caught real gaps early. Phase 5 gap closure (05-04) found and fixed two unwired integration points.
- **GSD wave-based execution**: Parallel plan execution within phases kept throughput high. 10 plans in ~9 days.
- **Stem cell architecture**: The design held up perfectly through implementation. No architectural pivots needed. Adding the knowledge agent's Obsidian vault was trivial — just a new skill directory + config.yaml.
- **Live boot session**: Actually running the system revealed 12+ integration issues that tests alone would never have caught (CORS, broker URL mismatch, Redis DB partitioning, tool schema validation).

### What Was Inefficient

- **Phase verification reports were stale on some frontmatter**: SUMMARY.md `requirements_completed` fields were empty for 8/10 plans — requirements tracked at phase VERIFICATION level instead. Inconsistent metadata.
- **Nyquist validation never completed**: All 3 phases have draft VALIDATION.md with `nyquist_compliant: false`. The validation strategy files were created but never filled in.
- **Live boot fixes not captured in formal plans**: The 12+ fixes during Docker boot-up (CORS, broker URLs, self-registration, knowledge tools, etc.) were done ad-hoc. They should have been a formal gap closure phase.

### Patterns Established

- `config.yaml` as sole source of truth — no env var overrides for agent identity
- Session-scoped conftest fixture + autouse `_patch_default_config_path` for test isolation
- StrEnum (Python 3.11+) for all enums
- Skills as volume mounts with SkillValidator at spawn boundary
- `_auto_commit_and_push()` pattern for transparent git persistence

### Key Lessons

1. **Run the system live before closing a milestone.** The test suite passed but the system didn't work until 12 integration issues were fixed. Tests alone are not sufficient validation.
2. **Integration issues live in the seams between services.** Every fix during live boot was at a boundary: Gateway↔Redis DB, agent↔broker URL, tool schemas↔OpenAI API, CORS between services.
3. **Agent self-registration needs to be in the harness from day one.** Adding it during live boot was a scramble. It should have been part of Phase 7.

### Cost Observations

- Model mix: ~70% sonnet (subagents), ~30% opus (orchestration + design)
- Sessions: ~15 across the milestone
- Notable: Phase 6 Plan 02 was the longest single execution (180 duration units) — the full Manager implementation

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Tests | Days | Key Pattern |
|-----------|--------|-------|-------|------|-------------|
| v1.0 MVP | 4 | — | 703 | — | Foundation services + agents |
| v1.1 Stem Cell | 3 | 10 | 789 | 9 | Universal image + skill system |
