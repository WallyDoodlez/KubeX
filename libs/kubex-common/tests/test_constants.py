"""Tests for kubex_common.constants."""

from kubex_common.constants import (
    BROKER_DEFAULT_STREAM,
    BROKER_DLQ_MAX_RETRIES,
    BROKER_MAX_STREAM_LEN,
    BROKER_PORT,
    CANCEL_GRACE_PERIOD_S,
    DEFAULT_CONNECT_TIMEOUT,
    DEFAULT_READ_TIMEOUT,
    DEFAULT_VALID_AT_WINDOW_HOURS,
    GATEWAY_PORT,
    GRAPHITI_PORT,
    MANAGER_PORT,
    MAX_CHAIN_DEPTH,
    NEO4J_BOLT_PORT,
    NETWORK_DATA,
    NETWORK_EXTERNAL,
    NETWORK_INTERNAL,
    OPENSEARCH_PORT,
    REDIS_DB_BROKER,
    REDIS_DB_BUDGET,
    REDIS_DB_LIFECYCLE,
    REDIS_DB_RATE_LIMITS,
    REDIS_DB_REGISTRY,
    REDIS_PORT,
    REGISTRY_PORT,
)


class TestServicePorts:
    def test_gateway_port(self) -> None:
        assert GATEWAY_PORT == 8080

    def test_broker_port(self) -> None:
        assert BROKER_PORT == 8060

    def test_registry_port(self) -> None:
        assert REGISTRY_PORT == 8070

    def test_manager_port(self) -> None:
        assert MANAGER_PORT == 8090

    def test_graphiti_port(self) -> None:
        assert GRAPHITI_PORT == 8100

    def test_redis_port(self) -> None:
        assert REDIS_PORT == 6379

    def test_neo4j_bolt_port(self) -> None:
        assert NEO4J_BOLT_PORT == 7687

    def test_opensearch_port(self) -> None:
        assert OPENSEARCH_PORT == 9200


class TestRedisDBAssignments:
    def test_db_numbers_are_unique(self) -> None:
        dbs = [REDIS_DB_BROKER, REDIS_DB_RATE_LIMITS, REDIS_DB_REGISTRY, REDIS_DB_LIFECYCLE, REDIS_DB_BUDGET]
        assert len(set(dbs)) == len(dbs), "Redis DB numbers must be unique"

    def test_db_numbers_in_range(self) -> None:
        for db in [REDIS_DB_BROKER, REDIS_DB_RATE_LIMITS, REDIS_DB_REGISTRY, REDIS_DB_LIFECYCLE, REDIS_DB_BUDGET]:
            assert 0 <= db <= 15

    def test_broker_db_is_zero(self) -> None:
        assert REDIS_DB_BROKER == 0

    def test_budget_db_is_four(self) -> None:
        assert REDIS_DB_BUDGET == 4


class TestNetworkNames:
    def test_internal_network(self) -> None:
        assert NETWORK_INTERNAL == "kubex-internal"

    def test_external_network(self) -> None:
        assert NETWORK_EXTERNAL == "kubex-external"

    def test_data_network(self) -> None:
        assert NETWORK_DATA == "kubex-data"


class TestDefaults:
    def test_timeouts_are_positive(self) -> None:
        assert DEFAULT_CONNECT_TIMEOUT > 0
        assert DEFAULT_READ_TIMEOUT > 0

    def test_max_chain_depth(self) -> None:
        assert MAX_CHAIN_DEPTH == 5

    def test_broker_defaults(self) -> None:
        assert BROKER_DEFAULT_STREAM == "boundary:default"
        assert BROKER_MAX_STREAM_LEN == 10000
        assert BROKER_DLQ_MAX_RETRIES == 3

    def test_cancel_grace_period(self) -> None:
        assert CANCEL_GRACE_PERIOD_S == 30

    def test_valid_at_window(self) -> None:
        assert DEFAULT_VALID_AT_WINDOW_HOURS == 24
