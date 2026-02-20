#!/usr/bin/env bash
# Slack notification hook for Codex CLI turn-complete events.

set -euo pipefail

# Skip on macOS where local terminal notifications are typically enough.
if [ "$(uname -s)" = "Darwin" ]; then
  exit 0
fi

WEBHOOK_URL="${AI_SLACK_WEBHOOK_URL:?AI_SLACK_WEBHOOK_URL not set}"

# Codex appends a JSON payload as the final argument for `notify` commands.
RAW_PAYLOAD="${!#-}"
if [ -z "$RAW_PAYLOAD" ]; then
  exit 0
fi
if ! echo "$RAW_PAYLOAD" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

EVENT_TYPE=$(echo "$RAW_PAYLOAD" | jq -r '.type // empty')
if [ "$EVENT_TYPE" != "agent-turn-complete" ]; then
  exit 0
fi

WORKING_DIR=$(echo "$RAW_PAYLOAD" | jq -r '.["cwd"] // empty')
if [ -z "$WORKING_DIR" ]; then
  WORKING_DIR="$(pwd)"
fi

LAST_ASSISTANT_MESSAGE=$(echo "$RAW_PAYLOAD" | jq -r '.["last-assistant-message"] // empty')
LAST_INPUT_MESSAGE=$(echo "$RAW_PAYLOAD" | jq -r '.["input-messages"][-1] // empty')
THREAD_ID=$(echo "$RAW_PAYLOAD" | jq -r '.["thread-id"] // "N/A"')
TURN_ID=$(echo "$RAW_PAYLOAD" | jq -r '.["turn-id"] // "N/A"')

if [ -n "$LAST_ASSISTANT_MESSAGE" ]; then
  MESSAGE="$LAST_ASSISTANT_MESSAGE"
elif [ -n "$LAST_INPUT_MESSAGE" ]; then
  MESSAGE="Turn completed: $LAST_INPUT_MESSAGE"
else
  MESSAGE="Codex turn completed."
fi

GIT_BRANCH=$(git -C "$WORKING_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")

PAYLOAD=$(jq -n \
  --arg msg "$MESSAGE" \
  --arg branch "$GIT_BRANCH" \
  --arg dir "$WORKING_DIR" \
  --arg thread "$THREAD_ID" \
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
          { type: "mrkdwn", text: ("*Thread:* " + $thread) },
          { type: "mrkdwn", text: ("*Turn:* " + $turn) }
        ]
      }
    ]
  }'
)

# Fire-and-forget so Codex never blocks on network.
curl -s -X POST -H 'Content-type: application/json' --data "$PAYLOAD" "$WEBHOOK_URL" >/dev/null 2>&1 &
