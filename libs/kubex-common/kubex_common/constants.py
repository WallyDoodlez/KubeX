"""KubexClaw shared constants — ports, Redis DB numbers, network names, defaults."""

# Service ports
GATEWAY_PORT = 8080
BROKER_PORT = 8060
REGISTRY_PORT = 8070
MANAGER_PORT = 8090
GRAPHITI_PORT = 8100
REDIS_PORT = 6379
NEO4J_BOLT_PORT = 7687
NEO4J_HTTP_PORT = 7474
OPENSEARCH_PORT = 9200

# Redis database assignments
REDIS_DB_BROKER = 0        # Broker message streams (AOF)
REDIS_DB_RATE_LIMITS = 1   # Gateway rate limit counters (ephemeral)
REDIS_DB_REGISTRY = 2      # Registry capability cache (ephemeral)
REDIS_DB_LIFECYCLE = 3     # Kubex Manager lifecycle events (AOF)
REDIS_DB_BUDGET = 4        # Gateway budget tracking (RDB)

# Docker network names
NETWORK_INTERNAL = "kubex-internal"
NETWORK_EXTERNAL = "kubex-external"
NETWORK_DATA = "kubex-data"

# Rate limit defaults (per agent per minute)
DEFAULT_RATE_LIMIT_HTTP = 60
DEFAULT_RATE_LIMIT_DISPATCH = 30
DEFAULT_RATE_LIMIT_KNOWLEDGE_QUERY = 30
DEFAULT_RATE_LIMIT_KNOWLEDGE_STORE = 10
DEFAULT_RATE_LIMIT_CORPUS_SEARCH = 20

# Timeout defaults (seconds)
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_READ_TIMEOUT = 30.0
DEFAULT_WRITE_TIMEOUT = 10.0

# Knowledge base
DEFAULT_VALID_AT_WINDOW_HOURS = 24

# Chain depth
MAX_CHAIN_DEPTH = 5

# Broker defaults
BROKER_STREAM_PREFIX = "boundary:"
BROKER_DEFAULT_STREAM = "boundary:default"
BROKER_MAX_STREAM_LEN = 10000
BROKER_DLQ_MAX_RETRIES = 3
BROKER_DLQ_RETRY_DELAY_S = 60

# Progress streaming defaults
PROGRESS_BUFFER_MS = 500
PROGRESS_MAX_CHUNK_KB = 16

# Cancellation defaults
CANCEL_GRACE_PERIOD_S = 30

# Health check
HEALTH_CHECK_INTERVAL_S = 10
HEALTH_CHECK_TIMEOUT_S = 5
