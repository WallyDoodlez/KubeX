---
status: diagnosed
trigger: "The knowledge kubex container is having trouble booting up"
created: 2026-03-08T00:00:00Z
updated: 2026-03-08T00:00:01Z
---

## Current Focus

hypothesis: CONFIRMED - Image kubexclaw-knowledge:latest does not exist; Dockerfile FROM references wrong base tag
test: Ran `python scripts/kclaw.py spawn knowledge` and `docker build`
expecting: Error confirming missing image
next_action: Report findings

## Symptoms

expected: Knowledge kubex container boots and runs successfully
actual: Container creation fails with 503 "No such image: kubexclaw-knowledge:latest"
errors: 503 DockerUnavailable - "No such image: kubexclaw-knowledge:latest"
reproduction: `python scripts/kclaw.py spawn knowledge`
started: Image was never built

## Eliminated

- hypothesis: Container boots but crashes at runtime
  evidence: Container never gets created; Docker returns 404 for missing image
  timestamp: 2026-03-08

- hypothesis: Knowledge agent config is malformed
  evidence: Config loads and parses (though capabilities parsing has a secondary bug)
  timestamp: 2026-03-08

## Evidence

- timestamp: 2026-03-08
  checked: docker ps -a
  found: No knowledge container exists. Only instagram-scraper kubexes (running on kubexclaw-base:latest directly)
  implication: Knowledge container was never successfully created

- timestamp: 2026-03-08
  checked: docker images | grep base
  found: Base image is tagged kubexclaw-base:latest (not kubex-base:latest)
  implication: Dockerfile FROM clause references wrong tag

- timestamp: 2026-03-08
  checked: docker build -t kubexclaw-knowledge:latest -f agents/knowledge/Dockerfile .
  found: Build fails with "pull access denied, repository does not exist" for kubex-base:latest
  implication: Cannot build knowledge image because FROM kubex-base:latest doesn't match local tag kubexclaw-base:latest

- timestamp: 2026-03-08
  checked: python scripts/kclaw.py spawn knowledge
  found: Manager returns 503 "No such image: kubexclaw-knowledge:latest"
  implication: kclaw spawn requests kubexclaw-knowledge:latest but that image was never built

- timestamp: 2026-03-08
  checked: All agent Dockerfiles FROM lines
  found: instagram-scraper, knowledge, reviewer all use FROM kubex-base:latest
  implication: All agent-specific images have the same build problem; instagram-scraper works only because it was spawned with kubexclaw-base:latest directly

- timestamp: 2026-03-08
  checked: kclaw.py _parse_simple_yaml for capabilities
  found: capabilities parses as nested dict {'capabilities': ['knowledge_management', ...]} instead of flat list
  implication: Secondary bug - YAML parser doesn't handle nested list keys properly; Registry registration sends wrong format

## Resolution

root_cause: Two issues preventing knowledge kubex boot:
  1. PRIMARY - Image does not exist. `kclaw.py spawn` requests image `kubexclaw-knowledge:latest` but this image was never built. Building it fails because the Dockerfile at `agents/knowledge/Dockerfile` uses `FROM kubex-base:latest` while the actual local base image is tagged `kubexclaw-base:latest`.
  2. SECONDARY - The simple YAML parser in `kclaw.py` wraps list values in an extra dict layer, so `capabilities` becomes `{'capabilities': [...]}` instead of `[...]`. This causes the Registry registration to send malformed capability data.

fix:
  1. Change `FROM kubex-base:latest` to `FROM kubexclaw-base:latest` in agents/knowledge/Dockerfile (and instagram-scraper/Dockerfile and reviewer/Dockerfile for consistency)
  2. Then build: `docker build -t kubexclaw-knowledge:latest -f agents/knowledge/Dockerfile .`
  3. Fix the YAML parser in kclaw.py to correctly handle nested list items under mapping keys

verification:
files_changed: []
