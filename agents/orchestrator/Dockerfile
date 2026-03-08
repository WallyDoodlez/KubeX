# Orchestrator — long-running container managed by docker-compose
# User connects via: docker exec -it orchestrator claude --mcp-server /app/mcp-bridge/config.json
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install kubex-common
COPY libs/kubex-common /tmp/kubex-common
RUN pip install --no-cache-dir /tmp/kubex-common && rm -rf /tmp/kubex-common

# Create required directories
RUN mkdir -p /run/secrets /app/mcp-bridge

# Agent config is mounted at runtime via docker-compose volumes
# MCP bridge will be added in Wave 5

ENV GATEWAY_URL=http://gateway:8080
ENV ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic
ENV OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai

# Keep container alive for docker exec sessions
CMD ["tail", "-f", "/dev/null"]
