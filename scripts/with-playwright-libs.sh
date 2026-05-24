#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR%/scripts}"
LIB_DIR="${ROOT_DIR}/.playwright-libs/usr/lib/x86_64-linux-gnu"
TMP_DEB_DIR="${ROOT_DIR}/.playwright-libs/tmp-debs"
TMP_EXTRACT_DIR="${ROOT_DIR}/.playwright-libs/tmp-extract"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <playwright-command> [args...]"
  echo "Example: $0 npx playwright screenshot https://example.com /tmp/example.png"
  exit 1
fi

install_libs() {
  if [ -f "${LIB_DIR}/libnspr4.so" ] && [ -f "${LIB_DIR}/libnss3.so" ] && [ -f "${LIB_DIR}/libsmime3.so" ] && [ -f "${LIB_DIR}/libasound.so.2" ]; then
    return 0
  fi

  mkdir -p "$TMP_DEB_DIR" "$TMP_EXTRACT_DIR"
  rm -rf "${TMP_EXTRACT_DIR:?}"/*
  (
    cd "$TMP_DEB_DIR"
    apt-get download libnspr4 libnss3 libasound2t64 >/tmp/pw-apt-download.log 2>&1
  )
  for deb in "$TMP_DEB_DIR"/*.deb; do
    dpkg-deb -x "$deb" "$TMP_EXTRACT_DIR"
  done
  mkdir -p "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libfreebl*.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libnspr4.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libnss*.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libplc4.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libplds4.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libsmime3.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libsoftokn3.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libssl3.so* "$LIB_DIR"
  cp "${TMP_EXTRACT_DIR}/usr/lib/x86_64-linux-gnu"/libasound.so* "$LIB_DIR"
}

install_libs

export LD_LIBRARY_PATH="${LIB_DIR}:${LD_LIBRARY_PATH:-}"

if [[ "$*" == *"@playwright/mcp"* || "$*" == *"playwright-mcp"* ]]; then
  has_isolated=false
  has_headless=false
  for arg in "$@"; do
    if [ "$arg" = "--isolated" ]; then
      has_isolated=true
    fi
    if [ "$arg" = "--headless" ]; then
      has_headless=true
    fi
  done

  extra_args=()
  if [ "$has_isolated" = false ]; then
    extra_args+=("--isolated")
  fi
  if [ "$has_headless" = false ]; then
    extra_args+=("--headless")
  fi

  exec "$@" "${extra_args[@]}"
fi

exec "$@"
