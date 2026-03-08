"""Tests for kubex_common.logging."""

from kubex_common.logging import (
    bind_request_context,
    clear_request_context,
    configure_logging,
    get_logger,
)


class TestLogging:
    def test_configure_logging(self) -> None:
        configure_logging("test-service")
        logger = get_logger("test")
        assert logger is not None

    def test_configure_logging_console(self) -> None:
        configure_logging("test-service", json_output=False)
        logger = get_logger("test")
        assert logger is not None

    def test_bind_and_clear_context(self) -> None:
        clear_request_context()
        bind_request_context(request_id="req-123", agent_id="test")
        # Context is set — would be injected into log events
        clear_request_context()

    def test_get_logger_with_name(self) -> None:
        logger = get_logger("my_module")
        assert logger is not None

    def test_get_logger_without_name(self) -> None:
        logger = get_logger()
        assert logger is not None
