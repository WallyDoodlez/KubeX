# Base image for all KubexClaw agent containers
# All agents are built FROM this image with config-only differentiation
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install kubex-common
COPY libs/kubex-common /tmp/kubex-common
RUN pip install --no-cache-dir /tmp/kubex-common && rm -rf /tmp/kubex-common

# Install kubex-harness (standalone agent loop + PTY harness)
COPY agents/_base/pyproject.toml agents/_base/kubex_harness /tmp/kubex-harness/kubex_harness/
COPY agents/_base/pyproject.toml /tmp/kubex-harness/pyproject.toml
RUN pip install --no-cache-dir /tmp/kubex-harness && rm -rf /tmp/kubex-harness

# Copy entrypoint script
COPY agents/_base/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create secrets mount point (compatible with Docker Swarm / K8s conventions)
RUN mkdir -p /run/secrets

# Default environment
ENV GATEWAY_URL=http://gateway:8080
ENV BROKER_URL=http://broker:8060
ENV KUBEX_PROGRESS_BUFFER_MS=500
ENV KUBEX_PROGRESS_MAX_CHUNK_KB=16
ENV KUBEX_ABORT_GRACE_PERIOD_S=30

# Healthcheck — standalone agent has no HTTP server, so just check the process
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD pgrep -f "kubex_harness" || exit 1

# Run the standalone agent loop (polls broker, calls LLM, reports results)
CMD ["python", "-m", "kubex_harness.standalone"]
