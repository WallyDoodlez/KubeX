---
status: complete
phase: 06-manager-spawn-policy-gates
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md]
started: 2026-03-16T12:00:00Z
updated: 2026-03-16T12:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running services. Run `python -m pytest tests/ --tb=short -q` from scratch. All 856+ tests pass with 0 failures. No import errors, no missing modules.
result: pass

### 2. ConfigBuilder Produces Valid Config
expected: Run `python -c "from kubex_manager.config_builder import ConfigBuilder; print('ConfigBuilder imported')"` — prints confirmation without error. ConfigBuilder.build() exists and is callable.
result: pass

### 3. KubexRecordStore Redis Round-Trip
expected: Run `python -c "from kubex_manager.redis_store import KubexRecordStore; print('KubexRecordStore imported')"` — prints confirmation. The store has save(), delete(), load_all() methods.
result: pass

### 4. SkillResolver Agent-Config Input
expected: Run `python -c "from kubex_manager.skill_resolver import SkillResolver; r = SkillResolver(); print(hasattr(r, 'resolve_from_config'))"` — prints True. SkillResolver now accepts agent config dicts, not just skill name lists.
result: pass

### 5. Gateway Skill-Check Endpoint Exists
expected: Run `python -c "from gateway.main import router; routes = [r.path for r in router.routes]; print('/policy/skill-check' in routes or any('skill-check' in str(r.path) for r in router.routes))"` — prints True. POST /policy/skill-check endpoint is registered on the Gateway.
result: pass

### 6. install_dependency Action Type Exists
expected: Run `python -c "from kubex_common.schemas.actions import ActionType; print(ActionType.INSTALL_DEPENDENCY)"` — prints `install_dependency`. The new action type is in the enum.
result: pass

### 7. Package Blocklist in Global Policy
expected: Run `python -c "import yaml; data = yaml.safe_load(open('policies/global.yaml')); bl = data.get('global', {}).get('package_blocklist', {}); print('pip' in bl and len(bl['pip']) >= 4)"` — prints True. Global policy has a pip package blocklist with at least 4 seed entries.
result: pass

### 8. Docker Network Label in Compose
expected: Run `python -c "import yaml; data = yaml.safe_load(open('docker-compose.yml')); nets = data.get('networks', {}); internal = nets.get('kubex-internal', {}); labels = internal.get('labels', {}); print('kubex.network' in labels)"` — prints True. docker-compose.yml has the kubex.network label on the network definition.
result: pass

### 9. No Hardcoded Network in Lifecycle
expected: Run `grep -c "KUBEX_DOCKER_NETWORK\|NETWORK_INTERNAL" services/kubex-manager/kubex_manager/lifecycle.py` — prints 0 (or only in comments/imports, not in the container create path). The hardcoded network string is replaced by label lookup.
result: pass

### 10. Manager API New Endpoints
expected: Run `python -c "from kubex_manager.main import router; paths = [r.path for r in router.routes]; print('/kubexes/{kubex_id}/respawn' in paths or any('respawn' in str(p) for p in paths))"` — prints True. New Manager endpoints (respawn, install-dep, config) are registered.
result: pass

### 11. Ruff and Black Clean
expected: Run `python -m ruff check services/kubex-manager/kubex_manager/config_builder.py services/kubex-manager/kubex_manager/redis_store.py services/kubex-manager/kubex_manager/lifecycle.py --quiet` — exits with 0 (no lint errors). All Phase 6 files pass ruff.
result: pass

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
