#!/usr/bin/env bash
set -euo pipefail

readonly MARKER='<!-- pr-review-guidance:v1 -->'
readonly OWNER_LOGIN='pingxia23'

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  fail "Usage: $(basename "$0") <pr-url> [body|-]"
}

parse_pr_url() {
  local pr_url="$1"
  local trimmed="${pr_url%%#*}"
  trimmed="${trimmed%%\?*}"

  if [[ ! "$trimmed" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)$ ]]; then
    fail "Unsupported PR URL: $pr_url"
  fi

  owner="${BASH_REMATCH[1]}"
  repo_name="${BASH_REMATCH[2]}"
  pr_number="${BASH_REMATCH[3]}"
  repo="$owner/$repo_name"
  canonical_pr_url="https://github.com/$owner/$repo_name/pull/$pr_number"
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
fi

owner=""
repo_name=""
repo=""
pr_number=""
canonical_pr_url=""
parse_pr_url "$1"

if [[ $# -eq 2 && "$2" != "-" ]]; then
  body="$2"
else
  body="$(cat)"
fi

[[ -n "$body" ]] || fail "Comment body must not be empty"
[[ "$body" == *"$MARKER"* ]] || fail "Comment body must include skill marker"

comments_json="$(gh api --paginate --slurp "repos/$repo/issues/$pr_number/comments?per_page=100")"

existing_comment="$(printf '%s' "$comments_json" | jq -c --arg marker "$MARKER" --arg owner_login "$OWNER_LOGIN" '
  add
  | map(select(.user.login == $owner_login and (.body | contains($marker))))
  | sort_by(.created_at, .id)
  | last // empty
')"

if [[ -n "$existing_comment" ]]; then
  comment_id="$(printf '%s' "$existing_comment" | jq -r '.id')"
  response="$(gh api --method PATCH "repos/$repo/issues/comments/$comment_id" -f body="$body")"
  action="updated"
else
  response="$(gh api --method POST "repos/$repo/issues/$pr_number/comments" -f body="$body")"
  action="created"
fi

comment_url="$(printf '%s' "$response" | jq -r '.html_url // empty')"
[[ -n "$comment_url" ]] || fail "Unable to determine comment URL for $canonical_pr_url"

jq -n \
  --arg action "$action" \
  --arg comment_url "$comment_url" \
  '{
    action: $action,
    comment_url: $comment_url
  }'
