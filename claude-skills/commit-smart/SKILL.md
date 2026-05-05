---
name: commit-smart
description: "Deterministic workflow to stage changes, run bzl tests when applicable, commit with hooks, push, and create a draft GitHub PR only when one does not already exist. Trigger this skill whenever the user asks to commit (for example: 'commit', 'commit this', 'please commit')."
---

Perform a deterministic smart-commit workflow.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- For pre-commit hook failures, inspect, fix, and retry until commit succeeds

## Step 0: Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so all subsequent commands run from the repo root even if invoked from nested cwd.
3. Detect merge-commit state:
   - Set `merge_in_progress=true` when `git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1` succeeds.
   - This applies only to the merge commit Git is already preparing.

## Step 1: Run Tests For Affected Packages (Disabled - handled by pre-commit)

<!--
0. Scope gate:
   - Apply this step ONLY when `in_dd_scope=true`.
   - If `in_dd_scope=false`, skip Step 1 and proceed to Step 2.
1. Check if any code files are changed:
   - Use `git diff --name-only` and `git diff --cached --name-only` to get all changed files.
   - Code file extensions include: `.py`, `.go`, `.c`, `.cc`, `.cpp`, `.h`, `.hpp`, `.java`, `.js`, `.ts`, `.tsx`, `.jsx`, `.rs`, `.rb`, `.swift`, `.kt`, `.scala`, `.sh`, `.bash`.
   - If NO code files are changed (only config, docs, markdown, yaml, json, etc.), **skip all testing** and proceed directly to Step 2.
2. Discover test targets:
   - Run via absolute path so it works from any nested cwd inside the primary checkout or a linked worktree:
     - `"$HOME/dotfiles/claude-skills/commit-smart/discover-test-targets.sh"`
   - The script walks up from each changed file to find the nearest `BUILD.bazel` directory,
     checks for sibling `tests/` directories, and queries bzl for test targets.
3. Execute tests:
   - If the script outputs targets: `bzl test --test_output=summary <targets...>`.
   - If no targets found: skip testing (no test targets associated with changed files).
4. Do not skip or comment out failing tests.
5. Never use `--test_filter`.
-->

## Step 2: Stage And Review Changes

1. Stage changes while excluding working artifacts:
   ```bash
   git add -A -- ':(top,exclude)designs/' ':(top,exclude)plans/' ':(top,exclude)exploration/'
   ```
2. Review staged contents before commit:
   - `git diff --cached --name-status`
3. If nothing is staged, stop and inform the user.

## Step 3: Compose Commit Message

1. do not use `--no-verify` unless the user explicitly asks.
2. If `merge_in_progress=false`, write a message that:
   - Explains why the change is needed.
   - Uses a concise subject and optional body.
   - commit using HEREDOC:

   ```bash
   git commit -m "$(cat <<'EOF'
   <subject>

   <optional body>
   EOF
   )"
   ```

## Step 4: Fix Pre-commit Failures Until Commit Succeeds

If `git commit` fails due to hooks:

1. Parse hook output and identify the failing check.
2. Always preserve the full failed commit output for inspection before deciding the next action.
3. In dd-scope, treat the failure as Bazel disk pressure if either of these is true:
   - the captured commit output contains any of:
     - `No space left on device`
     - `ENOSPC`
     - `Disk quota exceeded`
   - the hook failed in a Bazel-related phase (`bzl`, `bazel`, `sandbox`, `test.log`, `output base`, `tests failed`) and the agent can find any of the same disk-pressure strings in nearby Bazel log output or recent Bazel stderr/test logs
   - Do not require the disk-pressure string and Bazel path text to appear on the same line.
4. If the failure matches the Bazel disk-pressure case:
   - Follow the hard rule above: launch a fresh sub-agent and use the `disk-pressure-recovery` skill before retrying the commit.
   - Retry the commit after the recovery step completes.
   - For non-merge commits, do NOT use `--no-verify` unless the user explicitly asks you to use it.
   - Do NOT use `bzl clean` for this issue.
5. If the failure is not a Bazel disk-pressure case, fix issues in code/config/message, re-stage, retry.
6. Repeat until `git commit` succeeds.
7. Stop only for external blockers (auth/network/tool outage) or when the same disk-pressure failure persists after the recovery step; report exact output in either case.

## Step 5: Push

1. Push after successful commit:
   - `git push`
2. If push fails, stop and show exact error output.

## Step 6: Create Draft PR Only If Missing (WIP Title)

Intent:

- Create a new draft PR only when no open PR exists for the current branch.
- If an open PR already exists for the branch, skip PR creation step and do not edit title/body/state.

1. Confirm GitHub auth if needed:
   - `gh auth status`
2. IMPORTANT: Pass `--repo "$repo"` to all `gh pr` commands in this step to avoid cwd/worktree/symlink repo-resolution failures.
3. Detect whether a PR already exists for the current branch:
   - `pr_url=$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url // empty' 2>/dev/null)`
4. If `pr_url` exists:
   - Skip the rest of Step 6.
   - Reuse the existing URL only for the final user-facing PR link.
5. If `pr_url` is empty, read latest commit context:
   - `latest_commit_body=$(git log -1 --pretty=%B)`
   - `git show --name-status --format=fuller --no-color HEAD`
6. Build the PR body with this schema. The body must begin with the hidden marker:

   ```markdown
   <!-- ping-xia-pr-body:v1 -->

   ## Problem

   <why this change is needed>

   ## Approach

   <key implementation choices>
   ```

   **Focus on the high-level problem and approach**
   - Skip mechanical details such as added unit tests, renamed variables, changed function arguments, or other implementation minutiae unless they are essential to understanding the design.
   - The goal is to state the problem clearly and lay out the high-level approach so reviewers can review the PR efficiently.

7. Build PR title for creation:
   - Start from your generated title candidate.
   - Ensure the title includes `[WIP]` exactly once (prepend if missing).
8. Create a draft PR path (`pr_url` is empty):
   - Create a new draft PR from the template body:
     - `gh pr create --repo "$repo" --head "$branch" --title "<wip_title>" --body "<description>" --draft`
9. Ensure `pr_url` is populated before returning success.

## Completion Checklist

- Tests passed (or correctly skipped when out of `~/dd` scope or no applicable code-test targets)
- Commit succeeded with hooks enabled
- Push succeeded
- Draft PR created, or existing open PR detected and left unchanged
- PR link shared with user
