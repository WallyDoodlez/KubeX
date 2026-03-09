"""Gateway service — Policy Engine, Egress Proxy, LLM Proxy, Inbound Gate."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, UTC
from typing import Any, AsyncGenerator

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from kubex_common.errors import (
    ActionNotAllowedError,
    BudgetExceededError,
    EgressDeniedError,
    ErrorResponse,
    IdentityResolutionError,
    PolicyDeniedError,
    RateLimitError,
    TaskNotFoundError,
)
from kubex_common.logging import get_logger
from kubex_common.schemas.actions import ActionRequest, ActionType
from kubex_common.schemas.envelope import GatekeeperEnvelope
from kubex_common.schemas.routing import TaskDelivery
from kubex_common.service import KubexService

from .budget import BudgetTracker
from .identity import IdentityResolver
from .llm_proxy import LLMProxy
from .policy import PolicyDecision, PolicyEngine, PolicyLoader, PolicyResult
from .ratelimit import RateLimiter

logger = get_logger(__name__)

router = APIRouter(tags=["actions"])
proxy_router = APIRouter(tags=["proxy"])

# Key for storing task originator in Redis
TASK_ORIGINATOR_PREFIX = "task:originator:"
TASK_ORIGINATOR_TTL = 86400  # 24 hours


# ─────────────────────────────────────────────
# Action endpoint
# ─────────────────────────────────────────────


@router.post("/actions")
async def handle_action(request: Request, body: ActionRequest) -> JSONResponse:
    """Evaluate and route an ActionRequest through the policy engine.

    Flow:
    1. Resolve agent identity from Docker labels (overwrite agent_id)
    2. Wrap in GatekeeperEnvelope
    3. Evaluate policy cascade (global -> boundary -> agent)
    4. Check rate limits
    5. Check budget
    6. Route to appropriate handler or deny
    """
    gateway: GatewayService = request.app.state.gateway_service

    # 1. Identity resolution — overwrite agent_id from Docker labels
    source_ip = request.client.host if request.client else "unknown"
    resolved_agent_id = body.agent_id  # fallback to request-supplied
    boundary = "default"

    try:
        resolved_agent_id, boundary = await gateway.identity_resolver.resolve(source_ip)
        # Overwrite agent_id with resolved identity (prevents spoofing)
        body = body.model_copy(update={"agent_id": resolved_agent_id})
    except IdentityResolutionError:
        # In dev/test mode without Docker, keep request-supplied agent_id
        # In production, this should be a hard failure
        if os.environ.get("KUBEX_STRICT_IDENTITY", "false").lower() == "true":
            return JSONResponse(
                status_code=401,
                content=ErrorResponse(
                    error="IdentityResolutionFailed",
                    message=f"Cannot resolve agent identity for IP {source_ip}",
                ).model_dump(),
            )
        logger.warning("identity_resolution_skipped", source_ip=source_ip, agent_id=body.agent_id)

    # 2. Policy evaluation
    task_id = body.context.task_id or f"t-{uuid.uuid4().hex[:8]}"
    token_count = 0
    daily_cost = 0.0

    # Lazy-initialize budget tracker if Redis is available but tracker is not set
    # or if redis_db1 has changed (e.g., tests swap in fakeredis per test class)
    if gateway.redis_db1 is not None:
        if gateway.budget_tracker is None or gateway.budget_tracker._redis is not gateway.redis_db1:
            gateway.budget_tracker = BudgetTracker(gateway.redis_db1)

    if gateway.budget_tracker and body.context.task_id:
        token_count = await gateway.budget_tracker.get_task_tokens(body.context.task_id)
        daily_cost = await gateway.budget_tracker.get_daily_cost(body.agent_id)

    policy_result = gateway.policy_engine.evaluate(
        body,
        token_count_so_far=token_count,
        cost_today_usd=daily_cost,
    )

    if policy_result.decision == PolicyDecision.DENY:
        logger.info(
            "action_denied",
            agent_id=body.agent_id,
            action=body.action.value,
            reason=policy_result.reason,
            rule=policy_result.rule_matched,
        )
        return JSONResponse(
            status_code=403,
            content=ErrorResponse(
                error="PolicyDenied",
                message=policy_result.reason,
                details={"rule": policy_result.rule_matched, "agent_id": body.agent_id},
            ).model_dump(),
        )

    # ESCALATE — route to the reviewer agent for security evaluation
    if policy_result.decision == PolicyDecision.ESCALATE:
        logger.info(
            "action_escalated_to_reviewer",
            agent_id=body.agent_id,
            action=body.action.value,
            reason=policy_result.reason,
        )
        try:
            reviewer_result = await _handle_reviewer_evaluation(
                body, policy_result, gateway
            )
        except (TimeoutError, asyncio.TimeoutError):
            logger.warning(
                "reviewer_timeout",
                agent_id=body.agent_id,
                action=body.action.value,
            )
            return JSONResponse(
                status_code=403,
                content=ErrorResponse(
                    error="ReviewerTimeout",
                    message="Reviewer agent did not respond in time — action denied (fail closed)",
                    details={"agent_id": body.agent_id, "action": body.action.value},
                ).model_dump(),
            )
        except Exception as exc:
            logger.error("reviewer_evaluation_failed", error=str(exc))
            return JSONResponse(
                status_code=403,
                content=ErrorResponse(
                    error="ReviewerUnavailable",
                    message=f"Reviewer evaluation failed — action denied (fail closed): {exc}",
                ).model_dump(),
            )

        reviewer_decision = reviewer_result.get("decision", "DENY").upper()
        reviewer_reasoning = reviewer_result.get("reasoning", "")

        if reviewer_decision == "DENY":
            return JSONResponse(
                status_code=403,
                content=ErrorResponse(
                    error="ReviewerDenied",
                    message=f"Reviewer denied action: {reviewer_reasoning}",
                    details={
                        "agent_id": body.agent_id,
                        "action": body.action.value,
                        "reviewer_decision": "DENY",
                        "reasoning": reviewer_reasoning,
                        "risk_level": reviewer_result.get("risk_level", "unknown"),
                    },
                ).model_dump(),
            )

        if reviewer_decision == "ESCALATE":
            return JSONResponse(
                status_code=423,
                content={
                    "status": "escalated",
                    "message": f"Reviewer escalated to human review: {reviewer_reasoning}",
                    "details": {
                        "agent_id": body.agent_id,
                        "action": body.action.value,
                        "reviewer_decision": "ESCALATE",
                        "reasoning": reviewer_reasoning,
                        "risk_level": reviewer_result.get("risk_level", "unknown"),
                    },
                },
            )

        # ALLOW — fall through to normal routing below
        logger.info(
            "reviewer_allowed",
            agent_id=body.agent_id,
            action=body.action.value,
            reasoning=reviewer_reasoning,
        )

    # Lazy-initialize rate limiter if Redis is available but limiter is not set
    # or if redis_db1 has changed
    if gateway.redis_db1 is not None:
        if gateway.rate_limiter is None or gateway.rate_limiter._redis is not gateway.redis_db1:
            gateway.rate_limiter = RateLimiter(gateway.redis_db1)

    # 3. Rate limit check
    if gateway.rate_limiter and body.action.value in gateway.rate_limit_config(body.agent_id):
        limit_str = gateway.rate_limit_config(body.agent_id)[body.action.value]
        allowed = await gateway.rate_limiter.check_and_increment(
            body.agent_id,
            body.action.value,
            limit_str,
            task_id=body.context.task_id,
        )
        if not allowed:
            return JSONResponse(
                status_code=429,
                content=ErrorResponse(
                    error="RateLimitExceeded",
                    message=f"Rate limit exceeded for action '{body.action.value}'",
                    details={"agent_id": body.agent_id, "action": body.action.value},
                ).model_dump(),
            )

    # 4. Route by action type
    logger.info(
        "action_allowed",
        agent_id=body.agent_id,
        action=body.action.value,
        boundary=boundary,
    )

    if body.action == ActionType.DISPATCH_TASK:
        return await _handle_dispatch_task(request, body, gateway)

    if body.action in (ActionType.HTTP_GET, ActionType.HTTP_POST, ActionType.HTTP_PUT, ActionType.HTTP_DELETE):
        return await _handle_egress(request, body, gateway)

    if body.action == ActionType.QUERY_KNOWLEDGE:
        return await _handle_query_knowledge(request, body, gateway)

    if body.action == ActionType.STORE_KNOWLEDGE:
        return await _handle_store_knowledge(request, body, gateway)

    if body.action == ActionType.SEARCH_CORPUS:
        return await _handle_search_corpus(request, body, gateway)

    # For other action types (report_result, progress_update, etc.) — acknowledge
    return JSONResponse(
        status_code=200,
        content={"status": "accepted", "agent_id": body.agent_id, "action": body.action.value},
    )


async def _handle_dispatch_task(request: Request, body: ActionRequest, gateway: "GatewayService") -> JSONResponse:
    """Handle dispatch_task action — resolve capability and write to Broker."""
    params = body.parameters
    capability = params.get("capability")
    context_message = params.get("context_message", "")
    workflow_id = body.context.workflow_id
    task_id = f"task-{uuid.uuid4().hex[:12]}"

    if not capability:
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                error="MissingCapability",
                message="dispatch_task requires 'capability' in parameters",
            ).model_dump(),
        )

    # Resolve capability via Registry
    registry_url = os.environ.get("REGISTRY_URL", "http://registry:8070")
    broker_url = os.environ.get("BROKER_URL", "http://broker:8060")

    # Create TaskDelivery and send to Broker
    delivery = TaskDelivery(
        task_id=task_id,
        workflow_id=workflow_id,
        capability=capability,
        context_message=context_message,
        from_agent=body.agent_id,
        priority=body.priority,
    )

    # Store originator for cancel authorization
    if gateway.redis_db1:
        try:
            await gateway.redis_db1.set(
                f"{TASK_ORIGINATOR_PREFIX}{task_id}",
                body.agent_id,
                ex=TASK_ORIGINATOR_TTL,
            )
        except Exception as exc:
            logger.warning("originator_store_failed", task_id=task_id, error=str(exc))

    # Forward to Broker
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{broker_url}/messages",
                json={"delivery": delivery.model_dump()},
            )
            resp.raise_for_status()
    except Exception as exc:
        logger.error("broker_forward_failed", task_id=task_id, error=str(exc))
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(
                error="BrokerUnavailable",
                message=f"Failed to dispatch task to Broker: {exc}",
            ).model_dump(),
        )

    return JSONResponse(
        status_code=202,
        content={"task_id": task_id, "status": "dispatched", "capability": capability},
    )


async def _handle_egress(request: Request, body: ActionRequest, gateway: "GatewayService") -> JSONResponse:
    """Handle HTTP egress actions — proxy the request through the Gateway."""
    if not body.target:
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(error="MissingTarget", message="HTTP actions require 'target' field").model_dump(),
        )

    method = body.action.value.replace("http_", "").upper()
    headers = {"User-Agent": "KubexGateway/0.1.0"}
    payload_bytes = b""

    if body.parameters:
        payload_str = json.dumps(body.parameters.get("body", {}))
        payload_bytes = payload_str.encode()
        headers["Content-Type"] = "application/json"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method=method,
                url=body.target,
                headers=headers,
                content=payload_bytes,
                params=body.parameters.get("params") if body.parameters else None,
            )
        return JSONResponse(
            status_code=200,
            content={
                "status_code": resp.status_code,
                "headers": dict(resp.headers),
                "body": resp.text,
            },
        )
    except Exception as exc:
        logger.error("egress_request_failed", target=body.target, error=str(exc))
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(error="EgressFailed", message=f"Egress request failed: {exc}").model_dump(),
        )


async def _handle_reviewer_evaluation(
    body: ActionRequest,
    policy_result: PolicyResult,
    gateway: "GatewayService",
    timeout: float = 30.0,
) -> dict[str, Any]:
    """Dispatch an ESCALATE decision to the reviewer agent for security evaluation.

    Sends the original action details to the reviewer via the broker's
    'security_review' capability stream, then polls for the reviewer's
    ALLOW / DENY / ESCALATE response.

    Returns a dict with keys: decision, reasoning, risk_level.
    Raises TimeoutError if the reviewer does not respond within *timeout* seconds.
    """
    broker_url = os.environ.get("BROKER_URL", "http://broker:8060")
    review_task_id = f"rev-{uuid.uuid4().hex[:12]}"

    review_payload = {
        "review_request_id": review_task_id,
        "original_action": body.action.value,
        "original_agent_id": body.agent_id,
        "original_target": body.target,
        "original_parameters": body.parameters or {},
        "reason_for_review": policy_result.reason,
        "policy_context": {
            "matched_rules": [policy_result.rule_matched] if policy_result.rule_matched else [],
            "chain_depth": body.context.chain_depth,
        },
    }

    delivery = {
        "task_id": review_task_id,
        "workflow_id": body.context.workflow_id or "",
        "capability": "security_review",
        "context_message": json.dumps(review_payload),
        "from_agent": "gateway",
        "priority": "high",
    }

    # Publish review task to broker
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{broker_url}/messages",
            json={"delivery": delivery},
        )
        resp.raise_for_status()

    # Poll for reviewer result
    poll_interval = 0.5
    elapsed = 0.0
    async with httpx.AsyncClient(timeout=10.0) as client:
        while elapsed < timeout:
            result_resp = await client.get(f"{broker_url}/tasks/{review_task_id}/result")
            if result_resp.status_code == 200:
                return result_resp.json()
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

    raise TimeoutError(f"Reviewer did not respond within {timeout}s for task {review_task_id}")


async def _handle_query_knowledge(request: Request, body: ActionRequest, gateway: "GatewayService") -> JSONResponse:
    """Handle query_knowledge action — proxy to Graphiti search.

    Spec: 'query_knowledge routes to Graphiti POST /search or GET /episodes'
    Supports temporal queries via 'as_of' parameter (Graphiti valid_at filter).
    Deducts estimated 500 tokens from task budget.
    """
    params = body.parameters or {}
    query = params.get("query", "")
    entity_types = params.get("entity_types")
    as_of = params.get("as_of")

    graphiti_url = getattr(gateway, "graphiti_url", os.environ.get("GRAPHITI_URL", "http://graphiti:8000"))

    graphiti_payload: dict[str, Any] = {"query": query}
    if entity_types:
        graphiti_payload["entity_types"] = entity_types
    if as_of:
        graphiti_payload["valid_at"] = as_of
        graphiti_payload["as_of"] = as_of

    # Deduct estimated budget tokens for knowledge query (500 tokens estimated)
    _QUERY_KNOWLEDGE_TOKEN_ESTIMATE = 500
    task_id = body.context.task_id or "unknown"
    if gateway.budget_tracker and task_id != "unknown":
        try:
            await gateway.budget_tracker.increment_tokens(
                task_id=task_id,
                agent_id=body.agent_id,
                input_tokens=_QUERY_KNOWLEDGE_TOKEN_ESTIMATE,
                output_tokens=0,
                model="knowledge-query",
            )
        except Exception as exc:
            logger.warning("query_knowledge_budget_deduction_failed", error=str(exc))

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{graphiti_url}/search", json=graphiti_payload)
            if resp.status_code == 404:
                # Try alternative endpoint
                resp = await client.get(f"{graphiti_url}/episodes", params={"q": query})

        if resp.status_code in (200, 201):
            data = resp.json()
            # Normalise response to KnowledgeQueryResult schema
            results = data.get("results", data.get("episodes", []))
            total = data.get("total", len(results))
            return JSONResponse(
                status_code=200,
                content={"results": results, "total": total},
            )
        else:
            return JSONResponse(
                status_code=502,
                content={"error": "GraphitiError", "message": f"Graphiti returned {resp.status_code}"},
            )
    except Exception as exc:
        logger.error("query_knowledge_failed", error=str(exc))
        return JSONResponse(
            status_code=502,
            content={"error": "GraphitiUnavailable", "message": str(exc)},
        )


async def _handle_store_knowledge(request: Request, body: ActionRequest, gateway: "GatewayService") -> JSONResponse:
    """Handle store_knowledge action — two-step: OpenSearch index + Graphiti episode.

    Spec: 'store_knowledge two-step: OpenSearch index + Graphiti episode'
    Step 1: Index full content in OpenSearch for full-text retrieval.
    Step 2: Write an episode to Graphiti for graph-based retrieval.
    """
    params = body.parameters or {}
    content = params.get("content", "")
    summary = params.get("summary", "")
    source = params.get("source", {})

    graphiti_url = getattr(gateway, "graphiti_url", os.environ.get("GRAPHITI_URL", "http://graphiti:8000"))
    opensearch_url = getattr(gateway, "opensearch_url", os.environ.get("OPENSEARCH_URL", "http://opensearch:9200"))

    doc_id = f"kn-{uuid.uuid4().hex[:12]}"
    task_id = body.context.task_id or source.get("task_id", "unknown")
    workflow_id = body.context.workflow_id or source.get("workflow_id", "unknown")
    timestamp = datetime.now(UTC).isoformat()

    opensearch_doc = {
        "content": content,
        "summary": summary,
        "source_description": summary,
        "task_id": task_id,
        "workflow_id": workflow_id,
        "timestamp": timestamp,
        "agent_id": body.agent_id,
    }

    graphiti_episode = {
        "content": content,
        "summary": summary,
        "source": {"task_id": task_id, "workflow_id": workflow_id, **source},
        "valid_at": timestamp,
    }

    nodes_created = 0
    edges_created = 0
    opensearch_id = doc_id

    # Deduct estimated budget tokens for knowledge store (1500 tokens estimated)
    _STORE_KNOWLEDGE_TOKEN_ESTIMATE = 1500
    store_task_id = body.context.task_id or source.get("task_id", "unknown")  # type: ignore[union-attr]
    if gateway.budget_tracker and store_task_id != "unknown":
        try:
            await gateway.budget_tracker.increment_tokens(
                task_id=store_task_id,
                agent_id=body.agent_id,
                input_tokens=_STORE_KNOWLEDGE_TOKEN_ESTIMATE,
                output_tokens=0,
                model="knowledge-store",
            )
        except Exception as exc:
            logger.warning("store_knowledge_budget_deduction_failed", error=str(exc))

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: Index in OpenSearch
            os_resp = await client.post(
                f"{opensearch_url}/knowledge-corpus-shared-001/_doc/{doc_id}",
                json=opensearch_doc,
            )
            if os_resp.status_code in (200, 201):
                opensearch_id = os_resp.json().get("_id", doc_id)

            # Step 2: Write episode to Graphiti
            graphiti_resp = await client.post(f"{graphiti_url}/episodes", json=graphiti_episode)
            if graphiti_resp.status_code in (200, 201):
                graphiti_data = graphiti_resp.json()
                nodes_created = graphiti_data.get("nodes_created", 1)
                edges_created = graphiti_data.get("edges_created", 0)

    except Exception as exc:
        logger.error("store_knowledge_failed", error=str(exc))
        return JSONResponse(
            status_code=502,
            content={"error": "KnowledgeStoreError", "message": str(exc)},
        )

    return JSONResponse(
        status_code=201,
        content={
            "nodes_created": nodes_created,
            "edges_created": edges_created,
            "opensearch_id": opensearch_id,
            "status": "stored",
        },
    )


async def _handle_search_corpus(request: Request, body: ActionRequest, gateway: "GatewayService") -> JSONResponse:
    """Handle search_corpus action — full-text search via OpenSearch.

    Spec: 'search_corpus proxies to OpenSearch keyword/semantic search'
    Supports date_from/date_to filters (range query on timestamp field).
    Uses GET /_search with a JSON body (standard OpenSearch query DSL).
    """
    params = body.parameters or {}
    query = params.get("query", "")
    filters = params.get("filters", {})
    limit = params.get("limit", 10)
    date_from = params.get("date_from")
    date_to = params.get("date_to")

    opensearch_url = getattr(gateway, "opensearch_url", os.environ.get("OPENSEARCH_URL", "http://opensearch:9200"))

    must_clauses: list[dict[str, Any]] = [
        {"multi_match": {"query": query, "fields": ["content", "summary", "source_description"]}}
    ]
    for field_name, value in filters.items():
        must_clauses.append({"term": {field_name: value}})

    # Add date range filter if date_from or date_to are provided
    if date_from or date_to:
        range_filter: dict[str, Any] = {}
        if date_from:
            range_filter["gte"] = date_from
        if date_to:
            range_filter["lte"] = date_to
        must_clauses.append({"range": {"timestamp": range_filter}})

    search_body: dict[str, Any] = {
        "query": {"bool": {"must": must_clauses}},
        "size": limit,
    }

    search_url = f"{opensearch_url}/knowledge-corpus-shared-*/_search"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Use GET with JSON body (OpenSearch supports GET /_search with body)
            resp = await client.get(
                search_url,
                json=search_body,
            )

        if resp.status_code in (200, 201):
            data = resp.json()
            hits = data.get("hits", {}).get("hits", [])
            results = [
                {
                    "id": h.get("_id"),
                    "score": h.get("_score"),
                    **h.get("_source", {}),
                }
                for h in hits
            ]
            total = data.get("hits", {}).get("total", {}).get("value", len(results))
            return JSONResponse(
                status_code=200,
                content={"documents": results, "results": results, "total": total},
            )
        else:
            return JSONResponse(
                status_code=502,
                content={"error": "OpenSearchError", "message": f"OpenSearch returned {resp.status_code}"},
            )
    except Exception as exc:
        logger.error("search_corpus_failed", error=str(exc))
        return JSONResponse(
            status_code=502,
            content={"error": "OpenSearchUnavailable", "message": str(exc)},
        )


# ─────────────────────────────────────────────
# Task endpoints
# ─────────────────────────────────────────────


@router.get("/tasks/{task_id}/stream")
async def stream_task_progress(task_id: str, request: Request) -> StreamingResponse:
    """SSE stream of task progress events.

    Subscribes to Redis pub/sub channel 'progress:{task_id}'.
    """
    gateway: GatewayService = request.app.state.gateway_service

    async def event_generator() -> AsyncGenerator[str, None]:
        if gateway.redis_db1 is None:
            yield f"data: {json.dumps({'error': 'Redis not available'})}\n\n"
            return

        channel = f"progress:{task_id}"
        pubsub = gateway.redis_db1.pubsub()
        try:
            await pubsub.subscribe(channel)
            async for message in pubsub.listen():
                if message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                    data = json.loads(message["data"])
                    if data.get("type") in ("result", "cancelled", "failed"):
                        break
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/tasks/{task_id}/progress")
async def receive_progress(task_id: str, request: Request) -> JSONResponse:
    """Receive progress chunks from worker harness and publish to Redis pub/sub."""
    gateway: GatewayService = request.app.state.gateway_service
    body = await request.json()

    if gateway.redis_db1:
        try:
            await gateway.redis_db1.publish(f"progress:{task_id}", json.dumps(body))
        except Exception as exc:
            logger.warning("progress_publish_failed", task_id=task_id, error=str(exc))

    return JSONResponse(status_code=202, content={"status": "published"})


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, request: Request) -> JSONResponse:
    """Cancel a running task.

    Only the originating agent can cancel a task.
    Publishes a cancel command to Redis 'control:{agent_id}'.
    """
    gateway: GatewayService = request.app.state.gateway_service
    body = await request.json()
    requesting_agent = body.get("agent_id")

    if not requesting_agent:
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(error="MissingAgentId", message="Cancel request requires agent_id").model_dump(),
        )

    # Verify caller is originator
    if gateway.redis_db1:
        originator = await gateway.redis_db1.get(f"{TASK_ORIGINATOR_PREFIX}{task_id}")
        if originator and originator != requesting_agent:
            return JSONResponse(
                status_code=403,
                content=ErrorResponse(
                    error="NotOriginator",
                    message="Only the originating agent can cancel a task",
                    details={"task_id": task_id, "originator": originator},
                ).model_dump(),
            )

        # Publish cancel command
        try:
            await gateway.redis_db1.publish(
                f"control:{requesting_agent}",
                json.dumps({"command": "cancel", "task_id": task_id}),
            )
        except Exception as exc:
            logger.warning("cancel_publish_failed", task_id=task_id, error=str(exc))

    return JSONResponse(status_code=200, content={"status": "cancel_requested", "task_id": task_id})


@router.get("/tasks/{task_id}/result")
async def get_task_result(task_id: str, request: Request) -> JSONResponse:
    """Proxy task result request to the Broker service."""
    broker_url = os.environ.get("BROKER_URL", "http://broker:8060")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{broker_url}/tasks/{task_id}/result")

        if resp.status_code == 200:
            return JSONResponse(status_code=200, content=resp.json())

        return JSONResponse(
            status_code=404,
            content=ErrorResponse(error="TaskNotFound", message=f"No result for task: {task_id}").model_dump(),
        )
    except Exception as exc:
        logger.error("result_proxy_failed", task_id=task_id, error=str(exc))
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(error="BrokerUnavailable", message=f"Failed to fetch result from Broker: {exc}").model_dump(),
        )


# ─────────────────────────────────────────────
# LLM Proxy endpoints
# ─────────────────────────────────────────────


@proxy_router.api_route(
    "/v1/proxy/{provider}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    response_model=None,
)
async def llm_proxy(provider: str, path: str, request: Request) -> StreamingResponse | JSONResponse:
    """LLM reverse proxy — forwards to provider API with injected API keys.

    Kubexes set ANTHROPIC_BASE_URL/OPENAI_BASE_URL to point here.
    Gateway injects the real API key before forwarding.
    """
    gateway: GatewayService = request.app.state.gateway_service

    # Get calling agent (from header set by harness, or from resolved identity)
    agent_id = request.headers.get("X-Kubex-Agent-Id", "unknown")

    body_bytes = await request.body()

    # Check model allowlist if specified in body
    if body_bytes:
        try:
            body_json = json.loads(body_bytes)
            model = body_json.get("model")
            agent_policy = gateway.policy_loader.get_agent_policy(agent_id)
            if not gateway.llm_proxy.check_model_allowed(agent_id, provider, model, agent_policy):
                return JSONResponse(
                    status_code=403,
                    content=ErrorResponse(
                        error="ModelNotAllowed",
                        message=f"Model '{model}' not in allowlist for agent '{agent_id}'",
                    ).model_dump(),
                )
        except json.JSONDecodeError:
            pass

    # Forward to provider
    try:
        headers = dict(request.headers)
        response = await gateway.llm_proxy.forward(
            provider=provider,
            path=path,
            method=request.method,
            headers=headers,
            body=body_bytes,
            agent_id=agent_id,
        )
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(error="UnknownProvider", message=str(exc)).model_dump(),
        )
    except Exception as exc:
        logger.error("llm_proxy_error", provider=provider, agent_id=agent_id, error=str(exc))
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(error="ProxyError", message=f"LLM proxy failed: {exc}").model_dump(),
        )

    # Track token usage for budget enforcement
    if gateway.budget_tracker and response.status_code == 200:
        response_body = response.content
        tokens = gateway.llm_proxy.count_tokens_from_response(provider, response_body)
        if tokens["input_tokens"] or tokens["output_tokens"]:
            task_id = request.headers.get("X-Kubex-Task-Id", "unknown")
            await gateway.budget_tracker.increment_tokens(
                task_id=task_id,
                agent_id=agent_id,
                input_tokens=tokens["input_tokens"],
                output_tokens=tokens["output_tokens"],
                model=provider,
            )

    # Return response (streaming or regular)
    response_headers = dict(response.headers)
    # Strip hop-by-hop and content-length headers (JSONResponse sets its own)
    for h in ("transfer-encoding", "connection", "keep-alive", "content-length", "content-encoding"):
        response_headers.pop(h, None)

    is_streaming = "text/event-stream" in response.headers.get("content-type", "")
    if is_streaming:
        async def stream_content() -> AsyncGenerator[bytes, None]:
            async for chunk in response.aiter_bytes():
                yield chunk

        return StreamingResponse(
            stream_content(),
            status_code=response.status_code,
            headers=response_headers,
            media_type="text/event-stream",
        )

    return JSONResponse(
        status_code=response.status_code,
        content=response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text},
        headers=response_headers,
    )


# ─────────────────────────────────────────────
# Service class
# ─────────────────────────────────────────────


class GatewayService(KubexService):
    def __init__(self) -> None:
        super().__init__(
            service_name="gateway",
            redis_url=os.environ.get("REDIS_URL"),
            redis_db=1,  # Rate limits DB
        )
        # Second Redis connection for db4 (budget)
        self.redis_db4_url = os.environ.get("REDIS_URL")
        self.redis_db1: Any | None = None  # Rate limits + pub/sub

        # Policy root defaults to project root
        policy_root = os.environ.get("KUBEX_POLICY_ROOT", ".")
        self.policy_loader = PolicyLoader(policy_root=policy_root)
        # Load policies at init time so they're available before on_startup
        # (important for TestClient usage without full lifespan)
        self.policy_loader.load_all()
        self.policy_engine = PolicyEngine(self.policy_loader)

        self.identity_resolver = IdentityResolver(docker_client=None)  # Docker client added on startup
        self.llm_proxy = LLMProxy()
        self.rate_limiter: RateLimiter | None = None
        self.budget_tracker: BudgetTracker | None = None

        # Knowledge backend URLs (Wave 5C)
        self.graphiti_url: str = os.environ.get("GRAPHITI_URL", "http://graphiti:8000")
        self.opensearch_url: str = os.environ.get("OPENSEARCH_URL", "http://opensearch:9200")

        self.app.include_router(router)
        self.app.include_router(proxy_router)
        self.app.state.gateway_service = self

    def rate_limit_config(self, agent_id: str) -> dict[str, str]:
        """Get rate limit config for an agent (agent-level, falling back to global)."""
        global_limits = dict(self.policy_loader.global_policy.rate_limits)
        agent_policy = self.policy_loader.get_agent_policy(agent_id)
        if agent_policy:
            global_limits.update(agent_policy.rate_limits)
        return global_limits

    async def on_startup(self) -> None:
        # Reload policy files on startup (picks up any changes since __init__)
        self.policy_loader.load_all()

        # Set up Redis clients
        if self.redis:
            self.redis_db1 = self.redis.client
            self.rate_limiter = RateLimiter(self.redis_db1)

            # Budget tracker on db4 — create a separate connection
            # For MVP, reuse db1 client (in production, use separate db4 connection)
            self.budget_tracker = BudgetTracker(self.redis_db1)

        # Initialize LLM proxy HTTP client
        await self.llm_proxy.connect()

        # Attempt Docker client initialization (optional)
        try:
            import docker
            docker_client = docker.from_env()
            self.identity_resolver = IdentityResolver(docker_client=docker_client)
            logger.info("docker_client_initialized")
        except Exception as exc:
            logger.info("docker_client_not_available", reason=str(exc))

    async def on_shutdown(self) -> None:
        await self.llm_proxy.disconnect()


service = GatewayService()
app = service.app
