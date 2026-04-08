#!/usr/bin/env bash

set -euo pipefail

codex_hooks_load_payload() {
  local payload=""

  if [ ! -t 0 ]; then
    payload="$(cat)"
  fi

  if [ -z "$payload" ] && [ "$#" -gt 0 ]; then
    payload="${*: -1}"
  fi

  if [ -z "$payload" ]; then
    return 1
  fi

  printf '%s' "$payload"
}

codex_hooks_log() {
  local message="$1"
  local log_dir="${HOME}/.codex/tmp"

  mkdir -p "$log_dir"
  printf '%s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$message" >> "${log_dir}/notify-hooks.log"
}

codex_hooks_post_payload() {
  local payload="$1"
  local webhook_url="${AI_SLACK_WEBHOOK_URL:-}"

  if [ -z "$webhook_url" ]; then
    codex_hooks_log "skip webhook post: AI_SLACK_WEBHOOK_URL is not set"
    return 1
  fi

  if ! curl -fsS --retry 2 --retry-delay 1 --max-time 10 -X POST -H 'Content-type: application/json' --data "$payload" "$webhook_url" >/dev/null 2>&1; then
    codex_hooks_log "webhook post failed"
    return 1
  fi

  codex_hooks_log "webhook post succeeded"
}
