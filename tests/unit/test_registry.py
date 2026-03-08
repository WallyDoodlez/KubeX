"""Unit tests for the Kubex Registry service."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

# We need to install the registry package first or add to path
import sys
import os

# Add services to path for testing
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/registry"))

from registry.store import AgentRegistration, AgentStatus, CapabilityStore
from kubex_common.errors import AgentNotFoundError, CapabilityNotFoundError


class TestAgentRegistration:
    def test_default_status(self) -> None:
        reg = AgentRegistration(agent_id="test-agent")
        assert reg.status == AgentStatus.UNKNOWN

    def test_with_capabilities(self) -> None:
        reg = AgentRegistration(
            agent_id="scraper",
            capabilities=["scrape_profile", "scrape_posts"],
            boundary="default",
        )
        assert len(reg.capabilities) == 2
        assert "scrape_profile" in reg.capabilities

    def test_with_accepts_from(self) -> None:
        reg = AgentRegistration(
            agent_id="scraper",
            accepts_from=["orchestrator"],
        )
        assert "orchestrator" in reg.accepts_from


class TestCapabilityStore:
    def setup_method(self) -> None:
        self.store = CapabilityStore()

    @pytest.mark.asyncio
    async def test_register_new_agent(self) -> None:
        reg = AgentRegistration(agent_id="agent-1", capabilities=["do_thing"])
        result = await self.store.register(reg)
        assert result.agent_id == "agent-1"
        assert len(self.store.list_all()) == 1

    @pytest.mark.asyncio
    async def test_register_updates_existing(self) -> None:
        reg = AgentRegistration(agent_id="agent-1", capabilities=["cap-a"])
        await self.store.register(reg)

        updated = AgentRegistration(agent_id="agent-1", capabilities=["cap-a", "cap-b"])
        await self.store.register(updated)

        all_agents = self.store.list_all()
        assert len(all_agents) == 1
        assert len(all_agents[0].capabilities) == 2

    @pytest.mark.asyncio
    async def test_register_preserves_registered_at(self) -> None:
        reg = AgentRegistration(agent_id="agent-1")
        result = await self.store.register(reg)
        original_ts = result.registered_at

        updated = AgentRegistration(agent_id="agent-1", capabilities=["new-cap"])
        result2 = await self.store.register(updated)
        assert result2.registered_at == original_ts

    def test_get_existing_agent(self) -> None:
        # Pre-populate the store directly
        reg = AgentRegistration(agent_id="agent-1")
        self.store._agents["agent-1"] = reg
        result = self.store.get("agent-1")
        assert result.agent_id == "agent-1"

    def test_get_missing_agent_raises(self) -> None:
        with pytest.raises(AgentNotFoundError):
            self.store.get("nonexistent")

    def test_list_all_empty(self) -> None:
        assert self.store.list_all() == []

    def test_list_all_multiple(self) -> None:
        self.store._agents["a1"] = AgentRegistration(agent_id="a1")
        self.store._agents["a2"] = AgentRegistration(agent_id="a2")
        assert len(self.store.list_all()) == 2

    @pytest.mark.asyncio
    async def test_deregister_agent(self) -> None:
        reg = AgentRegistration(agent_id="agent-1", capabilities=["cap-a"])
        await self.store.register(reg)
        await self.store.deregister("agent-1")
        assert len(self.store.list_all()) == 0

    @pytest.mark.asyncio
    async def test_deregister_missing_raises(self) -> None:
        with pytest.raises(AgentNotFoundError):
            await self.store.deregister("nonexistent")

    @pytest.mark.asyncio
    async def test_update_status(self) -> None:
        reg = AgentRegistration(agent_id="agent-1")
        await self.store.register(reg)
        result = await self.store.update_status("agent-1", AgentStatus.RUNNING)
        assert result.status == AgentStatus.RUNNING

    @pytest.mark.asyncio
    async def test_update_status_missing_raises(self) -> None:
        with pytest.raises(AgentNotFoundError):
            await self.store.update_status("nonexistent", AgentStatus.RUNNING)

    def test_resolve_capability_running_agent(self) -> None:
        self.store._agents["scraper"] = AgentRegistration(
            agent_id="scraper",
            capabilities=["scrape_profile"],
            status=AgentStatus.RUNNING,
        )
        result = self.store.resolve_capability("scrape_profile")
        assert len(result) == 1
        assert result[0].agent_id == "scraper"

    def test_resolve_capability_busy_agent_included(self) -> None:
        self.store._agents["scraper"] = AgentRegistration(
            agent_id="scraper",
            capabilities=["scrape_profile"],
            status=AgentStatus.BUSY,
        )
        result = self.store.resolve_capability("scrape_profile")
        assert len(result) == 1

    def test_resolve_capability_stopped_agent_excluded(self) -> None:
        self.store._agents["scraper"] = AgentRegistration(
            agent_id="scraper",
            capabilities=["scrape_profile"],
            status=AgentStatus.STOPPED,
        )
        with pytest.raises(CapabilityNotFoundError):
            self.store.resolve_capability("scrape_profile")

    def test_resolve_capability_not_found_raises(self) -> None:
        with pytest.raises(CapabilityNotFoundError):
            self.store.resolve_capability("unknown_capability")

    def test_resolve_capability_multiple_agents(self) -> None:
        self.store._agents["a1"] = AgentRegistration(
            agent_id="a1", capabilities=["cap-x"], status=AgentStatus.RUNNING
        )
        self.store._agents["a2"] = AgentRegistration(
            agent_id="a2", capabilities=["cap-x"], status=AgentStatus.RUNNING
        )
        result = self.store.resolve_capability("cap-x")
        assert len(result) == 2


class TestRegistryEndpoints:
    def setup_method(self) -> None:
        # Import here to avoid module-level import issues
        from registry.main import app
        self.client = TestClient(app)

    def test_health_endpoint(self) -> None:
        resp = self.client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "kubex-registry"

    def test_register_agent(self) -> None:
        resp = self.client.post(
            "/agents",
            json={
                "agent_id": "test-scraper",
                "capabilities": ["scrape_profile"],
                "status": "running",
                "boundary": "default",
                "accepts_from": ["orchestrator"],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["agent_id"] == "test-scraper"

    def test_list_agents_empty(self) -> None:
        resp = self.client.get("/agents")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_missing_agent_returns_404(self) -> None:
        resp = self.client.get("/agents/nonexistent-agent-xyz")
        assert resp.status_code == 404

    def test_register_then_get(self) -> None:
        self.client.post(
            "/agents",
            json={"agent_id": "reg-then-get", "capabilities": ["do_stuff"]},
        )
        resp = self.client.get("/agents/reg-then-get")
        assert resp.status_code == 200
        assert resp.json()["agent_id"] == "reg-then-get"

    def test_register_then_delete(self) -> None:
        self.client.post(
            "/agents",
            json={"agent_id": "to-delete", "capabilities": []},
        )
        resp = self.client.delete("/agents/to-delete")
        assert resp.status_code == 204

    def test_delete_missing_returns_404(self) -> None:
        resp = self.client.delete("/agents/does-not-exist-xyz")
        assert resp.status_code == 404

    def test_update_status(self) -> None:
        self.client.post(
            "/agents",
            json={"agent_id": "status-test", "capabilities": []},
        )
        resp = self.client.patch("/agents/status-test/status", json={"status": "running"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"

    def test_update_status_missing_returns_404(self) -> None:
        resp = self.client.patch("/agents/no-such-agent/status", json={"status": "running"})
        assert resp.status_code == 404

    def test_resolve_capability_no_agents(self) -> None:
        resp = self.client.get("/capabilities/nonexistent_capability")
        assert resp.status_code == 404

    def test_resolve_capability_with_running_agent(self) -> None:
        self.client.post(
            "/agents",
            json={
                "agent_id": "cap-agent",
                "capabilities": ["my_capability"],
                "status": "running",
            },
        )
        resp = self.client.get("/capabilities/my_capability")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1
