#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — Database Backup Script
# Per PDD Section 11.2: Database backups encrypted and stored separately
#
# Usage:
#   ./db-backup.sh                   # Full backup with default settings
#   ./db-backup.sh --upload          # Backup and upload to S3/MinIO
#   ./db-backup.sh --keep 7          # Keep last 7 local backups
#
# Cron example (daily at 2am):
#   0 2 * * * /opt/libertasian/infrastructure/scripts/db-backup.sh --upload --keep 7
# ==========================================================================

set -euo pipefail

# ── Configuration ──
BACKUP_DIR="${BACKUP_DIR:-/opt/libertasian/backups}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-libertasian-postgres}"
DB_USER="${POSTGRES_USER:-libertasian}"
DB_NAME="${POSTGRES_DB:-libertasian}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="libertasian-${TIMESTAMP}.dump"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"
ENCRYPTED_PATH="${BACKUP_PATH}.enc"
KEEP_BACKUPS="${KEEP_BACKUPS:-7}"
UPLOAD_TO_S3=false
S3_BUCKET="${S3_BACKUP_BUCKET:-libertasian-backups}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# ── Parse Arguments ──
while [[ $# -gt 0 ]]; do
  case $1 in
    --upload) UPLOAD_TO_S3=true; shift ;;
    --keep) KEEP_BACKUPS="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 [--upload] [--keep N]"
      echo "  --upload    Upload encrypted backup to S3/MinIO"
      echo "  --keep N    Keep last N local backups (default: 7)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Setup ──
mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] Starting database backup..."

# ── Dump Database ──
echo "[$(date -Iseconds)] Dumping PostgreSQL database '${DB_NAME}'..."
docker exec "${CONTAINER_NAME}" pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --verbose \
  2>/dev/null \
  > "${BACKUP_PATH}"

BACKUP_SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
echo "[$(date -Iseconds)] Dump complete: ${BACKUP_PATH} (${BACKUP_SIZE})"

# ── Encrypt Backup ──
if [[ -n "${ENCRYPTION_KEY}" ]]; then
  echo "[$(date -Iseconds)] Encrypting backup..."
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
    -in "${BACKUP_PATH}" \
    -out "${ENCRYPTED_PATH}" \
    -pass "pass:${ENCRYPTION_KEY}"
  rm -f "${BACKUP_PATH}"
  BACKUP_PATH="${ENCRYPTED_PATH}"
  echo "[$(date -Iseconds)] Encryption complete: ${ENCRYPTED_PATH}"
else
  echo "[$(date -Iseconds)] WARNING: BACKUP_ENCRYPTION_KEY not set. Backup is NOT encrypted."
fi

# ── Upload to S3/MinIO ──
if [[ "${UPLOAD_TO_S3}" == true ]]; then
  echo "[$(date -Iseconds)] Uploading to S3 bucket: ${S3_BUCKET}..."

  # Use MinIO client if available, otherwise aws cli
  if command -v mc &> /dev/null; then
    mc cp "${BACKUP_PATH}" "myminio/${S3_BUCKET}/$(basename "${BACKUP_PATH}")"
  elif command -v aws &> /dev/null; then
    aws s3 cp "${BACKUP_PATH}" "s3://${S3_BUCKET}/$(basename "${BACKUP_PATH}")" \
      --endpoint-url "${S3_ENDPOINT:-http://localhost:9000}"
  else
    echo "[$(date -Iseconds)] ERROR: Neither 'mc' nor 'aws' CLI found. Skipping upload."
  fi

  echo "[$(date -Iseconds)] Upload complete."
fi

# ── Cleanup Old Backups ──
echo "[$(date -Iseconds)] Cleaning up old backups (keeping last ${KEEP_BACKUPS})..."
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/libertasian-*.dump* 2>/dev/null | wc -l)

if [[ ${BACKUP_COUNT} -gt ${KEEP_BACKUPS} ]]; then
  DELETE_COUNT=$((BACKUP_COUNT - KEEP_BACKUPS))
  ls -1t "${BACKUP_DIR}"/libertasian-*.dump* | tail -n "${DELETE_COUNT}" | xargs rm -f
  echo "[$(date -Iseconds)] Deleted ${DELETE_COUNT} old backup(s)."
else
  echo "[$(date -Iseconds)] No old backups to clean up (${BACKUP_COUNT} existing)."
fi

echo "[$(date -Iseconds)] Backup complete: $(basename "${BACKUP_PATH}")"
echo "  Size: $(du -h "${BACKUP_PATH}" | cut -f1)"
echo "  Location: ${BACKUP_PATH}"
