#!/bin/bash
set -euo pipefail

# --- Config ---
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.local/bin:/opt/dogbrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
CHANNEL_ID="C08V7DFTUMS"
DIGEST_DIR="$HOME/Documents/obsidian/Digests"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LOG_FILE="${SCRIPT_DIR}/slack-digest.log"
LOG_PREFIX="[slack-digest]"
DIGEST_REVIEW_FOOTER="- [ ] Review AI slack digest ${TARGET_FRIDAY:-} 📅 ${TARGET_FRIDAY:-}"

timestamp_output() {
  while IFS= read -r line; do
    printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$line" | tee -a "$LOG_FILE"
  done
}

exec > >(timestamp_output) 2>&1

echo "${LOG_PREFIX} Logging to ${LOG_FILE}"

contains_rejected_output() {
  local file="$1"

  grep -Eiq \
    'failed to authenticate\. api error:|invalid_auth_token|invalid internal auth token|not enough segments|^\{"errors"|^\[\{"status"|title":"unauthorized"' \
    "$file"
}

is_valid_digest_output() {
  local file="$1"
  local content first_line last_nonempty_line

  content=$(<"$file")
  if [[ -z "$content" ]]; then
    return 1
  fi

  if [[ "$content" == "Nothing interesting this week." ]]; then
    return 0
  fi

  first_line=$(sed -n '1p' "$file")
  last_nonempty_line=$(awk 'NF { last = $0 } END { print last }' "$file")

  [[ "$first_line" == '## '* && "$last_nonempty_line" == "$DIGEST_REVIEW_FOOTER" ]]
}

# --- Compute the most recent completed Friday-to-Friday range (Unix timestamps) ---
if date --version >/dev/null 2>&1; then
  TODAY_WEEKDAY=$(date +%u)
  DAYS_SINCE_FRIDAY=$(((TODAY_WEEKDAY + 2) % 7))
  if [[ "$DAYS_SINCE_FRIDAY" -eq 0 ]]; then
    DAYS_SINCE_FRIDAY=7
  fi
  TARGET_FRIDAY=$(date -d "${DAYS_SINCE_FRIDAY} days ago" +%Y-%m-%d)
  RANGE_START=$(date -d "${TARGET_FRIDAY} -7 days" +%Y-%m-%d)
  OLDEST=$(date -d "${RANGE_START} 00:00:00" +%s)
  LATEST=$(date -d "${TARGET_FRIDAY} 23:59:59" +%s)
else
  TODAY_WEEKDAY=$(/bin/date +%u)
  DAYS_SINCE_FRIDAY=$(((TODAY_WEEKDAY + 2) % 7))
  if [[ "$DAYS_SINCE_FRIDAY" -eq 0 ]]; then
    DAYS_SINCE_FRIDAY=7
  fi
  TARGET_FRIDAY=$(/bin/date -v-"${DAYS_SINCE_FRIDAY}"d +%Y-%m-%d)
  RANGE_START=$(/bin/date -j -v-7d -f "%Y-%m-%d" "$TARGET_FRIDAY" +%Y-%m-%d)
  OLDEST=$(/bin/date -j -f "%Y-%m-%d %H:%M:%S" "${RANGE_START} 00:00:00" +%s)
  LATEST=$(/bin/date -j -f "%Y-%m-%d %H:%M:%S" "${TARGET_FRIDAY} 23:59:59" +%s)
fi

DIGEST_FILE="${DIGEST_DIR}/${TARGET_FRIDAY}-ai-slack-digest.md"
DIGEST_REVIEW_FOOTER="- [ ] Review AI slack digest ${TARGET_FRIDAY} 📅 ${TARGET_FRIDAY}"

echo "${LOG_PREFIX} Generating weekly digest for ${RANGE_START} through ${TARGET_FRIDAY}"
echo "${LOG_PREFIX} Time range: ${OLDEST} - ${LATEST}"

# --- Idempotency check ---
if [[ -f "$DIGEST_FILE" && -s "$DIGEST_FILE" ]]; then
  echo "${LOG_PREFIX} Digest already exists at ${DIGEST_FILE}, skipping."
  exit 0
fi

if [[ -f "$DIGEST_FILE" && ! -s "$DIGEST_FILE" ]]; then
  echo "${LOG_PREFIX} Removing empty digest file from failed run."
  rm -f "$DIGEST_FILE"
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "${LOG_PREFIX} claude CLI is not installed or not on PATH."
  exit 1
