#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — k6 Smoke Test Runner
# Sanity check: 2 VUs, 30s — verify endpoints respond correctly
#
# Usage:
#   bash infrastructure/k6/scripts/run-smoke.sh
#   K6_BASE_URL=http://api:3001/api/v1 bash infrastructure/k6/scripts/run-smoke.sh
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$K6_ROOT/docker-compose.k6.yml"

echo "=========================================="
echo " LIBERTASIAN — k6 Smoke Test"
echo "=========================================="
echo "Profile:   smoke (2 VUs, 30s)"
echo "Base URL:  ${K6_BASE_URL:-http://host.docker.internal:3001/api/v1}"
echo "InfluxDB:  http://influxdb:8086/k6"
echo "=========================================="

# Ensure InfluxDB is running
docker compose -f "$COMPOSE_FILE" up -d influxdb
echo "[INFO] Waiting for InfluxDB to be ready..."
sleep 3

# Run smoke profile
docker compose -f "$COMPOSE_FILE" run --rm \
  ${K6_BASE_URL:+-e K6_BASE_URL="$K6_BASE_URL"} \
  ${K6_TEST_USER_EMAIL:+-e K6_TEST_USER_EMAIL="$K6_TEST_USER_EMAIL"} \
  ${K6_TEST_USER_PASSWORD:+-e K6_TEST_USER_PASSWORD="$K6_TEST_USER_PASSWORD"} \
  k6 run /scripts/profiles/smoke.js

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "[PASS] Smoke test completed successfully."
else
  echo "[FAIL] Smoke test failed with exit code $EXIT_CODE."
fi

echo "[INFO] View results in Grafana: http://localhost:3333/d/libertasian-k6-load-testing"

exit $EXIT_CODE
