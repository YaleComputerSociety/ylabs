#!/usr/bin/env bash
set -euo pipefail

: "${PROBE_RESULT:?PROBE_RESULT must be set}"
: "${PROBED_ROUTE:?PROBED_ROUTE must be set}"
: "${TARGET_REPO:?TARGET_REPO must be set}"
: "${RUN_URL:?RUN_URL must be set}"

label=beta-probe-failing
title='ops: beta probe failing'

case "$PROBE_RESULT" in
  failure | success) ;;
  *)
    echo "probe result ${PROBE_RESULT}: leaving the outage issue as it is"
    exit 0
    ;;
esac

last_status="${PROBE_LAST_STATUS:-}"
[[ "$last_status" =~ ^[0-9]{3}$ ]] || last_status=unknown
attempts="${PROBE_ATTEMPTS:-}"
[[ "$attempts" =~ ^[0-9]{1,2}$ ]] || attempts=unknown

open_issue=$(gh issue list --repo "$TARGET_REPO" --label "$label" --state open --limit 1 \
  --json number --jq '.[0].number // empty')

if [ "$PROBE_RESULT" = failure ]; then
  summary="Beta \`${PROBED_ROUTE}\` did not answer 2xx after ${attempts} attempts (last HTTP ${last_status})."
  if [ -n "$open_issue" ]; then
    gh issue comment "$open_issue" --repo "$TARGET_REPO" \
      --body "Still failing. ${summary} Run: ${RUN_URL}"
    echo "commented on open outage issue #${open_issue}"
  else
    gh label create "$label" --repo "$TARGET_REPO" --force --color B60205 \
      --description 'Open while the scheduled Keep Alive probe of beta is failing'
    gh issue create --repo "$TARGET_REPO" --title "$title" --label "$label" --body "$(
      cat <<BODY
The scheduled Keep Alive probe is failing. ${summary}

First failing run: ${RUN_URL}

Each further failing run comments here, and the first passing run closes this issue. See \`docs/release-process.md\`.
BODY
    )"
    echo "opened an outage issue"
  fi
elif [ -n "$open_issue" ]; then
  gh issue close "$open_issue" --repo "$TARGET_REPO" \
    --comment "Recovered. Beta \`${PROBED_ROUTE}\` answered HTTP ${last_status}. Run: ${RUN_URL}"
  echo "closed outage issue #${open_issue}"
else
  echo "beta probe passed and no outage issue is open"
fi
