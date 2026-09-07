#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "$ROOT_DIR/.tmp-e2e-XXXXXX")"
SERVER_PID=""
PORT="${E2E_PORT:-4179}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  echo "E2E_PORT must be a local unprivileged port (1024-65535)." >&2
  rmdir "$TEMP_DIR"
  exit 1
fi

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cd "$ROOT_DIR"
npm run build
(
  cd "$ROOT_DIR/server"
  exec env -u APP_ALLOWED_USER_IDS DOTENV_CONFIG_PATH=/dev/null NODE_ENV=development HOST=127.0.0.1 PORT="$PORT" \
    DATA_DIR="$TEMP_DIR" DB_FILE=app.sqlite EVIDENCE_DIR="$TEMP_DIR/evidence" \
    ACS_EMAIL_CONNECTION_STRING="" EMAIL_SENDER_ADDRESS="" \
    APP_PUBLIC_URL="http://127.0.0.1:$PORT/" MONITORING_STATE_DIR="" \
    node dist/index.js
) > "$TEMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

READY=false
for attempt in {1..100}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -40 "$TEMP_DIR/server.log" >&2
    exit 1
  fi
  # Only our own listening message proves this is the throwaway server, not a
  # different process that already occupied the requested port.
  if grep -Fq "[server] listening on http://127.0.0.1:$PORT " "$TEMP_DIR/server.log"; then
    READY=true
    break
  fi
  sleep 0.1
done
if [ "$READY" != true ]; then
  echo "Isolated E2E server did not become ready." >&2
  tail -40 "$TEMP_DIR/server.log" >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$PORT/api/health" >/dev/null
E2E_ISOLATED=1 E2E_BASE_URL="http://127.0.0.1:$PORT" npm run e2e --workspace client -- "$@"