fi

# --- Write prompt to temp file ---
PROMPT_FILE=$(mktemp /tmp/slack-digest-prompt.XXXXXX)
OUTPUT_FILE=$(mktemp /tmp/slack-digest-output.XXXXXX)
CLAUDE_STDOUT_FILE=$(mktemp /tmp/slack-digest-claude-stdout.XXXXXX)
trap 'rm -f "$PROMPT_FILE" "$OUTPUT_FILE" "$CLAUDE_STDOUT_FILE"' EXIT

cat > "$PROMPT_FILE" <<PROMPT_EOF
Produce a weekly technical learning digest from Slack for the week ending Friday (${TARGET_FRIDAY}).

GOAL

Create a self-contained, technically detailed digest of the most valuable discussions from Slack channel ${CHANNEL_ID} for a software engineer. The digest should let the reader understand the topic without needing to click any links by default. If linked documents exist, read them and include the key points directly in the digest.

STYLE

Use plain English as much as possible. Avoid dense, abstract phrasing. Say what you mean in simple sentences. For example, don't write "Calibrate upward from a sustainable baseline rather than pushing agent count until something breaks." Instead write "Start with fewer threads than you're tempted to use, because the failure mode is subtle: you still feel productive, but your review quality drops."

DATE AND FILE RULES

- Week start date: ${RANGE_START}
- Week end date: ${TARGET_FRIDAY}
- Write the digest to: ${OUTPUT_FILE}

STEP 1 — IDEMPOTENCY CHECK

Already handled by the calling script. Proceed to Step 2.

STEP 2 — READ SLACK

- Read all messages in Slack channel ${CHANNEL_ID} from ${RANGE_START} 00:00:00 through ${TARGET_FRIDAY} 23:59:59.
  Use mcp__plugin_slack_slack__slack_read_channel with:
  - channel_id: "${CHANNEL_ID}"
  - oldest: "${OLDEST}"
  - latest: "${LATEST}"
  - limit: 100
- Paginate until you have all messages.
- For every message that has thread replies (reply_count > 0), use mcp__plugin_slack_slack__slack_read_thread with that message ts as message_ts to get full thread context.
- Important: some messages that appear as top-level channel messages are actually "also sent to channel" replies. Always inspect the thread and attribute the discussion to the original parent topic.
- Merge thread replies into the parent discussion. Never list thread replies as separate digest items.

STEP 3 — READ LINKED SOURCES

- If a relevant Slack discussion links to a Confluence page, blog post, GitHub PR/issue, design doc, benchmark report, or other readable source, open it and read it carefully.
- For Confluence pages, use the Confluence MCP tools. For other URLs, use the available web browsing tools.
- Extract the key technical insights: problem being solved, architecture, concrete numbers, tradeoffs, and lessons learned.
- If multiple linked docs are part of the same discussion, combine them into one set of takeaways.
- If a linked source is inaccessible, still cover the Slack discussion, but note inline that the linked source could not be read.

STEP 4 — FILTER AND GROUP

- Merge all messages and threads about the same topic into one digest item.
- Select only the strongest technical discussions from the week.
- Target up to 20 items, but do NOT include filler. If only a few discussions are truly worthwhile, include only those.
- Prioritize topics with real technical depth, such as:
  - architecture decisions
  - system design tradeoffs
  - performance findings and benchmarks
  - migration strategies
  - debugging or incident learnings
  - AI/ML tooling techniques
  - infrastructure or platform patterns
  - novel engineering workflows
  - concrete implementation lessons
- Pick discussions because they're technically deep, not because they got lots of reactions or were posted recently.
- Skip:
  - greetings
  - emoji-only reactions
  - acknowledgments
  - minor tips unless unusually insightful
  - bot spam
  - non-technical chatter
  - purely organizational updates
  - corporate acquisitions, mergers, funding rounds, and business deals

STEP 5 — WRITE A SELF-CONTAINED TECHNICAL DIGEST

If there are no relevant discussions, write exactly:

Nothing interesting this week.

Otherwise:

- Start directly with the first ## heading.
- No frontmatter.
- No table of contents.
- Each item must be self-contained: the reader should learn the key insights without clicking any links.
- If linked docs were read, summarize their main points into the Key Takeaways bullets.
- Use the Slack permalink for the parent message as the heading link.
- Embed inline markdown links in bullets where a claim, number, or design detail comes from a specific Slack message or linked document.
- Do NOT add a separate Sources section.

