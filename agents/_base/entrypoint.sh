#!/usr/bin/env bash
# kubex-harness entrypoint script
#
# Bootstrap sequence:
#   1. Install pip/system dependencies from env vars (BASE-03)
#   2. Create ~/.openclaw/ directory
#   3. Write ~/.openclaw/openclaw.json from mounted config (if present)
#   4. Load skills into ~/.openclaw/skills/ (if any)
#   5. Invoke kubex-harness Python module
#
# Required env vars (set by Kubex Manager):
#   KUBEX_AGENT_ID       — agent identity
#   GATEWAY_URL          — gateway base URL for progress posting
#
# Optional env vars:
#   KUBEX_PIP_DEPS        — space-separated pip packages to install at boot
#   KUBEX_SYSTEM_DEPS     — space-separated apt packages to install at boot
#   KUBEX_PROGRESS_BUFFER_MS      — progress chunk buffer time (ms)
#   KUBEX_PROGRESS_MAX_CHUNK_KB   — max progress chunk size (KB)
#   KUBEX_ABORT_GRACE_PERIOD_S    — cancellation grace period (seconds)
#   REDIS_URL                      — Redis URL for cancel channel subscription

set -euo pipefail

# ---------------------------------------------------------------------------
# Step 1: Install runtime dependencies (BASE-03)
# ---------------------------------------------------------------------------

# Boot deps from config.yaml are trusted — no policy gate (PSEC-01)
# These are set by Kubex Manager from the agent's config at spawn time.
# Only POST-boot runtime requests from inside the container go through the Gateway
# approve/deny/ESCALATE policy pipeline.
if [ -n "${KUBEX_PIP_DEPS:-}" ]; then
    echo "[entrypoint] Installing pip dependencies: ${KUBEX_PIP_DEPS}"
    # shellcheck disable=SC2086
    pip install --no-cache-dir --quiet ${KUBEX_PIP_DEPS} || {
        echo "[entrypoint] FATAL: pip install failed for: ${KUBEX_PIP_DEPS}"
        exit 1
    }
    echo "[entrypoint] pip dependencies installed: ${KUBEX_PIP_DEPS}"
fi

if [ -n "${KUBEX_SYSTEM_DEPS:-}" ]; then
    echo "[entrypoint] Installing system dependencies: ${KUBEX_SYSTEM_DEPS}"
    # shellcheck disable=SC2086
    apt-get update -qq && apt-get install -y --no-install-recommends ${KUBEX_SYSTEM_DEPS} || {
        echo "[entrypoint] FATAL: apt install failed for: ${KUBEX_SYSTEM_DEPS}"
        exit 1
    }
    echo "[entrypoint] system dependencies installed: ${KUBEX_SYSTEM_DEPS}"
fi

# ---------------------------------------------------------------------------
# Step 2: Create openclaw config directory
# ---------------------------------------------------------------------------
OPENCLAW_CONFIG_DIR="${HOME}/.openclaw"
mkdir -p "${OPENCLAW_CONFIG_DIR}/skills"

# ---------------------------------------------------------------------------
# Step 3: Write openclaw.json from mounted config (if available)
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
# Step 4: Load skills into ~/.openclaw/skills/
# ---------------------------------------------------------------------------
SKILLS_SRC_DIR="/app/skills"
if [ -d "${SKILLS_SRC_DIR}" ]; then
    cp -r "${SKILLS_SRC_DIR}/." "${OPENCLAW_CONFIG_DIR}/skills/"
    echo "[entrypoint] Loaded skills from ${SKILLS_SRC_DIR}"
fi

# ---------------------------------------------------------------------------
# Step 4b: Generate CLAUDE.md from skills for CLI runtimes (CLI-05)
# ---------------------------------------------------------------------------
# Read runtime from config.yaml if it exists. Only generate CLAUDE.md for
# non-openai-api runtimes (CLI agents like claude-code, codex-cli, gemini-cli).
RUNTIME="openai-api"
if [ -f /app/config.yaml ]; then
    # Extract runtime value using grep+sed (no jq/yq dependency)
    RUNTIME_LINE=$(grep -E '^\s*runtime:' /app/config.yaml 2>/dev/null || true)
    if [ -n "${RUNTIME_LINE}" ]; then
        RUNTIME=$(echo "${RUNTIME_LINE}" | sed 's/.*runtime:\s*//' | sed 's/["'"'"' ]//g')
    fi
fi

if [ "${RUNTIME}" != "openai-api" ] && [ -d "${SKILLS_SRC_DIR}" ]; then
    CLAUDE_MD="/app/CLAUDE.md"
    echo "# Agent Skills" > "${CLAUDE_MD}"
    echo "" >> "${CLAUDE_MD}"
    FIRST=true
    for SKILL_DIR in "${SKILLS_SRC_DIR}"/*/; do
        if [ -f "${SKILL_DIR}SKILL.md" ]; then
            if [ "${FIRST}" = true ]; then
                FIRST=false
            else
                echo "" >> "${CLAUDE_MD}"
                echo "---" >> "${CLAUDE_MD}"
                echo "" >> "${CLAUDE_MD}"
            fi
            cat "${SKILL_DIR}SKILL.md" >> "${CLAUDE_MD}"
        fi
    done
    echo "[entrypoint] Generated CLAUDE.md from skills for runtime=${RUNTIME}"
fi

# ---------------------------------------------------------------------------
# Step 5: Invoke the CMD passed to the container (defaults to kubex-harness)
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting kubex-harness for agent=${KUBEX_AGENT_ID:-unknown}"
exec "$@"
