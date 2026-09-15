#!/usr/bin/env bash
# ==========================================================================
# LIBERTASIAN — .env reader (shared by db-backup.sh and db-restore.sh)
#
# Prod's /opt/libertasian/.env CANNOT be `source`d: it contains values such as
#   SMTP_FROM=LIBERTASIAN <noreply@libertasian.com>
# where the unquoted `<>` is shell redirection and kills the whole script. Cron
# jobs that tried `set -a; . .env` died here. So we never source it — we pull
# out only the handful of keys we need, one at a time, with grep/cut.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/env-file.sh"
#   ENV_FILE=/opt/libertasian/.env
#   env_file_load KEY_A KEY_B ...     # sets $KEY_A, $KEY_B as globals
#   env_file_require KEY_A KEY_B ...  # dies if any is empty
#
# Precedence: a key already non-empty in the process environment wins over the
# file, so an operator can override a single value for a one-off run without
# editing .env.
# ==========================================================================

# Trim surrounding whitespace, a trailing CR, and one layer of matching quotes.
env_file_trim() {
  local v="${1-}"
  v="${v%$'\r'}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  if (( ${#v} >= 2 )); then
    if [[ ${v:0:1} == '"' && ${v: -1} == '"' ]]; then
      v="${v:1:${#v}-2}"
    elif [[ ${v:0:1} == "'" && ${v: -1} == "'" ]]; then
      v="${v:1:${#v}-2}"
    fi
  fi
  printf '%s' "$v"
}

# Echo the raw value of KEY from FILE, or nothing if absent.
# First match wins, commented lines are ignored.
env_file_get() {
  local key="$1" file="$2" line
  [[ -f "$file" ]] || return 0
  line="$( { grep -m1 -E "^[[:space:]]*${key}=" -- "$file" || true; } | cut -d= -f2- )"
  env_file_trim "$line"
}

# Load each named key into a global of the same name.
# Reads from $ENV_FILE unless the variable is already set and non-empty.
env_file_load() {
  local key value
  for key in "$@"; do
    value="${!key-}"
    if [[ -z "$value" ]]; then
      value="$(env_file_get "$key" "${ENV_FILE:-}")"
    fi
    printf -v "$key" '%s' "$value"
  done
}

# Exit non-zero if any named key is empty. Never prints the value.
env_file_require() {
  local key missing=()
  for key in "$@"; do
    [[ -n "${!key-}" ]] || missing+=("$key")
  done
  if (( ${#missing[@]} > 0 )); then
    printf 'ERROR: missing required config in %s: %s\n' \
      "${ENV_FILE:-<unset>}" "${missing[*]}" >&2
    return 1
  fi
}
