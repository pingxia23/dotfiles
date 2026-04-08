#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

if [ "$(uname -s)" = "Darwin" ]; then
  exit 0
fi

RAW_PAYLOAD="$(codex_hooks_load_payload "$@" || true)"
if [ -z "$RAW_PAYLOAD" ]; then
  codex_hooks_log "stop skipped: empty payload"
  exit 0
fi

if ! printf '%s' "$RAW_PAYLOAD" | jq -e . >/dev/null 2>&1; then
  codex_hooks_log "stop skipped: invalid json payload"
  exit 0
fi

CWD="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.cwd // empty')"
SESSION_ID="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.session_id // "N/A"')"
TURN_ID="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.turn_id // "N/A"')"
LAST_ASSISTANT_MESSAGE="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.last_assistant_message // .message // empty')"

if [ -n "$LAST_ASSISTANT_MESSAGE" ]; then
  MESSAGE="$LAST_ASSISTANT_MESSAGE"
else
  MESSAGE="Codex turn completed."
fi

if [ -n "$CWD" ] && [ -d "$CWD" ]; then
  GIT_BRANCH="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")"
else
  CWD="$(pwd)"
  GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")"
fi

PAYLOAD="$(jq -n \
  --arg msg "$MESSAGE" \
  --arg branch "$GIT_BRANCH" \
  --arg dir "$CWD" \
  --arg session "$SESSION_ID" \
  --arg turn "$TURN_ID" \
  '{
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: ("Codex Notification From Branch " + $branch), emoji: true }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: $msg }
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: ("*Dir:* " + $dir) },
          { type: "mrkdwn", text: ("*Session:* " + $session) },
          { type: "mrkdwn", text: ("*Turn:* " + $turn) }
        ]
      }
    ]
  }')"

codex_hooks_post_payload "$PAYLOAD" || exit 0
codex_hooks_log "stop completed: session_id=${SESSION_ID}"
