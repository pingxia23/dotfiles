---
name: commit-smart
description: "Deterministic workflow to stage changes, run bzl tests when applicable, commit with hooks, push, and create or update GitHub PRs. Trigger this skill whenever the user asks to commit (for example: 'commit', 'commit this', 'please commit')."
---

Perform a deterministic smart-commit workflow.

## Hard Rules
- NEVER use `--no-verify`
- NEVER force push
- NEVER rename or switch branches unless the user explicitly asks
- For pre-commit hook failures, inspect, fix, and retry until commit succeeds

## Step 0: Preflight
1. Confirm git state:
   - Load shared git/worktree context:
     - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report its stderr as the blocker.
   - `cd "$worktree_root"` so all subsequent commands run from the repo root even if invoked from nested cwd.
2. Confirm repository scope:
   - Use `in_dd_scope` from shared helper output.
3. Inspect workspace:
   - `git status --short`
   - `git diff --name-only --diff-filter=U`
   - If unresolved conflicts exist, stop and report the issue.

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
1. Inspect recent style:
   - `git log -n 20 --pretty=%s`
2. Write a message that:
   - Matches local style.
   - Explains why the change is needed.
   - Uses a concise subject and optional body.
3. Commit using HEREDOC:
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
  2. If hook output includes `No space left on device` and Bazel/bzl paths:
     - In dd-scope, clean stale Bazel output bases before retrying:
       - `"$HOME/dotfiles/claude-skills/commit-smart/cleanup-stale-bazel-output-bases.sh" --apply`
       - This script is intentionally fast and non-thorough (small batch per run).
       - If commit still fails for disk space, run it again and retry commit.
     - Then re-run the same commit command.
     - Do NOT use `--no-verify`.
     - Do NOT use `bzl clean` for this issue.
  3. Fix issues in code/config/message, re-stage, retry.
  4. Repeat until `git commit` succeeds.
  5. Stop only for external blockers (auth/network/tool outage), and report exact output.

## Step 5: Push
1. Push after successful commit:
   - `git push`
2. If push fails, stop and show exact error output.

## Step 6: Create Or Update PR
1. Confirm GitHub auth if needed:
   - `gh auth status`
2. IMPORTANT: Pass `--repo "$repo"` to all `gh pr` commands in this step to avoid cwd/worktree/symlink repo-resolution failures.
3. Detect whether a PR already exists for the current branch:
   - `pr_url=$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url' 2>/dev/null)`
4. Read latest commit context:
   - `latest_commit_body=$(git log -1 --pretty=%B)`
   - `git show --name-status --format=fuller --no-color HEAD`
5. Build PR body for new PRs with this schema:
   ```
   ## Problem
   <why this change is needed>

   ## Approach
   <key implementation choices>

   ## Tests
   <what was run and results>
   ```
6. Create PR path (`pr_url` is empty):
   - Create a new PR from the template body:
     - `gh pr create --repo "$repo" --head "$branch" --title "<title>" --body "<description>"`
7. Update PR path (`pr_url` exists):
   1. Read current PR body first (this is the source of truth for prior status):
      - `current_body=$(gh pr view "$pr_url" --repo "$repo" --json body --jq '.body')`
   2. Decide section updates from latest commit:
      - `## Problem`: NEVER update after PR creation.
      - `## Approach`: update only when latest commit changes implementation strategy/behavioral approach.
      - `## Tests`: update only when NEW test files are added in latest commit.
        - Detect added test files from status `A` in latest commit, then filter by test-file naming/path conventions (e.g. `*_test.*`, `test_*.*`, `*.spec.*`, `*.test.*`, or files under `tests/` / `test/`).
   3. If no qualifying section updates are needed:
      - Skip PR body edit.
   4. If one or more qualifying updates are needed:
      - Update only those section bodies.
      - Keep all other sections and custom text unchanged.
      - `gh pr edit "$pr_url" --repo "$repo" --body "<updated_description>"`
8. Examples:
   - CI fix commit (no approach/new-test-file change, so no description update):
     ```text
     Fix flaky CI retry in pre-commit

     This commit only stabilizes CI behavior.
     ```
   - Behavior change commit (update `## Approach` section):
     ```text
     Switch merge strategy from full overwrite to section-preserving updates

     Preserve prior PR status and update only impacted sections.
     ```
   - New test files added (update `## Tests` section):
     ```text
     Add regression coverage for PR description updater

     Added: tools/pr/tests/test_pr_description_update.py
     ```
9. Return final PR link to the user.

## Completion Checklist
- Tests passed (or correctly skipped when out of `~/dd` scope or no applicable code-test targets)
- Commit succeeded with hooks enabled
- Push succeeded
- PR created or updated
- PR link shared with user
