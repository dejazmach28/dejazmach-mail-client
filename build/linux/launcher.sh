#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
APP_BIN="$APP_DIR/dejazmach-mail-client"
SANDBOX_BIN="$APP_DIR/chrome-sandbox"

unset ELECTRON_RUN_AS_NODE || true

if [ -f "$SANDBOX_BIN" ]; then
  SANDBOX_OWNER=$(stat -c '%u' "$SANDBOX_BIN" 2>/dev/null || echo "")
  SANDBOX_MODE=$(stat -c '%a' "$SANDBOX_BIN" 2>/dev/null || echo "")

  if [ "$SANDBOX_OWNER" = "0" ] && [ "$SANDBOX_MODE" = "4755" ]; then
    exec "$APP_BIN" "$@"
  fi
fi

exec "$APP_BIN" --disable-setuid-sandbox "$@"
