#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/new-agent-worktree.sh <branch-name> [base-branch]

  <branch-name>   New branch to create (e.g. feat/filter-sidebar).
  [base-branch]   Base to branch from. Default: beta.

Environment:
  YLABS_WORKTREE_ROOT   Directory to hold worktrees.
                        Default: <parent of the repo>/ylabs-worktrees.
  SKIP_INSTALL=1        Skip dependency install (resolve deps manually).

Creates an isolated git worktree and branch for parallel agent work, installs
dependencies and the gh identifier guard, reserves a free client dev-server port
and a free API port, and copies server/.env and client/.env from the primary
checkout (mode 0600, never printed) with those ports written in, so multiple
agents can run and test independently without ever switching branches in the
primary checkout.

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
REPO_ROOT="$(git rev-parse --show-toplevel)"
PRIMARY_ROOT="$(dirname "$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)")"
# Not /tmp: the repository's script write guards resolve their allowed output root from
# os.tmpdir(), so a worktree living under /tmp makes artifact-path test files fail on a
# clean checkout. Keep worktrees beside the primary checkout instead.
WORKTREE_ROOT="${YLABS_WORKTREE_ROOT:-$(dirname "$REPO_ROOT")/ylabs-worktrees}"
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

(cd "$REPO_ROOT" && scripts/install-gh-identifier-guard.sh) ||
  echo "WARNING: the gh identifier guard is not installed, so gh bodies are not checked before posting." >&2

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  bash "$WORKTREE_DIR/scripts/install-all.sh"
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
SERVER_PORT="$(find_free_port "$((4000 + WORKTREE_COUNT))")"

ENV_STATUS=0
ENV_SUMMARY="$(node "$WORKTREE_DIR/scripts/prepare-worktree-env.mjs" \
  --primary "$PRIMARY_ROOT" --worktree "$WORKTREE_DIR" \
  --server-port "$SERVER_PORT")" || ENV_STATUS=$?

cat <<EOF

Worktree ready.
  branch:    ${BRANCH}
  base:      ${BASE_REF}
  path:      ${WORKTREE_DIR}
  dev port:  ${PORT}
  api port:  ${SERVER_PORT}

Environment:
${ENV_SUMMARY}

Start the API and the client dev server (isolated to this worktree):
  (cd "${WORKTREE_DIR}" && yarn dev:server)
  (cd "${WORKTREE_DIR}/client" && yarn dev --port ${PORT})

Log in locally (returns to this worktree's client):
  http://localhost:${SERVER_PORT}/api/dev-login?redirect=http://localhost:${PORT}/

When the branch is merged, remove the worktree from the primary checkout:
  git worktree remove "${WORKTREE_DIR}"
EOF

if [ "$ENV_STATUS" -eq 1 ]; then
  echo "WARNING: preparing the worktree's env files failed; see the error above." >&2
fi
