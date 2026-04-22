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
  repo="$owner/$repo_name"
  canonical_pr_url="https://github.com/$owner/$repo_name/pull/$pr_number"
}

if [[ $# -ne 1 ]]; then
  usage
fi

owner=""
repo_name=""
repo=""
pr_number=""
canonical_pr_url=""
parse_pr_url "$1"

bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/pr-review-guidance.XXXXXX")"

pr_json="$bundle_dir/pr.json"
files_json="$bundle_dir/files.json"
comments_json="$bundle_dir/comments.json"
review_threads_json="$bundle_dir/review_threads.json"
diff_patch="$bundle_dir/diff.patch"

if ! gh pr view --repo "$repo" "$pr_number" \
  --json number,title,author,body,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,url \
  >"$pr_json"; then
  fail "Unable to load PR metadata for $canonical_pr_url"
fi

if ! gh api --paginate --slurp "repos/$repo/pulls/$pr_number/files?per_page=100" | jq 'add' >"$files_json"; then
  fail "Unable to load PR files for $canonical_pr_url"
fi

if ! gh api --paginate --slurp "repos/$repo/issues/$pr_number/comments?per_page=100" | jq 'add' >"$comments_json"; then
  fail "Unable to load PR comments for $canonical_pr_url"
fi

review_threads_query='
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
              id
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

if ! gh api graphql \
  --paginate \
  --slurp \
  -F owner="$owner" \
  -F name="$repo_name" \
  -F number="$pr_number" \
  -f query="$review_threads_query" | jq '
    map(.data.repository.pullRequest.reviewThreads.nodes // [])
    | add
    | map(select((.isResolved | not) and (.isOutdated | not)))
  ' >"$review_threads_json"; then
  fail "Unable to load PR review threads for $canonical_pr_url"
fi

if ! gh pr diff --repo "$repo" "$pr_number" --patch >"$diff_patch"; then
  fail "Unable to load PR diff for $canonical_pr_url"
fi

author_login="$(jq -r '.author.login // ""' "$pr_json")"
head_sha="$(jq -r '.headRefOid // ""' "$pr_json")"

jq -n \
  --arg repo "$repo" \
  --arg pr_url "$canonical_pr_url" \
  --argjson pr_number "$pr_number" \
  --arg author_login "$author_login" \
  --arg head_sha "$head_sha" \
  --arg bundle_dir "$bundle_dir" \
  '{
    repo: $repo,
    pr_number: $pr_number,
    pr_url: $pr_url,
    author_login: $author_login,
    head_sha: $head_sha,
    bundle_dir: $bundle_dir
  }'
