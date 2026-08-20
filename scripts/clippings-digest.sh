#!/bin/bash
set -euo pipefail

CLIPPINGS_DIR="$HOME/Documents/obsidian/Digests/clippings"
DIGEST_DIR="$HOME/Documents/obsidian/Digests/clippings_digest"
SAVED_DIR="$HOME/Documents/obsidian/Digests/saved"
LOG_PREFIX="[clippings-digest]"
DIGEST_ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/learning-digest.mjs"

log() {
  printf '%s %s\n' "$LOG_PREFIX" "$1"
}

log_error() {
  printf '%s %s\n' "$LOG_PREFIX" "$1" >&2
}

usage() {
  cat <<'EOF'
Usage: clippings-digest.sh [--rebuild]

  --rebuild  Delete all existing digests, then regenerate from all clippings.
EOF
}

needs_processing() {
  local source_file="$1"
  local digest_file="$2"

  if [[ ! -f "$digest_file" ]]; then
    return 0
  fi

  if [[ ! -s "$digest_file" ]]; then
    return 0
  fi

  if [[ "$source_file" -nt "$digest_file" ]]; then
    return 0
  fi

  return 1
}

archive_completed_digests() {
  local digest_file
  local basename
  local saved_file
  local archived_count=0

  mkdir -p "$SAVED_DIR"
  while IFS= read -r -d '' digest_file; do
    if ! grep -Eq '^[[:space:]]*-[[:space:]]+\[[[:space:]]\][[:space:]]+Review digest([[:space:]]|$)' "$digest_file"; then
      if [[ ! -s "$digest_file" ]]; then
        rm -f "$digest_file"
        continue
      fi
      basename=$(basename "$digest_file")
      saved_file="${SAVED_DIR}/${basename}"
      if [[ -f "$saved_file" && ! "$digest_file" -nt "$saved_file" ]]; then
        rm -f "$digest_file"
        continue
      fi
      mv -f "$digest_file" "$saved_file"
      log "Archived: ${basename}"
      archived_count=$((archived_count + 1))
    fi
  done < <(find "$DIGEST_DIR" -maxdepth 1 -type f -name '*.md' -print0)

  log "Archived ${archived_count} completed digests."
}

# --- Argument parsing ---
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

# --- Prerequisites ---
if ! command -v codex >/dev/null 2>&1; then
  log_error "codex CLI is not installed or not on PATH."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  log_error "python3 is not installed or not on PATH."
  exit 1
fi

if [[ ! -d "$CLIPPINGS_DIR" ]]; then
  log_error "Source directory does not exist: $CLIPPINGS_DIR"
  exit 1
fi

mkdir -p "$DIGEST_DIR"

# --- Rebuild: clear existing digests ---
if [[ "$RUN_MODE" == "rebuild" ]]; then
  log "Rebuild mode: removing all existing digests."
  python3 -c "
import pathlib
for p in pathlib.Path('$DIGEST_DIR').glob('*.md'):
    p.unlink()
"
fi

# --- Collect files to process ---
FILES_TO_PROCESS=()
while IFS= read -r source_file; do
  basename=$(basename "$source_file")
  digest_file="${DIGEST_DIR}/${basename}"
  saved_file="${SAVED_DIR}/${basename}"
  if [[ "$RUN_MODE" == "rebuild" ]]; then
    FILES_TO_PROCESS+=("$source_file")
  elif needs_processing "$source_file" "$digest_file" &&
    needs_processing "$source_file" "$saved_file"; then
    FILES_TO_PROCESS+=("$source_file")
  fi
done < <(python3 -c "
import pathlib
for p in sorted(pathlib.Path('$CLIPPINGS_DIR').glob('*.md')):
    print(p)
")

if [[ "${#FILES_TO_PROCESS[@]}" -eq 0 ]]; then
  log "No clippings need processing."
  archive_completed_digests
  exit 0
fi

log "Files to process: ${#FILES_TO_PROCESS[@]}"
for f in "${FILES_TO_PROCESS[@]}"; do
  log "  - $(basename "$f")"
done

# --- Invoke Codex ---
TODAY=$(/bin/date +%Y-%m-%d)
log "Invoking codex..."
if ! node "$DIGEST_ENGINE" clippings "$DIGEST_DIR" "$TODAY" \
  "${FILES_TO_PROCESS[@]}"; then
  log_error "Codex invocation failed."
  exit 1
fi

# --- Verify outputs ---
SUCCESS_COUNT=0
FAIL_COUNT=0
for source_file in "${FILES_TO_PROCESS[@]}"; do
  basename=$(basename "$source_file")
  digest_file="${DIGEST_DIR}/${basename}"
  if [[ -f "$digest_file" && -s "$digest_file" ]]; then
    log "Created: ${basename}"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    log_error "Missing: ${basename}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# --- Archive reviewed digests ---
archive_completed_digests
log "Complete. ${SUCCESS_COUNT} succeeded, ${FAIL_COUNT} failed."
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
