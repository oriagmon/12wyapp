#!/usr/bin/env bash
# WAL-consistent database and exact-snapshot evidence backup.
# Usage: backup.sh [data-dir] [backup-dir] [evidence-dir]
# Linux root coordinator; source must belong to an unprivileged account.
set -euo pipefail
umask 0027

if [ "$#" -gt 3 ]; then
  printf '%s\n' 'Usage: backup.sh [data-dir] [backup-dir] [evidence-dir]' >&2
  exit 1
fi
SCRIPT_PARENT="${BASH_SOURCE[0]%/*}"
if [ "$SCRIPT_PARENT" = "${BASH_SOURCE[0]}" ]; then SCRIPT_PARENT=.; fi
SCRIPT_DIR="$(CDPATH= cd -P -- "$SCRIPT_PARENT" && pwd)"
ROOT_DIR="$(CDPATH= cd -P -- "$SCRIPT_DIR/.." && pwd)"
DATA_DIRECTORY="${1:-${DATA_DIR:-$ROOT_DIR/data}}"
BACKUP_DIRECTORY="${2:-$ROOT_DIR/backups}"
EVIDENCE_DIRECTORY="${3:-${EVIDENCE_DIR:-$DATA_DIRECTORY/evidence}}"

# No shell SQL, PATH-selected tools, application environment or raw-copy fallback.
exec /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /usr/bin/python3 -I -S \
  "$SCRIPT_DIR/backup_producer.py" "$DATA_DIRECTORY" "$BACKUP_DIRECTORY" \
  "$EVIDENCE_DIRECTORY" "${DB_FILE:-app.sqlite}"
