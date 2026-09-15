#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — Encrypted off-site database backup
#
# Dumps the production PostgreSQL database straight into openssl (no plaintext
# dump ever touches disk), then uploads the encrypted artifact to the off-site
# Cloudflare R2 bucket and PROVES the upload landed before reporting success.
#
# Usage:
#   ./db-backup.sh                      # dump, encrypt, upload, verify, prune
#   ./db-backup.sh --verify-latest      # download newest daily/ object and
#                                       # prove it is a restorable archive
#   ./db-backup.sh --env-file PATH      # read config from PATH
#   ./db-backup.sh --help
#
# Install the schedule with infrastructure/cron/libertasian-db-backup.
#
# Config comes from /opt/libertasian/.env (override with ENV_FILE or
# --env-file). The file is NOT sourced — see lib/env-file.sh for why.
#
#   Required: BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY
#             BACKUP_S3_SECRET_KEY BACKUP_ENCRYPTION_KEY
#             POSTGRES_USER POSTGRES_DB
#   Optional: BACKUP_S3_REGION            (default: auto — what R2 wants)
#             BACKUP_EXCLUDE_TABLE_DATA   (comma-separated; default: full dump)
#             BACKUP_HEALTHCHECK_URL      (default: no pings)
#             POSTGRES_CONTAINER          (default: libertasian-postgres)
#
# The R2 bucket carries a 7-day object lock plus lifecycle rules, so remote
# retention is enforced server-side: daily/ expires after 8 days, weekly/ after
# 35, monthly/ after 100. Nothing here deletes a remote object — it cannot.
# ==========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/env-file.sh
source "${SCRIPT_DIR}/lib/env-file.sh"

# ── Fixed configuration ──
ENV_FILE="${ENV_FILE:-/opt/libertasian/.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/libertasian/backups}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.27.0}"
# Local disk is a convenience cache only; R2 is the backup of record.
KEEP_LOCAL=2
# Only files matching this are ever deleted by the pruner. Everything else in
# BACKUP_DIR (billing-pre-provider-rename-*.sql, user-deletes/, ...) is
# somebody's hand-made artifact and must survive.
PRUNE_GLOB='*.dump.enc'

MODE="backup"
TMP_DIR=""
PARTIAL_FILE=""
HEALTHCHECK_ARMED=0

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { log "WARN: $*" >&2; }
die() { log "ERROR: $*" >&2; exit 1; }

