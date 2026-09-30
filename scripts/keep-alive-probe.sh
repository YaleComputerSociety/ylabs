#!/usr/bin/env bash
set -uo pipefail

: "${BETA_HEALTH_URL:?BETA_HEALTH_URL must be set}"
attempts=3
retry_delay_seconds="${KEEP_ALIVE_RETRY_DELAY_SECONDS:-20}"
status=000
for attempt in $(seq 1 "$attempts"); do
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 "$BETA_HEALTH_URL" || true)
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
