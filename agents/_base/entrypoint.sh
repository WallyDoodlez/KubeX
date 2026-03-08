#!/usr/bin/env bash
# kubex-harness entrypoint script
#
# Bootstrap sequence:
#   1. Create ~/.openclaw/ directory
#   2. Write ~/.openclaw/openclaw.json from mounted config (if present)
#   3. Load skills into ~/.openclaw/skills/ (if any)
#   4. Invoke kubex-harness Python module
#
# Required env vars (set by Kubex Manager):
#   KUBEX_AGENT_ID       — agent identity
#   KUBEX_TASK_ID        — task being executed
#   KUBEX_TASK_MESSAGE   — natural language task message
#   GATEWAY_URL          — gateway base URL for progress posting
#
# Optional env vars:
#   KUBEX_PROGRESS_BUFFER_MS      — progress chunk buffer time (ms)
#   KUBEX_PROGRESS_MAX_CHUNK_KB   — max progress chunk size (KB)
#   KUBEX_ABORT_GRACE_PERIOD_S    — cancellation grace period (seconds)
#   REDIS_URL                      — Redis URL for cancel channel subscription

set -euo pipefail

# ---------------------------------------------------------------------------
# Step 1: Create openclaw config directory
# ---------------------------------------------------------------------------
OPENCLAW_CONFIG_DIR="${HOME}/.openclaw"
mkdir -p "${OPENCLAW_CONFIG_DIR}/skills"

# ---------------------------------------------------------------------------
# Step 2: Write openclaw.json from mounted config (if available)
# ---------------------------------------------------------------------------
OPENCLAW_CONFIG_SRC="/run/secrets/openclaw.json"
OPENCLAW_CONFIG_DEST="${OPENCLAW_CONFIG_DIR}/openclaw.json"

if [ -f "${OPENCLAW_CONFIG_SRC}" ]; then
    cp "${OPENCLAW_CONFIG_SRC}" "${OPENCLAW_CONFIG_DEST}"
    echo "[entrypoint] Wrote openclaw.json from mounted config"
elif [ -n "${OPENCLAW_CONFIG_JSON:-}" ]; then
    # Config passed as env var (base64 encoded or raw JSON)
    echo "${OPENCLAW_CONFIG_JSON}" > "${OPENCLAW_CONFIG_DEST}"
    echo "[entrypoint] Wrote openclaw.json from OPENCLAW_CONFIG_JSON env var"
else
    # Write a minimal default config
    cat > "${OPENCLAW_CONFIG_DEST}" << 'EOF'
{
  "version": "2026.2.26",
  "mode": "local"
}
EOF
    echo "[entrypoint] Wrote default openclaw.json"
fi

# ---------------------------------------------------------------------------
# Step 3: Load skills into ~/.openclaw/skills/
# ---------------------------------------------------------------------------
SKILLS_SRC_DIR="/app/skills"
if [ -d "${SKILLS_SRC_DIR}" ]; then
    cp -r "${SKILLS_SRC_DIR}/." "${OPENCLAW_CONFIG_DIR}/skills/"
    echo "[entrypoint] Loaded skills from ${SKILLS_SRC_DIR}"
fi

# ---------------------------------------------------------------------------
# Step 4: Invoke kubex-harness
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting kubex-harness for agent=${KUBEX_AGENT_ID} task=${KUBEX_TASK_ID}"
exec python -m kubex_harness.main
