#!/usr/bin/env bash
# Codex second opinion on plan before ExitPlanMode

# This does not work well due to infinity loop and very nit picking

# Find the most recently modified plan file
PLAN=$(ls -t ~/.claude/plans/*.md 2>/dev/null | head -1)
[ -z "$PLAN" ] && exit 0

CONTENT=$(cat "$PLAN")
[ -z "$CONTENT" ] && exit 0

# Content-hash marker: skip only if plan hasn't changed since last review
MARKER="${PLAN}.codex-reviewed"
CURRENT_HASH=$(md5 -q "$PLAN")
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$CURRENT_HASH" ]; then
  rm -f "$MARKER"
  exit 0
fi

# Send plan to Codex via stdin (avoids shell arg limits and special char issues)
TMPOUT=$(mktemp)
codex exec -o "$TMPOUT" \
  "Critique this implementation plan concisely. Bullet points only. Cover: flaws/risks, simpler alternatives, missing edge cases. End with verdict: approve or needs-refinement (with specifics)." \
  <<< "$CONTENT" > /dev/null

CRITIQUE=$(cat "$TMPOUT" 2>/dev/null)
rm -f "$TMPOUT"

# Only mark as reviewed if Codex succeeded
if [ -n "$CRITIQUE" ]; then
  echo "$CURRENT_HASH" > "$MARKER"
  jq -n --arg reason "Codex critique of your plan:\n\n$CRITIQUE" \
    '{"decision":"block","reason":$reason}'
fi
# If Codex failed, exit 0 (allow through with no block)
