# Milestones

## v1.1 Stem Cell Kubex (Shipped: 2026-03-21)

**Phases completed:** 3 phases, 10 plans, 13 tasks

**Key accomplishments:**

- 46 failing (skip/xfail) tests defining the full Phase 5 contract: SkillValidator injection detection with stamps, SkillResolver manifest schema and composition, ConfigLoader YAML/env fallback, skill bind mounts, and Docker E2E for base image build and dep install
- SkillManifest rewritten with extra=forbid, SkillValidator regex+LM injection defense with stamps, SkillResolver composition with tool namespacing, config_loader YAML/env fallback, and Docker skill bind mounts via create_kubex() SKIL-02
- 392 unit tests passing, ruff/black clean on all Phase 5 changed files, skill validator CLI exits 0, stale xfail removed from SKIL-02 test — Phase 5 gate check complete
- `skill_mounts` exposed via POST /kubexes body and SkillValidator wired into create_kubex() — malicious skills rejected at spawn with 422, clean skills mount read-only at /app/skills/{name}
- One-liner:
- 1. [Rule 1 - Bug] Skill resolution crashing when skills dirs absent
- 856 tests passing (0 failures), ruff + black clean on all Phase 6 files after fixing 47 ruff errors (30 auto-fixed, 17 manually fixed) including UP042 StrEnum migration, F841 unused vars, SIM102 nested ifs, N806 naming, E501 long lines.
- 1. [Rule 1 - Bug] Initial E2E tests XPASS because harness already handles all config formats
- One-liner:
- Full test suite migrated to Phase 7 harness — 779 tests passing, conftest fixture pattern, ruff/black clean on all Phase 7 files

---
