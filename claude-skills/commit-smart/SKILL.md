---
name: commit-smart
description: "Deterministic workflow to stage changes, commit with hooks, push, create a draft GitHub PR only when one does not already exist, and refresh the managed PR body after each push. Trigger this skill whenever the user asks to commit (for example: 'commit', 'commit this', 'please commit')."
---

Perform a deterministic smart-commit workflow.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- For pre-commit hook failures, inspect, fix, and retry until commit succeeds
- Never create an unsigned commit. Git signing must be enabled before every commit attempt.

## Step 0: Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so all subsequent commands run from the repo root even if invoked from nested cwd.
3. Detect merge-commit state:
   - Set `merge_in_progress=true` when `git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1` succeeds.
   - This applies only to the merge commit Git is already preparing.
4. Verify Git commit signing is enabled before any commit attempt:
   - Run `git config --bool commit.gpgsign`.
   - If the value is not exactly `true`, run `git config commit.gpgsign true`, then verify again.
   - If signing still is not enabled, stop and report the exact command output.

## Step 1: Stage And Review Changes

1. Remove temporary files created during development before staging:
   - Delete only files that are clearly temporary artifacts from this workflow, such as plan scratch files, test output files, logs, caches, or one-off debugging artifacts.
   - Do not delete user-authored source, docs, configs, or unrelated untracked files.
   - If unsure whether an untracked file is a user file or a temporary artifact, leave it alone and call it out before committing.
2. Stage changes while excluding working artifacts:
   ```bash
   git add -A -- ':(top,exclude)designs/' ':(top,exclude)plans/' ':(top,exclude)exploration/'
   ```
3. Review staged contents before commit:
   - `git diff --cached --name-status`
4. If nothing is staged, stop and inform the user.

## Step 2: Compose Commit Message

1. do not use `--no-verify` unless the user explicitly asks.
2. Commit with signing and hooks enabled.
   - Rely on `commit.gpgsign=true` from Step 0; do not pass `--no-gpg-sign`.
   - If the commit command hangs, interrupt it and retry the same commit command once.
   - If the retry also hangs, stop and ask the user for help. Report the exact command and the last visible output.
3. If `merge_in_progress=false`, write a message that:
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

## Step 3: Fix Pre-commit Failures Until Commit Succeeds

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

## Step 4: Push

1. Push after successful commit:
   - `git push`
2. If push fails, stop and show exact error output.

## Step 5: Create Draft PR If Missing

Intent:

- Create a new draft PR only when no open PR exists for the current branch.
- If an open PR already exists for the branch, skip PR creation and do not edit title/state.
- Produce a `pr_url` for the next step, whether the PR was newly created or already existed.

1. Confirm GitHub auth if needed:
   - `gh auth status`
2. IMPORTANT: Pass `--repo "$repo"` to all `gh pr` commands in this step to avoid cwd/worktree/symlink repo-resolution failures.
3. Detect whether a PR already exists for the current branch:
   - `pr_url=$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url // empty' 2>/dev/null)`
4. If `pr_url` exists:
   - Reuse the existing URL for the `pr-body` refresh and final user-facing PR link.
   - Do not edit the existing PR title or draft/ready state.
5. If `pr_url` is empty, build PR title for creation:
   - Start from your generated title candidate.
   - Ensure the title includes `[WIP]` exactly once (prepend if missing).
   - Create a new draft PR with an intentionally empty body:
     - `pr_url=$(gh pr create --repo "$repo" --head "$branch" --title "<wip_title>" --body "" --draft)`
6. Ensure `pr_url` is populated.

## Step 6: Refresh Managed PR Body

Intent:

- After every successful push, invoke `pr-body` for `pr_url`, whether the PR was newly created or already existed.
- Let `pr-body` decide whether the body is managed and safe to update.
- A `SKIPPED` result means the PR body was manually edited and must be left unchanged.

Invoke the `pr-body` skill at `$HOME/dotfiles/claude-skills/pr-body/SKILL.md` with `pr_url`.
   - Treat `UPDATED` and `SKIPPED` results from `pr-body` as successful completion of this step.
   - Treat `BLOCKED` as a blocked status and stop.

## Completion Checklist

- Pre-commit checks passed through the normal commit path
- Commit succeeded with hooks enabled
- Push succeeded
- Draft PR created, or existing open PR detected without title/state changes
- Managed PR body refreshed after push, or intentionally skipped by `pr-body`
- PR link shared with user
