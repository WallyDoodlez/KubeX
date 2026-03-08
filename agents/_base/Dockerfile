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

# Create secrets mount point (compatible with Docker Swarm / K8s conventions)
RUN mkdir -p /run/secrets

# Default environment
ENV GATEWAY_URL=http://gateway:8080
ENV KUBEX_PROGRESS_BUFFER_MS=500
ENV KUBEX_PROGRESS_MAX_CHUNK_KB=16
ENV KUBEX_ABORT_GRACE_PERIOD_S=30

# Healthcheck
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Entrypoint will be overridden per-agent or by kubex-harness
CMD ["tail", "-f", "/dev/null"]
