#!/usr/bin/env bash
# Usage: backup-with-monitoring.sh <data-dir> <backup-dir> <evidence-dir> <monitoring-state-dir>
# All directories must be explicit absolute paths. No application .env is sourced.
set -euo pipefail
umask 0027

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ "$#" -ne 4 ]; then
  fail 'Usage: backup-with-monitoring.sh <data-dir> <backup-dir> <evidence-dir> <monitoring-state-dir>'
fi

for directory in "$@"; do
  case "$directory" in
    /*) ;;
    *) fail 'All four backup directories must be explicit absolute paths.' ;;
  esac
  # backup.sh passes its destination to SQLite's quoted .backup command.
  case "$directory" in
    *"'"*|*$'\n'*|*$'\r'*) fail 'Backup directory paths must not contain apostrophes or line breaks.' ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIRECTORY="$1"
BACKUP_DIRECTORY="$2"
EVIDENCE_DIRECTORY="$3"
STATE_DIRECTORY="$4"
NODE_BINARY="${MONITORING_NODE_BIN:-/snap/node/current/bin/node}"
DB_FILENAME="${DB_FILE:-app.sqlite}"
COMMAND_PATH="${PATH:-/usr/bin:/bin}"
PROBE_CLI="$ROOT_DIR/server/dist/monitoringProbe.js"
CLOUD_CLI="$ROOT_DIR/server/dist/cloudBackup.js"
CLOUD_ENABLED="${AZURE_BACKUP_ENABLED:-false}"
case "$CLOUD_ENABLED" in
  true|false) ;;
  *) fail 'AZURE_BACKUP_ENABLED must be true or false.' ;;
esac

case "$NODE_BINARY" in
  /*) ;;
  *) fail 'MONITORING_NODE_BIN must be an absolute executable path.' ;;
esac
case "$DB_FILENAME" in
  ''|.|..|*[!a-zA-Z0-9._-]*) fail 'DB_FILE must be a simple database basename.' ;;
esac
[ -x "$NODE_BINARY" ] || fail 'The configured Node executable is unavailable.'
[ -f "$SCRIPT_DIR/backup.sh" ] || fail 'The fixed backup script is unavailable.'
[ -f "$PROBE_CLI" ] || fail 'The monitoring CLI is not built; build the server before running this wrapper.'
[ -d "$DATA_DIRECTORY" ] || fail 'The explicit data directory is unavailable.'
[ -d "$STATE_DIRECTORY" ] && [ ! -L "$STATE_DIRECTORY" ] || fail 'The monitoring state directory must already exist and must not be a symlink.'

DESTINATION_DIRECTORY="$BACKUP_DIRECTORY"
if [ "$CLOUD_ENABLED" = true ]; then
  [ -f "$CLOUD_CLI" ] || fail 'The optional cloud backup CLI is not built.'
  [ -n "${AZURE_BACKUP_ACCOUNT:-}" ] && [ -n "${AZURE_BACKUP_CONTAINER:-}" ] || fail 'Cloud backup account and container configuration are required.'
  mkdir -p "$BACKUP_DIRECTORY"
  DESTINATION_DIRECTORY="$BACKUP_DIRECTORY/cloud-run-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir "$DESTINATION_DIRECTORY" || fail 'Could not create an isolated cloud backup snapshot directory.'
fi

# Keep credentials and runtime hooks out of both subprocess environments.
if /usr/bin/env -i PATH="$COMMAND_PATH" DB_FILE="$DB_FILENAME" /bin/bash "$SCRIPT_DIR/backup.sh" \
  "$DATA_DIRECTORY" "$DESTINATION_DIRECTORY" "$EVIDENCE_DIRECTORY"; then
  :
else
  result=$?
  printf '%s\n' 'Backup failed or is incomplete; the monitoring success receipt was not changed.' >&2
  exit "$result"
fi

if [ "$CLOUD_ENABLED" = true ]; then
  if /usr/bin/env -i PATH="$COMMAND_PATH" MONITORING_STATE_DIR="$STATE_DIRECTORY" \
    AZURE_BACKUP_ENABLED=true AZURE_BACKUP_SOURCE_ROOT="$BACKUP_DIRECTORY" \
    AZURE_BACKUP_ACCOUNT="$AZURE_BACKUP_ACCOUNT" AZURE_BACKUP_CONTAINER="$AZURE_BACKUP_CONTAINER" \
    AZURE_BACKUP_MAX_BYTES="${AZURE_BACKUP_MAX_BYTES:-}" \
    AZURE_BACKUP_MANAGED_IDENTITY_CLIENT_ID="${AZURE_BACKUP_MANAGED_IDENTITY_CLIENT_ID:-}" \
    "$NODE_BINARY" "$CLOUD_CLI" --upload-complete-snapshot "$DESTINATION_DIRECTORY"; then
    :
  else
    result=$?
    printf '%s\n' 'Cloud backup pipeline failed; the local success receipt was not advanced. Complete local snapshot retained.' >&2
    exit "$result"
  fi
fi

if /usr/bin/env -i PATH="$COMMAND_PATH" MONITORING_STATE_DIR="$STATE_DIRECTORY" MONITORING_FILE_BACKUP_ENABLED=true \
  "$NODE_BINARY" "$PROBE_CLI" --record-file-backup-success; then
  printf '%s\n' 'Complete database/evidence backup succeeded; monitoring receipt published.'
else
  result=$?
  printf '%s\n' 'Backup completed, but receipt publication failed; monitoring freshness may be out of date.' >&2
  exit "$result"
fi
