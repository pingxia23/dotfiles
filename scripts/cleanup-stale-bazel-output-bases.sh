#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cleanup-stale-bazel-output-bases.sh

Run `bzl dd disk-space gc`, then prune local disk-cache files older than 30 days.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "This script does not accept arguments."
  usage
  exit 1
fi

echo "Running: bzl dd disk-space gc"
bzl dd disk-space gc

prune_old_disk_cache() {
  local disk_dir=""
  local found_any=0

  for disk_dir in "$HOME/.cache/bazel/disk" "$HOME/Library/Caches/bazel/disk"; do
    [[ -d "$disk_dir" ]] || continue
    found_any=1
    echo "Pruning disk-cache files last accessed more than 30 days ago: $disk_dir"
    find "$disk_dir" -atime +30 -type f -print0 | xargs -0 -r rm -f --
  done

  if [[ "$found_any" == "0" ]]; then
    echo "No local Bazel disk cache directories found."
  fi
}

prune_old_disk_cache
