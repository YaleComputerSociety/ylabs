#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install-gh-identifier-guard.sh [guard-checkout]

  [guard-checkout]  Checkout whose scripts/gh-identifier-guard.mjs the shim runs.
                    Default: the primary checkout of this repository.

Environment:
  GH_GUARD_BIN_DIR  Directory the gh shim is written to. Default: ~/.local/bin.

Writes a gh shim that runs every gh call through the person identifier guard, so
a body that names a person is refused before GitHub ever stores it. Idempotent.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ -n "${1:-}" ]; then
  CHECKOUT="$(cd "$1" && pwd)"
else
  COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
  CHECKOUT="$(dirname "$COMMON_DIR")"
fi

GUARD="${CHECKOUT}/scripts/gh-identifier-guard.mjs"
BIN_DIR="${GH_GUARD_BIN_DIR:-$HOME/.local/bin}"
SHIM="${BIN_DIR}/gh"

if [ ! -f "$GUARD" ]; then
  echo "gh guard: ${GUARD} does not exist; nothing installed." >&2
  exit 1
fi

SHIM_CONTENT="#!/bin/sh
GH_IDENTIFIER_GUARD_SHIM=\"\$0\" exec node \"${GUARD}\" \"\$@\""

mkdir -p "$BIN_DIR"
if [ -f "$SHIM" ] && [ "$(cat "$SHIM")" = "$SHIM_CONTENT" ]; then
  echo "gh guard: ${SHIM} is already current."
else
  if [ -e "$SHIM" ] && ! grep -q 'gh-identifier-guard' "$SHIM" 2>/dev/null; then
    cp "$SHIM" "${SHIM}.pre-identifier-guard"
    echo "gh guard: kept the previous ${SHIM} as ${SHIM}.pre-identifier-guard"
  fi
  printf '%s\n' "$SHIM_CONTENT" > "$SHIM"
  chmod +x "$SHIM"
  echo "gh guard: installed ${SHIM} -> ${GUARD}"
fi

FIRST_GH="$(command -v gh || true)"
if [ "$FIRST_GH" != "$SHIM" ]; then
  echo "gh guard: WARNING ${BIN_DIR} is not ahead of ${FIRST_GH:-the real gh} on PATH, so gh calls bypass the guard." >&2
fi
