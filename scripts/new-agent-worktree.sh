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

Installs hardlink package files from the shared Yarn store (nmMode: hardlinks-global in
<worktree root>/.yarnrc.yml), so each worktree adds about 0.3 MB rather than 0.7 GB.

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

if ! (cd "$REPO_ROOT" && scripts/install-gh-identifier-guard.sh); then
  echo "ERROR: the gh identifier guard is not active, so gh bodies would not be checked before posting." >&2
  echo "Fix the problem above and re-run; no worktree was created." >&2
  exit 1
fi

BASE_REMOTE=origin
if git -C "$REPO_ROOT" remote get-url upstream >/dev/null 2>&1; then
  BASE_REMOTE=upstream
fi

git -C "$REPO_ROOT" fetch "$BASE_REMOTE" --quiet || true

BASE_REF="$BASE"
if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/${BASE_REMOTE}/${BASE}"; then
  BASE_REF="${BASE_REMOTE}/${BASE}"
fi

mkdir -p "$WORKTREE_ROOT"
WORKTREE_ROOT_REAL="$(cd "$WORKTREE_ROOT" && pwd -P)"
PRIMARY_ROOT_REAL="$(cd "$PRIMARY_ROOT" && pwd -P)"

case "${PRIMARY_ROOT_REAL}/" in
  "${WORKTREE_ROOT_REAL}/"*)
    echo "ERROR: YLABS_WORKTREE_ROOT (${WORKTREE_ROOT_REAL}) contains the primary checkout." >&2
    echo "Its .yarnrc.yml would switch the primary checkout and every sibling project to hardlinked installs." >&2
    echo "Choose a root outside ${PRIMARY_ROOT_REAL}'s ancestors; no worktree was created." >&2
    exit 1
    ;;
esac

# Kept outside the repository so CI, Render and the primary checkout keep classic copies;
# Yarn reads .yarnrc.yml from parent directories, so every worktree here inherits it.
WORKTREE_ROOT_YARNRC="${WORKTREE_ROOT_REAL}/.yarnrc.yml"
if ! grep -qs '^nmMode:' "$WORKTREE_ROOT_YARNRC"; then
  printf 'nmMode: hardlinks-global\n' >> "$WORKTREE_ROOT_YARNRC"
fi

git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_DIR" "$BASE_REF"

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  bash "$WORKTREE_DIR/scripts/install-all.sh"
  if ! bash "$WORKTREE_DIR/scripts/verify-yarn-store.sh"; then
    echo "ERROR: a shared Yarn store file no longer matches its content hash, so some worktree wrote into a hardlinked package file." >&2
    echo "Find the writer before using this worktree; the worktree was created at ${WORKTREE_DIR}." >&2
    exit 1
  fi
fi

claimed_api_ports() {
  local tree
  while IFS= read -r tree; do
    if [ "$tree" != "$WORKTREE_DIR" ] && [ -f "$tree/server/.env" ]; then
      sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$tree/server/.env"
    fi
  done < <(git -C "$REPO_ROOT" worktree list --porcelain | sed -n 's/^worktree //p')
}

WORKTREE_COUNT="$(git -C "$REPO_ROOT" worktree list --porcelain | grep -c '^worktree ')"
PORT_OFFSET="$(node "$WORKTREE_DIR/scripts/worktree-port-probe.mjs" \
  --start-offset "$WORKTREE_COUNT" \
  --claimed-api-ports "$(claimed_api_ports | tr '\n' ' ')")"
PORT="$((3000 + PORT_OFFSET))"
SERVER_PORT="$((4000 + PORT_OFFSET))"

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

Merge through the queue without --delete-branch, which removes the worktree
and switches the primary checkout's branch. Once the PR reads MERGED (deleting
the branch earlier closes it), delete the remote branch, remove the worktree,
and confirm the primary checkout is still on beta:
  gh pr merge <n> --auto --repo YaleComputerSociety/ylabs
  gh pr view <n> --repo YaleComputerSociety/ylabs --json state --jq .state
  git push origin --delete "${BRANCH}"
  git -C "${PRIMARY_ROOT}" worktree remove "${WORKTREE_DIR}"
  git -C "${PRIMARY_ROOT}" branch --show-current
EOF

if [ "$ENV_STATUS" -eq 1 ]; then
  echo "WARNING: preparing the worktree's env files failed; see the error above." >&2
fi
