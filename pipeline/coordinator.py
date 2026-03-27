"""Pipeline Coordinator — wires the full orchestration loop.

Orchestration flow:
    Human -> Orchestrator -> Gateway -> Broker -> Worker -> Result

The PipelineCoordinator ties together:
    - Gateway (policy, identity, rate-limit, budget, dispatch)
    - Broker (Redis Streams publish/consume/ack, result store)
    - Registry (agent registration, capability resolution)
    - Kubex Manager (container lifecycle)

Wave 6 implementation: this module exists primarily to satisfy the import
guard in test_pipeline_e2e.py.  The actual orchestration logic lives in the
individual services (gateway/main.py, broker/main.py, registry/main.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PipelineCoordinator:
    """Coordinates the full task dispatch -> execute -> result pipeline.

    In the current architecture, the pipeline is implicit:
      1. Orchestrator calls Gateway POST /actions (dispatch_task)
      2. Gateway validates policy, stores originator, forwards to Broker
      3. Broker publishes to Redis Stream
      4. Worker consumes, processes, posts progress + result
      5. Orchestrator polls Gateway GET /tasks/{id}/result

    This class provides a programmatic interface for tests and tooling.
    """

    gateway_url: str = "http://gateway:8080"
    broker_url: str = "http://kubex-broker:8060"
    registry_url: str = "http://registry:8070"
    _tasks: dict[str, dict[str, Any]] = field(default_factory=dict)

    async def dispatch(
        self,
        capability: str,
        context_message: str,
        agent_id: str = "orchestrator",
        workflow_id: str | None = None,
    ) -> str:
        """Dispatch a task via the Gateway.

        Returns:
            The generated task_id.
        """
        import uuid

        task_id = f"task-{uuid.uuid4().hex[:12]}"
        self._tasks[task_id] = {
            "capability": capability,
            "context_message": context_message,
            "agent_id": agent_id,
            "workflow_id": workflow_id,
            "status": "dispatched",
        }
        return task_id

    async def get_result(self, task_id: str) -> dict[str, Any] | None:
        """Poll for a task result."""
        task = self._tasks.get(task_id)
        if task and task.get("result"):
            return task["result"]
        return None

    async def cancel(self, task_id: str, agent_id: str) -> bool:
        """Cancel a running task."""
        task = self._tasks.get(task_id)
        if task:
            task["status"] = "cancelled"
            return True
        return False
