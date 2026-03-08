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

# Install MCP bridge dependencies (httpx for Gateway client)
RUN pip install --no-cache-dir httpx>=0.27.0

# Copy MCP bridge package and install it
COPY agents/orchestrator/mcp-bridge /app/mcp-bridge
RUN pip install --no-cache-dir -e /app/mcp-bridge 2>/dev/null || true

# Create required directories
RUN mkdir -p /run/secrets /root/.openclaw/skills

# Copy MCP server config for OpenClaw native MCP client support
COPY agents/orchestrator/mcp.json /root/.openclaw/mcp.json

# Agent config is mounted at runtime via docker-compose volumes

ENV GATEWAY_URL=http://gateway:8080
ENV ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic
ENV OPENAI_BASE_URL=http://gateway:8080/v1/proxy/openai

# Keep container alive for docker exec sessions
CMD ["tail", "-f", "/dev/null"]
