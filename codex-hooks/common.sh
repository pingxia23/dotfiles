#!/usr/bin/env bash

set -euo pipefail

codex_hooks_state_dir() {
  printf '%s\n' "${HOME}/.codex/tmp/notify-root-sessions"
}

codex_hooks_hash() {
  local input="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$input" | sha256sum | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$input" | shasum -a 256 | awk '{print $1}'
    return
  fi

  echo "sha256 tooling not available" >&2
  return 1
}

codex_hooks_state_file() {
  local cwd="$1"
  local state_dir
  local cwd_hash

  state_dir="$(codex_hooks_state_dir)"
  cwd_hash="$(codex_hooks_hash "$cwd")"
  mkdir -p "$state_dir"
  printf '%s/%s.json\n' "$state_dir" "$cwd_hash"
}

codex_hooks_load_json() {
  local raw_input

  raw_input="$(cat)"
  if [ -z "$raw_input" ]; then
    return 1
  fi

  if ! printf '%s' "$raw_input" | jq -e . >/dev/null 2>&1; then
    return 1
  fi

  printf '%s' "$raw_input"
}

codex_notify_should_skip_os() {
  [ "$(uname -s)" = "Darwin" ]
}

codex_post_slack_payload() {
  local payload="$1"
  local webhook_url

  webhook_url="${AI_SLACK_WEBHOOK_URL:-}"
  if [ -z "$webhook_url" ]; then
    return 0
  fi

  curl -s -X POST -H 'Content-type: application/json' --data "$payload" "$webhook_url" >/dev/null 2>&1 &
}
