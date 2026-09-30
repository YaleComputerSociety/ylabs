#!/usr/bin/env bash
# Its own shebang, not an inline `run:` block: GitHub runs a step with `bash -e`,
# and `set -uo pipefail` does not clear an inherited -e, so an inline loop aborted
# at the first transport error instead of retrying.
set -euo pipefail

: "${BETA_HEALTH_URL:?BETA_HEALTH_URL must be set}"
attempts=3
retry_delay_seconds="${KEEP_ALIVE_RETRY_DELAY_SECONDS:-20}"
status=000
for attempt in $(seq 1 "$attempts"); do
  # `if !` rather than `|| true`, so a transport failure is recorded as a status
  # instead of swallowing curl's exit under whatever shell flags are in force.
  if ! status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 "$BETA_HEALTH_URL"); then
    status="${status:-000}"
  fi
  echo "attempt ${attempt}/${attempts}: HTTP ${status}"
  case "$status" in
    2*) echo "beta answered HTTP ${status}"; exit 0 ;;
  esac
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$retry_delay_seconds"
  fi
done
echo "::error::${BETA_HEALTH_URL} did not answer 2xx after ${attempts} attempts (last HTTP ${status})"
exit 1
