# Stack Research

**Domain:** Dynamic container specialization — runtime skill injection and policy-gated dependency management for a Python/Docker/Redis agent pipeline
**Researched:** 2026-03-11
**Confidence:** HIGH (core mechanisms verified against official Docker SDK docs and PyPI; version numbers spot-checked)

---

## Context

This is a brownfield refactor. The existing stack (Python 3.12, FastAPI, Redis, docker-py, pydantic, httpx) is **not changing**. This document covers only the incremental stack additions needed for v1.1: making Kubex Manager inject skill files and configs into containers at spawn time, and letting agents request runtime dependencies through the policy pipeline.

---

## What Already Exists (Do Not Revisit)

| Technology | Version in Use | Role |
|------------|----------------|------|
| `docker` (docker-py) | `>=7.0` | Container lifecycle — already in `lifecycle.py` |
| `pydantic` | `>=2.0` | Data validation — in `kubex-common` |
| `pyyaml` | `>=6.0` | YAML config loading — in `kubex-common` |
| `httpx` | `>=0.27` | Async HTTP client — harness and services |
| `redis` | `>=5.0` | Task queue and lifecycle events |
| `fastapi` / `uvicorn` | `>=0.115` / `>=0.32` | Service HTTP layer |
| `python:3.12-slim` | latest 3.12.x | Base Docker image |

---

## Recommended Stack (New Additions Only)

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `docker` (docker-py) | `7.1.0` (already present, pin) | `container.put_archive()` for file injection and `containers.create(volumes=...)` for bind mounts | Already in use. `put_archive()` is the only SDK-native way to copy files into a created-but-not-yet-started container without rebuild; bind mounts are the right mechanism for persistent skill directories. Pin to 7.1.0 — the 7.x line includes Python 3.12 compatibility fixes that 6.x lacks. |
| `pydantic` | `2.12.5` (already present, upgrade if needed) | Schema validation for spawn configs — `AgentSpawnConfig`, `SkillManifest`, `RuntimeDepRequest` | Already in use. v2 model validation is the right fit: field types, required vs optional, list validators. Avoids writing manual validation logic for config dicts that currently flow untyped through `CreateKubexRequest.config`. |
| `pyyaml` | `>=6.0` (already present) | Load `config.yaml` files from agent directories | Already in use. `yaml.safe_load()` is sufficient for reading agent config files. No need for ruamel.yaml (comment-preserving roundtrip) since these configs are read-only at spawn time, never written back. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tarfile` (stdlib) | Python 3.12 stdlib | Build in-memory tar archives for `container.put_archive()` | Use when injecting skill `.md` files into a created-but-not-started container via the Docker SDK. No install required — this is in the Python standard library. |
| `io` / `BytesIO` (stdlib) | Python 3.12 stdlib | In-memory byte stream for tar construction | Pair with `tarfile` to build tar archives without touching disk. No install required. |
| `pathlib` (stdlib) | Python 3.12 stdlib | Resolving skill file paths on the Kubex Manager host | Already used in `standalone.py`. Use `Path.rglob("*.md")` to discover skill files. |
| `pydantic-settings` | `2.7.x` | `BaseSettings` for Kubex Manager config (env vars + YAML overlay) | Use if Kubex Manager gains complex config with env var overrides. Currently not needed — `os.environ.get()` is sufficient for the single new env var `KUBEX_SKILLS_BASE_PATH`. Defer unless config grows. |

### Development Tools (Existing — No Changes)

| Tool | Purpose | Notes |
|------|---------|-------|
| `pytest` + `pytest-asyncio 1.3.0` | Test framework | `asyncio_mode = "auto"` should be added to `pyproject.toml` — strict mode (current default in 1.3.0) requires explicit markers on every async test. Already used project-wide. |
| `fakeredis` | Redis stub for unit tests | Already in dev deps. No change. |
| `ruff` + `black` | Linting and formatting | Already configured in `pyproject.toml`. No change. |

---

## Installation

No new packages required. The refactor uses stdlib (`tarfile`, `io`, `pathlib`) plus docker-py which is already installed.

```bash
# No new production dependencies.
# Verify existing versions if upgrading:
pip install "docker==7.1.0"
pip install "pydantic>=2.12.5"

