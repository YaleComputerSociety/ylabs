#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--probe-hosts" ]; then
  shift
  cd /app
  exec yarn --cwd server scrape:probe-hosts "$@"
fi

repository_url="${SWEEP_REPOSITORY_URL:-https://github.com/YaleComputerSociety/ylabs.git}"
work_dir="$(mktemp -d)"
checkout="$work_dir/ylabs"

refuse_to_start() {
  echo "[weekly-sweep] REFUSING TO START: $1" >&2
  exit 1
}

target_sha="$(git ls-remote "$repository_url" refs/heads/beta | cut -f1 || true)"
if [ -z "$target_sha" ]; then
  refuse_to_start "could not resolve beta HEAD from $repository_url"
fi
echo "[weekly-sweep] resolved beta HEAD to $target_sha; the whole sweep runs at this commit"

git clone --quiet --filter=blob:none --no-checkout --single-branch --branch beta \
  "$repository_url" "$checkout" \
  || refuse_to_start "could not clone beta from $repository_url"
git -C "$checkout" checkout --quiet --detach "$target_sha" \
  || refuse_to_start "could not check out $target_sha"

if cmp -s /app/server/yarn.lock "$checkout/server/yarn.lock" \
  && cmp -s /app/server/package.json "$checkout/server/package.json"; then
  cp -a /app/server/node_modules "$checkout/server/node_modules"
fi
yarn --cwd "$checkout/server" install --immutable

for name in $(compgen -e | grep '^MEILISEARCH_' || true); do unset "$name"; done
export SEARCH_INDEX_WRITES=deferred
export SWEEP_TARGET_SHA="$target_sha"
export SOURCE_COMMIT="$target_sha"

cd "$checkout"
exec yarn --cwd server scrape:sweep:weekly-development "$@"
