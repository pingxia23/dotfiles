#!/usr/bin/env bash
set -euo pipefail

# Discover bzl test targets for changed files in the current repository checkout
# (primary checkout or linked worktree).
# Intended for use by the commit-smart skill.
# Uses git diff to find changed code files, walks up to find the nearest
# BUILD.bazel directory, and queries bzl for test targets.
#
# Usage: discover-test-targets.sh
# Output: One test target per line, or nothing if no targets found.
# Exit:   0 always (no targets is not an error).

CODE_EXTENSIONS='\.py$|\.go$|\.c$|\.cc$|\.cpp$|\.h$|\.hpp$|\.java$|\.js$|\.ts$|\.tsx$|\.jsx$|\.rs$|\.rb$|\.swift$|\.kt$|\.scala$|\.sh$|\.bash$'

# Normalize to git top-level so changed file paths and package discovery work
# when invoked from any subdirectory or git worktree.
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$repo_root" ]]; then
    exit 0
fi
cd "$repo_root"

# Walk up from a file to find the nearest directory with BUILD.bazel or BUILD.
# Reuses pattern from ~/dotfiles/dd-source/.git-hooks/pre-commit:64-74
find_bazel_package() {
    local file="$1"
    local dir
    dir=$(dirname "$file")
    while [[ "$dir" != "." && "$dir" != "/" ]]; do
        if [[ -f "$dir/BUILD.bazel" || -f "$dir/BUILD" ]]; then
            echo "$dir"
            return
        fi
        dir=$(dirname "$dir")
    done
}

# Collect changed code files (staged + unstaged)
changed_files=$( (git diff --name-only; git diff --cached --name-only) | sort -u )

# Filter to code files only
code_files=$(echo "$changed_files" | grep -E "$CODE_EXTENSIONS" || true)

if [[ -z "$code_files" ]]; then
    exit 0
fi

# Find unique BUILD.bazel directories for all changed code files
build_dirs=""
while IFS= read -r file; do
    [[ -f "$file" ]] || continue  # skip deleted files
    pkg=$(find_bazel_package "$file")
    if [[ -n "$pkg" ]]; then
        build_dirs+="$pkg"$'\n'
        # Also check for tests/ subdirectory with its own BUILD
        if [[ -d "$pkg/tests" ]] && [[ -f "$pkg/tests/BUILD.bazel" || -f "$pkg/tests/BUILD" ]]; then
            build_dirs+="$pkg/tests"$'\n'
        fi
    fi
done <<< "$code_files"

build_dirs=$(echo "$build_dirs" | sed '/^$/d' | sort -u)

if [[ -z "$build_dirs" ]]; then
    exit 0
fi

# Query bzl for test targets in each directory (sequentially — never parallelize bzl)
all_targets=""
while IFS= read -r dir; do
    targets=$(bzl query "tests(//$dir:*)" 2>/dev/null || true)
    if [[ -n "$targets" ]]; then
        all_targets+="$targets"$'\n'
    fi
done <<< "$build_dirs"

# Output unique targets
echo "$all_targets" | sed '/^$/d' | sort -u