# Dev-only: if not already pinned
pip install "pytest-asyncio>=1.3.0"
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Bind mounts (`volumes=` in `containers.create()`) for skill directories | Named Docker volumes | Bind mounts let Kubex Manager control which host directory is mounted per-agent at creation time — different agents get different `/app/skills` directories. Named volumes would require a volume-per-agent management layer with no benefit. |
| `container.put_archive()` for pre-start file injection | Building a new Docker image per agent (current approach) | The current per-agent Dockerfile approach is exactly what we are eliminating. `put_archive()` copies a tar archive into a created container before `container.start()` is called — the target directory must exist in the base image (already does: `/app/skills` is created in `_base/Dockerfile`). |
| `put_archive()` for pre-start OR bind mounts at create time | `exec_run("pip install ...")` at runtime | `put_archive()` and bind mounts are the two valid paths for injecting static files (skills). `exec_run()` is appropriate only for runtime dependency requests (the policy-gated pip install flow), not for static skill injection. Keep them separate. |
| `pyyaml.safe_load()` for agent config | `ruamel.yaml` | Ruamel is superior for roundtrip editing (preserves comments). But agent configs are read-only at spawn time — Kubex Manager reads them, never writes them back. `pyyaml.safe_load()` is already present and sufficient. Don't add a dependency. |
| `pydantic` BaseModel for spawn config validation | Untyped dict passing (current) | Current `CreateKubexRequest.config: dict[str, Any]` passes config as an opaque dict. Adding typed Pydantic models (`AgentSpawnConfig`, `SkillManifest`) for the new spawn payload catches malformed inputs at the API boundary and makes the skill-injection logic explicit and testable. |
| `tarfile` + `BytesIO` (stdlib) for skill archive | Writing skills to a temp dir on disk first | Avoid disk writes in Kubex Manager — the manager runs as a container itself. In-memory tar via `BytesIO` is cleaner and avoids temp file cleanup logic. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Per-agent Dockerfiles | Requires a Docker build per new agent type — defeats the stem cell philosophy. Every build is a CI gate, a registry push, a deployment. Skills are markdown; they must not require image builds. | Bind mounts or `put_archive()` at spawn time |
| `docker.types.Mount` (high-level) over `volumes=` dict | `docker.types.Mount` is correct for K8s/Swarm deploy configs. For local Docker Engine usage (which this is), the `volumes=` dict in `containers.create()` is simpler, already used in `lifecycle.py` for credential mounts, and fully supported in docker-py 7.1. | `volumes=` dict parameter in `containers.create()` |
| `exec_run("pip install X")` without policy gate | Arbitrary package installation by an agent is a supply-chain attack surface. An agent that can self-install packages can escalate its own capabilities. | Route all runtime dep requests through the Gateway policy engine (ESCALATE path) before calling `exec_run()` in Kubex Manager |
| Runtime `pip install` into a running container as the primary dep mechanism | This approach mutates container state, making containers non-reproducible. Two containers of the same agent image with the same "approved" pip installs can still diverge. | Pre-install all realistic dependencies in the base image. Runtime pip is the escape hatch for unusual requests, not the normal path. |
| Building a new base image per release with agent-specific code | Reintroduces the per-agent image problem. New agents should require zero Docker builds. | Skill files mounted at spawn + config YAML passed via env or volume |

---

## Mechanism Summary: Skill Injection at Spawn Time

Two approaches are valid. The choice depends on whether skills change after a container starts.

**Approach A — Bind Mount (recommended for static skills)**

Kubex Manager creates a per-agent skill directory on the host (e.g., `/app/skills/{agent_id}/`) and mounts it read-only into the container at `/app/skills`:

```python
volumes={
    f"/app/skills/{agent_id}": {"bind": "/app/skills", "mode": "ro"},
    f"/app/secrets/cli-credentials/{provider}": {"bind": f"/run/secrets/{provider}", "mode": "ro"},
}
```

The harness's `_load_skill_files("/app/skills")` already handles this — no harness changes needed.

**Approach B — `put_archive()` (for dynamic file injection post-create, pre-start)**

After `containers.create()` and before `container.start()`, inject skill files as a tar archive:

```python
import io, tarfile

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w") as tar:
    for skill_path in skill_files:
        tar.add(skill_path, arcname=skill_path.name)
buf.seek(0)
container.put_archive("/app/skills", buf.read())
container.start()
```

**Recommendation: use Approach A (bind mounts) for the v1.1 refactor.** Bind mounts are already used for credential files in `lifecycle.py`. Kubex Manager already has `/app/skills` mounted into its own container (`docker-compose.yml` line: `- ./skills:/app/skills:ro`). Extending the existing bind-mount pattern is the lowest-risk path. `put_archive()` is the right tool if skills need to be injected into an already-running container, which is not a v1.1 requirement.

---

## Mechanism Summary: Runtime Dependency Requests

Agent calls a Gateway action → Gateway policy engine evaluates → if ESCALATE, reviewer approves → Kubex Manager calls `exec_run()`:

```python
exit_code, output = container.exec_run(
    ["pip", "install", "--no-cache-dir", package_name],
    workdir="/app",
    environment={"PIP_DISABLE_PIP_VERSION_CHECK": "1"},
)
```

**Security constraint:** `package_name` must be validated (allowlist or reviewer-approved) before `exec_run()`. The Gateway policy engine is the gate; Kubex Manager must not execute unapproved packages. This uses no new libraries — only `exec_run()` from docker-py.

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `docker` | `7.1.0` | Python 3.12 | 7.x required for Python 3.12 compat (6.x had SSL adapter issues) |
| `pydantic` | `>=2.12.5` | Python 3.12 | v2 API (`model_validate`, `BaseModel`) — project already uses this |
| `pytest-asyncio` | `>=1.3.0` | `pytest>=8.0` | Set `asyncio_mode = "auto"` in `pyproject.toml` to avoid per-test marker noise |
| `python:3.12-slim` | `3.12.12` (latest) | All packages above | slim variant is correct — no need for full Debian packages |

---

## Sources

- [Docker SDK for Python 7.1.0 — Containers](https://docker-py.readthedocs.io/en/stable/containers.html) — `containers.create()` volumes parameter, `put_archive()` method (HIGH confidence — official docs)
- [Docker SDK for Python — PyPI](https://pypi.org/project/docker/) — version 7.1.0, released May 2024 (HIGH confidence — official PyPI)
- [Docker Docs — Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) — bind mount vs named volume tradeoffs (HIGH confidence — official docs)
- [Pydantic — PyPI](https://pypi.org/project/pydantic/) — version 2.12.5, released November 2025 (HIGH confidence — official PyPI)
- [pytest-asyncio — PyPI](https://pypi.org/project/pytest-asyncio/) — version 1.3.0, released November 2025; `asyncio_mode = "auto"` (HIGH confidence — official PyPI)
- [Pydantic Settings docs](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) — BaseSettings env var patterns (MEDIUM confidence — official docs, not yet needed for this scope)
- [Docker Hub — python:3.12-slim](https://hub.docker.com/_/python/tags) — latest 3.12.12 point release (HIGH confidence — official Docker Hub)

---

*Stack research for: KubexClaw v1.1 Stem Cell Kubex Refactor*
*Researched: 2026-03-11*
