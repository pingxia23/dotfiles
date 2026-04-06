#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shared helper functions for state path calculation.
source "${SCRIPT_DIR}/common.sh"

RAW_PAYLOAD="$(codex_hooks_load_json || true)"
if [ -z "$RAW_PAYLOAD" ]; then
  exit 0
fi

CWD="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.cwd // empty')"
SESSION_ID="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.session_id // empty')"
SOURCE="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.source // empty')"
TRANSCRIPT_PATH="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.transcript_path // empty')"

if [ -z "$CWD" ] || [ -z "$SESSION_ID" ] || [ -z "$SOURCE" ]; then
  exit 0
fi

STATE_FILE="$(codex_hooks_state_file "$CWD")"

if [ -f "$STATE_FILE" ]; then
  CURRENT_SESSION_ID="$(jq -r '.session_id // empty' "$STATE_FILE" 2>/dev/null || true)"
  if [ -n "$CURRENT_SESSION_ID" ]; then
    exit 0
  fi
fi

TMP_FILE="$(mktemp "${STATE_FILE}.XXXXXX")"
jq -n \
  --arg session_id "$SESSION_ID" \
  --arg cwd "$CWD" \
  --arg source "$SOURCE" \
  --arg transcript_path "$TRANSCRIPT_PATH" \
  --arg started_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{
    session_id: $session_id,
    cwd: $cwd,
    source: $source,
    transcript_path: (if $transcript_path | length > 0 then $transcript_path else null end),
    started_at: $started_at
  }' >"$TMP_FILE"
mv "$TMP_FILE" "$STATE_FILE"
