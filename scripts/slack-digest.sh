#!/bin/bash
set -euo pipefail

# --- Config ---
CHANNEL_ID="C08V7DFTUMS"
DIGEST_DIR="$HOME/Documents/obsidian/Digests"
LOG_PREFIX="[slack-digest]"
DIGEST_REVIEW_FOOTER="- [ ] Review AI slack digest 📅 ${YESTERDAY:-}"

contains_rejected_output() {
  local file="$1"

  grep -Eiq \
    'failed to authenticate\. api error:|invalid internal auth token|not enough segments|^\{"errors"|^\[\{"status"|title":"unauthorized"' \
    "$file"
}

is_valid_digest_output() {
  local file="$1"
  local content first_line last_nonempty_line

  content=$(<"$file")
  if [[ -z "$content" ]]; then
    return 1
  fi

  if [[ "$content" == "Nothing interesting yesterday." ]]; then
    return 0
  fi

  first_line=$(sed -n '1p' "$file")
  last_nonempty_line=$(awk 'NF { last = $0 } END { print last }' "$file")

  [[ "$first_line" == '## '* && "$last_nonempty_line" == "$DIGEST_REVIEW_FOOTER" ]]
}

# --- Compute yesterday's date range (Unix timestamps) ---
if date --version >/dev/null 2>&1; then
  YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
  OLDEST=$(date -d "yesterday 00:00:00" +%s)
  LATEST=$(date -d "yesterday 23:59:59" +%s)
else
  YESTERDAY=$(/bin/date -v-1d +%Y-%m-%d)
  OLDEST=$(/bin/date -v-1d -j -f "%H:%M:%S" "00:00:00" +%s)
  LATEST=$(/bin/date -v-1d -j -f "%H:%M:%S" "23:59:59" +%s)
fi

DIGEST_FILE="${DIGEST_DIR}/${YESTERDAY}-ai-slack-digest.md"
DIGEST_REVIEW_FOOTER="- [ ] Review AI slack digest 📅 ${YESTERDAY}"

echo "${LOG_PREFIX} Generating digest for ${YESTERDAY}"
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
trap 'rm -f "$PROMPT_FILE" "$OUTPUT_FILE"' EXIT

cat > "$PROMPT_FILE" <<PROMPT_EOF
Produce a technical learning digest from Slack for yesterday (${YESTERDAY}).

GOAL

Create a self-contained, technically detailed digest of the most valuable discussions from Slack channel ${CHANNEL_ID} for a software engineer. The digest should let the reader understand the topic without needing to click any links by default. If linked documents exist, absorb their substance and integrate it directly into the writeup.

DATE AND FILE RULES

- Yesterday's date: ${YESTERDAY}
- Write the digest to: ${OUTPUT_FILE}

STEP 1 — IDEMPOTENCY CHECK

Already handled by the calling script. Proceed to Step 2.

STEP 2 — READ SLACK

- Read all messages in Slack channel ${CHANNEL_ID} from yesterday.
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
- Extract the technical substance, not just the headline:
  - problem being solved
  - architecture or design
  - implementation details
  - performance characteristics
  - migration or rollout strategy
  - tradeoffs, risks, and lessons learned
- If multiple linked docs are part of the same discussion, synthesize them into one coherent summary.
- If a linked source is inaccessible, still summarize the Slack discussion, but explicitly note inline that the linked source could not be read.

STEP 4 — FILTER AND GROUP

- Merge all messages and threads about the same topic into one digest item.
- Select only the strongest technical discussions from yesterday.
- Target 5-8 items, but do NOT include filler. If only 2-4 discussions are truly worthwhile, include only those.
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
- Strongly prefer substance over popularity or recency.
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

Nothing interesting yesterday.

Otherwise:

- Start directly with the first ## heading.
- No frontmatter.
- No table of contents.
- Each item must be self-contained and teach the topic without requiring the reader to click links.
- If linked docs were read, incorporate their key content directly into the item.
- Use the Slack permalink for the parent message as the heading link.
- Do NOT add a separate Sources section.
- Instead, embed markdown links directly in the relevant text wherever a claim, design detail, benchmark, migration step, or quote comes from Slack or a linked document.
- Prefer linking the most relevant source at the sentence or clause where it is used.
- If a paragraph synthesizes multiple sources, include links inline at the relevant points rather than collecting them at the end.

FORMAT FOR EACH ITEM

## [Topic title](slack_permalink) — @author_name

**Why it matters:** 1 short paragraph explaining why this topic is important for engineers building real systems. Embed links inline where relevant.

**What it is:** 1 paragraph defining the tool, technique, system, or decision in concrete technical terms. Link directly to the Slack thread or linked doc at the point where the definition or framing comes from.

**How it works:** 1-3 paragraphs with the core mechanism. Be specific. Explain architecture, workflow, algorithm, protocol, data flow, evaluation method, migration plan, or implementation pattern. Include concrete examples, commands, APIs, schema details, benchmark numbers, or code snippets where useful. Every important factual claim should have an inline markdown link to the supporting Slack thread or document.

**Technical insights:**
- 1-3 bullets with specific engineering lessons, tradeoffs, failure modes, or reusable patterns.
- Embed source links directly in each bullet where relevant.
- Prefer actionable takeaways over generic observations.

---

QUALITY BAR

- Write for a software engineer, not a general audience.
- Be technically dense but readable.
- Prefer mechanism over marketing.
- Prefer concrete detail over vague summary.
- If claims are uncertain or debated in the thread, say so, with inline links to the relevant discussion.
- If the thread references performance, include the actual numbers when available and link them inline.
- If the discussion centers on a design decision, explain the alternatives and tradeoffs and link each major point inline.
- If linked docs add key context, inline that context so the note stands alone.
- Favor technically substantial items over merely interesting ones.
- Optimize for learning value: the reader should come away understanding the system, method, or decision, not just knowing that it was discussed.

SLACK PERMALINK FORMAT

https://dd.enterprise.slack.com/archives/${CHANNEL_ID}/p{message_ts_without_dot}

Example:
1775102456.789012 ->
https://dd.enterprise.slack.com/archives/${CHANNEL_ID}/p1775102456789012

ENDING

For successful digests only, at the very end add one blank line and then exactly:

- [ ] Review AI slack digest 📅 ${YESTERDAY}

IMPORTANT: Write ONLY the final markdown content to ${OUTPUT_FILE}. No preamble, no code fences, no commentary.
IMPORTANT: The file must be exactly one of these forms:
- The exact text: Nothing interesting yesterday.
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
  --model sonnet \
  --no-session-persistence \
  --allowedTools "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch,mcp__plugin_slack_slack__*" \
  > /dev/null; then
  echo "${LOG_PREFIX} Claude invocation failed; digest not created."
  exit 1
fi

if [[ ! -f "$OUTPUT_FILE" || ! -s "$OUTPUT_FILE" ]]; then
  echo "${LOG_PREFIX} Claude did not write the digest file; digest not created."
  exit 1
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
