#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — k6 Test Data Seeder
# Seeds PostgreSQL with performance test data and initializes OpenSearch indexes.
#
# Usage:
#   bash infrastructure/k6/scripts/seed-test-data.sh
#
# Prerequisites:
#   - PostgreSQL running (docker compose up -d postgres)
#   - API server running for OpenSearch indexing (pnpm --filter api dev)
#
# Environment Variables:
#   DATABASE_URL — PostgreSQL connection string (default: from .env or docker compose)
#   API_URL     — API base URL (default: http://localhost:3001/api/v1)
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="${SCRIPT_DIR}/../seed"
API_URL="${API_URL:-http://localhost:3001/api/v1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --------------------------------------------------------------------------
# Step 1: Generate bcrypt hash for test users
# --------------------------------------------------------------------------
log_info "Step 1: Generating bcrypt password hash for k6 test users..."

# Use Node.js to generate the hash (bcryptjs is available in the API workspace)
PASSWORD_HASH=$(node -e "
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('K6PerfTest2026!', 12);
  process.stdout.write(hash);
" 2>/dev/null || echo "")

if [ -z "$PASSWORD_HASH" ]; then
  log_warn "Could not generate bcrypt hash via Node.js. Trying npx..."
  PASSWORD_HASH=$(npx -y bcryptjs -e "
    const bcrypt = require('bcryptjs');
    process.stdout.write(bcrypt.hashSync('K6PerfTest2026!', 12));
  " 2>/dev/null || echo "")
fi

if [ -z "$PASSWORD_HASH" ]; then
  log_error "Failed to generate bcrypt hash. Ensure Node.js and bcryptjs are available."
  log_error "Run: cd apps/api && pnpm install"
  exit 1
fi

log_info "Password hash generated successfully."

# --------------------------------------------------------------------------
# Step 2: Seed PostgreSQL
# --------------------------------------------------------------------------
log_info "Step 2: Seeding PostgreSQL with k6 performance test data..."

# Replace placeholder hash in SQL with real hash
SEED_SQL=$(cat "${SEED_DIR}/seed-perf-data.sql" | sed "s|\\\$2b\\\$12\\\$k6PerfTestHashPlaceholder000000000000000000000000000000|${PASSWORD_HASH}|g")

# Try docker exec first (if running via docker compose)
if docker exec libertasian-postgres psql -U libertasian -d libertasian -c "SELECT 1" > /dev/null 2>&1; then
  echo "$SEED_SQL" | docker exec -i libertasian-postgres psql -U libertasian -d libertasian
  log_info "PostgreSQL seeded via docker exec."
elif command -v psql > /dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  echo "$SEED_SQL" | psql "$DATABASE_URL"
  log_info "PostgreSQL seeded via psql."
else
  log_error "Cannot connect to PostgreSQL. Ensure docker compose is running or DATABASE_URL is set."
  exit 1
fi

# --------------------------------------------------------------------------
# Step 3: Verify seeded data
# --------------------------------------------------------------------------
log_info "Step 3: Verifying seeded data..."

VERIFY_SQL="SELECT
  (SELECT COUNT(*) FROM users WHERE email LIKE 'k6-%@libertasian.test') as k6_users,
  (SELECT COUNT(*) FROM organizations WHERE slug = 'k6-perf-test') as k6_orgs,
  (SELECT COUNT(*) FROM legal_documents WHERE id::text LIKE 'k6-doc-%') as k6_docs,
  (SELECT COUNT(*) FROM legal_document_sections WHERE legal_document_id::text LIKE 'k6-doc-%') as k6_sections;"

if docker exec libertasian-postgres psql -U libertasian -d libertasian -c "$VERIFY_SQL" 2>/dev/null; then
  log_info "Data verification complete."
elif command -v psql > /dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -c "$VERIFY_SQL"
  log_info "Data verification complete."
fi

# --------------------------------------------------------------------------
# Step 4: Index documents in OpenSearch (optional — requires API server)
# --------------------------------------------------------------------------
log_info "Step 4: Attempting to index k6 documents in OpenSearch..."

# Check if API is running
if curl -sf "${API_URL}/health" > /dev/null 2>&1 || curl -sf "http://localhost:3001/api/v1/health" > /dev/null 2>&1; then
  log_info "API server detected. Indexing will happen automatically via document creation hooks."
  log_info "If documents are not searchable, run the admin bulk-index endpoint manually."
else
  log_warn "API server not running. Skipping OpenSearch indexing."
  log_warn "Start the API (pnpm --filter api dev) and documents will be indexed on access."
fi

# --------------------------------------------------------------------------
# Done
# --------------------------------------------------------------------------
echo ""
log_info "========================================="
log_info "k6 test data seeding complete!"
log_info "========================================="
log_info ""
log_info "Test users:"
log_info "  Member: k6-perf@libertasian.test / K6PerfTest2026!"
log_info "  Admin:  k6-admin@libertasian.test / K6PerfTest2026!"
log_info ""
log_info "Run smoke test:"
log_info "  docker compose -f infrastructure/k6/docker-compose.k6.yml run --rm k6 run /scripts/profiles/smoke.js"
