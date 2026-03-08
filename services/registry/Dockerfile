FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy shared library (build context is repo root)
COPY libs/kubex-common /tmp/kubex-common
COPY services/registry /app

RUN pip install --no-cache-dir /tmp/kubex-common && \
    pip install --no-cache-dir -e . && \
    rm -rf /tmp/kubex-common

EXPOSE 8070

CMD ["uvicorn", "registry.main:app", "--host", "0.0.0.0", "--port", "8070"]