FORMAT FOR EACH ITEM

## [Topic title](slack_permalink) — @author_name

### Key Takeaways

3-5 bullet points. Each bullet is one concrete learning from the discussion. Format each as:

- **[Short imperative phrase]** — 1-2 sentences explaining the reasoning or motivation behind this point. Be specific enough that the reader can learn from it without reading the original thread. Embed inline markdown links to supporting Slack messages or linked documents where relevant.

### Best Practices

Include this section only if the discussion suggests concrete actions, habits, or workflows. Otherwise omit it entirely.

1-3 bullet points. Each is a specific, actionable step the reader can try in their own work. Start each with a verb. Embed inline links where relevant.

---

QUALITY BAR

- Write for a software engineer, not a general audience.
- Be concise: each bullet should be 1-2 sentences maximum. No multi-paragraph explanations.
- Be specific: include concrete numbers, names, tools, and mechanisms. Avoid vague summaries like "this is important for teams."
- Each Key Takeaway bullet must teach something concrete — the reader should learn the insight without needing to read the original thread.
- Best Practices must be actionable — start with a verb, describe a step someone can take.
- If claims are uncertain or debated in the thread, say so within the bullet.
- If the thread references performance, include the actual numbers.
- Explain how things actually work, not how they're pitched. Prefer engineering lessons over announcements.
- Include items that teach something technical, not ones that are just interesting to read.

SLACK PERMALINK FORMAT

https://dd.enterprise.slack.com/archives/${CHANNEL_ID}/p{message_ts_without_dot}

Example:
1775102456.789012 ->
https://dd.enterprise.slack.com/archives/${CHANNEL_ID}/p1775102456789012

ENDING

For successful digests only, at the very end add one blank line and then exactly:

- [ ] Review AI slack digest ${TARGET_FRIDAY} 📅 ${TARGET_FRIDAY}

IMPORTANT: Write ONLY the final markdown content to ${OUTPUT_FILE}. No preamble, no code fences, no commentary.
IMPORTANT: The file must be exactly one of these forms:
- The exact text: Nothing interesting this week.
- A markdown digest that starts with ## on the first line and ends with the exact review checkbox line above.
IMPORTANT: If any API call fails (authentication errors, 401/403, token errors, MCP tool failures, missing tools, browsing failures, etc.), do NOT write ${OUTPUT_FILE}. Do not write error messages, do not write partial digests, do not write explanations.
IMPORTANT: Never write raw error text or payloads such as:
- Failed to authenticate
- API Error
- Unauthorized
- Invalid JWT
- {"errors": ...}
- [{"status":401, ...}]
PROMPT_EOF

# --- Run claude ---
echo "${LOG_PREFIX} Invoking claude..."
if ! claude -p "$(cat "$PROMPT_FILE")" \
  --model 'claude-opus-4-7[1m]' \
  --no-session-persistence \
  --allowedTools "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch,mcp__plugin_slack_slack__*" \
  > "$CLAUDE_STDOUT_FILE"; then
  echo "${LOG_PREFIX} Claude invocation failed; digest not created."
  exit 1
fi

if [[ ! -f "$OUTPUT_FILE" || ! -s "$OUTPUT_FILE" ]]; then
  if [[ -s "$CLAUDE_STDOUT_FILE" ]]; then
    echo "${LOG_PREFIX} Claude wrote to stdout instead of the requested file; validating stdout."
    mv "$CLAUDE_STDOUT_FILE" "$OUTPUT_FILE"
  else
    echo "${LOG_PREFIX} Claude did not write the digest file; digest not created."
    exit 1
  fi
fi

if contains_rejected_output "$OUTPUT_FILE"; then
  echo "${LOG_PREFIX} Rejected digest output containing error text; digest not created."
  exit 1
fi

if ! is_valid_digest_output "$OUTPUT_FILE"; then
  echo "${LOG_PREFIX} Rejected invalid digest output; digest not created."
  exit 1
fi

mkdir -p "$DIGEST_DIR"
mv "$OUTPUT_FILE" "$DIGEST_FILE"

echo "${LOG_PREFIX} Digest saved to ${DIGEST_FILE}"
