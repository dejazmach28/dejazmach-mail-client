#!/bin/sh
set -e

APP_DIR="/opt/DejAzmach"
SANDBOX_BIN="$APP_DIR/chrome-sandbox"

if [ -f "$SANDBOX_BIN" ]; then
  chown root:root "$SANDBOX_BIN"
  chmod 4755 "$SANDBOX_BIN"
fi

exit 0
