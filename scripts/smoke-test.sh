#!/usr/bin/env bash
# smoke-test.sh — Verify KubexClaw services are healthy after docker compose up
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
REGISTRY_URL="${REGISTRY_URL:-http://localhost:8070}"
BROKER_URL="${BROKER_URL:-http://localhost:8060}"
MANAGER_URL="${MANAGER_URL:-http://localhost:8090}"

MAX_WAIT=60   # seconds to wait for services
INTERVAL=3    # seconds between retries

PASS=0
FAIL=0
RESULTS=()

report() {
  local name="$1" status="$2"
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
    RESULTS+=("  [PASS] $name")
  else
    FAIL=$((FAIL + 1))
    RESULTS+=("  [FAIL] $name")
  fi
}

wait_for_health() {
  local name="$1" url="$2"
  local elapsed=0
  echo "Waiting for $name ($url) ..."
  while [ $elapsed -lt $MAX_WAIT ]; do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "  $name is healthy (${elapsed}s)"
      return 0
    fi
    sleep $INTERVAL
    elapsed=$((elapsed + INTERVAL))
  done
  echo "  $name did NOT become healthy within ${MAX_WAIT}s"
  return 1
}

echo "============================================"
echo " KubexClaw Smoke Test"
echo "============================================"
echo ""

# ── Health checks ──────────────────────────────────────────────

for svc in "Gateway:${GATEWAY_URL}/health" \
           "Registry:${REGISTRY_URL}/health" \
           "Broker:${BROKER_URL}/health" \
           "Kubex-Manager:${MANAGER_URL}/health"; do
  name="${svc%%:*}"
  url="${svc#*:}"
  if wait_for_health "$name" "$url"; then
    report "$name health" "PASS"
  else
    report "$name health" "FAIL"
  fi
done

echo ""

# ── Functional test: POST an action to Gateway ────────────────

echo "Testing: POST action to Gateway ..."
ACTION_BODY='{"action_type":"dispatch_task","agent_id":"orchestrator","payload":{"task":"ping","priority":"low"}}'
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${GATEWAY_URL}/actions" \
  -H "Content-Type: application/json" \
  -d "$ACTION_BODY" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
  echo "  Gateway /actions responded with HTTP $HTTP_CODE"
  report "Gateway POST /actions" "PASS"
else
  echo "  Gateway /actions failed with HTTP $HTTP_CODE"
  report "Gateway POST /actions" "FAIL"
fi

echo ""

# ── Summary ───────────────────────────────────────────────────

echo "============================================"
echo " Results: $PASS passed, $FAIL failed"
echo "============================================"
for r in "${RESULTS[@]}"; do
  echo "$r"
done
echo ""

if [ $FAIL -gt 0 ]; then
  echo "SMOKE TEST FAILED"
  exit 1
else
  echo "SMOKE TEST PASSED"
  exit 0
fi
