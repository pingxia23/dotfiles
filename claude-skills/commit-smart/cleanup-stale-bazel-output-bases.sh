#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cleanup-stale-bazel-output-bases.sh [--apply] [output_root]

Description:
  Fast cleanup for Bazel output_base directories under one or more output roots.

  Root selection:
  - explicit output_root argument
  - BAZEL_OUTPUT_ROOT
  - auto-discovered Bazel user roots under:
    * ~/Library/Caches/bazel
    * ~/.cache/bazel

  Candidate types:
  - stale:
    * contains DO_NOT_BUILD_HERE
    * referenced workspace path no longer exists
  - inactive_old:
    * contains DO_NOT_BUILD_HERE
    * not the current workspace
    * older than BAZEL_OLD_OUTPUT_BASE_MAX_AGE_DAYS
    * only considered when BAZEL_CLEANUP_INCLUDE_INACTIVE_OLD=1

  Behavior:
  - Dry-run (default): print reclaim candidates.
  - --apply: delete only a small batch per run.

  Controls:
  - BAZEL_STALE_CLEANUP_LIMIT (default: 3)
  - BAZEL_OLD_OUTPUT_BASE_MAX_AGE_DAYS (default: 7)
  - BAZEL_CLEANUP_INCLUDE_INACTIVE_OLD (default: 0)
  - CURRENT_WORKSPACE_ROOT (default: $PWD)
EOF
}

declare -a ROOTS=()
declare -a CANDIDATES=()

add_root() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0

  local existing
  for existing in "${ROOTS[@]}"; do
    [[ "$existing" == "$dir" ]] && return 0
  done

  ROOTS+=("$dir")
}

normalize_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 1
  (
    cd "$dir" >/dev/null 2>&1
    pwd -P
  )
}

discover_roots() {
  local explicit_root="${1:-}"
  local search_root=""
  local marker=""

  if [[ -n "$explicit_root" ]]; then
    marker="$explicit_root/DO_NOT_BUILD_HERE"
    if [[ -f "$marker" ]]; then
      add_root "$(dirname "$explicit_root")"
    else
      add_root "$explicit_root"
    fi
    return 0
  fi

  if [[ -n "${BAZEL_OUTPUT_ROOT:-}" ]]; then
    add_root "$BAZEL_OUTPUT_ROOT"
  fi

  for search_root in "$HOME/Library/Caches/bazel" "$HOME/.cache/bazel"; do
    [[ -d "$search_root" ]] || continue

    while IFS= read -r -d '' dir; do
      add_root "$dir"
    done < <(find "$search_root" -mindepth 1 -maxdepth 1 -type d -name '_bazel_*' -print0 2>/dev/null)
  done
}

mtime_epoch() {
  local dir="$1"

  if stat -f %m "$dir" >/dev/null 2>&1; then
    stat -f %m "$dir"
  else
    stat -c %Y "$dir"
  fi
}

