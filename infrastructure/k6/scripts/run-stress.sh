#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — k6 Stress Test Runner
# Breaking point discovery: ramp 0→50→100→200→0 VUs over 10 minutes
# Thresholds are relaxed — the goal is to find where the system breaks.
#
# Usage:
#   bash infrastructure/k6/scripts/run-stress.sh
#   K6_BASE_URL=http://api:3001/api/v1 bash infrastructure/k6/scripts/run-stress.sh
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$K6_ROOT/docker-compose.k6.yml"

echo "=========================================="
echo " LIBERTASIAN — k6 Stress Test"
echo "=========================================="
echo "Profile:   stress (0→50→100→200→0 VUs, 10min)"
echo "Base URL:  ${K6_BASE_URL:-http://host.docker.internal:3001/api/v1}"
echo "InfluxDB:  http://influxdb:8086/k6"
echo ""
echo "NOTE: Thresholds are relaxed. This test finds"
echo "      breaking points, not SLO compliance."
echo "=========================================="

# Ensure InfluxDB is running
docker compose -f "$COMPOSE_FILE" up -d influxdb
echo "[INFO] Waiting for InfluxDB to be ready..."
sleep 3

# Run stress profile
docker compose -f "$COMPOSE_FILE" run --rm \
  ${K6_BASE_URL:+-e K6_BASE_URL="$K6_BASE_URL"} \
  ${K6_TEST_USER_EMAIL:+-e K6_TEST_USER_EMAIL="$K6_TEST_USER_EMAIL"} \
  ${K6_TEST_USER_PASSWORD:+-e K6_TEST_USER_PASSWORD="$K6_TEST_USER_PASSWORD"} \
  k6 run /scripts/profiles/stress.js

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "[PASS] Stress test completed — system handled peak load within relaxed thresholds."
else
  echo "[WARN] Stress test exited with code $EXIT_CODE — review Grafana for breaking point analysis."
fi

echo "[INFO] View results in Grafana: http://localhost:3333/d/libertasian-k6-load-testing"

exit $EXIT_CODE
