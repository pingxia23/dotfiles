---
name: commit-smart
description: "Deterministic workflow to stage changes, run bzl tests, commit with hooks, push, and create or update GitHub PRs. Trigger this skill whenever the user asks to commit (for example: 'commit', 'commit this', 'please commit') and the current working directory is under ~/dd (or its resolved symlink target)."
---

Perform a deterministic smart-commit workflow.

## Hard Rules
- NEVER use `--no-verify`
- NEVER force push
- NEVER rename or switch branches unless the user explicitly asks
- For pre-commit hook failures, inspect, fix, and retry until commit succeeds

## Step 0: Preflight
1. Confirm repository scope:
   - Resolve the actual path: `dd_root="$(readlink -f ~/dd)"`
   - Continue only if `pwd -P` starts with `$dd_root`.
   - If outside, stop and tell the user this skill is out of scope.
2. Confirm git state:
   - `git rev-parse --is-inside-work-tree`
   - `branch=$(git symbolic-ref --short HEAD)`
   - If branch is detached, stop and report the issue.
3. Inspect workspace:
   - `git status --short`
   - `git diff --name-only --diff-filter=U`
   - If unresolved conflicts exist, stop and report the issue.

## Step 1: Run Tests For Affected Packages
1. Check if any code files are changed:
   - Use `git diff --name-only` and `git diff --cached --name-only` to get all changed files.
   - Code file extensions include: `.py`, `.go`, `.c`, `.cc`, `.cpp`, `.h`, `.hpp`, `.java`, `.js`, `.ts`, `.tsx`, `.jsx`, `.rs`, `.rb`, `.swift`, `.kt`, `.scala`, `.sh`, `.bash`.
   - If NO code files are changed (only config, docs, markdown, yaml, json, etc.), **skip all testing** and proceed directly to Step 2.
2. Discover test targets:
   - Run: `./discover-test-targets.sh` (relative to this skill's directory: `~/dotfiles/claude-skills/commit-smart/`)
   - The script walks up from each changed file to find the nearest `BUILD.bazel` directory,
     checks for sibling `tests/` directories, and queries bzl for test targets.
3. Execute tests:
   - If the script outputs targets: `bzl test --test_output=summary <targets...>`.
   - If no targets found: skip testing (no test targets associated with changed files).
4. Do not skip or comment out failing tests.
5. Never use `--test_filter`.

## Step 2: Stage And Review Changes
1. Stage changes while excluding working artifacts:
   ```bash
   git add -A -- ':(exclude)designs/' ':(exclude)plans/' ':(exclude)exploration/'
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
  2. Fix issues in code/config/message, re-stage, retry.
  4. Repeat until `git commit` succeeds.
  5. Stop only for external blockers (auth/network/tool outage), and report exact output.

## Step 5: Push
1. Push after successful commit:
   - `git push`
2. If push fails, stop and show exact error output.

## Step 6: Create Or Update PR
1. Confirm GitHub auth if needed:
   - `gh auth status`
2. Detect whether a PR already exists for the current branch:
   - `pr_url=$(gh pr view --head "$branch" --json url --jq '.url' 2>/dev/null)`
3. Read latest commit context:
   - `latest_commit_body=$(git log -1 --pretty=%B)`
   - `git show --name-status --format=fuller --no-color HEAD`
4. Build PR body for new PRs with this schema:
   ```
   ## Problem
   <why this change is needed>

   ## Approach
   <key implementation choices>

   ## Tests
   <what was run and results>

   ## Breaking Changes (if applicable)
   <breaking behavior and migration>

   ## Related
   <issues/PR links>
   ```
5. Create PR path (`pr_url` is empty):
   - Create a new PR from the template body:
     - `gh pr create --title "<title>" --body "<description>"`
6. Update PR path (`pr_url` exists):
   1. Read current PR body first (this is the source of truth for prior status):
      - `current_body=$(gh pr view --head "$branch" --json body --jq '.body')`
   2. Decide section updates from latest commit:
      - `## Problem`: NEVER update after PR creation.
      - `## Approach`: update only when latest commit changes implementation strategy/behavioral approach.
      - `## Breaking Changes (if applicable)`: update when latest commit introduces/removes incompatible behavior or migration impact.
      - `## Tests`: update only when NEW test files are added in latest commit.
        - Detect added test files from status `A` in latest commit, then filter by test-file naming/path conventions (e.g. `*_test.*`, `test_*.*`, `*.spec.*`, `*.test.*`, or files under `tests/` / `test/`).
   3. If no qualifying section updates are needed:
      - Skip PR body edit.
   4. If one or more qualifying updates are needed:
      - Update only those section bodies.
      - Keep all other sections and custom text unchanged.
      - `gh pr edit --body "<updated_description>"`
7. Examples:
   - CI fix commit (no approach/breaking/new-test-file change, so no description update):
     ```text
     Fix flaky CI retry in pre-commit

     This commit only stabilizes CI behavior.
     ```
   - Behavior change commit (update `## Approach` section):
     ```text
     Switch merge strategy from full overwrite to section-preserving updates

     Preserve prior PR status and update only impacted sections.
     ```
   - Breaking change commit (update `## Breaking Changes (if applicable)` section):
     ```text
     Remove legacy config key and require the new key

     Existing config must migrate to the new key name.
     ```
   - New test files added (update `## Tests` section):
     ```text
     Add regression coverage for PR description updater

     Added: tools/pr/tests/test_pr_description_update.py
     ```
8. Return final PR link to the user.

## Completion Checklist
- Tests passed
- Commit succeeded with hooks enabled
- Push succeeded
- PR created or updated
- PR link shared with user
