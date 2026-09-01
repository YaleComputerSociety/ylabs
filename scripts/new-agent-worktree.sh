#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/new-agent-worktree.sh <branch-name> [base-branch]

  <branch-name>   New branch to create (e.g. feat/filter-sidebar).
  [base-branch]   Base to branch from. Default: beta.

Environment:
  YLABS_WORKTREE_ROOT   Directory to hold worktrees. Default: /tmp/ylabs-worktrees.
  SKIP_INSTALL=1        Skip dependency install (resolve deps manually).

Creates an isolated git worktree and branch for parallel agent work, installs
dependencies, and reserves a free client dev-server port so multiple agents can
run and test independently without ever switching branches in the primary
checkout.

Example:
  scripts/new-agent-worktree.sh feat/entity-badges
EOF
}

if [ "$#" -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 1
fi

BRANCH="$1"
BASE="${2:-beta}"
WORKTREE_ROOT="${YLABS_WORKTREE_ROOT:-/tmp/ylabs-worktrees}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
SLUG="$(printf '%s' "$BRANCH" | tr '/ ' '--')"
WORKTREE_DIR="${WORKTREE_ROOT}/${SLUG}"

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  echo "Branch '${BRANCH}' already exists. Choose a new name or check it out." >&2
  exit 1
fi

if [ -e "$WORKTREE_DIR" ]; then
  echo "Worktree path already exists: ${WORKTREE_DIR}" >&2
  exit 1
fi

git -C "$REPO_ROOT" fetch origin --quiet || true

BASE_REF="$BASE"
if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/origin/${BASE}"; then
  BASE_REF="origin/${BASE}"
fi

mkdir -p "$WORKTREE_ROOT"
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_DIR" "$BASE_REF"

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  (cd "$WORKTREE_DIR" && yarn)
  (cd "$WORKTREE_DIR/server" && yarn)
  (cd "$WORKTREE_DIR/client" && yarn)
fi

find_free_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    while lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
      port=$((port + 1))
    done
  fi
  printf '%s' "$port"
}

WORKTREE_COUNT="$(git -C "$REPO_ROOT" worktree list --porcelain | grep -c '^worktree ')"
PORT="$(find_free_port "$((3000 + WORKTREE_COUNT))")"

cat <<EOF

Worktree ready.
  branch:    ${BRANCH}
  base:      ${BASE_REF}
  path:      ${WORKTREE_DIR}
  dev port:  ${PORT}

Start the client dev server (isolated to this worktree):
  (cd "${WORKTREE_DIR}/client" && yarn dev --port ${PORT})

When the branch is merged, remove the worktree from the primary checkout:
  git worktree remove "${WORKTREE_DIR}"
EOF
