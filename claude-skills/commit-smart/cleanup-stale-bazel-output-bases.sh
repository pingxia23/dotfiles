#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cleanup-stale-bazel-output-bases.sh [--apply] [output_root]

Description:
  Fast cleanup for stale Bazel output_base directories under output_root
  (default: ~/.cache/bazel/_bazel_bits).

  A stale output base:
  - contain DO_NOT_BUILD_HERE
  - referenced workspace path no longer exists

  Behavior:
  - Dry-run (default): print stale directories.
  - --apply: delete only a small batch per run (fast, not thorough).

  Controls:
  - BAZEL_STALE_CLEANUP_LIMIT (default: 3)
EOF
}

mode="dry-run"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ "${1:-}" == "--apply" ]]; then
  mode="apply"
  shift
fi

root="${1:-${BAZEL_OUTPUT_ROOT:-$HOME/.cache/bazel/_bazel_bits}}"
limit="${BAZEL_STALE_CLEANUP_LIMIT:-3}"

if [[ ! -d "$root" ]]; then
  echo "Bazel output root not found: $root"
  exit 0
fi

stale=()
while IFS= read -r -d '' dir; do
  marker="$dir/DO_NOT_BUILD_HERE"
  [[ -f "$marker" ]] || continue
  workspace_path="$(cat "$marker" 2>/dev/null || true)"
  [[ -n "$workspace_path" ]] || continue
  [[ -d "$workspace_path" ]] && continue
  stale+=("$dir")
done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -print0)

echo "Output root: $root"
echo "Stale output bases found: ${#stale[@]}"
echo "Cleanup batch limit: $limit"

if ((${#stale[@]} == 0)); then
  exit 0
fi

for dir in "${stale[@]}"; do
  marker="$dir/DO_NOT_BUILD_HERE"
  workspace_path="$(cat "$marker" 2>/dev/null || true)"
  echo "  $dir | workspace=$workspace_path"
done

if [[ "$mode" != "apply" ]]; then
  echo
  echo "Dry-run complete. Re-run with --apply for fast batch cleanup."
  exit 0
fi

echo
echo "Deleting stale output bases (fast batch)..."
deleted=0
failed=0
attempted=0

for dir in "${stale[@]}"; do
  if ((attempted >= limit)); then
    break
  fi
  [[ -d "$dir" ]] || continue
  attempted=$((attempted + 1))
  rm -rf -- "$dir" >/dev/null 2>&1 || true

  if [[ -d "$dir" ]]; then
    echo "FAILED: $dir"
    failed=$((failed + 1))
  else
    echo "OK: $dir"
    deleted=$((deleted + 1))
  fi
done

echo
echo "Attempted: $attempted"
echo "Deleted: $deleted"
echo "Failed: $failed"
echo "Run again to clean the next stale batch if needed."
df -h "$HOME/.cache" | tail -n +2 || true

if ((failed > 0)); then
  exit 1
fi
