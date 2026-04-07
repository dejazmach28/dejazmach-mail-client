#!/bin/sh
set -e

APP_DIR="/opt/DejAzmach"
SANDBOX_BIN="$APP_DIR/chrome-sandbox"
APP_BIN="$APP_DIR/dejazmach-mail-client"
LAUNCHER_BIN="$APP_DIR/dejazmach-mail-client-launcher"
LINK_BIN_LOCAL="/usr/local/bin/dejazmach-mail-client"
LINK_BIN_SYSTEM="/usr/bin/dejazmach-mail-client"

if [ -f "$SANDBOX_BIN" ]; then
  chown root:root "$SANDBOX_BIN"
  chmod 4755 "$SANDBOX_BIN"
fi

if [ -f "$LAUNCHER_BIN" ]; then
  ln -sf "$LAUNCHER_BIN" "$LINK_BIN_LOCAL"
  ln -sf "$LAUNCHER_BIN" "$LINK_BIN_SYSTEM"
elif [ -f "$APP_BIN" ]; then
  ln -sf "$APP_BIN" "$LINK_BIN_LOCAL"
  ln -sf "$APP_BIN" "$LINK_BIN_SYSTEM"
fi

exit 0
