#!/usr/bin/env bash
set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER must be set}"
: "${TARGET_REPO:?TARGET_REPO must be set}"
state=$(gh pr view "$PR_NUMBER" --repo "$TARGET_REPO" --json isDraft,labels)
is_draft=$(printf '%s' "$state" | jq -r '.isDraft')
has_hold=$(printf '%s' "$state" | jq -r '[.labels[].name | ascii_downcase] | index("hold") != null')
echo "live state for #${PR_NUMBER}: isDraft=${is_draft} holdLabel=${has_hold}"

held=0
if [ "$has_hold" = "true" ]; then
  echo "::error::The 'hold' label is set on this promotion. Beta verification is not signed off."
  held=1
fi
if [ "$is_draft" = "true" ]; then
  echo "::error::This promotion is still a draft. Mark it ready for review once beta verification passes."
  held=1
fi
if [ "$held" -eq 1 ]; then
  exit 1
fi
echo "No release hold in effect."
