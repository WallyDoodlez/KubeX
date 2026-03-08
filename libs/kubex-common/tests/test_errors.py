"""Tests for kubex_common.errors."""

from kubex_common.errors import (
    ActionNotAllowedError,
    AgentNotFoundError,
    BudgetExceededError,
    CapabilityNotFoundError,
    EgressDeniedError,
    ErrorResponse,
    IdentityResolutionError,
    KubexError,
    ModelNotAllowedError,
    PolicyDeniedError,
    RateLimitError,
    TaskNotFoundError,
)


class TestErrorResponse:
    def test_create_minimal(self) -> None:
        resp = ErrorResponse(error="TestError", message="Something went wrong")
        assert resp.error == "TestError"
        assert resp.message == "Something went wrong"
        assert resp.details is None
        assert resp.request_id is None

    def test_create_full(self) -> None:
        resp = ErrorResponse(
            error="TestError",
            message="Bad request",
            details={"field": "name"},
            request_id="req-123",
        )
        assert resp.details == {"field": "name"}
        assert resp.request_id == "req-123"

    def test_serialization(self) -> None:
        resp = ErrorResponse(error="TestError", message="test")
        data = resp.model_dump()
        assert "error" in data
        assert "message" in data


class TestKubexError:
    def test_base_error(self) -> None:
        err = KubexError("Something broke")
        assert str(err) == "Something broke"
        assert err.message == "Something broke"
        assert err.details == {}

    def test_with_details(self) -> None:
        err = KubexError("Broke", details={"key": "val"})
        assert err.details == {"key": "val"}

    def test_to_response(self) -> None:
        err = KubexError("Broke", details={"key": "val"})
        resp = err.to_response(request_id="req-1")
        assert resp.error == "KubexError"
        assert resp.message == "Broke"
        assert resp.request_id == "req-1"


class TestPolicyDeniedError:
    def test_default_message(self) -> None:
        err = PolicyDeniedError()
        assert "denied" in err.message.lower()

    def test_with_rule(self) -> None:
        err = PolicyDeniedError("Blocked", rule="egress_allowlist")
        assert err.details["rule_matched"] == "egress_allowlist"


class TestBudgetExceededError:
    def test_with_limits(self) -> None:
        err = BudgetExceededError(limit=10000, current=12000, unit="tokens")
        assert err.details["limit"] == 10000
        assert err.details["current"] == 12000
        assert err.details["unit"] == "tokens"


class TestRateLimitError:
    def test_with_action(self) -> None:
        err = RateLimitError(action="http_get", limit=60)
        assert err.details["action"] == "http_get"
        assert err.details["limit"] == 60
        assert err.details["window_seconds"] == 60


class TestAgentNotFoundError:
    def test_message(self) -> None:
        err = AgentNotFoundError("scraper-1")
        assert "scraper-1" in err.message
        assert err.details["agent_id"] == "scraper-1"


class TestCapabilityNotFoundError:
    def test_message(self) -> None:
        err = CapabilityNotFoundError("scrape_instagram")
        assert "scrape_instagram" in err.message


class TestActionNotAllowedError:
    def test_message(self) -> None:
        err = ActionNotAllowedError("http_post", "scraper-1")
        assert "http_post" in err.message
        assert "scraper-1" in err.message


class TestIdentityResolutionError:
    def test_with_ip(self) -> None:
        err = IdentityResolutionError(source_ip="172.18.0.5")
        assert err.details["source_ip"] == "172.18.0.5"

    def test_without_ip(self) -> None:
        err = IdentityResolutionError()
        assert err.details == {}


class TestTaskNotFoundError:
    def test_message(self) -> None:
        err = TaskNotFoundError("task-42")
        assert "task-42" in err.message


class TestEgressDeniedError:
    def test_message(self) -> None:
        err = EgressDeniedError("evil.com", agent_id="scraper-1")
        assert "evil.com" in err.message
        assert err.details["agent_id"] == "scraper-1"


class TestModelNotAllowedError:
    def test_message(self) -> None:
        err = ModelNotAllowedError("gpt-4", agent_id="scraper-1")
        assert "gpt-4" in err.message
