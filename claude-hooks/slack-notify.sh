#!/usr/bin/env bash
# Slack notification hook for Claude Code
# Sends a notification via Slack webhook when Claude finishes or asks for input
# Skipped on macOS where iTerm local notifications already work

# Skip on macOS
if [ "$(uname -s)" = "Darwin" ]; then
  exit 0
fi

WEBHOOK_URL="${AI_SLACK_WEBHOOK_URL:?AI_SLACK_WEBHOOK_URL not set}"

# Read hook input from stdin
INPUT=$(cat)

# Extract the notification message
MESSAGE=$(echo "$INPUT" | jq -r '.message // "No message"')

# Gather context
WORKING_DIR=$(pwd)
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")
MODEL_NAME="${CLAUDE_MODEL:-unknown}"
HOSTNAME=$(hostname)

# Build Slack payload
PAYLOAD=$(jq -n \
  --arg text "*Claude Code Notification*" \
  --arg msg "$MESSAGE" \
  --arg model "$MODEL_NAME" \
  --arg branch "$GIT_BRANCH" \
  --arg dir "$WORKING_DIR" \
  --arg host "$HOSTNAME" \
  '{
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Claude Code Notification", emoji: true }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: $msg }
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: ("*Model:* " + $model) },
          { type: "mrkdwn", text: ("*Branch:* " + $branch) },
          { type: "mrkdwn", text: ("*Dir:* " + $dir) },
          { type: "mrkdwn", text: ("*Host:* " + $host) }
        ]
      }
    ]
  }'
)

# Send to Slack (fire-and-forget, don't block Claude)
curl -s -X POST -H 'Content-type: application/json' --data "$PAYLOAD" "$WEBHOOK_URL" >/dev/null 2>&1 &
