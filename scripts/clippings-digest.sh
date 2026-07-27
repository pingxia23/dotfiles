#!/bin/bash
set -euo pipefail

CLIPPINGS_DIR="$HOME/Documents/obsidian/Digests/clippings"
DIGEST_DIR="$HOME/Documents/obsidian/Digests/clippings_digest"
SAVED_DIR="$HOME/Documents/obsidian/Digests/saved"
LOG_PREFIX="[clippings-digest]"

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
if ! command -v claude >/dev/null 2>&1; then
  log_error "claude CLI is not installed or not on PATH."
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

# --- Build prompt ---
TODAY=$(/bin/date +%Y-%m-%d)
PROMPT_FILE=$(mktemp /tmp/clippings-digest-prompt.XXXXXX)
trap 'rm -f "$PROMPT_FILE"' EXIT

{
  cat <<PROMPT_EOF
Create learning digest notes from web clippings.

For each source file listed below, read it and create a corresponding digest file in the output directory.

OUTPUT DIRECTORY: ${DIGEST_DIR}

For each source file, write a digest file at: ${DIGEST_DIR}/<same filename as source>

STYLE

Use plain English as much as possible. Avoid dense, abstract phrasing. Say what you mean in simple sentences. For example, don't write "Calibrate upward from a sustainable baseline rather than pushing agent count until something breaks." Instead write "Start with fewer threads than you're tempted to use, because the failure mode is subtle: you still feel productive, but your review quality drops."

FRONTMATTER RULES
- Preserve the original YAML frontmatter from the source file exactly, but make these changes:
  - Replace the "clippings" tag with "clippings/digest"
  - Add a field: digest_created: ${TODAY}
- Do not add or remove any other frontmatter fields.

DIGEST BODY FORMAT

After the closing --- of the frontmatter, write the digest using this structure:

## Key Takeaways

3-5 bullet points. Each bullet is one concrete learning from the article. Format each as:

- **[Short imperative phrase]** — 1-2 sentences explaining the reasoning or motivation behind this recommendation. Be specific enough that the reader can learn from it without reading the original.


## Best Practices

(Include this section only if the article suggests concrete actions, habits, or workflows.)

1-3 bullet points. Each is a specific, actionable step the reader can try in their own work. Start each with a verb.

QUALITY GUIDELINES
- Be technically precise. Preserve specific numbers, thresholds, tool names, and techniques from the article.
- Write for a software engineer. No generic self-help language.
- Each bullet should stand alone. A reader should get value from any single bullet without reading the others.
- Prefer the author's concrete examples over abstract restatements.
- Total digest body (after frontmatter) should be 200-500 words.
- Do not include a title heading (the frontmatter title is sufficient for Obsidian).

ENDING

For each digest file, at the very end add one blank line and then exactly:

- [ ] Review digest "{title}" 📅 ${TODAY}

where {title} is the title from the source file's YAML frontmatter.

IMPORTANT: For each source file, write the digest file directly. No preamble, no code fences, no commentary.
IMPORTANT: Each output file must start with --- (YAML frontmatter opening) on the first line.
IMPORTANT: If a source file cannot be read or is empty, skip it and move on to the next.

SOURCE FILES TO PROCESS:
PROMPT_EOF

  for f in "${FILES_TO_PROCESS[@]}"; do
    echo "- ${f}"
  done
} > "$PROMPT_FILE"

# --- Invoke Claude ---
log "Invoking claude..."
if ! claude -p "$(cat "$PROMPT_FILE")" \
  --model 'claude-opus-4-6[1m]' \
  --allow-dangerously-skip-permissions \
  --no-session-persistence \
  > /dev/null; then
  log_error "Claude invocation failed."
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
