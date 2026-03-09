# Reviewer agent — extends the KubexClaw _base image
# The _base image provides:
#   - Python 3.12 + kubex-common + kubex-harness
#   - CMD: python -m kubex_harness.standalone (polls broker, calls LLM, stores results)
#
# The reviewer uses OpenAI (o3-mini) for split-provider anti-collusion.
# OPENAI_BASE_URL points to the Gateway proxy — no direct API key access.
FROM kubexclaw-base:latest

# Copy agent config (mounted at runtime in production, baked in for builds)
COPY agents/reviewer/config.yaml /app/config.yaml

# Reviewer has no custom skills — it only performs security review
# The system prompt is defined in config.yaml

# Environment defaults (overridden by Kubex Manager at container launch)
ENV KUBEX_AGENT_ID=reviewer
ENV GATEWAY_URL=http://gateway:8080
ENV OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai

# Inherits CMD from base image: python -m kubex_harness.standalone
