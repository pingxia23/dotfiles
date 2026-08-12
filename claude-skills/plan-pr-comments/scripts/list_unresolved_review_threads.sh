#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  fail "Usage: $(basename "$0") <pr-url>"
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
}

if [[ $# -ne 1 ]]; then
  usage
fi

owner=""
repo_name=""
pr_number=""
parse_pr_url "$1"

query='
query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          subjectType
          comments(first: 100) {
            nodes {
              fullDatabaseId
              url
              body
              createdAt
              diffHunk
              author {
                login
              }
              replyTo {
                fullDatabaseId
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
'

pages="$(
  gh api graphql \
    --paginate \
    --slurp \
    -F owner="$owner" \
    -F name="$repo_name" \
    -F number="$pr_number" \
    -f query="$query"
)"

if [[ "$(printf '%s' "$pages" | jq -r '.[0].data.repository.pullRequest == null')" == "true" ]]; then
  fail "Unable to load pull request $pr_number from $owner/$repo_name"
fi

printf '%s' "$pages" | jq -c '
  map(.data.repository.pullRequest.reviewThreads.nodes // [])
  | add
  | map(
      select(.isResolved | not)
      | select(.isOutdated | not)
      | . as $thread
      | ($thread.comments.nodes // []) as $comments
      | {
          thread_id: $thread.id,
          path: $thread.path,
          line: $thread.line,
          original_line: $thread.originalLine,
          start_line: $thread.startLine,
          original_start_line: $thread.originalStartLine,
          diff_side: $thread.diffSide,
          subject_type: $thread.subjectType,
          diff_hunk: ($comments[0].diffHunk // $comments[-1].diffHunk // ""),
          comment_url: ($comments[-1].url // null),
          last_comment_id: ($comments[-1].fullDatabaseId // null),
          last_comment_body: ($comments[-1].body // ""),
          comments: (
            $comments
            | map({
                id: (.fullDatabaseId // null),
                url: (.url // null),
                author: (.author.login // "ghost"),
                body: (.body // ""),
                created_at: (.createdAt // null),
                reply_to_id: (.replyTo.fullDatabaseId // null)
              })
          )
        }
    )
'
