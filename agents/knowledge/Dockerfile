# Knowledge agent — extends the KubexClaw _base image
# The _base image provides:
#   - Python 3.12 + kubex-common + kubex-harness
#   - CMD: python -m kubex_harness.standalone (polls broker, calls LLM, stores results)
FROM kubexclaw-base:latest

# Copy agent config (mounted at runtime in production, baked in for builds)
COPY agents/knowledge/config.yaml /app/config.yaml

# Copy knowledge recall skill so OpenClaw loads it into the system prompt
COPY skills/knowledge/recall/ /app/skills/knowledge/recall/

# Environment defaults (overridden by Kubex Manager at container launch)
ENV KUBEX_AGENT_ID=knowledge
ENV GATEWAY_URL=http://gateway:8080
ENV ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic

# Inherits CMD from base image: python -m kubex_harness.standalone
