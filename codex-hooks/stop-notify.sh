#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shared helper functions for state path calculation and Slack delivery.
source "${SCRIPT_DIR}/common.sh"

if codex_notify_should_skip_os; then
  exit 0
fi

RAW_PAYLOAD="$(codex_hooks_load_json || true)"
if [ -z "$RAW_PAYLOAD" ]; then
  exit 0
fi

CWD="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.cwd // empty')"
SESSION_ID="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.session_id // empty')"
TURN_ID="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.turn_id // "N/A"')"
LAST_ASSISTANT_MESSAGE="$(printf '%s' "$RAW_PAYLOAD" | jq -r '.last_assistant_message // empty')"

if [ -z "$CWD" ] || [ -z "$SESSION_ID" ]; then
  exit 0
fi

STATE_FILE="$(codex_hooks_state_file "$CWD")"
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

ROOT_SESSION_ID="$(jq -r '.session_id // empty' "$STATE_FILE" 2>/dev/null || true)"
if [ -z "$ROOT_SESSION_ID" ] || [ "$SESSION_ID" != "$ROOT_SESSION_ID" ]; then
  exit 0
fi

if [ -n "$LAST_ASSISTANT_MESSAGE" ]; then
  MESSAGE="$LAST_ASSISTANT_MESSAGE"
else
  MESSAGE="Codex turn completed."
fi

GIT_BRANCH="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")"
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

codex_post_slack_payload "$PAYLOAD"
rm -f "$STATE_FILE"
