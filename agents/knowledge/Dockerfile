# Knowledge agent — extends the KubexClaw _base image
# The _base image provides:
#   - Node.js 22 + openclaw CLI
#   - Python 3.12 + kubex-common + kubex-harness
#   - entrypoint.sh bootstrap
FROM kubex-base:latest

# Copy agent config (mounted at runtime in production, baked in for builds)
COPY agents/knowledge/config.yaml /app/config.yaml

# Copy knowledge recall skill so OpenClaw loads it into the system prompt
COPY skills/knowledge/recall/ /app/skills/knowledge/recall/

# Environment defaults (overridden by Kubex Manager at container launch)
ENV KUBEX_AGENT_ID=knowledge
ENV GATEWAY_URL=http://gateway:8080
ENV ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic

ENTRYPOINT ["/app/entrypoint.sh"]
