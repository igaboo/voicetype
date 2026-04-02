#!/bin/bash
# Build the native overlay sidecar for macOS and place it where Tauri expects.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"
mkdir -p "$BINARIES_DIR"

# Detect target triple
ARCH=$(uname -m)
case "$ARCH" in
    arm64)  TRIPLE="aarch64-apple-darwin" ;;
    x86_64) TRIPLE="x86_64-apple-darwin" ;;
    *)      echo "Unknown arch: $ARCH"; exit 1 ;;
esac

echo "Building sidecar overlay for $TRIPLE..."
cd "$SCRIPT_DIR"
swift build -c release 2>&1

# Copy binary to Tauri binaries dir with target triple suffix
cp ".build/release/yap-overlay" "$BINARIES_DIR/yap-overlay-$TRIPLE"

# Ad-hoc codesign for local dev (Tauri's bundler handles signing for distribution)
codesign --force --sign - "$BINARIES_DIR/yap-overlay-$TRIPLE" 2>/dev/null || true

echo "Sidecar built: $BINARIES_DIR/yap-overlay-$TRIPLE"
