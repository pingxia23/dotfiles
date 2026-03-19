#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cleanup-stale-bazel-output-bases.sh [--apply] [output_root]

Default is dry-run. With --apply, delete all Bazel output bases except the one
for active dd-source worktrees and CURRENT_WORKSPACE_ROOT (or PWD).
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

current_workspace="${CURRENT_WORKSPACE_ROOT:-$PWD}"
if current_resolved="$(cd "$current_workspace" 2>/dev/null && pwd -P)"; then
  current_workspace="$current_resolved"
fi

collect_protected_workspaces() {
  local dd_repo=""
  local wt=""
  printf '%s\n' "$current_workspace"
  for dd_repo in "$HOME/dd/dd-source" "$HOME/go/src/github.com/DataDog/dd-source"; do
    [[ -d "$dd_repo/.git" || -f "$dd_repo/.git" ]] || continue
    git -C "$dd_repo" worktree list --porcelain 2>/dev/null \
      | awk '/^worktree /{sub(/^worktree /,""); print $0}' \
      | while IFS= read -r wt; do
          if resolved="$(cd "$wt" 2>/dev/null && pwd -P)"; then
            printf '%s\n' "$resolved"
          else
            printf '%s\n' "$wt"
          fi
        done
    break
  done
}

is_protected_workspace() {
  local workspace="$1"
  local p=""
  for p in "${protected_workspaces[@]}"; do
    [[ "$workspace" == "$p" ]] && return 0
  done
  return 1
}

find_roots() {
  if [[ -n "${1:-}" ]]; then
    printf '%s\n' "$1"
    return 0
  fi
  if [[ -n "${BAZEL_OUTPUT_ROOT:-}" ]]; then
    printf '%s\n' "$BAZEL_OUTPUT_ROOT"
    return 0
  fi
  [[ -d "$HOME/.cache/bazel" ]] && find "$HOME/.cache/bazel" -mindepth 1 -maxdepth 1 -type d -name '_bazel_*' -print
  [[ -d "$HOME/Library/Caches/bazel" ]] && find "$HOME/Library/Caches/bazel" -mindepth 1 -maxdepth 1 -type d -name '_bazel_*' -print
}

mapfile -t roots < <(find_roots "${1:-}" | awk 'NF && !seen[$0]++')
if ((${#roots[@]} == 0)); then
  echo "No Bazel output roots found."
  exit 0
fi
mapfile -t protected_workspaces < <(collect_protected_workspaces | awk 'NF && !seen[$0]++')

mapfile -t victims < <(
  for root in "${roots[@]}"; do
    [[ -d "$root" ]] || continue
    find "$root" -mindepth 1 -maxdepth 1 -type d -print0
  done | while IFS= read -r -d '' base; do
    marker="$base/DO_NOT_BUILD_HERE"
    [[ -f "$marker" ]] || continue
    workspace="$(cat "$marker" 2>/dev/null || true)"
    [[ -n "$workspace" ]] || continue
    if resolved="$(cd "$workspace" 2>/dev/null && pwd -P)"; then
      workspace="$resolved"
    fi
    is_protected_workspace "$workspace" && continue
    printf '%s\n' "$base"
  done
)

echo "Protected workspaces (${#protected_workspaces[@]}):"
printf '  %s\n' "${protected_workspaces[@]}"
echo "Candidates: ${#victims[@]}"
printf '  %s\n' "${victims[@]}"

if [[ "$mode" != "apply" ]]; then
  echo "Dry-run complete. Re-run with --apply."
  exit 0
fi

deleted=0
failed=0
for base in "${victims[@]}"; do
  chmod -R u+w "$base" >/dev/null 2>&1 || true
  rm -rf -- "$base" >/dev/null 2>&1 || true
  if [[ -d "$base" ]]; then
    echo "FAILED: $base"
    failed=$((failed + 1))
  else
    echo "OK: $base"
    deleted=$((deleted + 1))
  fi
done

echo "Deleted: $deleted"
echo "Failed: $failed"
[[ -d "$HOME/.cache" ]] && df -h "$HOME/.cache" | tail -n +2 || true
[[ -d "$HOME/Library/Caches" ]] && df -h "$HOME/Library/Caches" | tail -n +2 || true

((failed == 0))