usage() {
  sed -n '3,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ── Healthcheck pings (never fatal, never block the backup) ──
hc_ping() {
  local suffix="${1-}"
  [[ -n "${BACKUP_HEALTHCHECK_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 2 -o /dev/null "${BACKUP_HEALTHCHECK_URL%/}${suffix}" \
    || warn "healthcheck ping '${suffix:-/}' failed (ignored)"
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [[ -n "$PARTIAL_FILE" && -f "$PARTIAL_FILE" ]]; then
    rm -f -- "$PARTIAL_FILE"
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
  if (( HEALTHCHECK_ARMED )); then
    if (( rc == 0 )); then hc_ping ""; else hc_ping "/fail"; fi
  fi
  exit "$rc"
}

# ── Argument parsing ──
while (( $# > 0 )); do
  case "$1" in
    --verify-latest) MODE="verify-latest"; shift ;;
    --env-file) ENV_FILE="${2:?--env-file needs a path}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ── Load config (never sourced; see lib/env-file.sh) ──
env_file_load \
  BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY \
  BACKUP_ENCRYPTION_KEY BACKUP_S3_REGION BACKUP_EXCLUDE_TABLE_DATA \
  BACKUP_HEALTHCHECK_URL POSTGRES_USER POSTGRES_DB POSTGRES_CONTAINER

env_file_require \
  BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY \
  BACKUP_ENCRYPTION_KEY POSTGRES_USER POSTGRES_DB

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-libertasian-postgres}"

# Credentials reach the aws-cli container as environment NAMES only
# (`docker run -e VAR`), so they never appear in any process's argv.
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}"
# R2 rejects the CRC32 trailers the v2 CLI adds by default.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

# aws_cli <extra docker opts...> -- <aws args...>
aws_cli() {
  local -a dockeropts=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do
    dockeropts+=("$1")
    shift
  done
  shift || true
  docker run --rm \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    -e AWS_REQUEST_CHECKSUM_CALCULATION -e AWS_RESPONSE_CHECKSUM_VALIDATION \
    ${dockeropts[@]+"${dockeropts[@]}"} \
    "$AWS_CLI_IMAGE" "$@"
}

file_size() { stat -c '%s' -- "$1"; }

# ── Single-instance lock ──
mkdir -p -- "$BACKUP_DIR"
LOCK_FILE="${BACKUP_LOCK_FILE:-${BACKUP_DIR}/.db-backup.lock}"
exec 9>"$LOCK_FILE" || die "cannot open lock file ${LOCK_FILE}"
flock -n 9 || die "another db-backup.sh run holds ${LOCK_FILE}; giving up"

trap on_exit EXIT

# ==========================================================================
# Mode: --verify-latest
# ==========================================================================
verify_latest() {
  log "Locating newest object under daily/ in s3://${BACKUP_S3_BUCKET} ..."
  local key
  key="$(aws_cli -- s3api list-objects-v2 \
    --endpoint-url "$BACKUP_S3_ENDPOINT" \
    --bucket "$BACKUP_S3_BUCKET" \
    --prefix 'daily/' \
    --query 'sort_by(Contents,&LastModified)[-1].Key' \
    --output text)" || die "list-objects-v2 failed"
  key="${key%$'\r'}"
  [[ -n "$key" && "$key" != "None" ]] || die "no objects found under daily/"
  log "Newest daily object: ${key}"

  TMP_DIR="$(mktemp -d)"
  local enc="${TMP_DIR}/latest.dump.enc"
  local dump="${TMP_DIR}/latest.dump"

  log "Downloading ${key} ..."
  aws_cli -v "${TMP_DIR}:/out" -- s3 cp \
    "s3://${BACKUP_S3_BUCKET}/${key}" /out/latest.dump.enc \
    --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors \
    || die "download of ${key} failed"
  [[ -f "$enc" ]] || die "download produced no file"
  log "Downloaded $(file_size "$enc") bytes."

  log "Decrypting ..."
  BACKUP_PASSPHRASE="$BACKUP_ENCRYPTION_KEY" \
    openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 100000 \
      -pass env:BACKUP_PASSPHRASE -in "$enc" -out "$dump" \
    || die "decryption failed — wrong BACKUP_ENCRYPTION_KEY or corrupt object"

  log "Listing archive contents with pg_restore --list ..."
  local listing items
  listing="$(docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$dump")" \
    || die "pg_restore --list rejected the archive"
  items="$(printf '%s\n' "$listing" | grep -cve '^;' -e '^[[:space:]]*$' || true)"
  (( items > 0 )) || die "archive lists 0 items"

  log "Verified: ${key} decrypts and lists ${items} items."
  printf 'verify-latest items: %s\n' "$items"
}

