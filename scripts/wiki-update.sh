#!/bin/bash
set -euo pipefail

VAULT_ROOT="$HOME/Documents/obsidian/Knowledge"
REVIEW_SCRIPT="$VAULT_ROOT/tools/wiki_review.py"
RUN_LOG_DIR="$VAULT_ROOT/wiki/logs"
RUN_LOG_FILE="$RUN_LOG_DIR/wiki-update.log"
ERR_LOG_FILE="$RUN_LOG_DIR/wiki-update.err"
LOG_PREFIX="[wiki-update]"

log() {
  mkdir -p "$RUN_LOG_DIR"
  printf '%s %s\n' "$LOG_PREFIX" "$1" >> "$RUN_LOG_FILE"
}

log_error() {
  mkdir -p "$RUN_LOG_DIR"
  printf '%s %s\n' "$LOG_PREFIX" "$1" >> "$ERR_LOG_FILE"
}

if ! command -v codex >/dev/null 2>&1; then
  log_error "codex CLI is not installed or not on PATH."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  log_error "python3 is not installed or not on PATH."
  exit 1
fi

if [[ ! -f "$REVIEW_SCRIPT" ]]; then
  log_error "Missing review helper at $REVIEW_SCRIPT"
  exit 1
fi

TIMESTAMP=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)

CHANGED_JSON=$(python3 "$REVIEW_SCRIPT" --vault-root "$VAULT_ROOT" list-changed)
CHANGED_COUNT=$(printf '%s' "$CHANGED_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["changed_files"]))')

if [[ "$CHANGED_COUNT" -eq 0 ]]; then
  exit 0
fi

mapfile -t CHANGED_FILES < <(
  printf '%s' "$CHANGED_JSON" | python3 -c 'import json,sys; [print(item["path"]) for item in json.load(sys.stdin)["changed_files"]]'
)

log "Starting incremental wiki review at ${TIMESTAMP}"
log "Changed files:"
for changed_file in "${CHANGED_FILES[@]}"; do
  log "  - ${changed_file}"
done

PROMPT_FILE=$(mktemp /tmp/wiki-update-prompt.XXXXXX)
LAST_MESSAGE_FILE=$(mktemp /tmp/wiki-update-last-message.XXXXXX)
trap 'rm -f "$PROMPT_FILE" "$LAST_MESSAGE_FILE"' EXIT

{
  echo "Run the scheduled incremental wiki review for this vault."
  echo "Follow ${VAULT_ROOT}/AGENTS.md exactly."
  echo
  echo "Wrapper-provided log timestamp:"
  echo "- ${TIMESTAMP}"
  echo
  echo "Changed raw files:"
  for changed_file in "${CHANGED_FILES[@]}"; do
    echo "- ${changed_file}"
  done
  echo
  echo "At the end, output a short summary of the files you changed."
} > "$PROMPT_FILE"

codex exec \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  -C "$VAULT_ROOT" \
  -o "$LAST_MESSAGE_FILE" \
  - < "$PROMPT_FILE" >> "$RUN_LOG_FILE" 2>> "$ERR_LOG_FILE"

RECORD_ARGS=(
  python3 "$REVIEW_SCRIPT"
  --vault-root "$VAULT_ROOT"
  record-run
  --mode review
  --completed-at "$TIMESTAMP"
  --note "Scheduled incremental wiki update."
)

for changed_file in "${CHANGED_FILES[@]}"; do
  RECORD_ARGS+=(--reviewed-file "$changed_file")
done

"${RECORD_ARGS[@]}"

log "Codex summary:"
while IFS= read -r line; do
  log "$line"
done < "$LAST_MESSAGE_FILE"
