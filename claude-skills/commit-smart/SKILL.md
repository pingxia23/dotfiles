---
name: commit-smart
description: "Deterministic workflow to stage changes, run bzl tests, commit with hooks, push, and create or update GitHub PRs. Trigger this skill whenever the user asks to commit (for example: 'commit', 'commit this', 'please commit') and the current working directory is under ~/dd."
---

Perform a deterministic smart-commit workflow.

## Hard Rules
- NEVER use `--no-verify`
- NEVER force push
- NEVER rename or switch branches unless the user explicitly asks
- For pre-commit hook failures, inspect, fix, and retry until commit succeeds

## Step 0: Preflight
1. Confirm repository scope:
   - Continue only if `pwd` is under `~/dd`.
   - If outside `~/dd`, stop and tell the user this skill is out of scope.
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
2. Build candidate directories from changed code files:
   - Keep unique parent directories.
   - Keep only directories that contain `BUILD.bazel`.
3. Discover test targets sequentially (never parallelize `bzl` commands):
   - For each directory `d`, run: `bzl query "tests(//${d}:*)"`.
   - Union all returned targets.
4. Execute tests:
   - If target list is non-empty: `bzl test <targets...>`.
   - If target list is empty: run `bzl test //...`.
5. Do not skip or comment out failing tests.
6. Never use `--test_filter`.

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
3. Build PR body with this schema:
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
4. Apply PR command:
   - If `pr_url` is empty:
     - `gh pr create --title "<title>" --body "<description>"`
   - Else:
     - `gh pr edit --body "<description>"`
5. Return final PR link to the user.

## Completion Checklist
- Tests passed
- Commit succeeded with hooks enabled
- Push succeeded
- PR created or updated
- PR link shared with user
