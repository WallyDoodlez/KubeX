# Instagram Scraper agent — extends the KubexClaw _base image
# The _base image provides:
#   - Node.js 22 + openclaw CLI
#   - Python 3.12 + kubex-common + kubex-harness
#   - entrypoint.sh bootstrap
FROM kubex-base:latest

# Copy agent config (mounted at runtime in production, baked in for builds)
COPY agents/instagram-scraper/config.yaml /app/config.yaml

# Copy skill files so OpenClaw can load them as system prompt extensions
COPY skills/data-collection/web-scraping/ /app/skills/data-collection/web-scraping/

# Web scraping may need additional dependencies (e.g. html parsing)
# Using pip install here keeps the _base layer clean
RUN pip install --no-cache-dir \
    beautifulsoup4>=4.12.0 \
    lxml>=5.0.0

# Environment defaults (overridden by Kubex Manager at container launch)
ENV KUBEX_AGENT_ID=instagram-scraper
ENV GATEWAY_URL=http://gateway:8080
ENV ANTHROPIC_BASE_URL=http://gateway:8080/v1/proxy/anthropic

ENTRYPOINT ["/app/entrypoint.sh"]
