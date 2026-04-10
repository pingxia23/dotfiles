#!/bin/bash
set -euo pipefail

VAULT_ROOT="$HOME/Documents/obsidian/Knowledge"
RAW_ROOT="$VAULT_ROOT/raw"
WIKI_ROOT="$VAULT_ROOT/wiki"
WIKI_SOURCES_DIR="$WIKI_ROOT/sources"
WIKI_TOPICS_DIR="$WIKI_ROOT/topics"
REVIEW_SCRIPT="$HOME/dotfiles/scripts/wiki-review.py"
LOG_PREFIX="[wiki-update]"

log() {
  printf '%s %s\n' "$LOG_PREFIX" "$1"
}

log_error() {
  printf '%s %s\n' "$LOG_PREFIX" "$1" >&2
}

usage() {
  cat <<'EOF'
Usage: wiki-update.sh [--rebuild]

  --rebuild  Delete wiki/sources and remove wiki/topics, then rebuild sources and index from all raw notes.
EOF
}

RUN_MODE="incremental"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)
      RUN_MODE="rebuild"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v claude >/dev/null 2>&1; then
  log_error "claude CLI is not installed or not on PATH."
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

if [[ ! -d "$RAW_ROOT" ]]; then
  log_error "Missing raw source directory at $RAW_ROOT"
  exit 1
fi

TIMESTAMP=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
REVIEW_SCOPE_ENTRIES=()
RECORD_MODE="review"
RUN_NOTE="Scheduled incremental wiki update."
PROMPT_TITLE="Run the scheduled incremental wiki review for this vault."
SCOPE_LABEL="Changed raw files:"

if [[ "$RUN_MODE" == "rebuild" ]]; then
  rm -rf "$WIKI_SOURCES_DIR" "$WIKI_TOPICS_DIR"
  mkdir -p "$WIKI_SOURCES_DIR"
  while IFS= read -r source_file; do
    REVIEW_SCOPE_ENTRIES+=("$source_file")
  done < <(
    find "$RAW_ROOT" -type f -name '*.md' | LC_ALL=C sort | while IFS= read -r absolute_path; do
      printf '%s\n' "${absolute_path#$VAULT_ROOT/}"
    done
  )
  RECORD_MODE="bootstrap"
  RUN_NOTE="Scheduled full wiki rebuild."
  PROMPT_TITLE="Run a full wiki rebuild for this vault."
  SCOPE_LABEL="Raw files in scope:"
else
  CHANGED_JSON=$(python3 "$REVIEW_SCRIPT" --vault-root "$VAULT_ROOT" list-changed)
  while IFS= read -r changed_file; do
    REVIEW_SCOPE_ENTRIES+=("$changed_file")
  done < <(
    printf '%s' "$CHANGED_JSON" | python3 -c 'import json,sys; [print(item["path"] + (" [deleted]" if item.get("deleted") else "")) for item in json.load(sys.stdin)["changed_files"]]'
  )
fi

if [[ "${#REVIEW_SCOPE_ENTRIES[@]}" -eq 0 ]]; then
  exit 0
fi

if [[ "$RUN_MODE" == "rebuild" ]]; then
  log "Starting full wiki rebuild at ${TIMESTAMP}"
  log "Reset generated wiki content:"
  log "  - wiki/sources"
  log "  - removed wiki/topics"
else
  log "Starting incremental wiki review at ${TIMESTAMP}"
fi
log "${SCOPE_LABEL}"
for scope_entry in "${REVIEW_SCOPE_ENTRIES[@]}"; do
  log "  - ${scope_entry}"
done

PROMPT_FILE=$(mktemp /tmp/wiki-update-prompt.XXXXXX)
trap 'rm -f "$PROMPT_FILE"' EXIT

{
  echo "$PROMPT_TITLE"
  echo "Follow ${VAULT_ROOT}/AGENTS.md exactly."
  echo
  echo "Wrapper-provided log timestamp:"
  echo "- ${TIMESTAMP}"
  echo
  if [[ "$RUN_MODE" == "rebuild" ]]; then
    echo "The wrapper already deleted wiki/sources and removed wiki/topics before this run."
    echo "Rebuild wiki/sources/ and refresh wiki/index.md from raw/."
    echo "Do not recreate wiki/topics/."
    echo "Do not delete wiki/log.md history."
    echo
  fi
  echo "$SCOPE_LABEL"
  for scope_entry in "${REVIEW_SCOPE_ENTRIES[@]}"; do
    echo "- ${scope_entry}"
  done
} > "$PROMPT_FILE"

log "Invoking claude..."
if ! (
  cd "$VAULT_ROOT" &&
  claude -p "$(cat "$PROMPT_FILE")" \
    --model claude-opus-4-6 \
    --effort medium \
    --allow-dangerously-skip-permissions \
    --no-session-persistence
  > /dev/null
) ; then
  log_error "Claude invocation failed."
  exit 1
fi

RECORD_ARGS=(
  python3 "$REVIEW_SCRIPT"
  --vault-root "$VAULT_ROOT"
  record-run
  --mode "$RECORD_MODE"
  --completed-at "$TIMESTAMP"
  --note "$RUN_NOTE"
)

for scope_entry in "${REVIEW_SCOPE_ENTRIES[@]}"; do
  RECORD_ARGS+=(--reviewed-file "${scope_entry% \[deleted\]}")
done

"${RECORD_ARGS[@]}"
log "Wiki update completed."
