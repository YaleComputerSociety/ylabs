#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--probe-hosts" ]; then
  shift
  cd /app
  exec yarn --cwd server scrape:probe-hosts "$@"
fi

meili_dir="$(mktemp -d)"
MEILISEARCH_API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MEILISEARCH_API_KEY
export MEILISEARCH_HOST="http://127.0.0.1:7700"
unset MEILISEARCH_INDEX_PREFIX

meilisearch --db-path "$meili_dir/data" --dump-dir "$meili_dir/dumps" \
  --http-addr 127.0.0.1:7700 --master-key "$MEILISEARCH_API_KEY" --env development \
  --no-analytics >"$meili_dir/meilisearch.log" 2>&1 &
meili_pid=$!
trap 'kill "$meili_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS "$MEILISEARCH_HOST/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "$MEILISEARCH_HOST/health" >/dev/null || { echo "[weekly-sweep] the in-container Meilisearch did not start" >&2; exit 1; }

cd /app
yarn --cwd server scrape:sweep:weekly-development "$@"
