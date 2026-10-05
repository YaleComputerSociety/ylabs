#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install-gh-identifier-guard.sh [guard-checkout]

  [guard-checkout]  Checkout the guard scripts are copied from.
                    Default: the primary checkout of this repository.

Environment:
  GH_GUARD_BIN_DIR  Directory the gh shim is written to. Default: ~/.local/bin.
  GH_GUARD_HOME     Directory the guard is copied to, so the shim keeps working
                    when the checkout moves. Default: ~/.local/share/ylabs-gh-guard.

Copies the guard into GH_GUARD_HOME and writes a gh shim that runs every gh call
through it, so a body that names a person is refused before GitHub ever stores it.
Fails when the shim is not the first gh on PATH. Idempotent; re-run to refresh.
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

GUARD_FILES="gh-identifier-guard.mjs gh-identifier-guard-core.mjs check-no-person-identifiers.mjs check-no-person-identifiers-core.mjs"
CHECKOUT_GUARD="${CHECKOUT}/scripts/gh-identifier-guard.mjs"
GUARD_HOME="${GH_GUARD_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/ylabs-gh-guard}"
GUARD="${GUARD_HOME}/gh-identifier-guard.mjs"
BIN_DIR="${GH_GUARD_BIN_DIR:-$HOME/.local/bin}"
SHIM="${BIN_DIR}/gh"

for file in $GUARD_FILES; do
  if [ ! -f "${CHECKOUT}/scripts/${file}" ]; then
    echo "gh guard: ${CHECKOUT}/scripts/${file} does not exist; nothing installed." >&2
    exit 1
  fi
done

if [ -e "$SHIM" ] && ! grep -q 'gh-identifier-guard' "$SHIM" 2>/dev/null; then
  echo "gh guard: ${SHIM} is not a guard shim, so it was left untouched and nothing was installed." >&2
  echo "gh guard: set GH_GUARD_BIN_DIR to a directory ahead of the real gh on PATH and re-run." >&2
  exit 1
fi

mkdir -p "$GUARD_HOME"
for file in $GUARD_FILES; do
  cp "${CHECKOUT}/scripts/${file}" "${GUARD_HOME}/${file}.tmp"
  mv "${GUARD_HOME}/${file}.tmp" "${GUARD_HOME}/${file}"
done
echo "gh guard: copied the guard into ${GUARD_HOME} from ${CHECKOUT}"

SHIM_CONTENT="#!/bin/sh
for guard in \"${GUARD}\" \"${CHECKOUT_GUARD}\"; do
  if [ -f \"\$guard\" ]; then
    GH_IDENTIFIER_GUARD_SHIM=\"\$0\" exec node \"\$guard\" \"\$@\"
  fi
done
echo \"gh guard: ${GUARD} and ${CHECKOUT_GUARD} are both missing; re-run scripts/install-gh-identifier-guard.sh\" >&2
case \"\$1 \$2\" in
  api\\ *|'pr create'|'pr edit'|'pr comment'|'pr review'|'pr merge'|'pr close'|'pr reopen'|'issue create'|'issue edit'|'issue comment'|'issue close'|'issue reopen')
    echo \"gh guard: NOT run, because nothing can scan what it would post.\" >&2
    exit 1
    ;;
esac
self=\"\$(cd \"\$(dirname \"\$0\")\" && pwd -P)/\$(basename \"\$0\")\"
IFS=:
for dir in \$PATH; do
  if [ -x \"\$dir/gh\" ] && [ ! \"\$dir/gh\" -ef \"\$self\" ]; then
    unset IFS
    exec \"\$dir/gh\" \"\$@\"
  fi
done
echo \"gh guard: could not find the real gh binary on PATH\" >&2
exit 127"

mkdir -p "$BIN_DIR"
if [ -f "$SHIM" ] && [ "$(cat "$SHIM")" = "$SHIM_CONTENT" ]; then
  echo "gh guard: ${SHIM} is already current."
else
  printf '%s\n' "$SHIM_CONTENT" > "$SHIM"
  chmod +x "$SHIM"
  echo "gh guard: installed ${SHIM} -> ${GUARD}"
fi

FIRST_GH="$(command -v gh || true)"
if [ -z "$FIRST_GH" ] || [ ! "$FIRST_GH" -ef "$SHIM" ]; then
  echo "gh guard: ERROR ${BIN_DIR} is not ahead of ${FIRST_GH:-the real gh} on PATH, so gh calls would bypass the guard." >&2
  echo "gh guard: put ${BIN_DIR} first on PATH, for example in ~/.zshrc: export PATH=\"${BIN_DIR}:\$PATH\"" >&2
  exit 1
fi
