#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/install-all.sh [--immutable]

Installs the root, server, and client Yarn projects with the `yarn install`
builtin. Yarn cannot run a package.json script until an install has created
its state file, so this is the entry point that works on a fresh checkout.

  --immutable   Refuse to change any lockfile (the CI and deploy form).
USAGE
}

case "${1:-}" in
  "") IMMUTABLE="" ;;
  --immutable) IMMUTABLE="--immutable" ;;
  -h | --help) usage; exit 0 ;;
  *) usage >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."

yarn install ${IMMUTABLE:+"$IMMUTABLE"}
yarn --cwd server install ${IMMUTABLE:+"$IMMUTABLE"}
yarn --cwd client install ${IMMUTABLE:+"$IMMUTABLE"}
