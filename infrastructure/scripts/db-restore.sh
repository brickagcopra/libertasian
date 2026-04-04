#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — Database Restore Script
#
# Usage:
#   ./db-restore.sh /path/to/libertasian-20260321-020000.dump
#   ./db-restore.sh /path/to/libertasian-20260321-020000.dump.enc   # encrypted
#
# WARNING: This will DROP and recreate the target database.
#          Always create a backup of the current database before restoring.
# ==========================================================================

set -euo pipefail

# ── Configuration ──
CONTAINER_NAME="${POSTGRES_CONTAINER:-libertasian-postgres}"
DB_USER="${POSTGRES_USER:-libertasian}"
DB_NAME="${POSTGRES_DB:-libertasian}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# ── Validate Arguments ──
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file>"
  echo ""
  echo "Examples:"
  echo "  $0 /opt/libertasian/backups/libertasian-20260321-020000.dump"
  echo "  $0 /opt/libertasian/backups/libertasian-20260321-020000.dump.enc"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "============================================"
echo "  LIBERTASIAN Database Restore"
echo "============================================"
echo ""
echo "  Backup file: ${BACKUP_FILE}"
echo "  Target DB:   ${DB_NAME}"
echo "  Container:   ${CONTAINER_NAME}"
echo ""
echo "  WARNING: This will overwrite the '${DB_NAME}' database."
echo ""

# ── Confirmation ──
read -rp "Are you sure you want to proceed? (type 'yes' to confirm): " CONFIRM
if [[ "${CONFIRM}" != "yes" ]]; then
  echo "Restore cancelled."
  exit 0
fi

RESTORE_FILE="${BACKUP_FILE}"

# ── Decrypt if needed ──
if [[ "${BACKUP_FILE}" == *.enc ]]; then
  if [[ -z "${ENCRYPTION_KEY}" ]]; then
    echo "ERROR: Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set."
    exit 1
  fi

  echo "[$(date -Iseconds)] Decrypting backup..."
  RESTORE_FILE="${BACKUP_FILE%.enc}"
  openssl enc -aes-256-cbc -d -salt -pbkdf2 -iter 100000 \
    -in "${BACKUP_FILE}" \
    -out "${RESTORE_FILE}" \
    -pass "pass:${ENCRYPTION_KEY}"
  echo "[$(date -Iseconds)] Decryption complete."
fi

# ── Pre-restore backup ──
echo "[$(date -Iseconds)] Creating pre-restore safety backup..."
PRE_RESTORE_FILE="/tmp/libertasian-pre-restore-$(date +%Y%m%d-%H%M%S).dump"
docker exec "${CONTAINER_NAME}" pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --no-owner \
  2>/dev/null \
  > "${PRE_RESTORE_FILE}" || true
echo "[$(date -Iseconds)] Safety backup: ${PRE_RESTORE_FILE}"

# ── Stop application services ──
echo "[$(date -Iseconds)] Stopping application services..."
docker stop libertasian-api libertasian-web libertasian-worker-service libertasian-worker-beat 2>/dev/null || true

# ── Restore Database ──
echo "[$(date -Iseconds)] Restoring database from backup..."

# Drop existing connections
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  2>/dev/null || true

# Drop and recreate database
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c \
  "DROP DATABASE IF EXISTS ${DB_NAME};"
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c \
  "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

# Enable extensions
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
  "CREATE EXTENSION IF NOT EXISTS vector;"
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
  "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

# Restore from dump
cat "${RESTORE_FILE}" | docker exec -i "${CONTAINER_NAME}" pg_restore \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --no-owner \
  --no-privileges \
  --verbose \
  2>&1 | tail -5

echo "[$(date -Iseconds)] Database restore complete."

# ── Cleanup decrypted temp file ──
if [[ "${BACKUP_FILE}" == *.enc ]] && [[ -f "${RESTORE_FILE}" ]]; then
  rm -f "${RESTORE_FILE}"
  echo "[$(date -Iseconds)] Cleaned up decrypted temp file."
fi

# ── Run Prisma migrations ──
echo "[$(date -Iseconds)] Running Prisma migrate deploy to ensure schema is current..."
docker exec libertasian-api npx prisma migrate deploy 2>&1 || true

# ── Restart application services ──
echo "[$(date -Iseconds)] Restarting application services..."
docker start libertasian-api libertasian-web libertasian-worker-service libertasian-worker-beat 2>/dev/null || true

echo ""
echo "============================================"
echo "  Restore complete!"
echo "============================================"
echo "  Pre-restore backup: ${PRE_RESTORE_FILE}"
echo "  Restored from:      ${BACKUP_FILE}"
echo ""
echo "  Verify the application is working correctly."
echo "  If issues arise, restore the pre-restore backup:"
echo "    $0 ${PRE_RESTORE_FILE}"
echo "============================================"
