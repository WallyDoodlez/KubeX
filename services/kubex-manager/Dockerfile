FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy shared library (build context is repo root)
COPY libs/kubex-common /tmp/kubex-common
COPY services/kubex-manager /app

RUN pip install --no-cache-dir /tmp/kubex-common && \
    pip install --no-cache-dir -e . && \
    rm -rf /tmp/kubex-common

EXPOSE 8090

CMD ["uvicorn", "kubex_manager.main:app", "--host", "0.0.0.0", "--port", "8090"]