candidate_record() {
  local category="$1"
  local priority="$2"
  local size_kb="$3"
  local age_days="$4"
  local dir="$5"
  local workspace_path="$6"

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$priority" "$size_kb" "$age_days" "$category" "$dir" "$workspace_path"
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

explicit_root="${1:-}"
limit="${BAZEL_STALE_CLEANUP_LIMIT:-3}"
old_age_days="${BAZEL_OLD_OUTPUT_BASE_MAX_AGE_DAYS:-7}"
include_inactive_old="${BAZEL_CLEANUP_INCLUDE_INACTIVE_OLD:-0}"
current_workspace_root="${CURRENT_WORKSPACE_ROOT:-$PWD}"

discover_roots "$explicit_root"

if ((${#ROOTS[@]} == 0)); then
  if [[ -n "$explicit_root" ]]; then
    echo "Bazel output root not found: $explicit_root"
  else
    echo "No Bazel output roots found."
  fi
  exit 0
fi

current_workspace_resolved=""
if current_workspace_resolved="$(normalize_dir "$current_workspace_root" 2>/dev/null)"; then
  :
else
  current_workspace_resolved="$current_workspace_root"
fi

now_epoch="$(date +%s)"
inspected_roots=0

while IFS= read -r root; do
  inspected_roots=$((inspected_roots + 1))

  while IFS= read -r -d '' dir; do
    local_marker="$dir/DO_NOT_BUILD_HERE"
    [[ -f "$local_marker" ]] || continue

    workspace_path="$(cat "$local_marker" 2>/dev/null || true)"
    [[ -n "$workspace_path" ]] || continue

    workspace_resolved="$workspace_path"
    if normalized_workspace="$(normalize_dir "$workspace_path" 2>/dev/null)"; then
      workspace_resolved="$normalized_workspace"
    fi

    if [[ "$workspace_resolved" == "$current_workspace_resolved" ]]; then
      continue
    fi

    size_kb="$(du -sk "$dir" 2>/dev/null | awk '{print $1}')"
    size_kb="${size_kb:-0}"

    dir_mtime="$(mtime_epoch "$dir")"
    age_days=$(((now_epoch - dir_mtime) / 86400))

    if [[ ! -d "$workspace_path" ]]; then
      CANDIDATES+=("$(candidate_record stale 0 "$size_kb" "$age_days" "$dir" "$workspace_path")")
      continue
    fi

    if [[ "$include_inactive_old" == "1" ]] && ((age_days >= old_age_days)); then
      CANDIDATES+=("$(candidate_record inactive_old 1 "$size_kb" "$age_days" "$dir" "$workspace_path")")
    fi
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)
done < <(printf '%s\n' "${ROOTS[@]}")

echo "Output roots inspected: $inspected_roots"
printf '  %s\n' "${ROOTS[@]}"
echo "Cleanup batch limit: $limit"
echo "Inactive-old age threshold (days): $old_age_days"
echo "Include inactive-old cleanup: $include_inactive_old"
echo "Current workspace protected: $current_workspace_resolved"
echo "Reclaim candidates found: ${#CANDIDATES[@]}"

if ((${#CANDIDATES[@]} == 0)); then
  echo "No reclaim candidates found."
  exit 0
fi

sorted_candidates="$(
  printf '%s\n' "${CANDIDATES[@]}" \
    | sort -t $'\t' -k1,1n -k2,2nr -k3,3nr
)"

total_reclaim_kb=0
while IFS=$'\t' read -r priority size_kb age_days category dir workspace_path; do
  [[ -n "$dir" ]] || continue
  total_reclaim_kb=$((total_reclaim_kb + size_kb))
  printf '  [%s] %s | size=%sK | age=%sd | workspace=%s\n' "$category" "$dir" "$size_kb" "$age_days" "$workspace_path"
done <<< "$sorted_candidates"

echo "Estimated reclaimable size: ${total_reclaim_kb}K"

if [[ "$mode" != "apply" ]]; then
  echo
  echo "Dry-run complete. Re-run with --apply to delete the top reclaim candidates."
  exit 0
fi

echo
echo "Deleting reclaim candidates..."
deleted=0
failed=0
attempted=0

while IFS=$'\t' read -r priority size_kb age_days category dir workspace_path; do
  [[ -n "$dir" ]] || continue
  if ((attempted >= limit)); then
    break
  fi
  [[ -d "$dir" ]] || continue
  attempted=$((attempted + 1))
  rm -rf -- "$dir" >/dev/null 2>&1 || true

  if [[ -d "$dir" ]]; then
    echo "FAILED: [$category] $dir"
    failed=$((failed + 1))
  else
    echo "OK: [$category] $dir"
    deleted=$((deleted + 1))
  fi
done <<< "$sorted_candidates"

echo
echo "Attempted: $attempted"
echo "Deleted: $deleted"
echo "Failed: $failed"
echo "Run again to clean the next batch if needed."

df_target="$HOME"
if [[ -d "$HOME/Library/Caches" ]]; then
  df_target="$HOME/Library/Caches"
elif [[ -d "$HOME/.cache" ]]; then
  df_target="$HOME/.cache"
fi
df -h "$df_target" | tail -n +2 || true

if ((failed > 0)); then
  exit 1
fi
