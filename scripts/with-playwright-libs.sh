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

libs_present() {
  [ -f "${LIB_DIR}/libnspr4.so" ] && [ -f "${LIB_DIR}/libnss3.so" ] && [ -f "${LIB_DIR}/libsmime3.so" ] && [ -f "${LIB_DIR}/libasound.so.2" ]
}

install_libs() {
  if libs_present; then
    return 0
  fi

  if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
    echo "with-playwright-libs: apt-get and dpkg-deb are required to fetch Playwright's shared libraries on this Linux host." >&2
    echo "Install them, or install Playwright's system dependencies with: npx playwright install --with-deps chromium" >&2
    exit 1
  fi

  local apt_log="${ROOT_DIR}/.playwright-libs/apt-download.log"
  mkdir -p "$TMP_DEB_DIR" "$TMP_EXTRACT_DIR"
  rm -rf "${TMP_EXTRACT_DIR:?}"/*
  if ! (cd "$TMP_DEB_DIR" && apt-get download libnspr4 libnss3 libasound2t64 >"$apt_log" 2>&1); then
    echo "with-playwright-libs: apt-get download failed:" >&2
    cat "$apt_log" >&2
    exit 1
  fi
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

if [ "$(uname -s)" = "Linux" ]; then
  install_libs
  export LD_LIBRARY_PATH="${LIB_DIR}:${LD_LIBRARY_PATH:-}"
fi

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
