FROM python:3.12-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy shared library (build context is repo root)
COPY libs/kubex-common /tmp/kubex-common

# Copy service
COPY services/gateway /app

# Install dependencies
RUN pip install --no-cache-dir /tmp/kubex-common && \
    pip install --no-cache-dir -e . && \
    rm -rf /tmp/kubex-common

EXPOSE 8080

CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8080"]
