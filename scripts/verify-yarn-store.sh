#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/verify-yarn-store.sh [store-dir]

Worktrees hardlink their node_modules files from Yarn's shared store, so a write
into one of those files changes it for every worktree. Store files are named by
the SHA-1 of their content; this checks every one still matches and exits 1 on
the first sign of an in-place write.

  store-dir   Default: <yarn globalFolder>/store/v1 (~/.yarn/berry/store/v1).
USAGE
}

case "${1:-}" in
  -h | --help) usage; exit 0 ;;
esac

STORE="${1:-$HOME/.yarn/berry/store/v1}"
if [ ! -d "$STORE" ]; then
  echo "No Yarn store at ${STORE}; nothing is hardlinked yet." >&2
  exit 0
fi

find "$STORE" -type f -name '*.dat' -print0 \
  | xargs -0 -n 500 -P 8 shasum -a 1 \
  | awk '
      {
        depth = split($2, parts, "/")
        name = parts[depth - 1] parts[depth]
        sub(/\.dat$/, "", name)
        total++
        if (name != $1) { mismatched++; print "MISMATCH " $2 }
      }
      END {
        printf "checked=%d mismatched=%d\n", total, mismatched + 0
        exit (mismatched > 0)
      }'
