#!/usr/bin/env bash
set -euo pipefail

app_dir="${SWEEP_RUNNER_APP_DIR:-/app}"

if [ "${1:-}" = "--probe-hosts" ]; then
  shift
  cd "$app_dir"
  exec yarn --cwd server scrape:probe-hosts "$@"
fi

job_label="weekly-sweep"
job_script="scrape:sweep:weekly-development"
resume_run_id=""
resume_sha=""
if [ "${1:-}" = "--resume-weekly-run" ]; then
  job_label="weekly-sweep-resume"
  resume_run_id="${2:-}"
  resume_sha="${3:-}"
  shift 3 || { echo "[$job_label] REFUSING TO START: --resume-weekly-run needs a run id and its commit" >&2; exit 2; }
  if ! [[ "$resume_run_id" =~ ^[0-9a-f]{24}$ ]] || ! [[ "$resume_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[$job_label] REFUSING TO START: --resume-weekly-run needs a 24-hex run id and a 40-hex commit" >&2
    exit 2
  fi
fi
if [ "${1:-}" = "--rerun-source" ]; then
  shift
  job_label="sweep-rerun"
  job_script="scrape:sweep:rerun-source"
  if [ "$#" -eq 0 ]; then
    echo "[$job_label] REFUSING TO START: --rerun-source needs at least one source name" >&2
    exit 2
  fi
fi

repository_url="${SWEEP_REPOSITORY_URL:-https://github.com/YaleComputerSociety/ylabs.git}"
work_dir="$(mktemp -d)"
checkout="$work_dir/ylabs"

refuse_to_start() {
  echo "[$job_label] REFUSING TO START: $1" >&2
  exit 1
}

if [ -n "$resume_sha" ]; then
  target_sha="$resume_sha"
  echo "[$job_label] resuming run $resume_run_id at its recorded commit $target_sha"
else
  target_sha="$(git ls-remote "$repository_url" refs/heads/beta | cut -f1 || true)"
  if [ -z "$target_sha" ]; then
    refuse_to_start "could not resolve beta HEAD from $repository_url"
  fi
  echo "[$job_label] resolved beta HEAD to $target_sha; the whole sweep runs at this commit"
fi

git clone --quiet --filter=blob:none --no-checkout --single-branch --branch beta \
  "$repository_url" "$checkout" \
  || refuse_to_start "could not clone beta from $repository_url"
git -C "$checkout" checkout --quiet --detach "$target_sha" \
  || refuse_to_start "could not check out $target_sha"

if cmp -s "$app_dir/server/yarn.lock" "$checkout/server/yarn.lock" \
  && cmp -s "$app_dir/server/package.json" "$checkout/server/package.json"; then
  cp -a "$app_dir/server/node_modules" "$checkout/server/node_modules"
fi
yarn --cwd "$checkout/server" install --immutable

for name in $(compgen -e | grep '^MEILISEARCH_' || true); do unset "$name"; done
export SEARCH_INDEX_WRITES=deferred
export SWEEP_TARGET_SHA="$target_sha"
export SOURCE_COMMIT="$target_sha"

cd "$checkout"
if [ -n "$resume_run_id" ]; then
  exec yarn --cwd server "$job_script" --resume-run "$resume_run_id" "$@"
fi
exec yarn --cwd server "$job_script" "$@"
