#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
APP_DIR="$ROOT_DIR/release/linux-unpacked"
VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
OUTPUT_DEB="$ROOT_DIR/release/DejAzmach-$VERSION-linux-amd64.deb"
STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/dejazmach-deb.XXXXXX")
PKG_DIR="$STAGE_DIR/pkg"

cleanup() {
  rm -rf "$STAGE_DIR"
}

trap cleanup EXIT INT TERM

if [ ! -d "$APP_DIR" ]; then
  echo "Missing Linux app payload at $APP_DIR" >&2
  exit 1
fi

mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/opt/DejAzmach"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/256x256/apps"

cp -a "$APP_DIR/." "$PKG_DIR/opt/DejAzmach/"
cp "$ROOT_DIR/build/linux/launcher.sh" "$PKG_DIR/opt/DejAzmach/dejazmach-mail-client-launcher"
cp "$ROOT_DIR/build/linux/postinst.sh" "$PKG_DIR/DEBIAN/postinst"
cp "$ROOT_DIR/build/linux/postrm.sh" "$PKG_DIR/DEBIAN/postrm"
chmod 755 "$PKG_DIR/DEBIAN/postinst" "$PKG_DIR/DEBIAN/postrm" "$PKG_DIR/opt/DejAzmach/dejazmach-mail-client-launcher"

cat > "$PKG_DIR/DEBIAN/control" <<EOF
Package: dejazmach-mail-client
Version: $VERSION
Section: net
Priority: optional
Architecture: amd64
Maintainer: DejAzmach <hello@dejazmach.app>
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0
Recommends: libappindicator3-1
Homepage: https://dejazmach.app
Description: DejAzmach desktop mail client with a transparent, security-first UI.
EOF

cat > "$PKG_DIR/usr/share/applications/dejazmach-mail-client.desktop" <<'EOF'
[Desktop Entry]
Name=DejAzmach
Comment=Secure desktop mail client
Exec=/opt/DejAzmach/dejazmach-mail-client-launcher
Icon=dejazmach-mail-client
Terminal=false
Type=Application
Categories=Network;Email;
StartupWMClass=DejAzmach
EOF

cp \
  "$ROOT_DIR/assets/icons/256x256.png" \
  "$PKG_DIR/usr/share/icons/hicolor/256x256/apps/dejazmach-mail-client.png"

rm -f "$OUTPUT_DEB"
dpkg-deb --build --root-owner-group "$PKG_DIR" "$OUTPUT_DEB"
echo "$OUTPUT_DEB"