# ==========================================================================
# Mode: backup
# ==========================================================================
run_backup() {
  hc_ping "/start"
  HEALTHCHECK_ARMED=1

  local stamp base final
  stamp="$(date +%Y%m%d-%H%M%S)"
  base="libertasian-${stamp}.dump.enc"
  final="${BACKUP_DIR}/${base}"
  # Written under a name the pruner's glob cannot match, so a half-finished
  # artifact is never mistaken for a backup.
  PARTIAL_FILE="${final}.partial"

  # --exclude-table-data=... per entry in BACKUP_EXCLUDE_TABLE_DATA.
  local -a excludes=()
  if [[ -n "${BACKUP_EXCLUDE_TABLE_DATA:-}" ]]; then
    local -a wanted=()
    local table
    IFS=',' read -r -a wanted <<< "$BACKUP_EXCLUDE_TABLE_DATA"
    for table in ${wanted[@]+"${wanted[@]}"}; do
      table="$(env_file_trim "$table")"
      [[ -n "$table" ]] || continue
      excludes+=("--exclude-table-data=${table}")
      log "Excluding table data: ${table}"
    done
  fi

  TMP_DIR="$(mktemp -d)"
  local dump_err="${TMP_DIR}/pg_dump.stderr"

  log "Dumping database '${POSTGRES_DB}' from container '${POSTGRES_CONTAINER}' straight into openssl ..."
  # pg_dump stdout streams into openssl, so no plaintext dump is ever written.
  # pipefail makes a pg_dump failure fail the whole pipeline.
  if ! docker exec "$POSTGRES_CONTAINER" pg_dump \
        -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        --format=custom --no-owner --no-privileges \
        ${excludes[@]+"${excludes[@]}"} 2>"$dump_err" \
      | BACKUP_PASSPHRASE="$BACKUP_ENCRYPTION_KEY" \
        openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
          -pass env:BACKUP_PASSPHRASE -out "$PARTIAL_FILE"; then
    log_dump_stderr "$dump_err"
    die "dump/encrypt pipeline failed"
  fi
  log_dump_stderr "$dump_err"
  [[ -s "$PARTIAL_FILE" ]] || die "encrypted dump is empty"

  mv -- "$PARTIAL_FILE" "$final"
  PARTIAL_FILE=""
  local size
  size="$(file_size "$final")"
  log "Encrypted dump ready: ${base} (${size} bytes)"

  # ── Upload ──
  # Object lock forbids overwriting or server-side-copying a locked object, so
  # weekly/ and monthly/ are uploaded as their own objects, not copied.
  local -a keys=("daily/${base}")
  if [[ "$(date -d "${stamp:0:8}" +%u)" == "7" ]]; then
    keys+=("weekly/${base}")
  fi
  if [[ "${stamp:6:2}" == "01" ]]; then
    keys+=("monthly/${base}")
  fi

  local key
  for key in "${keys[@]}"; do
    log "Uploading s3://${BACKUP_S3_BUCKET}/${key} ..."
    aws_cli -v "${final}:/backup/${base}:ro" -- s3 cp \
      "/backup/${base}" "s3://${BACKUP_S3_BUCKET}/${key}" \
      --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors \
      || die "upload of ${key} failed"
    verify_remote "$key" "$size"
  done

  log "Upload complete."
  prune_local
  log "Backup complete: ${base}"
}

# pg_dump's stderr belongs in the log, not /dev/null — it is the only place a
# permission error or a broken extension ever shows up.
log_dump_stderr() {
  local errfile="$1"
  [[ -s "$errfile" ]] || return 0
  log "pg_dump stderr:"
  sed 's/^/  | /' "$errfile"
}

# Prove the object is really there and is really the size we sent.
verify_remote() {
  local key="$1" expected="$2" actual
  actual="$(aws_cli -- s3api head-object \
    --endpoint-url "$BACKUP_S3_ENDPOINT" \
    --bucket "$BACKUP_S3_BUCKET" \
    --key "$key" \
    --query 'ContentLength' --output text 2>&1)" \
    || die "head-object failed for ${key}: ${actual}"
  actual="${actual%$'\r'}"
  [[ "$actual" =~ ^[0-9]+$ ]] \
    || die "head-object returned no ContentLength for ${key}: ${actual}"
  (( actual == expected )) \
    || die "size mismatch for ${key}: remote ${actual} bytes, local ${expected} bytes"
  log "Verified s3://${BACKUP_S3_BUCKET}/${key} — ${actual} bytes."
}

# Keep the newest KEEP_LOCAL *.dump.enc files. Touch nothing else, ever.
prune_local() {
  local -a found=()
  mapfile -t found < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "$PRUNE_GLOB" \
      -printf '%T@\t%p\n' | sort -rn | cut -f2-
  )
  local total=${#found[@]}
  if (( total <= KEEP_LOCAL )); then
    log "Local retention: ${total} backup(s) on disk, keeping ${KEEP_LOCAL}; nothing to prune."
    return 0
  fi
  local i
  for (( i = KEEP_LOCAL; i < total; i++ )); do
    log "Pruning local backup: $(basename -- "${found[i]}")"
    rm -f -- "${found[i]}"
  done
  log "Local retention: pruned $(( total - KEEP_LOCAL )), kept ${KEEP_LOCAL}."
}

case "$MODE" in
  verify-latest) verify_latest ;;
  backup) run_backup ;;
  *) die "unreachable mode ${MODE}" ;;
esac
