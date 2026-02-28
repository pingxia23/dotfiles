#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

emit() {
  local key="$1"
  local value="$2"
  printf '%s=' "$key"
  quote "$value"
  printf '\n'
}

inside_worktree="$(git rev-parse --is-inside-work-tree 2>/dev/null || true)"
if [[ "$inside_worktree" != "true" ]]; then
  fail "Not inside a repository checkout; run from the primary checkout or a linked worktree."
fi

worktree_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$worktree_root" ]] || fail "Unable to resolve repository root via git rev-parse --show-toplevel."

worktree_path="$(pwd -P)"

branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
[[ -n "$branch" ]] || fail "Unable to resolve current branch (detached HEAD is not supported)."

origin_url="$(git remote get-url origin 2>/dev/null || true)"
[[ -n "$origin_url" ]] || fail "Unable to resolve origin remote URL."

repo="$(printf '%s' "$origin_url" | sed -E 's#.*github\.com[:/]##; s#\.git$##')"
if [[ -z "$repo" || "$repo" != */* ]]; then
  fail "Unable to resolve owner/repo from origin URL: $origin_url"
fi

dd_root=""
if [[ -d "$HOME/dd" ]]; then
  dd_root="$(cd "$HOME/dd" && pwd -P)"
fi

in_dd_scope="false"
if [[ -n "$dd_root" ]]; then
  case "$worktree_root" in
    "$dd_root"|"$dd_root"/*) in_dd_scope="true" ;;
  esac
fi

emit "inside_worktree" "$inside_worktree"
emit "worktree_root" "$worktree_root"
emit "worktree_path" "$worktree_path"
emit "branch" "$branch"
emit "origin_url" "$origin_url"
emit "repo" "$repo"
emit "in_dd_scope" "$in_dd_scope"
