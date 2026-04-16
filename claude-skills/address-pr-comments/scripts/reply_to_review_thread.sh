#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  fail "Usage: $(basename "$0") <repo> <pr-number> <comment-id> [reply-body|-]"
}

if [[ $# -lt 3 || $# -gt 4 ]]; then
  usage
fi

repo="$1"
pr_number="$2"
comment_id="$3"

if [[ $# -eq 4 && "$4" != "-" ]]; then
  body="$4"
else
  body="$(cat)"
fi

[[ "$repo" == */* ]] || fail "Expected repo in owner/name format: $repo"
[[ "$pr_number" =~ ^[0-9]+$ ]] || fail "Expected numeric PR number: $pr_number"
[[ "$comment_id" =~ ^[0-9]+$ ]] || fail "Expected numeric review comment id: $comment_id"
[[ -n "$body" ]] || fail "Reply body must not be empty"

gh api \
  --method POST \
  "repos/$repo/pulls/$pr_number/comments" \
  -f body="$body" \
  -F in_reply_to="$comment_id"
